const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { Prisma } = require('@prisma/client');
const { authenticate, requireSalesOrAdmin, requireTeacherOrAdmin } = require('../middleware/auth');
const { getLinkStatus, linkUsers, createSsoToken, provisionCrmStudent } = require('../services/userLink');
const { getStudentRegularSchedule, updateStudentRegularSchedule } = require('../services/studentSchedule');
const bcrypt = require('bcryptjs');
const { LOST_STUDENT_MONTHS, getLostThresholdDate } = require('../utils/students');

function normalizeAdditionalPhones(additionalPhones, primaryPhone) {
    if (!Array.isArray(additionalPhones)) return null;

    const primaryDigits = String(primaryPhone || '').replace(/\D/g, '');
    const seen = new Set();

    return additionalPhones
        .map(item => ({
            phone: String(item?.phone || '').trim(),
            phoneDigits: String(item?.phone || '').replace(/\D/g, ''),
            label: String(item?.label || '').trim() || null
        }))
        .filter(item => item.phone && item.phoneDigits.length >= 5)
        .filter(item => {
            if (item.phoneDigits === primaryDigits || seen.has(item.phoneDigits)) return false;
            seen.add(item.phoneDigits);
            return true;
        });
}

// GET /api/students
router.get('/', authenticate, requireTeacherOrAdmin, async (req, res) => {
    try {
        const { search, page = 1, limit = 20, status, filter: rawFilter, role: roleQuery } = req.query;
        const filter = rawFilter === 'with-debt' ? 'with_debt' : rawFilter;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        // Роль берём из query, по умолчанию — student (обратная совместимость).
        // Поддерживаем только student/teacher, чтобы исключить выдачу админов.
        const allowedRoles = ['student', 'teacher'];
        const role = allowedRoles.includes(roleQuery) ? roleQuery : 'student';

        const where = { role };
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

        // Фильтр «С долгом»: активный абонемент с remainingAmount > 0.
        if (filter === 'with_debt') {
            const debtRows = await prisma.$queryRaw`
                SELECT DISTINCT s.id
                FROM "Student" s
                JOIN "Membership" m ON m."studentId" = s.id
                WHERE s.role = 'student'
                AND m.status = 'active'
                AND m."remainingAmount" > 0
            `;
            const debtIds = debtRows.map(r => r.id);
            if (debtIds.length === 0) {
                return res.json({ success: true, count: 0, total: 0, page: pageNum, pages: 0, students: [] });
            }
            where.id = { in: debtIds };
        }

        // Фильтр «Просрочено»: долг + dueDate в прошлом.
        if (filter === 'overdue') {
            const overdueRows = await prisma.$queryRaw`
                SELECT DISTINCT s.id
                FROM "Student" s
                JOIN "Membership" m ON m."studentId" = s.id
                JOIN "Payment" p ON p."membershipId" = m.id
                WHERE s.role = 'student'
                AND m.status = 'active'
                AND m."remainingAmount" > 0
                AND p."dueDate" IS NOT NULL
                AND p."dueDate" < CURRENT_DATE
            `;
            const overdueIds = overdueRows.map(r => r.id);
            if (overdueIds.length === 0) {
                return res.json({ success: true, count: 0, total: 0, page: pageNum, pages: 0, students: [] });
            }
            where.id = { in: overdueIds };
        }

        const [students, total] = await Promise.all([
            prisma.student.findMany({
                where,
                select: {
                    id: true, name: true, lastName: true, phone: true, email: true, gender: true,
                    dateOfBirth: true, status: true, notes: true, registeredAt: true, createdAt: true,
                    customerName: true, customerType: true, acquisitionSource: true,
                    learningDirections: true, learningLevel: true,
                    additionalPhones: { orderBy: { createdAt: 'asc' } },
                    assignedTeacher: { select: { id: true, name: true, lastName: true } },
                    activeMembershipId: true,
                    appUserId: true, externalLinkStatus: true, linkedAt: true,
                    groups: { include: { group: { select: { id: true, name: true, direction: true, schedules: true } } } },
                    memberships: { 
                        where: { status: 'active' },
                        orderBy: { createdAt: 'desc' },
                        select: {
                            id: true, type: true, classesRemaining: true, totalClasses: true,
                            startDate: true, endDate: true, status: true, groupId: true,
                            remainingAmount: true, paymentStatus: true, paidAmount: true, totalPrice: true,
                            payments: {
                                where: { dueDate: { not: null } },
                                orderBy: { dueDate: 'asc' },
                                take: 1,
                                select: { dueDate: true }
                            }
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
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

            let debtAmount = 0;
            let isOverdue = false;
            let overdueDays = 0;
            let promisedPaymentDate = null;

            if (bestMembership && bestMembership.remainingAmount > 0) {
                debtAmount = bestMembership.remainingAmount;

                // Обещанная дата оплаты = ближайший dueDate по платежам абонемента.
                // Попадают все сценарии: full, advance (split), later (оплата позже).
                const dueDatePayment = bestMembership.payments?.[0];

                if (dueDatePayment?.dueDate) {
                    promisedPaymentDate = dueDatePayment.dueDate;
                    const dueDate = new Date(dueDatePayment.dueDate);

                    // Устанавливаем начало дня для корректного сравнения
                    const dueDateStart = new Date(dueDate);
                    dueDateStart.setHours(0,0,0,0);
                    const nowStart = new Date(now);
                    nowStart.setHours(0,0,0,0);

                    if (nowStart > dueDateStart) {
                        isOverdue = true;
                        const diffTime = Math.abs(nowStart - dueDateStart);
                        overdueDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 0;
                    }
                }
            }

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
            }
            if (digits.length >= 3) bookingOrConditions.push({ phoneDigits: { contains: digits } });

            const matchingBookings = await prisma.booking.findMany({
                where: {
                    OR: bookingOrConditions,
                    status: { in: ['new', 'processed', 'trial'] }
                },
                take: 5
            });

            const mappedBookings = matchingBookings.map(b => ({
                id: `booking_${b.id}`,
                _id: `booking_${b.id}`,
                name: b.name,
                lastName: b.lastName,
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
                    where: { status: { in: ['active', 'Active'] } },
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
                teacher: { select: { id: true, name: true, lastName: true } },
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
                teacherName: cls.teacher ? `${cls.teacher.name} ${cls.teacher.lastName || ''}`.trim() : null,
                roomName: cls.room?.name || null,
                topic: cls.status === 'completed' ? cls.topic : null,
                homework: cls.status === 'completed' ? cls.homeworkDraft : null,
                attended: attendee?.attended ?? null,
                isPast
            };
        });

        const upcoming = lessons.filter(l => !l.isPast && l.status === 'scheduled').slice(0, 10);
        const history = lessons.filter(l => l.isPast || l.status !== 'scheduled').slice(0, 20);

        let debtAmount = 0;
        student.memberships.forEach(m => {
            if (m.remainingAmount > 0) debtAmount += m.remainingAmount;
        });

        res.json({
            success: true,
            profile: {
                id: student.id,
                name: student.name,
                lastName: student.lastName,
                phone: student.phone,
                groups: student.groups.map(sg => ({
                    id: sg.group?.id,
                    name: sg.group?.name,
                    instruments: sg.group?.instruments || [],
                    schedules: sg.group?.schedules || []
                })),
                memberships: student.memberships.map(m => ({
                    id: m.id,
                    type: m.type,
                    groupName: m.group?.name || 'Общий',
                    classesRemaining: m.classesRemaining,
                    totalClasses: m.totalClasses,
                    endDate: m.endDate,
                    remainingAmount: m.remainingAmount,
                    paymentStatus: m.paymentStatus
                })),
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
        return res.json(result);
    } catch (error) {
        console.error('Student link error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка связывания' });
    }
});

// POST /api/students/:id/provision-platform — создать/привязать аккаунт ученика в Learning Platform
router.post('/:id/provision-platform', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const result = await provisionCrmStudent(req.params.id, {
            password: req.body?.password,
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
            select: { id: true, name: true, lastName: true },
        });

        const results = [];
        for (const student of students) {
            const result = await provisionCrmStudent(student.id);
            results.push({
                crmStudentId: student.id,
                name: `${student.name} ${student.lastName || ''}`.trim(),
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

// GET /api/students/:id/schedule — регулярное расписание (группа или индивидуальное)
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
        const result = await updateStudentRegularSchedule(req.params.id, req.body?.schedules);
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('Student schedule update error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка сохранения расписания' });
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
                    date: a.class ? a.class.date : new Date(),
                    attended: a.attended,
                    title: a.class ? a.class.title : 'Занятие'
                }))
            }
        });
    } catch (error) {
        console.error('Get student stats error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения статистики' });
    }
});

// GET /api/students/:id
router.get('/:id', authenticate, async (req, res) => {
    try {
        if (req.user.role === 'student' && req.user.id !== req.params.id) {
            return res.status(403).json({ success: false, error: 'Доступ запрещён' });
        }

        const student = await prisma.student.findUnique({
            where: { id: req.params.id },
            include: {
                groups: { include: { group: { select: { id: true, name: true, direction: true, instruments: true, schedules: true } } } },
                additionalPhones: { orderBy: { createdAt: 'asc' } },
                activeMembership: true,
                memberships: { 
                    orderBy: { createdAt: 'desc' }, 
                    take: 10,
                    include: { payments: { where: { dueDate: { not: null } }, orderBy: { dueDate: 'asc' }, take: 1 } }
                },
                payments: { orderBy: { createdAt: 'desc' }, take: 20 },
                family: {
                    include: {
                        students: {
                            select: { id: true, name: true, lastName: true, phone: true }
                        }
                    }
                },
                referredBy: { select: { id: true, name: true, lastName: true, phone: true } },
                referrals: { select: { id: true, name: true, lastName: true, phone: true } },
                assignedTeacher: { select: { id: true, name: true, lastName: true, teacherDirections: true } }
            }
        });
        if (!student) return res.status(404).json({ success: false, error: 'Ученик не найден' });

        // Маппим группы в Mongoose-совместимый формат
        // Берём лучший активный абонемент (та же логика, что в списке и на фронтенде)
        const activeMemberships = student.memberships.filter(m => m.status === 'active');
        let bestMembership = activeMemberships.find(m =>
            m.type === 'monthly' || m.type === 'monthly_12' || m.type === 'quarterly' || m.type === 'individual_package'
        );
        if (!bestMembership) bestMembership = activeMemberships[0] || null;

        // Долг равен фактическому остатку абонемента (включая split-оплаты,
        // где есть аванс и обещанная дата доплаты). Ранее здесь remainingAmount
        // обнулялся, если dueDate в будущем, что приводило к тому, что фронт
        // не показывал ни сумму долга, ни обещанную дату для split-оплат.
        let debtAmount = 0;
        let isOverdue = false;
        let overdueDays = 0;
        let promisedPaymentDate = null;

        if (bestMembership && bestMembership.remainingAmount > 0) {
            debtAmount = bestMembership.remainingAmount;

            const latestPayment = bestMembership.payments?.[0];
            if (latestPayment?.dueDate) {
                promisedPaymentDate = latestPayment.dueDate;

                const dueDateStart = new Date(latestPayment.dueDate);
                dueDateStart.setHours(0, 0, 0, 0);
                const nowStart = new Date();
                nowStart.setHours(0, 0, 0, 0);

                if (nowStart > dueDateStart) {
                    isOverdue = true;
                    overdueDays = Math.ceil(Math.abs(nowStart - dueDateStart) / (1000 * 60 * 60 * 24)) || 0;
                }
            }
        }

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
        const { name, lastName, phone, gender, email, notes, groupId, password } = req.body;
        if (!name || !lastName || !phone) return res.status(400).json({ success: false, error: 'Имя, фамилия и телефон обязательны' });

        const existing = await prisma.student.findUnique({ where: { phone } });
        if (existing) return res.status(400).json({ success: false, error: 'Ученик с таким телефоном уже существует' });

        const pwd = password || Math.random().toString(36).slice(-8);
        const hashedPassword = await bcrypt.hash(pwd, 10);

        const student = await prisma.student.create({
            data: { name, lastName, phone, phoneDigits: phone.replace(/\D/g, ''), gender: gender || null, email: email || null, notes, password: hashedPassword, role: 'student' }
        });

        if (groupId) {
            await prisma.studentGroup.create({ data: { studentId: student.id, groupId, status: 'active' } });
            await prisma.group.update({ where: { id: groupId }, data: { currentStudents: { increment: 1 } } });
        }

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
        res.status(500).json({ success: false, error: 'Ошибка создания ученика' });
    }
});

// PUT /api/students/:id
router.put('/:id', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const {
            name, lastName, phone, gender, email, notes, status, dateOfBirth,
            familyId, referredByStudentId, concessionType, additionalPhones,
            customerName, customerType, acquisitionSource, learningDirections, learningLevel
        } = req.body;
        const data = {};
        if (name !== undefined) data.name = name;
        if (lastName !== undefined) data.lastName = lastName;
        if (phone !== undefined) { data.phone = phone; data.phoneDigits = phone.replace(/\D/g, ''); }
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
        if (status !== undefined) data.status = status;
        if (dateOfBirth !== undefined) data.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
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
            let primaryPhone = phone;
            if (primaryPhone === undefined) {
                const existingStudent = await prisma.student.findUnique({
                    where: { id: req.params.id },
                    select: { phone: true }
                });
                primaryPhone = existingStudent?.phone;
            }
            const normalizedAdditionalPhones = normalizeAdditionalPhones(additionalPhones, primaryPhone);
            data.additionalPhones = {
                deleteMany: {},
                create: normalizedAdditionalPhones
            };
        }

        const student = await prisma.student.update({
            where: { id: req.params.id },
            data,
            include: { additionalPhones: { orderBy: { createdAt: 'asc' } } }
        });
        res.json({ success: true, student: { ...student, _id: student.id, password: undefined } });
    } catch (error) {
        console.error('Update student error:', error);
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, error: 'Такой номер телефона уже добавлен' });
        }
        res.status(500).json({ success: false, error: 'Ошибка обновления' });
    }
});

