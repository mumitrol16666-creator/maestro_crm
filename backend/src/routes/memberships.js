const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// =====================================================
// Конфигурация типов абонементов
// =====================================================
const MEMBERSHIP_CONFIG = {
    trial:              { classes: 1,  days: 7,  price: 2000,  freezes: 0 },
    single_class:       { classes: 1,  days: 1,  price: 3500,  freezes: 0 },
    monthly:            { classes: 8,  days: 30, price: 22000, freezes: 1 },
    monthly_12:         { classes: 12, days: 30, price: 22000, freezes: 1 },
    quarterly:          { classes: 24, days: 90, price: 55000, freezes: 3 },
    individual_single:  { classes: 1,  days: 30, price: 10000, freezes: 0 },
    individual_package: { classes: 8,  days: 60, price: 55900, freezes: 1 },
};

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
                        notes: true, paymentMethod: true
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
            totalPrice,
            paymentType,      // 'full' | 'advance' | 'later'
            advanceAmount,
            advanceDueDate,
            paymentMethod
        } = req.body;

        console.log(`📋 POST /api/memberships`, { studentId, groupId, type, paymentType, totalPrice, advanceAmount });

        const config = MEMBERSHIP_CONFIG[type] || MEMBERSHIP_CONFIG.monthly;
        const newClasses = config.classes;
        const extensionDays = config.days;
        const price = totalPrice || config.price;

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

        if (!isOneOffType) {
            existingMembership = await prisma.membership.findFirst({
                where: {
                    studentId,
                    groupId,
                    status: 'active',
                    // Не пытаемся прибавлять месячный абонемент к пробному или разовому!
                    type: { notIn: ['trial', 'single_class', 'individual_single'] }
                },
                include: { payments: true }
            });
        }

        let membership;
        let isExtension = false;

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
                    freezesAvailable: existingMembership.freezesAvailable + config.freezes,
                    source: 'renewal'
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

            membership = await prisma.membership.create({
                data: {
                    studentId,
                    groupId,
                    type: type || 'monthly',
                    totalClasses: newClasses,
                    classesRemaining: newClasses,
                    startDate: start,
                    endDate: end,
                    totalPrice: price,
                    paidAmount,
                    remainingAmount,
                    paymentStatus,
                    freezesAvailable: config.freezes,
                    status: 'active',
                    createdById: req.user.id,
                    source: 'manual'
                }
            });

            // Создаём начальную транзакцию
            await prisma.membershipTransaction.create({
                data: {
                    membershipId: membership.id,
                    type: 'initial',
                    amount: newClasses,
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
                paymentMethod: hasPayment ? (paymentMethod || null) : null
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

        res.status(201).json({
            success: true,
            membership: { ...membership, _id: membership.id },
            isExtension,
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

module.exports = router;
