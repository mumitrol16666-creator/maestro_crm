const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

if (!process.env.TEST_DATABASE_URL) {
    test('student list/card coverage over HTTP', { skip: 'TEST_DATABASE_URL is required' }, () => {});
} else {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && /(?:test|qa)/.test(url.pathname));
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL,
        JWT_SECRET: 'student-coverage-local-test' });
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const { prisma } = require('../src/config/db');
    const { rateCardMembershipData } = require('../src/services/rateCards');
    let server, base, token;
    const marker = `CoverageQA${randomUUID()}`;
    const studentIds = [], groupIds = [];

    async function makeStudent(extra = {}) {
        const student = await prisma.student.create({ data: {
            name: 'Coverage', lastName: marker, phone: randomUUID(), password: 'unused', ...extra,
        } });
        studentIds.push(student.id);
        return student;
    }
    async function fixture({ balance, rates, lessons, emergencyFreezesAvailable = 0 }) {
        const student = await makeStudent({ accountBalance: balance });
        const membership = await prisma.membership.create({ data: rateCardMembershipData({
            studentId: student.id, name: 'Тариф проверки', rates, emergencyFreezesAvailable,
        }) });
        const groups = {};
        for (const [index, kind] of lessons.entries()) {
            if (kind !== 'individual' && !groups[kind]) {
                const group = await prisma.group.create({ data: { name: marker, direction: 'Гитара', billingType: kind } });
                groupIds.push(group.id);
                groups[kind] = group.id;
                await prisma.studentGroup.create({ data: { studentId: student.id, groupId: group.id } });
            }
            await prisma.class.create({ data: {
                title: marker, date: new Date(Date.UTC(2099, 0, index + 1)),
                startTime: '10:00', endTime: '10:45', price: 0,
                classType: kind === 'individual' ? 'individual' : 'group',
                ...(kind === 'individual' ? { individualStudentId: student.id } : { groupId: groups[kind] }),
            } });
        }
        return { student, membership };
    }
    async function get(path) {
        const res = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.json();
        assert.equal(res.status, 200, JSON.stringify(body));
        return body;
    }
    async function compare(student, membership) {
        const list = await get(`?search=${encodeURIComponent(marker)}&limit=100`);
        const listed = list.students.find(s => s.id === student.id);
        assert.ok(listed);
        const { student: card } = await get(`/${student.id}`);
        assert.deepEqual(listed.balanceCoverage, card.balanceCoverage);
        assert.equal(listed.activeMembership.billingModel, 'rate_card');
        assert.equal(listed.activeMembership.tariffName, membership.tariffName);
        assert.deepEqual(listed.activeMembership.lessonRates, membership.lessonRates);
        assert.equal(listed.accountBalance, student.accountBalance);
        assert.equal(card.accountBalance, student.accountBalance);
        return listed.balanceCoverage;
    }
    test.before(async () => {
        const admin = await makeStudent({ role: 'admin' });
        token = jwt.sign({ userId: admin.id }, process.env.JWT_SECRET);
        const app = express();
        app.use('/students', require('../src/routes/students'));
        await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
        base = `http://127.0.0.1:${server.address().port}/students`;
    });
    test.after(async () => {
        if (server) await new Promise(resolve => server.close(resolve));
        await prisma.class.deleteMany({ where: { title: marker } });
        await prisma.membership.deleteMany({ where: { studentId: { in: studentIds } } });
        await prisma.group.deleteMany({ where: { id: { in: groupIds } } });
        await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
        await prisma.$disconnect();
    });

    test('list matches card for a discounted mixed tariff with group-based theory', async () => {
        const { student, membership } = await fixture({ balance: 13250,
            rates: { quartet: 2250, theory: 1000, individual: { basePrice: 4000, discountAmount: 750, reason: 'QA' } },
            lessons: Array(3).fill(['quartet', 'theory', 'individual']).flat(), emergencyFreezesAvailable: 1 });
        const coverage = await compare(student, membership);
        assert.equal(coverage.coveredLessons, 6);
        assert.equal(coverage.remainingBalance, 250);
        assert.equal(coverage.stopReason, 'insufficient_balance');
        assert.equal(coverage.emergencyCancellationsRemaining, 1);
    });
    test('list uses the duo rate even when the legacy group price is empty', async () => {
        const { student, membership } = await fixture({ balance: 29250,
            rates: { duo: 2750, individual: 4000 }, lessons: Array(4).fill(['duo', 'duo', 'individual']).flat() });
        assert.equal(membership.groupLessonPrice, null);
        const coverage = await compare(student, membership);
        assert.equal(coverage.coveredLessons, 9);
        assert.equal(coverage.remainingBalance, 750);
    });
    test('list recognises an individual tariff without group membership', async () => {
        const { student, membership } = await fixture({ balance: 23100,
            rates: { individual: 3750 }, lessons: Array(7).fill('individual') });
        const coverage = await compare(student, membership);
        assert.equal(coverage.coveredLessons, 6);
        assert.equal(coverage.nextLesson.chargeAmount, 3750);
    });
    test('a genuinely missing rate still blocks the forecast', async () => {
        const { student, membership } = await fixture({ balance: 29250,
            rates: { individual: 4000 }, lessons: ['duo', 'individual'] });
        const coverage = await compare(student, membership);
        assert.equal(coverage.coveredLessons, 0);
        assert.equal(coverage.stopReason, 'price_unavailable');
    });
    test('free lessons remain covered with zero balance', async () => {
        const { student, membership } = await fixture({ balance: 0,
            rates: { duo: { basePrice: 0, reason: 'QA free lesson' } }, lessons: ['duo'] });
        const coverage = await compare(student, membership);
        assert.equal(coverage.coveredLessons, 1);
        assert.equal(coverage.stopReason, 'all_scheduled_covered');
    });
}
