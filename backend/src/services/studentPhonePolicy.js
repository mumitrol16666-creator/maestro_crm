const STAFF_ROLES = ['admin', 'super_admin', 'sales_manager', 'staff', 'teacher'];

async function findStaffPhoneOwner(prismaClient, phone, excludeId = null) {
    const trimmedPhone = String(phone || '').trim();
    if (!trimmedPhone) return null;

    return prismaClient.student.findFirst({
        where: {
            phone: trimmedPhone,
            role: { in: STAFF_ROLES },
            ...(excludeId ? { id: { not: excludeId } } : {})
        },
        select: { id: true, role: true, name: true, lastName: true }
    });
}

async function ensureStudentContactPhoneAvailable(prismaClient, phone, excludeId = null) {
    const owner = await findStaffPhoneOwner(prismaClient, phone, excludeId);
    if (!owner) return null;

    const error = new Error('Этот номер уже используется сотрудником школы');
    error.statusCode = 400;
    error.code = 'STAFF_PHONE_CONFLICT';
    throw error;
}

module.exports = {
    STAFF_ROLES,
    findStaffPhoneOwner,
    ensureStudentContactPhoneAvailable
};
