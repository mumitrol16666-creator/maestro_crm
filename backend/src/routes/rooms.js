const express = require('express');
const router = express.Router();
const Room = require('../models/Room');
const { authenticate, requireAdmin, requireSuperAdmin } = require('../middleware/auth');

// @route   GET /api/rooms
// @desc    Получить все залы
// @access  Private (любые авторизованные)
router.get('/', authenticate, async (req, res) => {
    try {
        const { activeOnly } = req.query;
        
        let filter = {};
        if (activeOnly === 'true') {
            filter.isActive = true;
        }
        
        const rooms = await Room.find(filter).sort({ order: 1, name: 1 });
        
        res.json({
            success: true,
            count: rooms.length,
            rooms
        });
    } catch (error) {
        console.error('Get rooms error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении залов'
        });
    }
});

// @route   POST /api/rooms
// @desc    Создать зал
// @access  Private (Admin/Super Admin)
router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const { name, color } = req.body;
        
        if (!name) {
            return res.status(400).json({
                success: false,
                error: 'Название зала обязательно'
            });
        }
        
        const room = await Room.create({
            name,
            color: color || '#eb4d77'
        });
        
        console.log(`🏢 Создан зал: ${room.name}`);
        
        res.status(201).json({
            success: true,
            message: 'Зал создан',
            room
        });
    } catch (error) {
        console.error('Create room error:', error);
        
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                error: 'Зал с таким названием уже существует'
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Ошибка при создании зала'
        });
    }
});

// @route   PATCH /api/rooms/:id
// @desc    Обновить зал
// @access  Private (Admin/Super Admin)
router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { name, color, isActive } = req.body;
        
        const room = await Room.findById(req.params.id);
        
        if (!room) {
            return res.status(404).json({
                success: false,
                error: 'Зал не найден'
            });
        }
        
        // Обновляем поля
        if (name) room.name = name;
        if (color) room.color = color;
        if (typeof isActive === 'boolean') room.isActive = isActive;
        
        await room.save();
        
        console.log(`✏️ Обновлен зал: ${room.name}`);
        
        res.json({
            success: true,
            message: 'Зал обновлен',
            room
        });
    } catch (error) {
        console.error('Update room error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при обновлении зала'
        });
    }
});

// @route   DELETE /api/rooms/:id
// @desc    Удалить зал
// @access  Private (Super Admin)
router.delete('/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const room = await Room.findById(req.params.id);
        
        if (!room) {
            return res.status(404).json({
                success: false,
                error: 'Зал не найден'
            });
        }
        
        await room.deleteOne();
        
        console.log(`⚠️ Удален зал: ${room.name}`);
        
        res.json({
            success: true,
            message: 'Зал удален'
        });
    } catch (error) {
        console.error('Delete room error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при удалении зала'
        });
    }
});

module.exports = router;

