const DEPARTURE_REASONS = Object.freeze({
    stopped: 'Забросил обучение',
    other_school: 'Перешёл в другую школу',
    moved: 'Переехал',
    schedule: 'Не подошло расписание',
    price: 'Не подошла стоимость',
    health: 'По состоянию здоровья',
    no_contact: 'Не выходит на связь',
    test_record: 'Тестовая карточка',
    other: 'Другая причина',
});

function normalizeDepartureReason(value) {
    const reason = String(value || '').trim();
    return Object.hasOwn(DEPARTURE_REASONS, reason) ? reason : null;
}

async function finishStudentEducation(prisma, studentId, actorId, input = {}) {
    const reason = normalizeDepartureReason(input.reason);
    if (!reason) {
        const error = new Error('Выберите причину завершения обучения');
        error.code = 'INVALID_DEPARTURE_REASON';
        error.statusCode = 400;
        throw error;
    }

    const note = String(input.note || '').trim().slice(0, 2000) || null;
    const now = new Date();

    return prisma.$transaction(async tx => {
        const student = await tx.student.findFirst({
            where: { id: studentId, role: 'student' },
            select: { id: true, name: true, lastName: true, status: true, accountBalance: true },
        });
        if (!student) {
            const error = new Error('Ученик не найден');
            error.code = 'STUDENT_NOT_FOUND';
            error.statusCode = 404;
            throw error;
        }

        const activeGroups = await tx.studentGroup.findMany({
            where: { studentId, status: 'active' },
            select: { groupId: true },
        });

        await tx.student.update({
            where: { id: studentId },
            data: {
                status: 'inactive',
                pausedUntil: null,
                lostAt: now,
                lostReason: reason,
                departureNote: note,
                lostMarkedById: actorId || null,
                activeMembershipId: null,
                assignedTeacherId: null,
                notifyHomework: false,
                notifyLessons: false,
                notifyPayments: false,
                externalLinkStatus: 'unlinked',
                linkedAt: null,
            },
        });
        await tx.studentPhone.updateMany({
            where: { studentId },
            data: { notifyHomework: false, notifyLessons: false, notifyPayments: false },
        });
        await tx.studentSchedule.deleteMany({ where: { studentId } });
        await tx.studentGroup.updateMany({
            where: { studentId, status: { in: ['active', 'frozen'] } },
            data: { status: 'left' },
        });
        // Reset the spendable budget with its lesson counters. Keep nullable
        // legacy rows and the immutable purchase budget unchanged.
        await tx.membership.updateMany({
            where: { studentId, status: { in: ['active', 'frozen'] }, individualBudgetRemaining: { not: null } },
            data: { individualBudgetRemaining: 0 },
        });
        await tx.membership.updateMany({
            where: { studentId, status: { in: ['active', 'frozen'] } },
            data: {
                status: 'expired',
                classesRemaining: 0,
                individualClassesRemaining: 0,
                groupClassesRemaining: 0,
                theoryClassesRemaining: 0,
                followUpStatus: 'closed',
                followUpAt: null,
                paymentPromiseDate: null,
                teacherId: null,
            },
        });
        await tx.freeze.updateMany({
            where: { studentId, status: { in: ['pending', 'active'] } },
            data: { status: 'cancelled', processedAt: now, processedById: actorId || null },
        });
        await tx.payment.updateMany({
            where: { studentId, status: 'pending' },
            data: { status: 'cancelled' },
        });
        await tx.classAttendee.deleteMany({
            where: { studentId, class: { date: { gte: now }, status: { in: ['scheduled', 'not_filled'] } } },
        });
        await tx.class.updateMany({
            where: {
                individualStudentId: studentId,
                date: { gte: now },
                status: { in: ['scheduled', 'not_filled'] },
            },
            data: {
                status: 'cancelled',
                teacherId: null,
                originalTeacherId: null,
                notes: `Обучение завершено: ${DEPARTURE_REASONS[reason]}${note ? `. ${note}` : ''}`,
            },
        });

        for (const { groupId } of activeGroups) {
            const currentStudents = await tx.studentGroup.count({ where: { groupId, status: 'active' } });
            await tx.group.update({ where: { id: groupId }, data: { currentStudents } });
        }

        return { student, reason, reasonLabel: DEPARTURE_REASONS[reason], note, finishedAt: now };
    });
}

async function restoreFormerStudent(prisma, studentId, actorId) {
    return prisma.$transaction(async tx => {
        const student = await tx.student.findFirst({
            where: { id: studentId, role: 'student', status: 'inactive', lostAt: { not: null } },
            select: { id: true, name: true, lastName: true },
        });
        if (!student) {
            const error = new Error('Бывший ученик не найден');
            error.code = 'STUDENT_NOT_FOUND';
            error.statusCode = 404;
            throw error;
        }
        await tx.student.update({
            where: { id: studentId },
            data: {
                status: 'active',
                pausedUntil: null,
                lostAt: null,
                lostReason: null,
                departureNote: null,
                lostMarkedById: null,
            },
        });
        if (actorId) {
            await tx.studentRecovery.create({
                data: {
                    studentId,
                    recoveredByUserId: actorId,
                    note: 'Восстановлен из списка бывших учеников',
                },
            });
        }
        return student;
    });
}

async function permanentlyDeleteStudent(prisma, studentId) {
    return prisma.$transaction(async tx => {
        const student = await tx.student.findFirst({
            where: {
                id: studentId,
                role: 'student',
                status: 'inactive',
                lostAt: { not: null },
            },
            select: { id: true, name: true, lastName: true },
        });
        if (!student) {
            const error = new Error('Физически удалить можно только бывшего ученика');
            error.code = 'STUDENT_NOT_FORMER';
            error.statusCode = 400;
            throw error;
        }

        // Keep the legacy URL safe for old clients. Archiving is the supported
        // departure workflow; destroying financial and lesson history is not.
        const error = new Error('Полное удаление отключено: история обучения, оплат и остаток должны сохраниться. Ученик уже находится в архиве.');
        error.code = 'STUDENT_HISTORY_PROTECTED';
        error.statusCode = 409;
        throw error;
    });
}

module.exports = {
    DEPARTURE_REASONS,
    normalizeDepartureReason,
    finishStudentEducation,
    restoreFormerStudent,
    permanentlyDeleteStudent,
};
