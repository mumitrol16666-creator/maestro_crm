const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireTeacherOrAdmin, requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const {
    deductMembershipForClass,
    refundAllDeductionsForClass
} = require('../services/classMembership');
const { isClassEnded } = require('../services/automation');
const { notify } = require('../services/notifications');

// In-memory store for schedule generation progress (per backend instance).
// Each entry lives for JOB_TTL_MS after completion and is then removed.
const generationJobs = new Map();
const JOB_TTL_MS = 10 * 60 * 1000; // 10 minutes

function scheduleJobCleanup(jobId) {
    setTimeout(() => generationJobs.delete(jobId), JOB_TTL_MS);
}

function createJobId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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
        if (req.query.roomIds) {
            const ids = String(req.query.roomIds).split(',').map(s => s.trim()).filter(Boolean);
            if (ids.length) where.roomId = { in: ids };
        }
        if (teacherId) where.teacherId = teacherId;

        const classes = await prisma.class.findMany({
            where,
            include: {
                group: { select: { id: true, name: true, currentStudents: true } },
                teacher: { select: { id: true, name: true, lastName: true } },
                room: { select: { id: true, name: true, color: true } },
                individualStudent: { select: { id: true, name: true, lastName: true } },
                attendees: true
            },
            orderBy: { startTime: 'asc' }
        });

        const mapped = classes.map(cls => ({
            ...cls,
            _id: cls.id,
            group: cls.group ? { ...cls.group, _id: cls.group.id } : null,
            teacher: cls.teacher ? { ...cls.teacher, _id: cls.teacher.id } : null,
            room: cls.room ? { ...cls.room, _id: cls.room.id } : null,
            individualStudent: cls.individualStudent ? { ...cls.individualStudent, _id: cls.individualStudent.id } : null,
            attendees: (cls.attendees || []).map(a => ({
                ...a,
                _id: a.id,
                student: a.studentId  // MongoDB compatibility: frontend expects `student` field
            })),
            groupName: cls.group ? cls.group.name : (cls.isPractice ? 'Практика' : 'Индивидуально'),
            teacherName: cls.teacher ? `${cls.teacher.name} ${cls.teacher.lastName || ''}`.trim() : 'Не назначен'
        }));
        res.json({ success: true, classes: mapped });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Ошибка получения' });
    }
});


