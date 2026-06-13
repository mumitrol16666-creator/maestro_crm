/**
 * Парсинг времени HH:MM в минуты от полуночи.
 */
function timeToMinutes(timeStr) {
    const [h, m] = String(timeStr || '0:0').split(':').map(Number);
    return h * 60 + (m || 0);
}

/**
 * Пересекаются ли два интервалов [start, end) в минутах.
 */
function intervalsOverlap(startA, endA, startB, endB) {
    return startA < endB && startB < endA;
}

module.exports = { timeToMinutes, intervalsOverlap };
