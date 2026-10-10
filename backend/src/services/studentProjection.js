const PUBLIC_STUDENT_FIELDS = [
    'id', '_id', 'isBooking', 'name', 'lastName', 'middleName', 'dateOfBirth', 'phone', 'phoneDigits',
    'notifyHomework', 'notifyLessons', 'notifyPayments', 'email', 'gender', 'role',
    'status', 'pausedUntil', 'notes', 'customerName', 'customerType', 'acquisitionSource',
    'learningDirections', 'learningLevel', 'registeredAt', 'createdAt', 'updatedAt',
    'offerAccepted', 'offerAcceptedAt', 'studentAvatar', 'assignedTeacherId',
    'appUserId', 'externalLinkStatus', 'linkedAt', 'lostAt', 'lostReason', 'departureNote',
    'lostMarkedById', 'isLost', 'lastAttendedDate', 'additionalPhones', 'assignedTeacher', 'groups', 'schedules',
];

function canViewStudentFinancials(role) {
    return ['admin', 'super_admin'].includes(role);
}

function projectStudent(student, role) {
    if (!student) return student;
    if (canViewStudentFinancials(role)) {
        const { password, ...result } = student;
        return result;
    }
    return Object.fromEntries(PUBLIC_STUDENT_FIELDS
        .filter(field => Object.hasOwn(student, field))
        .map(field => [field, student[field]]));
}

const studentContactSelect = Object.fromEntries(PUBLIC_STUDENT_FIELDS
    .filter(field => !['_id', 'isBooking', 'isLost', 'lastAttendedDate', 'additionalPhones', 'assignedTeacher', 'groups', 'schedules'].includes(field))
    .map(field => [field, true]));

module.exports = { projectStudent, canViewStudentFinancials, studentContactSelect };