// @route   POST /api/classes
// Create a new class (single or recurring).
// Body: { groupId, roomId?, teacherId?, date, startTime, endTime, notes?, isRecurring?, recurringRule? }
router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const {
            groupId, roomId, teacherId, date, startTime, endTime,
            notes, isRecurring, recurringRule, individualStudentId
        } = req.body;

        if (!date || !startTime || !endTime) {
            return res.status(400).json({ success: false, error: 'Дата, время начала и окончания обязательны' });
        }

        // Resolve special group types
        let resolvedGroupId = null;
        let classType = 'group';
        let title = 'Занятие';
        let backgroundColor = '#eb4d77';

        if (groupId === 'special_rent') {
            classType = 'rent';
            title = 'Аренда зала';
        } else if (groupId === 'special_individual') {
            classType = 'individual';
            title = 'Индивидуальное занятие';
        } else if (groupId) {
            resolvedGroupId = groupId;
            const group = await prisma.group.findUnique({ where: { id: groupId }, select: { name: true, teacherId: true, color: true } });
            if (group) {
                title = group.name;
                if (group.color) backgroundColor = group.color;
            }
        }

        // Get room color (if group color not set)
        if (roomId && (!resolvedGroupId || backgroundColor === '#eb4d77')) {
            const room = await prisma.room.findUnique({ where: { id: roomId }, select: { color: true } });
            if (room?.color) backgroundColor = room.color;
        }

        // Determine teacher: explicit > group default
        let resolvedTeacherId = teacherId || null;
        if (!resolvedTeacherId && resolvedGroupId) {
            const group = await prisma.group.findUnique({ where: { id: resolvedGroupId }, select: { teacherId: true } });
            if (group?.teacherId) resolvedTeacherId = group.teacherId;
        }

        // Calculate duration
        const [sh, sm] = startTime.split(':').map(Number);
        const [eh, em] = endTime.split(':').map(Number);
        const duration = (eh * 60 + em) - (sh * 60 + sm);

        // Handle recurring classes
        if (isRecurring && recurringRule) {
            const { daysOfWeek = [], endDate: recurringEndStr } = recurringRule;
            const startDate = new Date(date);
            startDate.setHours(0, 0, 0, 0);
            const recurringEnd = recurringEndStr ? new Date(recurringEndStr) : new Date(startDate);
            if (!recurringEndStr) recurringEnd.setMonth(recurringEnd.getMonth() + 1);
            recurringEnd.setHours(23, 59, 59, 999);

            const classesToCreate = [];
            const cursor = new Date(startDate);
            while (cursor <= recurringEnd) {
                const dow = cursor.getDay() === 0 ? 7 : cursor.getDay();
                if (daysOfWeek.includes(dow)) {
                    classesToCreate.push({
                        groupId: resolvedGroupId,
                        teacherId: resolvedTeacherId,
                        roomId: roomId || null,
                        title,
                        date: new Date(cursor),
                        startTime,
                        endTime,
                        duration: duration > 0 ? duration : 90,
                        status: 'scheduled',
                        backgroundColor,
                        notes: notes || null,
                        isRecurring: true,
                        recurringFreq: 'weekly',
                        recurringDays: daysOfWeek,
                        recurringEndDate: recurringEnd,
                        classType,
                        createdById: req.user?.id || null
                    });
                }
                cursor.setDate(cursor.getDate() + 1);
            }

            if (classesToCreate.length === 0) {
                return res.status(400).json({ success: false, error: 'Нет дней для создания занятий в указанном диапазоне' });
            }

            await prisma.class.createMany({ data: classesToCreate });

            // Fetch created classes to return them with relations
            const created = await prisma.class.findMany({
                where: {
                    createdById: req.user?.id,
                    isRecurring: true,
                    date: { gte: startDate, lte: recurringEnd }
                },
                include: {
                    group: { select: { id: true, name: true } },
                    teacher: { select: { id: true, name: true, lastName: true } },
                    room: { select: { id: true, name: true, color: true } }
                },
                orderBy: { date: 'asc' }
            });

            const mapped = created.map(cls => ({
                ...cls,
                _id: cls.id,
                group: cls.group ? { ...cls.group, _id: cls.group.id } : null,
                teacher: cls.teacher ? { ...cls.teacher, _id: cls.teacher.id } : null,
                room: cls.room ? { ...cls.room, _id: cls.room.id } : null
            }));

            return res.status(201).json({ success: true, classes: mapped, count: mapped.length });
        }

        // Single class creation
        const classDate = new Date(date);

        const created = await prisma.class.create({
            data: {
                groupId: resolvedGroupId,
                teacherId: resolvedTeacherId,
                roomId: roomId || null,
                individualStudentId: classType === 'individual' && individualStudentId ? individualStudentId : null,
                title,
                date: classDate,
                startTime,
                endTime,
                duration: duration > 0 ? duration : 90,
                status: 'scheduled',
                backgroundColor,
                notes: notes || null,
                classType,
                createdById: req.user?.id || null
            },
            include: {
                group: { select: { id: true, name: true } },
                teacher: { select: { id: true, name: true, lastName: true } },
                room: { select: { id: true, name: true, color: true } },
                individualStudent: { select: { id: true, name: true, lastName: true } },
                attendees: true
            }
        });

        const mapped = {
            ...created,
            _id: created.id,
            group: created.group ? { ...created.group, _id: created.group.id } : null,
            teacher: created.teacher ? { ...created.teacher, _id: created.teacher.id } : null,
            room: created.room ? { ...created.room, _id: created.room.id } : null,
            individualStudent: created.individualStudent ? { ...created.individualStudent, _id: created.individualStudent.id } : null
        };

        res.status(201).json({ success: true, class: mapped });
    } catch (error) {
        console.error('Create class error:', error);
        res.status(500).json({ success: false, error: 'Ошибка создания занятия' });
    }
});

