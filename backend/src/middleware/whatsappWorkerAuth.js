const { integrationSecretMatches } = require('./integrationAuth');

const WORKER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,79}$/;

function requireWhatsappWorkerAuth(req, res, next) {
    const secret = process.env.WHATSAPP_BROWSER_WORKER_SECRET;
    if (!secret) {
        return res.status(503).json({
            success: false,
            error: 'WhatsApp browser worker API is not configured',
        });
    }

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token || !integrationSecretMatches(token, secret)) {
        return res.status(401).json({ success: false, error: 'Invalid worker credentials' });
    }

    const workerId = String(req.headers['x-whatsapp-worker-id'] || '').trim();
    if (!WORKER_ID_PATTERN.test(workerId)) {
        return res.status(400).json({
            success: false,
            error: 'X-Whatsapp-Worker-Id header is required',
        });
    }

    req.whatsappWorkerId = workerId;
    next();
}

module.exports = { WORKER_ID_PATTERN, requireWhatsappWorkerAuth };
