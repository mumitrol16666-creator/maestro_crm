const express = require('express');
const { prisma } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const service = require('../services/enrollment');
const access = require('../services/enrollmentAccess');
const { extendStudentIndividualSchedule } = require('../services/individualScheduleExtension');
const router = express.Router();
router.use(authenticate, requireAdmin);
const run = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { await fn(req, res); }
    catch (error) { console.error('Enrollment:', error.message); res.status(error.statusCode || 500).json({ success: false, error: error.statusCode ? error.message : 'Не удалось выполнить шаг оформления. Обновите состояние перед повтором.' }); }
};
router.get('/', run(async (req, res) => {
    const rows = await prisma.enrollment.findMany({ where: { OR: [{ completedAt: null }, { membership: { paymentStatus: 'partial' } }] }, take: 200, orderBy: { updatedAt: 'desc' }, select: { id: true, studentId: true } });
    const enrollments = [];
    for (const row of rows) {
        const e = await service.enrollmentView(row.id);
        enrollments.push({ id: e.id, studentId: e.studentId, student: e.student, nextStep: e.steps.find(s => !s.ready)?.label || (e.remainingAmount > 0 ? `Доплата ${e.remainingAmount} ₸ — до окончания второго урока` : 'Готово к завершению'), updatedAt: e.updatedAt });
    }
    res.json({ success: true, enrollments });
}));
router.post('/start', run(async (req, res) => {
    if (typeof req.body.studentId !== 'string') throw service.fail('Выберите ученика.');
    const e = await service.startEnrollment(req.body.studentId, req.user.id);
    res.json({ success: true, enrollment: await service.enrollmentView(e.id) });
}));
router.get('/:id', run(async (req, res) => res.json({ success: true, enrollment: await service.enrollmentView(req.params.id) })));
router.put('/:id', run(async (req, res) => {
    await service.saveEnrollment(req.params.id, req.body, req.user.id);
    res.json({ success: true, enrollment: await service.enrollmentView(req.params.id) });
}));
router.post('/:id/documents', run(async (req, res) => {
    const documentId = await service.prepareDocuments(req.params.id, req.user.id, req.body.revision);
    res.json({ success: true, documentId });
}));
router.get('/:id/documents/:documentId', run(async (req, res) => {
    const doc = await prisma.enrollmentDocument.findFirst({ where: { id: req.params.documentId, enrollmentId: req.params.id }, select: { html: true } });
    if (!doc) throw service.fail('Документ не найден', 404);
    res.type('html').send(doc.html);
}));
router.post('/:id/documents/:documentId/status', run(async (req, res) => {
    const allowed = ['printedAt', 'contractSignedAt', 'appendixSignedAt', 'consentSignedAt'];
    const field = req.body.field;
    if (!allowed.includes(field)) throw service.fail('Выберите документ и действие.');
    const date = req.body.date ? new Date(req.body.date) : new Date();
    if (!Number.isFinite(date.getTime()) || date > new Date(Date.now() + 60000)) throw service.fail('Укажите фактическую дату, не в будущем.');
    await prisma.$transaction(async tx => {
        const e = await service.locked(tx, req.params.id);
        const doc = await tx.enrollmentDocument.findFirst({ where: { id: req.params.documentId, enrollmentId: e.id, revision: e.revision } });
        if (doc && !service.sameDocumentStudent(doc.snapshot.student, e.student)) throw service.fail('Данные ученика изменились. Подготовьте новый экземпляр до подписания.', 409);
        if (!doc) throw service.fail('Этот экземпляр устарел. Подготовьте документы из текущих условий.', 409);
        if (field !== 'printedAt' && req.body.confirmed !== true) throw service.fail('Подтвердите фактическую подпись заказчика.');
        if (!doc[field]) await tx.enrollmentDocument.update({ where: { id: doc.id }, data: { [field]: date, ...(field !== 'printedAt' ? { signedById: req.user.id } : {}) } });
    });
    res.json({ success: true });
}));
router.post('/:id/payment-intents', run(async (req, res) => res.json({ success: true, intent: await service.preparePayment(req.params.id, req.body, req.user.id) })));
router.post('/:id/payment-intents/:intentId/confirm', run(async (req, res) => {
    res.json({ success: true, ...await service.confirmPayment(req.params.id, req.params.intentId, req.user.id) });
}));
router.post('/:id/payment-intents/:intentId/cancel', run(async (req, res) => {
    await prisma.$transaction(async tx => {
        await service.locked(tx, req.params.id);
        const i = await tx.enrollmentPaymentIntent.findFirst({ where: { id: req.params.intentId, enrollmentId: req.params.id } });
        if (!i) throw service.fail('Черновик не найден', 404);
        if (i.paymentId) throw service.fail('Оплата уже проведена. Для возврата используйте карточку ученика.', 409);
        await tx.enrollmentPaymentIntent.update({ where: { id: i.id }, data: { cancelledAt: new Date() } });
    });
    res.json({ success: true });
}));
router.post('/:id/activate', run(async (req, res) => {
    const e = await service.activateEnrollment(req.params.id, req.user.id);
    // Committed purchase must survive a separate schedule conflict/failure.
    let generation = null;
    try { generation = await extendStudentIndividualSchedule(e.studentId); } catch { generation = { error: 'Период запущен. Проверьте создание уроков на шаге расписания.' }; }
    res.json({ success: true, generation });
}));
router.get('/:id/access', run(async (req, res) => {
    const e = await service.enrollmentView(req.params.id);
    res.json({ success: true, data: await access.familyAccess(e) });
}));
router.post('/:id/access/parent-preview', run(async (req, res) => {
    await service.enrollmentView(req.params.id);
    res.json({ success: true, data: await access.platform('/family/parent-preview', { login: req.body.login }) });
}));
router.post('/:id/access/:kind', run(async (req, res) => {
    const e = await service.enrollmentView(req.params.id);
    let result;
    try {
        if (req.params.kind === 'student-link') result = await access.repairStudentLink(e);
        else if (req.params.kind === 'student') result = await access.studentAccess(e, req.body);
        else if (req.params.kind === 'parent') result = await access.parentAccess(e, req.body, req.user.id);
        else throw service.fail('Неизвестное действие.');
        await prisma.enrollment.update({ where: { id: e.id }, data: { lastAccessError: null } });
    } catch (error) {
        await prisma.enrollment.update({ where: { id: e.id }, data: { lastAccessError: String(error.message).slice(0, 500) } });
        throw error;
    }
    res.json({ success: true, data: result });
}));
router.post('/:id/handover', run(async (req, res) => {
    const e = await service.enrollmentView(req.params.id);
    const state = await access.familyAccess(e);
    const kind = req.body.kind;
    if (req.body.confirmed !== true || !['student', 'parent'].includes(kind)) throw service.fail('Отметьте фактическую передачу доступа.');
    if (kind === 'student' && (!state.student?.isActive || state.student.id !== e.student.appUserId)) throw service.fail('Действующий кабинет ученика не найден.', 409);
    if (kind === 'parent' && !state.parents.some(p => p.id === e.parentUserId)) throw service.fail('Подтверждённый кабинет родителя не связан с учеником.', 409);
    await prisma.enrollment.update({ where: { id: e.id }, data: kind === 'student' ? { studentHandedAt: new Date() } : { parentHandedAt: new Date() } });
    res.json({ success: true });
}));
router.post('/:id/complete', run(async (req, res) => {
    const e = await service.enrollmentView(req.params.id);
    const state = await access.familyAccess(e);
    if (!state.student?.isActive || state.student.id !== e.student.appUserId || e.minor && !state.parents.some(p => p.id === e.parentUserId)) throw service.fail('Проверьте действующие кабинеты семьи.', 409);
    await prisma.$transaction(async tx => {
        await service.locked(tx, e.id);
        const current = await service.enrollmentView(e.id, tx);
        if (!current.complete) throw service.fail('Оформление ещё не завершено. Выполните оставшиеся шаги.', 409);
        await tx.enrollment.update({ where: { id: e.id }, data: { completedAt: new Date() } });
    });
    res.json({ success: true });
}));
module.exports = router;
