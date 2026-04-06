const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireAdmin, requireSuperAdmin } = require('../middleware/auth');

// @route   GET /api/rooms
// @desc    Получить все залы
router.get('/', authenticate, async (req, res) => {
    try {
        const { activeOnly } = req.query;
        
        let where = {};
        if (activeOnly === 'true') {
            where.isActive = true;
        }
        
        const rooms = await prisma.room.findMany({
            where,
            orderBy: { name: 'asc' }
        });
        
        const mapped = rooms.map(r => ({ ...r, _id: r.id }));
        
        res.json({
            success: true,
            count: mapped.length,
            rooms: mapped
        });
    } catch (error) {
        console.error('Get rooms error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при получении залов' });
    }
});

// @route   POST /api/rooms
router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const { name, color } = req.body;
        
        if (!name) {
            return res.status(400).json({ success: false, error: 'Название зала обязательно' });
        }
        
        const room = await prisma.room.create({
            data: {
                name,
                color: color || '#eb4d77'
            }
        });
        
        res.status(201).json({
            success: true,
            message: 'Зал создан',
            room: { ...room, _id: room.id }
        });
    } catch (error) {
        console.error('Create room error:', error);
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, error: 'Зал с таким названием уже существует' });
        }
        res.status(500).json({ success: false, error: 'Ошибка при создании зала' });
    }
});

// @route   PATCH /api/rooms/:id
router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { name, color, isActive } = req.body;
        
        const room = await prisma.room.update({
            where: { id: req.params.id },
            data: {
                ...(name && { name }),
                ...(color && { color }),
                ...(typeof isActive === 'boolean' && { isActive })
            }
        });
        
        res.json({
            success: true,
            message: 'Зал обновлен',
            room: { ...room, _id: room.id }
        });
    } catch (error) {
        console.error('Update room error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при обновлении зала' });
    }
});

// @route   DELETE /api/rooms/:id
router.delete('/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        await prisma.room.delete({
            where: { id: req.params.id }
        });
        
        res.json({ success: true, message: 'Зал удален' });
    } catch (error) {
        console.error('Delete room error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при удалении зала' });
    }
});

module.exports = router;
