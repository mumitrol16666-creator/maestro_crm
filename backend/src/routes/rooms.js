const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireAdmin, requireSuperAdmin } = require('../middleware/auth');

const { timeToMinutes, intervalsOverlap } = require('../utils/timeOverlap');

function normalizeTime(value, fallback) {
    const text = String(value || '');
    if (!/^\d{2}:\d{2}$/.test(text)) return fallback;
    const minutes = timeToMinutes(text);
    return Number.isFinite(minutes) && minutes >= 0 && minutes < 24 * 60 ? text : fallback;
}

function formatRoomPersonName(person, fallback = '') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

// @route   GET /api/rooms/occupancy
// @desc    Загрузка кабинетов за день (можно несколько roomIds через запятую)
router.get('/occupancy', authenticate, async (req, res) => {
    try {
        const { date, roomIds } = req.query;
        if (!date) {
            return res.status(400).json({ success: false, error: 'Параметр date обязателен (YYYY-MM-DD)' });
        }

        const dayStart = new Date(`${date}T00:00:00.000Z`);
        const dayEnd = new Date(`${date}T23:59:59.999Z`);

        let roomWhere = { isActive: true };
        if (roomIds && roomIds !== 'all') {
            const ids = roomIds.split(',').map(s => s.trim()).filter(Boolean);
            if (ids.length) roomWhere.id = { in: ids };
        }

        const rooms = await prisma.room.findMany({
            where: roomWhere,
            orderBy: { name: 'asc' }
        });

        const classes = await prisma.class.findMany({
            where: {
                roomId: { in: rooms.map(r => r.id) },
                date: { gte: dayStart, lte: dayEnd },
                status: { not: 'cancelled' }
            },
            include: {
                teacher: { select: { name: true, lastName: true, middleName: true } },
                group: { select: { name: true } }
            },
            orderBy: [{ startTime: 'asc' }]
        });

        const byRoom = {};
        rooms.forEach(r => { byRoom[r.id] = []; });
        classes.forEach(c => {
            if (c.roomId && byRoom[c.roomId]) byRoom[c.roomId].push(c);
        });

        const occupancy = rooms.map(room => {
            const roomClasses = byRoom[room.id] || [];
            let bookedMinutes = 0;
            const conflicts = [];

            const intervals = roomClasses.map(c => ({
                class: c,
                start: timeToMinutes(c.startTime),
                end: timeToMinutes(c.endTime)
            }));

            intervals.forEach(item => {
                const duration = Math.max(0, item.end - item.start);
                bookedMinutes += duration;
            });

            for (let i = 0; i < intervals.length; i++) {
                for (let j = i + 1; j < intervals.length; j++) {
                    if (intervalsOverlap(intervals[i].start, intervals[i].end, intervals[j].start, intervals[j].end)) {
                        conflicts.push({
                            classA: intervals[i].class.id,
                            classB: intervals[j].class.id,
                            titleA: intervals[i].class.title,
                            titleB: intervals[j].class.title
                        });
                    }
                }
            }

            const workingStart = room.workingStart || '08:00';
            const workingEnd = room.workingEnd || '21:00';
            const availableMinutes = Math.max(0, timeToMinutes(workingEnd) - timeToMinutes(workingStart));
            const utilizationPercent = availableMinutes > 0
                ? Math.min(100, Math.round((bookedMinutes / availableMinutes) * 100))
                : 0;

            return {
                roomId: room.id,
                _id: room.id,
                name: room.name,
                color: room.color,
                classesCount: roomClasses.length,
                bookedMinutes,
                availableMinutes,
                freeMinutes: Math.max(0, availableMinutes - bookedMinutes),
                workingStart,
                workingEnd,
                utilizationPercent,
                conflicts,
                classes: roomClasses.map(c => ({
                    id: c.id,
                    title: c.title,
                    startTime: c.startTime,
                    endTime: c.endTime,
                    status: c.status,
                    teacherName: formatRoomPersonName(c.teacher) || null,
                    groupName: c.group?.name || null
                }))
            };
        });

        res.json({
            success: true,
            date,
            schoolHours: { open: '08:00', close: '21:00' },
            rooms: occupancy
        });
    } catch (error) {
        console.error('Room occupancy error:', error);
        res.status(500).json({ success: false, error: 'Ошибка расчёта загрузки' });
    }
});

// @route   GET /api/rooms
// @desc    Получить все залы
router.get('/', authenticate, async (req, res) => {
    try {
        const { activeOnly, includeInactive } = req.query;
        
        let where = {};
        if (includeInactive !== 'true' && activeOnly !== 'false') {
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
        const { name, color, workingStart, workingEnd } = req.body;
        
        if (!name) {
            return res.status(400).json({ success: false, error: 'Название зала обязательно' });
        }
        
        const normalizedStart = normalizeTime(workingStart, '08:00');
        const normalizedEnd = normalizeTime(workingEnd, '21:00');
        if (timeToMinutes(normalizedEnd) <= timeToMinutes(normalizedStart)) {
            return res.status(400).json({ success: false, error: 'Время окончания должно быть позже времени начала' });
        }

        const room = await prisma.room.create({
            data: {
                name,
                color: color || '#eb4d77',
                workingStart: normalizedStart,
                workingEnd: normalizedEnd,
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
        const { name, color, isActive, workingStart, workingEnd } = req.body;
        const current = await prisma.room.findUnique({ where: { id: req.params.id } });
        if (!current) return res.status(404).json({ success: false, error: 'Кабинет не найден' });
        const normalizedStart = normalizeTime(workingStart, current.workingStart || '08:00');
        const normalizedEnd = normalizeTime(workingEnd, current.workingEnd || '21:00');
        if (timeToMinutes(normalizedEnd) <= timeToMinutes(normalizedStart)) {
            return res.status(400).json({ success: false, error: 'Время окончания должно быть позже времени начала' });
        }
        
        const room = await prisma.room.update({
            where: { id: req.params.id },
            data: {
                ...(name && { name }),
                ...(color && { color }),
                workingStart: normalizedStart,
                workingEnd: normalizedEnd,
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
        const room = await prisma.room.update({
            where: { id: req.params.id },
            data: { isActive: false }
        });
        
        res.json({ success: true, message: 'Кабинет отключён', room: { ...room, _id: room.id } });
    } catch (error) {
        console.error('Deactivate room error:', error);
        if (error.code === 'P2025') {
            return res.status(404).json({ success: false, error: 'Кабинет не найден' });
        }
        res.status(500).json({ success: false, error: 'Ошибка при отключении кабинета' });
    }
});

module.exports = router;
