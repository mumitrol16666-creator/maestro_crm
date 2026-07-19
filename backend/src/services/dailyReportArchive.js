const { prisma } = require('../config/db');

const ADMINISTRATIVE_ROLES = ['sales_manager', 'admin', 'super_admin'];

function personName(person, fallback = 'Сотрудник') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function countByKey(rows, key) {
    return new Map(rows.map(row => [row[key], row._count?._all || 0]));
}

function paymentByManager(rows) {
    return new Map(rows.map(row => [
        row.managerId,
        {
            count: row._count?._all || 0,
            amount: row._sum?.amount || 0,
        },
    ]));
}

async function buildDailyAdminKpis(start, end, db = prisma) {
    const admins = await db.student.findMany({
        where: {
            role: { in: ADMINISTRATIVE_ROLES },
            status: 'active',
        },
        select: {
            id: true,
            name: true,
            lastName: true,
            middleName: true,
            role: true,
        },
        orderBy: [{ role: 'asc' }, { lastName: 'asc' }, { name: 'asc' }],
    });
    const adminIds = admins.map(admin => admin.id);
    if (!adminIds.length) return [];

    const [
        activityRows,
        bookingRows,
        lessonRows,
        paymentRows,
        reminderRows,
    ] = await Promise.all([
        db.activityLog.groupBy({
            by: ['userId'],
            where: {
                userId: { in: adminIds },
                createdAt: { gte: start, lt: end },
            },
            _count: { _all: true },
        }),
        db.booking.groupBy({
            by: ['processedById'],
            where: {
                processedById: { in: adminIds },
                processedAt: { gte: start, lt: end },
            },
            _count: { _all: true },
        }),
        db.class.groupBy({
            by: ['reviewedById'],
            where: {
                reviewedById: { in: adminIds },
                reviewedAt: { gte: start, lt: end },
            },
            _count: { _all: true },
        }),
        db.payment.groupBy({
            by: ['managerId'],
            where: {
                managerId: { in: adminIds },
                status: 'completed',
                amount: { gt: 0 },
                createdAt: { gte: start, lt: end },
            },
            _count: { _all: true },
            _sum: { amount: true },
        }),
        db.activityLog.groupBy({
            by: ['userId'],
            where: {
                userId: { in: adminIds },
                entityType: 'WhatsAppReminder',
                action: 'sent',
                createdAt: { gte: start, lt: end },
            },
            _count: { _all: true },
        }),
    ]);

    const activityCounts = countByKey(activityRows, 'userId');
    const bookingCounts = countByKey(bookingRows, 'processedById');
    const lessonCounts = countByKey(lessonRows, 'reviewedById');
    const payments = paymentByManager(paymentRows);
    const reminderCounts = countByKey(reminderRows, 'userId');

    return admins.map(admin => {
        const bookingsProcessed = bookingCounts.get(admin.id) || 0;
        const lessonsReviewed = lessonCounts.get(admin.id) || 0;
        const payment = payments.get(admin.id) || { count: 0, amount: 0 };
        const remindersSent = reminderCounts.get(admin.id) || 0;
        return {
            adminId: admin.id,
            adminName: personName(admin),
            role: admin.role,
            activityCount: activityCounts.get(admin.id) || 0,
            bookingsProcessed,
            lessonsReviewed,
            paymentsProcessed: payment.count,
            paymentAmount: payment.amount,
            remindersSent,
            completedActions: bookingsProcessed + lessonsReviewed + payment.count + remindersSent,
        };
    });
}

function unclosedTaskBreakdown(stats) {
    return (stats?.attention?.tasks || []).map(task => ({
        label: String(task.label || 'Задачи'),
        count: Number(task.count) || 0,
    }));
}

