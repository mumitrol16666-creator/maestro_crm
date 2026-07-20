const express = require('express');
const router = express.Router();

function parseOptionalDate(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    return date;
}
const { prisma } = require('../config/db');
const { Prisma } = require('@prisma/client');
const { authenticate, requireSalesOrAdmin, requireTeacherOrAdmin, requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const {
    getLinkStatus,
    linkUsers,
    createSsoToken,
    provisionCrmStudent,
    syncPasswordToLearningPlatform,
} = require('../services/userLink');
const { ensureStudentContactPhoneAvailable } = require('../services/studentPhonePolicy');
const {
    normalizeNotificationFlag,
    assertUniqueNotificationRoutes,
} = require('../services/studentNotificationRouting');
const { getStudentRegularSchedule, updateStudentRegularSchedule } = require('../services/studentSchedule');
const { estimateLessonsFromBalance, getMembershipLessonPrice } = require('../utils/membershipBalance');
const bcrypt = require('bcryptjs');
const { LOST_STUDENT_MONTHS, getLostThresholdDate } = require('../utils/students');
const {
    DEPARTURE_REASONS,
    finishStudentEducation,
    restoreFormerStudent,
    permanentlyDeleteStudent,
} = require('../services/studentDeparture');
const { linkOpenBookingsForStudent } = require('../services/bookingStudentLink');

function normalizeAdditionalPhones(additionalPhones, primaryPhone) {
    if (!Array.isArray(additionalPhones)) return null;

    const primaryDigits = String(primaryPhone || '').replace(/\D/g, '');
    const seen = new Set();

    return additionalPhones
        .map(item => ({
            phone: String(item?.phone || '').trim(),
            phoneDigits: String(item?.phone || '').replace(/\D/g, ''),
            label: String(item?.label || '').trim() || null,
            notifyHomework: normalizeNotificationFlag(item?.notifyHomework),
            notifyLessons: normalizeNotificationFlag(item?.notifyLessons),
            notifyPayments: normalizeNotificationFlag(item?.notifyPayments),
        }))
        .filter(item => item.phone && item.phoneDigits.length >= 5)
        .filter(item => {
            if (item.phoneDigits === primaryDigits || seen.has(item.phoneDigits)) return false;
            seen.add(item.phoneDigits);
            return true;
        });
}

function formatStudentRouteFio(person, fallback = '') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function parseSignedBalanceAmount(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return null;
    const rounded = Math.trunc(amount);
    return rounded !== 0 ? rounded : null;
}

function formatSignedMoney(amount) {
    return `${amount > 0 ? '+' : ''}${amount} ₸`;
}

router.get('/meta/departure-reasons', authenticate, requireAdmin, (req, res) => {
    res.json({ success: true, reasons: DEPARTURE_REASONS });
});

function addWhereAnd(where, condition) {
    if (!condition) return;
    if (where.OR) {
        where.AND = [...(where.AND || []), { OR: where.OR }];
        delete where.OR;
    }
    where.AND = [...(where.AND || []), condition];
}

function teacherStudentScope(teacherId) {
    return {
        OR: [
            { assignedTeacherId: teacherId },
            {
                groups: {
                    some: {
                        status: { in: ['active', 'Active'] },
                        group: { teacherId, isActive: true },
                    },
                },
            },
            { schedules: { some: { teacherId, isPractice: false } } },
            { memberships: { some: { teacherId, status: 'active' } } },
        ],
    };
}

// GET /api/students
router.get('/', authenticate, requireTeacherOrAdmin, async (req, res) => {
    try {
        const {
            search,
            page = 1,
            limit = 20,
            status,
            filter: rawFilter,
            role: roleQuery,
            sortBy = 'name',
            sortOrder = 'asc'
        } = req.query;
        const filter = rawFilter === 'with-debt' ? 'with_debt' : rawFilter;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;
        const order = sortOrder === 'desc' ? 'desc' : 'asc';
        const orderBy = {
            name: [{ lastName: order }, { name: order }, { createdAt: 'desc' }],
            phone: [{ phone: order }, { lastName: 'asc' }, { name: 'asc' }],
            teacher: [
                { assignedTeacher: { lastName: order } },
                { assignedTeacher: { name: order } },
                { lastName: 'asc' },
                { name: 'asc' }
            ],
            balance: [{ accountBalance: order }, { lastName: 'asc' }, { name: 'asc' }],
            createdAt: [{ createdAt: order }]
        }[sortBy] || [{ lastName: 'asc' }, { name: 'asc' }, { createdAt: 'desc' }];

        // Роль берём из query, по умолчанию — student (обратная совместимость).
        // Поддерживаем только student/teacher, чтобы исключить выдачу админов.
        const allowedRoles = ['student', 'teacher'];
        const role = allowedRoles.includes(roleQuery) ? roleQuery : 'student';

        const where = { role };
        if (status) where.status = status;

        if (search && search.trim() && req.user.role !== 'teacher') {
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
            if (digits.length >= 3) orConditions.push({ phoneDigits: { contains: digits } });
            if (digits.length >= 3) {
                orConditions.push({ additionalPhones: { some: { phoneDigits: { contains: digits } } } });
            }
            where.OR = orConditions;
        }

        // Фильтр "Потерянные": источник истины — последний платёж.
        // Ученик "потерян", если последний платёж был ≥ 3 мес. назад ИЛИ платежей
        // не было и он зарегистрирован > 3 мес. назад.
        if (filter === 'lost') {
            const threshold = getLostThresholdDate();
            const lostRows = await prisma.$queryRaw`
                SELECT s.id
                FROM "Student" s
                WHERE s.role = 'student'
                AND COALESCE(
                    (SELECT MAX(p."paymentDate") FROM "Payment" p
                     WHERE p."studentId" = s.id AND p."paymentDate" IS NOT NULL),
                    s."createdAt"
                ) < ${threshold}
            `;
            const lostIds = lostRows.map(r => r.id);
            if (lostIds.length === 0) {
                return res.json({ success: true, count: 0, total: 0, page: pageNum, pages: 0, students: [] });
            }
            where.id = { in: lostIds };
        }

        // Фильтр «С долгом»: отрицательный независимый денежный баланс.
        if (filter === 'with_debt') {
            const debtRows = await prisma.$queryRaw`
                SELECT DISTINCT s.id
                FROM "Student" s
                WHERE s.role = 'student'
                AND s."accountBalance" < 0
            `;
            const debtIds = debtRows.map(r => r.id);
            if (debtIds.length === 0) {
                return res.json({ success: true, count: 0, total: 0, page: pageNum, pages: 0, students: [] });
            }
            where.id = { in: debtIds };
        }

        if (role === 'student' && req.user.role === 'teacher') {
            addWhereAnd(where, teacherStudentScope(req.user.id));
        }

        const [students, total] = await Promise.all([
            prisma.student.findMany({
                where,
                select: {
                    id: true, name: true, lastName: true, middleName: true, dateOfBirth: true, phone: true, email: true, gender: true, accountBalance: true, studentAvatar: true,
                    status: true, notes: true, registeredAt: true, createdAt: true,
                    customerName: true, customerType: true, acquisitionSource: true,
                    learningDirections: true, learningLevel: true,
                    salaryIndividual: true, salaryGroup: true, salaryOther: true,
                    additionalPhones: { orderBy: { createdAt: 'asc' } },
                    assignedTeacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                    activeMembershipId: true,
                    appUserId: true, externalLinkStatus: true, linkedAt: true,
                    groups: {
                        where: { status: 'active', group: { is: { isActive: true } } },
                        include: { group: { select: { id: true, name: true, direction: true, schedules: true } } }
                    },
                    memberships: { 
                        where: { status: 'active' },
                        orderBy: { createdAt: 'desc' },
                        select: {
                            id: true, type: true, lessonFormat: true, classesRemaining: true, totalClasses: true,
                            individualClassesRemaining: true, groupClassesRemaining: true, theoryClassesRemaining: true,
                            startDate: true, endDate: true, status: true, groupId: true,
                            remainingAmount: true, paymentStatus: true, paidAmount: true, totalPrice: true
                        }
                    }
                },
                orderBy,
                skip, take: limitNum
            }),
            prisma.student.count({ where })
        ]);

        const now = new Date();

        // Считаем дату последнего платежа и последнего посещённого занятия.
        // Последний платёж — основа статуса "потерян".
        // Последнее занятие — справочно (показываем в карточке).
        const pageIds = students.map(s => s.id);
        const lastPaymentMap = {};
        const lastAttendedMap = {};
        if (pageIds.length > 0) {
            const lastPaymentRows = await prisma.$queryRaw`
                SELECT p."studentId" AS "studentId", MAX(p."paymentDate") AS "lastDate"
                FROM "Payment" p
                WHERE p."studentId" IN (${Prisma.join(pageIds)})
                AND p."paymentDate" IS NOT NULL
                GROUP BY p."studentId"
            `;
            for (const row of lastPaymentRows) {
                lastPaymentMap[row.studentId] = row.lastDate;
            }
            const lastAttendedRows = await prisma.$queryRaw`
                SELECT ca."studentId" AS "studentId", MAX(c.date) AS "lastDate"
                FROM "ClassAttendee" ca
                JOIN "Class" c ON c.id = ca."classId"
                WHERE ca."studentId" IN (${Prisma.join(pageIds)})
                AND ca.attended = true
                GROUP BY ca."studentId"
            `;
            for (const row of lastAttendedRows) {
                lastAttendedMap[row.studentId] = row.lastDate;
            }
        }

        const lostThreshold = getLostThresholdDate();

        const mapped = students.map(s => {
            // Выбираем абонемент для отображения долга с тем же приоритетом, что в карточке:
            // сначала monthly/quarterly/individual_package, иначе — первый активный.
            // Это важно, чтобы список и профиль смотрели на ОДИН и тот же абонемент
            // (например, если у ученика есть активный trial + monthly со split-долгом).
            const activeMemberships = s.memberships || [];
            let bestMembership = activeMemberships.find(m =>
                m.type === 'monthly' || m.type === 'monthly_12' || m.type === 'quarterly' || m.type === 'individual_package'
            );
            if (!bestMembership) bestMembership = activeMemberships[0] || null;

            let debtAmount = Math.max(0, -(s.accountBalance || 0));
            const isOverdue = false;
            const overdueDays = 0;
            const promisedPaymentDate = null;

            const lastAttendedDate = lastAttendedMap[s.id] || null;
            const lastPaymentDate = lastPaymentMap[s.id] || null;
            // "Потерян" — если последний платёж старше порога в 3 мес.
            // Если платежей не было — отсчитываем от даты регистрации (фора новичку).
            const activityRef = lastPaymentDate ? new Date(lastPaymentDate) : new Date(s.createdAt);
            const isLost = activityRef < lostThreshold;

            return {
                ...s, _id: s.id, password: undefined,
                groups: s.groups.map(sg => ({
                    ...sg,
                    groupId: sg.group ? { ...sg.group, _id: sg.group.id } : null,
                    group: sg.group ? { ...sg.group, _id: sg.group.id } : null
                })),
                activeMembership: bestMembership ? { ...bestMembership, _id: bestMembership.id, payments: undefined } : null,
                memberships: undefined,
                debtAmount,
                isOverdue,
                overdueDays,
                promisedPaymentDate,
                lastAttendedDate,
                lastPaymentDate,
                isLost
            };
        });

        if (search && search.trim()) {
            const term = search.trim();
            const digits = term.replace(/\D/g, '');
            const words = term.split(/\s+/);
            const bookingOrConditions = [];
            if (words.length === 1) {
                bookingOrConditions.push({ name: { contains: term, mode: 'insensitive' } });
                bookingOrConditions.push({ lastName: { contains: term, mode: 'insensitive' } });
            } else {
                bookingOrConditions.push({ AND: [{ name: { contains: words[0], mode: 'insensitive' } }, { lastName: { contains: words[1], mode: 'insensitive' } }] });
                bookingOrConditions.push({ AND: [{ lastName: { contains: words[0], mode: 'insensitive' } }, { name: { contains: words[1], mode: 'insensitive' } }] });
            }
            if (digits.length >= 3) bookingOrConditions.push({ phoneDigits: { contains: digits } });

            const matchingBookings = await prisma.booking.findMany({
                where: {
                    OR: bookingOrConditions,
                    convertedToStudentId: null,
                    status: { in: ['new', 'processed', 'trial'] }
                },
                take: 5
            });

            const mappedBookings = matchingBookings.map(b => ({
                id: `booking_${b.id}`,
                _id: `booking_${b.id}`,
                name: b.name,
                lastName: b.lastName,
                middleName: b.middleName,
                phone: b.phone,
                isBooking: true,
                groups: [],
                activeMembership: null,
                debtAmount: 0,
                isOverdue: false,
                overdueDays: 0,
                isLost: false
            }));

            mapped.push(...mappedBookings);
        }

        res.json({ success: true, count: mapped.length, total, page: pageNum, pages: Math.ceil(total / limitNum), students: mapped });
    } catch (error) {
        console.error('Get students error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения учеников' });
    }
});

