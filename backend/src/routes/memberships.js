const express = require('express');
const router = express.Router();
const Membership = require('../models/Membership');
const Student = require('../models/Student');
const Payment = require('../models/Payment');
const { authenticate, adminOnly } = require('../middleware/auth');
const { cacheUtils } = require('../config/redis');

// @route   POST /api/memberships
// @desc    Создать новый абонемент для ученика
// @access  Admin only
router.post('/', authenticate, adminOnly, async (req, res) => {
    try {
        const { 
            studentId, 
            groupId, 
            type, 
            startDate,
            // 💰 Новые поля для платежей
            paymentType,      // 'full' | 'advance' | 'later'
            advanceAmount,    // Сумма аванса (если paymentType === 'advance')
            advanceDueDate,   // Срок оплаты остатка (если paymentType === 'advance')
            totalPrice        // Общая стоимость абонемента
        } = req.body;
        
        // 💰 Переменная для созданного платежа (объявляем в начале функции)
        let createdPayment = null;
        
        if (!studentId || !type) {
            return res.status(400).json({
                success: false,
                error: 'Требуется studentId и type'
            });
        }
        
        if (!groupId) {
            return res.status(400).json({
                success: false,
                error: 'Требуется groupId - ученик должен быть в группе'
            });
        }
        
        // Найти ученика
        const student = await Student.findById(studentId).populate('groups.groupId');
        if (!student) {
            return res.status(404).json({
                success: false,
                error: 'Ученик не найден'
            });
        }
        
        // Проверить что ученик в этой группе
        const isInGroup = student.groups.some(
            g => g.status === 'active' && g.groupId && g.groupId._id.toString() === groupId
        );
        
        if (!isInGroup) {
            return res.status(400).json({
                success: false,
                error: 'Ученик не прикреплён к этой группе'
            });
        }
        
        // ❌ ПРОВЕРКА: нельзя создать второе пробное занятие
        if (type === 'trial') {
            const existingTrial = await Membership.findOne({
                student: studentId,
                type: 'trial'
            });
            
            if (existingTrial) {
                return res.status(400).json({
                    success: false,
                    error: 'У ученика уже было пробное занятие. Используйте "Разовое занятие" вместо пробного.'
                });
            }
        }
        
        // Определить количество занятий по типу
        let totalClasses, daysToAdd;
        // 🎯 Проверяем: оплата авансом (рассрочка) или полностью
        const isAdvancePayment = paymentType === 'advance';
        
        switch(type) {
            case 'trial':
                totalClasses = 1;
                daysToAdd = 1;
                break;
            case 'monthly':
                // ✅ Полная оплата = 8 занятий, Аванс = 7 занятий (-1 за рассрочку)
                totalClasses = isAdvancePayment ? 7 : 8;
                daysToAdd = 30;
                console.log(`📊 Месячный абонемент: ${isAdvancePayment ? 'Аванс → 7 занятий' : 'Полная оплата → 8 занятий'}`);
                break;
            case 'quarterly':
                // ✅ Полная оплата = 24 занятия, Аванс = 23 занятия (-1 за рассрочку)
                totalClasses = isAdvancePayment ? 23 : 24;
                daysToAdd = 90;
                console.log(`📊 Квартальный абонемент: ${isAdvancePayment ? 'Аванс → 23 занятия' : 'Полная оплата → 24 занятия'}`);
                break;
            case 'single_class':
                totalClasses = 1;
                daysToAdd = 7;  // Разовое групповое - 7 дней
                break;
            case 'individual_single':
                totalClasses = 1;
                daysToAdd = 7;  // Разовое индивидуальное - 7 дней
                break;
            case 'individual_package':
                totalClasses = 8;
                daysToAdd = 90;  // 8 занятий - 90 дней (квартал)
                break;
            default:
                return res.status(400).json({
                    success: false,
                    error: 'Неверный тип абонемента'
                });
        }
        
        // Проверить есть ли активный абонемент
        let membership;
        const existingMembership = await Membership.findOne({
            student: studentId,
            status: 'active'
        });
        
        if (existingMembership) {
            // 🔍 ПРОВЕРКА АВТОКОНВЕРТАЦИИ: если trial + monthly + полная оплата >= 20000₸
            const willAutoConvert = (
                existingMembership.type === 'trial' && 
                type === 'monthly' && 
                paymentType === 'full' && 
                (totalPrice || 0) >= 20000
            );
            
            // Сохраняем текущее количество занятий для логов
            const currentRemaining = existingMembership.classesRemaining || 0;
            let newTotal = currentRemaining;  // Будет обновлено ниже
            
            if (willAutoConvert) {
                console.log(`🔄 Обнаружена автоконвертация! Пропускаем обычное добавление занятий.`);
                // НЕ добавляем занятия здесь - это сделает автоконвертация ниже
                // newTotal будет обновлен при автоконвертации
            } else {
                // ПРОДЛЕНИЕ: добавляем занятия к существующему абонементу
                newTotal = currentRemaining + totalClasses;
                
                existingMembership.classesRemaining = newTotal;
                existingMembership.totalClasses += totalClasses;
                
                // Продлеваем срок действия
                const currentEnd = new Date(existingMembership.endDate);
                const now = new Date();
                const extendFrom = currentEnd > now ? currentEnd : now;
                const newEnd = new Date(extendFrom);
                newEnd.setDate(newEnd.getDate() + daysToAdd);
                existingMembership.endDate = newEnd;
                
                // Заморозки добавляются для каждого полного цикла (8 занятий = 1 цикл)
                // При продлении на 8 занятий добавляется 1 или 2 заморозки
                const cyclesAdded = Math.floor(totalClasses / 8); // Сколько полных циклов по 8 занятий
                if (cyclesAdded > 0) {
                    const freezesPerCycle = student.gender === 'female' ? 2 : 1;
                    const additionalFreezes = cyclesAdded * freezesPerCycle;
                    existingMembership.freezesAvailable += additionalFreezes;
                    console.log(`➕ Добавлено заморозок: ${additionalFreezes} (${cyclesAdded} цикла по ${freezesPerCycle})`);
                }
                
                // Записываем транзакцию
                existingMembership.transactions.push({
                    type: 'extension',
                    amount: totalClasses,
                    reason: `Продление: добавлен абонемент ${type}`,
                    date: new Date(),
                    addedBy: req.user._id
                });
            }
            
            // 💰 СОЗДАНИЕ ПЛАТЕЖА ПРИ ПРОДЛЕНИИ (если указан тип оплаты)
            const price = totalPrice || 0;
            console.log(`💰 Extension payment check:`, { paymentType, price });
            
            if (paymentType && paymentType !== 'later' && price > 0) {
                let payment;
                console.log(`💰 Creating payment for extension with type: ${paymentType}`);
                
                if (paymentType === 'full') {
                    payment = await Payment.create({
                        student: studentId,
                        manager: req.user._id,
                        amount: price,
                        type: 'membership_full',
                        paymentDate: new Date(),
                        membership: existingMembership._id,
                        status: 'completed',
                        commissionStatus: 'pending'
                    });
                    
                    // 🔄 АВТОМАТИЧЕСКАЯ КОНВЕРТАЦИЯ: если пробный + полная оплата >= 20,000₸
                    if (existingMembership.type === 'trial' && price >= 20000) {
                        console.log(`🔄 АВТОМАТИЧЕСКАЯ КОНВЕРТАЦИЯ пробного в месячный при продлении (полная оплата ${price}₸)`);
                        
                        // Сохраняем оставшиеся занятия от пробного
                        const trialClassesRemaining = existingMembership.classesRemaining || 0;
                        
                        // Конвертируем в месячный + ДОБАВЛЯЕМ 8 занятий к оставшимся
                        existingMembership.type = 'monthly';
                        existingMembership.totalClasses = trialClassesRemaining + 8;
                        existingMembership.classesRemaining = trialClassesRemaining + 8;
                        existingMembership.totalPrice = 22000;  // Фиксированная цена месячного
                        existingMembership.paidAmount = 22000;
                        existingMembership.remainingAmount = 0;
                        existingMembership.paymentStatus = 'paid';
                        existingMembership.payments.push(payment._id);
                        
                        // Продлить срок на 30 дней
                        const newEndDate = new Date();
                        newEndDate.setDate(newEndDate.getDate() + 30);
                        existingMembership.endDate = newEndDate;
                        
                        // Транзакция
                        existingMembership.transactions.push({
                            type: 'extension',
                            amount: 8,  // Добавлено 8 занятий месячного
                            reason: `Автоматическая конвертация пробного в месячный (продление). Было ${trialClassesRemaining} занятий, добавлено 8, итого ${trialClassesRemaining + 8}`,
                            date: new Date(),
                            addedBy: req.user._id
                        });
                        
                        // Обновляем newTotal для правильных логов
                        newTotal = trialClassesRemaining + 8;
                        
                        console.log(`✅ Пробный автоматически конвертирован в месячный при продлении. Было ${trialClassesRemaining}, стало ${newTotal}`);
                    } else {
                        // Обычное продление (не конвертация)
                        existingMembership.totalPrice = (existingMembership.totalPrice || 0) + price;
                        existingMembership.paidAmount = (existingMembership.paidAmount || 0) + price;
                        existingMembership.payments.push(payment._id);
                    }
                    
                } else if (paymentType === 'advance' && advanceAmount) {
                    // 🔴 Расчет срока для аванса при продлении
                    const dueDate = advanceDueDate ? new Date(advanceDueDate) : (() => {
                        const d = new Date();
                        d.setDate(d.getDate() + 14);  // 14 дней по умолчанию
                        return d;
                    })();
                    const maxClasses = Math.ceil((existingMembership.classesRemaining + totalClasses) * 0.5);
                    
                    // ❌ ПРОДЛЕНИЕ = НЕ первый абонемент (менеджер НЕ получает комиссию от продлений)
                    payment = await Payment.create({
                        student: studentId,
                        manager: req.user._id,
                        amount: advanceAmount,
                        type: 'membership_advance',
                        paymentDate: new Date(),
                        membership: existingMembership._id,
                        status: 'completed',  // ✅ АВАНС УЖЕ ОПЛАЧЕН (деньги получены)
                        commissionStatus: 'excluded',  // ❌ Продление не учитывается в комиссии
                        isFirstMembershipForManager: false,  // ❌ Это НЕ первый абонемент
                        // 🔴 Поля для отслеживания ДОПЛАТЫ (остатка)
                        dueDate,  // Срок для ДОПЛАТЫ
                        maxClassesBeforePayment: maxClasses,  // Лимит занятий до ДОПЛАТЫ
                        notes: `Аванс при продлении ${advanceAmount}₸. Доплатить до ${dueDate.toLocaleDateString('ru')}: ${price - advanceAmount}₸`
                    });
                    
                    existingMembership.totalPrice = (existingMembership.totalPrice || 0) + price;
                    existingMembership.paidAmount = (existingMembership.paidAmount || 0) + advanceAmount;
                    existingMembership.remainingAmount = existingMembership.totalPrice - existingMembership.paidAmount;
                    existingMembership.paymentStatus = 'partial';
                    existingMembership.payments.push(payment._id);
                }
                
                createdPayment = payment;
                console.log(`💰 Payment created for extension! ID: ${payment._id}`);
            }
            
            await existingMembership.save();
            membership = existingMembership;
            
            // Обновляем ссылку на активный абонемент в Student (на случай если она отсутствует)
            if (!student.activeMembership || student.activeMembership.toString() !== existingMembership._id.toString()) {
                student.activeMembership = existingMembership._id;
                await student.save();
            }
            
            console.log(`🔄 Продлен абонемент для ${student.name}: +${totalClasses} занятий (было ${currentRemaining}, стало ${newTotal})`);
        } else {
            // НОВЫЙ АБОНЕМЕНТ: создаем с нуля
            const freezesAvailable = student.gender === 'female' ? 2 : 1;
            const start = startDate ? new Date(startDate) : new Date();
            const end = new Date(start);
            end.setDate(end.getDate() + daysToAdd);
            
            // Определить цену абонемента
            const price = totalPrice || 0;  // Из запроса или 0
            
            console.log(`💰 Creating membership with payment data:`, { totalPrice, paymentType, advanceAmount, price });
            
            membership = await Membership.create({
                student: studentId,
                group: groupId,
                type,
                totalClasses,
                classesRemaining: totalClasses,
                classesUsed: 0,
                startDate: start,
                endDate: end,
                freezesAvailable,
                freezesUsed: 0,
                createdBy: req.user._id,
                source: 'manual',
                transactions: [{
                    type: 'initial',
                    amount: totalClasses,
                    reason: `Создан абонемент ${type}`,
                    date: new Date(),
                    addedBy: req.user._id
                }],
                status: 'active',
                // 💰 Поля для платежей
                totalPrice: price,
                paidAmount: 0,
                remainingAmount: price,
                paymentStatus: 'not_paid',
                payments: []
            });
            
            // 💰 СОЗДАНИЕ ПЛАТЕЖА (если указан тип оплаты)
            console.log(`💰 Checking if should create payment:`, { paymentType, condition: paymentType && paymentType !== 'later' && price > 0 });
            
            if (paymentType && paymentType !== 'later' && price > 0) {
                let payment;
                console.log(`💰 Creating payment with type: ${paymentType}`);
                
                if (paymentType === 'full') {
                    // ✅ Определяем тип платежа в зависимости от типа абонемента
                    const paymentTypeValue = type === 'trial' ? 'trial_full' : 'membership_full';
                    
                    // ✅ НОВЫЙ АБОНЕМЕНТ = Первый абонемент (менеджер ПОЛУЧАЕТ комиссию)
                    payment = await Payment.create({
                        student: studentId,
                        manager: req.user._id,
                        amount: price,
                        type: paymentTypeValue,
                        paymentDate: new Date(),
                        membership: membership._id,
                        status: 'completed',
                        commissionStatus: 'pending',
                        isFirstMembershipForManager: true  // ✅ Это ПЕРВЫЙ абонемент
                    });
                    
                    // Обновить абонемент
                    membership.paidAmount = price;
                    membership.remainingAmount = 0;
                    membership.paymentStatus = 'paid';
                    membership.payments.push(payment._id);
                    
                } else if (paymentType === 'advance' && advanceAmount) {
                    // 🔴 Расчет срока для аванса
                    const dueDate = advanceDueDate ? new Date(advanceDueDate) : (() => {
                        const d = new Date(start);
                        d.setDate(d.getDate() + 14);  // 14 дней по умолчанию
                        return d;
                    })();
                    const maxClasses = Math.ceil(totalClasses * 0.5);  // 50% занятий
                    
                    // ✅ Определяем тип платежа в зависимости от типа абонемента
                    const paymentTypeValue = type === 'trial' ? 'trial_advance' : 'membership_advance';
                    
                    // ✅ НОВЫЙ АБОНЕМЕНТ с авансом = Первый абонемент (менеджер ПОЛУЧАЕТ комиссию)
                    payment = await Payment.create({
                        student: studentId,
                        manager: req.user._id,
                        amount: advanceAmount,
                        type: paymentTypeValue,
                        paymentDate: new Date(),
                        membership: membership._id,
                        status: 'completed',  // ✅ АВАНС УЖЕ ОПЛАЧЕН (деньги получены)
                        commissionStatus: 'pending',
                        isFirstMembershipForManager: true,  // ✅ Это ПЕРВЫЙ абонемент (аванс)
                        // 🔴 Поля для отслеживания ДОПЛАТЫ (остатка)
                        dueDate,  // Срок для ДОПЛАТЫ
                        maxClassesBeforePayment: maxClasses,  // Лимит занятий до ДОПЛАТЫ
                        notes: `Аванс ${advanceAmount}₸. Доплатить до ${dueDate.toLocaleDateString('ru')}: ${price - advanceAmount}₸`
                    });
                    
                    // Обновить абонемент
                    membership.paidAmount = advanceAmount;
                    membership.remainingAmount = price - advanceAmount;
                    membership.paymentStatus = 'partial';
                    membership.payments.push(payment._id);
                }
                
                await membership.save();
                createdPayment = payment;
                console.log(`💰 Payment created and saved! ID: ${payment._id}`);
            } else {
                console.log(`💰 Payment NOT created (paymentType: ${paymentType}, price: ${price})`);
            }
            
            // Обновить ссылку на активный абонемент в Student
            student.activeMembership = membership._id;
            await student.save();
            
            console.log(`💳 Создан новый абонемент ${type} для ${student.name}: ${totalClasses} занятий`);
        }
        
        res.status(201).json({
            success: true,
            membership,
            payment: createdPayment  // 💰 Возвращаем созданный платеж!
        });
    } catch (error) {
        console.error('Create membership error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при создании абонемента'
        });
    }
});

