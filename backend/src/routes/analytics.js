// =====================================================
// Аналитика: обзор, преподаватели, менеджеры, админы.
// Доступ: admin и super_admin.
// =====================================================
const express = require('express');
const router = express.Router();
const { DEPARTURE_REASONS } = require('../services/studentDeparture');
const { prisma } = require('../config/db');
const { Prisma } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getLostThresholdDate, LOST_STUDENT_MONTHS } = require('../utils/students');
const {
    computeAvgCheck,
    computeLtv,
    computeAvgLtv,
    computeAvgLifespanMonths,
    computeTrialConversion,
    MS_PER_DAY,
} = require('../utils/metrics');
const { timeToMinutes } = require('../utils/timeOverlap');
const { ensureTeacherScheduleColors } = require('../services/scheduleAppearance');
const { normalizeBookingLossStage } = require('../utils/bookingLoss');
const { getTeacherRate } = require('../services/salaryPolicy');
const { sendEveningReport } = require('../services/notifications');
const { getDailyReportArchive } = require('../services/dailyReportArchive');
const { buildTrialAnalytics } = require('../services/trialAnalytics');

// ----- helpers -----

function formatAnalyticsFio(person, fallback = '—') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function parsePeriod(req) {
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const from = req.query.from ? new Date(req.query.from) : defaultFrom;
    const to   = req.query.to   ? new Date(req.query.to)   : now;
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        return { from: defaultFrom, to: now };
    }
    from.setHours(0, 0, 0, 0);
    // inclusive конец периода
    const toInc = new Date(to);
    toInc.setHours(23, 59, 59, 999);
    return { from, to: toInc };
}

function percent(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 100);
}

function groupByStudent(items, keyField = 'studentId') {
    const map = {};
    for (const it of items) {
        const k = it[keyField];
        if (!k) continue;
        if (!map[k]) map[k] = [];
        map[k].push(it);
    }
    return map;
}

function analyticsDayKey(value) {
    const d = new Date(value);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function analyticsDayLabels(from, to) {
    const labels = [];
    const cursor = new Date(from);
    cursor.setHours(0, 0, 0, 0);
    const last = new Date(to);
    last.setHours(0, 0, 0, 0);
    while (cursor <= last) {
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, '0');
        const day = String(cursor.getDate()).padStart(2, '0');
        labels.push(`${y}-${m}-${day}`);
        cursor.setDate(cursor.getDate() + 1);
    }
    return labels;
}

function marketingAttributionKey(item) {
    const parts = [
        item.source || 'direct',
        item.medium || 'none',
        item.campaign || 'no_campaign',
    ];
    return parts.join(' / ');
}

function marketingAttributionLabel(item) {
    const source = item.source || 'direct';
    const medium = item.medium || 'none';
    const campaign = item.campaign || 'no_campaign';
    return `${source} / ${medium} / ${campaign}`;
}

async function loadTrialAnalyticsForPeriod(from, to) {
    const bookings = await prisma.booking.findMany({
        where: {
            createdAt: { gte: from, lte: to },
            OR: [
                { requestType: 'trial' },
                { trialClassId: { not: null } },
                { trialFunnelStage: { not: null } },
            ],
        },
        select: {
            id: true,
            requestType: true,
            status: true,
            trialScheduledAt: true,
            trialClassId: true,
            depositPaid: true,
            trialFunnelStage: true,
            convertedToStudentId: true,
            source: true,
            attribution: true,
            cashTransactions: {
                where: { category: 'trial_payment', type: 'income' },
                select: { type: true, category: true, amount: true, paymentMethod: true, date: true },
            },
        },
        orderBy: { createdAt: 'asc' },
    });

    const classIds = bookings.map((booking) => booking.trialClassId).filter(Boolean);
    const classes = classIds.length
        ? await prisma.class.findMany({
            where: { id: { in: classIds } },
            select: {
                id: true,
                status: true,
                teacherOutcomeHint: true,
                trialReport: true,
                trialAiAnalysis: true,
                attendees: {
                    select: { studentId: true, attended: true, attendanceStatus: true },
                },
            },
        })
        : [];

    return buildTrialAnalytics(bookings, new Map(classes.map((item) => [item.id, item])));
}

const FIRST_SALE_PAYMENT_TYPES = ['membership_advance', 'membership_balance', 'membership_full'];

async function getFirstConfirmedSalesByStudent(from, to) {
    const payments = await prisma.payment.findMany({
        where: {
            status: 'completed',
            amount: { gt: 0 },
            type: { in: FIRST_SALE_PAYMENT_TYPES },
            paymentDate: { lte: to },
        },
        select: {
            id: true,
            studentId: true,
            bookingId: true,
            amount: true,
            paymentDate: true,
            createdAt: true,
            booking: {
                select: {
                    id: true,
                    source: true,
                    attribution: true,
                    marketingClientId: true,
                    marketingSessionId: true,
                    convertedToStudentId: true,
                    processedById: true,
                    processedBy: { select: { id: true, name: true, lastName: true, middleName: true } },
                },
            },
        },
        orderBy: [
            { paymentDate: 'asc' },
            { createdAt: 'asc' },
        ],
    });

    const firstByStudent = new Map();
    for (const payment of payments) {
        if (!payment.studentId || firstByStudent.has(payment.studentId)) continue;
        firstByStudent.set(payment.studentId, payment);
    }

    return Array.from(firstByStudent.values()).filter(payment => (
        payment.paymentDate >= from && payment.paymentDate <= to
    ));
}

function analyticsMonthKey(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

function parsePlanMonth(value) {
    const raw = String(value || '').trim();
    if (/^\d{4}-\d{2}$/.test(raw)) return raw;
    const parsed = raw ? new Date(raw) : new Date();
    if (!Number.isNaN(parsed.getTime())) return analyticsMonthKey(parsed);
    return analyticsMonthKey(new Date());
}

function planMonthBounds(monthKey) {
    const [year, month] = monthKey.split('-').map(Number);
    const from = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const to = new Date(year, month, 0, 23, 59, 59, 999);
    const daysInMonth = new Date(year, month, 0).getDate();
    return { from, to, daysInMonth };
}

function cleanPlanNumber(value) {
    const raw = String(value ?? '0').replace(/[^\d.-]/g, '');
    const number = Math.round(Number(raw));
    if (!Number.isFinite(number) || number < 0) return 0;
    return Math.min(number, 2_000_000_000);
}

function planPace(actual, plan, daysInMonth, monthStart, monthEnd) {
    const now = new Date();
    let elapsedDays = 0;
    if (now > monthEnd) {
        elapsedDays = daysInMonth;
    } else if (now >= monthStart) {
        elapsedDays = Math.max(1, now.getDate());
    }
    const remainingDays = Math.max(0, daysInMonth - elapsedDays);
    const projected = elapsedDays > 0
        ? Math.round((Number(actual) || 0) / elapsedDays * daysInMonth)
        : 0;
    const remaining = Math.max(0, (Number(plan) || 0) - (Number(actual) || 0));
    const dailyRequired = remainingDays > 0 ? Math.ceil(remaining / remainingDays) : remaining;
    return {
        percent: percent(Number(actual) || 0, Number(plan) || 0),
        projected,
        remaining,
        dailyRequired,
        elapsedDays,
        remainingDays,
        daysInMonth,
    };
}

async function analyticsPlanPayload(monthKey) {
    const { from, to, daysInMonth } = planMonthBounds(monthKey);
    const [plan, cashTransactions, bookingsCount] = await Promise.all([
        prisma.analyticsPlan.findUnique({ where: { month: monthKey } }),
        prisma.cashTransaction.findMany({
            where: { date: { gte: from, lte: to } },
            select: { type: true, amount: true, category: true },
        }),
        prisma.booking.count({
            where: { createdAt: { gte: from, lte: to } },
        }),
    ]);

    const actualRevenue = cashTransactions.reduce((sum, transaction) => {
        if (transaction.type !== 'income') return sum;
        if (['correction', 'balance_adjustment'].includes(transaction.category)) return sum;
        return sum + (transaction.amount || 0);
    }, 0);

    const revenuePlan = plan?.revenuePlan || 0;
    const bookingsPlan = plan?.bookingsPlan || 0;

    return {
        month: monthKey,
        plan: {
            revenuePlan,
            bookingsPlan,
            isConfigured: Boolean(plan),
            updatedAt: plan?.updatedAt || null,
        },
        actual: {
            revenue: actualRevenue,
            bookings: bookingsCount,
        },
        pace: {
            revenue: planPace(actualRevenue, revenuePlan, daysInMonth, from, to),
            bookings: planPace(bookingsCount, bookingsPlan, daysInMonth, from, to),
        },
    };
}

// ============================================================
// GET/PUT /api/analytics/plan
// Месячный план владельца: выручка и заявки.
// ============================================================
router.get('/plan', authenticate, requireAdmin, async (req, res) => {
    try {
        const monthKey = parsePlanMonth(req.query.month);
        return res.json({ success: true, ...(await analyticsPlanPayload(monthKey)) });
    } catch (error) {
        console.error('Analytics plan get error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка получения плана аналитики' });
    }
});

router.put('/plan', authenticate, requireAdmin, async (req, res) => {
    try {
        const monthKey = parsePlanMonth(req.body.month || req.query.month);
        await prisma.analyticsPlan.upsert({
            where: { month: monthKey },
            create: {
                month: monthKey,
                revenuePlan: cleanPlanNumber(req.body.revenuePlan),
                bookingsPlan: cleanPlanNumber(req.body.bookingsPlan),
                createdById: req.user?.id || null,
                updatedById: req.user?.id || null,
            },
            update: {
                revenuePlan: cleanPlanNumber(req.body.revenuePlan),
                bookingsPlan: cleanPlanNumber(req.body.bookingsPlan),
                updatedById: req.user?.id || null,
            },
        });

        return res.json({ success: true, ...(await analyticsPlanPayload(monthKey)) });
    } catch (error) {
        console.error('Analytics plan update error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка сохранения плана аналитики' });
    }
});

// ============================================================
// POST /api/analytics/daily-report/send
// Ручная отправка дневного Telegram-отчёта из аналитики.
// ============================================================
router.post('/daily-report/send', authenticate, requireAdmin, async (req, res) => {
    try {
        const result = await sendEveningReport(new Date(), {
            source: 'manual',
            generatedById: req.user?.id || null,
        });

        if (!result.sent) {
            return res.status(502).json({
                success: false,
                archived: true,
                date: result.stats?.date || null,
                error: 'Отчёт сохранён в архиве, но Telegram не отправил сообщение. Проверьте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID.'
            });
        }

        return res.json({
            success: true,
            message: 'Ежедневный отчёт отправлен в Telegram',
            date: result.stats?.date || null
        });
    } catch (error) {
        console.error('Analytics daily report send error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка отправки ежедневного отчёта' });
    }
});

