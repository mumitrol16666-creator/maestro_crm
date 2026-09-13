// Read-only production verification. Never creates students, payments or lessons.
require('dotenv').config();
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { prisma } = require('../src/config/db');
const { getMembershipLessonChargeAmount } = require('../src/services/lessonPricing');
const { calculateBalanceCoverage } = require('../src/services/balanceCoverage');

async function main() {
    const base = process.env.CRM_VERIFY_BASE_URL || 'http://127.0.0.1:5000';
    const admin = await prisma.student.findFirst({ where: { role: 'super_admin', status: 'active' }, select: { id: true } });
    assert.ok(admin, 'An active administrator is required for read-only API verification');
    const token = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '2m' });
    async function get(path) {
        const response = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
        const body = await response.json();
        assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
        return body;
    }
    const health = await get('/api/health');
    assert.equal(health.database, 'ok');
    if (process.env.RELEASE_SHA) assert.equal(health.releaseSha, process.env.RELEASE_SHA);
    const { directions } = await get('/api/directions');
    const active = directions.filter(direction => direction.isActive);
    assert.ok(active.length);
    const checked = [];
    for (const direction of active) {
        for (const months of [1, 2]) {
            const query = new URLSearchParams({ directionId: direction.id, lessonFormat: 'program', programMonths: months });
            const preview = await get('/api/memberships/price-preview?' + query);
            const expected = months === 2 ? 50000 : 27000;
            assert.equal(preview.totalPrice, expected);
            assert.equal(preview.validityDays, months * 30);
            assert.equal(preview.lessonCount, months * 10);
            assert.deepEqual(preview.lessonCounts, { trial: 0, individual: months * 4, theory: months * 2, group: months * 4 });
            assert.equal(preview.componentPrices.individual, months === 2 ? 3500 : 4000);
            assert.equal(preview.componentPrices.theory, 1000);
            assert.equal(preview.componentPrices.group, 2250);
            const membership = {
                id: 'read-only-check', status: 'active', lessonFormat: 'program', type: 'program',
                startDate: new Date('2099-01-01T00:00:00Z'), endDate: new Date('2099-04-01T00:00:00Z'),
                groupId: null, classesRemaining: preview.lessonCount,
                individualClassesRemaining: months * 4, theoryClassesRemaining: months * 2, groupClassesRemaining: months * 4,
                individualLessonPrice: preview.componentPrices.individual,
                theoryLessonPrice: preview.componentPrices.theory, groupLessonPrice: preview.componentPrices.group,
            };
            const lessons = Object.entries({ individual: months * 4, theory: months * 2, group: months * 4 })
                .flatMap(([classType, count]) => Array.from({ length: count }, (_, index) => ({
                    id: `${classType}-${index}`, classType, groupId: null,
                    date: new Date('2099-02-01T00:00:00Z'), startTime: '12:00', price: 99999,
                })));
            assert.equal(lessons.reduce((sum, lesson) => sum + getMembershipLessonChargeAmount(membership, lesson), 0), expected);
            const coverage = calculateBalanceCoverage({ balance: expected, memberships: [membership], lessons });
            assert.equal(coverage.coveredLessons, months * 10);
            assert.equal(coverage.remainingBalance, 0);
            checked.push({ direction: direction.name, months, total: preview.totalPrice, lessons: preview.lessonCount });
        }
        const trial = await get('/api/memberships/price-preview?' + new URLSearchParams({ directionId: direction.id, lessonFormat: 'trial' }));
        assert.equal(trial.totalPrice, 2000);
    }
    const oldPlans = await get('/api/groups/billing-plans');
    assert.equal(oldPlans.plans.length, 0, 'Historical plans must not be available for new sales');
    const sample = await prisma.membership.findFirst({ where: { status: 'active' }, select: { studentId: true } });
    if (sample) assert.equal((await get('/api/memberships/student/' + sample.studentId)).success, true);
    console.log(JSON.stringify({ release: health.releaseSha, database: health.database, checked, historicalSaleOptions: 0 }, null, 2));
}

main().then(() => prisma.$disconnect()).then(() => process.exit(0)).catch(async error => {
    console.error(error.message);
    await prisma.$disconnect();
    process.exit(1);
});
