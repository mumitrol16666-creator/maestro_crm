const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Booking = require('../models/Booking');
const { authenticate, requireAdmin, requireSalesOrAdmin } = require('../middleware/auth');
const { sendTelegramNotification, formatBookingMessage } = require('../utils/telegram');

// @route   POST /api/bookings
// @desc    Создать заявку (с сайта)
// @access  Public
router.post('/', [
    body('name').notEmpty().withMessage('Имя обязательно'),
    body('phone').notEmpty().withMessage('Телефон обязателен'),
    body('direction').notEmpty().withMessage('Направление обязательно')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        const { name, phone, direction, source } = req.body;
        
        const booking = await Booking.create({
            name,
            phone,
            direction,
            source: source || 'Сайт',
            createdBy: 'website',
            status: 'new'
        });
        
        // Отправляем уведомление в Telegram
        const message = formatBookingMessage(booking);
        await sendTelegramNotification(message);
        
        res.status(201).json({
            success: true,
            message: 'Заявка успешно создана',
            booking
        });
    } catch (error) {
        console.error('Create booking error:', error);
        res.status(500).json({
            error: 'Ошибка при создании заявки'
        });
    }
});

// @route   GET /api/bookings
// @desc    Получить все заявки (с пагинацией, поиском и фильтрами)
// @access  Private/Admin
router.get('/', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { status, search, page = 1, limit = 20 } = req.query;
        
        const filter = {};
        
        // Фильтр по статусу
        if (status) {
            filter.status = status;
        }
        
        // ⚡ Поиск по имени И телефону
        if (search && search.trim()) {
            // Извлекаем только цифры из поискового запроса
            const phoneDigits = search.replace(/\D/g, '');
            
            const searchConditions = [
                { name: { $regex: search, $options: 'i' } }
            ];
            
            // Если есть цифры, ищем по phoneDigits (только цифры, без форматирования)
            if (phoneDigits) {
                searchConditions.push({ phoneDigits: { $regex: phoneDigits } });
            }
            
            filter.$or = searchConditions;
        }
        
        // ⚡ ПАГИНАЦИЯ
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;
        
        // Параллельно: данные + общий подсчет
        const [bookings, total] = await Promise.all([
            Booking.find(filter)
                .populate('processedBy', 'name')
                .populate('convertedToStudent', 'name phone')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),
            Booking.countDocuments(filter)
        ]);
        
        res.json({
            success: true,
            count: bookings.length,
            total,
            page: pageNum,
            pages: Math.ceil(total / limitNum),
            bookings
        });
    } catch (error) {
        console.error('Get bookings error:', error);
        res.status(500).json({
            error: 'Ошибка при получении заявок'
        });
    }
});

// @route   GET /api/bookings/:id
// @desc    Получить одну заявку
// @access  Private/Admin
router.get('/:id', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id)
            .populate('processedBy', 'name')
            .populate('convertedToStudent', 'name phone');
        
        if (!booking) {
            return res.status(404).json({
                error: 'Заявка не найдена'
            });
        }
        
        res.json({
            success: true,
            booking
        });
    } catch (error) {
        console.error('Get booking error:', error);
        res.status(500).json({
            error: 'Ошибка при получении заявки'
        });
    }
});

// @route   PATCH /api/bookings/:id/status
// @desc    Изменить статус заявки
// @access  Private/Admin
router.patch('/:id/status', authenticate, requireSalesOrAdmin, [
    body('status').isIn(['new', 'processed', 'enrolled', 'rejected']).withMessage('Неверный статус')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        const { status } = req.body;
        
        const booking = await Booking.findById(req.params.id);
        
        if (!booking) {
            return res.status(404).json({
                error: 'Заявка не найдена'
            });
        }
        
        await booking.updateStatus(status, req.user._id);
        
        res.json({
            success: true,
            message: `Статус изменен на "${status}"`,
            booking
        });
    } catch (error) {
        console.error('Update status error:', error);
        res.status(500).json({
            error: 'Ошибка при изменении статуса'
        });
    }
});

// @route   POST /api/bookings/create-admin
// @desc    Создать заявку (админом)
// @access  Private/Admin
router.post('/create-admin', authenticate, requireSalesOrAdmin, [
    body('name').notEmpty().withMessage('Имя обязательно'),
    body('phone').notEmpty().withMessage('Телефон обязателен'),
    body('direction').notEmpty().withMessage('Направление обязательно')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        const { name, phone, direction, source, notes } = req.body;
        
        const booking = await Booking.create({
            name,
            phone,
            direction,
            source: source || 'Не указан',
            notes,
            createdBy: 'admin',
            processedBy: req.user._id,
            status: 'new'
        });
        
        res.status(201).json({
            success: true,
            message: 'Заявка создана администратором',
            booking
        });
    } catch (error) {
        console.error('Admin create booking error:', error);
        res.status(500).json({
            error: 'Ошибка при создании заявки'
        });
    }
});

