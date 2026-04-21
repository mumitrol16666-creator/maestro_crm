// =====================================================
// Чистые функции для аналитики: LTV, средний чек, средняя продолжительность,
// конверсия пробный -> абонемент.
// Используются backend/src/routes/analytics.js.
// =====================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30.4375;

/**
 * Средний чек по массиву платежей.
 * completedOnly — берём только status=completed.
 */
function computeAvgCheck(payments, { completedOnly = true } = {}) {
    const list = (payments || []).filter(p => !completedOnly || p.status === 'completed');
    if (list.length === 0) return 0;
    const sum = list.reduce((acc, p) => acc + Number(p.amount || 0), 0);
    return Math.round(sum / list.length);
}

/**
 * LTV на ученика: сумма всех completed-платежей одного ученика.
 */
function computeLtv(payments, { completedOnly = true } = {}) {
    const list = (payments || []).filter(p => !completedOnly || p.status === 'completed');
    return list.reduce((acc, p) => acc + Number(p.amount || 0), 0);
}

/**
 * Средний LTV по нескольким ученикам.
 * payments — {[studentId]: Payment[]}
 */
function computeAvgLtv(paymentsByStudent) {
    const studentIds = Object.keys(paymentsByStudent || {});
    if (studentIds.length === 0) return 0;
    const totals = studentIds.map(id => computeLtv(paymentsByStudent[id]));
    const sum = totals.reduce((a, b) => a + b, 0);
    return Math.round(sum / studentIds.length);
}

/**
 * Средняя продолжительность (в месяцах) жизни ученика в школе.
 * Берём по каждому ученику (MAX(endDate) - MIN(startDate)) / 30.4375.
 *
 * @param {Object} memsByStudent - {[studentId]: Membership[]}
 * @param {Object} opts
 * @param {boolean} [opts.onlyChurned=false] - брать только ушедших (endDate < now и нет активного)
 */
function computeAvgLifespanMonths(memsByStudent, { onlyChurned = false } = {}) {
    const now = Date.now();
    const spans = [];

    for (const studentId of Object.keys(memsByStudent || {})) {
        const list = memsByStudent[studentId] || [];
        if (list.length === 0) continue;

        let minStart = Infinity;
        let maxEnd = -Infinity;
        let hasActive = false;

        for (const m of list) {
            const s = m.startDate ? new Date(m.startDate).getTime() : null;
            const e = m.endDate ? new Date(m.endDate).getTime() : null;
            if (s !== null && s < minStart) minStart = s;
            if (e !== null && e > maxEnd) maxEnd = e;
            if (e !== null && e >= now && m.status === 'active') hasActive = true;
        }

        if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) continue;
        if (onlyChurned && hasActive) continue;

        const months = (maxEnd - minStart) / MS_PER_DAY / DAYS_PER_MONTH;
        if (months >= 0) spans.push(months);
    }

    if (spans.length === 0) return 0;
    const sum = spans.reduce((a, b) => a + b, 0);
    return +(sum / spans.length).toFixed(1);
}

/**
 * Конверсия "пробный -> абонемент".
 * trialStudentIds — набор ID учеников, купивших пробный.
 * nonTrialStudentIds — набор ID учеников, у которых потом был non-trial membership.
 * Возвращает {total, converted, percent}.
 */
function computeTrialConversion(trialStudentIds, nonTrialStudentIds) {
    const total = new Set(trialStudentIds || []).size;
    if (total === 0) return { total: 0, converted: 0, percent: 0 };
    const nonTrial = new Set(nonTrialStudentIds || []);
    let converted = 0;
    for (const id of new Set(trialStudentIds)) {
        if (nonTrial.has(id)) converted++;
    }
    return {
        total,
        converted,
        percent: Math.round((converted / total) * 100)
    };
}

/**
 * Разницa в днях между датами (e - s), целое число.
 */
function daysBetween(s, e) {
    if (!s || !e) return 0;
    return Math.round((new Date(e).getTime() - new Date(s).getTime()) / MS_PER_DAY);
}

module.exports = {
    computeAvgCheck,
    computeLtv,
    computeAvgLtv,
    computeAvgLifespanMonths,
    computeTrialConversion,
    daysBetween,
    MS_PER_DAY,
    DAYS_PER_MONTH,
};
