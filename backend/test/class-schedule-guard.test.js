const test = require('node:test');
const assert = require('node:assert/strict');

const {
    classScheduleLockKeys,
    scheduleDateKey,
    normalizeScheduleDate,
    acquireClassScheduleLocks,
    findClassScheduleConflict,
    classScheduleConflictError,
} = require('../src/services/classScheduleGuard');

test('schedule lock is shared by the same resource and date regardless of time', () => {
    const morning = classScheduleLockKeys({
        date: '2026-09-01',
        startTime: '10:00',
        teacherId: 'teacher-1',
        roomId: 'room-1',
    });
    const evening = classScheduleLockKeys({
        date: '2026-09-01',
        startTime: '18:00',
        teacherId: 'teacher-1',
        roomId: 'room-2',
    });

    assert.ok(morning.includes('class-schedule:2026-09-01:teacher:teacher-1'));
    assert.ok(evening.includes('class-schedule:2026-09-01:teacher:teacher-1'));
    assert.equal(classScheduleLockKeys({ date: '2026-09-02', teacherId: 'teacher-1' })[0]
        === 'class-schedule:2026-09-01:teacher:teacher-1', false);
});

test('school date is stable for UTC and local-midnight representations', () => {
    assert.equal(scheduleDateKey(new Date('2026-09-01T00:00:00.000Z')), '2026-09-01');
    assert.equal(scheduleDateKey(new Date('2026-08-31T19:00:00.000Z')), '2026-09-01');
    assert.equal(normalizeScheduleDate(new Date('2026-08-31T19:00:00.000Z')).toISOString(), '2026-09-01T00:00:00.000Z');
});

test('booking and class locks do not change when a lesson moves to another date', () => {
    const first = classScheduleLockKeys({
        date: '2026-09-01',
        bookingId: 'booking-1',
        classId: 'class-1',
    });
    const moved = classScheduleLockKeys({
        date: '2026-09-08',
        bookingId: 'booking-1',
        classId: 'class-1',
    });

    assert.ok(first.includes('class-schedule:booking:booking-1'));
    assert.ok(first.includes('class-schedule:class:class-1'));
    assert.ok(moved.includes('class-schedule:booking:booking-1'));
    assert.ok(moved.includes('class-schedule:class:class-1'));
});

test('schedule locks are unique and acquired in stable order', async () => {
    const acquired = [];
    const tx = {
        $queryRawUnsafe: async (_query, key) => acquired.push(key),
    };
    await acquireClassScheduleLocks(tx, [
        { date: '2026-09-01', teacherId: 'teacher-2', roomId: 'room-1', bookingId: 'booking-1' },
        { date: '2026-09-01', teacherId: 'teacher-2', groupId: 'group-1' },
    ]);

    assert.equal(new Set(acquired).size, acquired.length);
    assert.equal(acquired[0], 'class-schedule:booking:booking-1');
    assert.deepEqual(acquired.slice(1), [...acquired.slice(1)].sort());
    assert.equal(acquired.filter(key => key.endsWith(':teacher:teacher-2')).length, 1);
});

test('conflict lookup detects overlapping intervals for the same teacher', async () => {
    const db = {
        class: {
            findMany: async () => [{
                id: 'class-1',
                title: 'Урок',
                teacherId: 'teacher-1',
                roomId: 'room-1',
                groupId: 'group-1',
                individualStudentId: null,
                date: new Date('2026-09-01T00:00:00.000Z'),
                startTime: '10:00',
                endTime: '11:00',
            }],
        },
    };

    const conflict = await findClassScheduleConflict(db, {
        date: new Date('2026-09-01T00:00:00.000Z'),
        startTime: '10:30',
        endTime: '11:30',
        teacherId: 'teacher-1',
    });
    assert.equal(conflict.id, 'class-1');

    const adjacent = await findClassScheduleConflict(db, {
        date: new Date('2026-09-01T00:00:00.000Z'),
        startTime: '11:00',
        endTime: '12:00',
        teacherId: 'teacher-1',
    });
    assert.equal(adjacent, null);
});

test('conflict errors have a stable code and preserve details', () => {
    const conflict = { id: 'class-1', startTime: '10:00', endTime: '11:00' };
    const error = classScheduleConflictError(conflict, 'Время уже занято');
    assert.equal(error.code, 'CLASS_SCHEDULE_CONFLICT');
    assert.equal(error.message, 'Время уже занято');
    assert.equal(error.conflict, conflict);
});