// @route   GET /api/memberships/:id
// @desc    Получить информацию об абонементе
// @access  Private
router.get('/:id', authenticate, async (req, res) => {
    try {
        const membership = await Membership.findById(req.params.id)
            .populate('student', 'name phone email gender')
            .populate('transactions.addedBy', 'name')
            .populate('transactions.freezeId')
            .populate('payments');
        
        if (!membership) {
            return res.status(404).json({
                success: false,
                error: 'Абонемент не найден'
            });
        }
        
        // Проверка доступа
        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
        const isOwnMembership = membership.student._id.toString() === req.user._id.toString();
        
        if (!isAdmin && !isOwnMembership) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }
        
        res.json({
            success: true,
            membership
        });
    } catch (error) {
        console.error('Get membership error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении абонемента'
        });
    }
});

// @route   PATCH /api/memberships/:id/add-classes
// @desc    Добавить занятия к абонементу (админ)
// @access  Admin only
router.patch('/:id/add-classes', authenticate, adminOnly, async (req, res) => {
    try {
        const { amount, reason } = req.body;
        
        console.log(`🔍 ADD CLASSES REQUEST:`, { membershipId: req.params.id, amount, reason, user: req.user.name });
        
        if (!amount || amount <= 0) {
            console.log(`❌ Неверное количество: ${amount}`);
            return res.status(400).json({
                success: false,
                error: 'Укажите корректное количество занятий'
            });
        }
        
        if (!reason || reason.trim() === '') {
            console.log(`❌ Причина не указана или пустая: "${reason}"`);
            return res.status(400).json({
                success: false,
                error: 'Укажите причину добавления занятий'
            });
        }
        
        const membership = await Membership.findById(req.params.id);
        
        if (!membership) {
            console.log(`❌ Абонемент не найден: ${req.params.id}`);
            return res.status(404).json({
                success: false,
                error: 'Абонемент не найден'
            });
        }
        
        console.log(`📋 Абонемент найден. Занятий до: ${membership.classesRemaining}`);
        
        await membership.addClasses(amount, reason.trim(), req.user._id);
        
        console.log(`✅ Админ ${req.user.name} добавил ${amount} занятий. Причина: ${reason}`);
        console.log(`📋 Занятий после: ${membership.classesRemaining}`);
        
        // Очистить кэш студентов, чтобы изменения сразу отображались
        try {
            await cacheUtils.delPattern('students:*');
            console.log('🗑️ Кэш студентов очищен');
        } catch (cacheError) {
            console.error('⚠️ Ошибка очистки кэша:', cacheError.message);
        }
        
        res.json({
            success: true,
            membership
        });
    } catch (error) {
        console.error('❌ Add classes error:', error);
        console.error('Error details:', {
            message: error.message,
            name: error.name,
            stack: error.stack
        });
        res.status(500).json({
            success: false,
            error: error.message || 'Ошибка при добавлении занятий'
        });
    }
});

