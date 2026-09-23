// Snapshot only: never changes data. Keep output private (student names/financial data).
async function capture(db, options = {}) {
    const asOf = options.asOf || new Date().toISOString();
    const horizon = new Date(asOf);
    if (!Number.isFinite(horizon.getTime())) throw new Error('Некорректная дата снимка');
    horizon.setUTCDate(horizon.getUTCDate() + 14);
    const [groups, memberships, plans, directions, students, lessons, transactions, trialBookings, freezes] = await Promise.all([
        db.group.findMany({ include: { billingPlans: true, students: { where: { status: { in: ['active', 'Active', 'frozen'] } }, select: { studentId: true, status: true } } } }),
        db.membership.findMany({ where: { status: { in: ['active', 'frozen', 'expired', 'archived'] } }, include: { plan: true, direction: true }, orderBy: { id: 'asc' } }),
        db.membershipPlan.findMany(), db.direction.findMany(),
        db.student.findMany({ where: { role: 'student' }, select: { id: true, name: true, lastName: true, status: true, pausedUntil: true, accountBalance: true, activeMembershipId: true } }),
        db.class.findMany({ where: { status: { in: ['scheduled', 'started', 'not_filled', 'pending_admin_review'] }, date: { lte: horizon }, isPractice: false, classType: { in: ['individual', 'group', 'theory'] } },
            select: { id: true, groupId: true, individualStudentId: true, classType: true, date: true, status: true, isPractice: true,
                attendees: { select: { studentId: true, attendanceStatus: true } } } }),
        db.membershipTransaction.findMany({ where: { type: { in: ['initial', 'freeze_used', 'freeze_restored'] } },
            select: { id: true, membershipId: true, type: true, amount: true, reason: true, classId: true, date: true } }),
        db.booking.findMany({ where: { trialClassId: { not: null } }, select: { id: true, trialClassId: true } }),
        db.freeze.findMany({ where: { status: { in: ['pending', 'active'] } } }),
    ]);
    const trialIds = new Set(trialBookings.map(b => b.trialClassId));
    return { capturedAt: asOf, horizon: horizon.toISOString(), groups, memberships, plans, directions, students, lessons: lessons.filter(l => !trialIds.has(l.id)), transactions, trialBookings, freezes };
}
async function readSnapshot(db, options = {}) {
    return db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
        return capture(tx, options);
    }, { isolationLevel: 'RepeatableRead', timeout: 60000 });
}
if (require.main === module) {
    require('dotenv').config({ quiet: true });
    const { prisma } = require('../src/config/db');
    readSnapshot(prisma).then(result => process.stdout.write(JSON.stringify(result, null, 2)))
        .catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}
module.exports = { capture, readSnapshot };
