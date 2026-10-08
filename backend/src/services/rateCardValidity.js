// Calendar dates, inclusive at both ends. Old sentinel dates are not purchase terms.
function dateKey(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
}

function parseValidity({ validFrom, validUntil } = {}) {
    const parse = value => {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
        const date = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(date.getTime()) && dateKey(date) === value
            && value >= '2000-01-01' && value <= '2100-12-31' ? date : null;
    };
    const start = parse(validFrom), end = parse(validUntil);
    if (!start || !end || start > end) {
        throw Object.assign(new Error('Укажите корректный срок использования: дату начала и дату окончания не раньше начала.'), { statusCode: 400 });
    }
    return { validFrom: start, validUntil: end };
}

function rateCardValidOnDate(membership, date) {
    if (!membership.validFrom && !membership.validUntil) return true;
    const start = dateKey(membership.validFrom), end = dateKey(membership.validUntil), target = dateKey(date);
    return Boolean(start && end && target && start <= target && target <= end);
}

module.exports = { parseValidity, rateCardValidOnDate, dateKey };