// ============================================================
// GET /api/analytics/daily-reports
// Архив неизменяемых дневных срезов для месячного/квартального KPI.
// ============================================================
router.get('/daily-reports', authenticate, requireAdmin, async (req, res) => {
    try {
        const { from, to } = parsePeriod(req);
        const archive = await getDailyReportArchive(
            analyticsDayKey(from),
            analyticsDayKey(to),
            {
                limit: req.query.limit,
                includePayload: req.query.includePayload === 'true',
            },
        );

        return res.json({
            success: true,
            period: { from, to },
            ...archive,
        });
    } catch (error) {
        console.error('Analytics daily reports error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка загрузки архива ежедневных отчётов' });
    }
});

router.get('/daily-reports/:reportDate', authenticate, requireAdmin, async (req, res) => {
    try {
        const reportDate = String(req.params.reportDate || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
            return res.status(400).json({ success: false, error: 'Некорректная дата отчёта' });
        }
        const archive = await getDailyReportArchive(reportDate, reportDate, {
            limit: 1,
            includePayload: true,
        });
        const report = archive.reports[0];
        if (!report) {
            return res.status(404).json({ success: false, error: 'Ежедневный отчёт не найден' });
        }
        return res.json({ success: true, report });
    } catch (error) {
        console.error('Analytics daily report detail error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка загрузки ежедневного отчёта' });
    }
});

// ============================================================
// GET /api/analytics/operations-dashboard
// Дневные финансы, уроки, реализация, воронка и менеджеры.
// ============================================================
router.get('/operations-dashboard', authenticate, requireAdmin, async (req, res) => {
    try {
        const { from, to } = parsePeriod(req);
        const labels = analyticsDayLabels(from, to);
        const emptySeries = () => Object.fromEntries(labels.map(label => [label, 0]));

        const [cashTransactions, classes, bookings, firstPaymentSales] = await Promise.all([
            prisma.cashTransaction.findMany({
                where: { date: { gte: from, lte: to } },
                select: { type: true, amount: true, date: true, category: true },
            }),
            prisma.class.findMany({
                where: {
                    date: { gte: from, lte: to },
                    status: 'completed',
                    isPractice: false,
                },
                select: {
                    id: true,
                    date: true,
                    classType: true,
                    price: true,
                    attendees: {
                        select: {
                            attended: true,
                            attendanceStatus: true,
                            chargeAmount: true,
                        },
                    },
                },
            }),
            prisma.booking.findMany({
                where: { createdAt: { gte: from, lte: to } },
                select: {
                    id: true,
                    status: true,
                    processedById: true,
                    convertedToStudentId: true,
                    processedBy: { select: { id: true, name: true, lastName: true, middleName: true } },
                },
            }),
            getFirstConfirmedSalesByStudent(from, to),
        ]);

        const trialClassIds = classes.map((item) => item.id);
        const linkedTrialClasses = trialClassIds.length
            ? await prisma.booking.findMany({
                where: { trialClassId: { in: trialClassIds } },
                select: { trialClassId: true },
            })
            : [];
        const linkedTrialClassIds = new Set(linkedTrialClasses.map((item) => item.trialClassId).filter(Boolean));

        const income = emptySeries();
        const expenses = emptySeries();
        const realization = emptySeries();
        const lessonSeries = {
            individual: emptySeries(),
            group: emptySeries(),
            theory: emptySeries(),
            trial: emptySeries(),
            other: emptySeries(),
        };

        for (const transaction of cashTransactions) {
            const key = analyticsDayKey(transaction.date);
            if (income[key] === undefined) continue;
            if (['correction', 'balance_adjustment'].includes(transaction.category)) continue;

            if (transaction.type === 'income') {
                income[key] += transaction.amount || 0;
            } else {
                expenses[key] += transaction.amount || 0;
            }
        }
        for (const lesson of classes) {
            const key = analyticsDayKey(lesson.date);
            if (realization[key] === undefined) continue;
            const effectiveClassType = lesson.classType === 'trial' || linkedTrialClassIds.has(lesson.id)
                ? 'trial'
                : lesson.classType;
            const type = lessonSeries[effectiveClassType] ? effectiveClassType : 'other';
            lessonSeries[type][key] += 1;
            const attendeeValue = lesson.attendees
                .filter(item => item.attended || ['late', 'unexcused_absence'].includes(item.attendanceStatus))
                .reduce((sum, item) => sum + Math.max(0, item.chargeAmount || 0), 0);
            realization[key] += attendeeValue || Math.max(0, lesson.price || 0);
        }

        const funnelOrder = ['new', 'processed', 'trial', 'thinking', 'sold', 'rejected'];
        const funnelLabels = {
            new: 'Новые',
            processed: 'В работе',
            trial: 'Пробный назначен',
            thinking: 'Провели пробный / Думают',
            sold: 'Оплачено',
            rejected: 'Потеряно',
        };
        const funnelCounts = Object.fromEntries(funnelOrder.map(status => [status, 0]));
        const managerMap = new Map();
        const bookingById = new Map();
        const bookingByStudentId = new Map();
        const ensureManager = (managerId, managerPerson) => {
            if (!managerId || !managerPerson) return null;
            if (!managerMap.has(managerId)) {
                managerMap.set(managerId, {
                    id: managerId,
                    name: formatAnalyticsFio(managerPerson),
                    processed: 0,
                    paid: 0,
                    trials: 0,
                    lost: 0,
                });
            }
            return managerMap.get(managerId);
        };
        for (const booking of bookings) {
            bookingById.set(booking.id, booking);
            if (booking.convertedToStudentId) bookingByStudentId.set(booking.convertedToStudentId, booking);
            if (funnelCounts[booking.status] !== undefined) funnelCounts[booking.status] += 1;
            if (!booking.processedById || !booking.processedBy) continue;
            const manager = ensureManager(booking.processedById, booking.processedBy);
            manager.processed += 1;
            if (booking.status === 'trial' || booking.status === 'thinking') manager.trials += 1;
            if (booking.status === 'rejected') manager.lost += 1;
        }
        funnelCounts.sold = firstPaymentSales.length;
        for (const payment of firstPaymentSales) {
            const saleBooking = payment.booking
                || (payment.bookingId ? bookingById.get(payment.bookingId) : null)
                || bookingByStudentId.get(payment.studentId);
            const manager = ensureManager(saleBooking?.processedById, saleBooking?.processedBy);
            if (manager) manager.paid += 1;
        }

        const toValues = series => labels.map(label => series[label] || 0);
        return res.json({
            success: true,
            period: { from, to },
            labels,
            finance: {
                income: toValues(income),
                expenses: toValues(expenses),
                net: labels.map(label => (income[label] || 0) - (expenses[label] || 0)),
            },
            lessons: Object.fromEntries(
                Object.entries(lessonSeries).map(([key, series]) => [key, toValues(series)])
            ),
            revenueVsRealization: {
                income: toValues(income),
                realization: toValues(realization),
            },
            funnel: funnelOrder.map(status => ({
                key: status,
                label: funnelLabels[status],
                value: funnelCounts[status],
            })),
            managers: Array.from(managerMap.values())
                .map(item => ({
                    ...item,
                    conversionPercent: percent(item.paid, item.processed),
                }))
                .sort((a, b) => b.paid - a.paid || b.processed - a.processed),
        });
    } catch (error) {
        console.error('Analytics operations dashboard error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка построения операционных графиков' });
    }
});

// ============================================================
// GET /api/analytics/trials
// Сквозная когортная аналитика заявок на пробный урок.
// Когорта определяется по дате создания заявки, а этапы — по фактам урока,
// оплате и воронке. Поэтому незаведённая карточка ученика не теряется.
// ============================================================
router.get('/trials', authenticate, requireAdmin, async (req, res) => {
    try {
        const { from, to } = parsePeriod(req);
        const analytics = await loadTrialAnalyticsForPeriod(from, to);
        return res.json({
            success: true,
            period: { from, to },
            cohort: 'trial_bookings_created_in_period',
            ...analytics,
        });
    } catch (error) {
        console.error('Analytics trials error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка аналитики пробных уроков' });
    }
});

