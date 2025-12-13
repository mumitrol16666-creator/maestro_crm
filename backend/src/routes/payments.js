const express = require('express');
const router = express.Router();
const Payment = require('../models/Payment');
const Membership = require('../models/Membership');
const Student = require('../models/Student');
const CashTransaction = require('../models/CashTransaction');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { cacheUtils } = require('../config/redis');

// @route   POST /api/payments
// @desc    Создать платеж
// @access  Private (admin/sales_manager)
router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
        console.log(`💰 POST /api/payments - Request body:`, req.body);
        
        const {
            studentId,
            student,  // На случай если передали student вместо studentId
            amount,
            type,
            paymentDate,
            membershipId,
            membership,  // На случай если передали membership вместо membershipId
            bookingId,
            relatedClassId,
            relatedPaymentId,
            teacherId,
            notes
        } = req.body;
        
        // Поддерживаем оба формата для обратной совместимости
        const finalStudentId = studentId || student;
        const finalMembershipId = membershipId || membership;
        
        // Валидация
        if (!finalStudentId || !amount || !type) {
            console.error(`❌ Validation failed:`, { studentId: finalStudentId, amount, type });
            return res.status(400).json({
                success: false,
                error: 'Требуются поля: studentId (или student), amount, type'
            });
        }
        
        console.log(`💰 Creating payment:`, { studentId: finalStudentId, amount, type, membershipId: finalMembershipId });
        
        // Менеджер = текущий пользователь
        const managerId = req.user._id;
        
        // 🛡️ ЗАЩИТА ОТ ДУБЛИРОВАНИЯ: Проверка на дубликаты
        // Ищем похожие платежи за последние 5 минут
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const duplicateCheck = {
            student: finalStudentId,
            amount: amount,
            type: type,
            manager: managerId,
            paymentDate: { $gte: fiveMinutesAgo },
            status: { $ne: 'cancelled' } // Не учитываем отмененные
        };
        
        // Если есть membershipId, добавляем его в проверку
        if (finalMembershipId) {
            duplicateCheck.membership = finalMembershipId;
        }
        
        const existingPayment = await Payment.findOne(duplicateCheck);
        
        if (existingPayment) {
            console.warn(`⚠️  Обнаружен дубликат платежа! Существующий платеж: ${existingPayment._id}`);
            console.warn(`   Создан: ${existingPayment.paymentDate}, Сумма: ${existingPayment.amount}₸, Тип: ${existingPayment.type}`);
            
            return res.status(409).json({
                success: false,
                error: 'Похожий платеж уже был создан недавно. Возможно, произошло дублирование.',
                duplicatePayment: {
                    id: existingPayment._id,
                    amount: existingPayment.amount,
                    type: existingPayment.type,
                    paymentDate: existingPayment.paymentDate
                }
            });
        }
        
        // Создать платеж
        const payment = await Payment.create({
            student: finalStudentId,
            manager: managerId,
            amount,
            type,
            paymentDate: paymentDate || new Date(),
            membership: finalMembershipId || null,
            booking: bookingId || null,
            relatedClass: relatedClassId || null,
            relatedPayment: relatedPaymentId || null,
            teacher: teacherId || null,
            notes: notes || '',
            status: 'completed',  // ✅ Все платежи через этот endpoint - completed
            commissionStatus: 'pending'
        });
        
        console.log(`✅ Payment created: ${payment._id}`);
        
        // Если есть связь с абонементом - обновить Membership
        if (finalMembershipId) {
            const membership = await Membership.findById(finalMembershipId);
            if (membership) {
                // 🔄 АВТОМАТИЧЕСКАЯ КОНВЕРТАЦИЯ: если к пробному добавляется полная оплата >= 20,000₸
                if (membership.type === 'trial' && type === 'membership_full' && amount >= 20000) {
                    console.log(`🔄 АВТОМАТИЧЕСКАЯ КОНВЕРТАЦИЯ пробного в месячный (полная оплата ${amount}₸ через /api/payments)`);
                    
                    // Сохраняем оставшиеся занятия от пробного
                    const trialClassesRemaining = membership.classesRemaining || 0;
                    
                    // Конвертируем в месячный + ДОБАВЛЯЕМ 8 занятий к оставшимся
                    membership.type = 'monthly';
                    membership.totalClasses = trialClassesRemaining + 8;
                    membership.classesRemaining = trialClassesRemaining + 8;
                    membership.totalPrice = 22000;
                    membership.paidAmount = 22000;
                    membership.remainingAmount = 0;
                    membership.paymentStatus = 'paid';
                    membership.payments.push(payment._id);
                    
                    // Продлить срок
                    const newEndDate = new Date();
                    newEndDate.setDate(newEndDate.getDate() + 30);
                    membership.endDate = newEndDate;
                    
                    // Транзакция
                    membership.transactions.push({
                        type: 'extension',
                        amount: 8,  // Добавлено 8 занятий месячного
                        reason: `Автоматическая конвертация пробного в месячный (через /api/payments). Было ${trialClassesRemaining} занятий, добавлено 8, итого ${trialClassesRemaining + 8}`,
                        date: new Date(),
                        addedBy: managerId
                    });
                    
                    await membership.save();
                    
                    console.log(`✅ Пробный автоматически конвертирован в месячный. Было ${trialClassesRemaining}, стало ${trialClassesRemaining + 8}`);
                } else {
                    // Обычное добавление платежа (не конвертация)
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
        
        // 🚀 Redis кэширование
        const cacheKey = `payments:${managerId || 'all'}:${teacherId || 'all'}:${studentId || 'all'}:${type || 'all'}:${status || 'all'}:${month || 'all'}:${page}:${limit}`;
        const cachedData = await cacheUtils.get(cacheKey);
        if (cachedData) {
            console.log('📦 Cache HIT for payments');
            return res.json(cachedData);
        }
        console.log('🔄 Cache MISS for payments - fetching from DB');
        
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
                .populate('membership', 'type totalClasses', { strictPopulate: false })
                .populate('relatedPayment', 'amount type paymentDate')
                .sort({ paymentDate: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),
            Payment.countDocuments(filter)
        ]);
        
        const responseData = {
            success: true,
            payments,
            pagination: {
                total,
                page: pageNum,
                pages: Math.ceil(total / limitNum),
                limit: limitNum
            }
        };
        
        // 🚀 Кэшируем результат на 2 минуты
        await cacheUtils.set(cacheKey, responseData, 120);
        console.log('💾 Cached payments data');
        
        res.json(responseData);
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
        
        console.log(`💰 GET /api/payments/student/${studentId} - запрос от ${req.user.name}`);
        
        // Проверка доступа
        const isAdmin = ['admin', 'super_admin', 'sales_manager'].includes(req.user.role);
        const isOwnProfile = req.user._id.toString() === studentId;
        
        if (!isAdmin && !isOwnProfile) {
            console.log(`❌ Доступ запрещен для ${req.user.name}`);
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }
        
        // Не используем populate для manager/teacher - используем сохраненные имена
        const payments = await Payment.find({ student: studentId })
            .populate('membership', 'type totalClasses', { strictPopulate: false })
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
        
        console.log(`💰 GET /api/payments/student/${studentId} - Found ${payments.length} payments`, { totalPaid, totalRemaining });
        
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
            .populate('membership', 'type totalClasses totalPrice paidAmount', { strictPopulate: false })
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
        
        // 🗑️ Удалить связанные транзакции из кассы
        const cashTransactions = await CashTransaction.find({ relatedPayment: payment._id });
        for (const cashTx of cashTransactions) {
            await CashTransaction.deleteOne({ _id: cashTx._id });
            console.log(`🗑️ Удалена транзакция кассы: ${cashTx._id} (${cashTx.amount}₸)`);
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

// @route   POST /api/payments/fix-valeria-duplicate
// @desc    Исправить дублирующиеся платежи для ученика Валерия Валерия
// @access  Private (super_admin only)
router.post('/fix-valeria-duplicate', authenticate, async (req, res) => {
    try {
        // Только super_admin
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен. Требуются права супер-администратора.'
            });
        }

        console.log('🔧 Запуск исправления данных для Валерия Валерия...');

        // Найти ученика "Валерия Валерия"
        const student = await Student.findOne({
            $or: [
                { name: 'Валерия', lastName: 'Валерия' },
                { name: /Валерия/i, lastName: /Валерия/i }
            ]
        });

        if (!student) {
            return res.status(404).json({
                success: false,
                error: 'Ученик "Валерия Валерия" не найден'
            });
        }

        // Получить все платежи ученика
        const payments = await Payment.find({ student: student._id }).sort({ paymentDate: 1 });
        
        // Найти дублирующиеся платежи по 5000
        const advancePayments = payments.filter(p => p.amount === 5000 && p.type === 'membership_advance');
        
        const results = {
            studentId: student._id,
            studentName: `${student.name} ${student.lastName}`,
            foundPayments: payments.length,
            duplicatePayments: advancePayments.length > 1 ? advancePayments.length - 1 : 0,
            deletedPayments: [],
            deletedCashTransactions: [],
            updatedMemberships: []
        };

        // Удалить дубликаты
        if (advancePayments.length > 1) {
            const keepPayment = advancePayments[0];
            const duplicatePayments = advancePayments.slice(1);
            
            for (const dup of duplicatePayments) {
                // 🗑️ Удалить связанные транзакции из кассы
                const cashTransactions = await CashTransaction.find({ relatedPayment: dup._id });
                for (const cashTx of cashTransactions) {
                    await CashTransaction.deleteOne({ _id: cashTx._id });
                    results.deletedCashTransactions = results.deletedCashTransactions || [];
                    results.deletedCashTransactions.push(cashTx._id.toString());
                }
                
                // Если платеж связан с абонементом, удаляем его из массива payments
                if (dup.membership) {
                    const membership = await Membership.findById(dup.membership);
                    if (membership) {
                        membership.payments = membership.payments.filter(
                            p => p.toString() !== dup._id.toString()
                        );
                        
                        // Пересчитать суммы
                        const remainingPayments = await Payment.find({
                            membership: dup.membership,
                            _id: { $ne: dup._id }
                        });
                        
                        membership.paidAmount = remainingPayments.reduce((sum, p) => sum + p.amount, 0);
                        membership.remainingAmount = membership.totalPrice - membership.paidAmount;
                        
                        if (membership.paidAmount === 0) {
                            membership.paymentStatus = 'not_paid';
                        } else if (membership.remainingAmount > 0) {
                            membership.paymentStatus = 'partial';
                        } else {
                            membership.paymentStatus = 'paid';
                        }
                        
                        await membership.save();
                        results.updatedMemberships.push({
                            membershipId: membership._id,
                            paidAmount: membership.paidAmount,
                            remainingAmount: membership.remainingAmount
                        });
                    }
                }
                
                await Payment.deleteOne({ _id: dup._id });
                results.deletedPayments.push(dup._id.toString());
            }
        }

        // Исправить количество занятий в абонементах
        const memberships = await Membership.find({ student: student._id });
        const remainingPayments = await Payment.find({ student: student._id }).sort({ paymentDate: 1 });
        
        for (const membership of memberships) {
            const membershipPayments = remainingPayments.filter(p => 
                p.membership && p.membership.toString() === membership._id.toString()
            );
            const totalPaid = membershipPayments.reduce((sum, p) => sum + p.amount, 0);
            
            if (membership.totalClasses > 11 || membership.classesRemaining > 11) {
                if (totalPaid === 5000) {
                    membership.type = 'monthly_12';
                    membership.totalClasses = 11;
                    membership.classesRemaining = 11;
                    membership.totalPrice = 18000; // 5000 + 13000
                    membership.remainingAmount = 13000;
                    membership.paymentStatus = 'partial';
                    await membership.save();
                }
            } else if (totalPaid === 5000 && membership.remainingAmount !== 13000) {
                membership.remainingAmount = 13000;
                membership.totalPrice = totalPaid + membership.remainingAmount;
                await membership.save();
            }
        }

        // Финальная статистика
        const finalPayments = await Payment.find({ student: student._id }).sort({ paymentDate: 1 });
        const finalMemberships = await Membership.find({ student: student._id });
        
        const totalPaid = finalPayments.reduce((sum, p) => sum + p.amount, 0);
        const totalClasses = finalMemberships.reduce((sum, m) => sum + (m.classesRemaining || 0), 0);
        const finalRemaining = finalMemberships
            .filter(m => m.paymentStatus !== 'paid')
            .reduce((sum, m) => sum + (m.remainingAmount || 0), 0);

        results.finalStats = {
            paymentsCount: finalPayments.length,
            totalPaid,
            totalClasses,
            totalRemaining: finalRemaining
        };

        console.log('✅ Исправление завершено:', results);

        res.json({
            success: true,
            message: 'Данные успешно исправлены',
            results
        });
    } catch (error) {
        console.error('Fix Valeria duplicate error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при исправлении данных: ' + error.message
        });
    }
});

module.exports = router;
