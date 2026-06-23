function getTeacherRate(teacher, classItem) {
    if (classItem.classType === 'trial') return 0;
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
    if (classItem.classType === 'trial') return false;

    const attendanceStatuses = (classItem.attendees || [])
        .map((attendance) => attendance.attendanceStatus)
        .filter(Boolean);
    const hasUnexcusedAbsence = attendanceStatuses.includes('unexcused_absence');
    const onlyExcusedAbsences = attendanceStatuses.length > 0
        && attendanceStatuses.every((status) => status === 'excused_absence');

    if (classItem.status === 'cancelled') return hasUnexcusedAbsence;
    if (classItem.status !== 'completed') return false;
    if (classItem.teacherOutcomeHint === 'not_held') return false;
    if (onlyExcusedAbsences) return false;
    return true;
}

module.exports = { getTeacherRate, getRateLabel, isPayableClass };
