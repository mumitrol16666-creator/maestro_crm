const { prisma } = require('../config/db');
const axios = require('axios');
const {
    sendTelegramNotification,
    formatBookingMessage,
    formatLessonPendingReviewMessage,
    formatLessonApprovedMessage,
    formatEveningReportMessage
} = require('../utils/telegram');

/**
 * Нейтральный слой уведомлений. Telegram — один из каналов.
 * Не бросает исключения — сбой уведомления не ломает бизнес-операцию.
 */
async function notify(eventType, payload = {}) {
    try {
        let message = null;

        switch (eventType) {
            case 'booking.created':
                message = formatBookingMessage(payload.booking);
                break;
            case 'lesson.pending_review':
                message = formatLessonPendingReviewMessage(payload.classRecord);
                break;
            case 'lesson.approved':
                message = formatLessonApprovedMessage(payload.classRecord, payload.deductions);
                break;
            case 'report.evening':
                message = formatEveningReportMessage(payload.stats);
                break;
            default:
                console.warn(`[notify] Unknown event: ${eventType}`);
                return false;
        }

        if (!message) return false;

        return await sendTelegramNotification(message);
    } catch (error) {
        console.error(`[notify] ${eventType} failed:`, error.message);
        return false;
    }
}

const REPORT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function getReportDayRange(date = new Date()) {
    const reportDate = new Date(date.getTime() + REPORT_OFFSET_MS).toISOString().slice(0, 10);
    const start = new Date(new Date(`${reportDate}T00:00:00.000Z`).getTime() - REPORT_OFFSET_MS);
    const end = new Date(start.getTime() + DAY_MS);
    return { reportDate, start, end };
}

function sumAmounts(items, amountSelector = item => item.amount || 0) {
    return items.reduce((sum, item) => sum + (amountSelector(item) || 0), 0);
}

function effectiveCashAmount(tx) {
    if (tx.category === 'payment' && tx.relatedPayment) return tx.relatedPayment.amount || 0;
    return tx.amount || 0;
}

function isTechnicalCashCategory(category) {
    return ['correction', 'balance_adjustment'].includes(category);
}

function groupAmountBy(items, keySelector, amountSelector = item => item.amount || 0) {
    return items.reduce((acc, item) => {
        const key = keySelector(item) || 'Не указано';
        acc[key] = (acc[key] || 0) + (amountSelector(item) || 0);
        return acc;
    }, {});
}

function topCountBy(items, keySelector, limit = 5) {
    const counts = items.reduce((acc, item) => {
        const key = keySelector(item) || 'Не указано';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([label, count]) => ({ label, count }));
}

function pickReportAdmin(payments, activityLogs) {
    const paymentManagers = topCountBy(payments.filter(payment => payment.managerName), payment => payment.managerName, 1);
    if (paymentManagers[0]) return paymentManagers[0].label;

    const activeAdmins = topCountBy(
        activityLogs.filter(log => log.user),
        log => [log.user.name, log.user.lastName].filter(Boolean).join(' '),
        1
    );
    return activeAdmins[0]?.label || 'Система';
}

function buildFallbackAiComment(stats) {
    const alerts = [];
    if (stats.lessons.notFilled > 0) alerts.push(`проверить ${stats.lessons.notFilled} незаполненных уроков`);
    if (stats.lessons.pendingReview > 0) alerts.push(`подтвердить ${stats.lessons.pendingReview} отчётов преподавателей`);
    if (stats.bookings.rejected > 0) alerts.push(`разобрать ${stats.bookings.rejected} отказов`);
    if (stats.tomorrow.plannedPaymentsCount > 0) {
        alerts.push(`заранее напомнить о ${stats.tomorrow.plannedPaymentsCount} запланированных оплатах`);
    }
    if (!alerts.length) alerts.push('удержать темп и проверить расписание на завтра');
    return `Фокус на завтра: ${alerts.join('; ')}.`;
}

async function generateEveningReportAiComment(stats) {
    if (process.env.EVENING_REPORT_AI_ENABLED !== 'true') return null;
    if (!process.env.OPENAI_API_KEY || !process.env.EVENING_REPORT_AI_MODEL) return null;

    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: process.env.EVENING_REPORT_AI_MODEL,
            temperature: 0.35,
            max_tokens: 220,
            messages: [
                {
                    role: 'system',
                    content: [
                        'Ты операционный ассистент музыкальной школы Maestro.',
                        'По дневной CRM-статистике напиши короткий управленческий комментарий на русском.',
                        'Стиль: спокойно, конкретно, без воды. 2-4 коротких предложения.',
                        'Не используй Markdown, HTML-теги, эмодзи и списки.'
                    ].join(' ')
                },
                {
                    role: 'user',
                    content: JSON.stringify({
                        date: stats.date,
                        lessons: stats.lessons,
                        trials: stats.trials,
                        bookings: stats.bookings,
                        finance: stats.finance,
                        tomorrow: stats.tomorrow,
                        students: stats.students
                    })
                }
            ]
        }, {
            timeout: Number(process.env.EVENING_REPORT_AI_TIMEOUT_MS || 12000),
            headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data?.choices?.[0]?.message?.content?.trim() || null;
    } catch (error) {
        console.warn('[evening-report-ai] failed:', error.response?.status || error.message);
        return null;
    }
}

