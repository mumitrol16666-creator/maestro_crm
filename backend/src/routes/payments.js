const express = require('express');
const router = express.Router();
const Payment = require('../models/Payment');
const Membership = require('../models/Membership');
const Student = require('../models/Student');
const { authenticate, requireAdmin } = require('../middleware/auth');

// @route   POST /api/payments
// @desc    Создать платеж
// @access  Private (admin/sales_manager)
router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const {
            studentId,
            amount,
            type,
            paymentDate,
            membershipId,
            bookingId,
            relatedClassId,
            relatedPaymentId,
            teacherId,
            notes
        } = req.body;
        
        // Валидация
        if (!studentId || !amount || !type) {
            return res.status(400).json({
                success: false,
                error: 'Требуются поля: studentId, amount, type'
            });
        }
        
        // Менеджер = текущий пользователь (если sales_manager) или из req.user
        const managerId = req.user.role === 'sales_manager' ? req.user._id : req.user._id;
        
        // Создать платеж
        const payment = await Payment.create({
            student: studentId,
            manager: managerId,
            amount,
            type,
            paymentDate: paymentDate || new Date(),
            membership: membershipId || null,
            booking: bookingId || null,
            relatedClass: relatedClassId || null,
            relatedPayment: relatedPaymentId || null,
            teacher: teacherId || null,
            notes: notes || '',
            status: relatedPaymentId ? 'completed' : 'pending',  // Если доплата - completed
            commissionStatus: 'pending'
        });
        
        // Если есть связь с абонементом - обновить Membership
        if (membershipId) {
            const membership = await Membership.findById(membershipId);
            if (membership) {
                // Добавить платеж в массив
                membership.payments.push(payment._id);
                
                // Обновить суммы
                membership.paidAmount = (membership.paidAmount || 0) + amount;
                membership.remainingAmount = (membership.totalPrice || 0) - membership.paidAmount;
                
                // Обновить статус оплаты
                if (membership.remainingAmount <= 0) {
                    membership.paymentStatus = 'paid';
                } else if (membership.paidAmount > 0) {
                    membership.paymentStatus = 'partial';
                }
                
                await membership.save();
            }
        }
        
        // Если это доплата - обновить связанный аванс
        if (relatedPaymentId) {
            await Payment.findByIdAndUpdate(relatedPaymentId, {
                status: 'completed'
            });
        }
        
        res.status(201).json({
            success: true,
            payment: await payment.populate([
                { path: 'student', select: 'name lastName phone' },
                { path: 'manager', select: 'name lastName' },
                { path: 'teacher', select: 'name lastName' },
                { path: 'membership', select: 'type totalClasses' }
            ])
        });
    } catch (error) {
        console.error('Create payment error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при создании платежа'
        });
    }
});

// @route   GET /api/payments
// @desc    Получить список платежей (с фильтрами)
// @access  Private (admin/sales_manager)
router.get('/', authenticate, async (req, res) => {
    try {
        const { 
            managerId, 
            teacherId, 
            studentId, 
            type, 
            status, 
            month,  // '2024-10'
            page = 1, 
            limit = 50 
        } = req.query;
        
        // Проверка доступа
        const isAdmin = ['admin', 'super_admin', 'sales_manager'].includes(req.user.role);
        if (!isAdmin) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }
        
        const filter = {};
        
        // Фильтры
        if (managerId) filter.manager = managerId;
        if (teacherId) filter.teacher = teacherId;
        if (studentId) filter.student = studentId;
        if (type) filter.type = type;
        if (status) filter.status = status;
        
        // Фильтр по месяцу ('2024-10')
        if (month) {
            const [year, monthNum] = month.split('-');
            const startOfMonth = new Date(year, parseInt(monthNum) - 1, 1);
            const endOfMonth = new Date(year, parseInt(monthNum), 1);
            
            filter.paymentDate = {
                $gte: startOfMonth,
                $lt: endOfMonth
            };
        }
        
        // Пагинация
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;
        
        const [payments, total] = await Promise.all([
            Payment.find(filter)
                .populate('student', 'name lastName phone')
                .populate('manager', 'name lastName')
                .populate('teacher', 'name lastName')
                .populate('membership', 'type totalClasses')
                .populate('relatedPayment', 'amount type paymentDate')
                .sort({ paymentDate: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),
            Payment.countDocuments(filter)
        ]);
        
        res.json({
            success: true,
            payments,
            pagination: {
                total,
                page: pageNum,
                pages: Math.ceil(total / limitNum),
                limit: limitNum
            }
        });
    } catch (error) {
        console.error('Get payments error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении платежей'
        });
    }
});

