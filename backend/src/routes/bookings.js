const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/db');
const { authenticate, requireAdmin, requireSalesOrAdmin } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const { computeMembershipPrice } = require('../utils/pricing');

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
        const { status } = req.body;
        const validStatuses = ['new', 'processed', 'trial', 'sold', 'rejected'];
        if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Неверный статус' });

        const booking = await prisma.booking.update({
            where: { id: req.params.id },
            data: { status, processedById: req.user.id, processedAt: new Date() }
        });

        res.json({ success: true, message: `Статус изменен на "${status}"`, booking: { ...booking, _id: booking.id } });
    } catch (error) {
        console.error('Update status error:', error);
        res.status(500).json({ error: 'Ошибка при изменении статуса' });
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

        let groupInfo = null;
        if (groupId) {
            groupInfo = await prisma.group.findUnique({ where: { id: groupId }, select: { id: true, name: true, schedules: true } });
        }

        const booking = await prisma.booking.create({
            data: {
                name, lastName, phone, phoneDigits: phoneDigits(phone),
                direction, source: source || 'Не указан',
                groupId: groupId || null, notes,
                referrerStudentId: referrerStudentId || null,
                createdBy: 'admin', processedById: req.user.id, status: 'new'
            }
        });

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
            paymentType, advanceAmount, advanceDueDate, paymentMethod,
            skipConcession,
            referrerStudentId: bodyReferrerStudentId
        } = req.body;
        if (!gender) return res.status(400).json({ success: false, error: 'Укажите пол' });
        if (!groupId) return res.status(400).json({ success: false, error: 'Выберите группу' });
        if (!membershipType) return res.status(400).json({ success: false, error: 'Укажите тип абонемента' });

        const group = await prisma.group.findUnique({ where: { id: groupId } });
        if (!group) return res.status(404).json({ success: false, error: 'Группа не найдена' });

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
        const referrerStudentId = bodyReferrerStudentId || booking.referrerStudentId || null;
        const freezesAvailable = gender === 'female' ? 2 : 1;

        // Transaction: create student + membership + update booking + update group
        const result = await prisma.$transaction(async (tx) => {
            const student = await tx.student.create({
                data: {
                    name: booking.name || 'Не указано',
                    lastName: booking.lastName || '',
                    phone: booking.phone || '',
                    password: hashedPassword,
                    gender: gender === 'male' ? 'male' : 'female',
                    role: 'student',
                    referredByStudentId: referrerStudentId || null
                }
            });

            await tx.studentGroup.create({ data: { studentId: student.id, groupId, status: 'active' } });

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
                skipAllDiscounts: manualPriceGiven
            });
            const price = pricing.totalPrice;

            const membership = await tx.membership.create({
                data: {
                    studentId: student.id, groupId, type: membershipType, totalClasses, classesRemaining: totalClasses,
                    startDate, endDate, freezesAvailable, createdById: req.user.id, bookingId: booking.id, source: 'booking',
                    totalPrice: price, paidAmount: 0, remainingAmount: price, paymentStatus: 'not_paid',
                    basePrice: pricing.basePrice,
                    discountPercent: pricing.discountPercent,
                    discountReferralPercent: pricing.discountReferralPercent,
                    discountFamilyPercent: pricing.discountFamilyPercent,
                    discountConcessionPercent: pricing.discountConcessionPercent
                }
            });

            // Create payment if applicable
            let payment = null;
            const hasPayment = paymentType && paymentType !== 'later' && price > 0;
            const hasDueDateForLater = paymentType === 'later' && (advanceDueDate || price > 0); // Создаем запись даже с 0 для трекинга срока

            if (hasPayment || hasDueDateForLater) {
                // Маппинг типа платежа
                let pType = 'membership_full';
                if (membershipType === 'trial') {
                    pType = paymentType === 'advance' ? 'trial_advance' : 'trial_full';
                } else {
                    if (paymentType === 'advance') pType = 'membership_advance';
                    else if (paymentType === 'later') pType = 'membership_advance'; // Используем как базу
                }
                
                const payAmount = paymentType === 'later' ? 0 : (paymentType === 'advance' ? (advanceAmount || 0) : price);

                const paymentData = {
                    studentId: student.id, managerId: req.user.id, amount: payAmount, type: pType,
                    membershipId: membership.id, bookingId: booking.id, status: 'completed', commissionStatus: 'pending',
                    isFirstMembershipForManager: true,
                    notes: `Конвертация из заявки${paymentType === 'later' ? ' (Оплата позже)' : (paymentType === 'advance' ? ' (Аванс)' : '')}`,
                    paymentMethod: payAmount > 0 ? (paymentMethod || null) : null,
                    basePrice: pricing.basePrice,
                    discountPercent: pricing.discountPercent,
                    discountReferralPercent: pricing.discountReferralPercent,
                    discountFamilyPercent: pricing.discountFamilyPercent,
                    discountConcessionPercent: pricing.discountConcessionPercent
                };

                if (advanceDueDate && advanceDueDate.trim() !== '') {
                    paymentData.dueDate = new Date(advanceDueDate);
                }

                payment = await tx.payment.create({ data: paymentData });

                const paidAmt = payAmount;
                await tx.membership.update({
                    where: { id: membership.id },
                    data: { paidAmount: paidAmt, remainingAmount: price - paidAmt, paymentStatus: paidAmt >= price ? 'paid' : (paidAmt > 0 ? 'partial' : 'not_paid') }
                });
            }

            await tx.student.update({ where: { id: student.id }, data: { activeMembershipId: membership.id } });
            await tx.group.update({ where: { id: groupId }, data: { currentStudents: { increment: 1 } } });
            await tx.booking.update({
                where: { id: booking.id },
                data: {
                    convertedToStudentId: student.id, groupId, status: 'sold',
                    processedAt: new Date(), processedById: req.user.id,
                    // сохраняем реферера в заявке, если пришёл только в этой конвертации
                    referrerStudentId: referrerStudentId || booking.referrerStudentId || null
                }
            });

            return { student, membership, payment };
        });

        res.json({
            success: true, message: 'Заявка конвертирована',
            student: { id: result.student.id, _id: result.student.id, name: result.student.name, phone: result.student.phone },
            membership: { id: result.membership.id, _id: result.membership.id, type: result.membership.type, classesRemaining: result.membership.classesRemaining },
            payment: result.payment,
            generatedPassword: req.body.password ? undefined : generatedPassword
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
