const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireTeacherOrAdmin, requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const {
    deductMembershipForClass,
    refundAllDeductionsForClass,
    findMembershipForClass,
    membershipSupportsClass
} = require('../services/classMembership');
const { isClassEnded } = require('../services/automation');
const { notify } = require('../services/notifications');
const { returnClassToTeacher, reopenClass, upsertClassAttendee } = require('../services/lessonLifecycle');
const { ensureTeacherScheduleColors } = require('../services/scheduleAppearance');
const {
    shouldChargeAttendance,
    isPresentAttendance,
    canApproveClass,
} = require('../services/lessonBillingPolicy');

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

async function logLessonAction(userId, action, classRecord, metadata = {}, tx) {
    if (!userId || !classRecord?.id) return;
    const db = tx || prisma;
    try {
        await db.activityLog.create({
            data: {
                userId,
                action,
                entityType: 'Class',
                entityId: classRecord.id,
                details: metadata.details || `${action}: ${classRecord.title}`,
                metadata: {
                    classId: classRecord.id,
                    title: classRecord.title,
                    date: classRecord.date,
                    startTime: classRecord.startTime,
                    endTime: classRecord.endTime,
                    ...metadata
                }
            }
        });
    } catch (error) {
        console.error('Lesson action log error:', error);
    }
}


// @route   GET /api/classes
router.get('/', authenticate, async (req, res) => {
    try {
        const { start, end, roomId, teacherId, subject, classType, status } = req.query;
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
        if (classType && classType !== 'all') {
            if (classType === 'practice') {
                where.isPractice = true;
            } else {
                where.classType = classType;
                where.isPractice = false;
            }
        }
        if (status && status !== 'all') where.status = status;
        if (subject && subject !== 'all') {
            where.OR = [
                { group: { is: { direction: subject } } },
                { individualStudent: { is: { learningDirections: { has: subject } } } },
                { practiceGroups: { some: { direction: subject } } },
                { title: subject },
            ];
        }

        await ensureTeacherScheduleColors();

        const classes = await prisma.class.findMany({
            where,
            include: {
                group: { select: { id: true, name: true, direction: true, currentStudents: true } },
                teacher: {
                    select: {
                        id: true,
                        name: true,
                        lastName: true,
                        teacherScheduleColor: true,
                        teacherWeeklyHours: true,
                    },
                },
                originalTeacher: {
                    select: {
                        id: true,
                        name: true,
                        lastName: true,
                        teacherScheduleColor: true,
                    },
                },
                room: {
                    select: {
                        id: true,
                        name: true,
                        color: true,
                        workingStart: true,
                        workingEnd: true,
                    },
                },
                individualStudent: {
                    select: {
                        id: true,
                        name: true,
                        lastName: true,
                        dateOfBirth: true,
                        learningDirections: true,
                    },
                },
                practiceGroups: { select: { id: true, name: true, direction: true } },
                attendees: true
            },
            orderBy: [{ date: 'asc' }, { startTime: 'asc' }]
        });

        const [teacherOptions, roomOptions, directionOptions] = await Promise.all([
            prisma.student.findMany({
                where: { role: 'teacher', status: 'active' },
                select: { id: true, name: true, lastName: true, teacherScheduleColor: true },
                orderBy: [{ name: 'asc' }, { lastName: 'asc' }],
            }),
            prisma.room.findMany({
                where: { isActive: true },
                select: { id: true, name: true },
                orderBy: { name: 'asc' },
            }),
            prisma.direction.findMany({
                where: { isActive: true },
                select: { name: true },
                orderBy: { name: 'asc' },
            }),
        ]);

        const mapped = classes.map(cls => {
            const lessonSubject = cls.group?.direction
                || cls.individualStudent?.learningDirections?.[0]
                || cls.practiceGroups?.[0]?.direction
                || cls.title;
            const teacherColor = cls.teacher?.teacherScheduleColor || '#6B7280';
            const audience = cls.individualStudent
                ? {
                    type: 'student',
                    id: cls.individualStudent.id,
                    name: `${cls.individualStudent.lastName || ''} ${cls.individualStudent.name || ''}`.trim(),
                    dateOfBirth: cls.individualStudent.dateOfBirth,
                }
                : cls.group
                    ? { type: 'group', id: cls.group.id, name: cls.group.name }
                    : { type: cls.isPractice ? 'practice' : 'none', id: null, name: cls.isPractice ? 'Открытая практика' : 'Не указано' };

            return {
                ...cls,
                _id: cls.id,
                backgroundColor: teacherColor,
                teacherColor,
                lessonSubject,
                lessonType: cls.isPractice ? 'practice' : cls.classType,
                needsConfirmation: cls.status === 'pending_admin_review',
                audience,
                group: cls.group ? { ...cls.group, _id: cls.group.id } : null,
                teacher: cls.teacher ? { ...cls.teacher, _id: cls.teacher.id } : null,
                originalTeacher: cls.originalTeacher ? { ...cls.originalTeacher, _id: cls.originalTeacher.id } : null,
                room: cls.room ? { ...cls.room, _id: cls.room.id } : null,
                individualStudent: cls.individualStudent ? { ...cls.individualStudent, _id: cls.individualStudent.id } : null,
                attendees: (cls.attendees || []).map(a => ({
                    ...a,
                    _id: a.id,
                    student: a.studentId
                })),
                groupName: cls.group ? cls.group.name : (cls.isPractice ? 'Практика' : 'Индивидуально'),
                teacherName: cls.teacher ? `${cls.teacher.name} ${cls.teacher.lastName || ''}`.trim() : 'Не назначен'
            };
        });

        const filters = {
            teachers: teacherOptions.map(item => ({
                id: item.id,
                name: `${item.name} ${item.lastName || ''}`.trim(),
                color: item.teacherScheduleColor || '#6B7280',
            })),
            rooms: roomOptions,
            subjects: [...new Set([
                ...directionOptions.map(item => item.name),
                ...mapped.map(item => item.lessonSubject).filter(Boolean),
            ])].sort((a, b) => a.localeCompare(b, 'ru')),
        };

        res.json({ success: true, classes: mapped, filters });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Ошибка получения' });
    }
});


