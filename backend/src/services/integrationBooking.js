const { prisma } = require('../config/db');
const { notify } = require('./notifications');

function phoneDigits(phone) {
    return phone ? String(phone).replace(/\D/g, '') : '';
}

async function createAppOnlineLessonBooking(input) {
    const requestType = input.requestType === 'trial' ? 'trial' : 'online_lesson';
    const externalSourceId = String(input.externalSourceId || '').trim();
    const name = String(input.name || '').trim();
    const lastName = String(input.lastName || '').trim();
    const middleName = String(input.middleName || '').trim();
    const phone = String(input.phone || '').trim();
    const direction = String(input.direction || '').trim();

    if (!externalSourceId || !name || !phone || !direction) {
        return {
            success: false,
            status: 400,
            error: 'externalSourceId, name, phone and direction are required',
        };
    }

    const existing = await prisma.booking.findUnique({ where: { externalSourceId } });
    if (existing) {
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
            phone,
            phoneDigits: phoneDigits(phone),
            direction,
            source: requestType === 'trial' ? 'Приложение — пробный урок' : 'Приложение — онлайн-урок',
            notes,
            createdBy: 'learning-platform',
            status: 'new',
        },
    });

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
