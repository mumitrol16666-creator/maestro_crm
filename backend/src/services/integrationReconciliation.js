const axios = require('axios');
const { prisma } = require('../config/db');

function learningPlatformBaseUrl() {
    return (process.env.LEARNING_PLATFORM_API_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
}

function integrationHeaders() {
    return {
        Authorization: `Bearer ${process.env.INTEGRATION_SERVICE_SECRET}`,
        'X-Integration-System': 'crm',
        'Content-Type': 'application/json',
    };
}

async function buildCrmIntegrationSnapshot() {
    const [
        linkedUsers,
        conflictUsers,
        pendingUsers,
        externalBookings,
        pendingTrialClasses,
        failedLogs,
    ] = await Promise.all([
        prisma.student.findMany({
            where: { appUserId: { not: null }, externalLinkStatus: 'linked' },
            select: { id: true, role: true, appUserId: true, phoneDigits: true, updatedAt: true },
            orderBy: { updatedAt: 'desc' },
        }),
        prisma.student.findMany({
            where: { externalLinkStatus: { in: ['conflict', 'manual_review'] } },
            select: { id: true, role: true, appUserId: true, externalLinkStatus: true, phone: true },
            orderBy: { updatedAt: 'desc' },
        }),
        prisma.student.findMany({
            where: {
                appUserId: null,
                role: { in: ['student', 'teacher'] },
                status: 'active',
            },
            select: { id: true, role: true, phone: true, updatedAt: true },
            take: 100,
            orderBy: { updatedAt: 'desc' },
        }),
        prisma.booking.findMany({
            where: { externalSourceId: { not: null } },
            select: {
                id: true,
                externalSourceId: true,
                requestType: true,
                appStatus: true,
                status: true,
                trialClassId: true,
                updatedAt: true,
            },
            orderBy: { updatedAt: 'desc' },
            take: 250,
        }),
        prisma.class.findMany({
            where: {
                classType: 'trial',
                status: { in: ['scheduled', 'started', 'pending_admin_review'] },
            },
            select: { id: true, teacherId: true, date: true, startTime: true, status: true, updatedAt: true },
            take: 250,
            orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
        }),
        prisma.integrationLog.findMany({
            where: { status: 'failed' },
            select: {
                id: true,
                direction: true,
                system: true,
                operation: true,
                path: true,
                retryable: true,
                attempts: true,
                responseStatus: true,
                errorMessage: true,
                updatedAt: true,
            },
            orderBy: { updatedAt: 'desc' },
            take: 100,
        }).catch(() => []),
    ]);

    return {
        generatedAt: new Date().toISOString(),
        counts: {
            linkedUsers: linkedUsers.length,
            conflictUsers: conflictUsers.length,
            pendingUsers: pendingUsers.length,
            externalBookings: externalBookings.length,
            pendingTrialClasses: pendingTrialClasses.length,
            failedIntegrationOperations: failedLogs.length,
        },
        linkedUsers,
        conflictUsers,
        pendingUsers,
        externalBookings,
        pendingTrialClasses,
        failedIntegrationOperations: failedLogs,
    };
}

function compareSnapshots(crmSnapshot, appSnapshot) {
    const issues = [];
    const appUsers = new Map((appSnapshot?.linkedUsers || [])
        .map((item) => [item.crmStudentId || item.crmTeacherId || item.crmUserId, item]));
    const appBookings = new Map((appSnapshot?.externalBookings || [])
        .map((item) => [item.externalSourceId, item]));

    for (const user of crmSnapshot.linkedUsers || []) {
        const appUser = appUsers.get(user.id);
        if (!appUser) {
            issues.push({
                severity: 'warning',
                type: 'linked_user_missing_in_app',
                message: 'В CRM пользователь связан с приложением, но в snapshot приложения его нет',
                crmUserId: user.id,
                appUserId: user.appUserId,
            });
        } else if (appUser.appUserId && appUser.appUserId !== user.appUserId) {
            issues.push({
                severity: 'critical',
                type: 'linked_user_mismatch',
                message: 'CRM и приложение указывают разные appUserId',
                crmUserId: user.id,
                crmAppUserId: user.appUserId,
                appAppUserId: appUser.appUserId,
            });
        }
    }

    for (const booking of crmSnapshot.externalBookings || []) {
        if (!appBookings.has(booking.externalSourceId)) {
            issues.push({
                severity: 'warning',
                type: 'external_booking_missing_in_app',
                message: 'Заявка пришла из приложения, но в snapshot приложения не найдена',
                crmBookingId: booking.id,
                externalSourceId: booking.externalSourceId,
            });
        }
    }

    for (const failed of crmSnapshot.failedIntegrationOperations || []) {
        issues.push({
            severity: failed.retryable ? 'warning' : 'info',
            type: 'failed_integration_operation',
            message: failed.retryable
                ? 'Есть неудачная интеграционная операция, её можно повторить'
                : 'Есть неудачная интеграционная операция, ручной повтор не рекомендован',
            integrationLogId: failed.id,
            operation: failed.operation,
            error: failed.errorMessage,
        });
    }

    return issues;
}

async function loadAppSnapshot() {
    const response = await axios.get(
        `${learningPlatformBaseUrl()}/api/integration/v1/reconciliation/snapshot`,
        { headers: integrationHeaders(), timeout: 15000 },
    );
    return response.data?.data || response.data;
}

async function reconcileCrmWithLearningPlatform() {
    const crm = await buildCrmIntegrationSnapshot();
    let app = null;
    let appAvailable = false;
    let appError = null;

    try {
        app = await loadAppSnapshot();
        appAvailable = true;
    } catch (error) {
        appError = error.response?.data?.error || error.message;
    }

    const issues = compareSnapshots(crm, app || {});
    if (!appAvailable) {
        issues.push({
            severity: 'warning',
            type: 'app_snapshot_unavailable',
            message: 'Приложение не отдало snapshot для сверки',
            error: appError,
        });
    }

    return {
        success: true,
        data: {
            generatedAt: new Date().toISOString(),
            appAvailable,
            crm,
            app,
            issues,
            summary: {
                critical: issues.filter((item) => item.severity === 'critical').length,
                warnings: issues.filter((item) => item.severity === 'warning').length,
                info: issues.filter((item) => item.severity === 'info').length,
            },
        },
    };
}

module.exports = {
    buildCrmIntegrationSnapshot,
    compareSnapshots,
    reconcileCrmWithLearningPlatform,
};