// @route   POST /api/bookings/:id/convert
// @desc    Конвертировать заявку в ученика
// @access  Private/Admin
router.post('/:id/convert', authenticate, requireSalesOrAdmin, [
    body('password').optional().isLength({ min: 6 })
], async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id);
        
        if (!booking) {
            return res.status(404).json({
                success: false,
                error: 'Заявка не найдена'
            });
        }
        
        if (booking.convertedToStudent) {
            return res.status(400).json({
                success: false,
                error: 'Заявка уже конвертирована в ученика'
            });
        }
        
        // Проверяем существует ли уже ученик с таким телефоном
        const Student = require('../models/Student');
        const existingStudent = await Student.findOne({ phone: booking.phone });
        
        if (existingStudent) {
            return res.status(400).json({
                success: false,
                error: 'Ученик с таким телефоном уже существует'
            });
        }
        
        // Получить пол, группу и тип абонемента
        const { gender, groupId, membershipType } = req.body;
        
        if (!gender) {
            return res.status(400).json({
                success: false,
                error: 'Укажите пол ученика'
            });
        }
        
        if (!groupId) {
            return res.status(400).json({
                success: false,
                error: 'Выберите группу для ученика'
            });
        }
        
        if (!membershipType) {
            return res.status(400).json({
                success: false,
                error: 'Укажите тип абонемента'
            });
        }
        
        // Проверить что группа существует
        const Group = require('../models/Group');
        const group = await Group.findById(groupId);
        if (!group) {
            return res.status(404).json({
                success: false,
                error: 'Группа не найдена'
            });
        }
        
        // Генерируем пароль
        const generatedPassword = req.body.password || Math.random().toString(36).slice(-8);
        
        // Создаем ученика
        const student = await Student.create({
            name: booking.name,
            phone: booking.phone,
            password: generatedPassword,
            gender,
            role: 'student',
            groups: [{
                groupId: groupId,
                status: 'active',
                joinedAt: new Date()
            }]
        });
        
        // Создаем абонемент
        const Membership = require('../models/Membership');
        
        let totalClasses, daysToAdd;
        switch(membershipType) {
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
        }
        
        const freezesAvailable = gender === 'female' ? 2 : 1;
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + daysToAdd);
        
        const membership = await Membership.create({
            student: student._id,
            group: groupId,
            type: membershipType,
            totalClasses,
            classesRemaining: totalClasses,
            startDate,
            endDate,
            freezesAvailable,
            createdBy: req.user._id,  // Кто создал (менеджер/админ)
            booking: booking._id,      // Ссылка на заявку
            source: 'booking',         // Создан из заявки
            transactions: [{
                type: 'initial',
                amount: totalClasses,
                reason: `Создан абонемент ${membershipType} из заявки`,
                addedBy: req.user._id
            }]
        });
        
        // Привязать абонемент к ученику
        student.activeMembership = membership._id;
        await student.save();
        
        // Обновить счетчик учеников в группе
        group.currentStudents = (group.currentStudents || 0) + 1;
        await group.save();
        
        // Обновляем заявку
        booking.convertedToStudent = student._id;
        booking.status = 'trial';  // Пробное занятие
        booking.processedAt = new Date();
        booking.processedBy = req.user._id;
        await booking.save();
        
        console.log(`✅ Заявка конвертирована: ${booking.name} → ученик + группа ${group.name} + абонемент ${membershipType}`);
        
        res.json({
            success: true,
            message: 'Заявка конвертирована в ученика',
            student: {
                id: student._id,
                name: student.name,
                phone: student.phone,
                gender: student.gender,
                role: student.role
            },
            membership: {
                id: membership._id,
                type: membership.type,
                classesRemaining: membership.classesRemaining
            },
            generatedPassword: req.body.password ? undefined : generatedPassword
        });
    } catch (error) {
        console.error('Convert booking error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при конвертации заявки: ' + error.message
        });
    }
});

// @route   PATCH /api/bookings/:id/source
// @desc    Изменить источник заявки (только Super Admin)
// @access  Private/Super Admin
router.patch('/:id/source', authenticate, async (req, res) => {
    try {
        // Проверяем что пользователь super_admin
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен. Требуются права супер-администратора.'
            });
        }
        
        const { source } = req.body;
        const booking = await Booking.findById(req.params.id);
        
        if (!booking) {
            return res.status(404).json({
                success: false,
                error: 'Заявка не найдена'
            });
        }
        
        booking.source = source || '';
        await booking.save();
        
        res.json({
            success: true,
            message: 'Источник обновлен',
            booking
        });
    } catch (error) {
        console.error('Update source error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при обновлении источника'
        });
    }
});

// @route   DELETE /api/bookings/:id
// @desc    Удалить заявку
// @access  Private/Admin
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id);
        
        if (!booking) {
            return res.status(404).json({
                error: 'Заявка не найдена'
            });
        }
        
        await booking.deleteOne();
        
        res.json({
            success: true,
            message: 'Заявка удалена'
        });
    } catch (error) {
        console.error('Delete booking error:', error);
        res.status(500).json({
            error: 'Ошибка при удалении заявки'
        });
    }
});

module.exports = router;




