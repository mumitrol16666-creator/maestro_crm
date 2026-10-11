const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const service = require('../services/subscriptionPeriods');
const router = express.Router();
router.use(authenticate, requireAdmin);
const run = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json({ success: true, ...await fn(req) }); }
    catch (error) { console.error('Subscription period:', error.message); res.status(error.statusCode || 500).json({ success: false, error: error.statusCode ? error.message : 'Не удалось выполнить действие. Обновите состояние перед повтором.' }); }
};
router.get('/attention', run(async () => ({ rows: await service.attentionQueue() })));
router.post('/student/:studentId/release-schedule', run(req => service.releaseSchedule(req.params.studentId, req.body, req.user.id)));
router.get('/student/:studentId', run(async req => service.studentPeriods(req.params.studentId)));
router.post('/memberships/:id/renewals', run(async req => ({ renewal: await service.prepareRenewal(req.params.id, req.body, req.user.id) })));
router.post('/renewals/:id/confirm', run(req => service.confirmRenewal(req.params.id, req.user.id)));
router.post('/renewals/:id/cancel', run(async req => { await service.cancelRenewal(req.params.id); return {}; }));
router.post('/renewals/:id/appendix', run(async req => ({ document: await service.prepareAppendix(req.params.id, req.body, req.user.id) })));
router.post('/documents/:id/sign', run(async req => { await service.signAppendix(req.params.id, req.body, req.user.id); return {}; }));
router.get('/documents/:id', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.type('html').send(await service.appendixHtml(req.params.id)); }
    catch (error) { res.status(error.statusCode || 500).json({ success: false, error: error.statusCode ? error.message : 'Не удалось открыть приложение.' }); }
});
router.post('/memberships/:id/installments', run(async req => ({ intent: await service.prepareInstallment(req.params.id, req.body, req.user.id) })));
router.post('/installments/:id/confirm', run(req => service.confirmInstallment(req.params.id, req.user.id)));
router.post('/installments/:id/cancel', run(async req => { await service.cancelInstallment(req.params.id); return {}; }));
module.exports = router;