// ============================================================
// GET /api/analytics/overview
// ============================================================
router.get('/overview', authenticate, requireAdmin, async (req, res) => {
    try {
        const { from, to } = parsePeriod(req);
        const now = new Date();
        const trialAcquisitionFunnel = await loadTrialAnalyticsForPeriod(from, to);

        // --- Действующие ученики ---
        // Есть активный non-trial абонемент, действующий сейчас
        const nonTrialActiveRows = await prisma.membership.findMany({
            where: {
                status: 'active',
                endDate: { gte: now },
                type: { not: 'trial' },
                student: { role: 'student', status: 'active' },
            },
            select: { studentId: true },
            distinct: ['studentId'],
        });
        const activeStudentIds = new Set(nonTrialActiveRows.map(r => r.studentId));

        const trialActiveRows = await prisma.membership.findMany({
            where: {
                status: 'active',
                endDate: { gte: now },
                type: 'trial',
                student: { role: 'student', status: 'active' },
            },
            select: { studentId: true },
            distinct: ['studentId'],
        });
        const activeTrialBookings = await prisma.booking.findMany({
            where: {
                requestType: 'trial',
                status: 'trial',
            },
            select: { id: true, convertedToStudentId: true },
        });
        const trialStudentIds = new Set(trialActiveRows.map(r => r.studentId));
        const trialNowKeys = new Set([
            ...trialActiveRows.map(row => `student:${row.studentId}`),
            ...activeTrialBookings.map(booking =>
                booking.convertedToStudentId ? `student:${booking.convertedToStudentId}` : `booking:${booking.id}`
            ),
        ]);
        const convertedTrialStudentIds = activeTrialBookings
            .map(booking => booking.convertedToStudentId)
            .filter(Boolean);

        const activeStudents = new Set([...activeStudentIds, ...trialStudentIds, ...convertedTrialStudentIds]).size;
        const trialStudents  = trialNowKeys.size;
        const regularStudents = activeStudentIds.size;

        // --- Пробные за период ---
        // Старые записи подтверждаются trial-абонементом.
        // В новой схеме пробный считается закрытым только после реального
        // платежа на баланс ученика.
        const [trialMembershipsInPeriod, convertedTrialBookingsInPeriod] = await Promise.all([
            prisma.membership.findMany({
                where: {
                    type: 'trial',
                    createdAt: { gte: from, lte: to },
                },
                select: { id: true, bookingId: true, studentId: true, createdAt: true, startDate: true, endDate: true },
                orderBy: { createdAt: 'asc' },
            }),
            prisma.booking.findMany({
                where: {
                    requestType: 'trial',
                    convertedToStudentId: { not: null },
                    OR: [
                        { trialScheduledAt: { gte: from, lte: to } },
                        { trialScheduledAt: null, convertedAt: { gte: from, lte: to } },
                    ],
                },
                select: {
                    id: true,
                    convertedToStudentId: true,
                    trialScheduledAt: true,
                    convertedAt: true,
                    createdAt: true,
                },
                orderBy: { convertedAt: 'asc' },
            }),
        ]);
        const trialByStudent = new Map();
        for (const membership of trialMembershipsInPeriod) {
            if (!trialByStudent.has(membership.studentId)) {
                trialByStudent.set(membership.studentId, membership);
            }
        }
        for (const booking of convertedTrialBookingsInPeriod) {
            if (!trialByStudent.has(booking.convertedToStudentId)) {
                const trialDate = booking.trialScheduledAt || booking.convertedAt || booking.createdAt;
                trialByStudent.set(booking.convertedToStudentId, {
                    id: `booking:${booking.id}`,
                    bookingId: booking.id,
                    studentId: booking.convertedToStudentId,
                    createdAt: trialDate,
                    startDate: trialDate,
                    endDate: trialDate,
                });
            }
        }
        const trialCohort = Array.from(trialByStudent.values());
        const trialStudentIdsInPeriod = trialCohort.map(m => m.studentId);
        const newTrialsInPeriod = trialStudentIdsInPeriod.length;

        const trialRevenueSummary = await prisma.cashTransaction.aggregate({
            where: {
                type: 'income',
                category: 'trial_payment',
                date: { gte: from, lte: to },
            },
            _sum: { amount: true },
            _count: { _all: true },
        });
        const trialRevenue = Number(trialRevenueSummary._sum.amount || 0);
        const trialRevenueCount = Number(trialRevenueSummary._count._all || 0);

        const trialPayments = trialStudentIdsInPeriod.length
            ? await prisma.payment.findMany({
                where: {
                    studentId: { in: trialStudentIdsInPeriod },
                    status: 'completed',
                    amount: { gt: 0 },
                    type: { in: FIRST_SALE_PAYMENT_TYPES },
                },
                select: { studentId: true, paymentDate: true },
            })
            : [];
        const trialPaymentsByStudent = groupByStudent(trialPayments);

        // --- Конверсия пробный -> оплата ---
        // Учитываем только реальные деньги, поступившие ПОСЛЕ пробного.
        const closedStudentIds = new Set();
        for (const trial of trialCohort) {
            const trialDate = new Date(trial.startDate || trial.createdAt);
            const hasPayment = (trialPaymentsByStudent[trial.studentId] || []).some(payment =>
                new Date(payment.paymentDate) >= trialDate
            );
            if (hasPayment) {
                closedStudentIds.add(trial.studentId);
            }
        }
        const trialToMembershipConversion = computeTrialConversion(
            trialStudentIdsInPeriod,
            Array.from(closedStudentIds)
        );

        const attendedTrialRows = trialStudentIdsInPeriod.length
            ? await prisma.classAttendee.findMany({
                where: {
                    studentId: { in: trialStudentIdsInPeriod },
                    attended: true,
                    class: { status: 'completed' },
                },
                select: {
                    studentId: true,
                    class: { select: { date: true } },
                },
            })
            : [];
        const attendedTrialStudentIds = new Set(
            trialCohort
                .filter(trial => attendedTrialRows.some(row =>
                    row.studentId === trial.studentId
                    && new Date(row.class.date) >= new Date(trial.startDate || trial.createdAt)
                ))
                .map(trial => trial.studentId)
        );

        const trialBookingIds = trialCohort.map(item => item.bookingId).filter(Boolean);
        const rejectedTrialBookings = trialBookingIds.length
            ? await prisma.booking.findMany({
                where: {
                    id: { in: trialBookingIds },
                    status: 'rejected',
                },
                select: {
                    id: true,
                    status: true,
                    lossStage: true,
                    appStatus: true,
                    convertedToStudentId: true,
                    trialScheduledAt: true,
                    convertedAt: true,
                    createdAt: true,
                },
            })
            : [];
        const rejectedTrialBookingIds = new Set();
        for (const booking of rejectedTrialBookings) {
            if (await normalizeBookingLossStage(prisma, booking) === 'after_trial') {
                rejectedTrialBookingIds.add(booking.id);
            }
        }

        // --- Средний чек (non-trial membership покупки за период) ---
        const paymentsInPeriod = await prisma.payment.findMany({
            where: {
                status: 'completed',
                type: { in: ['membership_full', 'membership_advance', 'membership_balance'] },
                paymentDate: { gte: from, lte: to },
                amount: { gt: 0 },
            },
            select: { amount: true, status: true, studentId: true, paymentDate: true },
        });
        const avgCheck = computeAvgCheck(paymentsInPeriod);

        // --- Средняя продолжительность ---
        // Берём когорту "ушедших за период": последний non-trial membership закончился в [from, to]
        // и у студента нет активного membership на "сейчас".
        const allMems = await prisma.membership.findMany({
            where: { type: { not: 'trial' } },
            select: { studentId: true, startDate: true, endDate: true, status: true },
        });
        const memsByStudent = groupByStudent(allMems);
        const churnedInPeriod = {};
        for (const [sid, list] of Object.entries(memsByStudent)) {
            if (!list || list.length === 0) continue;
            let maxEnd = -Infinity;
            let hasActive = false;
            for (const m of list) {
                const e = m.endDate ? new Date(m.endDate).getTime() : -Infinity;
                if (e > maxEnd) maxEnd = e;
                if (m.status === 'active' && e >= now.getTime()) hasActive = true;
            }
            if (hasActive) continue;
            if (!Number.isFinite(maxEnd)) continue;
            if (maxEnd < from.getTime() || maxEnd > to.getTime()) continue;
            churnedInPeriod[sid] = list;
        }
        const avgLifespanMonths = computeAvgLifespanMonths(churnedInPeriod);
        const avgLifespanCohort = Object.keys(churnedInPeriod).length;

        // --- Churn after trial ---
        // Потеря фиксируется после завершения 14-дневного окна решения либо сразу,
        // если заявка явно отклонена на этапе «После пробного».
        let churnAfterTrialCount = 0;
        let matureTrialCohort = 0;
        let awaitingTrialDecision = 0;
        for (const tm of trialCohort) {
            const cutoff = new Date(tm.endDate || tm.createdAt);
            cutoff.setDate(cutoff.getDate() + 14);
            const converted = closedStudentIds.has(tm.studentId);
            const explicitlyLost = tm.bookingId && rejectedTrialBookingIds.has(tm.bookingId);
            const matured = cutoff <= now;

            if (converted) {
                matureTrialCohort++;
                continue;
            }
            if (explicitlyLost || matured) {
                matureTrialCohort++;
                churnAfterTrialCount++;
            } else {
                awaitingTrialDecision++;
            }
        }
        const churnAfterTrial = {
            count: churnAfterTrialCount,
            total: matureTrialCohort,
            percent: percent(churnAfterTrialCount, matureTrialCohort),
            awaiting: awaitingTrialDecision,
        };
        const trialFunnel = {
            trials: newTrialsInPeriod,
            attended: attendedTrialStudentIds.size,
            converted: closedStudentIds.size,
            closed: closedStudentIds.size,
            lostAfterTrial: churnAfterTrialCount,
            awaitingDecision: awaitingTrialDecision,
        };

        // --- Churn after month 1 / month 2 ---
        // Берём non-trial memberships у которых endDate в периоде; не продлили = нет mem с createdAt <= endDate+45д
        const firstTierMems = await prisma.membership.findMany({
            where: {
                type: { not: 'trial' },
                endDate: { gte: from, lte: to },
            },
            select: { id: true, studentId: true, startDate: true, endDate: true, createdAt: true },
            orderBy: { startDate: 'asc' },
        });
        const allStudentMems = {};
        for (const m of allMems) {
            if (!allStudentMems[m.studentId]) allStudentMems[m.studentId] = [];
            allStudentMems[m.studentId].push(m);
        }
        for (const list of Object.values(allStudentMems)) {
            list.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
        }

        let month1Total = 0, month1Churn = 0;
        let month2Total = 0, month2Churn = 0;
        for (const m of firstTierMems) {
            const list = allStudentMems[m.studentId] || [];
            const idx = list.findIndex(x => {
                const xs = new Date(x.startDate).getTime();
                const ms = new Date(m.startDate).getTime();
                return xs === ms;
            });
            if (idx === -1) continue;
            const nthMonth = idx + 1;
            if (nthMonth !== 1 && nthMonth !== 2) continue;
            const endOfThis = new Date(m.endDate || m.startDate).getTime();
            const cutoff = endOfThis + 45 * MS_PER_DAY;
            const renewed = list.slice(idx + 1).some(x => {
                const xc = new Date(x.createdAt).getTime();
                return xc <= cutoff;
            });
            if (nthMonth === 1) {
                month1Total++;
                if (!renewed) month1Churn++;
            } else {
                month2Total++;
                if (!renewed) month2Churn++;
            }
        }
        const churnAfterMonth1 = { count: month1Churn, total: month1Total, percent: percent(month1Churn, month1Total) };
        const churnAfterMonth2 = { count: month2Churn, total: month2Total, percent: percent(month2Churn, month2Total) };

        // --- Lost profit from emergency freezes (Упущенная прибыль из-за экстренных заморозок) ---
        const frozenClasses = await prisma.class.findMany({
            where: {
                date: { gte: from, lte: to },
                status: 'cancelled',
                attendees: {
                    some: {
                        attendanceStatus: 'excused_absence'
                    }
                }
            },
            include: {
                attendees: {
                    include: {
                        student: {
                            select: {
                                id: true,
                                memberships: {
                                    where: { status: 'active' },
                                    select: { totalPrice: true, totalClasses: true }
                                }
                            }
                        }
                    }
                },
                teacher: {
                    select: {
                        id: true,
                        salaryIndividual: true,
                        salaryGroup: true,
                        salaryOther: true
                    }
                }
            }
        });

        let frozenClassesCount = 0;
        let frozenClassesTeacherPayouts = 0;
        let frozenClassesLostRevenue = 0;

        for (const classItem of frozenClasses) {
            const hasFreezeAttendee = classItem.attendees.some(a => a.attendanceStatus === 'excused_absence');
            if (!hasFreezeAttendee) continue;

            frozenClassesCount++;

            // Calculate teacher payout for this class
            if (classItem.teacher) {
                const rate = getTeacherRate(classItem.teacher, classItem);
                frozenClassesTeacherPayouts += rate;
            }

            // Calculate lost revenue (value of the lessons that were frozen)
            for (const attendee of classItem.attendees) {
                if (attendee.attendanceStatus !== 'excused_absence') continue;

                let lessonValue = 4000; // fallback value (₸)
                const activeMembership = attendee.student?.memberships?.[0];
                if (activeMembership && activeMembership.totalClasses > 0) {
                    lessonValue = Math.round(activeMembership.totalPrice / activeMembership.totalClasses);
                } else if (classItem.price && classItem.price > 0) {
                    lessonValue = classItem.price;
                }
                frozenClassesLostRevenue += lessonValue;
            }
        }

        const frozenClassesLostProfit = frozenClassesTeacherPayouts + frozenClassesLostRevenue;

        // --- Lost students (потерянные) ---
        // Источник истины — последний платёж ученика. Ученик "потерян",
        // если последний платёж был ≥ 3 мес. назад, либо платежей не было
        // и зарегистрирован > 3 мес. назад.
        const lostThreshold = getLostThresholdDate();
        const lostRows = await prisma.$queryRaw`
            SELECT COUNT(*)::int AS cnt
            FROM "Student" s
            WHERE s.role = 'student' AND s.status = 'active'
            AND COALESCE(
                (SELECT MAX(p."paymentDate") FROM "Payment" p
                 WHERE p."studentId" = s.id AND p."paymentDate" IS NOT NULL),
                s."createdAt"
            ) < ${lostThreshold}
        `;
        const lostStudents = Number((lostRows && lostRows[0] && lostRows[0].cnt) || 0);

        return res.json({
            success: true,
            period: { from, to },
            lostThresholdMonths: LOST_STUDENT_MONTHS,
            totals: {
                activeStudents,
                trialStudents,
                regularStudents,
                lostStudents,
            },
            period_metrics: {
                newTrialsInPeriod,
                trialRevenue,
                trialRevenueCount,
                trialToMembershipConversion,
                trialFunnel,
                // Когорта заявок на пробный — отдельная сквозная воронка.
                // Старые и ещё не конвертированные заявки тоже учитываются.
                trialAcquisitionFunnel,
                avgCheck,
                avgLifespanMonths,
                avgLifespanCohort,
                churnAfterTrial,
                churnAfterMonth1,
                churnAfterMonth2,
                frozenClassesCount,
                frozenClassesTeacherPayouts,
                frozenClassesLostRevenue,
                frozenClassesLostProfit,
            },
        });
    } catch (error) {
        console.error('Analytics overview error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка сбора аналитики' });
    }
});