// POST /api/students/stats/batch-light (Массовое получение статистики)
router.post('/stats/batch-light', authenticate, async (req, res) => {
    try {
        const { studentIds } = req.body;
        if (!studentIds || !Array.isArray(studentIds)) {
            return res.status(400).json({ success: false, error: 'studentIds должен быть массивом' });
        }

        // Получаем пропуски за текущий месяц для всех указанных учеников
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const attendances = await prisma.classAttendee.findMany({
            where: {
                studentId: { in: studentIds },
                attended: false,
                class: { date: { gte: startOfMonth } }
            },
            select: { studentId: true }
        });

        // Группируем пропуски по студентам
        const statsMap = {};
        studentIds.forEach(id => {
            statsMap[id] = { monthMissed: 0 };
        });

        attendances.forEach(a => {
            if (statsMap[a.studentId]) {
                statsMap[a.studentId].monthMissed++;
            }
        });

        res.json({ success: true, stats: statsMap });
    } catch (error) {
        console.error('Batch stats error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения статистики' });
    }
});

// GET /api/students/me/cabinet — личный кабинет ученика
router.get('/me/cabinet', authenticate, async (req, res) => {
    try {
        if (req.user.role !== 'student') {
            return res.status(403).json({ success: false, error: 'Доступ только для учеников' });
        }

        const studentId = req.user.id;

        const student = await prisma.student.findUnique({
            where: { id: studentId },
            include: {
                groups: {
                    where: { status: { in: ['active', 'Active'] }, group: { is: { isActive: true } } },
                    include: { group: { select: { id: true, name: true, instruments: true, schedules: true } } }
                },
                memberships: {
                    where: { status: 'active' },
                    orderBy: { createdAt: 'desc' },
                    include: { group: { select: { id: true, name: true } } }
                }
            }
        });

        if (!student) {
            return res.status(404).json({ success: false, error: 'Профиль не найден' });
        }

        const groupIds = student.groups.map(sg => sg.groupId).filter(Boolean);

        const schoolLessons = await prisma.class.findMany({
            where: {
                isPractice: false,
                status: { not: 'cancelled' },
                OR: [
                    { individualStudentId: studentId },
                    ...(groupIds.length ? [{ groupId: { in: groupIds } }] : [])
                ]
            },
            include: {
                teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                room: { select: { id: true, name: true } },
                group: { select: { id: true, name: true } },
                attendees: { where: { studentId } }
            },
            orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
            take: 40
        });

        const now = new Date();
        const lessons = schoolLessons.map(cls => {
            const attendee = cls.attendees[0];
            const lessonDate = new Date(cls.date);
            const isPast = lessonDate < now ||
                (lessonDate.toDateString() === now.toDateString() && cls.endTime <= `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`);

            return {
                id: cls.id,
                title: cls.title,
                date: cls.date,
                startTime: cls.startTime,
                endTime: cls.endTime,
                status: cls.status,
                classType: cls.classType,
                groupName: cls.group?.name || null,
                teacherName: formatStudentRouteFio(cls.teacher) || null,
                roomName: cls.room?.name || null,
                topic: cls.status === 'completed' ? cls.topic : null,
                homework: cls.status === 'completed' ? cls.homeworkDraft : null,
                attended: attendee?.attended ?? null,
                isPast
            };
        });

        const upcoming = lessons.filter(l => !l.isPast && l.status === 'scheduled').slice(0, 10);
        const history = lessons.filter(l => l.isPast || l.status !== 'scheduled').slice(0, 20);

        let debtAmount = Math.max(0, -(student.accountBalance || 0));

        res.json({
            success: true,
            profile: {
                id: student.id,
                name: student.name,
                lastName: student.lastName,
                middleName: student.middleName,
                dateOfBirth: student.dateOfBirth,
                phone: student.phone,
                groups: student.groups.map(sg => ({
                    id: sg.group?.id,
                    name: sg.group?.name,
                    instruments: sg.group?.instruments || [],
                    schedules: sg.group?.schedules || []
                })),
                memberships: student.memberships.map(m => {
                    const lessonPrice = getMembershipLessonPrice(m);
                    const estimate = estimateLessonsFromBalance(student.accountBalance, m);
                    return {
                        id: m.id,
                        type: m.type,
                        groupName: m.group?.name || 'Общий',
                        classesRemaining: m.classesRemaining,
                        estimatedLessonsRemaining: estimate.estimatedLessonsRemaining,
                        lessonPrice,
                        totalClasses: m.totalClasses,
                        totalPrice: m.totalPrice,
                        endDate: m.endDate,
                        remainingAmount: student.accountBalance,
                        paymentStatus: m.paymentStatus
                    };
                }),
                accountBalance: student.accountBalance,
                debtAmount,
                upcomingLessons: upcoming,
                lessonHistory: history
            }
        });
    } catch (error) {
        console.error('Student cabinet error:', error);
        res.status(500).json({ success: false, error: 'Ошибка загрузки кабинета' });
    }
});

