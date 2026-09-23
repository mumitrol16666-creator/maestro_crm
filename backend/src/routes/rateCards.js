const express = require('express');
const { prisma } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { RATE_LABELS, normalizeRates, rateCardMembershipData, rateError } = require('../services/rateCards');
const router = express.Router();
router.use(['/rate-card', '/rate-card-catalog', '/rate-card-preview'], authenticate, requireAdmin);

function nameFrom(value) {
    const name = String(value || '').trim();
    if (!name || name.length > 150) throw rateError('Название тарифа должно содержать от 1 до 150 символов');
    return name;
}

router.get('/rate-card-catalog', async (req, res) => {
    try {
        const plans = await prisma.membershipPlan.findMany({
            where: { billingModel: 'rate_card', status: 'active', isVisible: true },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        });
        res.json({ success: true, plans, rateLabels: RATE_LABELS });
    } catch (error) { res.status(500).json({ success: false, error: 'Не удалось загрузить тарифы' }); }
});

router.post('/rate-card-catalog', async (req, res) => {
    try {
        const name = nameFrom(req.body.name);
        const lessonRates = normalizeRates(req.body.lessonRates);
        const plan = await prisma.membershipPlan.create({ data: {
            name, lessonRates, legacyType: `rate_card_${require('node:crypto').randomUUID()}`,
            billingModel: 'rate_card', lessonFormat: 'rate_card', groupBindMode: 'none',
            includedUnits: 0, price: 0, validityModel: 'unlimited', validityDays: null,
        } });
        res.status(201).json({ success: true, plan });
    } catch (error) { res.status(error.statusCode || 500).json({ success: false, error: error.statusCode ? error.message : 'Не удалось создать тариф' }); }
});

router.post('/rate-card-preview', (req, res) => {
    try { res.json({ success: true, lessonRates: normalizeRates(req.body.lessonRates) }); }
    catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.post('/rate-card', async (req, res) => {
    try {
        const { studentId, planId = null, replaceMembershipId = null, expectedActiveIds } = req.body;
        if (typeof studentId !== 'string' || !studentId) throw rateError('Выберите ученика');
        const name = nameFrom(req.body.name);
        const lessonRates = normalizeRates(req.body.lessonRates);
        if (!Array.isArray(expectedActiveIds) || expectedActiveIds.some(id => typeof id !== 'string')) throw rateError('Обновите карточку ученика перед подключением тарифа');
        const membership = await prisma.$transaction(async tx => {
            const students = await tx.$queryRaw`SELECT id FROM "Student" WHERE id = ${studentId} AND role = 'student' FOR UPDATE`;
            if (!students.length) throw rateError('Ученик не найден');
            if (planId) {
                const plan = await tx.membershipPlan.findFirst({ where: { id: planId, billingModel: 'rate_card', status: 'active' } });
                if (!plan) throw rateError('Тариф больше недоступен');
            }
            const active = await tx.membership.findMany({ where: { studentId, status: 'active' }, orderBy: { id: 'asc' } });
            if (JSON.stringify(active.map(m => m.id)) !== JSON.stringify([...new Set(expectedActiveIds)].sort())) {
                throw Object.assign(rateError('Абонементы ученика изменились. Обновите карточку.'), { statusCode: 409 });
            }
            if (replaceMembershipId && !active.some(m => m.id === replaceMembershipId)) throw rateError('Заменяемый тариф не найден среди активных');
            // Replace only explicitly reviewed assignments; historical purchases and payments remain linked.
            for (const old of active) {
                await tx.membership.update({ where: { id: old.id }, data: { status: 'archived' } });
            }
            const created = await tx.membership.create({ data: rateCardMembershipData({
                studentId, name, rates: lessonRates, planId, actorId: req.user.id,
                previousMembershipId: replaceMembershipId || active[0]?.id || null,
                teacherId: active.find(m => m.teacherId)?.teacherId || null,
                emergencyFreezesAvailable: active.reduce((sum, m) => sum + (m.emergencyFreezesAvailable || 0), 0),
                emergencyFreezesUsed: active.reduce((sum, m) => sum + (m.emergencyFreezesUsed || 0), 0),
                freezesAvailable: active.reduce((sum, m) => sum + (m.freezesAvailable || 0), 0),
            }) });
            await tx.membershipTransaction.create({ data: {
                membershipId: created.id, type: 'initial', amount: 0,
                reason: `Подключён бессрочный тариф «${name}». Заменены: ${active.map(m => m.id).join(', ') || 'нет'}`,
                addedById: req.user.id,
            } });
            await tx.student.update({ where: { id: studentId }, data: { activeMembershipId: created.id } });
            await tx.activityLog.create({ data: {
                userId: req.user.id, action: 'rate_card_assigned', entityType: 'Membership', entityId: created.id,
                details: `Тариф «${name}» подключён ученику`, metadata: { studentId, lessonRates, archivedIds: active.map(m => m.id) },
            } });
            return created;
        });
        res.status(201).json({ success: true, membership: { ...membership, _id: membership.id } });
    } catch (error) {
        console.error('Rate card assignment:', error.message);
        res.status(error.statusCode || 500).json({ success: false, error: error.statusCode ? error.message : 'Не удалось подключить тариф' });
    }
});

module.exports = router;