// @route   GET /api/memberships/student/:studentId
// @desc    Получить абонементы ученика
// @access  Private
router.get('/student/:studentId', authenticate, async (req, res) => {
    try {
        const studentId = req.params.studentId;
        
        // Проверка доступа
        const isAdmin = ['admin', 'super_admin', 'sales_manager'].includes(req.user.role);
        const isOwnProfile = req.user._id.toString() === studentId;
        
        if (!isAdmin && !isOwnProfile) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }
        
        const memberships = await Membership.find({ student: studentId })
            .populate('transactions.addedBy', 'name')
            .populate('transactions.freezeId')
            .sort({ createdAt: -1 });
        
        res.json({
            success: true,
            memberships
        });
    } catch (error) {
        console.error('Get student memberships error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении абонементов'
        });
    }
});

// @route   GET /api/memberships/sales-stats/:managerId
// @desc    Получить статистику продаж менеджера
// @access  Private (Admin/Manager own stats)
router.get('/sales-stats/:managerId', authenticate, async (req, res) => {
    try {
        const managerId = req.params.managerId;
        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
        const isOwnStats = req.user._id.toString() === managerId;
        
        // Менеджер может видеть только свою статистику
        if (!isAdmin && !isOwnStats) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }
        
        const Booking = require('../models/Booking');
        
        // Период: текущий месяц
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        
        const endOfMonth = new Date();
        endOfMonth.setMonth(endOfMonth.getMonth() + 1);
        endOfMonth.setDate(0);
        endOfMonth.setHours(23, 59, 59, 999);
        
        // Статистика по заявкам
        const totalBookings = await Booking.countDocuments({
            processedBy: managerId,
            processedAt: { $gte: startOfMonth, $lte: endOfMonth }
        });
        
        const enrolledBookings = await Booking.countDocuments({
            processedBy: managerId,
            status: 'trial',  // Пробное занятие
            processedAt: { $gte: startOfMonth, $lte: endOfMonth }
        });
        
        // Статистика по абонементам
        const membershipStats = await Membership.aggregate([
            {
                $match: {
                    createdBy: new mongoose.Types.ObjectId(managerId),
                    createdAt: { $gte: startOfMonth, $lte: endOfMonth }
                }
            },
            {
                $group: {
                    _id: '$type',
                    count: { $sum: 1 }
                }
            }
        ]);
        
        // Преобразуем в объект
        const membershipsByType = {
            trial: 0,
            monthly: 0,
            quarterly: 0
        };
        
        membershipStats.forEach(stat => {
            membershipsByType[stat._id] = stat.count;
        });
        
        // Всего абонементов
        const totalMemberships = membershipsByType.trial + membershipsByType.monthly + membershipsByType.quarterly;
        
        // Абонементы из заявок vs вручную
        const membershipsFromBookings = await Membership.countDocuments({
            createdBy: managerId,
            source: 'booking',
            createdAt: { $gte: startOfMonth, $lte: endOfMonth }
        });
        
        const membershipsManual = await Membership.countDocuments({
            createdBy: managerId,
            source: 'manual',
            createdAt: { $gte: startOfMonth, $lte: endOfMonth }
        });
        
        res.json({
            success: true,
            period: {
                start: startOfMonth,
                end: endOfMonth
            },
            bookings: {
                total: totalBookings,
                enrolled: enrolledBookings,
                conversionRate: totalBookings > 0 ? Math.round((enrolledBookings / totalBookings) * 100) : 0
            },
            memberships: {
                total: totalMemberships,
                byType: membershipsByType,
                fromBookings: membershipsFromBookings,
                manual: membershipsManual
            }
        });
        
    } catch (error) {
        console.error('Get sales stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении статистики продаж'
        });
    }
});

