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

module.exports = { compareSnapshots };
