const { prisma } = require('../config/db');
const { notify } = require('./notifications');

function phoneDigits(phone) {
    return phone ? String(phone).replace(/\D/g, '') : '';
}

function parseOptionalDate(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    return date;
}

function cleanMarketingValue(value, max = 220) {
    const result = String(value || '').trim();
    return result ? result.slice(0, max) : null;
}

function normalizeMarketingAttribution(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'ttclid', 'yclid'];
    const result = {};
    for (const key of keys) {
        const clean = cleanMarketingValue(value[key]);
        if (clean) result[key] = clean;
    }
    for (const touch of ['firstTouch', 'lastTouch']) {
        if (!value[touch] || typeof value[touch] !== 'object' || Array.isArray(value[touch])) continue;
        result[touch] = {};
        for (const key of keys) {
            const clean = cleanMarketingValue(value[touch][key]);
            if (clean) result[touch][key] = clean;
        }
    }
    return Object.keys(result).length ? result : null;
}

async function linkMarketingEvents(bookingId, marketingClientId, createdAt) {
    if (!bookingId || !marketingClientId) return;
    await prisma.marketingEvent.updateMany({
        where: {
            clientId: marketingClientId,
            bookingId: null,
            ...(createdAt ? { createdAt: { lte: createdAt } } : {}),
        },
        data: { bookingId },
    }).catch((error) => console.error('[marketing] integration booking link error:', error));
}

async function createAppOnlineLessonBooking(input) {
    const requestType = input.requestType === 'trial' ? 'trial' : 'online_lesson';
    const externalSourceId = String(input.externalSourceId || '').trim();
    const name = String(input.name || '').trim();
    const lastName = String(input.lastName || '').trim();
    const middleName = String(input.middleName || '').trim();
    const parsedDateOfBirth = parseOptionalDate(input.dateOfBirth);
    const phone = String(input.phone || '').trim();
    const direction = String(input.direction || '').trim();
    const marketingClientId = cleanMarketingValue(input.marketingClientId, 120);
    const marketingSessionId = cleanMarketingValue(input.marketingSessionId, 120);
    const attribution = normalizeMarketingAttribution(input.attribution);
    const landingUrl = cleanMarketingValue(input.landingUrl, 1200);
    const referrerUrl = cleanMarketingValue(input.referrerUrl, 1200);

    if (!externalSourceId || !name || !phone || !direction) {
        return {
            success: false,
            status: 400,
            error: 'externalSourceId, name, phone and direction are required',
        };
    }
    if (input.dateOfBirth && parsedDateOfBirth === undefined) {
        return {
            success: false,
            status: 400,
            error: 'dateOfBirth is invalid',
        };
    }

    const existing = await prisma.booking.findUnique({ where: { externalSourceId } });
    if (existing) {
        await linkMarketingEvents(existing.id, marketingClientId, existing.createdAt);
        return {
            success: true,
            data: {
                crmBookingId: existing.id,
                externalSourceId: existing.externalSourceId,
                status: existing.status,
            },
        };
    }

    const notes = [
        `Тип заявки: ${requestType === 'trial' ? 'пробный урок' : 'онлайн-урок'}`,
        `Уровень: ${String(input.level || 'не указан').trim()}`,
        `Удобное время: ${String(input.preferredTime || 'не указано').trim()}`,
        input.comment ? `Комментарий ученика: ${String(input.comment).trim()}` : null,
    ].filter(Boolean).join('\n');

    const booking = await prisma.booking.create({
        data: {
            externalSourceId,
            requestType,
            name,
            lastName,
            middleName: middleName || null,
            dateOfBirth: parsedDateOfBirth || null,
            phone,
            phoneDigits: phoneDigits(phone),
            direction,
            source: requestType === 'trial' ? 'Приложение — пробный урок' : 'Приложение — онлайн-урок',
            attribution: attribution || undefined,
            marketingClientId,
            marketingSessionId,
            landingUrl,
            referrerUrl,
            notes,
            createdBy: 'learning-platform',
            status: 'new',
        },
    });

    await linkMarketingEvents(booking.id, marketingClientId, booking.createdAt);

    notify('booking.created', { booking: { ...booking, _id: booking.id } }).catch(() => {});

    return {
        success: true,
        data: {
            crmBookingId: booking.id,
            externalSourceId: booking.externalSourceId,
            status: booking.status,
        },
    };
}

module.exports = { createAppOnlineLessonBooking };
