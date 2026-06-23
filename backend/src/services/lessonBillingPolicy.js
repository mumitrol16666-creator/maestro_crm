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

function canApproveClass(classRecord) {
    if (!classRecord) return { allowed: false, status: 404, reason: 'Занятие не найдено' };
    if (classRecord.status === 'completed') {
        return { allowed: false, status: 409, reason: 'Урок уже подтверждён' };
    }
    if (!classRecord.isPractice && classRecord.status !== 'pending_admin_review') {
        return {
            allowed: false,
            status: 400,
            reason: 'Сначала преподаватель должен отправить урок на подтверждение',
        };
    }
    return { allowed: true };
}

module.exports = {
    shouldChargeAttendance,
    isPresentAttendance,
    canApproveClass,
};
