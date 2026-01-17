const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Group = require('../models/Group');
const { protect, adminOnly, teacherOrAdmin, optionalAuth } = require('../middleware/auth');
const { cacheUtils } = require('../config/redis');
const { logAction } = require('../utils/activityLogger');

// @route   GET /api/groups
// @desc    Получить все группы (для преподавателя - только его группы)
// @access  Public (с фильтрацией по преподавателю если авторизован)
router.get('/', optionalAuth, async (req, res) => {
    try {
        const { direction, level, active } = req.query;
        const userRole = req.user?.role;
        const userId = req.user?._id;

        // 🚀 Redis кэширование (включая роль пользователя в ключ)
        const cacheKey = `groups:${direction || 'all'}:${level || 'all'}:${active || 'all'}:${userRole || 'public'}:${userId || 'public'}`;
        const cachedData = await cacheUtils.get(cacheKey);
        if (cachedData) {
            console.log('📦 Cache HIT for groups');
            return res.json(cachedData);
        }
        console.log('🔄 Cache MISS for groups - fetching from DB');

        const filter = {};
        if (direction) filter.direction = direction;
        if (level) filter.level = level;
        if (active !== undefined) filter.isActive = active === 'true';

        // ✅ Если пользователь - преподаватель, показываем только его группы
        if (userRole === 'teacher' && userId) {
            filter.teacher = userId;
            console.log(`👨‍🏫 Фильтрация групп по преподавателю: ${userId}`);
        }

        const groups = await Group.find(filter).sort({ direction: 1, name: 1 });

        const responseData = {
            success: true,
            count: groups.length,
            groups
        };

        // 🚀 Кэшируем результат на 10 минут
        await cacheUtils.set(cacheKey, responseData, 600);
        console.log('💾 Cached groups data');

        res.json(responseData);
    } catch (error) {
        console.error('Get groups error:', error);
        res.status(500).json({
            error: 'Ошибка при получении групп'
        });
    }
});

// @route   GET /api/groups/:id
// @desc    Получить одну группу
// @access  Public
router.get('/:id', async (req, res) => {
    try {
        const group = await Group.findById(req.params.id);

        if (!group) {
            return res.status(404).json({
                success: false,
                error: 'Группа не найдена'
            });
        }

        res.json({
            success: true,
            group
        });
    } catch (error) {
        console.error('Get group error:', error);
        res.status(500).json({
            error: 'Ошибка при получении группы'
        });
    }
});

// @route   GET /api/groups/:id/students
// @desc    Получить студентов группы
// @access  Teacher/Admin (преподаватель может видеть только своих студентов)
router.get('/:id/students', protect, teacherOrAdmin, async (req, res) => {
    try {
        console.log(`📋 GET /api/groups/${req.params.id}/students - запрос от ${req.user?.role}`);

        const Student = require('../models/Student');
        const userRole = req.user?.role;
        const userId = req.user?._id;

        // Проверяем что группа существует
        const group = await Group.findById(req.params.id);
        if (!group) {
            console.log(`❌ Группа ${req.params.id} не найдена`);
            return res.status(404).json({
                success: false,
                error: 'Группа не найдена'
            });
        }

        console.log(`✅ Группа найдена: ${group.name}`);

        // ✅ Если преподаватель - проверяем, что группа принадлежит ему
        if (userRole === 'teacher' && userId) {
            if (group.teacher?.toString() !== userId.toString()) {
                console.log(`❌ Преподаватель ${userId} пытается получить доступ к группе ${req.params.id}, которая ему не принадлежит`);
                return res.status(403).json({
                    success: false,
                    error: 'Доступ запрещен. Вы не являетесь преподавателем этой группы.'
                });
            }
        }

        const students = await Student.find({
            'groups.groupId': req.params.id,
            'groups.status': 'active'
        }).populate('activeMembership');

        console.log(`✅ Найдено ${students.length} студентов в группе`);

        res.json({
            success: true,
            count: students.length,
            students
        });
    } catch (error) {
        console.error('❌ Get group students error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении учеников группы',
            message: error.message
        });
    }
});

// @route   POST /api/groups
// @desc    Создать группу
// @access  Private/Admin
router.post('/', protect, adminOnly, [
    body('name').notEmpty().withMessage('Название группы обязательно'),
    body('direction').notEmpty().withMessage('Направление обязательно'),
    body('instructor').notEmpty().withMessage('Преподаватель обязателен')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const group = await Group.create(req.body);

        res.status(201).json({
            success: true,
            message: 'Группа создана',
            group
        });
    } catch (error) {
        console.error('Create group error:', error);
        res.status(500).json({
            error: 'Ошибка при создании группы'
        });
    }
});

// @route   PATCH /api/groups/:id
// @desc    Обновить группу
// @access  Private/Admin
router.patch('/:id', protect, adminOnly, async (req, res) => {
    try {
        const group = await Group.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );

        if (!group) {
            return res.status(404).json({
                success: false,
                error: 'Группа не найдена'
            });
        }

        res.json({
            success: true,
            message: 'Группа обновлена',
            group
        });
    } catch (error) {
        console.error('Update group error:', error);
        res.status(500).json({
            error: 'Ошибка при обновлении группы'
        });
    }
});