// GET /api/students/:id/link-status — статус связи CRM ↔ Learning Platform
router.get('/:id/link-status', authenticate, requireTeacherOrAdmin, async (req, res) => {
    try {
        const student = await prisma.student.findUnique({ where: { id: req.params.id } });
        if (!student) return res.status(404).json({ success: false, error: 'Ученик не найден' });
        const result = await getLinkStatus(student.phone);
        if (!result.success) return res.status(400).json(result);
        return res.json(result);
    } catch (error) {
        console.error('Student link-status error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка проверки связи' });
    }
});

// POST /api/students/:id/link — связать ученика с аккаунтом в платформе
router.post('/:id/link', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const student = await prisma.student.findUnique({ where: { id: req.params.id } });
        if (!student) return res.status(404).json({ success: false, error: 'Ученик не найден' });

        const result = await linkUsers({
            phone: student.phone,
            crmStudentId: student.id,
            appUserId: req.body?.appUserId,
            initiatedBy: 'crm',
        });
        if (!result.success) {
            const status = result.status === 'conflict' ? 409 : 400;
            return res.status(status).json(result);
        }
        if (result.data?.alreadyLinked) {
            return res.status(409).json({
                success: false,
                error: 'Аккаунт уже подключён. Обновите карточку и используйте изменение пароля',
            });
        }
        return res.json(result);
    } catch (error) {
        console.error('Student link error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка связывания' });
    }
});