// @route   POST /api/classes
// Create a new class (single or recurring).
// Body: { classType?, groupId?, roomId?, teacherId?, bookingId?, individualStudentId?, date, startTime, endTime, notes?, isRecurring?, recurringRule? }
router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const {
            groupId, roomId, teacherId, date, startTime, endTime,
            notes, isRecurring, recurringRule, individualStudentId, classType: requestedClassType, bookingId
        } = req.body;

        if (!date || !startTime || !endTime) {
            return res.status(400).json({ success: false, error: 'Дата, время начала и окончания обязательны' });
        }

        // Resolve special group types
        let resolvedGroupId = null;
        let classType = 'group';
        let title = 'Занятие';
        let backgroundColor = '#eb4d77';
        let linkedBooking = null;

        if (requestedClassType && ['group', 'individual', 'trial', 'rent', 'theory'].includes(requestedClassType)) {
            classType = requestedClassType;
        }

        if (groupId === 'special_rent') {
            classType = 'rent';
            title = 'Аренда зала';
        } else if (groupId === 'special_individual') {
            classType = 'individual';
            title = 'Индивидуальное занятие';
        } else if (classType === 'trial') {
            title = 'Пробный урок';
            if (bookingId) {
                linkedBooking = await prisma.booking.findUnique({
                    where: { id: bookingId },
                    select: {
                        id: true,
                        name: true,
                        lastName: true,
                        middleName: true,
                        direction: true,
                        phone: true,
                        convertedToStudentId: true
                    }
                });
                if (!linkedBooking) {
                    return res.status(404).json({ success: false, error: 'Заявка не найдена' });
                }
                title = `Пробный урок — ${[linkedBooking.lastName, linkedBooking.name, linkedBooking.middleName].filter(Boolean).join(' ')}`.trim();
            }
        } else if (classType === 'individual') {
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

        if ((classType === 'individual' || classType === 'trial') && individualStudentId) {
            const student = await prisma.student.findUnique({
                where: { id: individualStudentId },
                select: { id: true, name: true, lastName: true, middleName: true }
            });
            if (!student) {
                return res.status(404).json({ success: false, error: 'Ученик не найден' });
            }
            const studentName = [student.lastName, student.name, student.middleName].filter(Boolean).join(' ');
            if (classType === 'individual') {
                title = `Индивидуально — ${studentName}`;
            } else if (!linkedBooking) {
                title = `Пробный урок — ${studentName}`;
            }
        }

        if (classType === 'group' && !resolvedGroupId) {
            return res.status(400).json({ success: false, error: 'Для группового урока выберите группу' });
        }
        if (classType === 'individual' && !individualStudentId) {
            return res.status(400).json({ success: false, error: 'Для индивидуального урока выберите ученика' });
        }
        if (classType === 'trial' && !individualStudentId && !linkedBooking) {
            return res.status(400).json({ success: false, error: 'Для пробного урока выберите ученика или заявку' });
        }

        // Calculate duration
        const [sh, sm] = startTime.split(':').map(Number);
        const [eh, em] = endTime.split(':').map(Number);
        const duration = (eh * 60 + em) - (sh * 60 + sm);

        const classDate = new Date(date);

        // Check duplicates for single class
        if (!isRecurring) {
            const conflictConditions = [];
            
            if (roomId) {
                conflictConditions.push({ roomId, date: classDate, startTime });
            }
            if (resolvedTeacherId) {
                conflictConditions.push({ teacherId: resolvedTeacherId, date: classDate, startTime });
            }
            
            if (resolvedGroupId) {
                conflictConditions.push({ groupId: resolvedGroupId, date: classDate, startTime });
            } else if ((classType === 'individual' || classType === 'trial') && individualStudentId) {
                conflictConditions.push({ individualStudentId, date: classDate, startTime });
            }

            if (conflictConditions.length > 0) {
                const existingConflict = await prisma.class.findFirst({
                    where: {
                        OR: conflictConditions
                    }
                });

                if (existingConflict) {
                    let conflictReason = 'Занятие в это время уже существует';
                    if (roomId && existingConflict.roomId === roomId) {
                        conflictReason = 'Этот кабинет уже занят в это время';
                    } else if (resolvedTeacherId && existingConflict.teacherId === resolvedTeacherId) {
                        conflictReason = 'Преподаватель уже занят в это время';
                    } else if (resolvedGroupId && existingConflict.groupId === resolvedGroupId) {
                        conflictReason = 'Для этой группы уже создано занятие в это время';
                    } else if ((classType === 'individual' || classType === 'trial') && individualStudentId && existingConflict.individualStudentId === individualStudentId) {
                        conflictReason = 'У этого ученика уже запланировано занятие в это время';
                    }

                    try {
                        await prisma.activityLog.create({
                            data: {
                                userId: req.user?.id || 'system',
                                action: 'class_creation_blocked_conflict',
                                entityType: 'Class',
                                details: `Создание занятия заблокировано: ${conflictReason}`,
                                metadata: {
                                    roomId,
                                    teacherId: resolvedTeacherId,
                                    groupId: resolvedGroupId,
                                    individualStudentId,
                                    date: classDate,
                                    startTime,
                                    endTime
                                }
                            }
                        });
                    } catch (e) {
                        console.error('Failed to log class creation conflict:', e);
                    }

                    return res.status(400).json({ success: false, error: conflictReason });
                }
            }
        }

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
                        originalTeacherId: resolvedTeacherId,
                        roomId: roomId || null,
                        title,
                        date: new Date(cursor),
                        startTime,
                        endTime,
                        duration: duration > 0 ? duration : 45,
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

            await prisma.class.createMany({
                data: classesToCreate,
                skipDuplicates: true
            });

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
        const created = await prisma.class.create({
            data: {
                groupId: resolvedGroupId,
                teacherId: resolvedTeacherId,
                originalTeacherId: resolvedTeacherId,
                roomId: roomId || null,
                individualStudentId: (classType === 'individual' || classType === 'trial') && individualStudentId ? individualStudentId : null,
                title,
                date: classDate,
                startTime,
                endTime,
                duration: duration > 0 ? duration : 45,
                status: 'scheduled',
                backgroundColor,
                notes: notes || null,
                classType,
                createdById: req.user?.id || null
            },
            include: {
                group: { select: { id: true, name: true } },
                teacher: { select: { id: true, name: true, lastName: true } },
                originalTeacher: { select: { id: true, name: true, lastName: true } },
                reviewedBy: { select: { id: true, name: true, lastName: true } },
                room: { select: { id: true, name: true, color: true } },
                individualStudent: { select: { id: true, name: true, lastName: true, dateOfBirth: true } },
                attendees: {
                    include: {
                        student: { select: { id: true, name: true, lastName: true, dateOfBirth: true, phone: true } }
                    }
                }
            }
        });

        if (linkedBooking) {
            const teacher = resolvedTeacherId
                ? await prisma.student.findUnique({ where: { id: resolvedTeacherId }, select: { name: true, lastName: true } })
                : null;
            const room = roomId
                ? await prisma.room.findUnique({ where: { id: roomId }, select: { name: true } })
                : null;
            await prisma.booking.update({
                where: { id: linkedBooking.id },
                data: {
                    trialClassId: created.id,
                    trialTeacherId: resolvedTeacherId,
                    trialTeacherName: teacher ? `${teacher.name} ${teacher.lastName || ''}`.trim() : null,
                    trialRoomId: roomId || null,
                    trialRoomName: room?.name || null,
                    trialScheduledAt: new Date(`${date}T${startTime}:00`),
                    status: 'trial',
                    processedById: req.user?.id || null,
                    processedAt: new Date()
                }
            });
        }

        const mapped = {
            ...created,
            _id: created.id,
            group: created.group ? { ...created.group, _id: created.group.id } : null,
            teacher: created.teacher ? { ...created.teacher, _id: created.teacher.id } : null,
            originalTeacher: created.originalTeacher ? { ...created.originalTeacher, _id: created.originalTeacher.id } : null,
            room: created.room ? { ...created.room, _id: created.room.id } : null,
            individualStudent: created.individualStudent ? { ...created.individualStudent, _id: created.individualStudent.id } : null
        };

        await logLessonAction(req.user?.id, 'class_created', created);
        res.status(201).json({ success: true, class: mapped });
    } catch (error) {
        console.error('Create class error:', error);
        if (error.code === 'P2002') {
            try {
                await prisma.activityLog.create({
                    data: {
                        userId: req.user?.id || 'system',
                        action: 'class_creation_blocked_db_unique',
                        entityType: 'Class',
                        details: 'Создание занятия заблокировано уникальным ограничением БД',
                        metadata: { target: error.meta?.target || null }
                    }
                });
            } catch (e) {
                console.error('Failed to log DB unique constraint conflict:', e);
            }
            return res.status(400).json({
                success: false,
                error: 'Данное время для кабинета, преподавателя или группы/ученика уже занято.'
            });
        }
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
                originalTeacher: { select: { id: true, name: true, lastName: true } },
                room: { select: { id: true, name: true } },
                individualStudent: { select: { id: true, name: true, lastName: true, dateOfBirth: true } },
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
                originalTeacher: { select: { id: true, name: true, lastName: true } },
                reviewedBy: { select: { id: true, name: true, lastName: true } },
                room: { select: { id: true, name: true, color: true } },
                individualStudent: { select: { id: true, name: true, lastName: true, dateOfBirth: true } },
                attendees: {
                    include: {
                        student: { select: { id: true, name: true, lastName: true, dateOfBirth: true, phone: true } }
                    }
                }
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
            originalTeacher: cls.originalTeacher ? { ...cls.originalTeacher, _id: cls.originalTeacher.id } : null,
            reviewedBy: cls.reviewedBy ? { ...cls.reviewedBy, _id: cls.reviewedBy.id } : null,
            room: cls.room ? { ...cls.room, _id: cls.room.id } : null,
            individualStudent: cls.individualStudent ? { ...cls.individualStudent, _id: cls.individualStudent.id } : null,
            attendees: (cls.attendees || []).map(attendee => ({
                ...attendee,
                _id: attendee.id,
                student: attendee.studentId,
                studentDetails: attendee.student ? { ...attendee.student, _id: attendee.student.id } : null
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

        // Prevent parallel generation for the same room
        const activeJob = Array.from(generationJobs.values()).find(j => j.roomId === roomId && !j.done);
        if (activeJob) {
            try {
                await prisma.activityLog.create({
                    data: {
                        userId: req.user?.id || 'system',
                        action: 'schedule_generation_blocked_active_job',
                        entityType: 'Class',
                        details: `Генерация расписания для зала заблокирована: уже выполняется активная задача`,
                        metadata: { roomId }
                    }
                });
            } catch (e) {
                console.error('Failed to log active job conflict:', e);
            }
            return res.status(409).json({
                success: false,
                error: 'Генерация расписания для этого зала уже выполняется другим администратором или вкладкой.'
            });
        }

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
                        endAt.setMinutes(endAt.getMinutes() + (duration || 45));
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
                            duration: duration || 45,
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

        // 4. Log the generation start
        try {
            await prisma.activityLog.create({
                data: {
                    userId: req.user?.id || 'system',
                    action: 'schedule_generation_started',
                    entityType: 'Class',
                    details: `Запущена генерация расписания для кабинета ${selectedRoom.name} (${periodText})`,
                    metadata: { period, roomId, startDate, endDate }
                }
            });
        } catch (e) {
            console.error('Failed to log schedule generation start:', e);
        }

        // 5. Respond immediately so the client can start polling.
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
                            originalTeacherId: p.teacherId,
                            roomId: p.roomId,
                            title: p.title,
                            date: p.date,
                            startTime: p.startTime,
                            endTime: p.endTime,
                            duration: p.duration,
                            status: 'scheduled',
                            backgroundColor: p.backgroundColor,
                            notes: 'Сгенерировано'
                        })),
                        skipDuplicates: true
                    });
                    job.created += batch.length;
                    job.processed += batch.length;
                    for (const p of batch) {
                        job.createdClasses.push({ group: p.groupName, date: p.date, startTime: p.startTime });
                    }
                }
                job.message = `Создано занятий: ${job.created}`;
                
                // Log schedule generation completed
                try {
                    await prisma.activityLog.create({
                        data: {
                            userId: req.user?.id || 'system',
                            action: 'schedule_generation_completed',
                            entityType: 'Class',
                            details: `Успешно сгенерировано занятий: ${job.created} (пропущено дубликатов: ${job.skipped})`,
                            metadata: { jobId, created: job.created, skipped: job.skipped }
                        }
                    });
                } catch (e) {
                    console.error('Failed to log schedule generation completion:', e);
                }
            } catch (err) {
                console.error('Generate-from-schedule error:', err);
                job.error = err?.message || 'Ошибка генерации';
                
                try {
                    await prisma.activityLog.create({
                        data: {
                            userId: req.user?.id || 'system',
                            action: 'schedule_generation_failed',
                            entityType: 'Class',
                            details: `Генерация расписания завершилась ошибкой: ${job.error}`,
                            metadata: { jobId, error: job.error }
                        }
                    });
                } catch (e) {
                    console.error('Failed to log schedule generation failure:', e);
                }
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

        const current = await prisma.class.findUnique({ where: { id } });
        if (!current) return res.status(404).json({ success: false, error: 'Занятие не найдено' });
        if (current.status === 'completed' && ['teacherId', 'date', 'startTime', 'endTime', 'roomId'].some(field => data[field] !== undefined)) {
            return res.status(400).json({ success: false, error: 'Проведённый урок закрыт. Для исправлений используйте отдельное действие.' });
        }
        if (data.teacherId !== undefined && data.teacherId !== current.teacherId && !current.originalTeacherId) {
            data.originalTeacherId = current.teacherId || data.teacherId || null;
        }

        const updated = await prisma.class.update({
            where: { id },
            data,
            include: {
                group: { select: { id: true, name: true } },
                teacher: { select: { id: true, name: true, lastName: true } },
                originalTeacher: { select: { id: true, name: true, lastName: true } },
                room: { select: { id: true, name: true, color: true } }
            }
        });

        if (data.teacherId !== undefined && data.teacherId !== current.teacherId) {
            logLessonAction(req.user?.id, 'teacher_replaced', updated, {
                details: `Замена преподавателя: ${updated.title}`,
                oldTeacherId: current.teacherId,
                newTeacherId: data.teacherId,
                originalTeacherId: updated.originalTeacherId
            }).catch(() => {});
        }

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
        const { studentId, attended, attendanceStatus } = req.body;

        if (!studentId) {
            return res.status(400).json({ success: false, error: 'studentId обязателен' });
        }

        const allowedStatuses = ['unmarked', 'present', 'late', 'excused_absence', 'unexcused_absence'];
        const normalizedStatus = allowedStatuses.includes(attendanceStatus)
            ? attendanceStatus
            : (attended ? 'present' : 'excused_absence');
        const isPresent = ['present', 'late'].includes(normalizedStatus);
        const attendee = await prisma.$transaction(async (tx) => {
            const lockedClasses = await tx.$queryRaw`
                SELECT * FROM "Class" WHERE id = ${classId} FOR UPDATE
            `;
            const classRecord = lockedClasses[0];
            if (!classRecord) {
                const error = new Error('Занятие не найдено');
                error.code = 'CLASS_NOT_FOUND';
                throw error;
            }
            if (classRecord.status === 'completed' || classRecord.status === 'cancelled') {
                const error = new Error('Занятие уже закрыто');
                error.code = 'CLASS_CLOSED';
                throw error;
            }

            const saved = await upsertClassAttendee(classId, studentId, {
                attended: isPresent,
                attendanceStatus: normalizedStatus,
                autoDeducted: false,
                markedAt: normalizedStatus === 'unmarked' ? null : new Date()
            }, tx);

            const updateData = {};
            if (classRecord.noOneAttended || classRecord.teacherOutcomeHint === 'not_held') {
                updateData.noOneAttended = false;
                updateData.teacherOutcomeHint = 'held';
            }
            if (isClassEnded(classRecord) && !classRecord.isPractice) {
                if (['scheduled', 'started', 'not_filled'].includes(classRecord.status)) {
                    updateData.status = 'pending_admin_review';
                }
            }
            if (Object.keys(updateData).length > 0) {
                await tx.class.update({ where: { id: classId }, data: updateData });
            }
            return saved;
        });

        res.json({ success: true, attendee: attendee ? { ...attendee, _id: attendee.id } : null });
    } catch (error) {
        console.error('Save attendance error:', error);
        if (error.code === 'CLASS_NOT_FOUND') {
            return res.status(404).json({ success: false, error: error.message });
        }
        if (error.code === 'CLASS_CLOSED') {
            return res.status(409).json({ success: false, error: error.message });
        }
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

        await logLessonAction(req.user?.id, 'lesson_submitted_for_review', updated, {
            details: `Урок отправлен на подтверждение: ${updated.title}`,
            teacherOutcomeHint
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
            nextLessonFocus, materials, teacherComment, billingDecisions = []
        } = req.body;
        const classId = req.params.id;
        const decisions = Array.isArray(billingDecisions) ? billingDecisions : [];
        const result = await prisma.$transaction(async (tx) => {
            const lockedClasses = await tx.$queryRaw`
                SELECT * FROM "Class" WHERE id = ${classId} FOR UPDATE
            `;
            const classRecord = lockedClasses[0];

            const approval = canApproveClass(classRecord);
            if (!approval.allowed) {
                return { errorStatus: approval.status, errorMessage: approval.reason };
            }

            const finalTopic = topic !== undefined ? topic : classRecord.topic;
            const finalSummary = lessonSummary !== undefined ? lessonSummary : classRecord.lessonSummary;
            if (
                req.user?.role !== 'super_admin'
                && classRecord.teacherOutcomeHint !== 'not_held'
                && (!finalTopic?.trim() || !finalSummary?.trim())
            ) {
                return { errorStatus: 400, errorMessage: 'Для подтверждения заполните тему и итог урока' };
            }

            const deductions = [];
            const hasPresentStudents = decisions.some(d => isPresentAttendance(d.attendanceStatus));

            if (!classRecord.isPractice && deduct) {
                await tx.classAttendee.deleteMany({ where: { classId } });

                for (const decision of decisions) {
                    const studentId = decision.studentId;
                    if (!studentId) continue;
                    const status = decision.attendanceStatus || 'present';
                    const isPresent = isPresentAttendance(status);

                    const attendee = await tx.classAttendee.create({
                        data: {
                            classId,
                            studentId,
                            attended: isPresent,
                            attendanceStatus: status,
                            markedAt: new Date()
                        }
                    });

                    const shouldCharge = shouldChargeAttendance(status);
                    if (shouldCharge) {
                        const amount = Math.max(0, Math.round(Number(decision.amount) || 0));
                        const membershipId = decision.membershipId || null;
                        let result = { deducted: false, reason: 'no_membership_selected' };

                        if (membershipId) {
                            result = await deductMembershipForClass(
                                studentId,
                                classRecord,
                                req.user.id,
                                tx,
                                membershipId
                            );
                            if (!result.deducted) {
                                throw new Error(`Не удалось списать выбранный абонемент ученика ${studentId}`);
                            }
                        }

                        let balanceAfter = 0;
                        if (amount > 0) {
                            const student = await tx.student.update({
                                where: { id: studentId },
                                data: { accountBalance: { decrement: amount } },
                                select: { accountBalance: true }
                            });
                            balanceAfter = student.accountBalance;
                        } else {
                            const student = await tx.student.findUnique({
                                where: { id: studentId },
                                select: { accountBalance: true }
                            });
                            balanceAfter = student?.accountBalance || 0;
                        }

                        await tx.classAttendee.update({
                            where: { id: attendee.id },
                            data: {
                                chargeAmount: amount,
                                chargedMembershipId: membershipId,
                                chargeSource: membershipId ? 'membership' : 'balance_only',
                                autoDeducted: Boolean(result.deducted)
                            }
                        });

                        deductions.push({
                            studentId,
                            amount,
                            balanceAfter,
                            debtCreated: balanceAfter < 0,
                            ...result
                        });
                    }
                }
            }

            const updatePayload = {
                status: 'completed',
                reviewedAt: new Date(),
                reviewedById: req.user.id,
                autoDeductionDone: deductions.some(d => d.deducted),
                noOneAttended: classRecord.isPractice ? false : !hasPresentStudents
            };

            if (topic !== undefined) updatePayload.topic = topic;
            if (lessonGoals !== undefined) updatePayload.lessonGoals = lessonGoals;
            if (lessonSummary !== undefined) updatePayload.lessonSummary = lessonSummary;
            if (homeworkDraft !== undefined) updatePayload.homeworkDraft = homeworkDraft;
            if (nextLessonFocus !== undefined) updatePayload.nextLessonFocus = nextLessonFocus;
            if (materials !== undefined) updatePayload.materials = materials;
            if (teacherComment !== undefined) updatePayload.teacherComment = teacherComment;

            const updated = await tx.class.update({
                where: { id: classId },
                data: updatePayload
            });

            return { updated, deductions };
        });

        if (result.errorStatus) {
            return res.status(result.errorStatus).json({ success: false, error: result.errorMessage });
        }

        await logLessonAction(req.user?.id, 'lesson_approved', result.updated, {
            details: `Урок подтверждён: ${result.updated.title}`,
            deductions: result.deductions
        });
        notify('lesson.approved', {
            classRecord: result.updated,
            deductions: result.deductions
        }).catch(() => {});

        res.json({
            success: true,
            class: { ...result.updated, _id: result.updated.id },
            deductions: result.deductions
        });
    } catch (error) {
        console.error('Approve class error:', error);
        res.status(500).json({ success: false, error: 'Ошибка подтверждения урока' });
    }
});