// ============================================================
// GET /api/analytics/teachers
// ============================================================
router.get('/teachers', authenticate, requireAdmin, async (req, res) => {
    try {
        const { from, to } = parsePeriod(req);
        const now = new Date();

        const teachers = await prisma.student.findMany({
            where: { role: 'teacher', status: 'active' },
            select: { id: true, name: true, lastName: true, middleName: true, phone: true },
        });
        const teacherIds = teachers.map(t => t.id);

        // Все группы с teacherId -> studentId через StudentGroup (active)
        const groups = await prisma.group.findMany({
            where: { teacherId: { not: null } },
            select: {
                id: true,
                teacherId: true,
                students: { select: { studentId: true, status: true } },
            },
        });

        const teacherActiveStudentIds = {};
        const teacherAllStudentIds = {};
        const teacherMoneyActiveStudentIds = {};
        const teacherMoneyAllStudentIds = {};
        const ensureTeacherSets = (teacherId) => {
            if (!teacherActiveStudentIds[teacherId]) teacherActiveStudentIds[teacherId] = new Set();
            if (!teacherAllStudentIds[teacherId]) teacherAllStudentIds[teacherId] = new Set();
            if (!teacherMoneyActiveStudentIds[teacherId]) teacherMoneyActiveStudentIds[teacherId] = new Set();
            if (!teacherMoneyAllStudentIds[teacherId]) teacherMoneyAllStudentIds[teacherId] = new Set();
        };
        const addTeacherStudent = ({ teacherId, studentId, active = false, money = false }) => {
            if (!teacherId || !studentId) return;
            ensureTeacherSets(teacherId);
            teacherAllStudentIds[teacherId].add(studentId);
            if (active) teacherActiveStudentIds[teacherId].add(studentId);
            if (money) {
                teacherMoneyAllStudentIds[teacherId].add(studentId);
                if (active) teacherMoneyActiveStudentIds[teacherId].add(studentId);
            }
        };
        for (const g of groups) {
            for (const sg of g.students) {
                addTeacherStudent({
                    teacherId: g.teacherId,
                    studentId: sg.studentId,
                    active: sg.status === 'active',
                    money: true,
                });
            }
        }

        const assignedStudents = teacherIds.length ? await prisma.student.findMany({
            where: { role: 'student', assignedTeacherId: { in: teacherIds } },
            select: { id: true, status: true, assignedTeacherId: true },
        }) : [];
        for (const student of assignedStudents) {
            addTeacherStudent({
                teacherId: student.assignedTeacherId,
                studentId: student.id,
                active: student.status === 'active',
                money: true,
            });
        }

        const scheduledStudents = teacherIds.length ? await prisma.studentSchedule.findMany({
            where: {
                teacherId: { in: teacherIds },
                isPractice: false,
                student: { role: 'student' },
            },
            select: {
                studentId: true,
                teacherId: true,
                student: { select: { status: true } },
            },
        }) : [];
        for (const row of scheduledStudents) {
            addTeacherStudent({
                teacherId: row.teacherId,
                studentId: row.studentId,
                active: row.student?.status === 'active',
                money: false,
            });
        }

        const membershipStudents = teacherIds.length ? await prisma.membership.findMany({
            where: { teacherId: { in: teacherIds }, status: 'active' },
            select: { teacherId: true, studentId: true, student: { select: { status: true } } },
        }) : [];
        for (const membership of membershipStudents) {
            addTeacherStudent({
                teacherId: membership.teacherId,
                studentId: membership.studentId,
                active: membership.student?.status === 'active',
                money: true,
            });
        }

        // Платежи по teacherId (прямое поле)
        const teacherPayments = await prisma.payment.findMany({
            where: {
                status: 'completed',
                teacherId: { in: teacherIds },
                paymentDate: { gte: from, lte: to },
                amount: { gt: 0 },
            },
            select: { amount: true, teacherId: true, studentId: true, status: true },
        });

        const lostThreshold = getLostThresholdDate();
        const nowMs = new Date().getTime();

        const result = [];
        for (const t of teachers) {
            const activeStudentSet = teacherActiveStudentIds[t.id] || new Set();
            const activeStudentIds = Array.from(activeStudentSet);

            const allStudentSet = teacherAllStudentIds[t.id] || new Set();
            const allStudentIds = Array.from(allStudentSet);
            const moneyActiveStudentSet = teacherMoneyActiveStudentIds[t.id] || new Set();
            const moneyActiveStudentIds = Array.from(moneyActiveStudentSet);
            const moneyAllStudentSet = teacherMoneyAllStudentIds[t.id] || new Set();
            const moneyAllStudentIds = Array.from(moneyAllStudentSet);

            // Средний чек по платежам где teacherId = t.id (в периоде)
            const payments = teacherPayments.filter(p => p.teacherId === t.id);
            const avgCheckTeacher = computeAvgCheck(payments);

            // LTV за период: сумма completed-платежей этих учеников в [from, to] / число активных учеников
            const ltvPayments = moneyActiveStudentIds.length ? await prisma.payment.findMany({
                where: {
                    studentId: { in: moneyActiveStudentIds },
                    status: 'completed',
                    amount: { gt: 0 },
                    paymentDate: { gte: from, lte: to },
                },
                select: { amount: true, studentId: true, status: true },
            }) : [];
            const paymentsByStudent = {};
            for (const sid of moneyActiveStudentIds) paymentsByStudent[sid] = [];
            for (const p of ltvPayments) {
                if (!paymentsByStudent[p.studentId]) paymentsByStudent[p.studentId] = [];
                paymentsByStudent[p.studentId].push(p);
            }
            const avgLtv = computeAvgLtv(paymentsByStudent);

            // Средняя продолжительность: когорта учеников, ушедших (последний mem закончился) в [from, to].
            const nonTrialMemsAll = moneyAllStudentIds.length ? await prisma.membership.findMany({
                where: { studentId: { in: moneyAllStudentIds }, type: { not: 'trial' } },
                select: { studentId: true, startDate: true, endDate: true, status: true },
            }) : [];
            
            const memsByStudent = {};
            for (const m of nonTrialMemsAll) {
                if (!memsByStudent[m.studentId]) memsByStudent[m.studentId] = [];
                memsByStudent[m.studentId].push(m);
            }
            const churnedInPeriod = {};
            for (const [sid, list] of Object.entries(memsByStudent)) {
                let maxEnd = -Infinity;
                let hasActive = false;
                for (const m of list) {
                    const e = m.endDate ? new Date(m.endDate).getTime() : -Infinity;
                    if (e > maxEnd) maxEnd = e;
                    if (m.status === 'active' && e >= nowMs) hasActive = true;
                }
                if (hasActive) continue;
                if (!Number.isFinite(maxEnd)) continue;
                if (maxEnd < from.getTime() || maxEnd > to.getTime()) continue;
                churnedInPeriod[sid] = list;
            }
            const avgLifespanMonths = computeAvgLifespanMonths(churnedInPeriod);
            const avgLifespanCohort = Object.keys(churnedInPeriod).length;

            // Потерянные среди их студентов (по последнему платежу)
            let lostCount = 0;
            if (allStudentIds.length) {
                const rows = await prisma.$queryRaw`
                    SELECT COUNT(*)::int AS cnt
                    FROM "Student" s
                    WHERE s.id IN (${Prisma.join(allStudentIds)})
                    AND COALESCE(
                        (SELECT MAX(p."paymentDate") FROM "Payment" p
                         WHERE p."studentId" = s.id AND p."paymentDate" IS NOT NULL),
                        s."createdAt"
                    ) < ${lostThreshold}
                `;
                lostCount = Number((rows && rows[0] && rows[0].cnt) || 0);
            }

            result.push({
                id: t.id,
                name: formatAnalyticsFio(t),
                studentsCount: activeStudentIds.length,
                lostCount,
                avgCheck: avgCheckTeacher,
                avgLtv,
                avgLifespanMonths,
                avgLifespanCohort,
            });
        }

        // Сортируем по количеству учеников убыв.
        result.sort((a, b) => b.studentsCount - a.studentsCount);

        return res.json({ success: true, period: { from, to }, teachers: result });
    } catch (error) {
        console.error('Analytics teachers error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка сбора аналитики по преподавателям' });
    }
});

