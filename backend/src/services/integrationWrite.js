const { prisma } = require('../config/db');
const { notify } = require('./notifications');
const { mapClassDetail } = require('./integrationRead');
const { isClassEnded } = require('./automation');
const { deductMembershipForClass, useEmergencyFreezeForClass } = require('./classMembership');
const { returnClassToTeacher, reopenClass, upsertClassAttendee } = require('./lessonLifecycle');
const { shouldChargeAttendance, isEmergencyFreezeAttendance } = require('./lessonBillingPolicy');
const { normalizeTrialReport, buildTrialReportDerivedFields } = require('./trialReport');

async function loadClassForTeacher(crmClassId, crmTeacherId) {
    if (!crmTeacherId) {
        return { success: false, error: 'crmTeacherId is required', status: 400 };
    }

    const cls = await prisma.class.findUnique({
        where: { id: crmClassId },
        include: {
            teacher: { select: { id: true, name: true, lastName: true, middleName: true, role: true } },
            group: { select: { id: true, name: true } },
            room: { select: { id: true, name: true } },
        },
    });

    if (!cls) {
        return { success: false, error: 'Class not found', status: 404 };
    }
    if (cls.teacherId !== crmTeacherId) {
        return { success: false, error: 'Teacher is not assigned to this class', status: 403 };
    }
    if (cls.isPractice) {
        return { success: false, error: 'Practice classes are not available via integration', status: 400 };
    }

    return { success: true, cls };
}

async function loadClass(crmClassId) {
    const cls = await prisma.class.findUnique({
        where: { id: crmClassId },
        include: {
            attendees: true,
            teacher: { select: { id: true, name: true, lastName: true, middleName: true, role: true } },
            group: { select: { id: true, name: true } },
            room: { select: { id: true, name: true } },
        },
    });

    if (!cls) {
        return { success: false, error: 'Class not found', status: 404 };
    }
    if (cls.isPractice) {
        return { success: false, error: 'Practice classes are not available via integration', status: 400 };
    }

    return { success: true, cls };
}

function appendMaterials(homeworkDraft, materials) {
    if (!Array.isArray(materials) || materials.length === 0) {
        return homeworkDraft ?? null;
    }

    const block = materials
        .map((item) => `- ${item.title || item.type || 'file'}: ${item.url || ''}`.trim())
        .join('\n');

    if (!homeworkDraft) {
        return `Материалы:\n${block}`;
    }
    return `${homeworkDraft}\n\nМатериалы:\n${block}`;
}

async function teacherStart(crmClassId, { crmTeacherId }) {
    const loaded = await loadClassForTeacher(crmClassId, crmTeacherId);
    if (!loaded.success) return loaded;

    const { cls } = loaded;

    if (cls.status === 'started') {
        return {
            success: true,
            data: {
                crmClassId,
                status: cls.status,
                class: mapClassDetail(cls),
                idempotent: true,
            },
        };
    }

    if (cls.status !== 'scheduled') {
        return { success: false, error: 'Class cannot be started in current status', status: 400 };
    }

    const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;
    const now = new Date(Date.now() + ALMATY_OFFSET_MS);
    const [hours, minutes] = cls.startTime.split(':').map(Number);
    const classStartDateTime = new Date(cls.date.getTime() + ALMATY_OFFSET_MS);
    classStartDateTime.setUTCHours(hours, minutes, 0, 0);

    const diffMinutes = (classStartDateTime.getTime() - now.getTime()) / (60 * 1000);
    if (diffMinutes > 15) {
        return {
            success: false,
            error: `Начать урок можно не ранее чем за 15 минут до его начала (запланировано в ${cls.startTime}).`,
            status: 400,
        };
    }

    const updated = await prisma.class.update({
        where: { id: crmClassId },
        data: { status: 'started', startedAt: cls.startedAt || new Date() },
        include: {
            teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
            group: { select: { id: true, name: true } },
            room: { select: { id: true, name: true } },
        },
    });

    return {
        success: true,
        data: {
            crmClassId,
            status: updated.status,
            startedAt: new Date().toISOString(),
            class: mapClassDetail(updated),
        },
    };
}

