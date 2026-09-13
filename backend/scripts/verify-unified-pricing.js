// Read-only production verification. Never creates students, payments or lessons.
require('dotenv').config();
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { prisma } = require('../src/config/db');
const { getMembershipLessonChargeAmount } = require('../src/services/lessonPricing');
const { calculateBalanceCoverage } = require('../src/services/balanceCoverage');

function verifyDiscountConsumption(preview) {
    const membership = {
        id: 'readonly-discount', status: 'active', lessonFormat: 'program',
        startDate: new Date('2099-01-01'), endDate: new Date('2099-04-01'),
        classesRemaining: preview.lessonCount, groupId: null,
        individualClassesRemaining: preview.lessonCounts.individual,
        theoryClassesRemaining: preview.lessonCounts.theory,
        groupClassesRemaining: preview.lessonCounts.group,
        individualBudgetRemaining: preview.componentTotals.individual,
        individualLessonPrice: preview.componentPrices.individual,
        theoryLessonPrice: preview.componentPrices.theory, groupLessonPrice: preview.componentPrices.group,
    };
    const simulated = { ...membership };
    const lessons = [];
    let total = 0;
    for (const classType of ['individual', 'theory', 'group']) {
        for (let i = 0; i < preview.lessonCounts[classType]; i += 1) {
            const lesson = { id: `${classType}-${i}`, classType, date: new Date('2099-02-01'), startTime: '12:00', price: 99999 };
            const amount = getMembershipLessonChargeAmount(simulated, lesson);
            total += amount;
            simulated[`${classType}ClassesRemaining`] -= 1;
            if (classType === 'individual') simulated.individualBudgetRemaining -= amount;
            lessons.push(lesson);
        }
    }
    assert.equal(total, preview.totalPrice);
    assert.equal(simulated.individualBudgetRemaining, 0);
    const coverage = calculateBalanceCoverage({ balance: preview.totalPrice, memberships: [membership], lessons });
    assert.equal(coverage.coveredLessons, preview.lessonCount);
    assert.equal(coverage.remainingBalance, 0);
}

async function main() {
    const base = process.env.CRM_VERIFY_BASE_URL || 'http://127.0.0.1:5000';
    const admin = await prisma.student.findFirst({ where: { role: 'super_admin', status: 'active' }, select: { id: true } });
    assert.ok(admin, 'An active administrator is required for read-only API verification');
    const token = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '2m' });
    async function get(path, expectedStatus = 200) {
        const response = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
        const body = await response.json();
        assert.equal(response.status, expectedStatus, `${path}: HTTP ${response.status}`);
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
            verifyDiscountConsumption(preview);
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
    const additionalDiscountChecks = [];
    const discountCases = [
        { months: 1, type: 'percent', value: '10', expected: 24300 },
        { months: 2, type: 'percent', value: '10', expected: 45000 },
        { months: 2, type: 'amount', value: '1001', expected: 48999 },
        { months: 2, type: 'percent', value: '7.33', expected: 46335 },
        { months: 2, type: 'amount', value: '28000', expected: 22000 },
    ];
    for (const scenario of discountCases) {
        const query = new URLSearchParams({
            directionId: active[0].id, lessonFormat: 'program', programMonths: scenario.months,
            additionalDiscountType: scenario.type, additionalDiscountValue: scenario.value,
            additionalDiscountReason: 'Read-only verification',
        });
        const preview = await get('/api/memberships/price-preview?' + query);
        assert.equal(preview.totalPrice, scenario.expected);
        assert.equal(preview.componentTotals.group, scenario.months * 9000);
        assert.equal(preview.componentTotals.theory, scenario.months * 2000);
        verifyDiscountConsumption(preview);
        additionalDiscountChecks.push({ ...scenario, verified: true });
    }
    for (const invalid of [
        { additionalDiscountType: 'amount', additionalDiscountValue: '28001', additionalDiscountReason: 'Over cap' },
        { additionalDiscountType: 'percent', additionalDiscountValue: '10', additionalDiscountReason: '' },
        { additionalDiscountType: 'percent', additionalDiscountValue: '7.333', additionalDiscountReason: 'Bad precision' },
    ]) {
        const query = new URLSearchParams({ directionId: active[0].id, lessonFormat: 'program', programMonths: '2', ...invalid });
        await get('/api/memberships/price-preview?' + query, 400);
    }
    const oldPlans = await get('/api/groups/billing-plans');
    assert.equal(oldPlans.plans.length, 0, 'Historical plans must not be available for new sales');
    const sample = await prisma.membership.findFirst({ where: { status: 'active' }, select: { studentId: true } });
    if (sample) assert.equal((await get('/api/memberships/student/' + sample.studentId)).success, true);
    console.log(JSON.stringify({ release: health.releaseSha, database: health.database, checked, additionalDiscountChecks, invalidDiscountsRejected: 3, historicalSaleOptions: 0 }, null, 2));
}

main().then(() => prisma.$disconnect()).then(() => process.exit(0)).catch(async error => {
    console.error(error.message);
    await prisma.$disconnect();
    process.exit(1);
});