async function persistDailyReportSnapshot(stats, options = {}, db = prisma) {
    const reportDate = String(stats?.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
        throw new Error('Некорректная дата ежедневного отчёта');
    }

    const generatedAt = new Date(stats.generatedAt || Date.now());
    const adminKpis = Array.isArray(stats?.administration?.staff)
        ? stats.administration.staff
        : [];
    const breakdown = unclosedTaskBreakdown(stats);

    return db.$transaction(async tx => {
        const report = await tx.dailyReportSnapshot.upsert({
            where: { reportDate },
            create: {
                reportDate,
                timezone: 'Asia/Aqtobe',
                generatedAt,
                generatedById: options.generatedById || null,
                source: options.source || 'automatic',
                primaryAdminId: stats.adminId || null,
                primaryAdminName: stats.admin || null,
                sentToTelegram: false,
                unclosedTasks: Number(stats?.attention?.total) || 0,
                unclosedBreakdown: breakdown,
                payload: stats,
                aiComment: stats.aiComment || null,
            },
            update: {
                generatedAt,
                generatedById: options.generatedById || null,
                source: options.source || 'automatic',
                primaryAdminId: stats.adminId || null,
                primaryAdminName: stats.admin || null,
                unclosedTasks: Number(stats?.attention?.total) || 0,
                unclosedBreakdown: breakdown,
                payload: stats,
                aiComment: stats.aiComment || null,
            },
        });

        await tx.dailyAdminKpiSnapshot.deleteMany({
            where: { dailyReportId: report.id },
        });
        if (adminKpis.length) {
            await tx.dailyAdminKpiSnapshot.createMany({
                data: adminKpis.map(kpi => ({
                    dailyReportId: report.id,
                    adminId: kpi.adminId,
                    adminName: kpi.adminName,
                    role: kpi.role,
                    activityCount: Number(kpi.activityCount) || 0,
                    bookingsProcessed: Number(kpi.bookingsProcessed) || 0,
                    lessonsReviewed: Number(kpi.lessonsReviewed) || 0,
                    paymentsProcessed: Number(kpi.paymentsProcessed) || 0,
                    paymentAmount: Number(kpi.paymentAmount) || 0,
                    remindersSent: Number(kpi.remindersSent) || 0,
                    completedActions: Number(kpi.completedActions) || 0,
                })),
            });
        }

        return report;
    });
}

async function markDailyReportTelegramResult(reportDate, sent, db = prisma) {
    if (!sent) return null;
    return db.dailyReportSnapshot.update({
        where: { reportDate },
        data: {
            sentToTelegram: true,
            sendCount: { increment: 1 },
            lastSentAt: new Date(),
        },
    });
}

