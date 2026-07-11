const { prisma } = require('../config/db');

/**
 * Найти активный абонемент для списания по занятию.
 * Приоритет: абонемент группы → общий (groupId=null).
 */
async function findMembershipForClass(studentId, classRecord, tx) {
    const db = tx || prisma;
    const activeOnClassDate = {
        studentId,
        status: 'active',
        startDate: { lte: classRecord.date },
        endDate: { gte: classRecord.date },
    };

    // 1. Ищем активный тариф с нужным форматом. Остаток уроков теперь считается
    // от денежного баланса ученика, поэтому classesRemaining не ограничивает списание.
    if (classRecord.classType === 'individual') {
        const hybrid = await db.membership.findFirst({
            where: {
                ...activeOnClassDate,
                OR: [
                    { lessonFormat: { in: ['individual', 'mixed'] } },
                    { type: { in: ['individual_single', 'individual_package'] } }
                ]
            },
            orderBy: { createdAt: 'desc' }
        });
        if (hybrid) return hybrid;
    } else if (classRecord.classType === 'group') {
        const groupHybrid = await db.membership.findFirst({
            where: {
                ...activeOnClassDate,
                groupId: classRecord.groupId,
                lessonFormat: { in: ['group', 'mixed'] },
            },
            orderBy: { createdAt: 'desc' }
        });
        if (groupHybrid) return groupHybrid;
        const hybrid = await db.membership.findFirst({
            where: {
                ...activeOnClassDate,
                groupId: null,
                lessonFormat: { in: ['group', 'mixed'] },
            },
            orderBy: { createdAt: 'desc' }
        });
        if (hybrid) return hybrid;
    } else if (classRecord.classType === 'theory') {
        const hybrid = await db.membership.findFirst({
            where: {
                ...activeOnClassDate,
                lessonFormat: { in: ['group', 'mixed'] },
            },
            orderBy: { createdAt: 'desc' }
        });
        if (hybrid) return hybrid;
    }

    // 2. Фоллбэк на стандартную/легаси логику
    if (classRecord.groupId) {
        let membership = await db.membership.findFirst({
            where: {
                ...activeOnClassDate,
                groupId: classRecord.groupId,
            },
            orderBy: { createdAt: 'desc' }
        });

        if (!membership) {
            membership = await db.membership.findFirst({
                where: {
                    ...activeOnClassDate,
                    groupId: null,
                },
                orderBy: { createdAt: 'desc' }
            });
        }

        return membership;
    }

    if (classRecord.classType === 'individual') {
        return db.membership.findFirst({
            where: {
                ...activeOnClassDate,
                OR: [
                    { plan: { lessonFormat: 'individual' } },
                    { type: { in: ['individual_single', 'individual_package'] } }
                ]
            },
            orderBy: { createdAt: 'desc' }
        });
    }

    return null;
}

async function hasDeductionForClass(membershipId, classId, tx) {
    const db = tx || prisma;
    const existing = await db.membershipTransaction.findFirst({
        where: {
            membershipId,
            classId,
            type: { in: ['deduct', 'manual_deduct'] }
        }
    });
    return Boolean(existing);
}

async function hasFreezeForClass(membershipId, classId, tx) {
    const db = tx || prisma;
    const existing = await db.membershipTransaction.findFirst({
        where: {
            membershipId,
            classId,
            type: 'freeze_used'
        }
    });
    return Boolean(existing);
}

function membershipSupportsClass(membership, classRecord) {
    if (classRecord.classType === 'individual') {
        return membership.individualClassesRemaining === null
            ? ['individual', 'mixed'].includes(membership.lessonFormat)
            : ['individual', 'mixed'].includes(membership.lessonFormat) || membership.individualClassesRemaining > 0;
    }
    if (classRecord.classType === 'group') {
        if (membership.groupId && membership.groupId !== classRecord.groupId) return false;
        return membership.groupClassesRemaining === null
            ? ['group', 'mixed'].includes(membership.lessonFormat)
            : ['group', 'mixed'].includes(membership.lessonFormat) || membership.groupClassesRemaining > 0;
    }
    if (classRecord.classType === 'theory') {
        return membership.theoryClassesRemaining === null
            ? true
            : ['group', 'mixed'].includes(membership.lessonFormat) || membership.theoryClassesRemaining > 0;
    }
    return true;
}

/**
 * Списать одно занятие с абонемента. Идемпотентно по classId.
 * Только для вызова администратором при подтверждении урока.
 */
async function deductMembershipForClass(studentId, classRecord, addedById, tx, selectedMembershipId) {
    const db = tx || prisma;

    if (classRecord.classType === 'trial' || classRecord.isPractice) {
        return { deducted: false, reason: 'trial_or_practice' };
    }

    if (!classRecord.groupId && classRecord.classType !== 'individual' && classRecord.classType !== 'theory') {
        return { deducted: false, reason: 'no_billable_context' };
    }

    let membership = null;
    if (selectedMembershipId) {
        membership = await db.membership.findFirst({
            where: {
                id: selectedMembershipId,
                studentId,
                status: 'active',
                startDate: { lte: classRecord.date },
                endDate: { gte: classRecord.date },
            }
        });
        if (!membership || !membershipSupportsClass(membership, classRecord)) {
            return { deducted: false, reason: 'membership_not_available', membershipId: selectedMembershipId };
        }
    } else {
        membership = await findMembershipForClass(studentId, classRecord, db);
    }
    if (!membership) {
        return { deducted: false, reason: 'no_membership' };
    }

    if (await hasDeductionForClass(membership.id, classRecord.id, db)) {
        return { deducted: false, reason: 'already_deducted', membershipId: membership.id };
    }

    await db.membershipTransaction.create({
        data: {
            membershipId: membership.id,
            type: 'manual_deduct',
            amount: 0,
            reason: `Тариф для списания урока: ${classRecord.title} (${classRecord.date.toLocaleDateString('ru-RU')})`,
            classId: classRecord.id,
            addedById
        }
    });

    const attendee = await db.classAttendee.findFirst({
        where: { classId: classRecord.id, studentId }
    });

    if (attendee) {
        await db.classAttendee.update({
            where: { id: attendee.id },
            data: { autoDeducted: true }
        });
    }

    return { deducted: true, membershipId: membership.id, classesBalanceAfter: null };
}

