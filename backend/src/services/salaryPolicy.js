const TRIAL_TEACHER_RATE = 500;

function getFirstPaymentTeacherBonus(amount) {
    const value = Math.round(Number(amount) || 0);
    if (value >= 150000 && value <= 300000) return 5000;
    if (value >= 60000 && value < 150000) return 2000;
    if (value >= 32000 && value < 60000) return 500;
    return 0;
}

function getTeacherRate(teacher, classItem) {
    if (classItem.classType === 'trial') return TRIAL_TEACHER_RATE;
    if (classItem.isPractice || classItem.classType === 'practice') return teacher.salaryOther || 0;
    if (classItem.classType === 'individual') return teacher.salaryIndividual || 0;
    if (classItem.classType === 'group') return teacher.salaryGroup || 0;
    return teacher.salaryOther || 0;
}

function getRateLabel(classItem) {
    if (classItem.classType === 'trial') return 'Пробное';
    if (classItem.isPractice || classItem.classType === 'practice') return 'Другие';
    if (classItem.classType === 'individual') return 'Индивидуально';
    if (classItem.classType === 'group') return 'Группа';
    return 'Другие';
}

function isPayableClass(classItem) {
    const attendanceStatuses = (classItem.attendees || [])
        .map((attendance) => attendance.attendanceStatus)
        .filter(Boolean);
    const hasUnexcusedAbsence = attendanceStatuses.includes('unexcused_absence');
    const onlyNonPayableAbsences = attendanceStatuses.length > 0
        && attendanceStatuses.every((status) => (
            status === 'excused_absence' || status === 'emergency_freeze'
        ));

    if (classItem.status === 'cancelled') {
        if (classItem.classType === 'trial') return false;
        const hasFreeze = attendanceStatuses.includes('excused_absence');
        return hasUnexcusedAbsence || hasFreeze;
    }
    if (classItem.status !== 'completed') return false;
    if (classItem.teacherOutcomeHint === 'not_held') return false;
    if (onlyNonPayableAbsences) return false;
    return true;
}

module.exports = {
    TRIAL_TEACHER_RATE,
    getFirstPaymentTeacherBonus,
    getTeacherRate,
    getRateLabel,
    isPayableClass,
};
