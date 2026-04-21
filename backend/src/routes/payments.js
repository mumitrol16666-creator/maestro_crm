const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// =====================================================
// GET /api/payments/student/:studentId
// Получить ВСЕ платежи ученика (для профиля)
// Включает: связь с абонементом, менеджера, заметки
// =====================================================
router.get('/student/:studentId', authenticate, async (req, res) => {
    try {
        const { studentId } = req.params;

        const payments = await prisma.payment.findMany({
            where: { studentId },
            include: {
                manager: { select: { id: true, name: true, lastName: true } },
                teacher: { select: { id: true, name: true, lastName: true } },
                membership: {
                    select: {
                        id: true, type: true, totalClasses: true,
                        classesRemaining: true, status: true,
                        groupId: true,
                        group: { select: { name: true } }
                    }
                },
                relatedPayment: {
                    select: { id: true, amount: true, type: true, paymentDate: true }
                }
            },
            orderBy: { paymentDate: 'desc' }
        });

        // Подсчёт общей суммы оплаченного
        const totalPaid = payments
            .filter(p => p.status === 'completed')
            .reduce((sum, p) => sum + p.amount, 0);

        // Найти все абонементы с неоплаченным остатком
        const activeUnpaidMemberships = await prisma.membership.findMany({
            where: {
                studentId,
                paymentStatus: { in: ['not_paid', 'partial'] },
                status: 'active'
            },
            include: {
                payments: {
                    where: { dueDate: { not: null } },
                    orderBy: { dueDate: 'desc' }
                }
            }
        });

        const now = new Date();
        let totalRemaining = 0;
        let totalFutureRemaining = 0;

        activeUnpaidMemberships.forEach(m => {
            // Ищем любой платёж с будущим сроком оплаты
            const futurePayment = m.payments.find(p => p.dueDate && new Date(p.dueDate) > now);
            
            if (futurePayment) {
                totalFutureRemaining += (m.remainingAmount || 0);
            } else {
                totalRemaining += (m.remainingAmount || 0);
            }
        });

        // Авто-синхронизация: проверяем и исправляем рассинхронизированные абонементы
        // Также проверяем ВСЕ активные абонементы (не только unpaid), чтобы ловить ошибки
        const allActiveMemberships = await prisma.membership.findMany({
            where: { studentId, status: 'active' },
            include: { payments: true }
        });

        let needRecalc = false;
        for (const m of allActiveMemberships) {
            const completedPayments = m.payments.filter(p => p.status === 'completed');
            const actualPaid = completedPayments.reduce((sum, p) => sum + p.amount, 0);
            const actualRemaining = Math.max(0, m.totalPrice - actualPaid);
            
            if (m.paidAmount !== actualPaid || m.remainingAmount !== actualRemaining) {
                let correctStatus = 'not_paid';
                if (actualRemaining <= 0) correctStatus = 'paid';
                else if (actualPaid > 0) correctStatus = 'partial';
                
                console.log(`🔄 Авто-фикс абонемента ${m.id}: paid ${m.paidAmount}→${actualPaid}, remaining ${m.remainingAmount}→${actualRemaining}`);
                await prisma.membership.update({
                    where: { id: m.id },
                    data: { paidAmount: actualPaid, remainingAmount: actualRemaining, paymentStatus: correctStatus }
                });
                needRecalc = true;
            }
        }

        // Пересчитываем totalRemaining/totalFutureRemaining если были исправления
        if (needRecalc) {
            const recalcMemberships = await prisma.membership.findMany({
                where: { studentId, paymentStatus: { in: ['not_paid', 'partial'] }, status: 'active' },
                include: { payments: { where: { dueDate: { not: null } }, orderBy: { dueDate: 'desc' } } }
            });
            
            totalRemaining = 0;
            totalFutureRemaining = 0;
            
            recalcMemberships.forEach(m => {
                const futurePayment = m.payments.find(p => p.dueDate && new Date(p.dueDate) > now);
                if (futurePayment) {
                    totalFutureRemaining += (m.remainingAmount || 0);
                } else {
                    totalRemaining += (m.remainingAmount || 0);
                }
            });
        }

        // Маппим для фронтенда (добавляем _id, форматируем membership)
        const mapped = payments.map(p => ({
            ...p,
            _id: p.id,
            // Фронтенд ожидает p.membership как _id строка (для сравнения)
            // Но также использует p.membership.type — поэтому храним объект
            membershipData: p.membership ? {
                ...p.membership,
                _id: p.membership.id,
                groupName: p.membership.group?.name || ''
            } : null,
            // Для обратной совместимости (p.membership == activeMembership._id в строковом сравнении)
            membership: p.membershipId,
            managerName: p.manager
                ? `${p.manager.name}${p.manager.lastName ? ' ' + p.manager.lastName : ''}`
                : null
        }));

        res.json({
            success: true,
            payments: mapped,
            summary: {
                totalPaid,
                totalRemaining,
                totalFutureRemaining,
                balance: totalPaid - (totalRemaining + totalFutureRemaining),
                currentBalance: totalPaid - totalRemaining,
                paymentsCount: payments.length
            }
        });
    } catch (error) {
        console.error('Get student payments error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения платежей' });
    }
});