// @route   GET /api/payments/student/:studentId
// @desc    Получить все платежи студента
// @access  Private
router.get('/student/:studentId', authenticate, async (req, res) => {
    try {
        const { studentId } = req.params;
        
        // Проверка доступа
        const isAdmin = ['admin', 'super_admin', 'sales_manager'].includes(req.user.role);
        const isOwnProfile = req.user._id.toString() === studentId;
        
        if (!isAdmin && !isOwnProfile) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }
        
        const payments = await Payment.find({ student: studentId })
            .populate('manager', 'name lastName')
            .populate('teacher', 'name lastName')
            .populate('membership', 'type totalClasses')
            .populate('relatedPayment', 'amount type paymentDate')
            .populate('relatedClass', 'title date startTime endTime')
            .sort({ paymentDate: -1 })
            .lean();
        
        // Подсчитать баланс
        const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
        
        // Найти активные абонементы с неоплаченным остатком
        const memberships = await Membership.find({
            student: studentId,
            paymentStatus: { $in: ['not_paid', 'partial'] }
        });
        
        const totalRemaining = memberships.reduce((sum, m) => sum + (m.remainingAmount || 0), 0);
        
        res.json({
            success: true,
            payments,
            summary: {
                totalPaid,
                totalRemaining,
                balance: totalPaid - totalRemaining
            }
        });
    } catch (error) {
        console.error('Get student payments error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении платежей студента'
        });
    }
});

// @route   GET /api/payments/:id
// @desc    Получить детали платежа
// @access  Private
router.get('/:id', authenticate, async (req, res) => {
    try {
        const payment = await Payment.findById(req.params.id)
            .populate('student', 'name lastName phone')
            .populate('manager', 'name lastName')
            .populate('teacher', 'name lastName')
            .populate('membership', 'type totalClasses totalPrice paidAmount')
            .populate('relatedPayment', 'amount type paymentDate status')
            .populate('relatedClass', 'title date startTime endTime')
            .populate('booking', 'name phone direction');
        
        if (!payment) {
            return res.status(404).json({
                success: false,
                error: 'Платеж не найден'
            });
        }
        
        res.json({
            success: true,
            payment
        });
    } catch (error) {
        console.error('Get payment error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении платежа'
        });
    }
});

// @route   PATCH /api/payments/:id
// @desc    Обновить платеж
// @access  Private (admin/super_admin)
router.patch('/:id', authenticate, async (req, res) => {
    try {
        const { amount, type, paymentDate, status, notes, teacherId } = req.body;
        
        const payment = await Payment.findById(req.params.id);
        
        if (!payment) {
            return res.status(404).json({
                success: false,
                error: 'Платеж не найден'
            });
        }
        
        // Обновляемые поля
        if (amount !== undefined) payment.amount = amount;
        if (type) payment.type = type;
        if (paymentDate) payment.paymentDate = paymentDate;
        if (status) payment.status = status;
        if (notes !== undefined) payment.notes = notes;
        if (teacherId !== undefined) payment.teacher = teacherId;
        
        await payment.save();
        
        // Если изменилась сумма и есть связь с абонементом - пересчитать
        if (amount !== undefined && payment.membership) {
            const membership = await Membership.findById(payment.membership);
            if (membership) {
                // Пересчитать paidAmount из всех платежей
                const allPayments = await Payment.find({ 
                    membership: payment.membership 
                });
                membership.paidAmount = allPayments.reduce((sum, p) => sum + p.amount, 0);
                membership.remainingAmount = membership.totalPrice - membership.paidAmount;
                
                // Обновить статус
                if (membership.remainingAmount <= 0) {
                    membership.paymentStatus = 'paid';
                } else if (membership.paidAmount > 0) {
                    membership.paymentStatus = 'partial';
                } else {
                    membership.paymentStatus = 'not_paid';
                }
                
                await membership.save();
            }
        }
        
        res.json({
            success: true,
            payment: await payment.populate([
                { path: 'student', select: 'name lastName phone' },
                { path: 'manager', select: 'name lastName' },
                { path: 'teacher', select: 'name lastName' }
            ])
        });
    } catch (error) {
        console.error('Update payment error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при обновлении платежа'
        });
    }
});