async function buildEveningReportStats(now = new Date()) {
    const today = getReportDayRange(now);
    const tomorrow = getReportDayRange(new Date(today.end.getTime() + REPORT_OFFSET_MS));

    const [
        classesToday,
        pendingReview,
        bookingsToday,
        rejectedBookings,
        paymentsToday,
        paymentsTomorrow,
        cashToday,
        cashUntilTodayEnd,
        activeStudents,
        newStudents,
        pausedStudents,
        activityLogs
    ] = await Promise.all([
        prisma.class.findMany({
            where: { date: { gte: today.start, lt: today.end }, isPractice: false },
            select: { id: true, status: true, classType: true, title: true }
        }),
        prisma.class.count({
            where: { status: 'pending_admin_review', isPractice: false }
        }),
        prisma.booking.findMany({
            where: { createdAt: { gte: today.start, lt: today.end } },
            select: { id: true, status: true, source: true, direction: true, lossReason: true }
        }),
        prisma.booking.findMany({
            where: {
                status: 'rejected',
                OR: [
                    { lostAt: { gte: today.start, lt: today.end } },
                    { lostAt: null, updatedAt: { gte: today.start, lt: today.end } }
                ]
            },
            select: { id: true, lossReason: true, direction: true }
        }),
        prisma.payment.findMany({
            where: { status: 'completed', paymentDate: { gte: today.start, lt: today.end } },
            select: { amount: true, type: true, paymentMethod: true, managerName: true }
        }),
        prisma.payment.findMany({
            where: { status: 'pending', dueDate: { gte: tomorrow.start, lt: tomorrow.end } },
            select: { amount: true, type: true, studentName: true }
        }),
        prisma.cashTransaction.findMany({
            where: { date: { gte: today.start, lt: today.end } },
            select: {
                type: true,
                amount: true,
                category: true,
                description: true,
                relatedPayment: { select: { amount: true, paymentMethod: true } }
            }
        }),
        prisma.cashTransaction.findMany({
            where: { date: { lt: today.end } },
            select: {
                type: true,
                amount: true,
                category: true,
                relatedPayment: { select: { amount: true, paymentMethod: true } }
            }
        }),
        prisma.student.count({ where: { role: 'student', status: 'active' } }),
        prisma.student.count({
            where: { role: 'student', registeredAt: { gte: today.start, lt: today.end } }
        }),
        prisma.student.count({
            where: {
                role: 'student',
                status: 'inactive',
                OR: [
                    { lostAt: { gte: today.start, lt: today.end } },
                    { lostAt: null, updatedAt: { gte: today.start, lt: today.end } }
                ]
            }
        }),
        prisma.activityLog.findMany({
            where: { createdAt: { gte: today.start, lt: today.end } },
            select: { user: { select: { name: true, lastName: true } } }
        })
    ]);

    const completedClasses = classesToday.filter(cls => cls.status === 'completed');
    const notFilledClasses = classesToday.filter(cls => cls.status === 'not_filled');
    const trialClasses = classesToday.filter(cls => cls.classType === 'trial');
    const trialCompleted = trialClasses.filter(cls => cls.status === 'completed');
    const membershipPaymentTypes = new Set(['membership_advance', 'membership_balance', 'membership_full']);
    const membershipPayments = paymentsToday.filter(payment => membershipPaymentTypes.has(payment.type));
    const paymentCashTransactions = cashToday.filter(tx => tx.category === 'payment' && tx.type === 'income');
    const manualIncome = cashToday.filter(tx =>
        tx.type === 'income' && tx.category !== 'payment' && tx.category !== 'refund' && !isTechnicalCashCategory(tx.category)
    );
    const realExpenses = cashToday.filter(tx =>
        tx.type === 'expense' && tx.category !== 'refund' && !isTechnicalCashCategory(tx.category)
    );
    const cashBalance = cashUntilTodayEnd.reduce((sum, tx) => {
        if (isTechnicalCashCategory(tx.category)) return sum;
        if (tx.relatedPayment && tx.relatedPayment.paymentMethod !== 'cash') return sum;
        const signedAmount = tx.type === 'income' ? effectiveCashAmount(tx) : -effectiveCashAmount(tx);
        return sum + signedAmount;
    }, 0);

    const stats = {
        date: today.reportDate,
        admin: pickReportAdmin(paymentsToday, activityLogs),
        lessons: {
            completed: completedClasses.length,
            pendingReview,
            notFilled: notFilledClasses.length
        },
        bookings: {
            newTotal: bookingsToday.length,
            newNonParentChats: bookingsToday.length,
            bySource: topCountBy(bookingsToday, booking => booking.source),
            rejected: rejectedBookings.length,
            rejectionReasons: topCountBy(rejectedBookings, booking => booking.lossReason || 'Причина не указана')
        },
        trials: {
            scheduled: trialClasses.length,
            completed: trialCompleted.length,
            pendingReview: trialClasses.filter(cls => cls.status === 'pending_admin_review').length,
            notFilled: trialClasses.filter(cls => cls.status === 'not_filled').length
        },
        finance: {
            membershipPaymentsCount: membershipPayments.length,
            revenue: sumAmounts(paymentsToday),
            revenueByMethod: groupAmountBy(paymentsToday, payment => payment.paymentMethod || 'Не указан'),
            educationCashboxRevenue: sumAmounts(paymentCashTransactions, effectiveCashAmount),
            otherIncome: sumAmounts(manualIncome, effectiveCashAmount),
            otherIncomeByCategory: groupAmountBy(manualIncome, tx => tx.category, effectiveCashAmount),
            expenses: sumAmounts(realExpenses, effectiveCashAmount),
            expensesByCategory: groupAmountBy(realExpenses, tx => tx.category, effectiveCashAmount),
            cashBalance,
            shopCashBalance: null
        },
        tomorrow: {
            plannedPaymentsCount: paymentsTomorrow.length,
            expectedRevenue: sumAmounts(paymentsTomorrow)
        },
        students: {
            active: activeStudents,
            new: newStudents,
            pausedOrLeft: pausedStudents
        }
    };

    stats.aiComment = await generateEveningReportAiComment(stats) || buildFallbackAiComment(stats);
    return stats;
}

/**
 * Собирает и отправляет дневной отчёт в Telegram.
 */
async function sendEveningReport(now = new Date()) {
    const stats = await buildEveningReportStats(now);
    const sent = await notify('report.evening', { stats });
    return { sent, stats };
}

/**
 * Вечерний отчёт за сегодня (вызывается из housekeeping cron).
 */
async function sendEveningReportIfConfigured() {
    const result = await sendEveningReport();
    return result.sent;
}

module.exports = { notify, sendEveningReportIfConfigured, buildEveningReportStats, sendEveningReport };
