const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireSalesOrAdmin } = require('../middleware/auth');
const {
    defaultRange,
    buildRecurringSlots,
    findRecurringConflicts,
    replaceFutureRecurringClasses,
    formatConflicts,
} = require('../services/regularScheduleAutomation');
const { normalizeLessonDuration } = require('../utils/duration');

function formatGroupPersonName(person, fallback = '') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

async function prepareGroupSchedule({ groupId = null, name, teacherId, schedule, color, createdById, ignoreConflicts = false }) {
    if (!schedule?.length) return { slots: [], startDate: null, endDate: null };
    if (!teacherId) return { error: 'Выберите преподавателя для регулярных занятий', status: 400 };
    if (schedule.some((item) => !item.roomId)) return { error: 'Выберите кабинет для каждого регулярного занятия', status: 400 };
    const { startDate, endDate } = defaultRange();
    const slots = buildRecurringSlots({
        schedules: schedule,
        startDate,
        endDate,
        groupId,
        defaultTeacherId: teacherId,
        title: name,
        classType: 'group',
        backgroundColor: color || '#eb4d77',
        createdById,
    });
    if (!ignoreConflicts) {
        const conflicts = await findRecurringConflicts(slots, { excludeGroupId: groupId });
        if (conflicts.length) {
            return { error: 'Расписание пересекается с существующими занятиями', conflicts: formatConflicts(conflicts), status: 409 };
        }
    }
    return { slots };
}

async function syncGroupStudents(groupId, studentIds) {
    if (!Array.isArray(studentIds)) return;
    const uniqueIds = [...new Set(studentIds.filter(Boolean))];
    await prisma.studentGroup.updateMany({
        where: { groupId, studentId: { notIn: uniqueIds }, status: 'active' },
        data: { status: 'left' },
    });
    for (const studentId of uniqueIds) {
        await prisma.studentGroup.upsert({
            where: { studentId_groupId: { studentId, groupId } },
            update: { status: 'active' },
            create: { studentId, groupId, status: 'active' },
        });
    }
    await prisma.group.update({
        where: { id: groupId },
        data: { currentStudents: uniqueIds.length },
    });
}

// GET /api/groups
router.get('/', authenticate, async (req, res) => {
    try {
        const [groups, directions] = await Promise.all([
            prisma.group.findMany({
                where: { isActive: true },
                include: {
                    schedules: { include: { room: { select: { id: true, name: true, color: true } } } },
                    teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                    _count: { select: { students: { where: { status: 'active' } } } }
                },
                orderBy: { name: 'asc' }
            }),
            // Загружаем все направления с планами и легаси ценами
            prisma.direction.findMany({
                select: { 
                    name: true, 
                    pricingTrial: true, pricingMonth: true, pricingThreeMonths: true,
                    plans: {
                        where: { isActive: true },
                        orderBy: { order: 'asc' }
                    }
                }
            })
        ]);

        // Индексируем направления по имени для быстрого поиска
        const directionData = {};
        directions.forEach(d => {
            directionData[d.name] = {
                plans: d.plans,
                pricing: {
                    trial: d.pricingTrial,
                    month: d.pricingMonth,
                    threeMonths: d.pricingThreeMonths
                }
            };
        });

        const mapped = groups.map(g => {
            const dirData = directionData[g.direction] || { plans: [], pricing: { trial: 2000, month: 22000, threeMonths: 55000 } };
            return {
                ...g, _id: g.id,
                schedule: g.schedules.map(s => ({ dayOfWeek: s.dayOfWeek, time: s.time, duration: s.duration, room: s.room })),
                teacher: g.teacher ? { ...g.teacher, _id: g.teacher.id } : null,
                currentStudents: g._count.students,
                // Добавляем планы и старые цены для обратной совместимости
                plans: dirData.plans,
                pricing: dirData.pricing
            };
        });

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
                teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                students: { where: { status: 'active' }, include: { student: { select: { id: true, name: true, lastName: true, middleName: true, dateOfBirth: true, phone: true } } } }
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
        const { name, level, instructor, teacherId, maxStudents, description, schedule, color, instruments, studentIds, ignoreConflicts } = req.body;
        if (!name) return res.status(400).json({ success: false, error: 'Название группы обязательно' });
        const prepared = await prepareGroupSchedule({ name, teacherId, schedule, color, createdById: req.user.id, ignoreConflicts });
        if (prepared.error) return res.status(prepared.status).json({ success: false, error: prepared.error, conflicts: prepared.conflicts });

        const group = await prisma.group.create({
            data: { name, direction: 'Ансамбль', level: level || 'beginner', instructor: instructor || '', teacherId: teacherId || null, maxStudents: maxStudents || 15, description, color: color || null, instruments: instruments || [] }
        });

        if (schedule && Array.isArray(schedule)) {
            for (const s of schedule) {
                await prisma.groupSchedule.create({
                    data: {
                        groupId: group.id,
                        dayOfWeek: s.dayOfWeek,
                        time: s.time,
                        duration: normalizeLessonDuration(s.duration),
                        roomId: s.roomId || null,
                        isPractice: false,
                    },
                });
            }
        }
        const slots = prepared.slots.map((slot) => ({ ...slot, groupId: group.id }));
        const generation = await replaceFutureRecurringClasses({ slots, groupId: group.id });
        await syncGroupStudents(group.id, studentIds);

        const fullGroup = await prisma.group.findUnique({ where: { id: group.id }, include: { schedules: { include: { room: true } } } });
        res.status(201).json({ success: true, generation, group: { ...fullGroup, _id: fullGroup.id, schedule: fullGroup.schedules } });
    } catch (error) {
        console.error('Create group error:', error);
        res.status(500).json({ success: false, error: 'Ошибка создания группы' });
    }
});