async function teacherFinish(crmClassId, { crmTeacherId, comment }) {
    const loaded = await loadClassForTeacher(crmClassId, crmTeacherId);
    if (!loaded.success) return loaded;

    const { cls } = loaded;

    if (!['started', 'scheduled'].includes(cls.status)) {
        return { success: false, error: 'Class is already closed or awaiting review', status: 400 };
    }

    const updateData = { finishedAt: cls.finishedAt || new Date() };
    if (comment) {
        updateData.teacherComment = cls.teacherComment
            ? `${cls.teacherComment}\n${comment}`
            : comment;
    }

    if (cls.status === 'scheduled') {
        updateData.status = 'started';
    }

    const updated = await prisma.class.update({
        where: { id: crmClassId },
        data: updateData,
        include: {
            teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
            group: { select: { id: true, name: true } },
            room: { select: { id: true, name: true } },
        },
    });

    return {
        success: true,
        data: {
            crmClassId,
            status: updated.status,
            finishedAt: new Date().toISOString(),
            class: mapClassDetail(updated),
        },
    };
}

async function teacherSubmit(crmClassId, payload) {
    const {
        crmTeacherId,
        topic,
        lessonGoals,
        lessonSummary,
        homeworkDraft,
        nextLessonFocus,
        materials,
        teacherOutcomeHint,
        trialReport,
        comment,
    } = payload;

    const loaded = await loadClassForTeacher(crmClassId, crmTeacherId);
    if (!loaded.success) return loaded;

    const { cls } = loaded;

    if (['completed', 'cancelled'].includes(cls.status)) {
        return { success: false, error: 'Class is already closed', status: 400 };
    }

    if (cls.status === 'pending_admin_review') {
        return {
            success: true,
            data: {
                crmClassId,
                status: cls.status,
                class: mapClassDetail(cls),
                idempotent: true,
            },
        };
    }

    const normalizedTrialReport = cls.classType === 'trial' && trialReport !== undefined
        ? normalizeTrialReport(trialReport, cls)
        : null;
    const trialDerived = normalizedTrialReport ? buildTrialReportDerivedFields(normalizedTrialReport) : {};
    const finalTopic = topic ?? trialDerived.topic;
    const finalLessonSummary = lessonSummary ?? trialDerived.lessonSummary;
    const finalHomeworkDraft = homeworkDraft ?? trialDerived.homeworkDraft;
    const finalNextLessonFocus = nextLessonFocus ?? trialDerived.nextLessonFocus;
    const finalTeacherComment = comment ?? trialDerived.teacherComment;

    if (!finalTopic?.trim()) {
        return { success: false, error: 'Topic is required before submission', status: 400 };
    }
    if (!finalLessonSummary?.trim()) {
        return { success: false, error: 'Lesson summary is required before submission', status: 400 };
    }

    const updated = await prisma.class.update({
        where: { id: crmClassId },
        data: {
            topic: finalTopic ?? cls.topic,
            lessonGoals: lessonGoals ?? cls.lessonGoals,
            lessonSummary: finalLessonSummary ?? cls.lessonSummary,
            homeworkDraft: finalHomeworkDraft ?? cls.homeworkDraft,
            nextLessonFocus: finalNextLessonFocus ?? cls.nextLessonFocus,
            materials: materials ?? cls.materials,
            teacherComment: finalTeacherComment ?? cls.teacherComment,
            trialReport: normalizedTrialReport || cls.trialReport,
            teacherOutcomeHint: teacherOutcomeHint ?? cls.teacherOutcomeHint ?? 'held',
            finishedAt: cls.finishedAt || new Date(),
            submittedAt: new Date(),
            submittedById: crmTeacherId,
            status: 'pending_admin_review',
        },
        include: {
            teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
            group: { select: { id: true, name: true } },
            room: { select: { id: true, name: true } },
        },
    });

    notify('lesson.pending_review', { classRecord: updated }).catch(() => {});

    return {
        success: true,
        data: {
            crmClassId,
            status: updated.status,
            submittedAt: updated.submittedAt,
            class: mapClassDetail(updated),
        },
    };
}

