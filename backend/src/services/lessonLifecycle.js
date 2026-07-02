const { prisma } = require('../config/db');

async function reverseClassCharges(classRecord, actorId, tx) {
    const attendees = await tx.classAttendee.findMany({
        where: { classId: classRecord.id },
    });
    const reversals = [];

    for (const attendee of attendees) {
        if (!attendee.studentId) continue;

        if (attendee.chargeAmount > 0) {
            const student = await tx.student.update({
                where: { id: attendee.studentId },
                data: { accountBalance: { increment: attendee.chargeAmount } },
                select: { accountBalance: true },
            });
            reversals.push({
                studentId: attendee.studentId,
                type: 'balance',
                amount: attendee.chargeAmount,
                balanceAfter: student.accountBalance,
            });
        }

        await tx.classAttendee.update({
            where: { id: attendee.id },
            data: {
                chargeAmount: 0,
                chargedMembershipId: null,
                chargeSource: null,
                autoDeducted: false,
            },
        });
    }

    const membershipTransactions = await tx.membershipTransaction.findMany({
        where: {
            classId: classRecord.id,
            type: { in: ['deduct', 'manual_deduct', 'add'] },
        },
        include: { membership: true },
    });
    const netByMembership = new Map();
    for (const transaction of membershipTransactions) {
        const direction = transaction.type === 'add' ? -1 : 1;
        netByMembership.set(
            transaction.membershipId,
            (netByMembership.get(transaction.membershipId) || 0) + direction * transaction.amount,
        );
    }

    for (const [membershipId, amount] of netByMembership.entries()) {
        if (amount <= 0) continue;
        const membership = membershipTransactions.find((item) => item.membershipId === membershipId)?.membership;
        if (!membership) continue;
        const updateData = {
            classesRemaining: { increment: amount },
            classesUsed: { decrement: amount },
        };
        if (membership.individualClassesRemaining !== null) {
            if (classRecord.classType === 'individual') {
                updateData.individualClassesRemaining = { increment: amount };
            } else if (classRecord.classType === 'group') {
                updateData.groupClassesRemaining = { increment: amount };
            } else if (classRecord.classType === 'theory') {
                updateData.theoryClassesRemaining = { increment: amount };
            }
        }
        await tx.membership.update({ where: { id: membershipId }, data: updateData });
        await tx.membershipTransaction.create({
            data: {
                membershipId,
                type: 'add',
                amount,
                reason: `Откат подтверждения урока: ${classRecord.title}`,
                classId: classRecord.id,
                addedById: actorId || null,
            },
        });
        reversals.push({
            studentId: membership.studentId,
            type: 'membership',
            membershipId,
            amount,
        });
    }

    return reversals;
}

async function restoreEmergencyFreezes(classRecord, actorId, tx) {
    const transactions = await tx.membershipTransaction.findMany({
        where: {
            classId: classRecord.id,
            type: 'freeze_used',
        },
        include: { membership: true },
    });

    for (const transaction of transactions) {
        if ((transaction.membership.emergencyFreezesUsed || 0) <= 0) continue;
        await tx.membership.update({
            where: { id: transaction.membershipId },
            data: {
                emergencyFreezesAvailable: { increment: 1 },
                emergencyFreezesUsed: { decrement: 1 },
            },
        });
        await tx.membershipTransaction.create({
            data: {
                membershipId: transaction.membershipId,
                type: 'freeze_restored',
                amount: 0,
                reason: `Возврат экстренной заморозки при восстановлении урока: ${classRecord.title}`,
                classId: classRecord.id,
                addedById: actorId || null,
            },
        });
    }

    return transactions.length;
}