// DELETE /api/students/:id
router.delete('/:id', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const studentId = req.params.id;
        
        // Fetch to get name
        const student = await prisma.student.findUnique({ where: { id: studentId } });
        if (!student) return res.status(404).json({ success: false, error: 'Ученик не найден' });

        // Удаляем историю посещаемости
        await prisma.classAttendee.deleteMany({ where: { studentId } });
        
        // Удаляем заморозки
        await prisma.freeze.deleteMany({ where: { studentId } });
        
        // Находим все абонементы ученика
        const memberships = await prisma.membership.findMany({ where: { studentId }, select: { id: true } });
        const membershipIds = memberships.map(m => m.id);
        
        // Удаляем историю изменений абонементов (удалено, так как модели нет в Prisma)
        if (membershipIds.length > 0) {
            // Отвязываем абонементы от платежей перед их удалением
            await prisma.payment.updateMany({ 
                where: { membershipId: { in: membershipIds } },
                data: { membershipId: null }
            });
        }
        
        // Снимаем активный абонемент у ученика (циклическая связь)
        await prisma.student.update({ where: { id: studentId }, data: { activeMembershipId: null } });
        
        // Удаляем сами абонементы
        await prisma.membership.deleteMany({ where: { studentId } });
        
        // Удаляем платежи этого ученика
        const payments = await prisma.payment.findMany({ where: { studentId }, select: { id: true } });
        const paymentIds = payments.map(p => p.id);
        
        if (paymentIds.length > 0) {
            // Удаляем связанные кассовые транзакции
            await prisma.cashTransaction.deleteMany({ where: { relatedPaymentId: { in: paymentIds } } });
            
            // Удаляем возможные связи между самими платежами, чтобы избежать конфликтов при удалении
            await prisma.payment.updateMany({ 
                where: { id: { in: paymentIds } }, 
                data: { relatedPaymentId: null } 
            });
            
            await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
        }
        
        // Обнуляем связи в заявках, которые были конвертированы в этого ученика
        await prisma.booking.updateMany({ 
            where: { convertedToStudentId: studentId }, 
            data: { convertedToStudentId: null } 
        });

        // Удаляем связи с группами
        await prisma.studentGroup.deleteMany({ where: { studentId } });
        
        // Наконец, удаляем самого ученика
        await prisma.student.delete({ where: { id: studentId } });
        res.json({ success: true, message: `Ученик "${student.name} ${student.lastName || ''}" удален` });
    } catch (error) {
        console.error('Delete student error:', error);
        res.status(500).json({ success: false, error: 'Ошибка удаления' });
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