// @route   POST /api/classes/bulk-delete
// Массовое удаление занятий за период. Доступно только super_admin.
// Body: { startDate, endDate, roomId?, onlyGenerated? (default true) }
// Каскадно удаляет ClassAttendee (onDelete: Cascade в схеме).
router.post('/bulk-delete', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { startDate: startDateInput, endDate: endDateInput, roomId, onlyGenerated = true } = req.body;
        if (!startDateInput || !endDateInput) {
            return res.status(400).json({ success: false, error: 'Укажите startDate и endDate' });
        }

        const startDate = new Date(startDateInput);
        const endDate = new Date(endDateInput);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return res.status(400).json({ success: false, error: 'Некорректный формат дат' });
        }
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(0, 0, 0, 0);
        if (endDate < startDate) {
            return res.status(400).json({ success: false, error: 'Дата окончания раньше даты начала' });
        }
        // endDate включительно — двигаем на начало следующего дня
        endDate.setDate(endDate.getDate() + 1);

        const spanDays = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24));
        if (spanDays > 365) {
            return res.status(400).json({ success: false, error: 'Максимальный диапазон — 365 дней' });
        }

        const where = {
            date: { gte: startDate, lt: endDate }
        };
        if (roomId && roomId !== 'all') where.roomId = roomId;
        // По умолчанию удаляем только автосгенерированные — защищаем ручные занятия.
        if (onlyGenerated) where.notes = 'Сгенерировано';

        // Сначала считаем, сколько будем удалять (для аудита в ответе).
        const toDeleteCount = await prisma.class.count({ where });
        const { count } = await prisma.class.deleteMany({ where });

        return res.json({
            success: true,
            deleted: count,
            matched: toDeleteCount,
            range: {
                start: startDate.toISOString(),
                end: new Date(endDate.getTime() - 1).toISOString()
            },
            filters: { roomId: roomId || null, onlyGenerated: !!onlyGenerated }
        });
    } catch (error) {
        console.error('Bulk delete classes error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка массового удаления' });
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

// @route   GET /api/classes/pending-review/count
router.get('/pending-review/count', authenticate, requireAdmin, async (req, res) => {
    try {
        const count = await prisma.class.count({
            where: {
                isPractice: false,
                status: 'pending_admin_review'
            }
        });
        res.json({ success: true, count });
    } catch (error) {
        console.error('Pending review count error:', error);
        res.status(500).json({ success: false, error: 'Failed to count pending review' });
    }
});

// @route   GET /api/classes/pending-review
router.get('/pending-review', authenticate, requireAdmin, async (req, res) => {
    try {
        const classes = await prisma.class.findMany({
            where: {
                isPractice: false,
                status: 'pending_admin_review'
            },
            include: {
                group: { select: { id: true, name: true } },
                teacher: { select: { id: true, name: true, lastName: true } },
                room: { select: { id: true, name: true } },
                individualStudent: { select: { id: true, name: true, lastName: true } },
                attendees: true
            },
            orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
            take: 100
        });

        res.json({
            success: true,
            classes: classes.map(cls => ({ ...cls, _id: cls.id }))
        });
    } catch (error) {
        console.error('Pending review list error:', error);
        res.status(500).json({ success: false, error: 'Failed to list pending review' });
    }
});

// @route   GET /api/classes/pending-attendance/count
router.get('/pending-attendance/count', authenticate, async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Получаем текущее время в формате "HH:MM" (по местному времени Астаны/Алматы если нужно, но toTimeString() даст локальное время сервера)
        // Лучше использовать дату и время относительно начала дня.
        // Чтобы избежать проблем с таймзонами, мы просто сравним время.
        
        const now = new Date();
        const currentHours = now.getHours().toString().padStart(2, '0');
        const currentMinutes = now.getMinutes().toString().padStart(2, '0');
        const currentTimeString = `${currentHours}:${currentMinutes}`;

        const count = await prisma.class.count({
            where: {
                isPractice: false,
                noOneAttended: false,
                status: { in: ['scheduled', 'started', 'not_filled'] },
                // Считаем «отмеченным» только если есть хоть один ученик с attended: true
                // Если все attended: false — занятие снова «не отмечено»
                attendees: {
                    none: { attended: true }
                },
                // Занятие должно иметь либо группу, либо индивидуального ученика
                OR: [
                    { 
                        groupId: { not: null },
                        date: { lt: today }
                    },
                    { 
                        groupId: { not: null },
                        date: today, 
                        endTime: { lt: currentTimeString }
                    },
                    { 
                        individualStudentId: { not: null },
                        date: { lt: today }
                    },
                    { 
                        individualStudentId: { not: null },
                        date: today, 
                        endTime: { lt: currentTimeString }
                    }
                ]
            }
        });

        res.json({ success: true, count });
    } catch (error) {
        console.error('Pending attendance count error:', error);
        res.status(500).json({ success: false, error: 'Failed to count pending attendance' });
    }
});

