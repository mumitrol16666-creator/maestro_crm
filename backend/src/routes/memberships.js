const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { MEMBERSHIP_CONFIG, computeMembershipPrice } = require('../utils/pricing');
const { autoRecoverStudent } = require('../utils/recovery');
const { generateClassesForGroupInRange } = require('../services/scheduleGenerator');
const { resolveMembershipPlanId } = require('../services/membershipPlanSync');

const SKIP_AUTO_SCHEDULE_TYPES = ['trial', 'single_class', 'individual_single', 'individual_package'];

// =====================================================
// GET /api/memberships/student/:studentId
// Получить ВСЕ абонементы ученика (для профиля)
// =====================================================
router.get('/student/:studentId', authenticate, async (req, res) => {
    try {
        const { studentId } = req.params;

        const memberships = await prisma.membership.findMany({
            where: { studentId },
            include: {
                group: { select: { id: true, name: true, schedules: true } },
                createdBy: { select: { name: true, lastName: true } },
                payments: {
                    orderBy: { paymentDate: 'desc' },
                    select: {
                        id: true, amount: true, type: true,
                        paymentDate: true, status: true, dueDate: true,
                        notes: true, paymentMethod: true,
                        basePrice: true, discountPercent: true,
                        discountReferralPercent: true,
                        discountFamilyPercent: true,
                        discountConcessionPercent: true
                    }
                },
                transactions: {
                    orderBy: { date: 'desc' },
                    take: 20
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        const mapped = memberships.map(m => ({
            ...m,
            _id: m.id,
            // Фронтенд ожидает groupId как объект (legacy Mongoose populate)
            groupId: m.group ? { ...m.group, _id: m.group.id } : null
        }));

        res.json({ success: true, memberships: mapped });
    } catch (error) {
        console.error('Get student memberships error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения абонементов' });
    }
});

// =====================================================
// GET /api/memberships/price-preview
// Превью цены со скидками для UI
// query: studentId, type, skipConcession=0|1, basePriceOverride?
// =====================================================
router.get('/price-preview', authenticate, async (req, res) => {
    try {
        const { studentId, type, skipConcession, basePriceOverride, referrerId, groupId } = req.query;
        if (!type) {
            return res.status(400).json({ success: false, error: 'Не указан type' });
        }
        const opts = {
            skipConcession: String(skipConcession) === '1' || skipConcession === 'true',
            previewReferrerId: referrerId || null,
            groupId: groupId || null
        };
        if (basePriceOverride !== undefined && basePriceOverride !== '') {
            const n = Number(basePriceOverride);
            if (Number.isFinite(n) && n > 0) opts.basePriceOverride = n;
        }
        console.log('[price-preview] query:', { studentId, type, referrerId, groupId, basePriceOverride });
        const breakdown = await computeMembershipPrice(studentId || null, type, opts);
        console.log('[price-preview] result:', { basePrice: breakdown.basePrice, totalPrice: breakdown.totalPrice, reasons: breakdown.reasons });
        res.json({ success: true, ...breakdown });
    } catch (error) {
        console.error('Price preview error:', error);
        res.status(500).json({ success: false, error: error.message || 'Ошибка расчёта цены' });
    }
});

// =====================================================
// POST /api/memberships
// Создать НОВЫЙ абонемент или ПРОДЛИТЬ существующий
// 
// Бизнес-логика продления:
// 1. Ищем активный абонемент ученика в той же группе
// 2. Если найден → ПРОДЛЕВАЕМ (плюсуем занятия, сдвигаем дату, добавляем платёж)
// 3. Если нет → создаём новый абонемент
// =====================================================
router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const {
            studentId, groupId, type,
            startDate,
            totalPrice,          // legacy: обрабатывается как basePriceOverride, если не передан отдельно
            basePriceOverride,
            paymentType,      // 'full' | 'advance' | 'later'
            advanceAmount,
            advanceDueDate,
            paymentMethod,
            skipConcession
        } = req.body;

        console.log(`📋 POST /api/memberships`, { studentId, groupId, type, paymentType, totalPrice, basePriceOverride, advanceAmount, skipConcession });

        // Phase 2: если ученик был помечен как потерянный — автоматически возвращаем
        // его до создания/продления абонемента и записываем действие как возврат.
        if (studentId && req.user?.id) {
            await autoRecoverStudent(studentId, req.user.id, {
                source: 'new_membership',
                note: `Новый абонемент (${type})`,
            });
        }

        let config = MEMBERSHIP_CONFIG[type] || MEMBERSHIP_CONFIG.monthly;
        if (groupId) {
            const group = await prisma.group.findUnique({ where: { id: groupId }, select: { direction: true } });
            if (group && group.direction) {
                const plan = await prisma.directionPlan.findFirst({
                    where: { direction: { name: group.direction }, type: type, isActive: true }
                });
                if (plan) {
                    config = { classes: plan.classes, days: plan.days, price: plan.price };
                }
            }
        }
        
        const newClasses = config.classes;
        const extensionDays = config.days;
        
        const student = await prisma.student.findUnique({ where: { id: studentId } });
        let calculatedFreezes = 0;
        const noFreezeTypes = ['trial', 'single_class', 'individual_single', 'individual_package'];
        if (!noFreezeTypes.includes(type) && student) {
            calculatedFreezes = student.gender === 'female' ? 2 : 1;
            // Для квартального, возможно, нужно больше заморозок (как было 3)
            // Но пользователь сказал "у мужчин 1 заморозка у женщин 2", поэтому оставляем так.
        }

        // Единый расчёт цены со скидками.
        // basePriceOverride имеет приоритет; totalPrice оставлен как legacy fallback.
        const overrideCandidate = Number(basePriceOverride);
        const legacyCandidate = Number(totalPrice);
        const override = Number.isFinite(overrideCandidate) && overrideCandidate > 0
            ? overrideCandidate
            : (Number.isFinite(legacyCandidate) && legacyCandidate > 0 ? legacyCandidate : undefined);

        // Когда админ задаёт цену вручную — это финальная сумма, поверх неё скидки не применяем.
        const manualPriceGiven = Number.isFinite(overrideCandidate) && overrideCandidate > 0;
        const pricing = await computeMembershipPrice(studentId, type, {
            basePriceOverride: override,
            skipConcession: !!skipConcession,
            skipAllDiscounts: manualPriceGiven
        });
        const price = pricing.totalPrice;

        // Определяем сумму и тип платежа
        let paymentAmount = 0;
        let paymentTypeEnum = 'membership_full';
        
        // Переназначаем PaymentType в зависимости от типа абонемента "type"
        if (type === 'trial') paymentTypeEnum = 'trial_full';
        else if (type === 'single_class') paymentTypeEnum = 'single_class';
        else if (type === 'individual_single') paymentTypeEnum = 'individual_class';

        if (paymentType === 'full') {
            paymentAmount = price;
        } else if (paymentType === 'advance') {
            paymentAmount = advanceAmount || 0;
            // Аванс для пробного — 'trial_advance', для остальных 'membership_advance'
            if (type === 'trial') paymentTypeEnum = 'trial_advance';
            else paymentTypeEnum = 'membership_advance';
        }
        // 'later' → paymentAmount = 0

        // ========== ИЩЕМ АКТИВНЫЙ АБОНЕМЕНТ В ЭТОЙ ГРУППЕ ==========
        let existingMembership = null;
        
        // Одноразовые абонементы (пробный или разовый) никогда ни с чем не сливаются
        const isOneOffType = ['trial', 'single_class', 'individual_single'].includes(type);
        const finalGroupId = groupId || null;

        if (!isOneOffType) {
            existingMembership = await prisma.membership.findFirst({
                where: {
                    studentId,
                    groupId: finalGroupId,
                    status: 'active',
                    // Не пытаемся прибавлять месячный абонемент к пробному или разовому!
                    type: { notIn: ['trial', 'single_class', 'individual_single'] }
                },
                include: { payments: true }
            });
        }

        let membership;
        let isExtension = false;
        let scheduleRangeStart = null;
        let scheduleRangeEnd = null;

        if (existingMembership) {
            // ==========================================
            // ПРОДЛЕНИЕ СУЩЕСТВУЮЩЕГО АБОНЕМЕНТА
            // ==========================================
            isExtension = true;
            console.log(`🔄 ПРОДЛЕНИЕ абонемента ${existingMembership.id}:`,
                `было ${existingMembership.classesRemaining} занятий, +${newClasses}`);

            // Определяем новую дату окончания:
            // Если старый ещё не истёк → продлеваем от endDate
            // Если уже истёк → продлеваем от сегодня
            const now = new Date();
            const currentEnd = new Date(existingMembership.endDate);
            const baseDate = currentEnd > now ? currentEnd : now;
            const newEndDate = new Date(baseDate);
            newEndDate.setDate(newEndDate.getDate() + extensionDays);

            let newType = type || existingMembership.type;

            // Считаем новые финансы
            const newTotalPrice = existingMembership.totalPrice + price;
            const newPaidAmount = existingMembership.paidAmount + paymentAmount;
            const newRemainingAmount = newTotalPrice - newPaidAmount;

            let newPaymentStatus = 'not_paid';
            if (newRemainingAmount <= 0) newPaymentStatus = 'paid';
            else if (newPaidAmount > 0) newPaymentStatus = 'partial';

            // Обновляем абонемент в БД
            membership = await prisma.membership.update({
                where: { id: existingMembership.id },
                data: {
                    type: newType,
                    totalClasses: existingMembership.totalClasses + newClasses,
                    classesRemaining: existingMembership.classesRemaining + newClasses,
                    endDate: newEndDate,
                    totalPrice: newTotalPrice,
                    paidAmount: newPaidAmount,
                    remainingAmount: Math.max(0, newRemainingAmount),
                    paymentStatus: newPaymentStatus,
                    // Обновляем заморозки для нового периода (по полу определим на фронте)
                    freezesAvailable: existingMembership.freezesAvailable + calculatedFreezes,
                    source: 'renewal',
                    // Снимок скидки по последней покупке (продлению)
                    basePrice: pricing.basePrice,
                    discountPercent: pricing.discountPercent,
                    discountReferralPercent: pricing.discountReferralPercent,
                    discountFamilyPercent: pricing.discountFamilyPercent,
                    discountConcessionPercent: pricing.discountConcessionPercent
                }
            });

            // Создаём транзакцию (лог) продления
            await prisma.membershipTransaction.create({
                data: {
                    membershipId: membership.id,
                    type: 'extension',
                    amount: newClasses,
                    reason: `Продление: +${newClasses} занятий, +${extensionDays} дней. ` +
                            `Период до ${newEndDate.toLocaleDateString('ru')}.` +
                            (paymentAmount > 0 ? ` Оплата: ${paymentAmount}₸` : ''),
                    addedById: req.user.id
                }
            });

            console.log(`✅ Абонемент продлён: ${membership.classesRemaining} занятий, до ${newEndDate.toLocaleDateString('ru')}`);

            scheduleRangeStart = currentEnd > now ? currentEnd : now;
            scheduleRangeEnd = newEndDate;

        } else {
            // ==========================================
            // СОЗДАНИЕ НОВОГО АБОНЕМЕНТА
            // ==========================================
            const start = startDate ? new Date(startDate) : new Date();
            const end = new Date(start);
            end.setDate(end.getDate() + extensionDays);

            const paidAmount = paymentAmount;
            const remainingAmount = Math.max(0, price - paidAmount);
            let paymentStatus = 'not_paid';
            if (remainingAmount <= 0) paymentStatus = 'paid';
            else if (paidAmount > 0) paymentStatus = 'partial';

            // Ищем предыдущий non-trial абонемент (любого статуса), чтобы построить цепочку продлений
            const priorMembership = await prisma.membership.findFirst({
                where: {
                    studentId,
                    type: { notIn: ['trial', 'single_class', 'individual_single'] },
                },
                orderBy: { createdAt: 'desc' },
                select: { id: true, endDate: true },
            });
            const isRenewalOfPrior = !!priorMembership && !['trial', 'single_class', 'individual_single'].includes(type || 'monthly');
            const planId = await resolveMembershipPlanId({
                groupId: finalGroupId,
                type: type || 'monthly',
            });

            membership = await prisma.membership.create({
                data: {
                    studentId,
                    groupId: finalGroupId,
                    planId,
                    type: type || 'monthly',
                    totalClasses: newClasses,
                    classesRemaining: newClasses,
                    classesUsed: 0,
                    startDate: start,
                    endDate: end,
                    activatedAt: new Date(),
                    totalPrice: price,
                    paidAmount,
                    remainingAmount,
                    paymentStatus,
                    freezesAvailable: calculatedFreezes,
                    freezesUsed: 0,
                    status: 'active',
                    createdById: req.user.id,
                    previousMembershipId: isRenewalOfPrior ? priorMembership.id : null,
                    source: isRenewalOfPrior ? 'renewal' : 'manual',
                    basePrice: pricing.basePrice,
                    discountPercent: pricing.discountPercent,
                    discountReferralPercent: pricing.discountReferralPercent,
                    discountFamilyPercent: pricing.discountFamilyPercent,
                    discountConcessionPercent: pricing.discountConcessionPercent
                }
            });

            // Создаём начальную транзакцию
            await prisma.membershipTransaction.create({
                data: {
                    membershipId: membership.id,
                    type: 'initial',
                    amount: newClasses,
                    balanceAfter: newClasses,
                    reason: `Новый абонемент: ${newClasses} занятий, ${extensionDays} дней`,
                    addedById: req.user.id
                }
            });

            // Обновить активный абонемент у студента
            await prisma.student.update({
                where: { id: studentId },
                data: { activeMembershipId: membership.id }
            });

            console.log(`✅ Новый абонемент создан: ${membership.id}, ${newClasses} занятий`);

            scheduleRangeStart = start;
            scheduleRangeEnd = end;
        }

        // ========== СОЗДАЁМ ПЛАТЁЖ (если есть оплата или указан срок для "позже") ==========
        const hasPayment = paymentAmount > 0;
        const hasDueDateForLater = paymentType === 'later' && advanceDueDate;

        if (hasPayment || hasDueDateForLater) {
            const paymentData = {
                studentId,
                amount: paymentAmount,
                type: paymentTypeEnum,
                membershipId: membership.id,
                managerId: req.user.id,
                status: 'completed',
                paymentDate: new Date(),
                notes: isExtension
                    ? `Продление абонемента (+${newClasses} занятий)${hasDueDateForLater ? ' (Оплата позже)' : ''}`
                    : `Новый абонемент (${newClasses} занятий)${hasDueDateForLater ? ' (Оплата позже)' : ''}`,
                paymentMethod: hasPayment ? (paymentMethod || null) : null,
                basePrice: pricing.basePrice,
                discountPercent: pricing.discountPercent,
                discountReferralPercent: pricing.discountReferralPercent,
                discountFamilyPercent: pricing.discountFamilyPercent,
                discountConcessionPercent: pricing.discountConcessionPercent
            };

            // Если аванс или "оплатит позже" со сроком — сохраняем срок доплаты
            if ((paymentType === 'advance' || paymentType === 'later') && advanceDueDate) {
                paymentData.dueDate = new Date(advanceDueDate);
                // Максимум занятий до обязательной доплаты
                paymentData.maxClassesBeforePayment = Math.min(3, newClasses);
            }

            await prisma.payment.create({ data: paymentData });
            console.log(`💰 Платёж создан: ${paymentAmount}₸ (${paymentTypeEnum}), Срок: ${advanceDueDate || 'нет'}`);
        }

        let scheduleGeneration = null;
        if (
            finalGroupId
            && !SKIP_AUTO_SCHEDULE_TYPES.includes(membership.type)
            && scheduleRangeStart
            && scheduleRangeEnd
        ) {
            try {
                scheduleGeneration = await generateClassesForGroupInRange({
                    groupId: finalGroupId,
                    startDate: scheduleRangeStart,
                    endDate: scheduleRangeEnd,
                    createdById: req.user.id,
                });
                console.log('📅 Автогенерация расписания:', scheduleGeneration);
            } catch (scheduleErr) {
                console.error('Auto schedule generation failed:', scheduleErr);
                scheduleGeneration = { created: 0, skipped: 0, error: scheduleErr.message };
            }
        }

        res.status(201).json({
            success: true,
            membership: { ...membership, _id: membership.id },
            isExtension,
            scheduleGeneration,
            message: isExtension
                ? `Абонемент продлён! +${newClasses} занятий`
                : `Новый абонемент создан: ${newClasses} занятий`
        });
    } catch (error) {
        console.error('Create/extend membership error:', error);
        res.status(500).json({ success: false, error: error.message || 'Ошибка создания абонемента' });
    }
});

