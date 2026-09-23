function freezeLedgerConflict() {
    return Object.assign(new Error('История экстренных отмен не совпадает с остатком. Проверьте операции тарифа перед изменением урока.'), {
        code: 'EMERGENCY_FREEZE_LEDGER_CONFLICT', statusCode: 409,
    });
}

// Both event types have amount=0. Count events for one class, separately for
// each membership, so reopening cannot restore a right used by another lesson.
function outstandingClassFreezes(transactions) {
    const counts = new Map();
    for (const entry of transactions) {
        if (!['freeze_used', 'freeze_restored'].includes(entry.type)) continue;
        counts.set(entry.membershipId, (counts.get(entry.membershipId) || 0) + (entry.type === 'freeze_used' ? 1 : -1));
    }
    const outstanding = [];
    for (const [membershipId, count] of counts) {
        if (count < 0) throw freezeLedgerConflict();
        if (count > 0) outstanding.push({ membershipId, count });
    }
    return outstanding;
}

module.exports = { outstandingClassFreezes, freezeLedgerConflict };
