const { KASPI_PAY_LINK } = require('./paymentMethods');
const { TRIAL_LESSON_PRICE } = require('./trialPolicy');

const SCHOOL_TIME_ZONE = process.env.SCHOOL_TIME_ZONE || 'Asia/Aqtobe';
const SCHOOL_ADDRESS = process.env.SCHOOL_ADDRESS || 'Марата Оспанова, 52/2';

function normalizeExternalUrl(value) {
    const url = String(value || '').trim();
    if (!url) return '';
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function whatsappPhoneDigits(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
    if (digits.length === 10) digits = `7${digits}`;
    return digits;
}

function formatTrialDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    return {
        date: new Intl.DateTimeFormat('ru-RU', {
            timeZone: SCHOOL_TIME_ZONE,
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        }).format(date),
        time: new Intl.DateTimeFormat('ru-RU', {
            timeZone: SCHOOL_TIME_ZONE,
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        }).format(date),
    };
}

function buildTrialInvitation(booking) {
    const scheduled = formatTrialDateTime(booking?.trialScheduledAt);
    if (!scheduled) return null;

    const clientName = String(booking?.name || '').trim();
    const greeting = clientName ? `Здравствуйте, ${clientName}!` : 'Здравствуйте!';
    const direction = String(booking?.direction || '').trim();
    const paymentLink = normalizeExternalUrl(KASPI_PAY_LINK);
    const phone = whatsappPhoneDigits(booking?.phone);
    const message = [
        `${greeting} 🎵`,
        '',
        'Вы записаны на пробный урок в музыкальной школе Maestro.',
        '',
        `📅 ${scheduled.date}`,
        `🕒 ${scheduled.time}`,
        ...(direction ? [`🎸 Направление: ${direction}`] : []),
        `📍 Адрес: ${SCHOOL_ADDRESS}`,
        '',
        `Стоимость пробного урока — ${TRIAL_LESSON_PRICE.toLocaleString('ru-RU')} ₸.`,
        'Оплатить можно по ссылке:',
        paymentLink,
        '',
        'Если у вас есть свой инструмент, возьмите его с собой. И обязательно захватите хорошее настроение 😊',
        '',
        'Если появятся вопросы, напишите нам в этот чат. До встречи!',
    ].filter((line) => line !== null && line !== undefined).join('\n');

    return {
        clientName,
        phone,
        message,
        paymentLink,
        address: SCHOOL_ADDRESS,
        scheduledDate: scheduled.date,
        scheduledTime: scheduled.time,
        whatsappUrl: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : '',
    };
}

module.exports = {
    SCHOOL_ADDRESS,
    buildTrialInvitation,
    formatTrialDateTime,
    normalizeExternalUrl,
    whatsappPhoneDigits,
};
