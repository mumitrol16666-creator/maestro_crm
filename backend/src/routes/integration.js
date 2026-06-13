const express = require('express');
const router = express.Router();
const { requireIntegrationAuth } = require('../middleware/integrationAuth');
const { getLinkStatus, linkUsers, createSsoToken } = require('../services/userLink');

router.use(requireIntegrationAuth);

// POST /api/integration/v1/users/link
router.post('/users/link', async (req, res) => {
    try {
        const { phone, crmStudentId, appUserId, initiatedBy } = req.body || {};
        if (!phone && !crmStudentId) {
            return res.status(400).json({ success: false, error: 'phone or crmStudentId is required' });
        }

        const result = await linkUsers({ phone, crmStudentId, appUserId, initiatedBy });
        if (!result.success) {
            const status = result.status === 'conflict' ? 409 : 400;
            return res.status(status).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] link error:', error);
        return res.status(500).json({ success: false, error: 'Link failed' });
    }
});

// GET /api/integration/v1/users/link-status/:phone
router.get('/users/link-status/:phone', async (req, res) => {
    try {
        const result = await getLinkStatus(req.params.phone);
        if (!result.success) {
            return res.status(400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] link-status error:', error);
        return res.status(500).json({ success: false, error: 'Status check failed' });
    }
});

// POST /api/integration/v1/auth/sso-token
router.post('/auth/sso-token', async (req, res) => {
    try {
        const { crmStudentId } = req.body || {};
        if (!crmStudentId) {
            return res.status(400).json({ success: false, error: 'crmStudentId is required' });
        }

        const result = await createSsoToken(crmStudentId);
        if (!result.success) {
            return res.status(400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] sso-token error:', error);
        return res.status(500).json({ success: false, error: 'SSO token failed' });
    }
});

module.exports = router;
