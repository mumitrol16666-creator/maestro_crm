const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

if (!process.env.TEST_DATABASE_URL) {
    test('homework continuity across teachers', { skip: 'TEST_DATABASE_URL не задан' }, () => {});
} else {
    const database = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['localhost', '127.0.0.1'].includes(database.hostname)
        && /(?:test|qa)/i.test(database.pathname), 'Use a dedicated local test database');
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { prisma: databaseClient } = require('../src/config/db');
    test('homework continuity uses the same student and lesson time across teachers', async (t) => {
        const rollback = new Error('Roll back the complete test fixture');
        try {
            await assert.rejects(databaseClient.$transaction(async (prisma) => {
                // Run the real service queries on the fixture transaction. Rollback also
                // removes the immutable opening balance entries created by DB triggers.
                const dbPath = require.resolve('../src/config/db');
                const servicePath = require.resolve('../src/services/integrationRead');
                const originalExports = require.cache[dbPath].exports;
                require.cache[dbPath].exports = { ...originalExports, prisma };
                delete require.cache[servicePath];
                try {
                    const { getClassStudents } = require(servicePath);
                    const suffix = randomUUID();
                    let currentTeacher, previousTeacher, student, otherStudent, group, otherGroup, current;
                    const groups = [];
                    const date = day => new Date(`${day}T00:00:00Z`);

                    async function person(name, role = 'student') {
                        const row = await prisma.student.create({ data: {
                            name, lastName: `Homework-${suffix}`, phone: `qa-${name}-${suffix}`, password: 'test-only',
                            role, status: 'active', learningDirections: ['Гитара'], teacherDirections: [],
                        } });
                        return row;
                    }
                    async function lesson(id, day, overrides = {}) {
                        const row = await prisma.class.create({ data: {
                            title: `Homework ${id} ${suffix}`, date: date(day), startTime: '11:00', endTime: '11:45', duration: 45,
                            classType: 'individual', teacherId: previousTeacher.id, individualStudentId: student.id,
                            status: 'completed', homeworkDraft: `Задание ${id}`,
                            ...overrides,
                        } });
                        if (row.status === 'completed') await prisma.classAttendee.create({ data: {
                            classId: row.id, studentId: row.individualStudentId || student.id,
                            attended: true, attendanceStatus: 'present', markedAt: date(day),
                        } });
                        return row;
                    }

                    currentTeacher = await person('current-teacher', 'teacher');
                    previousTeacher = await person('previous-teacher', 'teacher');
                    student = await person('student');
                    otherStudent = await person('other-student');
                    for (const name of ['same-group', 'other-group']) {
                        const row = await prisma.group.create({ data: { name: `${name}-${suffix}`, direction: 'Гитара' } });
                        groups.push(row.id);
                    }
                    [group, otherGroup] = groups;
                    await prisma.studentGroup.create({ data: { groupId: group, studentId: student.id, status: 'active' } });
                    current = await lesson('moved', '2026-11-03', { teacherId: currentTeacher.id, status: 'scheduled', homeworkDraft: null });
                    current = await prisma.class.update({ where: { id: current.id }, data: { date: date('2026-11-05'), startTime: '10:15', endTime: '11:00' } });
                    await t.test('a Tuesday lesson moved to Thursday sees the previous teacher’s approved homework', async () => {
                        const empty = await lesson('old-current-teacher', '2026-10-20', { teacherId: currentTeacher.id, homeworkDraft: null });
                        const source = await lesson('previous-teacher', '2026-10-27', { originalTeacherId: currentTeacher.id });
                        await lesson('unapproved', '2026-11-04', { status: 'pending_admin_review' });
                        await lesson('later-today', '2026-11-05', { startTime: '12:00', endTime: '12:45' });
                        await lesson('another-student', '2026-11-04', { individualStudentId: otherStudent.id });
                        await lesson('group', '2026-11-04', { classType: 'group', groupId: group, individualStudentId: null });
                        const roster = await getClassStudents(current.id);
                        assert.equal(roster.success, true);
                        const recent = roster.data.students[0].recentLessons;
                        assert.deepEqual(recent.map(row => row.crmClassId), [source.id, empty.id]);
                        assert.equal(recent[0].homework, 'Задание previous-teacher');
                        assert.equal(recent[0].date.toISOString(), '2026-10-27T00:00:00.000Z');
                    });

                    await t.test('earlier lessons on the transferred date are ordered by start time', async () => {
                        const early = await lesson('08-00', '2026-11-05', { startTime: '08:00', endTime: '08:45' });
                        const latest = await lesson('09-00', '2026-11-05', { startTime: '09:00', endTime: '09:45' });
                        // Review timestamps must not override the actual lesson order.
                        await prisma.classAttendee.updateMany({ where: { classId: early.id }, data: { markedAt: new Date('2026-11-06T00:00:00Z') } });
                        const roster = await getClassStudents(current.id);
                        assert.deepEqual(roster.data.students[0].recentLessons.slice(0, 2).map(row => row.crmClassId), [latest.id, early.id]);
                    });

                    await t.test('a group keeps its own homework when its teacher changes', async () => {
                        const groupCurrent = await lesson('group-current', '2026-11-05', {
                            classType: 'group', groupId: group, individualStudentId: null, teacherId: currentTeacher.id, status: 'scheduled',
                        });
                        const source = await lesson('group-source', '2026-11-04', { classType: 'group', groupId: group, individualStudentId: null, startTime: '18:00' });
                        await lesson('unrelated-group', '2026-11-04', { classType: 'group', groupId: otherGroup, individualStudentId: null, startTime: '19:00' });
                        const roster = await getClassStudents(groupCurrent.id);
                        const recent = roster.data.students[0].recentLessons;
                        assert.equal(recent[0].crmClassId, source.id);
                        assert.ok(recent.every(row => row.homework.startsWith('Задание group')));
                    });
                    throw rollback;
                } finally {
                    require.cache[dbPath].exports = originalExports;
                    delete require.cache[servicePath];
                }
            }, { timeout: 20_000 }), error => error === rollback);
        } finally {
            await databaseClient.$disconnect();
        }
    });
}