// PUT /api/groups/:id
router.put('/:id', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { name, level, instructor, teacherId, maxStudents, description, schedule, isActive, color, instruments, studentIds, ignoreConflicts } = req.body;
        const currentGroup = await prisma.group.findUnique({ where: { id: req.params.id } });
        if (!currentGroup) return res.status(404).json({ success: false, error: 'Группа не найдена' });
        const prepared = await prepareGroupSchedule({
            groupId: req.params.id,
            name: name ?? currentGroup.name,
            teacherId: teacherId ?? currentGroup.teacherId,
            schedule,
            color: color ?? currentGroup.color,
            createdById: req.user.id,
            ignoreConflicts,
        });
        if (prepared.error) return res.status(prepared.status).json({ success: false, error: prepared.error, conflicts: prepared.conflicts });
        const data = {};
        if (name !== undefined) data.name = name;
        if (level !== undefined) data.level = level;
        if (instructor !== undefined) data.instructor = instructor;
        if (teacherId !== undefined) data.teacherId = teacherId || null;
        if (maxStudents !== undefined) data.maxStudents = parseInt(maxStudents) || 15;
        if (description !== undefined) data.description = description;
        if (isActive !== undefined) data.isActive = isActive;
        if (color !== undefined) data.color = color || null;
        if (instruments !== undefined) data.instruments = instruments;

        const group = await prisma.group.update({ where: { id: req.params.id }, data });

        // Если цвет изменился — обновляем его во всех занятиях этой группы
        if (color !== undefined) {
            await prisma.class.updateMany({
                where: {
                    groupId: req.params.id
                },
                data: { backgroundColor: color || '#eb4d77' }
            });
        }

        if (schedule && Array.isArray(schedule)) {
            await prisma.groupSchedule.deleteMany({ where: { groupId: group.id } });
            for (const s of schedule) {
                await prisma.groupSchedule.create({
                    data: {
                        groupId: group.id,
                        dayOfWeek: s.dayOfWeek,
                        time: s.time,
                        duration: normalizeLessonDuration(s.duration),
                        roomId: s.roomId || null,
                        isPractice: false,
                    },
                });
            }
            await replaceFutureRecurringClasses({ slots: prepared.slots, groupId: group.id });
        }
        await syncGroupStudents(group.id, studentIds);

        const fullGroup = await prisma.group.findUnique({ where: { id: group.id }, include: { schedules: { include: { room: true } } } });
        res.json({ success: true, group: { ...fullGroup, _id: fullGroup.id, schedule: fullGroup.schedules } });
    } catch (error) {
        console.error('Update group error:', error);
        res.status(500).json({ success: false, error: 'Ошибка обновления: ' + error.message });
    }
});

// DELETE /api/groups/:id
router.delete('/:id', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        await prisma.group.update({ where: { id: req.params.id }, data: { isActive: false } });
        await prisma.studentGroup.updateMany({
            where: { groupId: req.params.id, status: 'active' },
            data: { status: 'left' }
        });
        res.json({ success: true, message: 'Группа деактивирована. История расписания и состава сохранена.' });
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
                        id: true, name: true, lastName: true, middleName: true, dateOfBirth: true, phone: true, accountBalance: true,
                        additionalPhones: { orderBy: { createdAt: 'asc' }, select: { phone: true } },
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

            let debtAmount = Math.max(0, -(s.accountBalance || 0));

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
        await prisma.studentGroup.updateMany({
            where: { groupId: id, studentId: studentId, status: 'active' },
            data: { status: 'left' }
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