// ----- precompute per-user churn (month1/month2) -----
// Возвращает Map<userId, { m1: {total, churn}, m2: {total, churn} }>
// по всем non-trial абонементам, у которых endDate в периоде [from, to].
// Атрибуция идёт по createdById 1-го или 2-го non-trial абонемента у ученика.
async function computePerUserChurn({ from, to }) {
    const allNonTrialMems = await prisma.membership.findMany({
        where: { type: { not: 'trial' } },
        select: { id: true, studentId: true, startDate: true, endDate: true, createdAt: true, createdById: true },
        orderBy: { startDate: 'asc' },
    });
    const byStudent = {};
    for (const m of allNonTrialMems) {
        if (!byStudent[m.studentId]) byStudent[m.studentId] = [];
        byStudent[m.studentId].push(m);
    }

    const perUser = new Map();
    const bump = (userId, key, churned) => {
        if (!userId) return;
        if (!perUser.has(userId)) perUser.set(userId, { m1: { total: 0, churn: 0 }, m2: { total: 0, churn: 0 } });
        const u = perUser.get(userId);
        u[key].total += 1;
        if (churned) u[key].churn += 1;
    };

    for (const list of Object.values(byStudent)) {
        list.forEach((m, idx) => {
            const nth = idx + 1;
            if (nth !== 1 && nth !== 2) return;
            const end = m.endDate ? new Date(m.endDate).getTime() : null;
            if (end == null) return;
            if (end < from.getTime() || end > to.getTime()) return;
            const cutoff = end + 45 * MS_PER_DAY;
            const renewed = list.slice(idx + 1).some(x => new Date(x.createdAt).getTime() <= cutoff);
            const key = nth === 1 ? 'm1' : 'm2';
            bump(m.createdById, key, !renewed);
        });
    }
    return perUser;
}

// ============================================================
// GET /api/analytics/managers
// ============================================================
router.get('/managers', authenticate, requireAdmin, async (req, res) => {
    try {
        const { from, to } = parsePeriod(req);

        const managers = await prisma.student.findMany({
            where: { role: 'sales_manager', status: 'active' },
            select: { id: true, name: true, lastName: true, middleName: true, phone: true },
        });

        const perUserChurn = await computePerUserChurn({ from, to });

        const result = [];
        for (const m of managers) {
            // Заявок обработано за период
            const bookingsProcessed = await prisma.booking.count({
                where: {
                    processedById: m.id,
                    processedAt: { gte: from, lte: to },
                },
            });

            // Исторический факт пробного хранится в самой trial-заявке.
            // Это работает и для старых записей с trial-абонементом, и для новой
            // схемы, где после пробного создаётся только карточка ученика.
            const trialsSold = await prisma.booking.count({
                where: {
                    processedById: m.id,
                    processedAt: { gte: from, lte: to },
                    requestType: 'trial',
                    convertedToStudentId: { not: null },
                },
            });

            // Абонементы проданы (не пробные)
            const membershipsSold = await prisma.membership.count({
                where: {
                    createdById: m.id,
                    type: { not: 'trial' },
                    createdAt: { gte: from, lte: to },
                },
            });

            // Студенты с пробниками от этого менеджера
            const theirBookings = await prisma.booking.findMany({
                where: {
                    processedById: m.id,
                    processedAt: { gte: from, lte: to },
                    requestType: 'trial',
                    convertedToStudentId: { not: null },
                },
                select: { convertedToStudentId: true, groupId: true, trialScheduledAt: true, convertedAt: true, createdAt: true },
            });
            const theirStudentIds = theirBookings.map(b => b.convertedToStudentId).filter(Boolean);

            const trialPayments = theirStudentIds.length ? await prisma.payment.findMany({
                where: {
                    studentId: { in: theirStudentIds },
                    status: 'completed',
                    amount: { gt: 0 },
                    type: { in: FIRST_SALE_PAYMENT_TYPES },
                },
                select: { studentId: true, paymentDate: true },
            }) : [];

            // Доходимость: % учеников, которые реально посетили >=1 занятие
            let trialRetention = { count: 0, total: theirStudentIds.length, percent: 0 };
            if (theirStudentIds.length) {
                const attendedRows = await prisma.classAttendee.findMany({
                    where: {
                        studentId: { in: theirStudentIds },
                        attended: true,
                    },
                    select: { studentId: true },
                    distinct: ['studentId'],
                });
                trialRetention.count = attendedRows.length;
                trialRetention.percent = percent(attendedRows.length, theirStudentIds.length);
            }

            const trialPaymentsByStudent = groupByStudent(trialPayments);
            const closedTrialStudentIds = new Set();
            for (const booking of theirBookings) {
                const sid = booking.convertedToStudentId;
                if (!sid) continue;
                const anchor = new Date(booking.trialScheduledAt || booking.convertedAt || booking.createdAt);
                const hasPayment = (trialPaymentsByStudent[sid] || []).some(payment => new Date(payment.paymentDate) >= anchor);
                if (hasPayment) {
                    closedTrialStudentIds.add(sid);
                }
            }

            // Конверсия: их trial-ученики -> закрыты после пробного (оплата или абонемент)
            let postTrialConversion = { converted: 0, closed: 0, total: theirStudentIds.length, percent: 0 };
            if (theirStudentIds.length) {
                postTrialConversion.converted = closedTrialStudentIds.size;
                postTrialConversion.closed = closedTrialStudentIds.size;
                postTrialConversion.percent = percent(closedTrialStudentIds.size, theirStudentIds.length);
            }

            // Phase 2: возражения (loss reasons) по его заявкам, потерянным в периоде
            const lostBookings = await prisma.booking.findMany({
                where: {
                    processedById: m.id,
                    OR: [
                        { lostAt: { gte: from, lte: to } },
                        { lostAt: null, status: 'rejected', updatedAt: { gte: from, lte: to } },
                    ],
                },
                select: {
                    id: true, status: true, lossReason: true, lossStage: true,
                    appStatus: true, convertedToStudentId: true, trialScheduledAt: true, convertedAt: true, createdAt: true,
                },
            });
            const lossReasonBreakdown = {};
            const lossStageBreakdown = {};
            for (const b of lostBookings) {
                if (b.lossReason) lossReasonBreakdown[b.lossReason] = (lossReasonBreakdown[b.lossReason] || 0) + 1;
                const stage = await normalizeBookingLossStage(prisma, b);
                lossStageBreakdown[stage] = (lossStageBreakdown[stage] || 0) + 1;
            }
            const lostCountTotal = lostBookings.length;

            // Phase 2: кто сколько потеряшек вернул в периоде
            const recoveredCount = await prisma.studentRecovery.count({
                where: {
                    recoveredByUserId: m.id,
                    recoveredAt: { gte: from, lte: to },
                },
            });

            const userChurn = perUserChurn.get(m.id) || { m1: { total: 0, churn: 0 }, m2: { total: 0, churn: 0 } };
            const churnMonth1 = {
                total: userChurn.m1.total,
                churned: userChurn.m1.churn,
                percent: percent(userChurn.m1.churn, userChurn.m1.total),
            };
            const churnMonth2 = {
                total: userChurn.m2.total,
                churned: userChurn.m2.churn,
                percent: percent(userChurn.m2.churn, userChurn.m2.total),
            };

            result.push({
                id: m.id,
                name: formatAnalyticsFio(m),
                bookingsProcessed,
                trialsSold,
                membershipsSold,
                trialRetention,
                postTrialConversion,
                lostCount: lostCountTotal,
                lossReasons: lossReasonBreakdown,
                lossStages: lossStageBreakdown,
                recoveredCount,
                churnMonth1,
                churnMonth2,
            });
        }

        result.sort((a, b) => b.bookingsProcessed - a.bookingsProcessed);

        return res.json({ success: true, period: { from, to }, managers: result });
    } catch (error) {
        console.error('Analytics managers error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка сбора аналитики по менеджерам' });
    }
});

