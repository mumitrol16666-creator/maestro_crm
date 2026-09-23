// Old deductions used amount=0 as an event marker. They must be reversed by
// zero-unit add events, independently of later quantity-based deductions.
function outstandingClassCharges(transactions) {
    const byMembership = new Map();
    for (const entry of transactions) {
        if (!['deduct', 'manual_deduct', 'add'].includes(entry.type)) continue;
        const net = byMembership.get(entry.membershipId) || { units: 0, zeroEvents: 0, money: 0 };
        const sign = entry.type === 'add' ? -1 : 1;
        if (entry.amount === 0) net.zeroEvents += sign;
        else net.units += sign * entry.amount;
        net.money += sign * Number(entry.chargeAmount || 0);
        byMembership.set(entry.membershipId, net);
    }
    const reversals = [];
    for (const [membershipId, net] of byMembership) {
        const amounts = net.units > 0 ? [net.units] : [];
        for (let i = 0; i < net.zeroEvents; i++) amounts.push(0);
        amounts.forEach((amount, index) => reversals.push({ membershipId, amount, chargeAmount: index === 0 ? net.money : 0 }));
    }
    return reversals;
}

module.exports = { outstandingClassCharges };
