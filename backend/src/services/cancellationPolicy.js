const SCHOOL_TIME_ZONE = process.env.SCHOOL_TIME_ZONE || 'Asia/Aqtobe';
const FREE_CANCELLATION_CUTOFF_MINUTES = 19 * 60;

const dateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHOOL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
});

function zonedDateTimeParts(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('Некорректная дата отмены');
    const parts = dateTimeFormatter.formatToParts(date).reduce((result, part) => {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
    }, {});
    return {
        dateKey: `${parts.year}-${parts.month}-${parts.day}`,
        minutes: Number(parts.hour) * 60 + Number(parts.minute),
    };
}

function previousCivilDateKey(dateKey) {
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
}

function classifyCancellation({ classDateKey, now = new Date() }) {
    const current = zonedDateTimeParts(now);
    const previousDateKey = previousCivilDateKey(classDateKey);

    if (current.dateKey < previousDateKey) return 'free';
    if (current.dateKey === previousDateKey && current.minutes < FREE_CANCELLATION_CUTOFF_MINUTES) return 'free';
    if (current.dateKey === classDateKey) return 'emergency';
    return 'charge';
}

module.exports = {
    SCHOOL_TIME_ZONE,
    FREE_CANCELLATION_CUTOFF_MINUTES,
    zonedDateTimeParts,
    previousCivilDateKey,
    classifyCancellation,
};