// @route   GET /api/classes/:id
// Get a single class by ID (placed after specific routes to avoid shadowing)
router.get('/:id', authenticate, async (req, res) => {
    try {
        const cls = await prisma.class.findUnique({
            where: { id: req.params.id },
            include: {
                group: { select: { id: true, name: true, currentStudents: true } },
                teacher: { select: { id: true, name: true, lastName: true } },
                room: { select: { id: true, name: true, color: true } },
                individualStudent: { select: { id: true, name: true, lastName: true } },
                attendees: true
            }
        });

        if (!cls) {
            return res.status(404).json({ success: false, error: 'Занятие не найдено' });
        }

        const mapped = {
            ...cls,
            _id: cls.id,
            group: cls.group ? { ...cls.group, _id: cls.group.id } : null,
            teacher: cls.teacher ? { ...cls.teacher, _id: cls.teacher.id } : null,
            room: cls.room ? { ...cls.room, _id: cls.room.id } : null,
            individualStudent: cls.individualStudent ? { ...cls.individualStudent, _id: cls.individualStudent.id } : null,
            attendees: (cls.attendees || []).map(attendee => ({
                ...attendee,
                _id: attendee.id,
                student: attendee.studentId
            }))
        };

        res.json({ success: true, class: mapped });
    } catch (error) {
        console.error('Get class by ID error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения занятия' });
    }
});