router.post('/:id/return-to-teacher', authenticate, requireAdmin, async (req, res) => {
    try {
        const result = await returnClassToTeacher(req.params.id, req.user.id, req.body?.reason);
        if (!result.success) return res.status(result.status || 400).json(result);
        return res.json(result);
    } catch (error) {
        console.error('Return class to teacher error:', error);
        return res.status(500).json({ success: false, error: 'Не удалось вернуть урок преподавателю' });
    }
});

router.post('/:id/reopen', authenticate, requireAdmin, async (req, res) => {
    try {
        const result = await reopenClass(req.params.id, req.user.id, req.body?.reason);
        if (!result.success) return res.status(result.status || 400).json(result);
        return res.json(result);
    } catch (error) {
        console.error('Reopen class error:', error);
        return res.status(500).json({ success: false, error: 'Не удалось открыть урок повторно' });
    }
});

// @route   GET /api/classes/:id/billing-options
// Варианты списания по каждому присутствовавшему ученику перед подтверждением.
router.get('/:id/billing-options', authenticate, requireAdmin, async (req, res) => {
    try {
        const requestedStudentIds = String(req.query.studentIds || '')
            .split(',')
            .map(id => id.trim())
            .filter(Boolean);

        const classRecord = await prisma.class.findUnique({
            where: { id: req.params.id },
            include: {
                attendees: {
                    where: { attended: true, studentId: { not: null } },
                    include: {
                        student: {
                            select: {
                                id: true, name: true, lastName: true, dateOfBirth: true, accountBalance: true,
                                memberships: {
                                    where: { status: 'active' },
                                    include: {
                                        plan: { select: { name: true } },
                                        group: { select: { name: true } }
                                    },
                                    orderBy: { createdAt: 'desc' }
                                }
                            }
                        }
                    }
                }
            }
        });
        if (!classRecord) return res.status(404).json({ success: false, error: 'Занятие не найдено' });

        const requestedStudents = requestedStudentIds.length
            ? await prisma.student.findMany({
                where: { id: { in: requestedStudentIds }, role: 'student' },
                select: {
                    id: true, name: true, lastName: true, dateOfBirth: true, accountBalance: true,
                    memberships: {
                        where: { status: 'active' },
                        include: {
                            plan: { select: { name: true } },
                            group: { select: { name: true } }
                        },
                        orderBy: { createdAt: 'desc' }
                    }
                }
            })
            : [];
        const requestedStudentById = new Map(requestedStudents.map(student => [student.id, student]));

        const fallbackPrice = classRecord.price > 0
            ? classRecord.price
            : (classRecord.classType === 'individual' ? 4000 : classRecord.classType === 'group' ? 1200 : 1000);

        const studentRecords = requestedStudentIds.length
            ? requestedStudentIds.map(id => requestedStudentById.get(id)).filter(Boolean)
            : classRecord.attendees.map(attendee => attendee.student);

        const students = studentRecords.map(student => {
            const memberships = student.memberships
                .filter(membership => membershipSupportsClass(membership, classRecord))
                .map(membership => ({
                    id: membership.id,
                    name: membership.plan?.name || membership.type,
                    groupName: membership.group?.name || 'Общий',
                    classesRemaining: membership.classesRemaining,
                    lessonPrice: membership.totalClasses > 0
                        ? Math.round(membership.totalPrice / membership.totalClasses)
                        : fallbackPrice
                }));
            return {
                studentId: student.id,
                name: `${student.lastName || ''} ${student.name || ''}`.trim(),
                dateOfBirth: student.dateOfBirth,
                accountBalance: student.accountBalance,
                memberships,
                suggestedMembershipId: memberships[0]?.id || null,
                suggestedAmount: memberships[0]?.lessonPrice || fallbackPrice
            };
        });

        return res.json({ success: true, students });
    } catch (error) {
        console.error('Billing options error:', error);
        return res.status(500).json({ success: false, error: 'Не удалось подготовить списания' });
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
        if (['completed', 'cancelled'].includes(classRecord.status)) {
            return res.status(400).json({ success: false, error: 'Урок уже закрыт' });
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

        await logLessonAction(req.user?.id, 'lesson_no_one_attended', updated, {
            details: `Никто не пришёл: ${updated.title}`
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
// @route   POST /api/classes/:id/postpone
router.post('/:id/postpone', authenticate, requireTeacherOrAdmin, async (req, res) => {
    try {
        const classId = req.params.id;

        const result = await prisma.$transaction(async (tx) => {
            // Lock the Class row for update
            const classRecords = await tx.$queryRaw`
                SELECT * FROM "Class" WHERE id = ${classId} FOR UPDATE
            `;
            const classRecord = classRecords[0];

            if (!classRecord) {
                return { errorStatus: 404, errorMessage: 'Занятие не найдено' };
            }
            if (['completed', 'cancelled'].includes(classRecord.status)) {
                return { errorStatus: 400, errorMessage: 'Урок уже закрыт' };
            }

            const studentsToProcess = [];
            if (classRecord.classType === 'individual' && classRecord.individualStudentId) {
                studentsToProcess.push(classRecord.individualStudentId);
            } else {
                const attendees = await tx.classAttendee.findMany({ where: { classId } });
                attendees.forEach(a => {
                    if (a.studentId) studentsToProcess.push(a.studentId);
                });
            }

            const now = new Date();
            const classDate = new Date(classRecord.date);
            const isSameDay = classDate.toDateString() === now.toDateString();

            const [hours, minutes] = classRecord.startTime.split(':');
            const classStartDateTime = new Date(classRecord.date);
            classStartDateTime.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);

            const diffMinutes = (classStartDateTime - now) / (60 * 1000);
            const outcomes = [];

            if (isSameDay) {
                for (const studentId of studentsToProcess) {
                    let attendee = await tx.classAttendee.findFirst({
                        where: { classId, studentId }
                    });

                    if (diffMinutes < 30) {
                        // Экстренная отмена
                        const membership = await findMembershipForClass(studentId, classRecord, tx);
                        if (membership && membership.emergencyFreezesAvailable !== null && membership.emergencyFreezesAvailable > 0) {
                            // Используем экстренную заморозку
                            await tx.membership.update({
                                where: { id: membership.id },
                                data: {
                                    emergencyFreezesAvailable: { decrement: 1 },
                                    emergencyFreezesUsed: { increment: 1 }
                                }
                            });
                            await tx.membershipTransaction.create({
                                data: {
                                    membershipId: membership.id,
                                    type: 'freeze_used',
                                    amount: 0,
                                    reason: `Экстренная заморозка (отмена <30 мин): ${classRecord.title}`,
                                    classId: classRecord.id,
                                    addedById: req.user.id
                                }
                            });

                            if (!attendee) {
                                attendee = await tx.classAttendee.create({
                                    data: { classId, studentId, attended: false, attendanceStatus: 'excused_absence', autoDeducted: false }
                                });
                            } else {
                                await tx.classAttendee.update({
                                    where: { id: attendee.id },
                                    data: { attended: false, attendanceStatus: 'excused_absence', autoDeducted: false }
                                });
                            }
                            outcomes.push({ studentId, outcome: 'emergency_freeze_used', membershipId: membership.id });
                        } else {
                            // Списание (прогул)
                            const resDeduct = await deductMembershipForClass(studentId, classRecord, req.user.id, tx);
                            if (!attendee) {
                                attendee = await tx.classAttendee.create({
                                    data: { classId, studentId, attended: false, attendanceStatus: 'unexcused_absence', autoDeducted: resDeduct.deducted }
                                });
                            } else {
                                await tx.classAttendee.update({
                                    where: { id: attendee.id },
                                    data: { attended: false, attendanceStatus: 'unexcused_absence', autoDeducted: resDeduct.deducted }
                                });
                            }
                            outcomes.push({ studentId, outcome: 'deducted_late', ...resDeduct });
                        }
                    } else {
                        // Обычная отмена день-в-день: списание (прогул)
                        const resDeduct = await deductMembershipForClass(studentId, classRecord, req.user.id, tx);
                        if (!attendee) {
                            attendee = await tx.classAttendee.create({
                                data: { classId, studentId, attended: false, attendanceStatus: 'unexcused_absence', autoDeducted: resDeduct.deducted }
                            });
                        } else {
                            await tx.classAttendee.update({
                                where: { id: attendee.id },
                                data: { attended: false, attendanceStatus: 'unexcused_absence', autoDeducted: resDeduct.deducted }
                            });
                        }
                        outcomes.push({ studentId, outcome: 'deducted_same_day', ...resDeduct });
                    }
                }
            } else {
                // Отмена заранее: возврат
                await refundAllDeductionsForClass(
                    classRecord,
                    req.user.id,
                    tx,
                    `Возврат (занятие перенесено заранее): ${classRecord.title}`
                );
                await tx.classAttendee.deleteMany({ where: { classId } });
                outcomes.push({ outcome: 'free_cancellation_refunded' });
            }

            const updated = await tx.class.update({
                where: { id: classId },
                data: {
                    status: 'cancelled',
                    noOneAttended: false
                }
            });

            await logLessonAction(req.user?.id, 'lesson_postponed', updated, {
                details: `Занятие перенесено: ${updated.title}`,
                outcomes
            }, tx);

            return { success: true, updated, outcomes };
        });

        if (result.errorStatus) {
            return res.status(result.errorStatus).json({ success: false, error: result.errorMessage });
        }

        res.json({
            success: true,
            message: 'Занятие перенесено',
            class: { ...result.updated, _id: result.updated.id },
            outcomes: result.outcomes
        });
    } catch (error) {
        console.error('Postpone class error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при переносе занятия' });
    }
});

module.exports = router;
