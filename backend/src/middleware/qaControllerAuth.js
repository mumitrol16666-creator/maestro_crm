const crypto = require('crypto');
const { assertQaEnvironment } = require('../services/qaEnvironment');

function secretsMatch(actual, expected) {
    if (!actual || !expected) return false;
    const actualBuffer = Buffer.from(String(actual));
    const expectedBuffer = Buffer.from(String(expected));
    if (actualBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function requireQaController(req, res, next) {
    try {
        assertQaEnvironment();
    } catch (error) {
        return res.status(404).json({ success: false, error: error.message });
    }

    const expected = process.env.MAESTRO_QA_CONTROLLER_SECRET;
    const actual = req.get('X-Maestro-QA-Secret');
    if (!expected || expected.length < 16 || !secretsMatch(actual, expected)) {
        return res.status(403).json({ success: false, error: 'Invalid QA controller secret' });
    }
    return next();
}

module.exports = { requireQaController, secretsMatch };