async function teacherMarkNotHeld(crmClassId, { crmTeacherId, comment }) {
    const loaded = await loadClassForTeacher(crmClassId, crmTeacherId);
    if (!loaded.success) return loaded;

    const { cls } = loaded;

    if (['completed', 'cancelled'].includes(cls.status)) {
        return { success: false, error: 'Class is already closed', status: 400 };
    }

    if (cls.status === 'pending_admin_review' && cls.teacherOutcomeHint === 'not_held') {
        return {
            success: true,
            data: {
                crmClassId,
                status: cls.status,
                class: mapClassDetail(cls),
                idempotent: true,
            },
        };
    }

    const updated = await prisma.class.update({
        where: { id: crmClassId },
        data: {
            teacherOutcomeHint: 'not_held',
            teacherComment: comment ?? cls.teacherComment,
            status: 'pending_admin_review',
            submittedAt: new Date(),
            submittedById: crmTeacherId,
        },
        include: {
            teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
            group: { select: { id: true, name: true } },
            room: { select: { id: true, name: true } },
        },
    });

    notify('lesson.pending_review', { classRecord: updated }).catch(() => {});

    return {
        success: true,
        data: {
            crmClassId,
            status: updated.status,
            teacherOutcomeHint: updated.teacherOutcomeHint,
            class: mapClassDetail(updated),
        },
    };
}

async function teacherWithdraw(crmClassId, { crmTeacherId, reason }) {
    const loaded = await loadClassForTeacher(crmClassId, crmTeacherId);
    if (!loaded.success) return loaded;
    return returnClassToTeacher(
        crmClassId,
        crmTeacherId,
        reason || 'Преподаватель отозвал урок для исправления',
    );
}

async function teacherSetAttendance(crmClassId, { crmTeacherId, studentId, attended, attendanceStatus, teacherNote }) {
    if (!studentId) {
        return { success: false, error: 'studentId is required', status: 400 };
    }

    return prisma.$transaction(async (tx) => {
        const lockedClasses = await tx.$queryRaw`
            SELECT * FROM "Class" WHERE id = ${crmClassId} FOR UPDATE
        `;
        const cls = lockedClasses[0];
        if (!cls) {
            return { success: false, error: 'Class not found', status: 404 };
        }
        if (cls.teacherId !== crmTeacherId) {
            return { success: false, error: 'Teacher is not assigned to this class', status: 403 };
        }
        if (cls.isPractice) {
            return { success: false, error: 'Practice classes are not available via integration', status: 400 };
        }
        if (['completed', 'cancelled'].includes(cls.status)) {
            return { success: false, error: 'Class is already closed', status: 400 };
        }

        const allowedStatuses = ['unmarked', 'present', 'late', 'excused_absence', 'unexcused_absence', 'emergency_freeze'];
        const normalizedStatus = allowedStatuses.includes(attendanceStatus)
            ? attendanceStatus
            : (attended ? 'present' : 'unmarked');
        const isAttended = ['present', 'late'].includes(normalizedStatus);

        const attendeeData = {
            attended: isAttended,
            attendanceStatus: normalizedStatus,
            markedAt: normalizedStatus === 'unmarked' ? null : new Date(),
        };
        if (teacherNote !== undefined) {
            attendeeData.teacherNote = teacherNote;
        }

        const attendee = await upsertClassAttendee(crmClassId, studentId, attendeeData, tx);

        const updateData = {};
        if (cls.noOneAttended || cls.teacherOutcomeHint === 'not_held') {
            updateData.noOneAttended = false;
            updateData.teacherOutcomeHint = 'held';
        }

        if (isClassEnded(cls) && !cls.isPractice) {
            if (['scheduled', 'started', 'not_filled'].includes(cls.status)) {
                updateData.status = 'pending_admin_review';
            }
        }

        const updated = Object.keys(updateData).length
            ? await tx.class.update({
                  where: { id: crmClassId },
                  data: updateData,
                  include: {
                      teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                      group: { select: { id: true, name: true } },
                      room: { select: { id: true, name: true } },
                  },
              })
            : await tx.class.findUnique({
                  where: { id: crmClassId },
                  include: {
                      teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                      group: { select: { id: true, name: true } },
                      room: { select: { id: true, name: true } },
                  },
              });

        return {
            success: true,
            data: {
                crmClassId,
                studentId,
                attended: isAttended,
                attendanceStatus: normalizedStatus,
                attendeeId: attendee?.id ?? null,
                status: updated.status,
                class: mapClassDetail(updated),
            },
        };
    });
}