// @route   DELETE /api/payments/:id
// @desc    Удалить платеж
// @access  Private (super_admin only)
router.delete('/:id', authenticate, async (req, res) => {
    try {
        // Только super_admin
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен. Требуются права супер-администратора.'
            });
        }
        
        const payment = await Payment.findById(req.params.id);
        
        if (!payment) {
            return res.status(404).json({
                success: false,
                error: 'Платеж не найден'
            });
        }
        
        // Если есть связь с абонементом - обновить суммы
        if (payment.membership) {
            const membership = await Membership.findById(payment.membership);
            if (membership) {
                // Удалить из массива
                membership.payments = membership.payments.filter(
                    p => p.toString() !== payment._id.toString()
                );
                
                // Пересчитать суммы
                const remainingPayments = await Payment.find({
                    membership: payment.membership,
                    _id: { $ne: payment._id }
                });
                
                membership.paidAmount = remainingPayments.reduce((sum, p) => sum + p.amount, 0);
                membership.remainingAmount = membership.totalPrice - membership.paidAmount;
                
                // Обновить статус
                if (membership.paidAmount === 0) {
                    membership.paymentStatus = 'not_paid';
                } else if (membership.remainingAmount > 0) {
                    membership.paymentStatus = 'partial';
                } else {
                    membership.paymentStatus = 'paid';
                }
                
                await membership.save();
            }
        }
        
        await payment.deleteOne();
        
        res.json({
            success: true,
            message: 'Платеж удален'
        });
    } catch (error) {
        console.error('Delete payment error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при удалении платежа'
        });
    }
});

// @route   GET /api/payments/stats/monthly
// @desc    Статистика платежей за месяц (для дашборда)
// @access  Private (admin)
router.get('/stats/monthly', authenticate, requireAdmin, async (req, res) => {
    try {
        const { month } = req.query;  // '2024-10'
        
        let startOfMonth, endOfMonth;
        
        if (month) {
            const [year, monthNum] = month.split('-');
            startOfMonth = new Date(year, parseInt(monthNum) - 1, 1);
            endOfMonth = new Date(year, parseInt(monthNum), 1);
        } else {
            // Текущий месяц
            const now = new Date();
            startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        }
        
        const payments = await Payment.find({
            paymentDate: {
                $gte: startOfMonth,
                $lt: endOfMonth
            }
        });
        
        // Группировка по типам
        const stats = {
            total: payments.reduce((sum, p) => sum + p.amount, 0),
            count: payments.length,
            byType: {}
        };
        
        payments.forEach(p => {
            if (!stats.byType[p.type]) {
                stats.byType[p.type] = {
                    count: 0,
                    total: 0
                };
            }
            stats.byType[p.type].count++;
            stats.byType[p.type].total += p.amount;
        });
        
        res.json({
            success: true,
            stats,
            period: {
                start: startOfMonth,
                end: endOfMonth
            }
        });
    } catch (error) {
        console.error('Get monthly stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении статистики'
        });
    }
});

module.exports = router;
