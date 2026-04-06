const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireTeacherOrAdmin, requireAdmin } = require('../middleware/auth');

// @route   GET /api/classes
router.get('/', authenticate, async (req, res) => {
    try {
        const { start, end, roomId, teacherId } = req.query;
        let where = {};
        if (start && end) {
            const startDate = new Date(start);
            const endDate = new Date(end);
            if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
                where.date = { gte: startDate, lte: endDate };
            }
        }
        if (roomId && roomId !== 'all') where.roomId = roomId;
        if (teacherId) where.teacherId = teacherId;

        const classes = await prisma.class.findMany({
            where,
            include: {
                group: { select: { name: true } },
                teacher: { select: { name: true, lastName: true } },
                room: { select: { name: true, color: true } }
            },
            orderBy: { startTime: 'asc' }
        });

        const mapped = classes.map(cls => ({
            ...cls,
            _id: cls.id,
            groupName: cls.group ? cls.group.name : (cls.isPractice ? 'Практика' : 'Индивидуально'),
            teacherName: cls.teacher ? `${cls.teacher.name} ${cls.teacher.lastName || ''}`.trim() : 'Не назначен'
        }));
        res.json({ success: true, classes: mapped });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Ошибка получения' });
    }
});

// @route   DELETE /api/classes/:id
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.class.delete({ where: { id } });
        res.json({ success: true, message: 'Занятие удалено' });
    } catch (error) {
        console.error('Delete class error:', error);
        if (error.code === 'P2025') return res.status(404).json({ success: false, error: 'Занятие не найдено' });
        res.status(500).json({ success: false, error: 'Ошибка удаления' });
    }
});

// @route   GET /api/classes/pending-attendance/count
router.get('/pending-attendance/count', authenticate, async (req, res) => {
    res.json({ success: true, count: 0 });
});

// @route   POST /api/classes/generate-from-schedule
router.post('/generate-from-schedule', authenticate, requireAdmin, async (req, res) => {
    try {
        const { period, roomId } = req.body;
        if (!period || !roomId) return res.status(400).json({ success: false, error: 'Параметры обязательны' });
        const selectedRoom = await prisma.room.findUnique({ where: { id: roomId } });
        if (!selectedRoom) return res.status(400).json({ success: false, error: 'Зал не найден' });
        
        const groups = await prisma.group.findMany({
            where: { isActive: true },
            include: { teacher: true, schedules: true }
        });
        
        const startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(startDate);
        if (period === 'week') endDate.setDate(endDate.getDate() + 7);
        else endDate.setDate(endDate.getDate() + 30);
        
        const createdClasses = [];
        for (const group of groups) {
            if (!group.schedules || !group.teacherId) continue;
            for (const scheduleItem of group.schedules) {
                const dayOfWeek = scheduleItem.dayOfWeek;
                const { time, duration } = scheduleItem;
                let currentDate = new Date(startDate);
                while (currentDate < endDate) {
                    const currentDayOfWeek = currentDate.getDay() === 0 ? 7 : currentDate.getDay();
                    if (currentDayOfWeek === dayOfWeek) {
                        const [hours, minutes] = time.split(':');
                        const end = new Date(currentDate);
                        end.setHours(parseInt(hours), parseInt(minutes), 0, 0);
                        end.setMinutes(end.getMinutes() + duration);
                        const endTimeStr = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
                        const duplicate = await prisma.class.findFirst({
                            where: { groupId: group.id, date: currentDate, startTime: time }
                        });
                        if (!duplicate) {
                            await prisma.class.create({
                                data: {
                                    groupId: group.id,
                                    teacherId: group.teacherId,
                                    roomId: roomId,
                                    title: group.name,
                                    date: currentDate,
                                    startTime: time,
                                    endTime: endTimeStr,
                                    duration,
                                    status: 'scheduled',
                                    backgroundColor: selectedRoom.color || '#eb4d77',
                                    notes: 'Сгенерировано'
                                }
                            });
                            createdClasses.push({ group: group.name });
                        }
                    }
                    currentDate.setDate(currentDate.getDate() + 1);
                }
            }
        }
        res.json({ success: true, created: createdClasses.length });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Ошибка генерации' });
    }
});

module.exports = router;
