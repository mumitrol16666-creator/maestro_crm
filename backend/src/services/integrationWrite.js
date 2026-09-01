const { prisma } = require('../config/db');
const { notify } = require('./notifications');
const { mapClassDetail } = require('./integrationRead');
const {
    isClassEnded,
    isClassReportSubmittable,
    REPORT_SUBMISSION_LEAD_MINUTES,
} = require('./automation');
const { deductMembershipForClass, useEmergencyFreezeForClass } = require('./classMembership');
const { returnClassToTeacher, reopenClass, upsertClassAttendee } = require('./lessonLifecycle');
const {
    shouldChargeAttendance,
    isEmergencyFreezeAttendance,
    validateLessonReportApproval,
} = require('./lessonBillingPolicy');
const { normalizeTrialReport, buildTrialReportDerivedFields } = require('./trialReport');
const {
    syncClassPayrollSnapshot,
    reconcileLockedClassPayrollAdjustment,
} = require('./payroll');
const { loadLessonRosterState, validateLessonSubmission } = require('./lessonSubmissionPolicy');
const { getTrialParticipantId, isTrialParticipantId } = require('./trialParticipant');
const { findTrialBookingForClass, isVirtualTrialClass } = require('./trialClass');
const { validateReviewedHomeworkClass } = require('./homeworkSource');

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
    if (cls.status === 'scheduled' && !isClassEnded(cls)) {
        return {
            success: false,
            error: 'Завершить урок можно после его окончания или после фактического запуска',
            status: 400,
        };
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
    const trialBooking = cls.classType === 'trial'
        ? { id: 'class-type-trial' }
        : await findTrialBookingForClass(prisma, cls.id);
    const isTrial = Boolean(cls.classType === 'trial' || trialBooking);
    const normalizedTrialReport = isTrial && trialReport !== undefined
        ? normalizeTrialReport(trialReport, cls, { teacherOnly: true })
        : null;
    const trialDerived = normalizedTrialReport ? buildTrialReportDerivedFields(normalizedTrialReport) : {};
    const finalTopic = topic ?? trialDerived.topic ?? cls.topic;
    const finalLessonSummary = lessonSummary ?? trialDerived.lessonSummary ?? cls.lessonSummary;
    const finalHomeworkDraft = homeworkDraft ?? trialDerived.homeworkDraft ?? cls.homeworkDraft;
    const finalNextLessonFocus = nextLessonFocus ?? trialDerived.nextLessonFocus ?? cls.nextLessonFocus;
    const finalTeacherComment = comment ?? trialDerived.teacherComment ?? cls.teacherComment;

    const rosterState = await loadLessonRosterState(prisma, cls);
    const submission = validateLessonSubmission({
        rosterState,
        topic: finalTopic,
        lessonSummary: finalLessonSummary,
    });
    if (!submission.success) {
        return { success: false, error: submission.error, status: 400, code: submission.code };
    }

    if (submission.requiresReport && !isClassReportSubmittable(cls)) {
        return {
            success: false,
            error: `Полный отчёт можно отправить за ${REPORT_SUBMISSION_LEAD_MINUTES} минут до окончания урока`,
            status: 400,
            code: 'REPORT_SUBMISSION_TOO_EARLY',
        };
    }
    if (!submission.requiresReport && !isClassEnded(cls)) {
        return {
            success: false,
            error: 'Передать отметку об отсутствии можно после окончания урока',
            status: 400,
            code: 'ATTENDANCE_SUBMISSION_TOO_EARLY',
        };
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

    const updated = await prisma.class.update({
        where: { id: crmClassId },
        data: {
            topic: submission.requiresReport ? finalTopic : null,
            lessonGoals: submission.requiresReport ? (lessonGoals ?? cls.lessonGoals) : null,
            lessonSummary: submission.requiresReport ? finalLessonSummary : null,
            homeworkDraft: submission.requiresReport ? (finalHomeworkDraft ?? cls.homeworkDraft) : null,
            nextLessonFocus: submission.requiresReport ? (finalNextLessonFocus ?? cls.nextLessonFocus) : null,
            materials: submission.requiresReport ? (materials ?? cls.materials) : undefined,
            teacherComment: finalTeacherComment ?? cls.teacherComment,
            trialReport: submission.requiresReport ? (normalizedTrialReport || cls.trialReport) : undefined,
            teacherOutcomeHint: submission.outcome,
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
    if (!isClassEnded(cls)) {
        return {
            success: false,
            error: 'Отметить несостоявшийся урок можно после его окончания',
            status: 400,
        };
    }
    if (!comment?.trim() || comment.trim().length < 3) {
        return { success: false, error: 'Коротко укажите, почему урок не состоялся', status: 400 };
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
            teacherComment: comment.trim(),
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

async function resolveReviewedHomeworkClass(tx, currentClass, studentId, homeworkReview) {
    if (!homeworkReview || typeof homeworkReview !== 'object') {
        return { success: true, sourceClassId: undefined };
    }

    const sourceClassId = String(homeworkReview.sourceCrmClassId || '').trim() || null;
    if (!sourceClassId) return { success: true, sourceClassId: null };

    const sourceClass = await tx.class.findUnique({
        where: { id: sourceClassId },
        select: {
            id: true,
            groupId: true,
            individualStudentId: true,
            status: true,
            date: true,
            startTime: true,
            homeworkDraft: true,
            attendees: {
                where: studentId ? { studentId } : undefined,
                select: { studentId: true },
            },
        },
    });
    const error = validateReviewedHomeworkClass(currentClass, sourceClass, studentId);
    if (error) return { success: false, error, status: 400 };
    return { success: true, sourceClassId };
}

async function teacherSetAttendance(crmClassId, { crmTeacherId, studentId, attended, attendanceStatus, teacherNote, homeworkReview }) {
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

        const trialBooking = cls.classType === 'trial'
            ? { id: 'class-type-trial' }
            : await findTrialBookingForClass(tx, cls.id);
        const isVirtualTrial = isVirtualTrialClass(cls, trialBooking);
        if (!studentId && !isVirtualTrial) {
            return { success: false, error: 'studentId is required', status: 400 };
        }
        if (isVirtualTrial && studentId && !isTrialParticipantId(studentId, cls.id)) {
            return { success: false, error: 'Для пробного без карточки ученика используйте участника заявки', status: 400 };
        }
        const normalizedStudentId = isVirtualTrial ? null : (studentId || null);

        const homeworkSource = await resolveReviewedHomeworkClass(
            tx,
            cls,
            normalizedStudentId,
            homeworkReview,
        );
        if (!homeworkSource.success) return homeworkSource;

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
        if (homeworkReview && typeof homeworkReview === 'object') {
            const allowedHomeworkStatuses = ['not_checked', 'completed', 'partial', 'not_completed', 'not_assigned'];
            attendeeData.homeworkStatus = allowedHomeworkStatuses.includes(homeworkReview.status)
                ? homeworkReview.status
                : 'not_checked';
            attendeeData.homeworkCompletionPercent = Number.isFinite(Number(homeworkReview.completionPercent))
                ? Math.max(0, Math.min(100, Math.round(Number(homeworkReview.completionPercent))))
                : null;
            attendeeData.homeworkDifficulties = String(homeworkReview.difficulties || '').trim() || null;
            attendeeData.homeworkNotCompletedReason = String(homeworkReview.notCompletedReason || '').trim() || null;
            attendeeData.reviewedHomeworkClassId = homeworkSource.sourceClassId;
        }

        const attendee = await upsertClassAttendee(crmClassId, normalizedStudentId, attendeeData, tx);

        const updateData = {};
        if (isAttended && (cls.noOneAttended || ['not_held', 'no_submission'].includes(cls.teacherOutcomeHint))) {
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
                studentId: normalizedStudentId || (isVirtualTrial ? getTrialParticipantId(cls.id) : null),
                attended: isAttended,
                attendanceStatus: normalizedStatus,
                attendeeId: attendee?.id ?? null,
                status: updated.status,
                class: mapClassDetail(updated),
            },
        };
    });
}

async function adminSetAttendance(crmClassId, { studentId, attended, attendanceStatus, teacherNote, homeworkReview }) {
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

        const trialBooking = cls.classType === 'trial'
            ? { id: 'class-type-trial' }
            : await findTrialBookingForClass(tx, cls.id);
        const isVirtualTrial = isVirtualTrialClass(cls, trialBooking);
        if (!studentId && !isVirtualTrial) {
            return { success: false, error: 'studentId is required', status: 400 };
        }
        if (isVirtualTrial && studentId && !isTrialParticipantId(studentId, cls.id)) {
            return { success: false, error: 'Для пробного без карточки ученика используйте участника заявки', status: 400 };
        }
        const normalizedStudentId = isVirtualTrial ? null : (studentId || null);

        const homeworkSource = await resolveReviewedHomeworkClass(
            tx,
            cls,
            normalizedStudentId,
            homeworkReview,
        );
        if (!homeworkSource.success) return homeworkSource;

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
        if (homeworkReview && typeof homeworkReview === 'object') {
            const allowedHomeworkStatuses = ['not_checked', 'completed', 'partial', 'not_completed', 'not_assigned'];
            attendeeData.homeworkStatus = allowedHomeworkStatuses.includes(homeworkReview.status)
                ? homeworkReview.status
                : 'not_checked';
            attendeeData.homeworkCompletionPercent = Number.isFinite(Number(homeworkReview.completionPercent))
                ? Math.max(0, Math.min(100, Math.round(Number(homeworkReview.completionPercent))))
                : null;
            attendeeData.homeworkDifficulties = String(homeworkReview.difficulties || '').trim() || null;
            attendeeData.homeworkNotCompletedReason = String(homeworkReview.notCompletedReason || '').trim() || null;
            attendeeData.reviewedHomeworkClassId = homeworkSource.sourceClassId;
        }

        const attendee = await upsertClassAttendee(crmClassId, normalizedStudentId, attendeeData, tx);

        const updateData = {};
        if (isAttended && (cls.noOneAttended || ['not_held', 'no_submission'].includes(cls.teacherOutcomeHint))) {
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
                studentId: normalizedStudentId || (isVirtualTrial ? getTrialParticipantId(cls.id) : null),
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
        allowIncompleteReport = false,
        approvalExceptionReason,
        actorId,
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
        const reportApproval = validateLessonReportApproval(classRecord, {
            topic: finalTopic,
            lessonSummary: finalSummary,
            allowIncompleteReport,
            approvalExceptionReason,
        });
        if (!reportApproval.allowed) {
            const error = new Error('REPORT_APPROVAL_REJECTED');
            error.userMessage = reportApproval.reason;
            throw error;
        }

        const attendees = await tx.classAttendee.findMany({
            where: { classId: crmClassId }
        });
        const trialBooking = classRecord.classType === 'trial'
            ? { id: 'class-type-trial' }
            : await findTrialBookingForClass(tx, classRecord.id);
        const isTrial = Boolean(classRecord.classType === 'trial' || trialBooking);

        // Оплата диагностики проводится отдельно и не списывается с баланса ученика.
        if (deduct && !classRecord.noOneAttended && !isTrial) {
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

        const payrollClass = await syncClassPayrollSnapshot(tx, updated.id, { restoreLegacyBonus: true });
        const payrollAdjustment = await reconcileLockedClassPayrollAdjustment(
            tx,
            updated.id,
            actorId || 'system:learning-platform',
        );

        return {
            updated: payrollClass || updated,
            deductions,
            payrollAdjustment,
            approvalException: reportApproval.exception,
            studentIds: attendees
                .map((attendee) => attendee.studentId)
                .filter(Boolean),
        };
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
        if (error.message === 'REPORT_APPROVAL_REJECTED') {
            return { success: false, error: error.userMessage, status: 400 };
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

    const { updated, studentIds, payrollAdjustment, approvalException } = result;

    notify('lesson.approved', { classRecord: updated, deductions, crmStudentIds: studentIds }).catch(() => {});

    return {
        success: true,
        data: {
            crmClassId,
            status: updated.status,
            class: mapClassDetail(updated),
            deductions,
            payrollAdjustment,
            approvalException,
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
