require('dotenv').config({ quiet: true });
const { prisma } = require('../src/config/db');

async function capture(db) {
    const [groups, memberships, plans, directions, students] = await Promise.all([
        db.group.findMany({ include: { billingPlans: true, students: { where: { status: 'active' }, select: { studentId: true } } } }),
        db.membership.findMany({ where: { status: { in: ['active', 'frozen', 'expired'] } }, include: { plan: true, direction: true }, orderBy: { createdAt: 'desc' } }),
        db.membershipPlan.findMany(),
        db.direction.findMany(),
        db.student.findMany({ where: { role: 'student' }, select: { id: true, name: true, lastName: true, status: true, accountBalance: true, activeMembershipId: true } }),
    ]);
    return { capturedAt: new Date().toISOString(), groups, memberships, plans, directions, students };
}
if (require.main === module) {
    capture(prisma).then(result => process.stdout.write(JSON.stringify(result)))
        .catch(error => { console.error(error.message); process.exitCode = 1; })
        .finally(() => prisma.$disconnect());
}
module.exports = { capture };