function summarizeDailyReportArchive(reports = []) {
    const staff = new Map();
    const categories = new Map();
    const lessonTotals = {
        scheduled: 0,
        active: 0,
        completed: 0,
        pendingReview: 0,
        awaitingReport: 0,
        cancelled: 0,
        cancelledLostRevenue: 0,
    };
    let unclosedTaskDays = 0;
    let maxUnclosedTasks = 0;
    let daysWithoutBacklog = 0;

    for (const report of reports) {
        const unclosed = Number(report.unclosedTasks) || 0;
        unclosedTaskDays += unclosed;
        maxUnclosedTasks = Math.max(maxUnclosedTasks, unclosed);
        if (unclosed === 0) daysWithoutBacklog += 1;

        const breakdown = Array.isArray(report.unclosedBreakdown)
            ? report.unclosedBreakdown
            : [];
        for (const item of breakdown) {
            const label = String(item?.label || 'Задачи');
            categories.set(label, (categories.get(label) || 0) + (Number(item?.count) || 0));
        }

        const lessons = report.payload?.lessons || report.lessons || {};
        for (const key of Object.keys(lessonTotals)) {
            lessonTotals[key] += Number(lessons[key]) || 0;
        }

        for (const snapshot of report.adminKpis || []) {
            const current = staff.get(snapshot.adminId) || {
                adminId: snapshot.adminId,
                adminName: snapshot.adminName,
                role: snapshot.role,
                reportDays: 0,
                activeDays: 0,
                activityCount: 0,
                bookingsProcessed: 0,
                lessonsReviewed: 0,
                paymentsProcessed: 0,
                paymentAmount: 0,
                remindersSent: 0,
                completedActions: 0,
            };
            current.adminName = snapshot.adminName || current.adminName;
            current.role = snapshot.role || current.role;
            current.reportDays += 1;
            current.activityCount += Number(snapshot.activityCount) || 0;
            current.bookingsProcessed += Number(snapshot.bookingsProcessed) || 0;
            current.lessonsReviewed += Number(snapshot.lessonsReviewed) || 0;
            current.paymentsProcessed += Number(snapshot.paymentsProcessed) || 0;
            current.paymentAmount += Number(snapshot.paymentAmount) || 0;
            current.remindersSent += Number(snapshot.remindersSent) || 0;
            current.completedActions += Number(snapshot.completedActions) || 0;
            if ((Number(snapshot.completedActions) || 0) > 0 || (Number(snapshot.activityCount) || 0) > 0) {
                current.activeDays += 1;
            }
            staff.set(snapshot.adminId, current);
        }
    }

    const reportDays = reports.length;
    const staffRows = [...staff.values()]
        .map(row => ({
            ...row,
            averageActionsPerReportDay: row.reportDays
                ? Math.round((row.completedActions / row.reportDays) * 10) / 10
                : 0,
        }))
        .sort((a, b) => b.completedActions - a.completedActions);
    const latest = reports[0] || null;

    return {
        reportDays,
        sentDays: reports.filter(report => report.sentToTelegram).length,
        unclosedTaskDays,
        averageUnclosedTasks: reportDays
            ? Math.round((unclosedTaskDays / reportDays) * 10) / 10
            : 0,
        maxUnclosedTasks,
        latestUnclosedTasks: Number(latest?.unclosedTasks) || 0,
        latestReportDate: latest?.reportDate || null,
        daysWithoutBacklog,
        categories: [...categories.entries()]
            .map(([label, count]) => ({ label, count }))
            .sort((a, b) => b.count - a.count),
        lessonTotals,
        staff: staffRows,
    };
}

async function getDailyReportArchive(fromKey, toKey, options = {}, db = prisma) {
    const reports = await db.dailyReportSnapshot.findMany({
        where: {
            reportDate: {
                gte: fromKey,
                lte: toKey,
            },
        },
        select: {
            id: true,
            reportDate: true,
            generatedAt: true,
            source: true,
            primaryAdminId: true,
            primaryAdminName: true,
            sentToTelegram: true,
            sendCount: true,
            lastSentAt: true,
            unclosedTasks: true,
            unclosedBreakdown: true,
            aiComment: true,
            payload: true,
            adminKpis: {
                orderBy: [{ completedActions: 'desc' }, { adminName: 'asc' }],
            },
        },
        orderBy: { reportDate: 'desc' },
    });
    const summary = summarizeDailyReportArchive(reports);
    const limit = Math.max(1, Math.min(Number(options.limit) || 120, 366));

    return {
        summary,
        reports: reports.slice(0, limit).map(report => ({
            id: report.id,
            reportDate: report.reportDate,
            generatedAt: report.generatedAt,
            source: report.source,
            primaryAdminId: report.primaryAdminId,
            primaryAdminName: report.primaryAdminName,
            sentToTelegram: report.sentToTelegram,
            sendCount: report.sendCount,
            lastSentAt: report.lastSentAt,
            unclosedTasks: report.unclosedTasks,
            unclosedBreakdown: report.unclosedBreakdown,
            aiComment: report.aiComment,
            lessons: report.payload?.lessons || null,
            adminKpis: report.adminKpis,
            ...(options.includePayload ? { payload: report.payload } : {}),
        })),
        totalReports: reports.length,
    };
}

module.exports = {
    ADMINISTRATIVE_ROLES,
    buildDailyAdminKpis,
    getDailyReportArchive,
    markDailyReportTelegramResult,
    persistDailyReportSnapshot,
    summarizeDailyReportArchive,
};
