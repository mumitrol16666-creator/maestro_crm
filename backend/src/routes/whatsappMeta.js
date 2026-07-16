const express = require('express');
const router = express.Router();
const {
    processWebhookPayload,
    verifyMetaSignature,
    sendWhatsappTextMessage
} = require('../services/whatsappMeta');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const expectedToken = process.env.WHATSAPP_META_VERIFY_TOKEN;

    if (mode === 'subscribe' && expectedToken && token === expectedToken) {
        return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
});

router.post('/webhook', async (req, res) => {
    try {
        if (!verifyMetaSignature(req)) {
            return res.sendStatus(403);
        }

        const results = await processWebhookPayload(req.body);
        req.app.get('io')?.emit('whatsapp:message', { source: 'meta', results });
        return res.sendStatus(200);
    } catch (error) {
        console.error('[whatsapp-meta] webhook error:', error.message);
        return res.sendStatus(200);
    }
});

router.post('/send-text', authenticate, requireAdmin, async (req, res) => {
    try {
        const { to, text } = req.body || {};
        if (!to || !text) {
            return res.status(400).json({ success: false, error: 'to and text are required' });
        }

        const result = await sendWhatsappTextMessage(to, text);
        res.json({ success: true, result });
    } catch (error) {
        console.error('[whatsapp-meta] send-text error:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: 'Не удалось отправить сообщение WhatsApp' });
    }
});

module.exports = router;