// @route   DELETE /api/groups/:id
// @desc    Удалить группу
// @access  Private/Admin
router.delete('/:id', protect, adminOnly, async (req, res) => {
    try {
        const group = await Group.findById(req.params.id);

        if (!group) {
            return res.status(404).json({
                success: false,
                error: 'Группа не найдена'
            });
        }

        // Проверка: есть ли ученики?
        if (group.currentStudents > 0) {
            return res.status(400).json({
                success: false,
                error: 'Невозможно удалить группу с учениками. Сначала переведите их в другие группы.'
            });
        }

        await group.deleteOne();

        await logAction(
            req.user._id,
            'delete',
            'Group',
            req.params.id,
            `Удаление группы ${group.name}`,
            { groupName: group.name, direction: group.direction }
        );

        res.json({
            success: true,
            message: 'Группа удалена'
        });
    } catch (error) {
        console.error('Delete group error:', error);
        res.status(500).json({
            error: 'Ошибка при удалении группы'
        });
    }
});

// @route   POST /api/groups/:id/students/:studentId
// @desc    Добавить студента в группу
// @access  Teacher/Admin
router.post('/:id/students/:studentId', protect, teacherOrAdmin, async (req, res) => {
    try {
        const { id, studentId } = req.params;

        // Найти группу
        const group = await Group.findById(id);
        if (!group) {
            return res.status(404).json({
                success: false,
                error: 'Группа не найдена'
            });
        }

        // Найти ученика
        const Student = require('../models/Student');
        const student = await Student.findById(studentId);
        if (!student) {
            return res.status(404).json({
                success: false,
                error: 'Ученик не найден'
            });
        }

        // Проверить что ученик еще не в группе
        const alreadyInGroup = student.groups.some(g =>
            g.groupId && g.groupId.toString() === id
        );

        if (alreadyInGroup) {
            return res.status(400).json({
                success: false,
                error: 'Ученик уже состоит в этой группе'
            });
        }

        // Добавить группу ученику
        student.groups.push({
            groupId: id,
            status: 'active',
            joinedAt: new Date()
        });
        await student.save();

        // Увеличить счетчик учеников в группе
        group.currentStudents = (group.currentStudents || 0) + 1;
        await group.save();

        console.log(`✅ Ученик ${student.name} добавлен в группу ${group.name}`);

        res.json({
            success: true,
            message: 'Ученик добавлен в группу',
            group,
            student
        });
    } catch (error) {
        console.error('Add student to group error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при добавлении ученика в группу'
        });
    }
});

// @route   DELETE /api/groups/:id/students/:studentId
// @desc    Удалить студента из группы
// @access  Teacher/Admin
router.delete('/:id/students/:studentId', protect, teacherOrAdmin, async (req, res) => {
    try {
        const { id, studentId } = req.params;

        // Найти ученика
        const Student = require('../models/Student');
        const student = await Student.findById(studentId);
        if (!student) {
            return res.status(404).json({
                success: false,
                error: 'Ученик не найден'
            });
        }

        // Удалить группу из массива ученика
        const groupIndex = student.groups.findIndex(g =>
            g.groupId && g.groupId.toString() === id
        );

        if (groupIndex === -1) {
            return res.status(400).json({
                success: false,
                error: 'Ученик не состоит в этой группе'
            });
        }

        student.groups.splice(groupIndex, 1);
        await student.save();

        // Уменьшить счетчик учеников в группе
        const group = await Group.findById(id);
        if (group) {
            group.currentStudents = Math.max(0, (group.currentStudents || 0) - 1);
            await group.save();
        }

        console.log(`⚠️ Ученик ${student.name} удален из группы ${group ? group.name : id}`);

        await logAction(
            req.user._id,
            'update',
            'Student',
            studentId,
            `Удаление ученика ${student.name} из группы ${group ? group.name : id}`,
            { groupId: id, groupName: group ? group.name : 'Unknown' }
        );

        res.json({
            success: true,
            message: 'Ученик удален из группы'
        });
    } catch (error) {
        console.error('Remove student from group error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при удалении ученика из группы'
        });
    }
});

// @route   GET /api/groups/schedule/weekly
// @desc    Получить общее расписание всех групп для сайта
// @access  Public
router.get('/schedule/weekly', async (req, res) => {
    try {
        const groups = await Group.find({ isActive: true })
            .populate('teacher', 'name')
            .select('name direction schedule teacher');

        // Сгруппировать по дням недели
        const scheduleByDay = {
            1: [], // Понедельник
            2: [], // Вторник
            3: [], // Среда
            4: [], // Четверг
            5: [], // Пятница
            6: [], // Суббота
            7: []  // Воскресенье
        };

        groups.forEach(group => {
            group.schedule.forEach(item => {
                scheduleByDay[item.dayOfWeek].push({
                    groupName: group.name,
                    direction: group.direction,
                    time: item.time,
                    teacher: group.teacher?.name || 'Не указан',
                    isPractice: item.isPractice || false
                });
            });
        });

        // Сортировка по времени внутри каждого дня
        Object.keys(scheduleByDay).forEach(day => {
            scheduleByDay[day].sort((a, b) => {
                const timeA = a.time.split(':').map(Number);
                const timeB = b.time.split(':').map(Number);
                return (timeA[0] * 60 + timeA[1]) - (timeB[0] * 60 + timeB[1]);
            });
        });

        res.json({
            success: true,
            schedule: scheduleByDay
        });
    } catch (error) {
        console.error('Fetch weekly schedule error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении расписания'
        });
    }
});

module.exports = router;

