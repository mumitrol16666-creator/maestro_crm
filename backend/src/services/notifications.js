const { prisma } = require('../config/db');
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

/**
 * Вечерний отчёт за сегодня (вызывается из housekeeping cron).
 */
async function sendEveningReportIfConfigured() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [completed, pendingReview, notFilled, newBookings, paymentsSum] = await Promise.all([
        prisma.class.count({
            where: { status: 'completed', date: { gte: today, lt: tomorrow }, isPractice: false }
        }),
        prisma.class.count({
            where: { status: 'pending_admin_review', isPractice: false }
        }),
        prisma.class.count({
            where: { status: 'not_filled', date: { gte: today, lt: tomorrow }, isPractice: false }
        }),
        prisma.booking.count({
            where: { status: 'new', createdAt: { gte: today, lt: tomorrow } }
        }),
        prisma.payment.aggregate({
            where: { status: 'completed', paymentDate: { gte: today, lt: tomorrow } },
            _sum: { amount: true }
        })
    ]);

    return notify('report.evening', {
        stats: {
            date: today.toISOString().split('T')[0],
            completed,
            pendingReview,
            notFilled,
            newBookings,
            revenue: paymentsSum._sum.amount || 0
        }
    });
}

module.exports = { notify, sendEveningReportIfConfigured };