// =====================================================
// POST /api/payments
// Создать платёж вручную (доплата за абонемент и т.д.)
// =====================================================
router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const {
            studentId, amount, type, membershipId,
            notes, teacherId, relatedPaymentId, paymentMethod
        } = req.body;

        if (!studentId || !amount || !type) {
            return res.status(400).json({
                success: false,
                error: 'Требуются поля: studentId, amount, type'
            });
        }

        const parsedAmount = parseInt(amount);

        // Создаём платёж
        const payment = await prisma.payment.create({
            data: {
                studentId,
                amount: parsedAmount,
                type,
                membershipId: membershipId || null,
                managerId: req.user.id,
                teacherId: teacherId || null,
                relatedPaymentId: relatedPaymentId || null,
                notes: notes || '',
                status: 'completed',
                paymentDate: new Date(),
                paymentMethod: paymentMethod || null
            }
        });

        // Если платёж привязан к абонементу — обновляем суммы абонемента
        if (membershipId) {
            const m = await prisma.membership.findUnique({ where: { id: membershipId } });
            if (m) {
                const newPaid = m.paidAmount + parsedAmount;
                const newRemaining = m.totalPrice - newPaid;

                let newPaymentStatus = 'not_paid';
                if (newRemaining <= 0) newPaymentStatus = 'paid';
                else if (newPaid > 0) newPaymentStatus = 'partial';

                await prisma.membership.update({
                    where: { id: membershipId },
                    data: {
                        paidAmount: newPaid,
                        remainingAmount: Math.max(0, newRemaining),
                        paymentStatus: newPaymentStatus
                    }
                });

                // Логируем в транзакциях абонемента
                await prisma.membershipTransaction.create({
                    data: {
                        membershipId,
                        type: 'add',
                        amount: 0, // Финансовая операция, не занятия
                        reason: `Доплата: ${parsedAmount}₸ (${type})`,
                        addedById: req.user.id
                    }
                });

                console.log(`💰 Абонемент ${membershipId} обновлён: оплачено ${newPaid}₸, осталось ${Math.max(0, newRemaining)}₸`);
            }
        }

        // Если это доплата к авансу — обновить связанный платёж
        if (relatedPaymentId) {
            await prisma.payment.update({
                where: { id: relatedPaymentId },
                data: { status: 'completed' }
            });
        }

        res.status(201).json({
            success: true,
            payment: { ...payment, _id: payment.id }
        });
    } catch (error) {
        console.error('Create payment error:', error);
        res.status(500).json({ success: false, error: 'Ошибка создания платежа' });
    }
});

// =====================================================
// GET /api/payments/:id
// Получить детали конкретного платежа
// =====================================================
router.get('/:id', authenticate, async (req, res) => {
    try {
        const payment = await prisma.payment.findUnique({
            where: { id: req.params.id },
            include: {
                student: { select: { name: true, lastName: true, phone: true } },
                manager: { select: { name: true, lastName: true } },
                teacher: { select: { name: true, lastName: true } },
                membership: { select: { type: true, totalClasses: true, totalPrice: true, paidAmount: true } }
            }
        });

        if (!payment) {
            return res.status(404).json({ success: false, error: 'Платеж не найден' });
        }

        res.json({ success: true, payment: { ...payment, _id: payment.id } });
    } catch (error) {
        console.error('Get payment error:', error);
        res.status(500).json({ success: false, error: 'Ошибка' });
    }
});

// =====================================================
// PATCH /api/payments/:id/due-date
// Изменить дату обещанного платежа (dueDate)
// =====================================================
router.patch('/:id/due-date', authenticate, requireAdmin, async (req, res) => {
    try {
        const { dueDate } = req.body;

        const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
        if (!payment) {
            return res.status(404).json({ success: false, error: 'Платёж не найден' });
        }

        const updated = await prisma.payment.update({
            where: { id: req.params.id },
            data: { dueDate: dueDate ? new Date(dueDate) : null }
        });

        res.json({ success: true, payment: { ...updated, _id: updated.id } });
    } catch (error) {
        console.error('Update dueDate error:', error);
        res.status(500).json({ success: false, error: 'Ошибка обновления даты' });
    }
});

// =====================================================
// DELETE /api/payments/:id
// Удалить платёж (отменяет его влияние на абонемент)
// =====================================================
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
        if (!payment) {
            return res.status(404).json({ success: false, error: 'Платеж не найден' });
        }

        // Если привязан к абонементу — откатываем суммы
        if (payment.membershipId) {
            const m = await prisma.membership.findUnique({ where: { id: payment.membershipId } });
            if (m) {
                const newPaid = Math.max(0, m.paidAmount - payment.amount);
                const newRemaining = m.totalPrice - newPaid;

                let newPaymentStatus = 'not_paid';
                if (newRemaining <= 0) newPaymentStatus = 'paid';
                else if (newPaid > 0) newPaymentStatus = 'partial';

                await prisma.membership.update({
                    where: { id: payment.membershipId },
                    data: {
                        paidAmount: newPaid,
                        remainingAmount: Math.max(0, newRemaining),
                        paymentStatus: newPaymentStatus
                    }
                });
            }
        }

        await prisma.payment.delete({ where: { id: req.params.id } });

        res.json({ success: true, message: 'Платеж удален' });
    } catch (error) {
        console.error('Delete payment error:', error);
        res.status(500).json({ success: false, error: 'Ошибка удаления' });
    }
});

module.exports = router;
