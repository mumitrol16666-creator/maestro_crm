function isTrackedProgramMembership(membership) {
    if (!membership) return false;
    if (membership.lessonFormat === 'program') return true;
    if (membership.lessonFormat === 'individual' && membership.individualClassesRemaining !== null && membership.individualClassesRemaining !== undefined) {
        return true;
    }
    return false;
}

const { prisma } = require('../config/db');
const { getMembershipLessonChargeAmount } = require('./lessonPricing');
const { isRateCard, rateCardSupportsLesson, selectRateCard } = require('./rateCards');
const { outstandingClassCharges } = require('./classChargeLedger');
const { outstandingClassFreezes, freezeLedgerConflict } = require('./classFreezeLedger');

/**
 * Найти активный абонемент для списания по занятию.
 * Только явная расценка нужного вида занятия; даты и счетчики не участвуют.
 */
async function findMembershipForClass(studentId, classRecord, tx) {
    const db = tx || prisma;
    const cards = await db.membership.findMany({ where: { studentId, status: 'active', billingModel: 'rate_card' } });
    const group = classRecord.groupId ? await db.group.findUnique({ where: { id: classRecord.groupId } }) : null;
    return selectRateCard(cards, { ...classRecord, group });
}

async function hasDeductionForClass(membershipId, classId, tx) {
    const db = tx || prisma;
    const transactions = await db.membershipTransaction.findMany({
        where: {
            membershipId,
            classId,
            type: { in: ['deduct', 'manual_deduct', 'add'] }
        }
    });
    return outstandingClassCharges(transactions).length > 0;
}

async function hasFreezeForClass(membershipId, classId, tx) {
    const db = tx || prisma;
    const transactions = await db.membershipTransaction.findMany({
        where: {
            membershipId,
            classId,
            type: { in: ['freeze_used', 'freeze_restored'] }
        }
    });
    return outstandingClassFreezes(transactions).length > 0;
}

