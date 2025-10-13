const express = require('express');
const router = express.Router();
const Freeze = require('../models/Freeze');
const Membership = require('../models/Membership');
const Student = require('../models/Student');
const Class = require('../models/Class');
const { authenticate, adminOnly } = require('../middleware/auth');

// @route   POST /api/freezes
// @desc    Создать заморозку (ученик или админ)
// @access  Private
router.post('/', authenticate, async (req, res) => {
    try {
        const { membershipId, type, startDate, endDate, reason } = req.body;
        
        if (!membershipId || !type || !startDate || !endDate) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        // Найти абонемент
        const membership = await Membership.findById(membershipId).populate('student');
        if (!membership) {
            return res.status(404).json({
                success: false,
                error: 'Абонемент не найден'
            });
        }
        
        const student = membership.student;
        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
        const isOwnMembership = student._id.toString() === req.user._id.toString();
        
        // Проверка доступа
        if (!isAdmin && !isOwnMembership) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }
        
        // Ученик может создавать только 'regular' и 'period'
        if (!isAdmin && !['regular', 'period'].includes(type)) {
            return res.status(403).json({
                success: false,
                error: 'Этот тип заморозки может создать только администратор'
            });
        }
        
        // Проверить доступность заморозок
        if (type === 'regular' || type === 'period') {
            if (membership.freezesUsed >= membership.freezesAvailable) {
                return res.status(400).json({
                    success: false,
                    error: 'Все бесплатные заморозки использованы'
                });
            }
        }
        
        // Проверить пол для менструации
        if (type === 'period' && student.gender !== 'female') {
            return res.status(400).json({
                success: false,
                error: 'Этот тип заморозки доступен только женщинам'
            });
        }
        
        // Подсчитать сколько занятий попадает в период заморозки
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        console.log('🔍 Freeze period:', { startDate, endDate, start, end });
        
        // Найти группы ученика
        const studentGroupIds = student.groups
            .filter(g => g.status === 'active')
            .map(g => g.groupId);
        
        console.log('👥 Student groups:', studentGroupIds);
        
        // Найти занятия в период заморозки
        const classesInPeriod = await Class.find({
            group: { $in: studentGroupIds },
            date: { $gte: start, $lte: end }
        });
        
        console.log('📅 Classes found in period:', classesInPeriod.length);
        
        const frozenClasses = classesInPeriod.length;
        
        if (frozenClasses === 0) {
            return res.status(400).json({
                success: false,
                error: 'В указанный период нет занятий'
            });
        }
        
        // Менструация: фиксировано макс 2 занятия
        let actualFrozenClasses = frozenClasses;
        if (type === 'period') {
            actualFrozenClasses = Math.min(frozenClasses, 2);
        }
        
        // Определить статус
        let status = 'pending';
        
        // Автоодобрение для regular и period
        if (type === 'regular' || type === 'period') {
            status = 'active';
        }
        
        // Создать заморозку
        const freeze = await Freeze.create({
            student: student._id,
            membership: membershipId,
            type,
            frozenClasses: actualFrozenClasses,
            classesUsed: 0,
            startDate: start,
            endDate: end,
            reason,
            createdBy: req.user._id,
            status
        });
        
        // Если автоодобрение - использовать слот заморозки
        if (status === 'active' && (type === 'regular' || type === 'period')) {
            await membership.useFreezeSlot(freeze._id);
        }
        
        console.log(`🧊 Создана заморозка ${type} для ${student.name}: ${actualFrozenClasses} занятий`);
        
        res.status(201).json({
            success: true,
            freeze
        });
    } catch (error) {
        console.error('Create freeze error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Ошибка при создании заморозки'
        });
    }
});

// @route   GET /api/freezes
// @desc    Получить все заморозки (для админа) или свои (для ученика)
// @access  Private
router.get('/', authenticate, async (req, res) => {
    try {
        const { status, studentId } = req.query;
        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
        
        let query = {};
        
        // Админ видит все, ученик только свои
        if (!isAdmin) {
            query.student = req.user._id;
        } else if (studentId) {
            query.student = studentId;
        }
        
        // Фильтр по статусу
        if (status) {
            query.status = status;
        }
        
        const freezes = await Freeze.find(query)
            .populate('student', 'name phone gender')
            .populate('membership')
            .populate('createdBy', 'name')
            .populate('processedBy', 'name')
            .sort({ createdAt: -1 });
        
        res.json({
            success: true,
            freezes
        });
    } catch (error) {
        console.error('Get freezes error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении заморозок'
        });
    }
});

// @route   GET /api/freezes/pending/count
// @desc    Получить количество заморозок на одобрении
// @access  Admin only
router.get('/pending/count', authenticate, adminOnly, async (req, res) => {
    try {
        const count = await Freeze.countDocuments({ status: 'pending' });
        
        res.json({
            success: true,
            count
        });
    } catch (error) {
        console.error('Get pending freezes count error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при подсчете заморозок'
        });
    }
});

// @route   PATCH /api/freezes/:id/approve
// @desc    Одобрить заморозку
// @access  Admin only
router.patch('/:id/approve', authenticate, adminOnly, async (req, res) => {
    try {
        const freeze = await Freeze.findById(req.params.id).populate('membership');
        
        if (!freeze) {
            return res.status(404).json({
                success: false,
                error: 'Заморозка не найдена'
            });
        }
        
        await freeze.approve(req.user._id);
        
        console.log(`✅ Админ ${req.user.name} одобрил заморозку ${freeze.type}`);
        
        res.json({
            success: true,
            freeze
        });
    } catch (error) {
        console.error('Approve freeze error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Ошибка при одобрении заморозки'
        });
    }
});

// @route   PATCH /api/freezes/:id/reject
// @desc    Отклонить заморозку
// @access  Admin only
router.patch('/:id/reject', authenticate, adminOnly, async (req, res) => {
    try {
        const { reason } = req.body;
        
        if (!reason) {
            return res.status(400).json({
                success: false,
                error: 'Укажите причину отклонения'
            });
        }
        
        const freeze = await Freeze.findById(req.params.id);
        
        if (!freeze) {
            return res.status(404).json({
                success: false,
                error: 'Заморозка не найдена'
            });
        }
        
        await freeze.reject(req.user._id, reason);
        
        console.log(`❌ Админ ${req.user.name} отклонил заморозку: ${reason}`);
        
        res.json({
            success: true,
            freeze
        });
    } catch (error) {
        console.error('Reject freeze error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Ошибка при отклонении заморозки'
        });
    }
});

// @route   DELETE /api/freezes/:id
// @desc    Отменить заморозку (ученик отменяет свою pending заморозку)
// @access  Private
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const freeze = await Freeze.findById(req.params.id);
        
        if (!freeze) {
            return res.status(404).json({
                success: false,
                error: 'Заморозка не найдена'
            });
        }
        
        // Проверка доступа
        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
        const isOwnFreeze = freeze.student.toString() === req.user._id.toString();
        
        if (!isAdmin && !isOwnFreeze) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }
        
        // Можно отменить только pending заморозки
        if (freeze.status !== 'pending' && !isAdmin) {
            return res.status(400).json({
                success: false,
                error: 'Можно отменить только ожидающие заморозки'
            });
        }
        
        freeze.status = 'cancelled';
        await freeze.save();
        
        console.log(`🚫 Заморозка отменена`);
        
        res.json({
            success: true,
            message: 'Заморозка отменена'
        });
    } catch (error) {
        console.error('Cancel freeze error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при отмене заморозки'
        });
    }
});

module.exports = router;

