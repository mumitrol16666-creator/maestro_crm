const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { autoRecoverStudent } = require('../utils/recovery');

// =====================================================
// GET /api/payments/student/:studentId
// Получить ВСЕ платежи ученика (для профиля)
// Включает: связь с абонементом, менеджера, заметки
// =====================================================
router.get('/student/:studentId', authenticate, async (req, res) => {
    try {
        const { studentId } = req.params;

        const [payments, balanceStudent] = await Promise.all([
            prisma.payment.findMany({
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
            }),
            prisma.student.findUnique({ where: { id: studentId }, select: { accountBalance: true } })
        ]);

        // Подсчёт общей суммы оплаченного
        const totalPaid = payments
            .filter(p => p.status === 'completed')
            .reduce((sum, p) => sum + p.amount, 0);

        const totalRemaining = 0;
        const totalFutureRemaining = 0;

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
                balance: balanceStudent?.accountBalance || 0,
                currentBalance: balanceStudent?.accountBalance || 0,
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
            studentId, amount, type,
            notes, teacherId, relatedPaymentId, paymentMethod
        } = req.body;
        const normalizedType = type || 'membership_full';

        if (!studentId || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Требуются поля: studentId, amount'
            });
        }

        const parsedAmount = parseInt(amount);

        // Phase 2: авто-возврат, если ученик помечен как потерянный
        if (studentId && req.user?.id) {
            await autoRecoverStudent(studentId, req.user.id, {
                source: 'payment',
                note: `Платёж ${parsedAmount}₸ (${normalizedType})`,
            });
        }

        // Создаём платёж
        const payment = await prisma.payment.create({
            data: {
                studentId,
                amount: parsedAmount,
                type: normalizedType,
                membershipId: null,
                managerId: req.user.id,
                teacherId: teacherId || null,
                relatedPaymentId: relatedPaymentId || null,
                notes: notes || '',
                status: 'completed',
                paymentDate: new Date(),
                paymentMethod: paymentMethod || null
            }
        });

        // Денежный баланс независим от абонемента: любое зачисление пополняет его.
        await prisma.student.update({
            where: { id: studentId },
            data: { accountBalance: { increment: parsedAmount } }
        });

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
// Удалить платёж
// =====================================================
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
        if (!payment) {
            return res.status(404).json({ success: false, error: 'Платеж не найден' });
        }

        await prisma.student.update({
            where: { id: payment.studentId },
            data: { accountBalance: { decrement: payment.amount } }
        });

        await prisma.payment.delete({ where: { id: req.params.id } });

        res.json({ success: true, message: 'Платеж удален' });
    } catch (error) {
        console.error('Delete payment error:', error);
        res.status(500).json({ success: false, error: 'Ошибка удаления' });
    }
});

module.exports = router;
