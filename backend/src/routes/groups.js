const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireSalesOrAdmin } = require('../middleware/auth');

// GET /api/groups
router.get('/', authenticate, async (req, res) => {
    try {
        const groups = await prisma.group.findMany({
            where: { isActive: true },
            include: {
                schedules: { include: { room: { select: { id: true, name: true, color: true } } } },
                teacher: { select: { id: true, name: true, lastName: true } },
                _count: { select: { students: { where: { status: 'active' } } } }
            },
            orderBy: { name: 'asc' }
        });

        const mapped = groups.map(g => ({
            ...g, _id: g.id,
            schedule: g.schedules.map(s => ({ dayOfWeek: s.dayOfWeek, time: s.time, duration: s.duration, room: s.room })),
            teacher: g.teacher ? { ...g.teacher, _id: g.teacher.id } : null,
            currentStudents: g._count.students
        }));

        res.json({ success: true, groups: mapped });
    } catch (error) {
        console.error('Get groups error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения групп' });
    }
});

// GET /api/groups/:id
router.get('/:id', authenticate, async (req, res) => {
    try {
        const group = await prisma.group.findUnique({
            where: { id: req.params.id },
            include: {
                schedules: { include: { room: true } },
                teacher: { select: { id: true, name: true, lastName: true } },
                students: { where: { status: 'active' }, include: { student: { select: { id: true, name: true, lastName: true, phone: true } } } }
            }
        });
        if (!group) return res.status(404).json({ success: false, error: 'Группа не найдена' });

        res.json({ success: true, group: { ...group, _id: group.id, schedule: group.schedules, students: group.students.map(sg => ({ ...sg.student, _id: sg.student.id })) } });
    } catch (error) {
        console.error('Get group error:', error);
        res.status(500).json({ success: false, error: 'Ошибка' });
    }
});

// POST /api/groups
router.post('/', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { name, direction, level, instructor, teacherId, maxStudents, description, schedule } = req.body;
        if (!name || !direction) return res.status(400).json({ success: false, error: 'Название и направление обязательны' });

        const group = await prisma.group.create({
            data: { name, direction, level: level || 'beginner', instructor: instructor || '', teacherId: teacherId || null, maxStudents: maxStudents || 15, description }
        });

        if (schedule && Array.isArray(schedule)) {
            for (const s of schedule) {
                await prisma.groupSchedule.create({
                    data: { groupId: group.id, dayOfWeek: s.dayOfWeek, time: s.time, duration: s.duration || 90, roomId: s.roomId || null }
                });
            }
        }

        const fullGroup = await prisma.group.findUnique({ where: { id: group.id }, include: { schedules: { include: { room: true } } } });
        res.status(201).json({ success: true, group: { ...fullGroup, _id: fullGroup.id, schedule: fullGroup.schedules } });
    } catch (error) {
        console.error('Create group error:', error);
        res.status(500).json({ success: false, error: 'Ошибка создания группы' });
    }
});

// PUT /api/groups/:id
router.put('/:id', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { name, direction, level, instructor, teacherId, maxStudents, description, schedule, isActive } = req.body;
        const data = {};
        if (name !== undefined) data.name = name;
        if (direction !== undefined) data.direction = direction;
        if (level !== undefined) data.level = level;
        if (instructor !== undefined) data.instructor = instructor;
        if (teacherId !== undefined) data.teacherId = teacherId || null;
        if (maxStudents !== undefined) data.maxStudents = maxStudents;
        if (description !== undefined) data.description = description;
        if (isActive !== undefined) data.isActive = isActive;

        const group = await prisma.group.update({ where: { id: req.params.id }, data });

        if (schedule && Array.isArray(schedule)) {
            await prisma.groupSchedule.deleteMany({ where: { groupId: group.id } });
            for (const s of schedule) {
                await prisma.groupSchedule.create({
                    data: { groupId: group.id, dayOfWeek: s.dayOfWeek, time: s.time, duration: s.duration || 90, roomId: s.roomId || null }
                });
            }
        }

        const fullGroup = await prisma.group.findUnique({ where: { id: group.id }, include: { schedules: { include: { room: true } } } });
        res.json({ success: true, group: { ...fullGroup, _id: fullGroup.id, schedule: fullGroup.schedules } });
    } catch (error) {
        console.error('Update group error:', error);
        res.status(500).json({ success: false, error: 'Ошибка обновления' });
    }
});

// DELETE /api/groups/:id
router.delete('/:id', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        await prisma.groupSchedule.deleteMany({ where: { groupId: req.params.id } });
        await prisma.group.update({ where: { id: req.params.id }, data: { isActive: false } });
        res.json({ success: true, message: 'Группа деактивирована' });
    } catch (error) {
        console.error('Delete group error:', error);
        res.status(500).json({ success: false, error: 'Ошибка' });
    }
});

module.exports = router;