// =====================================================
// POST /api/memberships/:id/payment
// Добавить платёж к существующему абонементу (доплата / закрытие долга)
// =====================================================
router.post('/:id/payment', authenticate, requireAdmin, async (req, res) => {
    try {
        const { amount, type, notes, paymentMethod } = req.body;
        const membershipId = req.params.id;

        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, error: 'Укажите сумму платежа' });
        }

        const membership = await prisma.membership.findUnique({
            where: { id: membershipId },
            include: { payments: { where: { dueDate: { not: null } }, orderBy: { dueDate: 'asc' }, take: 1 } }
        });
        if (!membership) {
            return res.status(404).json({ success: false, error: 'Абонемент не найден' });
        }

        // Пересчитываем финансы абонемента
        const newPaid = membership.paidAmount + amount;
        const newRemaining = Math.max(0, membership.totalPrice - newPaid);
        let newPaymentStatus = 'not_paid';
        if (newRemaining <= 0) newPaymentStatus = 'paid';
        else if (newPaid > 0) newPaymentStatus = 'partial';

        // Если долг закрыт — снимаем dueDate со старого аванс-платежа
        const advancePayment = membership.payments?.[0];
        if (newRemaining <= 0 && advancePayment) {
            await prisma.payment.update({
                where: { id: advancePayment.id },
                data: { dueDate: null }
            });
        }

        // Обновляем абонемент
        const updated = await prisma.membership.update({
            where: { id: membershipId },
            data: {
                paidAmount: newPaid,
                remainingAmount: newRemaining,
                paymentStatus: newPaymentStatus
            }
        });

        // Создаём запись платежа
        const paymentTypeEnum = type || 'membership_balance';
        const payment = await prisma.payment.create({
            data: {
                studentId: membership.studentId,
                membershipId,
                amount,
                type: paymentTypeEnum,
                status: 'completed',
                paymentDate: new Date(),
                managerId: req.user.id,
                notes: notes || 'Доплата по абонементу',
                relatedPaymentId: advancePayment ? advancePayment.id : undefined,
                paymentMethod: paymentMethod || null
            }
        });

        console.log(`💰 Доплата к абонементу ${membershipId}: ${amount}₸, остаток: ${newRemaining}₸ (${newPaymentStatus})`);

        res.status(201).json({
            success: true,
            payment: { ...payment, _id: payment.id },
            membership: { ...updated, _id: updated.id }
        });
    } catch (error) {
        console.error('Membership payment error:', error);
        res.status(500).json({ success: false, error: error.message || 'Ошибка добавления платежа' });
    }
});