function membershipSupportsClass(membership, classRecord) {
    if (isRateCard(membership)) return rateCardSupportsLesson(membership, classRecord);
    if (membership.lessonFormat === 'program') {
        const componentField = {
            individual: 'individualClassesRemaining',
            group: 'groupClassesRemaining',
            theory: 'theoryClassesRemaining',
        }[classRecord.classType];
        if (!componentField || membership.classesRemaining <= 0 || !(membership[componentField] > 0)) return false;
        if (classRecord.classType === 'group' && membership.groupId && membership.groupId !== classRecord.groupId) return false;
        if (classRecord.group?.direction && membership.direction?.name
            && ![membership.direction.name, 'Ансамбль'].includes(classRecord.group.direction)) return false;
        return true;
    }
    if (isTrackedProgramMembership(membership)) {
        if (classRecord.classType !== 'individual') return false;
        return membership.classesRemaining > 0 && Number(membership.individualClassesRemaining || 0) > 0;
    }
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
    if (!tx) return prisma.$transaction(client => deductMembershipForClass(studentId, classRecord, addedById, client, selectedMembershipId));
    const db = tx || prisma;
    if (classRecord.groupId) {
        classRecord = { ...classRecord, group: await db.group.findUnique({ where: { id: classRecord.groupId } }) };
    }

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
                billingModel: 'rate_card',
            },
            include: { direction: { select: { name: true } } },
        });
        if (!membership || !membershipSupportsClass(membership, classRecord)) {
            return { deducted: false, reason: 'membership_not_available', membershipId: selectedMembershipId };
        }
    } else {
        membership = await findMembershipForClass(studentId, classRecord, db);
    }
    if (!membership || !isRateCard(membership)) {
        return { deducted: false, reason: 'no_membership' };
    }

    const locked = await db.$queryRaw`SELECT * FROM "Membership" WHERE id = ${membership.id} FOR UPDATE`;
    if (!locked[0]) return { deducted: false, reason: 'membership_not_available' };
    membership = { ...membership, ...locked[0] };
    if (!rateCardSupportsLesson(membership, classRecord)) {
        return { deducted: false, reason: 'membership_not_available', membershipId: membership.id };
    }

    if (await hasDeductionForClass(membership.id, classRecord.id, db)) {
        return { deducted: false, reason: 'already_deducted', membershipId: membership.id };
    }

    const chargeAmount = getMembershipLessonChargeAmount(membership, classRecord);
    if (chargeAmount === null) return { deducted: false, reason: 'price_unavailable', membershipId: membership.id };

    await db.membershipTransaction.create({
        data: {
            membershipId: membership.id,
            type: 'manual_deduct',
            amount: 1,
            chargeAmount,
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

    return { deducted: true, membershipId: membership.id, chargeAmount, classesBalanceAfter: null };
}

async function useEmergencyFreezeForClass(studentId, classRecord, addedById, tx, selectedMembershipId) {
    if (!tx) return prisma.$transaction(client => useEmergencyFreezeForClass(studentId, classRecord, addedById, client, selectedMembershipId));
    const db = tx || prisma;
    // Same lock order as approval and reopen, including standalone calls.
    await db.$queryRaw`SELECT id FROM "Class" WHERE id = ${classRecord.id} FOR UPDATE`;
    await db.$queryRaw`SELECT id FROM "Student" WHERE id = ${studentId} FOR UPDATE`;
    if (classRecord.groupId) classRecord = { ...classRecord, group: await db.group.findUnique({ where: { id: classRecord.groupId } }) };

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
                billingModel: 'rate_card',
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

    const locked = await db.$queryRaw`SELECT * FROM "Membership" WHERE id = ${membership.id} FOR UPDATE`;
    membership = locked[0];
    if (!membership || membership.studentId !== studentId || !rateCardSupportsLesson(membership, classRecord)) {
        return { frozen: false, reason: 'membership_not_available', membershipId: selectedMembershipId || membership?.id };
    }

    if (await hasFreezeForClass(membership.id, classRecord.id, db)) {
        return { frozen: false, reason: 'already_frozen', membershipId: membership.id };
    }

    const available = membership.emergencyFreezesAvailable ?? 0;
    const used = membership.emergencyFreezesUsed ?? 0;
    if (available < 0 || used < 0) throw freezeLedgerConflict();
    if (available === 0) {
        return { frozen: false, reason: 'no_emergency_freezes', membershipId: membership.id };
    }

    await db.membership.update({
        where: { id: membership.id },
        data: {
            emergencyFreezesAvailable: available - 1,
            emergencyFreezesUsed: used + 1
        }
    });

    await db.membershipTransaction.create({
        data: {
            membershipId: membership.id,
            type: 'freeze_used',
            amount: 0,
            reason: `Экстренная отмена: ${classRecord.title} (${classRecord.date.toLocaleDateString('ru-RU')})`,
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
    if (!tx) return prisma.$transaction(client => refundMembershipForClass(studentId, classRecord, addedById, client, reason));
    const db = tx || prisma;
    await db.$queryRaw`SELECT id FROM "Class" WHERE id = ${classRecord.id} FOR UPDATE`;
    await db.$queryRaw`SELECT id FROM "Student" WHERE id = ${studentId} FOR UPDATE`;

    const transactions = await db.membershipTransaction.findMany({
        where: {
            classId: classRecord.id,
            type: { in: ['deduct', 'manual_deduct', 'add'] },
            membership: { studentId }
        },
        include: { membership: true }
    });

    if (transactions.length === 0) {
        return { refunded: false, reason: 'no_transactions' };
    }
    const lockedMemberships = new Map();
    for (const membershipId of [...new Set(transactions.map(item => item.membershipId))].sort()) {
        const rows = await db.$queryRaw`SELECT * FROM "Membership" WHERE id = ${membershipId} FOR UPDATE`;
        if (rows[0]) lockedMemberships.set(membershipId, rows[0]);
    }

    const reversals = outstandingClassCharges(transactions);
    for (const transaction of reversals) {
        const lockedMembership = lockedMemberships.get(transaction.membershipId);
        if (!lockedMembership) continue;
        const tr = { ...transaction, membership: lockedMembership };
        const updateData = {
            classesRemaining: { increment: tr.amount },
            classesUsed: { decrement: tr.amount },
            ...(isTrackedProgramMembership(tr.membership) && tr.membership.status === 'expired'
                && new Date(tr.membership.endDate) >= new Date() ? { status: 'active' } : {}),
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
        const refundedCharge = tr.chargeAmount;
        if (classRecord.classType === 'individual' && tr.membership.individualBudgetRemaining != null) {
            updateData.individualBudgetRemaining = { increment: refundedCharge };
        }

        if (tr.amount > 0 && !isRateCard(tr.membership)) await db.membership.update({
            where: { id: tr.membershipId },
            data: updateData
        });
        {
            const attendee = await db.classAttendee.findFirst({
                where: { classId: classRecord.id, studentId, chargedMembershipId: tr.membershipId, chargeSource: 'membership' },
            });
            if (attendee) {
                if (attendee.chargeAmount > 0) {
                    await db.student.update({ where: { id: studentId }, data: { accountBalance: { increment: attendee.chargeAmount } } });
                }
                await db.classAttendee.update({ where: { id: attendee.id }, data: {
                    chargeAmount: 0, chargedMembershipId: null, chargeSource: null, autoDeducted: false,
                } });
            }
        }

        await db.membershipTransaction.create({
            data: {
                membershipId: tr.membershipId,
                type: 'add',
                amount: tr.amount,
                chargeAmount: isTrackedProgramMembership(tr.membership) || isRateCard(tr.membership) ? refundedCharge : null,
                reason: reason || `Возврат: ${classRecord.title}`,
                classId: classRecord.id,
                addedById
            }
        });
    }

    return { refunded: reversals.length > 0, count: reversals.length };
}

async function refundAllDeductionsForClass(classRecord, addedById, tx, reason) {
    if (!tx) return prisma.$transaction(client => refundAllDeductionsForClass(classRecord, addedById, client, reason));
    const db = tx || prisma;
    await db.$queryRaw`SELECT id FROM "Class" WHERE id = ${classRecord.id} FOR UPDATE`;

    const transactions = await db.membershipTransaction.findMany({
        where: {
            classId: classRecord.id,
            type: { in: ['deduct', 'manual_deduct'] }
        },
        include: { membership: { select: { studentId: true } } }
    });

    const studentIds = [...new Set(transactions.map(t => t.membership.studentId))];
    for (const membershipId of [...new Set(transactions.map(item => item.membershipId))].sort()) {
        await db.$queryRaw`SELECT id FROM "Membership" WHERE id = ${membershipId} FOR UPDATE`;
    }
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