// @route   GET /api/memberships/sales-stats-all
// @desc    Получить статистику продаж всех менеджеров (для админа)
// @access  Private (Admin only)
router.get('/sales-stats-all', authenticate, adminOnly, async (req, res) => {
    try {
        const Student = require('../models/Student');
        const Booking = require('../models/Booking');
        
        // Период: текущий месяц
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        
        const endOfMonth = new Date();
        endOfMonth.setMonth(endOfMonth.getMonth() + 1);
        endOfMonth.setDate(0);
        endOfMonth.setHours(23, 59, 59, 999);
        
        // Получить всех менеджеров и админов
        const managers = await Student.find({
            role: { $in: ['sales_manager', 'admin', 'super_admin'] }
        }).select('name role');
        
        const stats = [];
        
        for (const manager of managers) {
            // Заявки обработанные менеджером
            const bookingsProcessed = await Booking.countDocuments({
                processedBy: manager._id,
                processedAt: { $gte: startOfMonth, $lte: endOfMonth }
            });
            
            const bookingsEnrolled = await Booking.countDocuments({
                processedBy: manager._id,
                status: 'trial',  // Пробное занятие
                processedAt: { $gte: startOfMonth, $lte: endOfMonth }
            });
            
            // Абонементы созданные менеджером
            const membershipsCreated = await Membership.countDocuments({
                createdBy: manager._id,
                createdAt: { $gte: startOfMonth, $lte: endOfMonth }
            });
            
            // Разбивка по типам
            const membershipsByType = await Membership.aggregate([
                {
                    $match: {
                        createdBy: manager._id,
                        createdAt: { $gte: startOfMonth, $lte: endOfMonth }
                    }
                },
                {
                    $group: {
                        _id: '$type',
                        count: { $sum: 1 }
                    }
                }
            ]);
            
            const typeBreakdown = {
                trial: 0,
                monthly: 0,
                quarterly: 0
            };
            
            membershipsByType.forEach(stat => {
                typeBreakdown[stat._id] = stat.count;
            });
            
            stats.push({
                managerId: manager._id,
                managerName: manager.name,
                managerRole: manager.role,
                bookings: {
                    processed: bookingsProcessed,
                    enrolled: bookingsEnrolled,
                    conversionRate: bookingsProcessed > 0 ? Math.round((bookingsEnrolled / bookingsProcessed) * 100) : 0
                },
                memberships: {
                    total: membershipsCreated,
                    byType: typeBreakdown
                }
            });
        }
        
        // Сортировать по количеству продаж
        stats.sort((a, b) => b.memberships.total - a.memberships.total);
        
        res.json({
            success: true,
            period: {
                start: startOfMonth,
                end: endOfMonth
            },
            stats
        });
        
    } catch (error) {
        console.error('Get all sales stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении статистики продаж'
        });
    }
});

