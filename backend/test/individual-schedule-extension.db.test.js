const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

if (!process.env.TEST_DATABASE_URL) {
    test('individual schedule extension and validity HTTP', { skip: 'TEST_DATABASE_URL is required' }, () => {});
} else {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && /test|qa/.test(url.pathname));
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL, JWT_SECRET: 'schedule-validity-tests' });
    const { prisma } = require('../src/config/db');
    const { rateCardMembershipData } = require('../src/services/rateCards');
    const { getStudentRegularSchedule, updateStudentRegularSchedule } = require('../src/services/studentSchedule');
    const { extendStudentIndividualSchedule } = require('../src/services/individualScheduleExtension');
    const { deductMembershipForClass } = require('../src/services/classMembership');
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const now = new Date('2030-01-03T06:00:00Z');
    let server, base, admin, token;
    const user = extra => prisma.student.create({ data: { name: 'Schedule QA', lastName: randomUUID(), phone: randomUUID(), password: 'unused', ...extra } });
    async function fixture(rates = { individual: 4000 }) {
        const teacher = await user({ role: 'teacher' });
        const room = await prisma.room.create({ data: { name: randomUUID() } });
        const student = await user({ accountBalance: 24000, assignedTeacherId: teacher.id });
        const membership = await prisma.membership.create({ data: rateCardMembershipData({ studentId: student.id, name: 'Индивидуально · 1 месяц', rates }) });
        await prisma.student.update({ where: { id: student.id }, data: { activeMembershipId: membership.id } });
        await prisma.studentSchedule.createMany({ data: [6, 7].map(dayOfWeek => ({ studentId: student.id, dayOfWeek, time: '14:00', duration: 45, roomId: room.id })) });
        return { student, membership, teacher, room };
    }
    const classes = s => prisma.class.findMany({ where: { individualStudentId: s.id }, orderBy: [{ date: 'asc' }, { startTime: 'asc' }] });
    async function request(path, body, method = 'POST', auth = token) {
        const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() };
    }
    test.before(async () => {
        admin = await user({ role: 'admin' }); token = jwt.sign({ id: admin.id }, process.env.JWT_SECRET);
        const app = express(); app.use(express.json()); app.use('/memberships', require('../src/routes/memberships'));
        app.use('/students', require('../src/routes/students'));
        await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); base = `http://127.0.0.1:${server.address().port}`;
    });
    test.after(async () => { await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); });

    test('saved individual rows with a rate card get calendar lessons; concurrent maintenance does not duplicate or charge', async () => {
        const { student } = await fixture();
        const schedule = await getStudentRegularSchedule(student.id);
        assert.equal(schedule.data.hasIndividualMembership, true);
        assert.equal(schedule.data.individualSchedule.schedules.length, 2);
        const preview = await extendStudentIndividualSchedule(student.id, { now, dryRun: true });
        assert.ok(preview.planned >= 24);
        assert.equal((await classes(student)).length, 0);
        assert.equal((await prisma.student.findUnique({ where: { id: student.id } })).individualScheduleGeneratedThrough, null);
        const results = await Promise.all([1, 2].map(() => extendStudentIndividualSchedule(student.id, { now })));
        const rows = await classes(student);
        assert.ok(rows.length >= 24 && rows.length <= 28, rows.length);
        assert.equal(results.reduce((sum, r) => sum + r.created, 0), rows.length);
        assert.equal(new Set(rows.map(c => `${c.date}|${c.startTime}`)).size, rows.length);
        assert.equal((await prisma.student.findUnique({ where: { id: student.id } })).accountBalance, 24000);
        assert.equal(await prisma.membershipTransaction.count({ where: { membership: { studentId: student.id } } }), 0);
    });

    test('maintenance preserves a cancelled lesson and a lesson moved to another date', async () => {
        const { student } = await fixture();
        await extendStudentIndividualSchedule(student.id, { now });
        const rows = await classes(student);
        await prisma.class.update({ where: { id: rows[0].id }, data: { status: 'cancelled' } });
        const movedDate = new Date(rows[1].date); movedDate.setUTCDate(movedDate.getUTCDate() + 1);
        await prisma.class.update({ where: { id: rows[1].id }, data: { date: movedDate } });
        await extendStudentIndividualSchedule(student.id, { now: new Date('2030-01-10T06:00:00Z') });
        const after = await classes(student);
        assert.equal(after.find(c => c.id === rows[0].id).status, 'cancelled');
        assert.equal(after.find(c => c.id === rows[1].id).date.toISOString(), movedDate.toISOString());
        assert.equal(after.some(c => c.date.toISOString() === rows[1].date.toISOString()), false);
        assert.equal(after.filter(c => c.date.toISOString() === rows[0].date.toISOString()).length, 1);
    });

    test('the old generation horizon is retained when migration did not set a watermark', async () => {
        const { student, teacher, room } = await fixture();
        await prisma.class.create({ data: { individualStudentId: student.id, teacherId: teacher.id, roomId: room.id,
            title: 'Superseded longer calendar', date: new Date('2029-12-01'), startTime: '14:00', endTime: '14:45',
            classType: 'individual', status: 'completed', isRecurring: true, createdAt: new Date('2029-12-01'),
            recurringEndDate: new Date('2030-03-01T23:59:59Z') } });
        await prisma.class.create({ data: { individualStudentId: student.id, teacherId: teacher.id, roomId: room.id,
            title: 'Old calendar', date: new Date('2030-01-01'), startTime: '14:00', endTime: '14:45',
            classType: 'individual', status: 'completed', isRecurring: true, createdAt: new Date('2030-01-02'), recurringEndDate: new Date('2030-01-06T23:59:59Z') } });
        await extendStudentIndividualSchedule(student.id, { now });
        const scheduled = (await classes(student)).filter(c => c.status === 'scheduled');
        assert.equal(scheduled[0].date.toISOString().slice(0, 10), '2030-01-12');
        assert.ok(scheduled.every(c => c.date > new Date('2030-01-06')));
    });

    test('conflicts are reported and retried after the room is freed; other pupils are untouched', async () => {
        const { student, room } = await fixture();
        const occupied = await prisma.class.create({ data: { title: 'Occupied', roomId: room.id,
            date: new Date('2030-01-05'), startTime: '14:00', endTime: '15:00' } });
        const first = await extendStudentIndividualSchedule(student.id, { now });
        assert.ok(first.conflicts.length);
        assert.equal((await classes(student)).some(c => c.date.toISOString().startsWith('2030-01-05')), false);
        await prisma.class.update({ where: { id: occupied.id }, data: { status: 'cancelled' } });
        const second = await extendStudentIndividualSchedule(student.id, { now });
        assert.equal(second.created, 1);
        assert.equal(second.conflicts.length, 0);
    });

    test('inactive pupils and tariffs without an individual rate do not get new lessons', async () => {
        const { student } = await fixture({ duo: 2750 });
        assert.equal((await getStudentRegularSchedule(student.id)).data.hasIndividualMembership, false);
        assert.equal((await extendStudentIndividualSchedule(student.id, { now })).created, 0);
        const other = await fixture();
        await prisma.student.update({ where: { id: other.student.id }, data: { status: 'inactive' } });
        assert.equal((await extendStudentIndividualSchedule(other.student.id, { now })).created, 0);
    });

    test('saving a rate-card schedule uses a bounded horizon instead of 9999', async () => {
        const { student, room } = await fixture();
        const result = await updateStudentRegularSchedule(student.id, [{ dayOfWeek: 6, time: '14:00', duration: 45, roomId: room.id }], false, 'individual');
        assert.equal(result.success, true);
        assert.ok(result.generation.created >= 12 && result.generation.created <= 14);
    });

    test('validity edit preserves the membership, wallet and prices, rejects stale edits and non-admin users', async () => {
        const { student, membership } = await fixture();
        const path = `/memberships/rate-card/${membership.id}/validity`;
        const input = { validFrom: '2030-01-05', validUntil: '2030-01-13', expectedUpdatedAt: membership.updatedAt.toISOString() };
        assert.equal((await request(path, input, 'PUT', jwt.sign({ id: student.id }, process.env.JWT_SECRET))).status, 403);
        const result = await request(path, input, 'PUT');
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.membership.id, membership.id);
        assert.deepEqual(result.body.membership.lessonRates, membership.lessonRates);
        assert.equal((await request(path, input, 'PUT')).status, 409);
        assert.equal((await prisma.student.findUnique({ where: { id: student.id } })).accountBalance, 24000);
        const card = await request(`/students/${student.id}`, null, 'GET');
        assert.equal(card.body.student.activeMembership.validUntil.slice(0, 10), '2030-01-13');
        const listed = await request(`/students?search=${encodeURIComponent(student.lastName)}`, null, 'GET');
        assert.equal(listed.body.students.find(s => s.id === student.id).activeMembership.validUntil.slice(0, 10), '2030-01-13');
        const generated = await extendStudentIndividualSchedule(student.id, { now });
        assert.equal(generated.created, 4);
        assert.ok((await classes(student)).every(c => c.date >= new Date('2030-01-05') && c.date <= new Date('2030-01-13')));
        const inside = (await classes(student))[0];
        assert.equal((await deductMembershipForClass(student.id, inside, admin.id, null, membership.id)).deducted, true);
        const outside = await prisma.class.create({ data: { title: 'After expiry', individualStudentId: student.id,
            classType: 'individual', date: new Date('2030-01-14'), startTime: '14:00', endTime: '14:45' } });
        assert.equal((await deductMembershipForClass(student.id, outside, admin.id, null, membership.id)).deducted, false);
    });

    test('new assignments require dates and generate lessons from an already saved schedule', async () => {
        const { student, membership } = await fixture();
        const input = { studentId: student.id, name: 'New tariff', lessonRates: { individual: 4000 }, expectedActiveIds: [membership.id] };
        assert.equal((await request('/memberships/rate-card', input)).status, 400);
        const today = new Date().toISOString().slice(0, 10);
        const end = new Date(); end.setUTCDate(end.getUTCDate() + 30);
        const result = await request('/memberships/rate-card', { ...input, validFrom: today, validUntil: end.toISOString().slice(0, 10) });
        assert.equal(result.status, 201, JSON.stringify(result.body));
        assert.ok(result.body.generation.created >= 8);
        assert.equal((await prisma.student.findUnique({ where: { id: student.id } })).accountBalance, 24000);
    });

    test('replacing a dated tariff still permits late approval against the historical price', async () => {
        const { student, membership } = await fixture();
        await prisma.membership.update({ where: { id: membership.id }, data: {
            validFrom: new Date('2025-09-01'), validUntil: new Date('2025-09-30'), status: 'archived',
        } });
        await prisma.membership.create({ data: { ...rateCardMembershipData({ studentId: student.id, name: 'Next period', rates: { individual: 5000 } }),
            validFrom: new Date('2025-10-01'), validUntil: new Date('2030-12-31'),
        } });
        const lesson = await prisma.class.create({ data: { title: 'Late approval', individualStudentId: student.id,
            classType: 'individual', date: new Date('2025-09-30'), startTime: '14:00', endTime: '14:45' } });
        const result = await deductMembershipForClass(student.id, lesson, admin.id);
        assert.equal(result.deducted, true);
        assert.equal(result.membershipId, membership.id);
        assert.equal(result.chargeAmount, 4000);
    });
}