async function adminSetAttendance(crmClassId, { studentId, attended, attendanceStatus, teacherNote }) {
    if (!studentId) {
        return { success: false, error: 'studentId is required', status: 400 };
    }

    return prisma.$transaction(async (tx) => {
        const lockedClasses = await tx.$queryRaw`
            SELECT * FROM "Class" WHERE id = ${crmClassId} FOR UPDATE
        `;
        const cls = lockedClasses[0];
        if (!cls) {
            return { success: false, error: 'Class not found', status: 404 };
        }
        if (cls.isPractice) {
            return { success: false, error: 'Practice classes are not available via integration', status: 400 };
        }
        if (['completed', 'cancelled'].includes(cls.status)) {
            return { success: false, error: 'Class is already closed', status: 400 };
        }

        const allowedStatuses = ['unmarked', 'present', 'late', 'excused_absence', 'unexcused_absence', 'emergency_freeze'];
        const normalizedStatus = allowedStatuses.includes(attendanceStatus)
            ? attendanceStatus
            : (attended ? 'present' : 'unmarked');
        const isAttended = ['present', 'late'].includes(normalizedStatus);

        const attendeeData = {
            attended: isAttended,
            attendanceStatus: normalizedStatus,
            markedAt: normalizedStatus === 'unmarked' ? null : new Date(),
        };
        if (teacherNote !== undefined) {
            attendeeData.teacherNote = teacherNote;
        }

        const attendee = await upsertClassAttendee(crmClassId, studentId, attendeeData, tx);

        const updateData = {};
        if (cls.noOneAttended || cls.teacherOutcomeHint === 'not_held') {
            updateData.noOneAttended = false;
            updateData.teacherOutcomeHint = 'held';
        }

        const updated = Object.keys(updateData).length
            ? await tx.class.update({
                  where: { id: crmClassId },
                  data: updateData,
                  include: {
                      teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                      group: { select: { id: true, name: true } },
                      room: { select: { id: true, name: true } },
                  },
              })
            : await tx.class.findUnique({
                  where: { id: crmClassId },
                  include: {
                      teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                      group: { select: { id: true, name: true } },
                      room: { select: { id: true, name: true } },
                  },
              });

        return {
            success: true,
            data: {
                crmClassId,
                studentId,
                attended: isAttended,
                attendanceStatus: normalizedStatus,
                attendeeId: attendee?.id ?? null,
                status: updated.status,
                class: mapClassDetail(updated),
            },
        };
    });
}