// @route   POST /api/memberships/:id/payment
// @desc    Добавить платеж к абонементу
// @access  Private (admin/sales_manager)
router.post('/:id/payment', authenticate, adminOnly, async (req, res) => {
    try {
        const { amount, notes, type: paymentTypeFromRequest } = req.body;
        
        console.log(`💰 Добавление платежа к абонементу:`, { membershipId: req.params.id, amount, type: paymentTypeFromRequest, notes });
        
        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Требуется сумма платежа'
            });
        }
        
        const membership = await Membership.findById(req.params.id);
        
        if (!membership) {
            return res.status(404).json({
                success: false,
                error: 'Абонемент не найден'
            });
        }
        
        // Определяем тип платежа
        let paymentType = paymentTypeFromRequest;
        let relatedPayment = null;
        
        // Ищем существующий аванс (для связи relatedPayment и для автоопределения типа)
        const advancePayment = await Payment.findOne({
            membership: membership._id,
            type: 'membership_advance',
            status: 'completed'
        }).sort({ paymentDate: 1 });
        
        // Если тип не указан - определяем автоматически (для обратной совместимости)
        if (!paymentType) {
            paymentType = advancePayment ? 'membership_balance' : 'membership_full';
            console.log(`💡 Тип определен автоматически: ${paymentType}`);
        }
        
        // Если это доплата к авансу - связываем платежи
        if (paymentType === 'membership_balance' && advancePayment) {
            relatedPayment = advancePayment._id;
        }
        
        console.log(`💰 Создание платежа:`, { type: paymentType, amount, relatedPayment: relatedPayment ? 'есть' : 'нет' });
        
        // 🔄 АВТОМАТИЧЕСКАЯ КОНВЕРТАЦИЯ: если к пробному добавляется полная оплата >= 20,000₸
        if (membership.type === 'trial' && paymentType === 'membership_full' && amount >= 20000) {
            console.log(`🔄 АВТОМАТИЧЕСКАЯ КОНВЕРТАЦИЯ пробного в месячный (полная оплата ${amount}₸)`);
            
            // Создать платеж
            const payment = await Payment.create({
                student: membership.student,
                manager: req.user._id,
                amount,
                type: 'membership_balance',  // Это доплата к пробному
                paymentDate: new Date(),
                membership: membership._id,
                relatedPayment,
                status: 'completed',
                commissionStatus: 'pending',
                isFirstMembershipForManager: false,
                notes: notes || 'Автоматическая конвертация пробного в месячный'
            });
            
            // Сохраняем оставшиеся занятия от пробного
            const trialClassesRemaining = membership.classesRemaining || 0;
            
            // Конвертируем в месячный + ДОБАВЛЯЕМ 8 занятий к оставшимся
            membership.type = 'monthly';
            membership.totalClasses = trialClassesRemaining + 8;
            membership.classesRemaining = trialClassesRemaining + 8;
            membership.totalPrice = 22000;
            membership.paidAmount = (membership.paidAmount || 0) + amount;
            membership.remainingAmount = 22000 - membership.paidAmount;
            membership.paymentStatus = membership.remainingAmount <= 0 ? 'paid' : 'partial';
            membership.payments.push(payment._id);
            
            // Продлить срок
            const newEndDate = new Date();
            newEndDate.setDate(newEndDate.getDate() + 30);
            membership.endDate = newEndDate;
            
            // Транзакция
            membership.transactions.push({
                type: 'extension',
                amount: 8,  // Добавлено 8 занятий месячного
                reason: `Автоматическая конвертация пробного в месячный. Было ${trialClassesRemaining} занятий, добавлено 8, итого ${trialClassesRemaining + 8}`,
                date: new Date(),
                addedBy: req.user._id
            });
            
            await membership.save();
            
            console.log(`✅ Пробный автоматически конвертирован в месячный`);
            
            return res.status(201).json({
                success: true,
                payment: await payment.populate([
                    { path: 'student', select: 'name lastName phone' },
                    { path: 'manager', select: 'name lastName' }
                ]),
                membership: {
                    totalPrice: membership.totalPrice,
                    paidAmount: membership.paidAmount,
                    remainingAmount: membership.remainingAmount,
                    paymentStatus: membership.paymentStatus,
                    type: membership.type,
                    classesRemaining: membership.classesRemaining
                },
                converted: true  // Флаг что была конвертация
            });
        }
        
        // Обычное добавление платежа (не конвертация)
        const payment = await Payment.create({
            student: membership.student,
            manager: req.user._id,
            amount,
            type: paymentType,
            paymentDate: new Date(),
            membership: membership._id,
            relatedPayment,
            status: 'completed',
            commissionStatus: 'pending',
            isFirstMembershipForManager: false,  // Добавление к существующему абонементу
            notes: notes || ''
        });
        
        // Обновить абонемент
        membership.paidAmount = (membership.paidAmount || 0) + amount;
        membership.remainingAmount = (membership.totalPrice || 0) - membership.paidAmount;
        membership.payments.push(payment._id);
        
        // Обновить статус оплаты
        if (membership.remainingAmount <= 0) {
            membership.paymentStatus = 'paid';
        } else {
            membership.paymentStatus = 'partial';
        }
        
        await membership.save();
        
        res.status(201).json({
            success: true,
            payment: await payment.populate([
                { path: 'student', select: 'name lastName phone' },
                { path: 'manager', select: 'name lastName' }
            ]),
            membership: {
                totalPrice: membership.totalPrice,
                paidAmount: membership.paidAmount,
                remainingAmount: membership.remainingAmount,
                paymentStatus: membership.paymentStatus
            }
        });
    } catch (error) {
        console.error('Add membership payment error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при добавлении платежа'
        });
    }
});

