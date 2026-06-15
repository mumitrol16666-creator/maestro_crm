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

    // 1. Ищем активный гибридный абонемент с нужным типом баланса
    if (classRecord.classType === 'individual') {
        const hybrid = await db.membership.findFirst({
            where: {
                ...activeOnClassDate,
                individualClassesRemaining: { gt: 0 },
            },
            orderBy: { createdAt: 'desc' }
        });
        if (hybrid) return hybrid;
    } else if (classRecord.classType === 'group') {
        const groupHybrid = await db.membership.findFirst({
            where: {
                ...activeOnClassDate,
                groupId: classRecord.groupId,
                groupClassesRemaining: { gt: 0 },
            },
            orderBy: { createdAt: 'desc' }
        });
        if (groupHybrid) return groupHybrid;
        const hybrid = await db.membership.findFirst({
            where: {
                ...activeOnClassDate,
                groupId: null,
                groupClassesRemaining: { gt: 0 },
            },
            orderBy: { createdAt: 'desc' }
        });
        if (hybrid) return hybrid;
    } else if (classRecord.classType === 'theory') {
        const hybrid = await db.membership.findFirst({
            where: {
                ...activeOnClassDate,
                theoryClassesRemaining: { gt: 0 },
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
                classesRemaining: { gt: 0 },
            },
            orderBy: { createdAt: 'desc' }
        });

        if (!membership) {
            membership = await db.membership.findFirst({
                where: {
                    ...activeOnClassDate,
                    groupId: null,
                    classesRemaining: { gt: 0 },
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
                classesRemaining: { gt: 0 },
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

function membershipSupportsClass(membership, classRecord) {
    if (membership.classesRemaining <= 0) return false;
    if (classRecord.classType === 'individual') {
        return membership.individualClassesRemaining === null
            ? ['individual', 'mixed'].includes(membership.lessonFormat)
            : membership.individualClassesRemaining > 0;
    }
    if (classRecord.classType === 'group') {
        if (membership.groupId && membership.groupId !== classRecord.groupId) return false;
        return membership.groupClassesRemaining === null
            ? ['group', 'mixed'].includes(membership.lessonFormat)
            : membership.groupClassesRemaining > 0;
    }
    if (classRecord.classType === 'theory') {
        return membership.theoryClassesRemaining === null
            ? membership.classesRemaining > 0
            : membership.theoryClassesRemaining > 0;
    }
    return membership.classesRemaining > 0;
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

    const updateData = {
        classesRemaining: { decrement: 1 },
        classesUsed: { increment: 1 }
    };

    if (membership.individualClassesRemaining !== null) {
        if (classRecord.classType === 'individual') {
            updateData.individualClassesRemaining = { decrement: 1 };
        } else if (classRecord.classType === 'group') {
            updateData.groupClassesRemaining = { decrement: 1 };
        } else if (classRecord.classType === 'theory') {
            updateData.theoryClassesRemaining = { decrement: 1 };
        }
    }

    await db.membership.update({
        where: { id: membership.id },
        data: updateData
    });

    await db.membershipTransaction.create({
        data: {
            membershipId: membership.id,
            type: 'manual_deduct',
            amount: 1,
            reason: `Подтверждение урока: ${classRecord.title} (${classRecord.date.toLocaleDateString('ru-RU')})`,
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

    return { deducted: true, membershipId: membership.id, classesBalanceAfter: membership.classesRemaining - 1 };
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
    deductMembershipForClass,
    refundMembershipForClass,
    refundAllDeductionsForClass
};
