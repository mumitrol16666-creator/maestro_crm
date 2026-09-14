const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { calculateProgramPrice } = require('../src/utils/pricing');

const routePath = require.resolve('../src/routes/memberships');
const routeSource = fs.readFileSync(routePath, 'utf8');
const routeRequire = createRequire(routePath);
const rates = { trial: 2000, individual: 4000, theory: 1000, group: 2250 };

function harness(previous = null, { successor = null } = {}) {
    const created = [];
    const studentUpdates = [];
    const transactions = [];
    const selectedIds = [];
    const student = { id: 'student', activeMembershipId: previous?.id || null };
    const tx = {
        $queryRaw: async () => [{ id: 'student' }],
        membership: {
            findUnique: async ({ where }) => {
                selectedIds.push(where.id);
                return previous?.id === where.id ? previous : null;
            },
            findFirst: async ({ where }) => where.previousMembershipId ? successor : null,
            update: async () => { throw new Error('A purchased membership must never be rewritten by renewal'); },
            create: async ({ data }) => {
                const result = { ...data, id: `purchase-${created.length + 1}` };
                created.push(result);
                return result;
            },
        },
        membershipTransaction: { create: async ({ data }) => { transactions.push(data); return data; } },
        student: {
            findUnique: async () => student,
            update: async ({ data }) => { studentUpdates.push(data); return { ...student, ...data }; },
        },
        direction: { findUnique: async () => ({ id: 'direction', name: 'Гитара', isActive: true }) },
        class: { findFirst: async () => ({ teacherId: 'trial-teacher', id: 'trial-class' }) },
    };
    tx.$transaction = async callback => callback(tx);
    const handlers = new Map();
    const router = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [method, (path, ...callbacks) => {
        handlers.set(`${method} ${path}`, callbacks.at(-1));
    }]));
    const middleware = (req, res, next) => next();
    const customRequire = id => {
        if (id === 'express') return { Router: () => router };
        if (id === '../config/db') return { prisma: tx };
        if (id === '../middleware/auth') return { authenticate: middleware, requireAdmin: middleware };
        if (id === '../utils/pricing') return {
            ...routeRequire(id),
            computeMembershipPrice: async ({ lessonFormat, programMonths }) => calculateProgramPrice(rates, lessonFormat, programMonths),
        };
        if (id === '../utils/recovery') return { autoRecoverStudent: async () => false };
        if (id === '../services/scheduleGenerator') return { generateClassesForGroupInRange: async () => ({ created: 0 }) };
        if (id === '../services/freezeService') return { createFreezeForMembership: async () => null };
        return routeRequire(id);
    };
    vm.runInNewContext(routeSource, { require: customRequire, module: { exports: {} }, console: { error() {} } }, { filename: routePath });
    return {
        created, transactions, studentUpdates, selectedIds,
        async request(body, method = 'post', path = '/') {
            const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
            await handlers.get(`${method} ${path}`)({ body, user: { id: 'admin' }, params: { id: previous?.id } }, res);
            return res;
        },
    };
}

function purchase(months = 1) {
    const price = calculateProgramPrice(rates, 'program', months);
    return {
        id: 'selected-old', studentId: 'student', directionId: 'direction', groupId: null,
        type: 'program', lessonFormat: 'program', status: 'active',
        startDate: new Date('2099-09-01T00:00:00Z'), endDate: new Date('2099-10-01T00:00:00Z'),
        totalPrice: price.totalPrice, totalClasses: price.lessonCount, classesRemaining: 3, classesUsed: price.lessonCount - 3,
        individualLessonPrice: price.componentPrices.individual, theoryLessonPrice: 1000, groupLessonPrice: 2250,
        individualClassesRemaining: 1, theoryClassesRemaining: 1, groupClassesRemaining: 1,
        paidAmount: price.totalPrice, paymentStatus: 'paid',
    };
}

for (const [beforeMonths, afterMonths] of [[1, 2], [2, 1], [2, 2]]) {
    test(`renewal ${beforeMonths}m → ${afterMonths}m preserves purchased prices and creates exact linked balance`, async () => {
        const previous = purchase(beforeMonths);
        const before = structuredClone(previous);
        const app = harness(previous);
        const result = await app.request({
            studentId: 'student', directionId: 'direction', lessonFormat: 'program', programMonths: afterMonths,
            renewMembershipId: previous.id,
            startDate: '2026-09-01', endDate: '2026-09-30', // An old cached client must not shorten the renewal.
        });
        assert.equal(result.statusCode, 201);
        assert.deepEqual(previous, before);
        assert.deepEqual(app.selectedIds, [previous.id]);
        assert.equal(app.created.length, 1);
        const next = app.created[0];
        assert.equal(next.previousMembershipId, previous.id);
        assert.equal(next.startDate.toISOString(), previous.endDate.toISOString());
        assert.equal((next.endDate - next.startDate) / 86400000, afterMonths * 60);
        assert.equal(next.totalPrice, afterMonths === 2 ? 50000 : 27000);
        assert.equal(next.individualClassesRemaining, afterMonths * 4);
        assert.equal(next.theoryClassesRemaining, afterMonths * 2);
        assert.equal(next.groupClassesRemaining, afterMonths * 4);
        assert.equal(next.totalPrice, next.individualClassesRemaining * next.individualLessonPrice
            + next.theoryClassesRemaining * next.theoryLessonPrice + next.groupClassesRemaining * next.groupLessonPrice);
        assert.equal(next.teacherId, 'trial-teacher');
        assert.equal(next.paidAmount, 0);
        assert.equal(app.studentUpdates.length, 0);
        assert.equal(app.transactions.length, 1);
    });
}

test('explicit renewal cannot silently target another purchase or duplicate a successor', async () => {
    const previous = purchase();
    const missing = harness(previous);
    assert.equal((await missing.request({ studentId: 'student', directionId: 'direction', lessonFormat: 'program', renewMembershipId: 'not-selected' })).statusCode, 400);
    assert.equal(missing.created.length, 0);
    const duplicate = harness(previous, { successor: { id: 'next' } });
    assert.equal((await duplicate.request({ studentId: 'student', directionId: 'direction', lessonFormat: 'program', renewMembershipId: previous.id })).statusCode, 400);
    assert.equal(duplicate.created.length, 0);
});

test('an expired purchase renews for a full new period starting now', async () => {
    const previous = { ...purchase(), status: 'expired', endDate: new Date('2020-01-01') };
    const app = harness(previous);
    const before = Date.now();
    const result = await app.request({ studentId: 'student', directionId: 'direction', lessonFormat: 'program', programMonths: 2, renewMembershipId: previous.id });
    assert.equal(result.statusCode, 201);
    assert.ok(app.created[0].startDate.getTime() >= before);
    assert.equal((app.created[0].endDate - app.created[0].startDate) / 86400000, 120);
    assert.equal(app.studentUpdates[0].activeMembershipId, app.created[0].id);
});

test('new purchases have fixed prices even if an outdated client submits an override', async () => {
    const app = harness();
    const result = await app.request({ studentId: 'student', directionId: 'direction', lessonFormat: 'program', programMonths: 2, forceNew: true, manualFinalPrice: 1, manualDiscountPercent: 100, startDate: '2099-01-01', endDate: '2099-01-02' });
    assert.equal(result.statusCode, 201);
    assert.equal(app.created[0].totalPrice, 50000);
    assert.equal(app.created[0].previousMembershipId, null);
    assert.equal((app.created[0].endDate - app.created[0].startDate) / 86400000, 120);
    assert.equal((await app.request({ totalPrice: 1 }, 'patch', '/:id/price')).statusCode, 400);
});