async function adminApproveClass(crmClassId, payload = {}) {
    const {
        deduct = true,
        billingDecisions = [],
        topic,
        lessonGoals,
        lessonSummary,
        homeworkDraft,
        nextLessonFocus,
        materials,
        teacherComment,
    } = payload;

    const deductions = [];

    const result = await prisma.$transaction(async (tx) => {
        const lockedClasses = await tx.$queryRaw`
            SELECT * FROM "Class" WHERE id = ${crmClassId} FOR UPDATE
        `;
        const classRecord = lockedClasses[0];
        if (!classRecord) {
            throw new Error('CLASS_NOT_FOUND');
        }

        if (classRecord.status === 'completed') {
            throw new Error('CLASS_ALREADY_COMPLETED');
        }
        if (classRecord.status !== 'pending_admin_review') {
            throw new Error('CLASS_NOT_READY');
        }

        const finalTopic = topic !== undefined ? topic : classRecord.topic;
        const finalSummary = lessonSummary !== undefined ? lessonSummary : classRecord.lessonSummary;
        if (classRecord.teacherOutcomeHint !== 'not_held' && (!finalTopic?.trim() || !finalSummary?.trim())) {
            throw new Error('MISSING_TOPIC_OR_SUMMARY');
        }

        const attendees = await tx.classAttendee.findMany({
            where: { classId: crmClassId }
        });

        if (deduct && !classRecord.noOneAttended) {
            const toProcess = attendees.filter((a) => (
                a.studentId
                && (shouldChargeAttendance(a.attendanceStatus) || isEmergencyFreezeAttendance(a.attendanceStatus))
            ));
            const decisionsByStudent = new Map(
                Array.isArray(billingDecisions)
                    ? billingDecisions.map((item) => [item.studentId, item])
                    : [],
            );

            const missingDecision = toProcess.find((attendee) => !decisionsByStudent.has(attendee.studentId));
            if (missingDecision) {
                const error = new Error('MISSING_DECISION');
                error.studentId = missingDecision.studentId;
                throw error;
            }

            for (const attendee of toProcess) {
                const decision = decisionsByStudent.get(attendee.studentId);
                const membershipId = decision.membershipId || null;
                const amount = Math.max(0, Math.round(Number(decision.amount) || 0));
                let result = { deducted: false, reason: 'no_membership_selected' };

                if (isEmergencyFreezeAttendance(attendee.attendanceStatus)) {
                    const freezeResult = await useEmergencyFreezeForClass(
                        attendee.studentId,
                        classRecord,
                        null,
                        tx,
                        membershipId,
                    );
                    if (!freezeResult.frozen) {
                        throw new Error(`Не удалось списать заморозку ученика ${attendee.studentId}: ${freezeResult.reason}`);
                    }
                    await tx.classAttendee.update({
                        where: { id: attendee.id },
                        data: {
                            chargeAmount: 0,
                            chargedMembershipId: freezeResult.membershipId,
                            chargeSource: 'emergency_freeze',
                            autoDeducted: false,
                        },
                    });
                    deductions.push({
                        studentId: attendee.studentId,
                        amount: 0,
                        balanceAfter: null,
                        debtCreated: false,
                        freezeUsed: true,
                        ...freezeResult,
                    });
                    continue;
                }

                if (membershipId) {
                    result = await deductMembershipForClass(
                        attendee.studentId,
                        classRecord,
                        null,
                        tx,
                        membershipId,
                    );
                    if (!result.deducted) {
                        throw new Error(`Не удалось списать выбранный абонемент ученика ${attendee.studentId}`);
                    }
                }

                const student = await tx.student.update({
                    where: { id: attendee.studentId },
                    data: { accountBalance: { decrement: amount } },
                    select: { accountBalance: true },
                });

                await tx.classAttendee.update({
                    where: { id: attendee.id },
                    data: {
                        chargeAmount: amount,
                        chargedMembershipId: membershipId,
                        chargeSource: membershipId ? 'membership' : 'balance_only',
                        autoDeducted: Boolean(result.deducted),
                    },
                });

                deductions.push({
                    studentId: attendee.studentId,
                    amount,
                    balanceAfter: student.accountBalance,
                    debtCreated: student.accountBalance < 0,
                    ...result,
                });
            }
        }

        const updatePayload = {
            status: 'completed',
            reviewedAt: new Date(),
            reviewedById: null,
            autoDeductionDone: deductions.some((d) => d.deducted),
        };

        if (topic !== undefined) updatePayload.topic = topic;
        if (lessonGoals !== undefined) updatePayload.lessonGoals = lessonGoals;
        if (lessonSummary !== undefined) updatePayload.lessonSummary = lessonSummary;
        if (homeworkDraft !== undefined) updatePayload.homeworkDraft = homeworkDraft;
        if (nextLessonFocus !== undefined) updatePayload.nextLessonFocus = nextLessonFocus;
        if (materials !== undefined) updatePayload.materials = materials;
        if (teacherComment !== undefined) updatePayload.teacherComment = teacherComment;

        const updated = await tx.class.update({
            where: { id: crmClassId },
            data: updatePayload,
            include: {
                teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                group: { select: { id: true, name: true } },
                room: { select: { id: true, name: true } },
            },
        });

        return { updated, deductions };
    }).catch(err => {
        return { error: err };
    });

    if (result.error) {
        const error = result.error;
        if (error.message === 'CLASS_NOT_FOUND') {
            return { success: false, error: 'Урок не найден', status: 404 };
        }
        if (error.message === 'CLASS_ALREADY_COMPLETED') {
            return { success: false, error: 'Урок уже подтверждён', status: 400 };
        }
        if (error.message === 'CLASS_NOT_READY') {
            return { success: false, error: 'Сначала преподаватель должен отправить урок на подтверждение', status: 400 };
        }
        if (error.message === 'MISSING_TOPIC_OR_SUMMARY') {
            return { success: false, error: 'Для подтверждения заполните тему и итог урока', status: 400 };
        }
        if (error.message === 'MISSING_DECISION') {
            return {
                success: false,
                error: 'Перед подтверждением выберите абонемент и сумму списания для каждого присутствовавшего ученика',
                status: 400,
            };
        }
        return { success: false, error: error.message || 'Ошибка подтверждения урока', status: 500 };
    }

    const { updated } = result;

    notify('lesson.approved', { classRecord: updated, deductions }).catch(() => {});

    return {
        success: true,
        data: {
            crmClassId,
            status: updated.status,
            class: mapClassDetail(updated),
            deductions,
        },
    };
}

module.exports = {
    teacherStart,
    teacherFinish,
    teacherSubmit,
    teacherMarkNotHeld,
    teacherWithdraw,
    teacherSetAttendance,
    adminSetAttendance,
    adminApproveClass,
    returnClassToTeacher,
    reopenClass,
};