async function useEmergencyFreezeForClass(studentId, classRecord, addedById, tx, selectedMembershipId) {
    const db = tx || prisma;

    if (classRecord.classType === 'trial' || classRecord.isPractice) {
        return { frozen: false, reason: 'trial_or_practice' };
    }

    let membership = null;
    if (selectedMembershipId) {
        membership = await db.membership.findFirst({
            where: {
                id: selectedMembershipId,
                studentId,
                status: 'active',
                startDate: { lte: classRecord.date },
                endDate: { gte: classRecord.date },
            }
        });
        if (!membership || !membershipSupportsClass(membership, classRecord)) {
            return { frozen: false, reason: 'membership_not_available', membershipId: selectedMembershipId };
        }
    } else {
        membership = await findMembershipForClass(studentId, classRecord, db);
    }

    if (!membership) {
        return { frozen: false, reason: 'no_membership' };
    }

    if ((membership.emergencyFreezesAvailable ?? 0) <= 0) {
        return { frozen: false, reason: 'no_emergency_freezes', membershipId: membership.id };
    }

    if (await hasFreezeForClass(membership.id, classRecord.id, db)) {
        return { frozen: false, reason: 'already_frozen', membershipId: membership.id };
    }

    await db.membership.update({
        where: { id: membership.id },
        data: {
            emergencyFreezesAvailable: { decrement: 1 },
            emergencyFreezesUsed: { increment: 1 }
        }
    });

    await db.membershipTransaction.create({
        data: {
            membershipId: membership.id,
            type: 'freeze_used',
            amount: 0,
            reason: `Заморозка урока: ${classRecord.title} (${classRecord.date.toLocaleDateString('ru-RU')})`,
            classId: classRecord.id,
            addedById
        }
    });

    const attendee = await db.classAttendee.findFirst({
        where: { classId: classRecord.id, studentId }
    });

    if (attendee) {
        await db.classAttendee.update({
            where: { id: attendee.id },
            data: { autoDeducted: false }
        });
    }

    return {
        frozen: true,
        membershipId: membership.id,
        emergencyFreezesAvailableAfter: (membership.emergencyFreezesAvailable ?? 0) - 1
    };
}

/**
 * Вернуть списание за занятие (все autoDeducted, не только attended:true).
 */
async function refundMembershipForClass(studentId, classRecord, addedById, tx, reason) {
    const db = tx || prisma;

    const transactions = await db.membershipTransaction.findMany({
        where: {
            classId: classRecord.id,
            type: { in: ['deduct', 'manual_deduct'] },
            membership: { studentId }
        },
        include: { membership: true }
    });

    if (transactions.length === 0) {
        return { refunded: false, reason: 'no_transactions' };
    }

    for (const tr of transactions) {
        const updateData = {
            classesRemaining: { increment: tr.amount },
            classesUsed: { decrement: tr.amount }
        };

        if (tr.membership.individualClassesRemaining !== null) {
            if (classRecord.classType === 'individual') {
                updateData.individualClassesRemaining = { increment: tr.amount };
            } else if (classRecord.classType === 'group') {
                updateData.groupClassesRemaining = { increment: tr.amount };
            } else if (classRecord.classType === 'theory') {
                updateData.theoryClassesRemaining = { increment: tr.amount };
            }
        }

        await db.membership.update({
            where: { id: tr.membershipId },
            data: updateData
        });

        await db.membershipTransaction.create({
            data: {
                membershipId: tr.membershipId,
                type: 'add',
                amount: tr.amount,
                reason: reason || `Возврат: ${classRecord.title}`,
                classId: classRecord.id,
                addedById
            }
        });
    }

    return { refunded: true, count: transactions.length };
}

async function refundAllDeductionsForClass(classRecord, addedById, tx, reason) {
    const db = tx || prisma;

    const transactions = await db.membershipTransaction.findMany({
        where: {
            classId: classRecord.id,
            type: { in: ['deduct', 'manual_deduct'] }
        },
        include: { membership: { select: { studentId: true } } }
    });

    const studentIds = [...new Set(transactions.map(t => t.membership.studentId))];
    const results = [];

    for (const studentId of studentIds) {
        results.push(await refundMembershipForClass(studentId, classRecord, addedById, db, reason));
    }

    return results;
}

module.exports = {
    findMembershipForClass,
    membershipSupportsClass,
    hasDeductionForClass,
    hasFreezeForClass,
    deductMembershipForClass,
    useEmergencyFreezeForClass,
    refundMembershipForClass,
    refundAllDeductionsForClass
};
