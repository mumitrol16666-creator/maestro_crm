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
        const totalPaid = payments.reduce((sum, payment) => {
            if (payment.status === 'completed') return sum + payment.amount;
            if (payment.status === 'refunded') return sum - payment.amount;
            return sum;
        }, 0);

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
        if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Сумма платежа должна быть положительным целым числом',
            });
        }

        // Phase 2: авто-возврат, если ученик помечен как потерянный
        if (studentId && req.user?.id) {
            await autoRecoverStudent(studentId, req.user.id, {
                source: 'payment',
                note: `Платёж ${parsedAmount}₸ (${normalizedType})`,
            });
        }

        const payment = await prisma.$transaction(async tx => {
            const created = await tx.payment.create({
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
                    paymentDate: req.body.paymentDate ? new Date(req.body.paymentDate) : new Date(),
                    paymentMethod: paymentMethod || null
                }
            });

            // Денежный баланс независим от абонемента: любое зачисление пополняет его.
            await tx.student.update({
                where: { id: studentId },
                data: { accountBalance: { increment: parsedAmount } }
            });

            // Реальные деньги на балансе закрывают пробную заявку как продажу.
            await tx.booking.updateMany({
                where: {
                    convertedToStudentId: studentId,
                    requestType: 'trial',
                    status: { not: 'sold' },
                },
                data: {
                    status: 'sold',
                    lossReason: null,
                    lossStage: null,
                    lostAt: null,
                },
            });

            if (relatedPaymentId) {
                await tx.payment.update({
                    where: { id: relatedPaymentId },
                    data: { status: 'completed' }
                });
            }

            return created;
        });

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
                membership: { select: { type: true, totalClasses: true, totalPrice: true, paidAmount: true } },
                relatedPayments: {
                    where: { status: 'refunded' },
                    select: { amount: true },
                },
            }
        });

        if (!payment) {
            return res.status(404).json({ success: false, error: 'Платеж не найден' });
        }

        const refundedAmount = payment.relatedPayments.reduce((sum, item) => sum + item.amount, 0);
        res.json({
            success: true,
            payment: {
                ...payment,
                _id: payment.id,
                refundedAmount,
                refundableAmount: Math.max(0, payment.amount - refundedAmount),
            },
        });
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
// PATCH /api/payments/:id
// Исправить ошибочно внесённые данные платежа.
// Баланс ученика корректируется только на разницу сумм.
// =====================================================
router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { amount, paymentDate, paymentMethod, notes } = req.body;
        const parsedAmount = Number.parseInt(amount, 10);
        if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ success: false, error: 'Сумма должна быть больше 0' });
        }

        const parsedDate = paymentDate ? new Date(paymentDate) : null;
        if (parsedDate && Number.isNaN(parsedDate.getTime())) {
            return res.status(400).json({ success: false, error: 'Некорректная дата платежа' });
        }

        const updated = await prisma.$transaction(async tx => {
            const payment = await tx.payment.findUnique({
                where: { id: req.params.id },
                include: {
                    relatedPayments: {
                        where: { status: 'refunded' },
                        select: { amount: true },
                    },
                },
            });
            if (!payment) {
                const error = new Error('Платёж не найден');
                error.code = 'PAYMENT_NOT_FOUND';
                throw error;
            }
            if (payment.status !== 'completed') {
                const error = new Error('Можно изменять только обычные проведённые платежи');
                error.code = 'PAYMENT_NOT_EDITABLE';
                throw error;
            }
            const refundedAmount = payment.relatedPayments.reduce((sum, item) => sum + item.amount, 0);
            if (parsedAmount < refundedAmount) {
                const error = new Error(`Сумма не может быть меньше уже возвращённых ${refundedAmount} ₸`);
                error.code = 'PAYMENT_BELOW_REFUNDS';
                throw error;
            }
            const difference = parsedAmount - payment.amount;
            if (difference !== 0) {
                await tx.student.update({
                    where: { id: payment.studentId },
                    data: { accountBalance: { increment: difference } },
                });
            }
            const result = await tx.payment.update({
                where: { id: payment.id },
                data: {
                    amount: parsedAmount,
                    paymentDate: parsedDate || payment.paymentDate,
                    paymentMethod: paymentMethod || null,
                    notes: notes?.trim() || null,
                },
            });
            return { result, difference };
        });

        res.json({
            success: true,
            payment: { ...updated.result, _id: updated.result.id },
            balanceAdjustment: updated.difference,
            message: 'Платёж изменён, баланс пересчитан',
        });
    } catch (error) {
        console.error('Update payment error:', error);
        if (error.code === 'PAYMENT_NOT_FOUND') {
            return res.status(404).json({ success: false, error: error.message });
        }
        if (['PAYMENT_NOT_EDITABLE', 'PAYMENT_BELOW_REFUNDS'].includes(error.code)) {
            return res.status(400).json({ success: false, error: error.message });
        }
        res.status(500).json({ success: false, error: 'Не удалось изменить платёж' });
    }
});