// @route   POST /api/classes/generate-from-schedule
// Starts async generation and returns a jobId so the client can poll real progress.
router.post('/generate-from-schedule', authenticate, requireAdmin, async (req, res) => {
    try {
        const { period, roomId, startDate: startDateInput, endDate: endDateInput } = req.body;
        if (!period || !roomId) return res.status(400).json({ success: false, error: 'Параметры обязательны' });

        const selectedRoom = await prisma.room.findUnique({ where: { id: roomId } });
        if (!selectedRoom) return res.status(400).json({ success: false, error: 'Зал не найден' });

        const groups = await prisma.group.findMany({
            where: { isActive: true },
            include: { schedules: true }
        });

        // Диапазон генерации: week / month — от сегодня, custom — от указанных дат.
        let startDate;
        let endDate;
        if (period === 'custom') {
            if (!startDateInput || !endDateInput) {
                return res.status(400).json({ success: false, error: 'Укажите startDate и endDate' });
            }
            startDate = new Date(startDateInput);
            endDate = new Date(endDateInput);
            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                return res.status(400).json({ success: false, error: 'Некорректный формат дат' });
            }
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(0, 0, 0, 0);
            if (endDate < startDate) {
                return res.status(400).json({ success: false, error: 'Дата окончания раньше даты начала' });
            }
            // Включаем endDate в диапазон (до начала следующего дня)
            endDate.setDate(endDate.getDate() + 1);
            const spanDays = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24));
            if (spanDays > 180) {
                return res.status(400).json({ success: false, error: 'Максимальный диапазон — 180 дней' });
            }
        } else {
            startDate = new Date();
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(startDate);
            if (period === 'week') endDate.setDate(endDate.getDate() + 7);
            else endDate.setDate(endDate.getDate() + 30);
        }

        // 1. Plan: build the full list of slots the schedules would produce in the range.
        const planned = [];
        for (const group of groups) {
            if (!group.schedules || !group.teacherId) continue;
            for (const scheduleItem of group.schedules) {
                const { dayOfWeek, time, duration } = scheduleItem;
                if (!time) continue;
                const cursor = new Date(startDate);
                while (cursor < endDate) {
                    const dow = cursor.getDay() === 0 ? 7 : cursor.getDay();
                    if (dow === dayOfWeek) {
                        const [hh, mm] = time.split(':');
                        const endAt = new Date(cursor);
                        endAt.setHours(parseInt(hh), parseInt(mm), 0, 0);
                        endAt.setMinutes(endAt.getMinutes() + (duration || 90));
                        const endTimeStr = `${String(endAt.getHours()).padStart(2, '0')}:${String(endAt.getMinutes()).padStart(2, '0')}`;
                        planned.push({
                            groupId: group.id,
                            groupName: group.name,
                            teacherId: group.teacherId,
                            roomId,
                            title: group.name,
                            date: new Date(cursor),
                            startTime: time,
                            endTime: endTimeStr,
                            duration: duration || 90,
                            backgroundColor: group.color || selectedRoom.color || '#eb4d77'
                        });
                    }
                    cursor.setDate(cursor.getDate() + 1);
                }
            }
        }

        // 2. One-shot query for existing classes in the range.
        //    Важно: если в этот день у группы уже есть хотя бы одно занятие —
        //    НИЧЕГО не создаём для этой группы на эту дату, чтобы не задеть
        //    уже введённую посещаемость или руками смещённое время.
        const groupIds = groups.map(g => g.id);
        const existing = groupIds.length > 0
            ? await prisma.class.findMany({
                where: {
                    groupId: { in: groupIds },
                    date: { gte: startDate, lt: endDate }
                },
                select: { groupId: true, date: true, startTime: true }
            })
            : [];

        // Ключ по дню (не по времени): один класс на дату блокирует все слоты
        // этой же группы в тот же день.
        const dayKey = (groupId, date) => {
            const d = new Date(date);
            return `${groupId}|${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };
        const existingDaysSet = new Set(existing.map(e => dayKey(e.groupId, e.date)));

        const toCreate = planned.filter(p => !existingDaysSet.has(dayKey(p.groupId, p.date)));
        const skippedInitial = planned.length - toCreate.length;

        // 3. Register a job so the client can poll /generation-progress/:jobId.
        const jobId = createJobId();
        const job = {
            jobId,
            period,
            roomId,
            total: planned.length,
            toCreate: toCreate.length,
            processed: skippedInitial, // already-skipped count as processed
            created: 0,
            skipped: skippedInitial,
            done: toCreate.length === 0,
            error: null,
            createdClasses: [],
            skippedClasses: [],
            message: '',
            startedAt: Date.now(),
            finishedAt: toCreate.length === 0 ? Date.now() : null
        };
        generationJobs.set(jobId, job);

        // 4. Respond immediately so the client can start polling.
        res.json({
            success: true,
            jobId,
            total: planned.length,
            toCreate: toCreate.length,
            skipped: skippedInitial
        });

        if (toCreate.length === 0) {
            job.message = 'Все занятия на выбранный период уже созданы';
            scheduleJobCleanup(jobId);
            return;
        }

        // 5. Run generation in background, batched for steady progress updates.
        const BATCH_SIZE = 10;
        (async () => {
            try {
                for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
                    const batch = toCreate.slice(i, i + BATCH_SIZE);
                    await prisma.class.createMany({
                        data: batch.map(p => ({
                            groupId: p.groupId,
                            teacherId: p.teacherId,
                            roomId: p.roomId,
                            title: p.title,
                            date: p.date,
                            startTime: p.startTime,
                            endTime: p.endTime,
                            duration: p.duration,
                            status: 'scheduled',
                            backgroundColor: p.backgroundColor,
                            notes: 'Сгенерировано'
                        }))
                    });
                    job.created += batch.length;
                    job.processed += batch.length;
                    for (const p of batch) {
                        job.createdClasses.push({ group: p.groupName, date: p.date, startTime: p.startTime });
                    }
                }
                job.message = `Создано занятий: ${job.created}`;
            } catch (err) {
                console.error('Generate-from-schedule error:', err);
                job.error = err?.message || 'Ошибка генерации';
            } finally {
                job.done = true;
                job.finishedAt = Date.now();
                scheduleJobCleanup(jobId);
            }
        })();
    } catch (error) {
        console.error('Generate-from-schedule init error:', error);
        res.status(500).json({ success: false, error: 'Ошибка генерации' });
    }
});

// @route   GET /api/classes/generation-progress/:jobId
// Returns the live progress of a background generation job.
router.get('/generation-progress/:jobId', authenticate, requireAdmin, (req, res) => {
    const job = generationJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Задача не найдена' });
    res.json({
        success: true,
        jobId: job.jobId,
        total: job.total,
        toCreate: job.toCreate,
        processed: job.processed,
        created: job.created,
        skipped: job.skipped,
        done: job.done,
        error: job.error,
        message: job.message,
        details: {
            createdClasses: job.createdClasses,
            skippedClasses: job.skippedClasses
        }
    });
});

// @route   PATCH /api/classes/:id
// Update class fields (e.g. teacherId, status, title, etc.)
router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const allowedFields = [
            'teacherId', 'roomId', 'title', 'date', 'startTime', 'endTime',
            'duration', 'status', 'notes', 'backgroundColor', 'isPractice',
            'classType', 'individualStudentId', 'price', 'managerId'
        ];

        const data = {};
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                if (field === 'date') {
                    data[field] = new Date(req.body[field]);
                } else {
                    data[field] = req.body[field];
                }
            }
        }

        if (Object.keys(data).length === 0) {
            return res.status(400).json({ success: false, error: 'Нет данных для обновления' });
        }

        const updated = await prisma.class.update({
            where: { id },
            data,
            include: {
                group: { select: { id: true, name: true } },
                teacher: { select: { id: true, name: true, lastName: true } },
                room: { select: { id: true, name: true, color: true } }
            }
        });

        res.json({ success: true, class: { ...updated, _id: updated.id } });
    } catch (error) {
        console.error('Update class error:', error);
        if (error.code === 'P2025') return res.status(404).json({ success: false, error: 'Занятие не найдено' });
        res.status(500).json({ success: false, error: 'Ошибка обновления занятия' });
    }
});

// @route   POST /api/classes/:id/attendance
// Отметка посещаемости без списания. Списание — только при подтверждении админом (POST /approve).
router.post('/:id/attendance', authenticate, requireAdmin, async (req, res) => {
    try {
        const classId = req.params.id;
        const { studentId, attended } = req.body;

        if (!studentId) {
            return res.status(400).json({ success: false, error: 'studentId обязателен' });
        }

        const classRecord = await prisma.class.findUnique({ where: { id: classId } });
        if (!classRecord) {
            return res.status(404).json({ success: false, error: 'Занятие не найдено' });
        }

        if (classRecord.status === 'completed' || classRecord.status === 'cancelled') {
            return res.status(400).json({ success: false, error: 'Занятие уже закрыто' });
        }

        const existing = await prisma.classAttendee.findFirst({
            where: { classId, studentId }
        });

        let attendee = null;

        if (!attended) {
            if (existing) {
                await prisma.classAttendee.delete({ where: { id: existing.id } });
            }
        } else if (existing) {
            attendee = await prisma.classAttendee.update({
                where: { id: existing.id },
                data: { attended: true, attendanceStatus: 'present', markedAt: new Date() }
            });
        } else {
            attendee = await prisma.classAttendee.create({
                data: {
                    classId,
                    studentId,
                    attended: true,
                    attendanceStatus: 'present',
                    autoDeducted: false,
                    markedAt: new Date()
                }
            });
        }

        const updateData = {};
        if (classRecord.noOneAttended) {
            updateData.noOneAttended = false;
        }

        if (isClassEnded(classRecord) && !classRecord.isPractice) {
            if (['scheduled', 'started', 'not_filled'].includes(classRecord.status)) {
                updateData.status = 'pending_admin_review';
            }
        }

        if (Object.keys(updateData).length > 0) {
            await prisma.class.update({ where: { id: classId }, data: updateData });
        }

        res.json({ success: true, attendee: attendee ? { ...attendee, _id: attendee.id } : null });
    } catch (error) {
        console.error('Save attendance error:', error);
        res.status(500).json({ success: false, error: 'Ошибка сохранения посещаемости' });
    }
});

// @route   POST /api/classes/:id/start
router.post('/:id/start', authenticate, requireAdmin, async (req, res) => {
    try {
        const classRecord = await prisma.class.findUnique({ where: { id: req.params.id } });
        if (!classRecord) {
            return res.status(404).json({ success: false, error: 'Занятие не найдено' });
        }
        if (classRecord.status !== 'scheduled') {
            return res.status(400).json({ success: false, error: 'Урок уже начат или закрыт' });
        }

        const updated = await prisma.class.update({
            where: { id: req.params.id },
            data: { status: 'started' }
        });

        res.json({ success: true, class: { ...updated, _id: updated.id } });
    } catch (error) {
        console.error('Start class error:', error);
        res.status(500).json({ success: false, error: 'Ошибка начала урока' });
    }
});

// @route   POST /api/classes/:id/submit-review
// Преподаватель отправляет тему/ДЗ на подтверждение админу (без списания).
router.post('/:id/submit-review', authenticate, requireAdmin, async (req, res) => {
    try {
        const {
            topic, lessonGoals, lessonSummary, homeworkDraft, nextLessonFocus,
            materials, teacherComment, teacherOutcomeHint
        } = req.body;
        const classRecord = await prisma.class.findUnique({ where: { id: req.params.id } });
        if (!classRecord) {
            return res.status(404).json({ success: false, error: 'Занятие не найдено' });
        }

        if (['completed', 'cancelled'].includes(classRecord.status)) {
            return res.status(400).json({ success: false, error: 'Занятие уже закрыто' });
        }

        const updated = await prisma.class.update({
            where: { id: req.params.id },
            data: {
                topic: topic ?? classRecord.topic,
                lessonGoals: lessonGoals ?? classRecord.lessonGoals,
                lessonSummary: lessonSummary ?? classRecord.lessonSummary,
                homeworkDraft: homeworkDraft ?? classRecord.homeworkDraft,
                nextLessonFocus: nextLessonFocus ?? classRecord.nextLessonFocus,
                materials: materials ?? classRecord.materials,
                teacherComment: teacherComment ?? classRecord.teacherComment,
                teacherOutcomeHint: teacherOutcomeHint ?? classRecord.teacherOutcomeHint,
                submittedAt: new Date(),
                submittedById: req.user.id,
                status: 'pending_admin_review'
            }
        });

        notify('lesson.pending_review', { classRecord: updated }).catch(() => {});

        res.json({ success: true, class: { ...updated, _id: updated.id } });
    } catch (error) {
        console.error('Submit review error:', error);
        res.status(500).json({ success: false, error: 'Ошибка отправки на подтверждение' });
    }
});

// @route   POST /api/classes/:id/approve
// Админ подтверждает урок и списывает занятия с абонементов (только админ).
router.post('/:id/approve', authenticate, requireAdmin, async (req, res) => {
    try {
        const {
            deduct = true, topic, lessonGoals, lessonSummary, homeworkDraft,
            nextLessonFocus, materials, teacherComment
        } = req.body;
        const classId = req.params.id;

        const classRecord = await prisma.class.findUnique({
            where: { id: classId },
            include: { attendees: true }
        });

        if (!classRecord) {
            return res.status(404).json({ success: false, error: 'Занятие не найдено' });
        }

        if (classRecord.status === 'completed') {
            return res.status(400).json({ success: false, error: 'Урок уже подтверждён' });
        }
        if (!classRecord.isPractice && classRecord.status !== 'pending_admin_review') {
            return res.status(400).json({
                success: false,
                error: 'Сначала преподаватель должен заполнить урок в приложении и отправить его на подтверждение'
            });
        }
        const finalTopic = topic !== undefined ? topic : classRecord.topic;
        const finalSummary = lessonSummary !== undefined ? lessonSummary : classRecord.lessonSummary;
        if (classRecord.teacherOutcomeHint !== 'not_held' && (!finalTopic?.trim() || !finalSummary?.trim())) {
            return res.status(400).json({
                success: false,
                error: 'Для подтверждения заполните тему и итог урока'
            });
        }

        if (classRecord.isPractice) {
            const updated = await prisma.class.update({
                where: { id: classId },
                data: {
                    status: 'completed',
                    reviewedAt: new Date(),
                    reviewedById: req.user.id
                }
            });
            return res.json({ success: true, class: { ...updated, _id: updated.id }, deductions: [] });
        }

        const deductions = [];

        if (deduct && !classRecord.noOneAttended) {
            const toDeduct = classRecord.attendees.filter(a => a.attended && a.studentId);

            await prisma.$transaction(async (tx) => {
                for (const attendee of toDeduct) {
                    const result = await deductMembershipForClass(
                        attendee.studentId,
                        classRecord,
                        req.user.id,
                        tx
                    );
                    deductions.push({ studentId: attendee.studentId, ...result });
                }
            });
        }

        const updatePayload = {
            status: 'completed',
            reviewedAt: new Date(),
            reviewedById: req.user.id,
            autoDeductionDone: deductions.some(d => d.deducted)
        };

        if (topic !== undefined) updatePayload.topic = topic;
        if (lessonGoals !== undefined) updatePayload.lessonGoals = lessonGoals;
        if (lessonSummary !== undefined) updatePayload.lessonSummary = lessonSummary;
        if (homeworkDraft !== undefined) updatePayload.homeworkDraft = homeworkDraft;
        if (nextLessonFocus !== undefined) updatePayload.nextLessonFocus = nextLessonFocus;
        if (materials !== undefined) updatePayload.materials = materials;
        if (teacherComment !== undefined) updatePayload.teacherComment = teacherComment;

        const updated = await prisma.class.update({
            where: { id: classId },
            data: updatePayload
        });

        notify('lesson.approved', { classRecord: updated, deductions }).catch(() => {});

        res.json({
            success: true,
            class: { ...updated, _id: updated.id },
            deductions
        });
    } catch (error) {
        console.error('Approve class error:', error);
        res.status(500).json({ success: false, error: 'Ошибка подтверждения урока' });
    }
});

// @route   POST /api/classes/:id/mark-no-one-attended
// Сигнал «никто не пришёл» → на подтверждение админу (без автосписания).
router.post('/:id/mark-no-one-attended', authenticate, requireTeacherOrAdmin, async (req, res) => {
    try {
        const classId = req.params.id;

        const classRecord = await prisma.class.findUnique({ where: { id: classId } });
        if (!classRecord) {
            return res.status(404).json({ success: false, error: 'Занятие не найдено' });
        }

        await refundAllDeductionsForClass(
            classRecord,
            req.user.id,
            null,
            `Возврат (никто не пришёл): ${classRecord.title}`
        );

        await prisma.classAttendee.deleteMany({ where: { classId } });

        const updated = await prisma.class.update({
            where: { id: classId },
            data: {
                noOneAttended: true,
                teacherOutcomeHint: 'not_held',
                status: 'pending_admin_review',
                submittedAt: new Date(),
                submittedById: req.user.id
            }
        });

        res.json({
            success: true,
            message: 'Отправлено на подтверждение: никто не пришёл',
            class: { ...updated, _id: updated.id }
        });
    } catch (error) {
        console.error('Mark no-one-attended error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при отметке' });
    }
});

// @route   POST /api/classes/:id/postpone
router.post('/:id/postpone', authenticate, requireTeacherOrAdmin, async (req, res) => {
    try {
        const classId = req.params.id;

        const classRecord = await prisma.class.findUnique({ where: { id: classId } });
        if (!classRecord) {
            return res.status(404).json({ success: false, error: 'Занятие не найдено' });
        }

        await refundAllDeductionsForClass(
            classRecord,
            req.user.id,
            null,
            `Возврат (занятие перенесено): ${classRecord.title}`
        );

        await prisma.classAttendee.deleteMany({ where: { classId } });

        const updated = await prisma.class.update({
            where: { id: classId },
            data: {
                status: 'cancelled',
                noOneAttended: false
            }
        });

        res.json({
            success: true,
            message: 'Занятие перенесено',
            class: { ...updated, _id: updated.id }
        });
    } catch (error) {
        console.error('Postpone class error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при переносе занятия' });
    }
});

module.exports = router;