// ============================================================
// GET /api/analytics/admins
// ============================================================
router.get('/admins', authenticate, requireAdmin, async (req, res) => {
    try {
        const { from, to } = parsePeriod(req);
        const [admins, dailyArchive] = await Promise.all([
            prisma.student.findMany({
                where: { role: { in: ['admin', 'super_admin'] }, status: 'active' },
                select: { id: true, name: true, lastName: true, middleName: true, phone: true, role: true },
            }),
            getDailyReportArchive(
                analyticsDayKey(from),
                analyticsDayKey(to),
                { limit: 120 },
            ),
        ]);

        const perUserChurn = await computePerUserChurn({ from, to });

        const result = [];
        for (const a of admins) {
            const trialsHandled = await prisma.booking.count({
                where: {
                    processedById: a.id,
                    processedAt: { gte: from, lte: to },
                    requestType: 'trial',
                    convertedToStudentId: { not: null },
                },
            });

            // Все их созданные абонементы в периоде
            const theirMems = await prisma.membership.findMany({
                where: {
                    createdById: a.id,
                    createdAt: { gte: from, lte: to },
                    type: { not: 'trial' },
                },
                select: { id: true, studentId: true, source: true, startDate: true },
            });
            const membershipsSold = theirMems.length;
            const renewals = theirMems.filter(m => m.source === 'renewal').length;

            const theirTrialBookings = await prisma.booking.findMany({
                where: {
                    processedById: a.id,
                    processedAt: { gte: from, lte: to },
                    requestType: 'trial',
                    convertedToStudentId: { not: null },
                },
                select: { convertedToStudentId: true, trialScheduledAt: true, convertedAt: true, createdAt: true },
            });
            const theirTrialStudentIds = theirTrialBookings.map(b => b.convertedToStudentId).filter(Boolean);
            const trialPayments = theirTrialStudentIds.length ? await prisma.payment.findMany({
                where: {
                    studentId: { in: theirTrialStudentIds },
                    status: 'completed',
                    amount: { gt: 0 },
                    type: { in: FIRST_SALE_PAYMENT_TYPES },
                },
                select: { studentId: true, paymentDate: true },
            }) : [];
            const trialPaymentsByStudent = groupByStudent(trialPayments);
            const closedTrialStudentIds = new Set();
            for (const booking of theirTrialBookings) {
                const sid = booking.convertedToStudentId;
                if (!sid) continue;
                const anchor = new Date(booking.trialScheduledAt || booking.convertedAt || booking.createdAt);
                const hasPayment = (trialPaymentsByStudent[sid] || []).some(payment => new Date(payment.paymentDate) >= anchor);
                if (hasPayment) {
                    closedTrialStudentIds.add(sid);
                }
            }

            // churn new vs existing clients:
            // new — у ученика ДО этого абонемента не было non-trial memberships (первый абонемент через этого админа)
            // existing — были раньше
            let newClientsCount = 0, existingClientsCount = 0;
            let newChurn = 0, existingChurn = 0;
            const now = new Date();
            for (const m of theirMems) {
                const priorMems = await prisma.membership.count({
                    where: {
                        studentId: m.studentId,
                        type: { not: 'trial' },
                        startDate: { lt: m.startDate },
                    },
                });
                const isNewClient = priorMems === 0;
                if (isNewClient) newClientsCount++; else existingClientsCount++;

                // "Отток" по этому клиенту: нет следующего non-trial mem и endDate < now - 14 дней
                const nextMems = await prisma.membership.count({
                    where: {
                        studentId: m.studentId,
                        type: { not: 'trial' },
                        startDate: { gt: m.startDate },
                    },
                });
                if (nextMems === 0) {
                    const ms = await prisma.membership.findUnique({
                        where: { id: m.id },
                        select: { endDate: true },
                    });
                    const e = ms?.endDate ? new Date(ms.endDate) : null;
                    if (e && (now.getTime() - e.getTime() > 14 * MS_PER_DAY)) {
                        if (isNewClient) newChurn++; else existingChurn++;
                    }
                }
            }

            // Phase 2: возражения/потери по его заявкам
            const lostBookings = await prisma.booking.findMany({
                where: {
                    processedById: a.id,
                    OR: [
                        { lostAt: { gte: from, lte: to } },
                        { lostAt: null, status: 'rejected', updatedAt: { gte: from, lte: to } },
                    ],
                },
                select: {
                    id: true, status: true, lossReason: true, lossStage: true,
                    appStatus: true, convertedToStudentId: true, trialScheduledAt: true, convertedAt: true, createdAt: true,
                },
            });
            const lossReasonBreakdown = {};
            const lossStageBreakdown = {};
            for (const b of lostBookings) {
                if (b.lossReason) lossReasonBreakdown[b.lossReason] = (lossReasonBreakdown[b.lossReason] || 0) + 1;
                const stage = await normalizeBookingLossStage(prisma, b);
                lossStageBreakdown[stage] = (lossStageBreakdown[stage] || 0) + 1;
            }

            const recoveredCount = await prisma.studentRecovery.count({
                where: {
                    recoveredByUserId: a.id,
                    recoveredAt: { gte: from, lte: to },
                },
            });

            const userChurn = perUserChurn.get(a.id) || { m1: { total: 0, churn: 0 }, m2: { total: 0, churn: 0 } };
            const churnMonth1 = {
                total: userChurn.m1.total,
                churned: userChurn.m1.churn,
                percent: percent(userChurn.m1.churn, userChurn.m1.total),
            };
            const churnMonth2 = {
                total: userChurn.m2.total,
                churned: userChurn.m2.churn,
                percent: percent(userChurn.m2.churn, userChurn.m2.total),
            };

            result.push({
                id: a.id,
                role: a.role,
                name: formatAnalyticsFio(a),
                trialsHandled,
                membershipsSold,
                renewals,
                churnNewClients: { count: newChurn, total: newClientsCount, percent: percent(newChurn, newClientsCount) },
                churnExistingClients: { count: existingChurn, total: existingClientsCount, percent: percent(existingChurn, existingClientsCount) },
                lostCount: lostBookings.length,
                lossReasons: lossReasonBreakdown,
                lossStages: lossStageBreakdown,
                recoveredCount,
                churnMonth1,
                churnMonth2,
            });
        }

        result.sort((a, b) => b.membershipsSold - a.membershipsSold);
        const dailyKpiByAdmin = new Map(
            (dailyArchive.summary.staff || []).map(row => [row.adminId, row]),
        );
        for (const admin of result) {
            admin.dailyKpi = dailyKpiByAdmin.get(admin.id) || {
                adminId: admin.id,
                adminName: admin.name,
                role: admin.role,
                reportDays: dailyArchive.summary.reportDays,
                activeDays: 0,
                activityCount: 0,
                bookingsProcessed: 0,
                lessonsReviewed: 0,
                paymentsProcessed: 0,
                paymentAmount: 0,
                remindersSent: 0,
                completedActions: 0,
                averageActionsPerReportDay: 0,
            };
        }

        return res.json({
            success: true,
            period: { from, to },
            admins: result,
            teamKpi: dailyArchive.summary,
            dailyReports: dailyArchive.reports,
            totalDailyReports: dailyArchive.totalReports,
        });
    } catch (error) {
        console.error('Analytics admins error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка сбора аналитики по админам' });
    }
});

// ============================================================
// GET /api/analytics/losses
// Сводка возражений/потерь за период: топ причин, распределение по этапам,
// последние возвраты.
// ============================================================
router.get('/losses', authenticate, requireAdmin, async (req, res) => {
    try {
        const { from, to } = parsePeriod(req);

        const lostBookings = await prisma.booking.findMany({
            where: {
                OR: [
                    { lostAt: { gte: from, lte: to } },
                    { lostAt: null, status: 'rejected', updatedAt: { gte: from, lte: to } },
                ],
            },
            select: {
                id: true,
                name: true,
                lastName: true,
                phone: true,
                status: true,
                appStatus: true,
                convertedToStudentId: true,
                trialScheduledAt: true,
                convertedAt: true,
                createdAt: true,
                lossReason: true,
                lossStage: true,
                lostAt: true,
                updatedAt: true,
                processedBy: { select: { id: true, name: true, lastName: true, middleName: true } },
            },
            orderBy: [{ lostAt: 'desc' }, { updatedAt: 'desc' }],
        });
        const departedStudents = await prisma.student.findMany({
            where: {
                role: 'student',
                status: 'inactive',
                lostAt: { gte: from, lte: to },
            },
            select: {
                id: true,
                name: true,
                lastName: true,
                middleName: true,
                phone: true,
                lostReason: true,
                lostAt: true,
                lostMarkedBy: { select: { name: true, lastName: true, middleName: true } },
            },
            orderBy: { lostAt: 'desc' },
        });

        const byReason = {};
        const byStage = {};
        for (const b of lostBookings) {
            const reason = b.lossReason || '—';
            const stage = await normalizeBookingLossStage(prisma, b);
            b.normalizedLossStage = stage;
            byReason[reason] = (byReason[reason] || 0) + 1;
            byStage[stage] = (byStage[stage] || 0) + 1;
        }
        for (const student of departedStudents) {
            const reason = DEPARTURE_REASONS[student.lostReason] || student.lostReason || '—';
            byReason[reason] = (byReason[reason] || 0) + 1;
            byStage.during_training = (byStage.during_training || 0) + 1;
        }

        const recoveries = await prisma.studentRecovery.findMany({
            where: { recoveredAt: { gte: from, lte: to } },
            orderBy: { recoveredAt: 'desc' },
            take: 100,
            include: {
                student: { select: { id: true, name: true, lastName: true, middleName: true, phone: true } },
                recoveredByUser: { select: { id: true, name: true, lastName: true, middleName: true, role: true } },
            },
        });

        const recoveriesByUser = {};
        for (const r of recoveries) {
            const uid = r.recoveredByUserId;
            if (!recoveriesByUser[uid]) {
                recoveriesByUser[uid] = {
                    userId: uid,
                    name: formatAnalyticsFio(r.recoveredByUser),
                    role: r.recoveredByUser?.role || null,
                    count: 0,
                };
            }
            recoveriesByUser[uid].count += 1;
        }

        return res.json({
            success: true,
            period: { from, to },
            totals: {
                lostCount: lostBookings.length + departedStudents.length,
                departedStudentsCount: departedStudents.length,
                recoveredCount: recoveries.length,
                afterTrialLostCount: lostBookings.filter(item => item.normalizedLossStage === 'after_trial').length,
            },
            byReason,
            byStage,
            recentLosses: [
                ...lostBookings.map(item => ({
                id: item.id,
                name: formatAnalyticsFio(item),
                phone: item.phone || null,
                reason: item.lossReason || '—',
                stage: item.normalizedLossStage || '—',
                lostAt: item.lostAt || item.updatedAt,
                processedByName: formatAnalyticsFio(item.processedBy),
                })),
                ...departedStudents.map(item => ({
                    id: item.id,
                    studentId: item.id,
                    name: formatAnalyticsFio(item),
                    phone: item.phone || null,
                    reason: DEPARTURE_REASONS[item.lostReason] || item.lostReason || '—',
                    stage: 'during_training',
                    lostAt: item.lostAt,
                    processedByName: formatAnalyticsFio(item.lostMarkedBy),
                })),
            ].sort((a, b) => new Date(b.lostAt) - new Date(a.lostAt)).slice(0, 30),
            recoveriesByUser: Object.values(recoveriesByUser).sort((a, b) => b.count - a.count),
            recentRecoveries: recoveries.slice(0, 30).map(r => ({
                id: r.id,
                studentId: r.studentId,
                studentName: formatAnalyticsFio(r.student),
                phone: r.student?.phone || null,
                note: r.note || null,
                recoveredAt: r.recoveredAt,
                recoveredByName: formatAnalyticsFio(r.recoveredByUser),
            })),
        });
    } catch (error) {
        console.error('Analytics losses error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка сбора аналитики потерь' });
    }
});

