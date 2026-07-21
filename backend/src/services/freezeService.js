const { prisma } = require('../config/db');

const AUTO_APPROVED_FREEZE_TYPES = new Set(['regular', 'period']);

function normalizeFreezePeriod(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        const error = new Error('Укажите корректный период заморозки');
        error.code = 'INVALID_FREEZE_PERIOD';
        throw error;
    }
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    if (end < start) {
        const error = new Error('Дата окончания не может быть раньше даты начала');
        error.code = 'INVALID_FREEZE_PERIOD';
        throw error;
    }
    return { start, end };
}

/**
 * Creates a freeze for a membership and compensates the classes inside the
 * selected period. The function is shared by the regular freeze endpoint,
 * membership creation and the temporary student pause flow.
 */
async function createFreezeForMembership({
    membershipId,
    type = 'regular',
    startDate,
    endDate,
    reason,
    createdById = null,
}) {
    if (!membershipId || !type || !startDate || !endDate) {
        const error = new Error('Заполните все обязательные поля');
        error.code = 'INVALID_FREEZE_INPUT';
        throw error;
    }

    const { start, end } = normalizeFreezePeriod(startDate, endDate);
    const membership = await prisma.membership.findUnique({
        where: { id: membershipId },
        include: {
            student: {
                select: {
                    id: true,
                    name: true,
                    lastName: true,
                    gender: true,
                    groups: { where: { status: 'active' }, select: { groupId: true } },
                },
            },
        },
    });

    if (!membership) {
        const error = new Error('Абонемент не найден');
        error.code = 'MEMBERSHIP_NOT_FOUND';
        throw error;
    }

    if (type === 'period' && membership.student.gender !== 'female') {
        const error = new Error('Этот тип заморозки доступен только женщинам');
        error.code = 'FREEZE_GENDER_RESTRICTED';
        throw error;
    }

    const studentGroupIds = [...new Set([
        ...membership.student.groups.map((group) => group.groupId),
        membership.groupId,
    ].filter(Boolean))];
    const classesInPeriod = await prisma.class.findMany({
        where: {
            date: { gte: start, lte: end },
            status: { not: 'cancelled' },
            OR: [
                ...(studentGroupIds.length ? [{ groupId: { in: studentGroupIds } }] : []),
                { individualStudentId: membership.student.id },
                { attendees: { some: { studentId: membership.student.id } } },
            ],
        },
        select: { id: true },
    });

    if (!classesInPeriod.length) {
        const error = new Error('В указанный период нет занятий');
        error.code = 'FREEZE_NO_CLASSES';
        throw error;
    }

    const actualFrozenClasses = type === 'period'
        ? Math.min(classesInPeriod.length, 2)
        : classesInPeriod.length;
    const status = AUTO_APPROVED_FREEZE_TYPES.has(type) ? 'active' : 'pending';

    return prisma.$transaction(async (tx) => {
        const lockedMemberships = await tx.$queryRaw`
            SELECT * FROM "Membership" WHERE id = ${membershipId} FOR UPDATE
        `;
        const lockedMembership = lockedMemberships[0];
        if (!lockedMembership) {
            const error = new Error('Абонемент не найден');
            error.code = 'MEMBERSHIP_NOT_FOUND';
            throw error;
        }

        if (AUTO_APPROVED_FREEZE_TYPES.has(type)
            && lockedMembership.freezesUsed >= lockedMembership.freezesAvailable) {
            const error = new Error('Все бесплатные заморозки использованы');
            error.code = 'FREEZE_LIMIT_REACHED';
            throw error;
        }

        const duplicateFreeze = await tx.freeze.findFirst({
            where: {
                membershipId,
                status: { in: ['pending', 'active'] },
                startDate: { lte: end },
                endDate: { gte: start },
            },
            select: { id: true },
        });
        if (duplicateFreeze) {
            const error = new Error('На этот период уже существует заморозка');
            error.code = 'FREEZE_PERIOD_DUPLICATE';
            throw error;
        }

        const created = await tx.freeze.create({
            data: {
                studentId: membership.student.id,
                membershipId,
                type,
                frozenClasses: actualFrozenClasses,
                classesUsed: 0,
                startDate: start,
                endDate: end,
                reason: reason || null,
                createdById,
                status,
            },
        });

        if (status === 'active') {
            await tx.membership.update({
                where: { id: membershipId },
                data: {
                    freezesUsed: { increment: 1 },
                    classesRemaining: { increment: actualFrozenClasses },
                    totalClasses: { increment: actualFrozenClasses },
                },
            });
            await tx.membershipTransaction.create({
                data: {
                    membershipId,
                    type: 'freeze_used',
                    amount: actualFrozenClasses,
                    reason: `Заморозка (${type}): +${actualFrozenClasses} занятий компенсировано`,
                    freezeId: created.id,
                    addedById: createdById,
                },
            });
        }

        return { ...created, frozenClasses: actualFrozenClasses };
    });
}

module.exports = {
    AUTO_APPROVED_FREEZE_TYPES,
    normalizeFreezePeriod,
    createFreezeForMembership,
};