// POST /api/students/:id/provision-platform — создать/привязать аккаунт ученика в Learning Platform
router.post('/:id/provision-platform', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const password = String(req.body?.password || '');
        if (password.length < 8 || password.length > 128) {
            return res.status(400).json({
                success: false,
                error: 'Пароль должен содержать от 8 до 128 символов',
            });
        }
        const result = await provisionCrmStudent(req.params.id, {
            password,
            force: Boolean(req.body?.force),
        });
        if (!result.success) {
            const status = result.status === 'conflict' ? 409 : 400;
            return res.status(status).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('Provision student platform error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка создания аккаунта в платформе' });
    }
});

// POST /api/students/:id/platform-password — изменить пароль CRM и Learning Platform
router.post('/:id/platform-password', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const password = String(req.body?.password || '');
        if (password.length < 8 || password.length > 128) {
            return res.status(400).json({
                success: false,
                error: 'Пароль должен содержать от 8 до 128 символов',
            });
        }

        const student = await prisma.student.findUnique({
            where: { id: req.params.id },
            select: {
                id: true,
                role: true,
                phone: true,
                appUserId: true,
                externalLinkStatus: true,
            },
        });
        if (!student || student.role !== 'student') {
            return res.status(404).json({ success: false, error: 'Ученик не найден' });
        }
        if (!student.appUserId || student.externalLinkStatus !== 'linked') {
            return res.status(409).json({
                success: false,
                error: 'Сначала создайте или свяжите аккаунт ученика с платформой',
            });
        }

        const syncResult = await syncPasswordToLearningPlatform(student.id, student.role, password);
        if (!syncResult.success) {
            return res.status(502).json({
                success: false,
                error: 'Платформа не приняла новый пароль. Пароль в CRM не изменён',
            });
        }

        await prisma.student.update({
            where: { id: student.id },
            data: { password: await bcrypt.hash(password, 10) },
        });

        const phoneDigits = String(student.phone || '').replace(/\D/g, '');
        return res.json({
            success: true,
            data: {
                login: phoneDigits ? `s_${phoneDigits}` : student.phone,
                crmStudentId: student.id,
            },
        });
    } catch (error) {
        console.error('Update student platform password error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка изменения пароля' });
    }
});

// POST /api/students/provision-all — массово создать аккаунты для учеников без связи
router.post('/provision-all', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const students = await prisma.student.findMany({
            where: {
                role: 'student',
                status: 'active',
                OR: [
                    { appUserId: null },
                    { externalLinkStatus: { not: 'linked' } },
                ],
            },
            select: { id: true, name: true, lastName: true, middleName: true },
        });

        const results = [];
        for (const student of students) {
            const result = await provisionCrmStudent(student.id);
            results.push({
                crmStudentId: student.id,
                name: formatStudentRouteFio(student),
                success: result.success,
                error: result.error,
                data: result.data,
            });
        }

        const linked = results.filter((item) => item.success).length;
        return res.json({
            success: true,
            data: {
                total: students.length,
                linked,
                failed: students.length - linked,
                results,
            },
        });
    } catch (error) {
        console.error('Provision all students error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка массового создания аккаунтов' });
    }
});

// POST /api/students/:id/sso-token — bridge-login в Learning Platform
router.post('/:id/sso-token', authenticate, requireTeacherOrAdmin, async (req, res) => {
    try {
        const result = await createSsoToken(req.params.id);
        if (!result.success) return res.status(400).json(result);
        return res.json(result);
    } catch (error) {
        console.error('Student SSO token error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка SSO' });
    }
});

