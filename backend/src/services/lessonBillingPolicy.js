const CHARGEABLE_ATTENDANCE_STATUSES = new Set([
    'present',
    'late',
    'unexcused_absence',
]);

function shouldChargeAttendance(status) {
    return CHARGEABLE_ATTENDANCE_STATUSES.has(status);
}

function isPresentAttendance(status) {
    return status === 'present' || status === 'late';
}

function isEmergencyFreezeAttendance(status) {
    return status === 'emergency_freeze';
}

function isHeldAttendance(status) {
    return isPresentAttendance(status) || isEmergencyFreezeAttendance(status);
}

function normalizeTeacherAttendanceStatus(attendanceStatus, attended = false) {
    if (attendanceStatus === 'present' || attendanceStatus === 'late') {
        return attendanceStatus;
    }
    if (attendanceStatus === 'unexcused_absence') {
        return attendanceStatus;
    }
    if (attendanceStatus === 'excused_absence' || attendanceStatus === 'emergency_freeze') {
        return 'unexcused_absence';
    }
    if (!attendanceStatus || attendanceStatus === 'unmarked') {
        return attended ? 'present' : 'unmarked';
    }
    return attended ? 'present' : 'unmarked';
}

function canApproveClass(classRecord) {
    if (!classRecord) return { allowed: false, status: 404, reason: 'Занятие не найдено' };
    if (classRecord.status === 'completed') {
        return { allowed: false, status: 409, reason: 'Урок уже подтверждён' };
    }
    const adminApprovableStatuses = new Set(['pending_admin_review', 'scheduled', 'started', 'not_filled']);
    if (!classRecord.isPractice && !adminApprovableStatuses.has(classRecord.status)) {
        return {
            allowed: false,
            status: 400,
            reason: 'Урок нельзя подтвердить в текущем статусе',
        };
    }
    return { allowed: true };
}

function validateLessonReportApproval(classRecord, input = {}) {
    if (['not_held', 'no_submission'].includes(classRecord?.teacherOutcomeHint)) {
        return { allowed: true, exception: null };
    }

    const missingFields = [];
    if (!String(input.topic || '').trim()) missingFields.push('topic');
    if (!String(input.lessonSummary || '').trim()) missingFields.push('lessonSummary');
    if (!missingFields.length) return { allowed: true, exception: null };

    const reason = String(input.approvalExceptionReason || '').trim();
    if (!input.allowIncompleteReport) {
        return {
            allowed: false,
            status: 400,
            reason: 'Для подтверждения заполните тему и итог урока',
        };
    }
    if (reason.length < 5) {
        return {
            allowed: false,
            status: 400,
            reason: 'Укажите причину подтверждения неполного отчёта',
        };
    }

    return {
        allowed: true,
        exception: { reason, missingFields },
    };
}

module.exports = {
    shouldChargeAttendance,
    isPresentAttendance,
    isEmergencyFreezeAttendance,
    isHeldAttendance,
    normalizeTeacherAttendanceStatus,
    canApproveClass,
    validateLessonReportApproval,
};
