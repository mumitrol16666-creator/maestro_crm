const express = require('express');
const router = express.Router();

function parseOptionalDate(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    return date;
}
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/db');
const { authenticate, requireAdmin, requireSalesOrAdmin } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const { notify } = require('../services/notifications');
const { provisionCrmStudent } = require('../services/userLink');
const { syncOnlineLessonToLearningPlatform } = require('../services/learningPlatformOnlineLesson');
const { inferBookingLossStage, hasTrialCloseSignal } = require('../utils/bookingLoss');
const { timeToMinutes, intervalsOverlap } = require('../utils/timeOverlap');
const {
    TRIAL_DURATION_MINUTES,
    addMinutesToTime,
    trialClassData,
} = require('../services/trialPolicy');

const SCHOOL_TIME_ZONE = process.env.SCHOOL_TIME_ZONE || 'Asia/Aqtobe';

// Helper: normalize phone to digits
function phoneDigits(phone) {
    return phone ? phone.replace(/\D/g, '') : '';
}

function getSchoolDateTimeParts(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: SCHOOL_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date).reduce((result, part) => {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
    }, {});
    return {
        date: new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`),
        startTime: `${parts.hour}:${parts.minute}`,
    };
}

async function syncTrialClass(tx, booking, details, actorId) {
    const { teacher, room, scheduledAt, depositPaid } = details;

    if (!scheduledAt) {
        if (booking.trialClassId) {
            const existingClass = await tx.class.findUnique({
                where: { id: booking.trialClassId },
                select: { status: true },
            });
            if (existingClass?.status === 'completed') {
                const error = new Error('Проведённый пробный урок нельзя удалить из расписания');
                error.code = 'TRIAL_ALREADY_COMPLETED';
                throw error;
            }
            await tx.class.updateMany({
                where: { id: booking.trialClassId, status: { notIn: ['completed', 'cancelled'] } },
                data: { status: 'cancelled' },
            });
        }
        return booking.trialClassId || null;
    }

    if (!teacher || !room) {
        const error = new Error('Для назначения пробного выберите преподавателя, кабинет, дату и время');
        error.code = 'TRIAL_DETAILS_REQUIRED';
        throw error;
    }

    const local = getSchoolDateTimeParts(scheduledAt);
    if (!local) {
        const error = new Error('Некорректная дата пробного урока');
        error.code = 'TRIAL_DATE_INVALID';
        throw error;
    }
    const endTime = addMinutesToTime(local.startTime);
    const possibleConflicts = await tx.class.findMany({
        where: {
            id: booking.trialClassId ? { not: booking.trialClassId } : undefined,
            date: local.date,
            status: { not: 'cancelled' },
            OR: [{ teacherId: teacher.id }, { roomId: room.id }],
        },
        select: { id: true, teacherId: true, roomId: true, startTime: true, endTime: true },
    });
    const conflict = possibleConflicts.find(item =>
        intervalsOverlap(
            timeToMinutes(local.startTime),
            timeToMinutes(endTime),
            timeToMinutes(item.startTime),
            timeToMinutes(item.endTime)
        )
    );
    if (conflict) {
        const target = conflict.teacherId === teacher.id ? 'Преподаватель' : 'Кабинет';
        const error = new Error(`${target} уже занят в это время`);
        error.code = 'TRIAL_SCHEDULE_CONFLICT';
        throw error;
    }

    const classData = trialClassData({
        booking,
        teacher,
        room,
        local,
        actorId,
        depositPaid,
    });

    if (booking.trialClassId) {
        const existingClass = await tx.class.findUnique({
            where: { id: booking.trialClassId },
            select: { id: true, status: true },
        });
        if (existingClass?.status === 'completed') {
            const error = new Error('Проведённый пробный урок нельзя перенести или переназначить');
            error.code = 'TRIAL_ALREADY_COMPLETED';
            throw error;
        }
        if (existingClass) {
            const updated = await tx.class.update({
                where: { id: booking.trialClassId },
                data: classData,
                select: { id: true },
            });
            return updated.id;
        }
    }

    const created = await tx.class.create({ data: classData, select: { id: true } });
    return created.id;
}

// POST /api/bookings — create booking (public, from website)
router.post('/', [
    body('name').notEmpty(),
    body('lastName').notEmpty(),
    body('phone').notEmpty(),
    body('direction').notEmpty()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { name, lastName, middleName, dateOfBirth, phone, direction, source, notes } = req.body;
        const parsedDateOfBirth = parseOptionalDate(dateOfBirth);
        if (dateOfBirth && parsedDateOfBirth === undefined) {
            return res.status(400).json({ error: 'Некорректная дата рождения' });
        }
        const booking = await prisma.booking.create({
            data: { name, lastName, middleName: middleName || null, dateOfBirth: parsedDateOfBirth || null, phone, phoneDigits: phoneDigits(phone), direction, source: source || 'Сайт', notes, createdBy: 'website', status: 'new' }
        });

        notify('booking.created', { booking: { ...booking, _id: booking.id } }).catch(() => {});

        res.status(201).json({ success: true, message: 'Заявка успешно создана', booking: { ...booking, _id: booking.id } });
    } catch (error) {
        console.error('Create booking error:', error);
        res.status(500).json({ error: 'Ошибка при создании заявки' });
    }
});

// GET /api/bookings — list bookings with pagination, search, filter
router.get('/', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { status, search, page = 1, limit = 20 } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        const where = {};
        if (status) where.status = status;

        if (search && search.trim()) {
            const term = search.trim();
            const digits = term.replace(/\D/g, '');
            const words = term.split(/\s+/);

            const orConditions = [];
            if (words.length === 1) {
                orConditions.push({ name: { contains: term, mode: 'insensitive' } });
                orConditions.push({ lastName: { contains: term, mode: 'insensitive' } });
                orConditions.push({ middleName: { contains: term, mode: 'insensitive' } });
            } else {
                orConditions.push({ AND: [{ name: { contains: words[0], mode: 'insensitive' } }, { lastName: { contains: words[1], mode: 'insensitive' } }] });
                orConditions.push({ AND: [{ lastName: { contains: words[0], mode: 'insensitive' } }, { name: { contains: words[1], mode: 'insensitive' } }] });
                if (words.length >= 3) {
                    orConditions.push({
                        AND: [
                            { lastName: { contains: words[0], mode: 'insensitive' } },
                            { name: { contains: words[1], mode: 'insensitive' } },
                            { middleName: { contains: words[2], mode: 'insensitive' } }
                        ]
                    });
                }
            }
            if (digits.length >= 3) {
                orConditions.push({ phoneDigits: { contains: digits } });
            }
            where.OR = orConditions;
        }

        const [bookings, total] = await Promise.all([
            prisma.booking.findMany({
                where,
                include: { group: { select: { id: true, name: true, schedules: true } } },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limitNum
            }),
            prisma.booking.count({ where })
        ]);

        // Map _id for frontend compat
        const mapped = bookings.map(b => ({ ...b, _id: b.id, group: b.group ? { ...b.group, _id: b.group.id } : null }));

        res.json({ success: true, count: mapped.length, total, page: pageNum, pages: Math.ceil(total / limitNum), bookings: mapped });
    } catch (error) {
        console.error('Get bookings error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при получении заявок' });
    }
});

// GET /api/bookings/stats — dashboard stats (new bookings count)
router.get('/stats', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const newCount = await prisma.booking.count({ where: { status: 'new' } });
        res.json({ success: true, newBookings: newCount });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Ошибка статистики' });
    }
});

// GET /api/bookings/trial-options — справочники для назначения пробного.
router.get('/trial-options', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const [teachers, rooms] = await Promise.all([
            prisma.student.findMany({
                where: {
                    role: 'teacher',
                    status: 'active',
                },
                select: {
                    id: true,
                    name: true,
                    lastName: true,
                    appUserId: true,
                    externalLinkStatus: true,
                },
                orderBy: [{ lastName: 'asc' }, { name: 'asc' }],
            }),
            prisma.room.findMany({
                where: { isActive: true },
                select: { id: true, name: true },
                orderBy: { name: 'asc' },
            }),
        ]);
        res.json({
            success: true,
            teachers: teachers.map(item => ({ ...item, _id: item.id })),
            rooms: rooms.map(item => ({ ...item, _id: item.id })),
        });
    } catch (error) {
        console.error('Trial options error:', error);
        res.status(500).json({ success: false, error: 'Не удалось загрузить данные для пробного' });
    }
});

// GET /api/bookings/:id
router.get('/:id', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const booking = await prisma.booking.findUnique({
            where: { id: req.params.id },
            include: { group: { select: { id: true, name: true, schedules: true } } }
        });
        if (!booking) return res.status(404).json({ error: 'Заявка не найдена' });
        res.json({ success: true, booking: { ...booking, _id: booking.id, group: booking.group ? { ...booking.group, _id: booking.group.id } : null } });
    } catch (error) {
        console.error('Get booking error:', error);
        res.status(500).json({ error: 'Ошибка при получении заявки' });
    }
});

// PATCH /api/bookings/:id/status
router.patch('/:id/status', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { status, lossReason, lossStage } = req.body;
        const validStatuses = ['new', 'processed', 'trial', 'sold', 'rejected'];
        if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Неверный статус' });
        if (status === 'sold') {
            return res.status(400).json({
                success: false,
                error: 'Статус «Продано» устанавливается автоматически после поступления денег на баланс ученика',
            });
        }

        const existingBooking = await prisma.booking.findUnique({ where: { id: req.params.id } });
        if (!existingBooking) return res.status(404).json({ success: false, error: 'Заявка не найдена' });

        const data = {
            status,
            processedById: existingBooking.processedById || req.user.id,
            processedAt: existingBooking.processedAt || new Date()
        };

        // Phase 2: фиксация потери при переводе в rejected
        if (status === 'rejected') {
            if (!String(lossReason || '').trim()) {
                return res.status(400).json({ success: false, error: 'Укажите причину потери' });
            }
            if (existingBooking.convertedToStudentId && await hasTrialCloseSignal(prisma, existingBooking)) {
                return res.status(400).json({
                    success: false,
                    error: 'Ученик уже закрыт реальной оплатой после пробного. Проверьте карточку ученика.',
                });
            }
            data.lossReason = String(lossReason).trim().substring(0, 200);
            const inferredStage = await inferBookingLossStage(prisma, existingBooking);
            const allowedStages = new Set(['before_trial', 'on_trial', 'after_trial']);
            const requestedStage = allowedStages.has(lossStage) ? lossStage : inferredStage;
            data.lossStage = inferredStage === 'after_trial'
                ? 'after_trial'
                : requestedStage;
            data.lostAt = new Date();
        }

        if (
            status === 'rejected'
            && existingBooking.externalSourceId
            && existingBooking.appStatus !== 'completed'
        ) {
            await syncOnlineLessonToLearningPlatform(existingBooking.externalSourceId, { action: 'cancel' });
            data.appStatus = 'cancelled';
        }

        const booking = await prisma.$transaction(async tx => {
            if (status === 'rejected' && existingBooking.trialClassId) {
                await tx.class.updateMany({
                    where: {
                        id: existingBooking.trialClassId,
                        status: { notIn: ['completed', 'cancelled'] },
                    },
                    data: { status: 'cancelled' },
                });
            }
            return tx.booking.update({
                where: { id: req.params.id },
                data,
            });
        });

        res.json({ success: true, message: `Статус изменен на "${status}"`, booking: { ...booking, _id: booking.id } });
    } catch (error) {
        console.error('Update status error:', error);
        res.status(500).json({ error: 'Ошибка при изменении статуса' });
    }
});

// POST /api/bookings/:id/online-schedule — CRM is the control center for app lesson assignment
router.post('/:id/online-schedule', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { teacherId, scheduledAt, meetingUrl } = req.body || {};
        if (!teacherId || !scheduledAt || !meetingUrl) {
            return res.status(400).json({ success: false, error: 'Выберите преподавателя, дату и ссылку' });
        }

        const booking = await prisma.booking.findUnique({ where: { id: req.params.id } });
        if (!booking?.externalSourceId) {
            return res.status(400).json({ success: false, error: 'Заявка не связана с приложением' });
        }

        const teacher = await prisma.student.findFirst({
            where: { id: teacherId, role: 'teacher' },
            select: { id: true, name: true, lastName: true, appUserId: true, externalLinkStatus: true },
        });
        if (!teacher) return res.status(404).json({ success: false, error: 'Преподаватель не найден' });
        if (!teacher.appUserId || teacher.externalLinkStatus !== 'linked') {
            return res.status(400).json({ success: false, error: 'Сначала подключите преподавателя к приложению' });
        }

        const when = new Date(scheduledAt);
        if (Number.isNaN(when.getTime())) {
            return res.status(400).json({ success: false, error: 'Некорректная дата урока' });
        }

        const syncResult = await syncOnlineLessonToLearningPlatform(booking.externalSourceId, {
            action: 'schedule',
            crmTeacherId: teacher.id,
            scheduledAt: when.toISOString(),
            meetingUrl: String(meetingUrl).trim(),
        });

        const teacherName = `${teacher.name} ${teacher.lastName || ''}`.trim();
        const updated = await prisma.booking.update({
            where: { id: booking.id },
            data: {
                status: booking.requestType === 'trial' ? 'trial' : 'processed',
                appStatus: 'scheduled',
                onlineTeacherId: teacher.id,
                onlineTeacherName: teacherName,
                onlineScheduledAt: when,
                onlineMeetingUrl: String(meetingUrl).trim(),
                processedById: req.user.id,
                processedAt: new Date(),
            },
        });

        return res.json({
            success: true,
            message: 'Урок назначен и отправлен в приложение',
            booking: { ...updated, _id: updated.id },
            app: syncResult.data || null,
        });
    } catch (error) {
        console.error('Online schedule sync error:', error.response?.data || error);
        return res.status(error.response?.status || 500).json({
            success: false,
            error: error.response?.data?.error || 'Не удалось назначить урок в приложении',
        });
    }
});

// PATCH /api/bookings/:id/loss — отдельное проставление причины/этапа потери без смены статуса
router.patch('/:id/loss', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { lossReason, lossStage } = req.body;
        if (!lossReason && !lossStage) {
            return res.status(400).json({ success: false, error: 'Укажите причину или этап потери' });
        }
        const data = { lostAt: new Date() };
        if (lossReason) data.lossReason = String(lossReason).substring(0, 200);
        if (lossStage) data.lossStage = String(lossStage).substring(0, 40);

        const booking = await prisma.booking.update({
            where: { id: req.params.id },
            data,
        });
        res.json({ success: true, booking: { ...booking, _id: booking.id } });
    } catch (error) {
        console.error('Update loss error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при сохранении причины потери' });
    }
});

// POST /api/bookings/create-admin
router.post('/create-admin', authenticate, requireSalesOrAdmin, [
    body('name').notEmpty(), body('lastName').notEmpty(), body('phone').notEmpty(), body('direction').notEmpty()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const {
            name, lastName, middleName, dateOfBirth, phone, direction, source, notes, groupId, referrerStudentId,
            trialTeacherId, trialRoomId, trialScheduledAt, depositPaid,
        } = req.body;
        const parsedDateOfBirth = parseOptionalDate(dateOfBirth);
        if (dateOfBirth && parsedDateOfBirth === undefined) {
            return res.status(400).json({ success: false, error: 'Некорректная дата рождения' });
        }

        let refStudentId = null;
        let refBookingId = null;
        if (referrerStudentId) {
            if (referrerStudentId.startsWith('booking_')) {
                refBookingId = referrerStudentId.replace('booking_', '');
            } else {
                refStudentId = referrerStudentId;
            }
        }

        let groupInfo = null;
        if (groupId) {
            groupInfo = await prisma.group.findUnique({ where: { id: groupId }, select: { id: true, name: true, schedules: true } });
        }

        const teacher = trialTeacherId
            ? await prisma.student.findFirst({
                where: {
                    id: trialTeacherId,
                    role: 'teacher',
                    status: 'active',
                    appUserId: { not: null },
                    externalLinkStatus: 'linked',
                },
                select: { id: true, name: true, lastName: true },
            })
            : null;
        if (trialTeacherId && !teacher) {
            return res.status(400).json({ success: false, error: 'Преподаватель не найден или не подключён к приложению' });
        }

        const room = trialRoomId
            ? await prisma.room.findFirst({
                where: { id: trialRoomId, isActive: true },
                select: { id: true, name: true },
            })
            : null;
        if (trialRoomId && !room) {
            return res.status(400).json({ success: false, error: 'Кабинет не найден или неактивен' });
        }

        const scheduledAt = trialScheduledAt ? new Date(trialScheduledAt) : null;
        if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
            return res.status(400).json({ success: false, error: 'Некорректная дата пробного урока' });
        }
        if ((trialTeacherId || trialRoomId || scheduledAt) && (!teacher || !room || !scheduledAt)) {
            return res.status(400).json({
                success: false,
                error: 'Для назначения пробного выберите преподавателя, кабинет, дату и время',
            });
        }

        const bookingData = {
                name, lastName, middleName: middleName || null, dateOfBirth: parsedDateOfBirth || null, phone, phoneDigits: phoneDigits(phone),
                direction, source: source || 'Не указан',
                notes,
                createdBy: 'admin',
                status: scheduledAt ? 'trial' : 'new',
                trialTeacherId: teacher?.id || null,
                trialTeacherName: teacher ? `${teacher.name} ${teacher.lastName || ''}`.trim() : null,
                trialRoomId: room?.id || null,
                trialRoomName: room?.name || null,
                trialScheduledAt: scheduledAt,
                depositPaid: Boolean(depositPaid),
        };
        if (groupId) bookingData.group = { connect: { id: groupId } };
        if (req.user.id) bookingData.processedBy = { connect: { id: req.user.id } };
        if (refStudentId) bookingData.referrerStudentId = refStudentId;
        if (refBookingId) bookingData.referrerBookingId = refBookingId;

        const booking = await prisma.$transaction(async tx => {
            const created = await tx.booking.create({ data: bookingData });
            const trialClassId = await syncTrialClass(tx, created, {
                teacher,
                room,
                scheduledAt,
                depositPaid: Boolean(depositPaid),
            }, req.user.id);
            if (!trialClassId) return created;
            return tx.booking.update({
                where: { id: created.id },
                data: { trialClassId },
            });
        });

        res.status(201).json({
            success: true, message: 'Заявка создана администратором',
            booking: { ...booking, _id: booking.id, group: groupInfo ? { ...groupInfo, _id: groupInfo.id } : null }
        });
    } catch (error) {
        console.error('Admin create booking error:', error);
        const status = ['TRIAL_SCHEDULE_CONFLICT', 'TRIAL_ALREADY_COMPLETED', 'P2002'].includes(error.code) ? 409
            : (['TRIAL_DETAILS_REQUIRED', 'TRIAL_DATE_INVALID'].includes(error.code) ? 400 : 500);
        const message = error.code === 'P2002'
            ? 'Преподаватель или кабинет уже занят в это время'
            : (error.message || 'Ошибка при создании заявки');
        res.status(status).json({ success: false, error: message });
    }
});

// PATCH /api/bookings/:id/trial-details — назначение пробного без привязки к карточке ученика.
router.patch('/:id/trial-details', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { teacherId, roomId, scheduledAt, depositPaid } = req.body || {};
        const booking = await prisma.booking.findUnique({ where: { id: req.params.id } });
        if (!booking) return res.status(404).json({ success: false, error: 'Заявка не найдена' });

        const teacher = teacherId
            ? await prisma.student.findFirst({
                where: {
                    id: teacherId,
                    role: 'teacher',
                    status: 'active',
                    appUserId: { not: null },
                    externalLinkStatus: 'linked',
                },
                select: { id: true, name: true, lastName: true },
            })
            : null;
        if (teacherId && !teacher) {
            return res.status(400).json({ success: false, error: 'Преподаватель не найден или не подключён к приложению' });
        }

        const room = roomId
            ? await prisma.room.findFirst({
                where: { id: roomId, isActive: true },
                select: { id: true, name: true },
            })
            : null;
        if (roomId && !room) {
            return res.status(400).json({ success: false, error: 'Кабинет не найден или неактивен' });
        }

        const when = scheduledAt ? new Date(scheduledAt) : null;
        if (when && Number.isNaN(when.getTime())) {
            return res.status(400).json({ success: false, error: 'Некорректная дата пробного урока' });
        }
        if ((teacherId || roomId || when) && (!teacher || !room || !when)) {
            return res.status(400).json({
                success: false,
                error: 'Для назначения пробного выберите преподавателя, кабинет, дату и время',
            });
        }

        const updated = await prisma.$transaction(async tx => {
            const lockedBookings = await tx.$queryRaw`
                SELECT * FROM "Booking" WHERE id = ${booking.id} FOR UPDATE
            `;
            const lockedBooking = lockedBookings[0];
            if (!lockedBooking) {
                const error = new Error('Заявка не найдена');
                error.code = 'BOOKING_NOT_FOUND';
                throw error;
            }
            const trialClassId = await syncTrialClass(tx, lockedBooking, {
                teacher,
                room,
                scheduledAt: when,
                depositPaid: Boolean(depositPaid),
            }, req.user.id);
            return tx.booking.update({
                where: { id: lockedBooking.id },
                data: {
                    trialTeacherId: teacher?.id || null,
                    trialTeacherName: teacher ? `${teacher.name} ${teacher.lastName || ''}`.trim() : null,
                    trialRoomId: room?.id || null,
                    trialRoomName: room?.name || null,
                    trialScheduledAt: when,
                    trialClassId,
                    depositPaid: Boolean(depositPaid),
                    status: ['sold', 'rejected'].includes(lockedBooking.status)
                        ? lockedBooking.status
                        : (when ? 'trial' : 'processed'),
                    processedById: lockedBooking.processedById || req.user.id,
                    processedAt: lockedBooking.processedAt || new Date(),
                },
            });
        });

        res.json({ success: true, booking: { ...updated, _id: updated.id } });
    } catch (error) {
        console.error('Update trial details error:', error);
        const status = ['TRIAL_SCHEDULE_CONFLICT', 'TRIAL_ALREADY_COMPLETED', 'P2002'].includes(error.code) ? 409
            : (['TRIAL_DETAILS_REQUIRED', 'TRIAL_DATE_INVALID'].includes(error.code) ? 400 : 500);
        const message = error.code === 'P2002'
            ? 'Преподаватель или кабинет уже занят в это время'
            : (error.message || 'Не удалось сохранить пробный урок');
        res.status(status).json({ success: false, error: message });
    }
});

// POST /api/bookings/:id/convert — create a student card from a booking.
// Memberships and payments are deliberately created later from the student card.
router.post('/:id/convert', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const booking = await prisma.booking.findUnique({ where: { id: req.params.id } });
        if (!booking) return res.status(404).json({ success: false, error: 'Заявка не найдена' });
        if (booking.convertedToStudentId) return res.status(400).json({ success: false, error: 'Заявка уже конвертирована' });

        const existingStudent = await prisma.student.findUnique({ where: { phone: booking.phone } });
        if (existingStudent) return res.status(400).json({ success: false, error: 'Ученик с таким телефоном уже существует' });

        const { referrerStudentId: bodyReferrerStudentId } = req.body;

        const generatedPassword = req.body.password || Math.random().toString(36).slice(-8);
        const hashedPassword = await bcrypt.hash(generatedPassword, 10);

        // Реферер: из тела запроса имеет приоритет над сохранённым в заявке
        let refStudentId = booking.referrerStudentId || null;
        let refBookingId = booking.referrerBookingId || null;

        if (bodyReferrerStudentId) {
            if (bodyReferrerStudentId.startsWith('booking_')) {
                refBookingId = bodyReferrerStudentId.replace('booking_', '');
                refStudentId = null;
            } else {
                refStudentId = bodyReferrerStudentId;
                refBookingId = null;
            }
        }
        
        // Transaction: create only the student card and preserve booking/referral history.
        const result = await prisma.$transaction(async (tx) => {
            const student = await tx.student.create({
                data: {
                    name: booking.name || 'Не указано',
                    lastName: booking.lastName || '',
                    middleName: booking.middleName || null,
                    dateOfBirth: booking.dateOfBirth || null,
                    phone: booking.phone || '',
                    phoneDigits: phoneDigits(booking.phone),
                    password: hashedPassword,
                    // Gender is profile data. It is filled in from the student card,
                    // not while choosing a membership.
                    gender: null,
                    role: 'student',
                    acquisitionSource: booking.source || null,
                    learningDirections: booking.direction ? [booking.direction] : [],
                    notes: booking.notes || null,
                    referredByStudentId: refStudentId,
                    referredByBookingId: refBookingId
                }
            });

            // Resolve any pending referrals that pointed to THIS booking
            await tx.student.updateMany({
                where: { referredByBookingId: booking.id },
                data: { referredByStudentId: student.id, referredByBookingId: null }
            });
            await tx.booking.updateMany({
                where: { referrerBookingId: booking.id },
                data: { referrerStudentId: student.id, referrerBookingId: null }
            });

            await tx.booking.update({
                where: { id: booking.id },
                data: {
                    convertedToStudentId: student.id,
                    // Создание карточки не означает продажу. Заявка закрывается только реальным платежом.
                    status: 'trial',
                    processedAt: new Date(), processedById: booking.processedById || req.user.id,
                    convertedById: req.user.id, convertedAt: new Date(),
                    // сохраняем реферера в заявке, если пришёл только в этой конвертации
                    referrerStudentId: refStudentId,
                    referrerBookingId: refBookingId
                }
            });
            if (booking.trialClassId) {
                await tx.class.updateMany({
                    where: { id: booking.trialClassId },
                    data: { individualStudentId: student.id },
                });
            }

            return { student };
        });

        let platform = null;
        try {
            const provision = await provisionCrmStudent(result.student.id, { password: generatedPassword });
            if (provision.success) {
                platform = provision.data;
            } else {
                console.warn(`[bookings] LP provision failed for ${result.student.id}:`, provision.error);
            }
        } catch (provisionError) {
            console.error('[bookings] LP provision error:', provisionError);
        }

        res.json({
            success: true, message: 'Карточка ученика создана',
            student: { id: result.student.id, _id: result.student.id, name: result.student.name, phone: result.student.phone },
            membership: null,
            payment: null,
            generatedPassword: req.body.password ? undefined : generatedPassword,
            platform,
        });
    } catch (error) {
        console.error('Convert booking error:', error);
        res.status(500).json({ success: false, error: 'Ошибка конвертации: ' + error.message });
    }
});

// PATCH /api/bookings/:id/source
router.patch('/:id/source', authenticate, async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') return res.status(403).json({ success: false, error: 'Доступ запрещен' });
        const { source } = req.body;
        const booking = await prisma.booking.update({ where: { id: req.params.id }, data: { source: source || '' } });
        res.json({ success: true, message: 'Источник обновлен', booking: { ...booking, _id: booking.id } });
    } catch (error) {
        console.error('Update source error:', error);
        res.status(500).json({ success: false, error: 'Ошибка обновления источника' });
    }
});

// DELETE /api/bookings/:id
router.delete('/:id', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const booking = await prisma.booking.findUnique({ where: { id: req.params.id } });
        if (!booking) return res.status(404).json({ error: 'Заявка не найдена' });
        if (booking.convertedToStudentId) {
            return res.status(400).json({
                success: false,
                error: 'Нельзя удалить заявку, по которой уже создана карточка ученика. Используйте статус и причину потери.',
            });
        }
        await prisma.$transaction(async tx => {
            if (booking.trialClassId) {
                await tx.class.deleteMany({ where: { id: booking.trialClassId } });
            }
            await tx.booking.delete({ where: { id: req.params.id } });
        });
        res.json({ success: true, message: 'Заявка удалена' });
    } catch (error) {
        console.error('Delete booking error:', error);
        res.status(500).json({ error: 'Ошибка при удалении заявки' });
    }
});

module.exports = router;
