const { prisma } = require('../config/db');
const axios = require('axios');
const {
    sendTelegramNotification,
    formatBookingMessage,
    formatLessonPendingReviewMessage,
    formatLessonApprovedMessage,
    formatEveningReportMessage
} = require('../utils/telegram');
const { enrichMembershipBalance } = require('../utils/membershipBalance');

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

function personName(person, fallback = 'Ученик') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function classSubject(cls) {
    return cls.group?.name
        || personName(cls.individualStudent, '')
        || cls.title
        || 'урок';
}

function buildTask(label, count, sample = null) {
    return {
        label,
        count,
        sample: sample || null
    };
}

function buildFallbackAiComment(stats) {
    const alerts = [];
    if (stats.lessons.notFilled > 0) alerts.push(`проверить ${stats.lessons.notFilled} незаполненных уроков`);
    if (stats.lessons.pendingReview > 0) alerts.push(`подтвердить ${stats.lessons.pendingReview} отчётов преподавателей`);
    if (stats.bookings.rejected > 0) alerts.push(`разобрать ${stats.bookings.rejected} отказов`);
    if (stats.tomorrow.plannedPaymentsCount > 0) {
        alerts.push(`заранее напомнить о ${stats.tomorrow.plannedPaymentsCount} запланированных оплатах`);
    }
    if (stats.attention?.total > 0) alerts.push(`закрыть ${stats.attention.total} задач, которые висят со вчера или раньше`);
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
                        students: stats.students,
                        attention: stats.attention
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
    const yesterday = getReportDayRange(new Date(today.start.getTime() - 1));

    const [
        classesToday,
        tomorrowClasses,
        overdueClassesCount,
        overdueClasses,
        pendingReview,
        oldPendingReviewCount,
        oldPendingReview,
        bookingsToday,
        whatsappConversationsToday,
        whatsappMessagesToday,
        whatsappUnansweredConversations,
        oldNewBookingsCount,
        oldNewBookings,
        rejectedBookings,
        paymentsToday,
        paymentsTomorrow,
        cashToday,
        cashUntilTodayEnd,
        activeStudents,
        newStudents,
        pausedStudents,
        debtStudentsCount,
        debtStudents,
        expiringMembershipCandidates,
        activityLogs
    ] = await Promise.all([
        prisma.class.findMany({
            where: { date: { gte: today.start, lt: today.end }, isPractice: false },
            select: { id: true, status: true, classType: true, title: true }
        }),
        prisma.class.findMany({
            where: {
                date: { gte: tomorrow.start, lt: tomorrow.end },
                isPractice: false,
                status: { not: 'cancelled' }
            },
            orderBy: [{ startTime: 'asc' }],
            select: { id: true, status: true, classType: true, title: true, startTime: true }
        }),
        prisma.class.count({
            where: {
                isPractice: false,
                status: { in: ['not_filled', 'scheduled', 'started'] },
                date: { lt: today.start }
            }
        }),
        prisma.class.findMany({
            where: {
                isPractice: false,
                status: { in: ['not_filled', 'scheduled', 'started'] },
                date: { lt: today.start }
            },
            orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
            take: 8,
            include: {
                teacher: { select: { name: true, lastName: true, middleName: true } },
                group: { select: { name: true } },
                individualStudent: { select: { name: true, lastName: true, middleName: true } }
            }
        }),
        prisma.class.count({
            where: { status: 'pending_admin_review', isPractice: false }
        }),
        prisma.class.count({
            where: {
                status: 'pending_admin_review',
                isPractice: false,
                OR: [
                    { submittedAt: { lt: today.start } },
                    { submittedAt: null, date: { lt: today.start } }
                ]
            }
        }),
        prisma.class.findMany({
            where: {
                status: 'pending_admin_review',
                isPractice: false,
                OR: [
                    { submittedAt: { lt: today.start } },
                    { submittedAt: null, date: { lt: today.start } }
                ]
            },
            orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
            take: 8,
            include: {
                teacher: { select: { name: true, lastName: true, middleName: true } },
                group: { select: { name: true } },
                individualStudent: { select: { name: true, lastName: true, middleName: true } }
            }
        }),
        prisma.booking.findMany({
            where: { createdAt: { gte: today.start, lt: today.end } },
            select: { id: true, status: true, source: true, direction: true, lossReason: true }
        }),
        prisma.conversation.findMany({
            where: {
                source: 'whatsapp_meta',
                firstMessageAt: { gte: today.start, lt: today.end }
            },
            select: { id: true, isLead: true, studentId: true, bookingId: true, name: true }
        }),
        prisma.conversationMessage.count({
            where: {
                conversation: { source: 'whatsapp_meta' },
                timestamp: { gte: today.start, lt: today.end }
            }
        }),
        prisma.conversation.count({
            where: {
                source: 'whatsapp_meta',
                status: 'active',
                lastMessageAt: { gte: today.start, lt: today.end },
                messages: {
                    every: { role: { not: 'assistant' } }
                }
            }
        }),
        prisma.booking.count({
            where: { status: 'new', createdAt: { lt: today.start } }
        }),
        prisma.booking.findMany({
            where: { status: 'new', createdAt: { lt: today.start } },
            orderBy: { createdAt: 'asc' },
            take: 8,
            select: { id: true, name: true, lastName: true, middleName: true, direction: true, createdAt: true }
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
        prisma.student.count({
            where: { role: 'student', accountBalance: { lt: 0 } }
        }),
        prisma.student.findMany({
            where: { role: 'student', accountBalance: { lt: 0 } },
            orderBy: { accountBalance: 'asc' },
            take: 8,
            select: { id: true, name: true, lastName: true, middleName: true, accountBalance: true }
        }),
        prisma.membership.findMany({
            where: {
                status: 'active',
                student: { role: 'student', status: 'active', accountBalance: { gte: 0 } }
            },
            include: {
                student: { select: { id: true, name: true, lastName: true, middleName: true, phone: true, accountBalance: true } },
                group: { select: { name: true } },
                plan: { select: { name: true, price: true, includedUnits: true } }
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
    const tomorrowTrialClasses = tomorrowClasses.filter(cls => cls.classType === 'trial');
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
    const expiringMemberships = expiringMembershipCandidates
        .map(membership => enrichMembershipBalance(membership))
        .filter(membership => membership.estimatedLessonsRemaining !== null && membership.estimatedLessonsRemaining <= 1)
        .sort((a, b) => a.estimatedLessonsRemaining - b.estimatedLessonsRemaining)
        .slice(0, 8);
    const attentionTasks = [
        buildTask('Незакрытые уроки со вчера/раньше', overdueClassesCount, overdueClasses[0]
            ? `${overdueClasses[0].startTime || ''} ${classSubject(overdueClasses[0])}`.trim()
            : null),
        buildTask('Отчёты преподавателей на подтверждении со вчера/раньше', oldPendingReviewCount, oldPendingReview[0]
            ? `${oldPendingReview[0].startTime || ''} ${classSubject(oldPendingReview[0])}`.trim()
            : null),
        buildTask('Новые заявки без обработки со вчера/раньше', oldNewBookingsCount, oldNewBookings[0]
            ? `${personName(oldNewBookings[0], 'Заявка')} · ${oldNewBookings[0].direction || 'направление не указано'}`
            : null),
        buildTask('Ученики с долгом', debtStudentsCount, debtStudents[0]
            ? `${personName(debtStudents[0])} · ${debtStudents[0].accountBalance.toLocaleString('ru-RU')} ₸`
            : null),
        buildTask('Абонементы на исходе', expiringMemberships.length, expiringMemberships[0]
            ? `${personName(expiringMemberships[0].student)} · ${expiringMemberships[0].estimatedLessonsRemaining} ур.`
            : null)
    ].filter(task => task.count > 0);

    const stats = {
        date: today.reportDate,
        generatedAt: now.toISOString(),
        autoReport: {
            cron: '0 * * * *',
            condition: 'getAlmatyNow().getUTCHours() === 21',
            serverLocalTime: 'около 21:00 по UTC+5 (Актобе/Алматы)'
        },
        admin: pickReportAdmin(paymentsToday, activityLogs),
        lessons: {
            completed: completedClasses.length,
            pendingReview,
            notFilled: notFilledClasses.length
        },
        bookings: {
            newTotal: bookingsToday.length,
            newNonParentChats: whatsappConversationsToday.filter(conversation => conversation.isLead).length || bookingsToday.length,
            bySource: topCountBy(bookingsToday, booking => booking.source),
            rejected: rejectedBookings.length,
            rejectionReasons: topCountBy(rejectedBookings, booking => booking.lossReason || 'Причина не указана'),
            whatsapp: {
                newConversations: whatsappConversationsToday.length,
                newLeads: whatsappConversationsToday.filter(conversation => conversation.isLead).length,
                linkedStudents: whatsappConversationsToday.filter(conversation => conversation.studentId).length,
                linkedBookings: whatsappConversationsToday.filter(conversation => conversation.bookingId).length,
                messagesToday: whatsappMessagesToday,
                unanswered: whatsappUnansweredConversations
            }
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
            expectedRevenue: sumAmounts(paymentsTomorrow),
            classes: tomorrowClasses.length,
            trials: tomorrowTrialClasses.length,
            plan: [
                buildTask('Провести уроки по расписанию', tomorrowClasses.length, tomorrowClasses[0]
                    ? `${tomorrowClasses[0].startTime || ''} ${tomorrowClasses[0].title || 'урок'}`.trim()
                    : null),
                buildTask('Проконтролировать пробные', tomorrowTrialClasses.length, tomorrowTrialClasses[0]
                    ? `${tomorrowTrialClasses[0].startTime || ''} ${tomorrowTrialClasses[0].title || 'пробный'}`.trim()
                    : null),
                buildTask('Собрать запланированные оплаты', paymentsTomorrow.length, paymentsTomorrow[0]
                    ? `${paymentsTomorrow[0].studentName || 'ученик'} · ${paymentsTomorrow[0].amount.toLocaleString('ru-RU')} ₸`
                    : null),
                buildTask('Закрыть хвосты администратора', attentionTasks.length, attentionTasks[0]?.label || null)
            ].filter(task => task.count > 0)
        },
        students: {
            active: activeStudents,
            new: newStudents,
            pausedOrLeft: pausedStudents
        },
        attention: {
            total: attentionTasks.reduce((sum, task) => sum + task.count, 0),
            tasks: attentionTasks,
            yesterdayDate: yesterday.reportDate
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
