const axios = require('axios');
const { prisma } = require('../config/db');
const { fail, isMinor } = require('./enrollment');
const { provisionCrmStudent } = require('./userLink');
async function platform(path, data) {
    const base = process.env.LEARNING_PLATFORM_API_URL;
    if (!base) throw fail('Адрес Платформы не настроен.', 503);
    try {
        const response = await axios({ url: `${base.replace(/\/$/, '')}/api/integration/v1${path}`, method: data ? 'POST' : 'GET', data,
            headers: { Authorization: `Bearer ${process.env.INTEGRATION_SERVICE_SECRET}`, 'X-Integration-System': 'crm' }, timeout: 15000 });
        return response.data.data;
    } catch (error) {
        const message = error.response?.data?.error;
        throw fail(typeof message === 'string' ? message : message?.message || 'Платформа недоступна. Сохранённые шаги и оплаты не потеряны.', error.response?.status === 409 ? 409 : 502);
    }
}
async function familyAccess(e) { return platform(`/family/${encodeURIComponent(e.studentId)}`); }
async function studentAccess(e, input) {
    if (typeof input.password !== 'string' || input.password.length < 8 || Buffer.byteLength(input.password, 'utf8') > 72) throw fail('Пароль ученика: от 8 символов, не более 72 байт.');
    const result = await provisionCrmStudent(e.studentId, { password: input.password, preserveExistingPassword: true });
    if (!result.success) throw fail(result.error, 502);
    return { created: result.data.created === true, appUserId: result.data.appUserId };
}
async function parentAccess(e, input, actorId) {
    if (!isMinor(e.student.dateOfBirth) || !e.customer) throw fail('Родительский кабинет нужен для несовершеннолетнего ученика с заполненным заказчиком.');
    if (input.identityVerified !== true) throw fail('Подтвердите проверку личности и права представлять ученика.');
    if (!['create', 'link'].includes(input.mode)) throw fail('Выберите создание или привязку кабинета.');
    const payload = { crmStudentId: e.studentId, operationId: `enrollment:${e.id}:parent`, crmActorId: actorId,
        mode: input.mode, login: input.login, firstName: input.firstName, lastName: input.lastName, middleName: input.middleName,
        phone: input.phone, password: input.password, parentUserId: input.parentUserId,
        relationship: e.customer.relationship, identityVerified: true };
    const result = await platform('/family/parent', payload);
    await prisma.enrollment.update({ where: { id: e.id }, data: { parentUserId: result.parent.id, lastAccessError: null } });
    await prisma.activityLog.create({ data: { userId: actorId, action: 'enrollment_parent_access', entityType: 'Enrollment', entityId: e.id,
        details: 'Администратор подтвердил личность и родительский доступ', metadata: { studentId: e.studentId, parentUserId: result.parent.id, linkId: result.linkId } } });
    return result;
}
module.exports = { platform, familyAccess, studentAccess, parentAccess };