async function returnClassToTeacher(classId, actorId, reason) {
    return prisma.$transaction(async (tx) => {
        // Lock row for update
        const classRecords = await tx.$queryRaw`
            SELECT * FROM "Class" WHERE id = ${classId} FOR UPDATE
        `;
        const classRecord = classRecords[0];
        
        if (!classRecord) return { success: false, status: 404, error: 'Урок не найден' };
        if (classRecord.status !== 'pending_admin_review') {
            return { success: false, status: 400, error: 'Вернуть преподавателю можно только урок на подтверждении' };
        }

        const item = await tx.class.update({
            where: { id: classId },
            data: {
                status: 'started',
                teacherOutcomeHint: classRecord.teacherOutcomeHint === 'not_held' ? null : classRecord.teacherOutcomeHint,
                noOneAttended: false,
                submittedAt: null,
                submittedById: null,
                reviewedAt: null,
                reviewedById: null,
            },
        });
        if (actorId) {
            await tx.activityLog.create({
                data: {
                    userId: actorId,
                    action: 'lesson_returned_to_teacher',
                    entityType: 'Class',
                    entityId: classId,
                    details: `Урок возвращён преподавателю: ${classRecord.title}`,
                    metadata: { reason: reason || null, previousStatus: classRecord.status },
                },
            });
        }
        return { success: true, data: { crmClassId: classId, status: item.status, class: item } };
    });
}

async function reopenClass(classId, actorId, reason) {
    return prisma.$transaction(async (tx) => {
        // Lock row for update
        const classRecords = await tx.$queryRaw`
            SELECT * FROM "Class" WHERE id = ${classId} FOR UPDATE
        `;
        const classRecord = classRecords[0];

        if (!classRecord) return { success: false, status: 404, error: 'Урок не найден' };
        if (!['completed', 'cancelled'].includes(classRecord.status)) {
            return { success: false, status: 400, error: 'Пересмотреть можно только подтверждённый или отменённый урок' };
        }

        const previousStatus = classRecord.status;
        const targetStatus = previousStatus === 'completed' ? 'pending_admin_review' : 'scheduled';

        const reversals = await reverseClassCharges(classRecord, actorId, tx);
        const restoredFreezes = await restoreEmergencyFreezes(classRecord, actorId, tx);
        const updated = await tx.class.update({
            where: { id: classId },
            data: {
                status: targetStatus,
                reviewedAt: null,
                reviewedById: null,
                autoDeductionDone: false,
                noOneAttended: previousStatus === 'cancelled' ? false : classRecord.noOneAttended,
                teacherOutcomeHint: previousStatus === 'cancelled' ? null : classRecord.teacherOutcomeHint,
                submittedAt: previousStatus === 'cancelled' ? null : classRecord.submittedAt,
                submittedById: previousStatus === 'cancelled' ? null : classRecord.submittedById,
            },
        });
        if (actorId) {
            await tx.activityLog.create({
                data: {
                    userId: actorId,
                    action: 'lesson_reopened',
                    entityType: 'Class',
                    entityId: classId,
                    details: `Урок открыт повторно: ${classRecord.title}`,
                    metadata: { reason: reason || null, previousStatus, targetStatus, reversals, restoredFreezes },
                },
            });
        }
        
        return {
            success: true,
            data: {
                crmClassId: classId,
                status: updated.status,
                class: updated,
                reversals,
                restoredFreezes,
            },
        };
    });
}

async function upsertClassAttendee(classId, studentId, data, tx) {
    const db = tx || prisma;
    const existing = await db.classAttendee.findMany({
        where: { classId, studentId },
        orderBy: { id: 'asc' }
    });

    if (existing.length > 1) {
        await db.classAttendee.deleteMany({
            where: {
                id: { in: existing.slice(1).map(item => item.id) }
            }
        });
    }

    if (existing.length > 0) {
        const updateData = { ...data };
        if (updateData.teacherNote === undefined && existing[0].teacherNote !== undefined) {
            updateData.teacherNote = existing[0].teacherNote;
        }
        return db.classAttendee.update({
            where: { id: existing[0].id },
            data: updateData
        });
    }

    return db.classAttendee.create({
        data: { classId, studentId, ...data }
    });
}

module.exports = { returnClassToTeacher, reopenClass, upsertClassAttendee };
