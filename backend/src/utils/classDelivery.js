const CLASS_DELIVERY_FORMATS = new Set(['offline', 'online']);

function normalizeMeetingUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return { value: null };
    if (raw.length > 1024) {
        return { error: 'Ссылка на онлайн-урок не должна превышать 1024 символа' };
    }
    try {
        const parsed = new URL(raw);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return { error: 'Ссылка на онлайн-урок должна начинаться с http:// или https://' };
        }
        return { value: parsed.toString() };
    } catch (_) {
        return { error: 'Укажите корректную ссылку на онлайн-урок' };
    }
}

module.exports = {
    CLASS_DELIVERY_FORMATS,
    normalizeMeetingUrl,
};
