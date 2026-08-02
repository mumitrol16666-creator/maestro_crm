function formatTeacherRosterName(person, fallback = '') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function buildTeacherStudentRosterWhere(crmTeacherId) {
    return {
        role: 'student',
        status: 'active',
        assignedTeacherId: crmTeacherId,
    };
}

function mapTeacherGroupStudent(student, crmTeacherId) {
    return {
        crmStudentId: student.id,
        name: formatTeacherRosterName(student),
        avatarUrl: student.studentAvatar || null,
        assignedDirectly: student.assignedTeacherId === crmTeacherId,
    };
}

module.exports = {
    buildTeacherStudentRosterWhere,
    mapTeacherGroupStudent,
};
