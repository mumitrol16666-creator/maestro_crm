const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { autoRecoverStudent } = require('../utils/recovery');
const {
    parsePositiveMoney,
    calculatePaymentAdjustment,
    assertPaymentCanBeEdited,
    assertRefundAllowed,
} = require('../services/paymentPolicy');

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

        let parsedAmount;
        try {
            parsedAmount = parsePositiveMoney(amount);
        } catch {
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
        let parsedAmount;
        try {
            parsedAmount = parsePositiveMoney(amount);
        } catch {
            return res.status(400).json({ success: false, error: 'Сумма должна быть больше 0' });
        }

        const parsedDate = paymentDate ? new Date(paymentDate) : null;
        if (parsedDate && Number.isNaN(parsedDate.getTime())) {
            return res.status(400).json({ success: false, error: 'Некорректная дата платежа' });
        }

        const updated = await prisma.$transaction(async tx => {
            // Сериализуем параллельные исправления одного платежа.
            // Второй запрос увидит уже обновлённую сумму и применит только реальную разницу.
            const lockedPayments = await tx.$queryRaw`
                SELECT * FROM "Payment" WHERE id = ${req.params.id} FOR UPDATE
            `;
            const payment = lockedPayments[0];
            const refunded = payment
                ? await tx.payment.aggregate({
                    where: { relatedPaymentId: payment.id, status: 'refunded' },
                    _sum: { amount: true },
                })
                : { _sum: { amount: 0 } };
            const refundedAmount = refunded._sum.amount || 0;
            assertPaymentCanBeEdited(payment, parsedAmount, refundedAmount);

            const difference = calculatePaymentAdjustment(payment.amount, parsedAmount);
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
        let parsedAmount;
        try {
            parsedAmount = parsePositiveMoney(amount, 'Сумма возврата');
        } catch {
            parsedAmount = null;
        }
        if (!studentId || !parsedAmount) {
            return res.status(400).json({ success: false, error: 'Укажите ученика и сумму возврата' });
        }
        if (!reason || !String(reason).trim()) {
            return res.status(400).json({ success: false, error: 'Укажите причину возврата' });
        }

        const refund = await prisma.$transaction(async tx => {
            // Всегда блокируем исходный платёж до ученика. Такой же порядок использует
            // редактирование платежа — это исключает гонку и взаимную блокировку.
            let originalPayment = null;
            if (originalPaymentId) {
                const lockedPayments = await tx.$queryRaw`
                    SELECT * FROM "Payment" WHERE id = ${originalPaymentId} FOR UPDATE
                `;
                originalPayment = lockedPayments[0] || null;
            }
            const lockedStudents = await tx.$queryRaw`
                SELECT id, name, "lastName", "accountBalance"
                FROM "Student" WHERE id = ${studentId} FOR UPDATE
            `;
            const student = lockedStudents[0];
            if (!student) {
                const error = new Error('Ученик не найден');
                error.code = 'STUDENT_NOT_FOUND';
                throw error;
            }
            if (
                originalPaymentId
                && (!originalPayment
                    || originalPayment.studentId !== studentId
                    || originalPayment.status !== 'completed')
            ) {
                const error = new Error('Исходный платёж недоступен для возврата');
                error.code = 'ORIGINAL_PAYMENT_NOT_REFUNDABLE';
                throw error;
            }

            let alreadyRefunded = 0;
            if (originalPaymentId) {
                const currentRefunds = await tx.payment.aggregate({
                    where: {
                        relatedPaymentId: originalPaymentId,
                        status: 'refunded',
                    },
                    _sum: { amount: true },
                });
                alreadyRefunded = currentRefunds._sum.amount || 0;
            }
            assertRefundAllowed({
                studentBalance: student.accountBalance,
                refundAmount: parsedAmount,
                originalPaymentAmount: originalPayment?.amount ?? null,
                alreadyRefunded,
            });

            await tx.student.update({
                where: { id: studentId },
                data: { accountBalance: { decrement: parsedAmount } },
            });
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
        if (error.code === 'STUDENT_NOT_FOUND') {
            return res.status(404).json({ success: false, error: error.message });
        }
        if ([
            'ORIGINAL_PAYMENT_NOT_REFUNDABLE',
            'REFUND_EXCEEDS_BALANCE',
            'REFUND_EXCEEDS_PAYMENT',
        ].includes(error.code)) {
            return res.status(400).json({ success: false, error: error.message });
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
        await prisma.$transaction(async (tx) => {
            const lockedPayments = await tx.$queryRaw`
                SELECT * FROM "Payment" WHERE id = ${req.params.id} FOR UPDATE
            `;
            const payment = lockedPayments[0];
            if (!payment) {
                const error = new Error('Платёж не найден');
                error.code = 'PAYMENT_NOT_FOUND';
                throw error;
            }
            if (payment.status !== 'completed') {
                const error = new Error('Возвратную или отменённую операцию удалять нельзя');
                error.code = 'PAYMENT_DELETE_FORBIDDEN';
                throw error;
            }
            const refunds = await tx.payment.count({
                where: { relatedPaymentId: payment.id, status: 'refunded' },
            });
            if (refunds > 0) {
                const error = new Error('Нельзя удалить платёж, по которому уже был возврат');
                error.code = 'PAYMENT_HAS_REFUNDS';
                throw error;
            }
            await tx.$queryRaw`
                SELECT id FROM "Student" WHERE id = ${payment.studentId} FOR UPDATE
            `;
            await tx.student.update({
                where: { id: payment.studentId },
                data: { accountBalance: { decrement: payment.amount } }
            });
            await tx.payment.delete({ where: { id: payment.id } });
        });

        res.json({ success: true, message: 'Платеж удален' });
    } catch (error) {
        console.error('Delete payment error:', error);
        if (error.code === 'PAYMENT_NOT_FOUND') {
            return res.status(404).json({ success: false, error: error.message });
        }
        if (['PAYMENT_DELETE_FORBIDDEN', 'PAYMENT_HAS_REFUNDS'].includes(error.code)) {
            return res.status(409).json({ success: false, error: error.message });
        }
        res.status(500).json({ success: false, error: 'Ошибка удаления' });
    }
});

module.exports = router;
