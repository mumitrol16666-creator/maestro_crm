const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// @route   GET /api/memberships/student/:studentId
router.get('/student/:studentId', authenticate, async (req, res) => {
    try {
        const studentId = req.params.studentId;
        const memberships = await prisma.membership.findMany({
            where: { studentId },
            include: {
                group: { select: { id: true, name: true, schedules: true } },
                createdBy: { select: { name: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        
        // Маппим данные для фронтенда (добавляем _id и форматируем группу)
        const mappedMemberships = memberships.map(m => ({
            ...m,
            _id: m.id,
            groupId: m.group ? { ...m.group, _id: m.group.id } : null
        }));
        
        res.json({
            success: true,
            memberships: mappedMemberships
        });
    } catch (error) {
        console.error('Get student memberships error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения абонементов' });
    }
});

// @route   POST /api/memberships
router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const { studentId, groupId, type, startDate, totalPrice, paymentType, advanceAmount } = req.body;
        
        const start = startDate ? new Date(startDate) : new Date();
        const end = new Date(start);
        
        let totalClasses = 8;
        if (type === 'trial' || type === 'single_class' || type === 'individual_single') totalClasses = 1;
        else if (type === 'monthly_12') totalClasses = 12;
        else if (type === 'quarterly') totalClasses = 24;
        
        const days = (type === 'quarterly') ? 90 : 30;
        end.setDate(end.getDate() + days);

        // Определяем статус оплаты
        let paymentStatus = 'not_paid';
        let paidAmount = 0;
        if (paymentType === 'full') {
            paymentStatus = 'paid';
            paidAmount = totalPrice || 0;
        } else if (paymentType === 'advance') {
            paymentStatus = 'partial';
            paidAmount = advanceAmount || 0;
        }

        const membership = await prisma.membership.create({
            data: {
                studentId,
                groupId,
                type: type || 'monthly',
                totalClasses,
                classesRemaining: totalClasses,
                startDate: start,
                endDate: end,
                totalPrice: totalPrice || 0,
                paidAmount: paidAmount,
                remainingAmount: (totalPrice || 0) - paidAmount,
                paymentStatus,
                status: 'active',
                createdById: req.user.userId,
                source: 'manual'
            }
        });

        // Создаем платеж если была оплата
        if (paidAmount > 0) {
            await prisma.payment.create({
                data: {
                    studentId,
                    amount: paidAmount,
                    type: paymentType === 'full' ? 'membership_full' : 'membership_advance',
                    membershipId: membership.id,
                    managerId: req.user.userId,
                    status: 'completed',
                    paymentDate: new Date()
                }
            });
        }

        // Обновить активный абонемент у студента
        await prisma.student.update({
            where: { id: studentId },
            data: { activeMembershipId: membership.id }
        });

        res.status(201).json({ success: true, membership: { ...membership, _id: membership.id } });
    } catch (error) {
        console.error('Create membership error:', error);
        res.status(500).json({ success: false, error: 'Ошибка создания абонемента' });
    }
});

// @route   PATCH /api/memberships/:id/add-classes
router.patch('/:id/add-classes', authenticate, requireAdmin, async (req, res) => {
    try {
        const { amount, reason } = req.body;
        const membership = await prisma.membership.findUnique({ where: { id: req.params.id } });
        
        if (!membership) return res.status(404).json({ success: false, error: 'Абонемент не найден' });

        const updated = await prisma.membership.update({
            where: { id: req.params.id },
            data: {
                totalClasses: membership.totalClasses + amount,
                classesRemaining: membership.classesRemaining + amount,
                transactions: {
                    create: {
                        type: 'extension',
                        amount,
                        reason: reason || 'Добавление занятий',
                        addedById: req.user.userId
                    }
                }
            }
        });

        res.json({ success: true, membership: { ...updated, _id: updated.id } });
    } catch (error) {
        console.error('Add classes error:', error);
        res.status(500).json({ success: false, error: 'Ошибка' });
    }
});

// @route   PATCH /api/memberships/:id/remove-classes
router.patch('/:id/remove-classes', authenticate, requireAdmin, async (req, res) => {
    try {
        const { amount, reason } = req.body;
        const membership = await prisma.membership.findUnique({ where: { id: req.params.id } });
        
        if (!membership) return res.status(404).json({ success: false, error: 'Абонемент не найден' });

        const updated = await prisma.membership.update({
            where: { id: req.params.id },
            data: {
                classesRemaining: Math.max(0, membership.classesRemaining - amount),
                transactions: {
                    create: {
                        type: 'manual_deduct',
                        amount,
                        reason: reason || 'Списание занятий',
                        addedById: req.user.userId
                    }
                }
            }
        });

        res.json({ success: true, membership: { ...updated, _id: updated.id } });
    } catch (error) {
        console.error('Remove classes error:', error);
        res.status(500).json({ success: false, error: 'Ошибка' });
    }
});

module.exports = router;