// =====================================================
// PATCH /api/memberships/:id/add-classes
// Вручную добавить занятия к абонементу
// =====================================================
router.patch('/:id/add-classes', authenticate, requireAdmin, async (req, res) => {
    try {
        const { amount, reason } = req.body;
        const membership = await prisma.membership.findUnique({ where: { id: req.params.id } });
        if (!membership) return res.status(404).json({ success: false, error: 'Абонемент не найден' });

        const updated = await prisma.membership.update({
            where: { id: req.params.id },
            data: {
                totalClasses: membership.totalClasses + amount,
                classesRemaining: membership.classesRemaining + amount
            }
        });

        await prisma.membershipTransaction.create({
            data: {
                membershipId: membership.id,
                type: 'extension',
                amount,
                reason: reason || 'Ручное добавление занятий',
                addedById: req.user.id
            }
        });

        res.json({ success: true, membership: { ...updated, _id: updated.id } });
    } catch (error) {
        console.error('Add classes error:', error);
        res.status(500).json({ success: false, error: 'Ошибка добавления занятий' });
    }
});

// =====================================================
// PATCH /api/memberships/:id/remove-classes
// Вручную списать занятия с абонемента
// =====================================================
router.patch('/:id/remove-classes', authenticate, requireAdmin, async (req, res) => {
    try {
        const { amount, reason } = req.body;
        const membership = await prisma.membership.findUnique({ where: { id: req.params.id } });
        if (!membership) return res.status(404).json({ success: false, error: 'Абонемент не найден' });

        const newRemaining = Math.max(0, membership.classesRemaining - amount);
        const newUsed = membership.classesUsed + amount;

        const updated = await prisma.membership.update({
            where: { id: req.params.id },
            data: {
                classesRemaining: newRemaining,
                classesUsed: newUsed,
                // Если занятий не осталось — завершаем абонемент
                status: newRemaining === 0 ? 'expired' : 'active'
            }
        });

        await prisma.membershipTransaction.create({
            data: {
                membershipId: membership.id,
                type: 'manual_deduct',
                amount,
                reason: reason || 'Ручное списание занятий',
                addedById: req.user.id
            }
        });

        res.json({ success: true, membership: { ...updated, _id: updated.id } });
    } catch (error) {
        console.error('Remove classes error:', error);
        res.status(500).json({ success: false, error: 'Ошибка списания занятий' });
    }
});

