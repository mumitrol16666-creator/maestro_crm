const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/db');
const { authenticate, requireAdmin, requireSalesOrAdmin } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const { computeMembershipPrice } = require('../utils/pricing');
const { notify } = require('../services/notifications');
const { provisionCrmStudent } = require('../services/userLink');
const { syncOnlineLessonToLearningPlatform } = require('../services/learningPlatformOnlineLesson');
const { inferBookingLossStage } = require('../utils/bookingLoss');

// Helper: normalize phone to digits
function phoneDigits(phone) {
    return phone ? phone.replace(/\D/g, '') : '';
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

        const { name, lastName, phone, direction, source } = req.body;
        const booking = await prisma.booking.create({
            data: { name, lastName, phone, phoneDigits: phoneDigits(phone), direction, source: source || 'Сайт', createdBy: 'website', status: 'new' }
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
            } else {
                orConditions.push({ AND: [{ name: { contains: words[0], mode: 'insensitive' } }, { lastName: { contains: words[1], mode: 'insensitive' } }] });
                orConditions.push({ AND: [{ lastName: { contains: words[0], mode: 'insensitive' } }, { name: { contains: words[1], mode: 'insensitive' } }] });
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

        const booking = await prisma.booking.update({
            where: { id: req.params.id },
            data,
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

        const { name, lastName, phone, direction, source, notes, groupId, referrerStudentId } = req.body;

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

        const bookingData = {
                name, lastName, phone, phoneDigits: phoneDigits(phone),
                direction, source: source || 'Не указан',
                notes,
                createdBy: 'admin', status: 'new'
        };
        if (groupId) bookingData.group = { connect: { id: groupId } };
        if (req.user.id) bookingData.processedBy = { connect: { id: req.user.id } };
        if (refStudentId) bookingData.referrerStudentId = refStudentId;
        if (refBookingId) bookingData.referrerBookingId = refBookingId;

        const booking = await prisma.booking.create({ data: bookingData });

        res.status(201).json({
            success: true, message: 'Заявка создана администратором',
            booking: { ...booking, _id: booking.id, group: groupInfo ? { ...groupInfo, _id: groupInfo.id } : null }
        });
    } catch (error) {
        console.error('Admin create booking error:', error);
        res.status(500).json({ error: 'Ошибка при создании заявки' });
    }
});

// POST /api/bookings/:id/convert — convert booking to student + membership
router.post('/:id/convert', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const booking = await prisma.booking.findUnique({ where: { id: req.params.id } });
        if (!booking) return res.status(404).json({ success: false, error: 'Заявка не найдена' });
        if (booking.convertedToStudentId) return res.status(400).json({ success: false, error: 'Заявка уже конвертирована' });

        const existingStudent = await prisma.student.findUnique({ where: { phone: booking.phone } });
        if (existingStudent) return res.status(400).json({ success: false, error: 'Ученик с таким телефоном уже существует' });

        const {
            gender, groupId, membershipType,
            totalPrice, basePriceOverride,
            skipConcession,
            referrerStudentId: bodyReferrerStudentId
        } = req.body;
        if (!gender) return res.status(400).json({ success: false, error: 'Укажите пол' });
        if (!membershipType) return res.status(400).json({ success: false, error: 'Укажите тип абонемента' });

        const individualTypes = new Set(['trial', 'individual_single', 'individual_package']);
        const isIndividualMembership = individualTypes.has(membershipType);
        if (!isIndividualMembership && !groupId) {
            return res.status(400).json({
                success: false,
                error: 'Для группового абонемента выберите группу',
            });
        }

        const group = groupId
            ? await prisma.group.findUnique({ where: { id: groupId } })
            : null;
        if (groupId && !group) return res.status(404).json({ success: false, error: 'Группа не найдена' });

        const generatedPassword = req.body.password || Math.random().toString(36).slice(-8);
        const hashedPassword = await bcrypt.hash(generatedPassword, 10);

        let totalClasses, daysToAdd;
        switch (membershipType) {
            case 'trial': totalClasses = 1; daysToAdd = 7; break;
            case 'monthly': totalClasses = 8; daysToAdd = 30; break;
            case 'monthly_12': totalClasses = 12; daysToAdd = 30; break;
            case 'quarterly': totalClasses = 24; daysToAdd = 90; break;
            case 'single_class': totalClasses = 1; daysToAdd = 7; break;
            case 'individual_single': totalClasses = 1; daysToAdd = 7; break;
            case 'individual_package': totalClasses = 8; daysToAdd = 90; break;
            default: totalClasses = 1; daysToAdd = 30;
        }

        let startDate = new Date();
        if (req.body.startDate) startDate = new Date(`${req.body.startDate}T00:00:00`);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + daysToAdd);

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
        
        const freezesAvailable = gender === 'female' ? 2 : 1;

        // Пробный урок всегда индивидуальный. Распределение в группу происходит
        // после пробного отдельным действием администратора.
        const effectiveGroupId = isIndividualMembership ? null : groupId;
        const lessonFormat = membershipType === 'trial' ? 'trial' : (isIndividualMembership ? 'individual' : 'group');

        // Transaction: create student + membership + optionally update group
        const result = await prisma.$transaction(async (tx) => {
            const student = await tx.student.create({
                data: {
                    name: booking.name || 'Не указано',
                    lastName: booking.lastName || '',
                    phone: booking.phone || '',
                    password: hashedPassword,
                    gender: gender === 'male' ? 'male' : 'female',
                    role: 'student',
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

            if (effectiveGroupId) {
                await tx.studentGroup.create({
                    data: { studentId: student.id, groupId: effectiveGroupId, status: 'active' },
                });
            }

            // Считаем цену со скидками ПОСЛЕ создания ученика (чтобы referredByStudentId учитывался)
            const overrideCandidate = Number(basePriceOverride);
            const legacyCandidate = Number(totalPrice);
            const override = Number.isFinite(overrideCandidate) && overrideCandidate > 0
                ? overrideCandidate
                : (Number.isFinite(legacyCandidate) && legacyCandidate > 0 ? legacyCandidate : undefined);
            const manualPriceGiven = Number.isFinite(overrideCandidate) && overrideCandidate > 0;
            const pricing = await computeMembershipPrice(student.id, membershipType, {
                basePriceOverride: override,
                skipConcession: !!skipConcession,
                skipAllDiscounts: manualPriceGiven,
                groupId: effectiveGroupId || undefined,
            }, tx);
            const price = pricing.totalPrice;

            const membership = await tx.membership.create({
                data: {
                    studentId: student.id,
                    groupId: effectiveGroupId,
                    lessonFormat,
                    type: membershipType,
                    totalClasses,
                    classesRemaining: totalClasses,
                    startDate, endDate, freezesAvailable, createdById: req.user.id, bookingId: booking.id, source: 'booking',
                    totalPrice: price, paidAmount: 0, remainingAmount: 0, paymentStatus: 'detached',
                    basePrice: pricing.basePrice,
                    discountPercent: pricing.discountPercent,
                    discountReferralPercent: pricing.discountReferralPercent,
                    discountFamilyPercent: pricing.discountFamilyPercent,
                    discountConcessionPercent: pricing.discountConcessionPercent
                }
            });

            // Payments are handled separately, so no payment is created during conversion
            let payment = null;

            await tx.student.update({ where: { id: student.id }, data: { activeMembershipId: membership.id } });
            if (effectiveGroupId) {
                await tx.group.update({
                    where: { id: effectiveGroupId },
                    data: { currentStudents: { increment: 1 } },
                });
            }
            await tx.booking.update({
                where: { id: booking.id },
                data: {
                    convertedToStudentId: student.id,
                    groupId: effectiveGroupId,
                    status: 'sold',
                    processedAt: new Date(), processedById: booking.processedById || req.user.id,
                    convertedById: req.user.id, convertedAt: new Date(),
                    // сохраняем реферера в заявке, если пришёл только в этой конвертации
                    referrerStudentId: refStudentId,
                    referrerBookingId: refBookingId
                }
            });

            return { student, membership, payment };
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
            success: true, message: 'Заявка конвертирована',
            student: { id: result.student.id, _id: result.student.id, name: result.student.name, phone: result.student.phone },
            membership: { id: result.membership.id, _id: result.membership.id, type: result.membership.type, classesRemaining: result.membership.classesRemaining },
            payment: result.payment,
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
        await prisma.booking.delete({ where: { id: req.params.id } });
        res.json({ success: true, message: 'Заявка удалена' });
    } catch (error) {
        console.error('Delete booking error:', error);
        res.status(500).json({ error: 'Ошибка при удалении заявки' });
    }
});

module.exports = router;
