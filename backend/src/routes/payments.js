const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// @route   GET /api/payments/student/:studentId
router.get('/student/:studentId', authenticate, async (req, res) => {
    try {
        const { studentId } = req.params;
        const payments = await prisma.payment.findMany({
            where: { studentId },
            include: {
                manager: { select: { name: true, lastName: true } },
                membership: { select: { type: true, totalClasses: true } }
            },
            orderBy: { paymentDate: 'desc' }
        });

        const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

        // Найти активные абонементы с остатком оплаты
        const memberships = await prisma.membership.findMany({
            where: { studentId, paymentStatus: { in: ['not_paid', 'partial'] } }
        });

        const totalRemaining = memberships.reduce((sum, m) => sum + (m.remainingAmount || 0), 0);

        res.json({
            success: true,
            payments: payments.map(p => ({ ...p, _id: p.id })),
            summary: {
                totalPaid,
                totalRemaining,
                balance: totalPaid - totalRemaining
            }
        });
    } catch (error) {
        console.error('Get student payments error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения платежей' });
    }
});

// @route   POST /api/payments
router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const { studentId, amount, type, membershipId, notes } = req.body;
        
        const payment = await prisma.payment.create({
            data: {
                studentId,
                amount: parseInt(amount),
                type: type || 'membership_full',
                membershipId,
                    managerId: req.user.userId,
                notes: notes || '',
                status: 'completed',
                paymentDate: new Date()
            }
        });

        // Обновить абонемент если есть
        if (membershipId) {
            const m = await prisma.membership.findUnique({ where: { id: membershipId } });
            if (m) {
                const newPaid = m.paidAmount + parseInt(amount);
                const newRemaining = m.totalPrice - newPaid;
                await prisma.membership.update({
                    where: { id: membershipId },
                    data: {
                        paidAmount: newPaid,
                        remainingAmount: newRemaining,
                        paymentStatus: newRemaining <= 0 ? 'paid' : 'partial'
                    }
                });
            }
        }

        res.status(201).json({ success: true, payment: { ...payment, _id: payment.id } });
    } catch (error) {
        console.error('Create payment error:', error);
        res.status(500).json({ success: false, error: 'Ошибка создания платежа' });
    }
});

module.exports = router;
