/**
 * Secret that signs CRM → learning platform requests. LEARNING_PLATFORM_SECRET when set,
 * otherwise the shared INTEGRATION_SERVICE_SECRET. Incoming requests from the platform are
 * still checked against INTEGRATION_SERVICE_SECRET (middleware/integrationAuth.js).
 */
function learningPlatformSecret() {
    return process.env.LEARNING_PLATFORM_SECRET || process.env.INTEGRATION_SERVICE_SECRET;
}

module.exports = { learningPlatformSecret };
