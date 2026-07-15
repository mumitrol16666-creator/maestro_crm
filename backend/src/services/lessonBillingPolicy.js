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

module.exports = {
    shouldChargeAttendance,
    isPresentAttendance,
    isEmergencyFreezeAttendance,
    isHeldAttendance,
    canApproveClass,
};