// ============================================================
// GET /api/analytics/teacher-revenue
// Сколько денег принёс каждый тренер за период.
// Логика:
// 1. Берём подтверждённые занятия (Class.status = completed) в периоде [from, to], где teacherId != null.
// 2. Для каждого занятия берём attendees с attended: true.
// 3. Для каждого ученика находим активный абонемент (Membership).
// 4. Стоимость одного занятия = membership.totalPrice / membership.totalClasses.
// 5. Сумма = perClassCost * кол-во занятий ученика с этим тренером в периоде.
// 6. Суммируем по всем ученикам для каждого тренера.
// ============================================================
router.get('/teacher-revenue', authenticate, requireAdmin, async (req, res) => {
    try {
        const { from, to } = parsePeriod(req);

        // 1. Все занятия за период где есть тренер
        const classes = await prisma.class.findMany({
            where: {
                date: { gte: from, lte: to },
                teacherId: { not: null },
                status: 'completed',
            },
            select: {
                id: true,
                teacherId: true,
                date: true,
                title: true,
                groupId: true,
                attendees: {
                    where: { attended: true },
                    select: { studentId: true },
                },
            },
        });

        // 2. Собираем уникальных студентов по всем занятиям
        const allStudentIds = new Set();
        for (const cls of classes) {
            for (const att of cls.attendees) {
                if (att.studentId) allStudentIds.add(att.studentId);
            }
        }

        // 3. Загружаем все активные и завершённые абонементы этих учеников
        //    (ищем абонемент, актуальный на момент занятия — берём последний по дате начала до занятия)
        const studentIds = Array.from(allStudentIds);
        const allMemberships = studentIds.length > 0 ? await prisma.membership.findMany({
            where: {
                studentId: { in: studentIds },
                type: { not: 'trial' },
                totalClasses: { gt: 0 },
                totalPrice: { gt: 0 },
            },
            select: {
                id: true,
                studentId: true,
                groupId: true,
                totalPrice: true,
                totalClasses: true,
                startDate: true,
                endDate: true,
                status: true,
            },
            orderBy: { startDate: 'desc' },
        }) : [];

        // Индекс: studentId -> список мемберов (отсортированы по startDate desc)
        const memsByStudent = {};
        for (const m of allMemberships) {
            if (!memsByStudent[m.studentId]) memsByStudent[m.studentId] = [];
            memsByStudent[m.studentId].push(m);
        }

        // Подбор абонемента для ученика на дату занятия
        // Приоритет: 1) group-specific абонемент 2) общий (groupId: null)
        function findMembership(studentId, classDate, groupId) {
            const list = memsByStudent[studentId] || [];
            // 1. Абонемент на конкретную группу, покрывающий дату
            if (groupId) {
                const groupMem = list.find(m =>
                    m.groupId === groupId &&
                    new Date(m.startDate) <= classDate &&
                    new Date(m.endDate) >= classDate
                );
                if (groupMem) return groupMem;
            }
            // 2. Общий абонемент (без группы), покрывающий дату
            const generalMem = list.find(m =>
                !m.groupId &&
                new Date(m.startDate) <= classDate &&
                new Date(m.endDate) >= classDate
            );
            if (generalMem) return generalMem;
            // 3. Фоллбэк: любой абонемент покрывающий дату
            const anyMem = list.find(m =>
                new Date(m.startDate) <= classDate &&
                new Date(m.endDate) >= classDate
            );
            return anyMem || null;
        }

        // 4. Считаем выручку по тренерам
        // Структура: teacherId -> { total, students: { studentId -> { name, classes, revenue } } }
        const teacherRevenue = {};

        for (const cls of classes) {
            const tid = cls.teacherId;
            if (!teacherRevenue[tid]) {
                teacherRevenue[tid] = { totalRevenue: 0, totalClasses: 0, studentDetails: {} };
            }
            teacherRevenue[tid].totalClasses++;

            for (const att of cls.attendees) {
                const sid = att.studentId;
                if (!sid) continue;

                const membership = findMembership(sid, new Date(cls.date), cls.groupId);
                if (!membership) continue;

                const perClassCost = Math.round(membership.totalPrice / membership.totalClasses);

                teacherRevenue[tid].totalRevenue += perClassCost;

                if (!teacherRevenue[tid].studentDetails[sid]) {
                    teacherRevenue[tid].studentDetails[sid] = { classCount: 0, revenue: 0, membershipId: membership.id };
                }
                teacherRevenue[tid].studentDetails[sid].classCount++;
                teacherRevenue[tid].studentDetails[sid].revenue += perClassCost;
            }
        }

        // 5. Загружаем имена тренеров
        const teacherIds = Object.keys(teacherRevenue);
        const teachers = teacherIds.length > 0 ? await prisma.student.findMany({
            where: { id: { in: teacherIds } },
            select: { id: true, name: true, lastName: true, middleName: true },
        }) : [];
        const teacherMap = {};
        for (const t of teachers) {
            teacherMap[t.id] = formatAnalyticsFio(t);
        }

        // 6. Загружаем имена учеников для деталей
        const allDetailStudentIds = new Set();
        for (const data of Object.values(teacherRevenue)) {
            for (const sid of Object.keys(data.studentDetails)) {
                allDetailStudentIds.add(sid);
            }
        }
        const detailStudents = allDetailStudentIds.size > 0 ? await prisma.student.findMany({
            where: { id: { in: Array.from(allDetailStudentIds) } },
            select: { id: true, name: true, lastName: true, middleName: true },
        }) : [];
        const studentMap = {};
        for (const s of detailStudents) {
            studentMap[s.id] = formatAnalyticsFio(s);
        }

        // 7. Формируем ответ
        const result = teacherIds.map(tid => {
            const data = teacherRevenue[tid];
            const students = Object.entries(data.studentDetails)
                .map(([sid, info]) => ({
                    id: sid,
                    name: studentMap[sid] || '—',
                    classCount: info.classCount,
                    revenue: info.revenue,
                }))
                .sort((a, b) => b.revenue - a.revenue);

            return {
                id: tid,
                name: teacherMap[tid] || '—',
                totalRevenue: data.totalRevenue,
                totalClasses: data.totalClasses,
                studentsCount: students.length,
                students,
            };
        }).sort((a, b) => b.totalRevenue - a.totalRevenue);

        const grandTotal = result.reduce((sum, t) => sum + t.totalRevenue, 0);

        return res.json({
            success: true,
            period: { from, to },
            grandTotal,
            teachers: result,
        });
    } catch (error) {
        console.error('Analytics teacher-revenue error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка сбора аналитики доходов по тренерам' });
    }
});

// ============================================================
// GET /api/analytics/utilization
// Загруженность преподавателей и кабинетов по расписанию.
// ============================================================
router.get('/utilization', authenticate, requireAdmin, async (req, res) => {
    try {
        await ensureTeacherScheduleColors();
        const { from, to } = parsePeriod(req);
        const periodDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / MS_PER_DAY));
        const periodWeeks = periodDays / 7;

        const [teachers, rooms, classes] = await Promise.all([
            prisma.student.findMany({
                where: { role: 'teacher', status: 'active' },
                select: {
                    id: true,
                    name: true,
                    lastName: true,
                    teacherScheduleColor: true,
                    teacherWeeklyHours: true,
                },
                orderBy: [{ name: 'asc' }, { lastName: 'asc' }],
            }),
            prisma.room.findMany({
                where: { isActive: true },
                select: {
                    id: true,
                    name: true,
                    workingStart: true,
                    workingEnd: true,
                },
                orderBy: { name: 'asc' },
            }),
            prisma.class.findMany({
                where: { date: { gte: from, lte: to } },
                select: {
                    teacherId: true,
                    roomId: true,
                    startTime: true,
                    endTime: true,
                    duration: true,
                    status: true,
                    isPractice: true,
                },
            }),
        ]);

        const classMinutes = (item) => {
            const fromTime = timeToMinutes(item.startTime);
            const toTime = timeToMinutes(item.endTime);
            const calculated = toTime > fromTime ? toTime - fromTime : 0;
            return calculated || Math.max(0, Number(item.duration) || 0);
        };

        const teacherUtilization = teachers.map((teacher) => {
            const rows = classes.filter((item) => item.teacherId === teacher.id);
            const scheduledMinutes = rows
                .filter((item) => item.status !== 'cancelled')
                .reduce((sum, item) => sum + classMinutes(item), 0);
            const completedMinutes = rows
                .filter((item) => item.status === 'completed')
                .reduce((sum, item) => sum + classMinutes(item), 0);
            const cancelledMinutes = rows
                .filter((item) => item.status === 'cancelled')
                .reduce((sum, item) => sum + classMinutes(item), 0);
            const weeklyNormHours = teacher.teacherWeeklyHours || 40;
            const periodNormMinutes = weeklyNormHours * periodWeeks * 60;

            return {
                id: teacher.id,
                name: `${teacher.name} ${teacher.lastName || ''}`.trim(),
                color: teacher.teacherScheduleColor || '#6B7280',
                weeklyNormHours,
                periodNormHours: Math.round((periodNormMinutes / 60) * 10) / 10,
                scheduledHours: Math.round((scheduledMinutes / 60) * 10) / 10,
                completedHours: Math.round((completedMinutes / 60) * 10) / 10,
                cancelledHours: Math.round((cancelledMinutes / 60) * 10) / 10,
                utilizationPercent: periodNormMinutes > 0
                    ? Math.round((scheduledMinutes / periodNormMinutes) * 100)
                    : 0,
            };
        }).sort((a, b) => b.utilizationPercent - a.utilizationPercent);

        const roomUtilization = rooms.map((room) => {
            const startMinutes = timeToMinutes(room.workingStart || '08:00');
            const endMinutes = timeToMinutes(room.workingEnd || '22:00');
            const availableMinutes = Math.max(0, endMinutes - startMinutes) * periodDays;
            const occupiedMinutes = classes
                .filter((item) => item.roomId === room.id && item.status !== 'cancelled')
                .reduce((sum, item) => sum + classMinutes(item), 0);
            const freeMinutes = Math.max(0, availableMinutes - occupiedMinutes);

            return {
                id: room.id,
                name: room.name,
                workingStart: room.workingStart || '08:00',
                workingEnd: room.workingEnd || '22:00',
                availableHours: Math.round((availableMinutes / 60) * 10) / 10,
                occupiedHours: Math.round((occupiedMinutes / 60) * 10) / 10,
                freeHours: Math.round((freeMinutes / 60) * 10) / 10,
                utilizationPercent: availableMinutes > 0
                    ? Math.min(100, Math.round((occupiedMinutes / availableMinutes) * 100))
                    : 0,
            };
        }).sort((a, b) => b.utilizationPercent - a.utilizationPercent);

        return res.json({
            success: true,
            period: { from, to, days: periodDays },
            teachers: teacherUtilization,
            rooms: roomUtilization,
        });
    } catch (error) {
        console.error('Analytics utilization error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка расчёта загрузки расписания' });
    }
});

