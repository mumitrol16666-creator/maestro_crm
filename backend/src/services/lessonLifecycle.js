const { prisma } = require('../config/db');
const { isRateCard } = require('./rateCards');
const { outstandingClassCharges } = require('./classChargeLedger');
const { outstandingClassFreezes, freezeLedgerConflict } = require('./classFreezeLedger');
const { syncOfflineLessonEventToLearningPlatform } = require('./learningPlatformNotifications');
const {
    acquireClassScheduleLocks,
    findClassScheduleConflict,
} = require('./classScheduleGuard');

async function reverseClassCharges(classRecord, actorId, tx) {
    const attendees = await tx.classAttendee.findMany({
        where: { classId: classRecord.id },
    });
    const reversals = [];
    const membershipTransactions = await tx.membershipTransaction.findMany({
        where: { classId: classRecord.id, type: { in: ['deduct', 'manual_deduct', 'add', 'freeze_used', 'freeze_restored'] } },
        include: { membership: true },
    });
    const studentIds = [...attendees.map(item => item.studentId), ...membershipTransactions.map(item => item.membership.studentId)];
    for (const studentId of [...new Set(studentIds.filter(Boolean))].sort()) {
        await tx.$queryRaw`SELECT id FROM "Student" WHERE id = ${studentId} FOR UPDATE`;
    }
    // Approval locks membership before cash. Keep the same order during undo,
    // including freeze-only memberships and historical participants.
    const lockedMemberships = new Map();
    for (const membershipId of [...new Set(membershipTransactions.map(item => item.membershipId))].sort()) {
        const rows = await tx.$queryRaw`SELECT * FROM "Membership" WHERE id = ${membershipId} FOR UPDATE`;
        if (rows[0]) lockedMemberships.set(membershipId, rows[0]);
    }

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

    for (const { membershipId, amount, chargeAmount: refundedCharge } of outstandingClassCharges(membershipTransactions)) {
        const membership = lockedMemberships.get(membershipId);
        if (!membership) continue;
        const updateData = {
            classesRemaining: { increment: amount },
            classesUsed: { decrement: amount },
            ...(membership.lessonFormat === 'program' && membership.status === 'expired'
                && new Date(membership.endDate) >= new Date() ? { status: 'active' } : {}),
        };
        if (classRecord.classType === 'individual' && membership.individualBudgetRemaining != null) {
            updateData.individualBudgetRemaining = { increment: refundedCharge };
        }
        if (membership.individualClassesRemaining !== null) {
            if (classRecord.classType === 'individual') {
                updateData.individualClassesRemaining = { increment: amount };
            } else if (classRecord.classType === 'group') {
                updateData.groupClassesRemaining = { increment: amount };
            } else if (classRecord.classType === 'theory') {
                updateData.theoryClassesRemaining = { increment: amount };
            }
        }
        if (amount > 0 && !isRateCard(membership)) await tx.membership.update({ where: { id: membershipId }, data: updateData });
        await tx.membershipTransaction.create({
            data: {
                membershipId,
                type: 'add',
                amount,
                chargeAmount: membership.lessonFormat === 'program' || isRateCard(membership) ? refundedCharge : null,
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
            type: { in: ['freeze_used', 'freeze_restored'] },
        },
    });

    let restored = 0;
    for (const { membershipId, count } of outstandingClassFreezes(transactions)) {
        // reverseClassCharges already locked all affected memberships in order.
        const membership = await tx.membership.findUnique({ where: { id: membershipId } });
        const available = membership?.emergencyFreezesAvailable ?? 0;
        const used = membership?.emergencyFreezesUsed ?? 0;
        if (!membership || available < 0 || used < count) throw freezeLedgerConflict();
        await tx.membership.update({
            where: { id: membershipId },
            data: {
                emergencyFreezesAvailable: available + count,
                emergencyFreezesUsed: used - count,
            },
        });
        await tx.membershipTransaction.createMany({
            data: Array.from({ length: count }, () => ({
                membershipId,
                type: 'freeze_restored',
                amount: 0,
                reason: `Возврат экстренной отмены при восстановлении урока: ${classRecord.title}`,
                classId: classRecord.id,
                addedById: actorId || null,
            })),
        });
        restored += count;
    }

    return restored;
}

async function returnClassToTeacher(classId, actorId, reason) {
    const result = await prisma.$transaction(async (tx) => {
        // Lock row for update
        const classRecords = await tx.$queryRaw`
            SELECT * FROM "Class" WHERE id = ${classId} FOR UPDATE
        `;
        const classRecord = classRecords[0];
        
        if (!classRecord) return { success: false, status: 404, error: 'Урок не найден' };
        if (classRecord.status !== 'pending_admin_review') {
            return { success: false, status: 400, error: 'Вернуть преподавателю можно только урок на подтверждении' };
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const isFuture = new Date(classRecord.date) > today;
        const targetStatus = isFuture ? 'scheduled' : 'started';

        const item = await tx.class.update({
            where: { id: classId },
            data: {
                status: targetStatus,
                teacherOutcomeHint: classRecord.teacherOutcomeHint === 'not_held' ? null : classRecord.teacherOutcomeHint,
                noOneAttended: false,
                submittedAt: null,
                submittedById: null,
                reviewedAt: null,
                reviewedById: null,
                teacherBaseEarning: 0,
                teacherEarningStatus: 'pending',
                teacherEarningCalculatedAt: null,
            },
        });
        if (isFuture) {
            await tx.classAttendee.updateMany({
                where: { classId },
                data: { attended: false, attendanceStatus: 'unmarked', markedAt: null },
            });
        }
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
        const attendees = await tx.classAttendee.findMany({
            where: { classId },
            select: { studentId: true },
        });
        return {
            success: true,
            data: { crmClassId: classId, status: item.status, class: { ...classRecord, ...item } },
            studentIds: attendees.map((attendee) => attendee.studentId).filter(Boolean),
        };
    });

    if (result.success) {
        syncOfflineLessonEventToLearningPlatform(
            'returned',
            result.data?.class || {},
            result.studentIds,
            reason,
        ).catch((error) => console.error('[notifications] offline return sync failed:', error.message));
    }
    return result;
}

async function reopenClass(classId, actorId, reason, correction = null) {
    const result = await prisma.$transaction(async (tx) => {
        await acquireClassScheduleLocks(tx, [{ classId }]);
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

        if (previousStatus === 'cancelled') {
            await acquireClassScheduleLocks(tx, [classRecord]);
            const conflict = await findClassScheduleConflict(tx, {
                ...classRecord,
                excludeClassId: classId,
            });
            if (conflict) {
                return {
                    success: false,
                    status: 409,
                    error: `Нельзя открыть урок повторно: время ${conflict.startTime}–${conflict.endTime} уже занято`,
                    conflict: {
                        classId: conflict.id,
                        title: conflict.title,
                        startTime: conflict.startTime,
                        endTime: conflict.endTime,
                    },
                };
            }
        }

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
                teacherBaseEarning: 0,
                teacherEarningStatus: 'pending',
                teacherEarningCalculatedAt: null,
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
                    metadata: {
                        reason: reason || null,
                        previousStatus,
                        targetStatus,
                        reversals,
                        restoredFreezes,
                        correction: correction && typeof correction === 'object'
                            ? {
                                reportId: correction.reportId || null,
                                reportVersion: correction.reportVersion || null,
                                reason: correction.reason || reason || null,
                            }
                            : null,
                    },
                },
            });
        }

        const completedAt = new Date();
        await tx.integrationLog.create({
            data: {
                direction: 'inbound',
                system: 'learning-platform',
                operation: 'offline_lesson.reopen',
                method: 'POST',
                path: `/api/integration/v1/classes/${classId}/reopen`,
                status: 'success',
                responseStatus: 200,
                requestBody: {
                    reason: reason || null,
                    correction: correction && typeof correction === 'object'
                        ? {
                            reportId: correction.reportId || null,
                            reportVersion: correction.reportVersion || null,
                            reason: correction.reason || reason || null,
                        }
                        : null,
                },
                responseBody: {
                    previousStatus,
                    targetStatus,
                    reversals,
                    restoredFreezes,
                },
                attempts: 1,
                retryable: false,
                lastAttemptAt: completedAt,
                completedAt,
                entityType: 'Class',
                entityId: classId,
                createdById: actorId || null,
                idempotencyKey: correction?.reportVersion
                    ? `lesson-correction:${classId}:v${correction.reportVersion}`
                    : null,
            },
        });
        
        const attendees = await tx.classAttendee.findMany({
            where: { classId },
            select: { studentId: true },
        });

        return {
            success: true,
            data: {
                crmClassId: classId,
                status: updated.status,
                class: { ...classRecord, ...updated },
                previousStatus,
                reversals,
                restoredFreezes,
            },
            studentIds: attendees.map((attendee) => attendee.studentId).filter(Boolean),
        };
    }).catch(error => {
        // Catch outside the transaction: cash refunds must roll back as well.
        if (error.code !== 'EMERGENCY_FREEZE_LEDGER_CONFLICT') throw error;
        return { success: false, status: 409, code: error.code, error: error.message };
    });

    if (result.success) {
        syncOfflineLessonEventToLearningPlatform(
            result.data?.previousStatus === 'completed' ? 'returned' : 'rescheduled',
            result.data?.class || {},
            result.studentIds,
            reason,
        ).catch((error) => console.error('[notifications] offline reopen sync failed:', error.message));
    }
    return result;
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