// GET /api/students/:id/schedule — групповое и индивидуальное регулярное расписание
router.get('/:id/schedule', authenticate, requireTeacherOrAdmin, async (req, res) => {
    try {
        const result = await getStudentRegularSchedule(req.params.id);
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('Student schedule get error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка загрузки расписания' });
    }
});

// PUT /api/students/:id/schedule — сохранить регулярное расписание из профиля ученика
router.put('/:id/schedule', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { schedules, ignoreConflicts, scope } = req.body || {};
        const result = await updateStudentRegularSchedule(req.params.id, schedules, ignoreConflicts, scope);
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('Student schedule update error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка сохранения расписания' });
    }
});

// POST /api/students/:id/pause — поставить ученика на паузу
router.post('/:id/pause', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const studentId = req.params.id;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const result = await prisma.$transaction(async (tx) => {
            const student = await tx.student.findUnique({
                where: { id: studentId },
                select: { id: true, name: true, lastName: true, middleName: true, status: true, notes: true }
            });
            if (!student) {
                const error = new Error('Ученик не найден');
                error.statusCode = 404;
                throw error;
            }

            const activeGroups = await tx.studentGroup.findMany({
                where: { studentId, status: 'active' },
                select: { groupId: true }
            });
            const activeGroupIds = [...new Set(activeGroups.map(item => item.groupId).filter(Boolean))];

            const groupUpdate = await tx.studentGroup.updateMany({
                where: { studentId, status: 'active' },
                data: { status: 'frozen' }
            });

            for (const groupId of activeGroupIds) {
                const count = await tx.studentGroup.count({ where: { groupId, status: 'active' } });
                await tx.group.update({ where: { id: groupId }, data: { currentStudents: count } });
            }

            const scheduleDelete = await tx.studentSchedule.deleteMany({ where: { studentId } });
            const classDelete = await tx.class.deleteMany({
                where: {
                    individualStudentId: studentId,
                    status: { in: ['scheduled', 'not_filled'] },
                    date: { gte: today }
                }
            });

            const updated = await tx.student.update({
                where: { id: studentId },
                data: {
                    status: 'inactive',
                    notes: student.status === 'inactive'
                        ? undefined
                        : [
                            student.notes,
                            `Поставлен(а) на паузу ${new Date().toLocaleDateString('ru-RU')}: снят(а) с активных групп и индивидуального расписания.`
                        ].filter(Boolean).join('\n')
                },
                select: { id: true, name: true, lastName: true, middleName: true, status: true }
            });

            return {
                student: updated,
                pausedGroups: groupUpdate.count,
                removedIndividualSchedules: scheduleDelete.count,
                removedFutureIndividualClasses: classDelete.count
            };
        });

        return res.json({
            success: true,
            message: 'Ученик поставлен на паузу',
            ...result,
        });
    } catch (error) {
        console.error('Pause student error:', error);
        return res.status(error.statusCode || 500).json({
            success: false,
            error: error.statusCode ? error.message : 'Ошибка постановки ученика на паузу'
        });
    }
});

// POST /api/students/:id/resume — вернуть ученика в активные
router.post('/:id/resume', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const student = await prisma.student.update({
            where: { id: req.params.id },
            data: { status: 'active' },
            select: { id: true, name: true, lastName: true, middleName: true, status: true }
        });
        return res.json({
            success: true,
            message: 'Ученик снова активен. Группу и расписание нужно назначить вручную.',
            student,
        });
    } catch (error) {
        console.error('Resume student error:', error);
        if (error.code === 'P2025') {
            return res.status(404).json({ success: false, error: 'Ученик не найден' });
        }
        return res.status(500).json({ success: false, error: 'Ошибка возврата ученика в активные' });
    }
});

// GET /api/students/:id/stats
router.get('/:id/stats', authenticate, async (req, res) => {
    try {
        if (req.user.role === 'student' && req.user.id !== req.params.id) {
            return res.status(403).json({ success: false, error: 'Доступ запрещён' });
        }

        const studentId = req.params.id;
        
        const attendances = await prisma.classAttendee.findMany({
            where: { studentId },
            include: { class: true },
            orderBy: { class: { date: 'desc' } },
            take: 20
        });

        const totalClasses = attendances.length;
        const attendedCount = attendances.filter(a => a.attended).length;
        const missedCount = totalClasses - attendedCount;
        const attendanceRate = totalClasses > 0 ? Math.round((attendedCount / totalClasses) * 100) : 0;

        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        
        const monthMissed = attendances.filter(a => 
            !a.attended && a.class && new Date(a.class.date) >= startOfMonth
        ).length;

        const lastAttended = attendances.find(a => a.attended);

        res.json({
            success: true,
            stats: {
                attendanceRate,
                totalClasses,
                attendedCount,
                missedCount,
                monthMissed,
                lastAttendedDate: lastAttended && lastAttended.class ? lastAttended.class.date : null,
                recentHistory: attendances.map(a => ({
                    classId: a.class ? a.class.id : null,
                    date: a.class ? a.class.date : new Date(),
                    attended: a.attended,
                    attendanceStatus: a.attendanceStatus,
                    chargeAmount: a.chargeAmount,
                    chargeSource: a.chargeSource,
                    title: a.class ? a.class.title : 'Занятие'
                }))
            }
        });
    } catch (error) {
        console.error('Get student stats error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения статистики' });
    }
});