// =====================================================
// PATCH /api/memberships/:id/update-dates
// Изменить дату активации (startDate) абонемента
// =====================================================
router.patch('/:id/update-dates', authenticate, requireAdmin, async (req, res) => {
    try {
        const { startDate, endDate } = req.body;
        const membership = await prisma.membership.findUnique({ where: { id: req.params.id } });
        if (!membership) return res.status(404).json({ success: false, error: 'Абонемент не найден' });

        const updateData = {};
        if (startDate) updateData.startDate = new Date(startDate);
        if (endDate)   updateData.endDate   = new Date(endDate);

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ success: false, error: 'Нечего обновлять' });
        }

        const updated = await prisma.membership.update({
            where: { id: req.params.id },
            data: updateData
        });

        await prisma.membershipTransaction.create({
            data: {
                membershipId: membership.id,
                type: 'manual_adjust',
                amount: 0,
                reason: `Изменена дата: startDate=${startDate || '—'}, endDate=${endDate || '—'}`,
                addedById: req.user.id
            }
        });

        res.json({ success: true, membership: { ...updated, _id: updated.id } });
    } catch (error) {
        console.error('Update dates error:', error);
        res.status(500).json({ success: false, error: 'Ошибка обновления даты' });
    }
});

// =====================================================
// PATCH /api/memberships/:id/price
// Изменить итоговую цену абонемента вручную (со сдвигом
// paidAmount / remainingAmount и пересчётом paymentStatus).
// =====================================================
router.patch('/:id/price', authenticate, requireAdmin, async (req, res) => {
    try {
        const newPriceRaw = Number(req.body?.totalPrice);
        if (!Number.isFinite(newPriceRaw) || newPriceRaw < 0) {
            return res.status(400).json({ success: false, error: 'Некорректная цена' });
        }
        const newPrice = Math.round(newPriceRaw);

        const membership = await prisma.membership.findUnique({ where: { id: req.params.id } });
        if (!membership) return res.status(404).json({ success: false, error: 'Абонемент не найден' });

        const paid = Number(membership.paidAmount || 0);
        const remaining = Math.max(0, newPrice - paid);
        let paymentStatus = 'not_paid';
        if (paid >= newPrice && newPrice > 0) paymentStatus = 'paid';
        else if (paid > 0) paymentStatus = 'partial';

        const updated = await prisma.membership.update({
            where: { id: req.params.id },
            data: {
                totalPrice: newPrice,
                basePrice: newPrice, // ручная правка — сброс скидок
                discountPercent: 0,
                discountReferralPercent: 0,
                discountFamilyPercent: 0,
                discountConcessionPercent: 0,
                remainingAmount: remaining,
                paymentStatus
            }
        });

        await prisma.membershipTransaction.create({
            data: {
                membershipId: membership.id,
                type: 'manual_adjust',
                amount: newPrice - Number(membership.totalPrice || 0),
                reason: `Изменена цена: ${membership.totalPrice || 0} → ${newPrice}`,
                addedById: req.user.id
            }
        });

        res.json({ success: true, membership: { ...updated, _id: updated.id } });
    } catch (error) {
        console.error('Update price error:', error);
        res.status(500).json({ success: false, error: 'Ошибка обновления цены' });
    }
});

module.exports = router;
