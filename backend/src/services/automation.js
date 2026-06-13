const { prisma } = require('../config/db');
const { sendEveningReportIfConfigured } = require('./notifications');

const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

function getAlmatyNow() {
    return new Date(Date.now() + ALMATY_OFFSET_MS);
}

function getClassEndAlmaty(cls) {
    const clsDateAlmaty = new Date(cls.date.getTime() + ALMATY_OFFSET_MS);
    const clsEndAlmaty = new Date(clsDateAlmaty);
    const [endH, endM] = cls.endTime.split(':').map(Number);
    clsEndAlmaty.setUTCHours(endH, endM, 0, 0);
    return clsEndAlmaty;
}

function isClassEnded(cls, almatyNow = getAlmatyNow()) {
    return almatyNow >= getClassEndAlmaty(cls);
}

/**
 * Housekeeping без финансовых операций.
 * 1. Прошедшие уроки без отчёта → not_filled (после grace period 24ч).
 * Автосписание отключено — см. ADR и BUSINESS_LOGIC.md.
 */
async function processHousekeeping() {
    const logs = [];
    const log = (msg) => {
        const entry = `[${new Date().toISOString().replace('T', ' ').slice(0, 19)}] ${msg}`;
        console.log(entry);
        logs.push(entry);
    };

    try {
        log('🧹 Запуск housekeeping (без автосписания)...');

        const almatyNow = getAlmatyNow();
        const graceMs = 24 * 60 * 60 * 1000;
        const searchStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

        const candidates = await prisma.class.findMany({
            where: {
                isPractice: false,
                status: { in: ['scheduled', 'started'] },
                date: { gte: searchStart }
            }
        });

        let markedNotFilled = 0;

        for (const cls of candidates) {
            if (!isClassEnded(cls, almatyNow)) continue;

            const endedAt = getClassEndAlmaty(cls).getTime();
            if (almatyNow.getTime() - endedAt < graceMs) continue;

            const hasSubmission = Boolean(cls.submittedAt || cls.topic || cls.homeworkDraft);
            const hasAttendance = await prisma.classAttendee.findFirst({
                where: { classId: cls.id, attended: true }
            });

            if (hasSubmission || hasAttendance || cls.noOneAttended) continue;

            await prisma.class.update({
                where: { id: cls.id },
                data: { status: 'not_filled' }
            });

            markedNotFilled++;
            log(`   🔴 not_filled: ${cls.title} (${cls.date.toISOString().split('T')[0]})`);
        }

        log(`✅ Housekeeping завершён. not_filled: ${markedNotFilled}`);

        // Вечерний отчёт в Telegram — раз в сутки около 21:00 по локальному времени сервера
        const hour = new Date().getHours();
        if (hour === 21) {
            await sendEveningReportIfConfigured();
        }

        return { success: true, logs, markedNotFilled, totalDeducted: 0 };
    } catch (error) {
        log(`🚨 Ошибка housekeeping: ${error.message}`);
        return { success: false, logs, error: error.message, totalDeducted: 0 };
    }
}

/**
 * @deprecated Автосписание отключено. Используйте processHousekeeping().
 */
async function processPastClasses() {
    return processHousekeeping();
}

module.exports = { processHousekeeping, processPastClasses, isClassEnded };
