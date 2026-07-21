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
            select: { id: true, name: true, lastName: true, status: true },
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
                accountBalance: 0,
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

        const payments = await tx.payment.findMany({ where: { studentId }, select: { id: true } });
        const paymentIds = payments.map(item => item.id);
        const memberships = await tx.membership.findMany({ where: { studentId }, select: { id: true } });
        const membershipIds = memberships.map(item => item.id);
        const individualClasses = await tx.class.findMany({
            where: { individualStudentId: studentId },
            select: { id: true },
        });
        const classIds = individualClasses.map(item => item.id);

        await tx.conversation.updateMany({ where: { studentId }, data: { studentId: null } });
        await tx.booking.updateMany({ where: { convertedToStudentId: studentId }, data: { convertedToStudentId: null } });
        await tx.student.updateMany({ where: { referredByStudentId: studentId }, data: { referredByStudentId: null } });
        await tx.student.updateMany({ where: { lostMarkedById: studentId }, data: { lostMarkedById: null } });
        await tx.activityLog.deleteMany({ where: { userId: studentId } });
        await tx.studentRecovery.deleteMany({
            where: { OR: [{ studentId }, { recoveredByUserId: studentId }] },
        });
        await tx.salaryClassStudent.deleteMany({ where: { studentId } });
        await tx.classAttendee.deleteMany({ where: { studentId } });
        if (membershipIds.length) {
            await tx.membershipTransaction.deleteMany({ where: { membershipId: { in: membershipIds } } });
        }
        if (classIds.length) {
            await tx.salaryClass.updateMany({ where: { classId: { in: classIds } }, data: { classId: null } });
            await tx.payment.updateMany({ where: { relatedClassId: { in: classIds } }, data: { relatedClassId: null } });
            await tx.class.deleteMany({ where: { id: { in: classIds } } });
        }
        if (paymentIds.length) {
            await tx.cashTransaction.deleteMany({ where: { relatedPaymentId: { in: paymentIds } } });
            await tx.payment.updateMany({ where: { relatedPaymentId: { in: paymentIds } }, data: { relatedPaymentId: null } });
            await tx.payment.deleteMany({ where: { id: { in: paymentIds } } });
        }
        await tx.student.update({ where: { id: studentId }, data: { activeMembershipId: null } });
        await tx.freeze.deleteMany({ where: { studentId } });
        await tx.membership.deleteMany({ where: { studentId } });
        await tx.studentSchedule.deleteMany({ where: { studentId } });
        await tx.studentGroup.deleteMany({ where: { studentId } });
        await tx.student.delete({ where: { id: studentId } });

        return student;
    });
}

module.exports = {
    DEPARTURE_REASONS,
    normalizeDepartureReason,
    finishStudentEducation,
    restoreFormerStudent,
    permanentlyDeleteStudent,
};