// POST /api/students/:id/balance-adjustment
// Техническая корректировка свободного баланса ученика.
// Не создает платеж и не попадает в кассу/аналитику доходов.
router.post('/:id/balance-adjustment', authenticate, requireAdmin, async (req, res) => {
    try {
        const adjustmentAmount = parseSignedBalanceAmount(req.body?.amount);
        const reason = String(req.body?.reason || '').trim();

        if (!adjustmentAmount) {
            return res.status(400).json({ success: false, error: 'Укажите сумму корректировки, отличную от нуля' });
        }
        if (!reason) {
            return res.status(400).json({ success: false, error: 'Укажите причину корректировки' });
        }

        const result = await prisma.$transaction(async tx => {
            const lockedStudents = await tx.$queryRaw`
                SELECT id, name, "lastName", "middleName", "accountBalance"
                FROM "Student"
                WHERE id = ${req.params.id}
                FOR UPDATE
            `;
            const student = lockedStudents[0];
            if (!student) {
                const error = new Error('Ученик не найден');
                error.code = 'STUDENT_NOT_FOUND';
                throw error;
            }

            const balanceBefore = Number(student.accountBalance || 0);
            const balanceAfter = balanceBefore + adjustmentAmount;
            await tx.student.update({
                where: { id: student.id },
                data: { accountBalance: balanceAfter },
            });

            await tx.activityLog.create({
                data: {
                    userId: req.user.id,
                    action: 'balance_adjustment',
                    entityType: 'Student',
                    entityId: student.id,
                    details: `Корректировка баланса: ${formatStudentRouteFio(student)} — ${formatSignedMoney(adjustmentAmount)}. Было ${balanceBefore} ₸, стало ${balanceAfter} ₸. Причина: ${reason}`,
                    metadata: {
                        studentId: student.id,
                        amount: adjustmentAmount,
                        balanceBefore,
                        balanceAfter,
                        reason,
                    },
                },
            });

            return { student, balanceBefore, balanceAfter };
        });

        res.json({
            success: true,
            studentId: result.student.id,
            adjustment: adjustmentAmount,
            balanceBefore: result.balanceBefore,
            balanceAfter: result.balanceAfter,
            message: `Баланс скорректирован: ${formatSignedMoney(adjustmentAmount)}. Новый баланс ${result.balanceAfter} ₸`,
        });
    } catch (error) {
        console.error('Balance adjustment error:', error);
        if (error.code === 'STUDENT_NOT_FOUND') {
            return res.status(404).json({ success: false, error: error.message });
        }
        res.status(500).json({ success: false, error: 'Не удалось скорректировать баланс' });
    }
});

// GET /api/students/:id
router.get('/:id', authenticate, async (req, res) => {
    try {
        if (req.user.role === 'student' && req.user.id !== req.params.id) {
            return res.status(403).json({ success: false, error: 'Доступ запрещён' });
        }

        const canViewFinancials = ['admin', 'super_admin'].includes(req.user.role);
        const student = await prisma.student.findUnique({
            where: { id: req.params.id },
            include: {
                groups: {
                    where: { status: 'active', group: { is: { isActive: true } } },
                    include: { group: { select: { id: true, name: true, direction: true, instruments: true, schedules: true } } }
                },
                additionalPhones: { orderBy: { createdAt: 'asc' } },
                ...(canViewFinancials ? {
                    activeMembership: true,
                    memberships: {
                        orderBy: { createdAt: 'desc' },
                        take: 10
                    },
                    payments: { orderBy: { createdAt: 'desc' }, take: 20 },
                    family: {
                    include: {
                        students: {
                            select: { id: true, name: true, lastName: true, middleName: true, dateOfBirth: true, phone: true }
                        }
                    }
                    },
                    referredBy: { select: { id: true, name: true, lastName: true, middleName: true, dateOfBirth: true, phone: true } },
                    referrals: { select: { id: true, name: true, lastName: true, middleName: true, dateOfBirth: true, phone: true } },
                } : {}),
                assignedTeacher: { select: { id: true, name: true, lastName: true, middleName: true, teacherDirections: true } }
            }
        });
        if (!student) return res.status(404).json({ success: false, error: 'Ученик не найден' });

        // Маппим группы в Mongoose-совместимый формат
        // Берём лучший активный абонемент (та же логика, что в списке и на фронтенде)
        const activeMemberships = canViewFinancials ? (student.memberships || []).filter(m => m.status === 'active') : [];
        let bestMembership = activeMemberships.find(m =>
            m.type === 'monthly' || m.type === 'monthly_12' || m.type === 'quarterly' || m.type === 'individual_package'
        );
        if (!bestMembership) bestMembership = activeMemberships[0] || null;

        // Отрицательный независимый баланс считается долгом. Даты обещанной
        // оплаты по абонементу остаются отдельной справочной информацией.
        let debtAmount = Math.max(0, -(student.accountBalance || 0));
        const isOverdue = false;
        const overdueDays = 0;
        const promisedPaymentDate = null;

        // Дата последнего посещённого занятия (справочно)
        const lastAttendedRec = await prisma.classAttendee.findFirst({
            where: { studentId: student.id, attended: true },
            orderBy: { class: { date: 'desc' } },
            select: { class: { select: { date: true } } }
        });
        const lastAttendedDate = lastAttendedRec?.class?.date || null;

        // Дата последнего платежа — основа вычисления "потерян".
        const lastPaymentRec = await prisma.payment.findFirst({
            where: { studentId: student.id },
            orderBy: { paymentDate: 'desc' },
            select: { paymentDate: true },
        });
        const lastPaymentDate = lastPaymentRec?.paymentDate || null;

        const lostThreshold = getLostThresholdDate();
        const activityRef = lastPaymentDate ? new Date(lastPaymentDate) : new Date(student.createdAt);
        const isLost = activityRef < lostThreshold;

        const mappedStudent = {
            ...student,
            _id: student.id,
            password: undefined,
            groups: student.groups.map(sg => ({
                ...sg,
                groupId: sg.group ? { ...sg.group, _id: sg.group.id } : null,
                group: sg.group ? { ...sg.group, _id: sg.group.id } : null
            })),
            activeMembership: bestMembership
                ? { ...bestMembership, _id: bestMembership.id }
                : null,
            debtAmount,
            isOverdue,
            overdueDays,
            promisedPaymentDate,
            lastAttendedDate,
            lastPaymentDate,
            isLost
        };

        res.json({ success: true, student: mappedStudent });
    } catch (error) {
        console.error('Get student error:', error);
        res.status(500).json({ success: false, error: 'Ошибка' });
    }
});

