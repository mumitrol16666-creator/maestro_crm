const { isRateCard, getRateCardPrice } = require('./rateCards');
const { normalizeScheduleDate } = require('./classScheduleGuard');

function isIndividualMembership(membership) {
    if (!membership || membership.status !== 'active') return false;
    if (isRateCard(membership)) return getRateCardPrice(membership, { classType: 'individual' }) !== null;
    return ['individual_package', 'individual_single', 'trial'].includes(membership.type)
        || ['individual', 'mixed', 'program'].includes(membership.lessonFormat);
}

function individualScheduleRange(membership, now = new Date()) {
    let startDate = normalizeScheduleDate(now);
    let endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + 90);
    const start = isRateCard(membership) ? membership.validFrom : membership?.startDate;
    const end = isRateCard(membership) ? membership.validUntil : membership?.endDate;
    if (start && new Date(start) > startDate) startDate = new Date(start);
    if (end && new Date(end) < endDate) endDate = new Date(end);
    return { startDate, endDate };
}

module.exports = { isIndividualMembership, individualScheduleRange };
