const crypto = require('crypto');
const express = require('express');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/db');

const router = express.Router();

const ALLOWED_EVENTS = new Set([
    'page_view',
    'cta_click',
    'booking_form_view',
    'booking_submit_attempt',
    'lead_submit',
    'lead_submit_error',
    'quiz_start',
    'quiz_step',
    'quiz_contact_step',
]);

function cleanString(value, max = 500) {
    if (value === undefined || value === null) return null;
    const str = String(value).trim();
    if (!str) return null;
    return str.slice(0, max);
}

function safeObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value;
}

function ipHash(req) {
    const raw = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
    const ip = String(raw).split(',')[0].trim();
    if (!ip) return null;
    const salt = process.env.MARKETING_IP_HASH_SALT || process.env.JWT_SECRET || 'maestro-marketing';
    return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}

function normalizeMarketingPayload(body) {
    const attribution = safeObject(body.attribution);
    const payload = safeObject(body.payload);
    const eventName = cleanString(body.eventName, 80) || 'page_view';

    return {
        eventName: ALLOWED_EVENTS.has(eventName) ? eventName : 'custom',
        clientId: cleanString(body.clientId, 120),
        sessionId: cleanString(body.sessionId, 120),
        source: cleanString(attribution.utm_source || attribution.source, 120),
        medium: cleanString(attribution.utm_medium || attribution.medium, 120),
        campaign: cleanString(attribution.utm_campaign || attribution.campaign, 180),
        content: cleanString(attribution.utm_content || attribution.content, 180),
        term: cleanString(attribution.utm_term || attribution.term, 180),
        clickId: cleanString(attribution.gclid || attribution.fbclid || attribution.ttclid || attribution.yclid || attribution.clickId, 220),
        pageUrl: cleanString(body.pageUrl, 1200),
        referrer: cleanString(body.referrer, 1200),
        payload,
        bookingId: cleanString(body.bookingId || payload.bookingId, 120),
    };
}

router.post('/events', [
    body('clientId').notEmpty().isLength({ max: 120 }),
    body('eventName').optional().isLength({ max: 80 }),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

        const data = normalizeMarketingPayload(req.body);
        if (!data.clientId) return res.status(400).json({ success: false, error: 'clientId is required' });

        const event = await prisma.marketingEvent.create({
            data: {
                ...data,
                userAgent: cleanString(req.headers['user-agent'], 1000),
                ipHash: ipHash(req),
            },
            select: { id: true, createdAt: true },
        });

        res.status(201).json({ success: true, event });
    } catch (error) {
        console.error('Marketing event error:', error);
        res.status(500).json({ success: false, error: 'Ошибка записи события' });
    }
});

module.exports = router;