// POST /api/students
router.post('/', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { name, lastName, middleName, dateOfBirth, phone, gender, email, notes, groupId, password } = req.body;
        if (!name || !lastName || !phone) return res.status(400).json({ success: false, error: 'Имя, фамилия и телефон обязательны' });
        const parsedDateOfBirth = parseOptionalDate(dateOfBirth);
        if (dateOfBirth && parsedDateOfBirth === undefined) {
            return res.status(400).json({ success: false, error: 'Некорректная дата рождения' });
        }

        await ensureStudentContactPhoneAvailable(prisma, phone);

        const pwd = password || Math.random().toString(36).slice(-8);
        const hashedPassword = await bcrypt.hash(pwd, 10);

        const student = await prisma.$transaction(async tx => {
            const created = await tx.student.create({
                data: { name, lastName, middleName: middleName || null, dateOfBirth: parsedDateOfBirth || null, phone, phoneDigits: phone.replace(/\D/g, ''), gender: gender || null, email: email || null, notes, password: hashedPassword, role: 'student' }
            });
            if (groupId) {
                await tx.studentGroup.create({ data: { studentId: created.id, groupId, status: 'active' } });
                await tx.group.update({ where: { id: groupId }, data: { currentStudents: { increment: 1 } } });
            }
            await linkOpenBookingsForStudent(tx, created, req.user.id);
            return created;
        });

        let platform = null;
        try {
            const provision = await provisionCrmStudent(student.id, { password: pwd });
            if (provision.success) {
                platform = provision.data;
            } else {
                console.warn(`[students] LP provision failed for ${student.id}:`, provision.error);
            }
        } catch (provisionError) {
            console.error('[students] LP provision error:', provisionError);
        }

        res.status(201).json({
            success: true,
            student: { ...student, _id: student.id, password: undefined },
            generatedPassword: password ? undefined : pwd,
            platform,
        });
    } catch (error) {
        console.error('Create student error:', error);
        if (error.code === 'STAFF_PHONE_CONFLICT') {
            return res.status(error.statusCode || 400).json({ success: false, error: error.message });
        }
        res.status(500).json({ success: false, error: 'Ошибка создания ученика' });
    }
});

