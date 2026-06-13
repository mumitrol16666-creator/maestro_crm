function requireIntegrationAuth(req, res, next) {
    const secret = process.env.INTEGRATION_SERVICE_SECRET;
    if (!secret) {
        return res.status(503).json({
            success: false,
            error: 'Integration API is not configured (INTEGRATION_SERVICE_SECRET)',
        });
    }

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token || token !== secret) {
        return res.status(401).json({ success: false, error: 'Invalid integration credentials' });
    }

    const system = req.headers['x-integration-system'];
    if (!system || !['crm', 'learning-platform'].includes(system)) {
        return res.status(400).json({
            success: false,
            error: 'X-Integration-System header must be crm or learning-platform',
        });
    }

    req.integrationSystem = system;
    next();
}

module.exports = { requireIntegrationAuth };