// =====================================================
// POST /api/payments/refund
// Возврат денег ученику с сохранением исходного платежа.
// =====================================================
router.post('/refund', authenticate, requireAdmin, async (req, res) => {
    try {
        const { studentId, amount, reason, paymentMethod, originalPaymentId } = req.body;
        const parsedAmount = Number.parseInt(amount, 10);
        if (!studentId || !Number.isInteger(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ success: false, error: 'Укажите ученика и сумму возврата' });
        }
        if (!reason || !String(reason).trim()) {
            return res.status(400).json({ success: false, error: 'Укажите причину возврата' });
        }

        const [student, originalPayment] = await Promise.all([
            prisma.student.findUnique({
                where: { id: studentId },
                select: { id: true, name: true, lastName: true, accountBalance: true },
            }),
            originalPaymentId
                ? prisma.payment.findUnique({
                    where: { id: originalPaymentId },
                    include: {
                        relatedPayments: {
                            where: { status: 'refunded' },
                            select: { amount: true },
                        },
                    },
                })
                : null,
        ]);
        if (!student) return res.status(404).json({ success: false, error: 'Ученик не найден' });
        if (parsedAmount > Math.max(0, student.accountBalance)) {
            return res.status(400).json({
                success: false,
                error: `На балансе доступно для возврата только ${Math.max(0, student.accountBalance)} ₸`,
            });
        }
        if (originalPaymentId) {
            if (!originalPayment || originalPayment.studentId !== studentId || originalPayment.status !== 'completed') {
                return res.status(400).json({ success: false, error: 'Исходный платёж недоступен для возврата' });
            }
            const alreadyRefunded = originalPayment.relatedPayments.reduce((sum, item) => sum + item.amount, 0);
            if (alreadyRefunded + parsedAmount > originalPayment.amount) {
                return res.status(400).json({
                    success: false,
                    error: `По этому платежу можно вернуть не больше ${originalPayment.amount - alreadyRefunded} ₸`,
                });
            }
        }

        const refund = await prisma.$transaction(async tx => {
            const balanceClaim = await tx.student.updateMany({
                where: {
                    id: studentId,
                    accountBalance: { gte: parsedAmount },
                },
                data: { accountBalance: { decrement: parsedAmount } },
            });
            if (balanceClaim.count !== 1) {
                const error = new Error('Баланс уже изменился. Обновите карточку и повторите возврат.');
                error.code = 'REFUND_BALANCE_CHANGED';
                throw error;
            }
            if (originalPaymentId) {
                const currentRefunds = await tx.payment.aggregate({
                    where: {
                        relatedPaymentId: originalPaymentId,
                        status: 'refunded',
                    },
                    _sum: { amount: true },
                });
                if ((currentRefunds._sum.amount || 0) + parsedAmount > originalPayment.amount) {
                    const error = new Error('По исходному платежу уже оформлен другой возврат');
                    error.code = 'REFUND_LIMIT_CHANGED';
                    throw error;
                }
            }
            const created = await tx.payment.create({
                data: {
                    studentId,
                    amount: parsedAmount,
                    type: originalPayment?.type || 'membership_full',
                    managerId: req.user.id,
                    status: 'refunded',
                    relatedPaymentId: originalPaymentId || null,
                    notes: String(reason).trim(),
                    paymentMethod: paymentMethod || originalPayment?.paymentMethod || null,
                    paymentDate: new Date(),
                },
            });
            await tx.cashTransaction.create({
                data: {
                    type: 'expense',
                    amount: parsedAmount,
                    category: 'refund',
                    description: `Возврат средств: ${student.name} ${student.lastName || ''}`.trim(),
                    date: new Date(),
                    createdById: req.user.id,
                    relatedPaymentId: created.id,
                    notes: String(reason).trim(),
                },
            });
            return created;
        });

        res.status(201).json({
            success: true,
            refund: { ...refund, _id: refund.id },
            message: `Возврат ${parsedAmount} ₸ оформлен`,
        });
    } catch (error) {
        console.error('Refund payment error:', error);
        if (['REFUND_BALANCE_CHANGED', 'REFUND_LIMIT_CHANGED'].includes(error.code)) {
            return res.status(409).json({ success: false, error: error.message });
        }
        res.status(500).json({ success: false, error: 'Не удалось оформить возврат' });
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