// PUT /api/students/:id
router.put('/:id', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const {
            name, lastName, middleName, dateOfBirth, phone, gender, email, notes, status,
            familyId, referredByStudentId, concessionType, additionalPhones,
            customerName, customerType, acquisitionSource, learningDirections, learningLevel,
            assignedTeacherId, notifyHomework, notifyLessons, notifyPayments
        } = req.body;
        const data = {};
        if (name !== undefined) data.name = name;
        if (lastName !== undefined) data.lastName = lastName;
        if (middleName !== undefined) data.middleName = middleName || null;
        const parsedDateOfBirth = parseOptionalDate(dateOfBirth);
        if (dateOfBirth !== undefined) {
            if (parsedDateOfBirth === undefined) {
                return res.status(400).json({ success: false, error: 'Некорректная дата рождения' });
            }
            data.dateOfBirth = parsedDateOfBirth;
        }
        if (phone !== undefined) {
            await ensureStudentContactPhoneAvailable(prisma, phone, req.params.id);
            data.phone = phone;
            data.phoneDigits = phone.replace(/\D/g, '');
        }
        if (notifyHomework !== undefined) data.notifyHomework = normalizeNotificationFlag(notifyHomework);
        if (notifyLessons !== undefined) data.notifyLessons = normalizeNotificationFlag(notifyLessons);
        if (notifyPayments !== undefined) data.notifyPayments = normalizeNotificationFlag(notifyPayments);
        if (gender !== undefined) data.gender = gender || null;
        if (email !== undefined) data.email = email || null;
        if (notes !== undefined) data.notes = notes;
        if (customerName !== undefined) data.customerName = customerName || null;
        if (customerType !== undefined) data.customerType = customerType || null;
        if (acquisitionSource !== undefined) data.acquisitionSource = acquisitionSource || null;
        if (learningDirections !== undefined) {
            data.learningDirections = Array.isArray(learningDirections)
                ? learningDirections.map(value => String(value).trim()).filter(Boolean)
                : [];
        }
        if (learningLevel !== undefined) data.learningLevel = learningLevel || null;
        let assignedTeacherChanged = false;
        let previousAssignedTeacherId = null;
        if (assignedTeacherId !== undefined) {
            const normalizedAssignedTeacherId = assignedTeacherId || null;
            if (assignedTeacherId) {
                const teacher = await prisma.student.findFirst({
                    where: { id: assignedTeacherId, role: 'teacher', status: { not: 'inactive' } },
                    select: { id: true }
                });
                if (!teacher) {
                    return res.status(400).json({ success: false, error: 'Выбранный педагог не найден или неактивен' });
                }
            }
            const currentStudent = await prisma.student.findUnique({
                where: { id: req.params.id },
                select: { assignedTeacherId: true }
            });
            if (currentStudent && currentStudent.assignedTeacherId !== normalizedAssignedTeacherId) {
                assignedTeacherChanged = true;
                previousAssignedTeacherId = currentStudent.assignedTeacherId || null;
            }
            data.assignedTeacherId = normalizedAssignedTeacherId;
        }
        if (status !== undefined) data.status = status;
        if (familyId !== undefined) data.familyId = familyId || null;
        if (referredByStudentId !== undefined) {
            if (referredByStudentId && referredByStudentId.startsWith('booking_')) {
                data.referredByBookingId = referredByStudentId.replace('booking_', '');
                data.referredByStudentId = null;
            } else {
                data.referredByStudentId = (referredByStudentId && referredByStudentId !== req.params.id) ? referredByStudentId : null;
                data.referredByBookingId = null;
            }
        }
        if (concessionType !== undefined) data.concessionType = concessionType || null;
        if (additionalPhones !== undefined) {
            const existingStudent = await prisma.student.findUnique({
                where: { id: req.params.id },
                select: {
                    phone: true,
                    notifyHomework: true,
                    notifyLessons: true,
                    notifyPayments: true,
                }
            });
            const primaryPhone = phone === undefined ? existingStudent?.phone : phone;
            const normalizedAdditionalPhones = normalizeAdditionalPhones(additionalPhones, primaryPhone);
            assertUniqueNotificationRoutes({
                notifyHomework: data.notifyHomework ?? existingStudent?.notifyHomework,
                notifyLessons: data.notifyLessons ?? existingStudent?.notifyLessons,
                notifyPayments: data.notifyPayments ?? existingStudent?.notifyPayments,
            }, normalizedAdditionalPhones);
            data.additionalPhones = {
                deleteMany: {},
                create: normalizedAdditionalPhones
            };
        } else if ([notifyHomework, notifyLessons, notifyPayments].some(value => value !== undefined)) {
            const existingStudent = await prisma.student.findUnique({
                where: { id: req.params.id },
                select: {
                    additionalPhones: {
                        select: { notifyHomework: true, notifyLessons: true, notifyPayments: true },
                    },
                },
            });
            assertUniqueNotificationRoutes(data, existingStudent?.additionalPhones || []);
        }

        const student = await prisma.student.update({
            where: { id: req.params.id },
            data,
            include: { additionalPhones: { orderBy: { createdAt: 'asc' } } }
        });
        await linkOpenBookingsForStudent(prisma, student, req.user.id);

        if (assignedTeacherChanged) {
            const newTeacherId = assignedTeacherId || null;
            if (previousAssignedTeacherId) {
                await prisma.studentSchedule.updateMany({
                    where: { studentId: student.id, teacherId: previousAssignedTeacherId },
                    data: { teacherId: null }
                });
            }
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const teacherRewriteWhere = previousAssignedTeacherId
                ? { teacherId: previousAssignedTeacherId }
                : { teacherId: null };
            await prisma.class.updateMany({
                where: {
                    individualStudentId: student.id,
                    ...teacherRewriteWhere,
                    status: 'scheduled',
                    date: { gte: today },
                    notes: { in: ['Автоматически из регулярного расписания', 'Сгенерировано', 'Сгенерировано из абонемента'] }
                },
                data: { teacherId: newTeacherId }
            });
        }

        res.json({ success: true, student: { ...student, _id: student.id, password: undefined } });
    } catch (error) {
        console.error('Update student error:', error);
        if (error.code === 'STAFF_PHONE_CONFLICT') {
            return res.status(error.statusCode || 400).json({ success: false, error: error.message });
        }
        if (error.code === 'DUPLICATE_NOTIFICATION_ROUTE') {
            return res.status(error.statusCode || 400).json({ success: false, error: error.message });
        }
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, error: 'Такой номер телефона уже добавлен' });
        }
        res.status(500).json({ success: false, error: 'Ошибка обновления' });
    }
});

// POST /api/students/:id/finish-education
router.post('/:id/finish-education', authenticate, requireAdmin, async (req, res) => {
    try {
        const result = await finishStudentEducation(prisma, req.params.id, req.user.id, req.body);
        res.json({
            success: true,
            departure: result,
            message: `Обучение завершено: ${result.reasonLabel}. История уроков и платежей сохранена.`,
        });
    } catch (error) {
        console.error('Finish student education error:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Не удалось завершить обучение' });
    }
});

router.post('/:id/restore', authenticate, requireAdmin, async (req, res) => {
    try {
        const student = await restoreFormerStudent(prisma, req.params.id, req.user.id);
        res.json({ success: true, student, message: 'Ученик восстановлен. Расписание и абонемент нужно назначить заново.' });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Не удалось восстановить ученика' });
    }
});

router.delete('/:id/permanent', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const student = await permanentlyDeleteStudent(prisma, req.params.id);
        res.json({ success: true, message: `Ученик ${formatStudentRouteFio(student)} полностью удалён из базы` });
    } catch (error) {
        console.error('Permanent student deletion error:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Не удалось полностью удалить ученика' });
    }
});

// Backward-compatible DELETE archives the student instead of destroying history.
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const result = await finishStudentEducation(prisma, req.params.id, req.user.id, {
            reason: req.body?.reason || 'other',
            note: req.body?.note || 'Завершено через старое действие удаления',
        });
        res.json({ success: true, message: `Ученик переведён в бывшие. Причина: ${result.reasonLabel}.` });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Не удалось завершить обучение' });
    }
});

// POST /api/students/:id/add-to-group
router.post('/:id/add-to-group', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { groupId } = req.body;
        if (!groupId) return res.status(400).json({ success: false, error: 'groupId обязателен' });

        const existing = await prisma.studentGroup.findUnique({ where: { studentId_groupId: { studentId: req.params.id, groupId } } });
        if (existing) return res.status(400).json({ success: false, error: 'Ученик уже в этой группе' });

        await prisma.studentGroup.create({ data: { studentId: req.params.id, groupId, status: 'active' } });
        await prisma.group.update({ where: { id: groupId }, data: { currentStudents: { increment: 1 } } });

        res.json({ success: true, message: 'Ученик добавлен в группу' });
    } catch (error) {
        console.error('Add to group error:', error);
        res.status(500).json({ success: false, error: 'Ошибка' });
    }
});

module.exports = router;
