const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireSalesOrAdmin } = require('../middleware/auth');

// GET /api/groups
router.get('/', authenticate, async (req, res) => {
    try {
        const [groups, directions] = await Promise.all([
            prisma.group.findMany({
                where: { isActive: true },
                include: {
                    schedules: { include: { room: { select: { id: true, name: true, color: true } } } },
                    teacher: { select: { id: true, name: true, lastName: true } },
                    _count: { select: { students: { where: { status: 'active' } } } }
                },
                orderBy: { name: 'asc' }
            }),
            // Загружаем все направления с ценами
            prisma.direction.findMany({
                select: { name: true, pricingTrial: true, pricingMonth: true, pricingThreeMonths: true }
            })
        ]);

        // Индексируем направления по имени для быстрого поиска
        const directionPricing = {};
        directions.forEach(d => {
            directionPricing[d.name] = {
                trial: d.pricingTrial,
                month: d.pricingMonth,
                threeMonths: d.pricingThreeMonths
            };
        });

        const mapped = groups.map(g => ({
            ...g, _id: g.id,
            schedule: g.schedules.map(s => ({ dayOfWeek: s.dayOfWeek, time: s.time, duration: s.duration, room: s.room })),
            teacher: g.teacher ? { ...g.teacher, _id: g.teacher.id } : null,
            currentStudents: g._count.students,
            // Добавляем цены из направления этой группы
            pricing: directionPricing[g.direction] || { trial: 2000, month: 22000, threeMonths: 55000 }
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

// GET /api/groups/:id/students
router.get('/:id/students', authenticate, async (req, res) => {
    try {
        const studentGroups = await prisma.studentGroup.findMany({
            where: { groupId: req.params.id, status: 'active' },
            include: { 
                student: { 
                    select: { 
                        id: true, name: true, lastName: true, phone: true,
                        memberships: {
                            where: { status: 'active' },
                            include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } }
                        }
                    } 
                } 
            }
        });
        
        const mapped = studentGroups.map(sg => {
            const s = sg.student;
            const activeMemberships = s.memberships || [];
            let bestMembership = activeMemberships.find(m =>
                m.type === 'monthly' || m.type === 'monthly_12' || m.type === 'quarterly' || m.type === 'individual_package'
            );
            if (!bestMembership) bestMembership = activeMemberships[0] || null;

            let debtAmount = 0;
            if (bestMembership && bestMembership.remainingAmount > 0) {
                debtAmount = bestMembership.remainingAmount;
            }

            return { 
                ...s, 
                _id: s.id,
                activeMembership: bestMembership ? { ...bestMembership, _id: bestMembership.id, payments: undefined } : null,
                memberships: undefined,
                debtAmount
            };
        });
        res.json({ success: true, students: mapped });
    } catch (error) {
        console.error('Get group students error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения учеников' });
    }
});

// POST /api/groups/:id/students/:studentId
router.post('/:id/students/:studentId', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { id, studentId } = req.params;
        // Upsert or create
        const existing = await prisma.studentGroup.findFirst({
            where: { groupId: id, studentId: studentId }
        });
        
        if (!existing) {
            await prisma.studentGroup.create({
                data: { groupId: id, studentId: studentId }
            });
        } else if (existing.status !== 'active') {
             await prisma.studentGroup.update({
                where: { id: existing.id },
                data: { status: 'active' }
             });
        }
        
        // Update group count
        const count = await prisma.studentGroup.count({ where: { groupId: id, status: 'active' } });
        await prisma.group.update({ where: { id }, data: { currentStudents: count } });
        res.json({ success: true, message: 'Ученик добавлен' });
    } catch (error) {
        console.error('Add student error:', error);
        res.status(500).json({ success: false, error: 'Ошибка добавления ученика' });
    }
});

// DELETE /api/groups/:id/students/:studentId
router.delete('/:id/students/:studentId', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { id, studentId } = req.params;
        await prisma.studentGroup.deleteMany({
            where: { groupId: id, studentId: studentId }
        });
        // Update group count
        const count = await prisma.studentGroup.count({ where: { groupId: id, status: 'active' } });
        await prisma.group.update({ where: { id }, data: { currentStudents: count } });
        res.json({ success: true, message: 'Ученик удален' });
    } catch (error) {
        console.error('Remove student error:', error);
        res.status(500).json({ success: false, error: 'Ошибка удаления ученика' });
    }
});

module.exports = router;
