const axios = require('axios');
const { prisma } = require('../config/db');
const { compareSnapshots } = require('./integrationReconciliationPolicy');

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