// @route   POST /api/memberships/:id/convert-to-monthly
// @desc    Конвертировать пробный абонемент в месячный
// @access  Private (admin/sales_manager)
router.post('/:id/convert-to-monthly', authenticate, adminOnly, async (req, res) => {
    try {
        const membershipId = req.params.id;
        
        console.log(`🔄 Конвертация пробного в месячный: ${membershipId}`);
        
        const membership = await Membership.findById(membershipId);
        
        if (!membership) {
            return res.status(404).json({
                success: false,
                error: 'Абонемент не найден'
            });
        }
        
        // Проверка что это действительно пробный
        if (membership.type !== 'trial') {
            return res.status(400).json({
                success: false,
                error: 'Это не пробный абонемент'
            });
        }
        
        // Проверка что пробный еще активен
        if (membership.status !== 'active') {
            return res.status(400).json({
                success: false,
                error: 'Пробный абонемент уже не активен'
            });
        }
        
        // Создать платеж-доплату (20,000₸)
        const conversionAmount = 20000;
        
        const payment = await Payment.create({
            student: membership.student,
            manager: req.user._id,
            amount: conversionAmount,
            type: 'membership_balance',  // Это доплата (конвертация пробного)
            paymentDate: new Date(),
            membership: membership._id,
            status: 'completed',
            commissionStatus: 'pending',
            isFirstMembershipForManager: false,  // Не первый (пробное было первым)
            notes: 'Конвертация пробного в месячный абонемент'
        });
        
        // Обновить абонемент
        membership.type = 'monthly';  // Меняем тип
        membership.totalClasses = 8;  // Месячный = 8 занятий
        membership.classesRemaining = 8 - (membership.classesUsed || 0);  // 8 минус использованные
        membership.totalPrice = 22000;  // Полная цена месячного
        membership.paidAmount = 2000 + conversionAmount;  // 2000 (пробное) + 20000 (доплата) = 22000
        membership.remainingAmount = 0;  // Полностью оплачено
        membership.paymentStatus = 'paid';
        membership.payments.push(payment._id);
        
        // Продлить срок на 30 дней от текущей даты
        const now = new Date();
        const newEndDate = new Date(now);
        newEndDate.setDate(newEndDate.getDate() + 30);
        membership.endDate = newEndDate;
        
        // Добавить транзакцию
        membership.transactions.push({
            type: 'extension',
            amount: 7,  // Добавлено занятий (8 - 1 уже использованное)
            reason: 'Конвертация пробного в месячный',
            date: new Date(),
            addedBy: req.user._id
        });
        
        await membership.save();
        
        console.log(`✅ Пробный конвертирован в месячный. Осталось занятий: ${membership.classesRemaining}`);
        
        // Очистить кэш студентов, чтобы изменения сразу отображались
        try {
            await cacheUtils.delPattern('students:*');
            console.log('🗑️ Кэш студентов очищен');
        } catch (cacheError) {
            console.error('⚠️ Ошибка очистки кэша:', cacheError.message);
        }
        
        res.json({
            success: true,
            message: 'Пробный абонемент конвертирован в месячный',
            payment,
            membership: {
                _id: membership._id,
                type: membership.type,
                totalClasses: membership.totalClasses,
                classesRemaining: membership.classesRemaining,
                totalPrice: membership.totalPrice,
                paidAmount: membership.paidAmount,
                remainingAmount: membership.remainingAmount,
                paymentStatus: membership.paymentStatus
            }
        });
    } catch (error) {
        console.error('Convert trial to monthly error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при конвертации: ' + error.message
        });
    }
});

module.exports = router;



