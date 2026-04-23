const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireTeacherOrAdmin, requireAdmin, requireSuperAdmin } = require('../middleware/auth');

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
        if (teacherId) where.teacherId = teacherId;

        const classes = await prisma.class.findMany({
            where,
            include: {
                group: { select: { id: true, name: true } },
                teacher: { select: { id: true, name: true, lastName: true } },
                room: { select: { id: true, name: true, color: true } },
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
            groupName: cls.group ? cls.group.name : (cls.isPractice ? 'Практика' : 'Индивидуально'),
            teacherName: cls.teacher ? `${cls.teacher.name} ${cls.teacher.lastName || ''}`.trim() : 'Не назначен'
        }));
        res.json({ success: true, classes: mapped });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Ошибка получения' });
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

// @route   GET /api/classes/pending-attendance/count
router.get('/pending-attendance/count', authenticate, async (req, res) => {
    res.json({ success: true, count: 0 });
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
                            backgroundColor: selectedRoom.color || '#eb4d77'
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

module.exports = router;
