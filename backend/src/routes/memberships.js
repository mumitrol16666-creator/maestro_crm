const express = require('express');
const router = express.Router();
const Membership = require('../models/Membership');
const Student = require('../models/Student');
const { authenticate, adminOnly } = require('../middleware/auth');

// @route   POST /api/memberships
// @desc    Создать новый абонемент для ученика
// @access  Admin only
router.post('/', authenticate, adminOnly, async (req, res) => {
    try {
        const { studentId, groupId, type, startDate } = req.body;
        
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
        
        // Определить количество занятий по типу
        let totalClasses, daysToAdd;
        switch(type) {
            case 'trial':
                totalClasses = 1;
                daysToAdd = 1;
                break;
            case 'monthly':
                totalClasses = 8;
                daysToAdd = 30;
                break;
            case 'quarterly':
                totalClasses = 24;
                daysToAdd = 90;
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
            // ПРОДЛЕНИЕ: добавляем занятия к существующему абонементу
            const currentRemaining = existingMembership.classesRemaining || 0;
            const newTotal = currentRemaining + totalClasses;
            
            existingMembership.classesRemaining = newTotal;
            existingMembership.totalClasses += totalClasses;
            
            // Продлеваем срок действия
            const currentEnd = new Date(existingMembership.endDate);
            const now = new Date();
            const extendFrom = currentEnd > now ? currentEnd : now;
            const newEnd = new Date(extendFrom);
            newEnd.setDate(newEnd.getDate() + daysToAdd);
            existingMembership.endDate = newEnd;
            
            // Добавляем заморозки (по полу)
            const additionalFreezes = student.gender === 'female' ? 2 : 1;
            existingMembership.freezesAvailable += additionalFreezes;
            
            // Записываем транзакцию
            existingMembership.transactions.push({
                type: 'extension',
                amount: totalClasses,
                reason: `Продление: добавлен абонемент ${type}`,
                date: new Date(),
                addedBy: req.user._id
            });
            
            await existingMembership.save();
            membership = existingMembership;
            
            console.log(`🔄 Продлен абонемент для ${student.name}: +${totalClasses} занятий (было ${currentRemaining}, стало ${newTotal})`);
        } else {
            // НОВЫЙ АБОНЕМЕНТ: создаем с нуля
            const freezesAvailable = student.gender === 'female' ? 2 : 1;
            const start = startDate ? new Date(startDate) : new Date();
            const end = new Date(start);
            end.setDate(end.getDate() + daysToAdd);
            
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
                status: 'active'
            });
            
            // Обновить ссылку на активный абонемент в Student
            student.activeMembership = membership._id;
            await student.save();
            
            console.log(`💳 Создан новый абонемент ${type} для ${student.name}: ${totalClasses} занятий`);
        }
        
        res.status(201).json({
            success: true,
            membership
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
            .populate('transactions.freezeId');
        
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
        
        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Укажите корректное количество занятий'
            });
        }
        
        if (!reason) {
            return res.status(400).json({
                success: false,
                error: 'Укажите причину добавления'
            });
        }
        
        const membership = await Membership.findById(req.params.id);
        
        if (!membership) {
            return res.status(404).json({
                success: false,
                error: 'Абонемент не найден'
            });
        }
        
        await membership.addClasses(amount, reason, req.user._id);
        
        console.log(`➕ Админ ${req.user.name} добавил ${amount} занятий. Причина: ${reason}`);
        
        res.json({
            success: true,
            membership
        });
    } catch (error) {
        console.error('Add classes error:', error);
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

module.exports = router;