// ============================================================
// GET /api/analytics/marketing
// ============================================================
router.get('/marketing', authenticate, requireAdmin, async (req, res) => {
    try {
        const { from, to } = parsePeriod(req);

        const [events, bookings, firstPaymentSales, trialAnalytics] = await Promise.all([
            prisma.marketingEvent.findMany({
                where: { createdAt: { gte: from, lte: to } },
                select: {
                    eventName: true,
                    clientId: true,
                    sessionId: true,
                    source: true,
                    medium: true,
                    campaign: true,
                    content: true,
                    term: true,
                    createdAt: true,
                },
                orderBy: { createdAt: 'asc' },
            }),
            prisma.booking.findMany({
                where: {
                    createdAt: { gte: from, lte: to },
                    OR: [
                        { createdBy: 'website' },
                        { marketingClientId: { not: null } },
                        // Заявки из приложения тоже являются рекламными
                        // лидами, даже если у них пока нет UTM-сессии.
                        { requestType: 'trial' },
                    ],
                },
                select: {
                    id: true,
                    name: true,
                    lastName: true,
                    phone: true,
                    source: true,
                    status: true,
                    requestType: true,
                    createdAt: true,
                    convertedAt: true,
                    marketingClientId: true,
                    marketingSessionId: true,
                    attribution: true,
                    convertedToStudentId: true,
                },
                orderBy: { createdAt: 'desc' },
            }),
            getFirstConfirmedSalesByStudent(from, to),
            loadTrialAnalyticsForPeriod(from, to),
        ]);

        const totals = {
            events: events.length,
            pageViews: events.filter(event => event.eventName === 'page_view').length,
            ctaClicks: events.filter(event => event.eventName === 'cta_click').length,
            formViews: events.filter(event => event.eventName === 'booking_form_view').length,
            submitAttempts: events.filter(event => event.eventName === 'booking_submit_attempt').length,
            leads: bookings.length,
            sold: firstPaymentSales.length,
        };
        totals.visitors = new Set(events.map(event => event.clientId).filter(Boolean)).size;
        totals.sessions = new Set(events.map(event => event.sessionId).filter(Boolean)).size;
        totals.visitToLeadRate = percent(totals.leads, totals.visitors || totals.pageViews);
        totals.leadToSaleRate = percent(totals.sold, totals.leads);

        const sourceMap = new Map();
        const ensureRow = (item = {}) => {
            const attribution = item.attribution && typeof item.attribution === 'object' ? item.attribution : {};
            const normalized = {
                source: item.source || attribution.utm_source || attribution.source || null,
                medium: item.medium || attribution.utm_medium || attribution.medium || null,
                campaign: item.campaign || attribution.utm_campaign || attribution.campaign || null,
            };
            const key = marketingAttributionKey(normalized);
            if (!sourceMap.has(key)) {
                sourceMap.set(key, {
                    key,
                    label: marketingAttributionLabel(normalized),
                    source: normalized.source || 'direct',
                    medium: normalized.medium || 'none',
                    campaign: normalized.campaign || 'no_campaign',
                    visitors: new Set(),
                    sessions: new Set(),
                    pageViews: 0,
                    ctaClicks: 0,
                    formViews: 0,
                    submitAttempts: 0,
                    leads: 0,
                    sold: 0,
                });
            }
            return sourceMap.get(key);
        };

        for (const event of events) {
            const row = ensureRow(event);
            if (event.clientId) row.visitors.add(event.clientId);
            if (event.sessionId) row.sessions.add(event.sessionId);
            if (event.eventName === 'page_view') row.pageViews += 1;
            if (event.eventName === 'cta_click') row.ctaClicks += 1;
            if (event.eventName === 'booking_form_view') row.formViews += 1;
            if (event.eventName === 'booking_submit_attempt') row.submitAttempts += 1;
        }

        for (const booking of bookings) {
            const row = ensureRow({
                source: booking.source,
                attribution: booking.attribution,
            });
            row.leads += 1;
            if (booking.marketingClientId) row.visitors.add(booking.marketingClientId);
            if (booking.marketingSessionId) row.sessions.add(booking.marketingSessionId);
        }

        const bookingById = new Map(bookings.map(booking => [booking.id, booking]));
        const bookingByStudentId = new Map(
            bookings
                .filter(booking => booking.convertedToStudentId)
                .map(booking => [booking.convertedToStudentId, booking])
        );
        for (const payment of firstPaymentSales) {
            const saleBooking = payment.booking
                || (payment.bookingId ? bookingById.get(payment.bookingId) : null)
                || bookingByStudentId.get(payment.studentId);
            const row = ensureRow({
                source: saleBooking?.source,
                attribution: saleBooking?.attribution,
            });
            row.sold += 1;
            if (saleBooking?.marketingClientId) row.visitors.add(saleBooking.marketingClientId);
            if (saleBooking?.marketingSessionId) row.sessions.add(saleBooking.marketingSessionId);
        }

        const sources = Array.from(sourceMap.values())
            .map(row => ({
                ...row,
                visitors: row.visitors.size,
                sessions: row.sessions.size,
                visitToLeadRate: percent(row.leads, row.visitors.size || row.pageViews),
                leadToSaleRate: percent(row.sold, row.leads),
            }))
            .sort((a, b) => b.leads - a.leads || b.visitors - a.visitors);

        const funnel = [
            { name: 'Визиты', value: totals.visitors || totals.pageViews },
            { name: 'Клики CTA', value: totals.ctaClicks },
            { name: 'Просмотр формы', value: totals.formViews },
            { name: 'Попытки отправки', value: totals.submitAttempts },
            { name: 'Заявки', value: totals.leads },
            { name: 'Продажи', value: totals.sold },
        ];

        res.json({
            success: true,
            period: { from, to },
            totals,
            funnel,
            trialAnalytics,
            sources,
            recentLeads: bookings.slice(0, 20).map(booking => ({
                id: booking.id,
                name: formatAnalyticsFio(booking),
                phone: booking.phone,
                source: booking.source,
                status: booking.status,
                createdAt: booking.createdAt,
                campaign: booking.attribution?.utm_campaign || booking.attribution?.campaign || '',
            })),
        });
    } catch (error) {
        console.error('Analytics marketing error:', error);
        res.status(500).json({ success: false, error: 'Ошибка маркетинговой аналитики' });
    }
});

// ============================================================
// GET /api/analytics/student-profitability
// Рентабельность учеников за период (Выручка - Себестоимость уроков)
// ============================================================
router.get('/student-profitability', authenticate, requireAdmin, async (req, res) => {
    try {
        const { from, to } = parsePeriod(req);
        const { getTeacherRate } = require('../services/salaryPolicy');

        // 1. Получаем все выполненные платежи за период
        const payments = await prisma.payment.findMany({
            where: {
                status: 'completed',
                paymentDate: { gte: from, lte: to }
            },
            select: {
                studentId: true,
                amount: true
            }
        });

        // 2. Группируем выручку по ученикам
        const revenueByStudent = {};
        const studentIdsWithActivity = new Set();

        for (const p of payments) {
            revenueByStudent[p.studentId] = (revenueByStudent[p.studentId] || 0) + p.amount;
            studentIdsWithActivity.add(p.studentId);
        }

        // 3. Получаем все проведённые уроки за период с тренерами и посещаемостью
        const classes = await prisma.class.findMany({
            where: {
                status: 'completed',
                date: { gte: from, lte: to },
                teacherId: { not: null }
            },
            select: {
                id: true,
                classType: true,
                isPractice: true,
                teacher: {
                    select: {
                        id: true,
                        salaryIndividual: true,
                        salaryGroup: true,
                        salaryTrial: true,
                        salaryOther: true
                    }
                },
                attendees: {
                    where: {
                        OR: [
                            { attended: true },
                            { chargeAmount: { gt: 0 } }
                        ]
                    },
                    select: {
                        studentId: true
                    }
                }
            }
        });

        // 4. Считаем себестоимость занятий на каждого ученика
        const costByStudent = {};

        for (const cls of classes) {
            if (!cls.teacher || !cls.attendees.length) continue;
            
            // Ставка тренера за этот урок
            const teacherRate = getTeacherRate(cls.teacher, cls);
            if (teacherRate <= 0) continue;

            // Доля каждого ученика в себестоимости этого занятия
            const perStudentCost = teacherRate / cls.attendees.length;

            for (const att of cls.attendees) {
                if (!att.studentId) continue;
                costByStudent[att.studentId] = (costByStudent[att.studentId] || 0) + perStudentCost;
                studentIdsWithActivity.add(att.studentId);
            }
        }

        // 5. Загружаем информацию по всем активным ученикам
        const studentIdsArray = Array.from(studentIdsWithActivity);
        const students = studentIdsArray.length > 0
            ? await prisma.student.findMany({
                where: { id: { in: studentIdsArray } },
                select: { id: true, name: true, lastName: true, middleName: true, phone: true }
            })
            : [];

        // 6. Формируем итоговую рентабельность
        const report = students.map(student => {
            const revenue = Math.round(revenueByStudent[student.id] || 0);
            const cost = Math.round(costByStudent[student.id] || 0);
            const profit = revenue - cost;

            return {
                id: student.id,
                name: `${student.name} ${student.lastName || ''}`.trim() || '—',
                phone: student.phone || '—',
                revenue,
                cost,
                profit
            };
        }).sort((a, b) => b.profit - a.profit); // Сортируем от самых прибыльных к убыточным

        const grandTotalRevenue = report.reduce((sum, s) => sum + s.revenue, 0);
        const grandTotalCost = report.reduce((sum, s) => sum + s.cost, 0);
        const grandTotalProfit = grandTotalRevenue - grandTotalCost;

        res.json({
            success: true,
            period: { from, to },
            grandTotals: {
                revenue: grandTotalRevenue,
                cost: grandTotalCost,
                profit: grandTotalProfit
            },
            students: report
        });
    } catch (error) {
        console.error('Analytics student-profitability error:', error);
        res.status(500).json({ success: false, error: 'Ошибка расчёта рентабельности учеников' });
    }
});

module.exports = router;
