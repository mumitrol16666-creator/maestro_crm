const test = require('node:test');
const assert = require('node:assert/strict');

const {
    availableRecurringSlotIndexes,
    buildRecurringSlots,
    findRecurringConflicts,
    replaceFutureRecurringClasses,
} = require('../src/services/regularScheduleAutomation');

test('индивидуальное регулярное расписание использует fallback преподавателя, если в строке он не задан', () => {
    const slots = buildRecurringSlots({
        schedules: [{ dayOfWeek: 1, time: '18:00', duration: 60, roomId: 'room-1', teacherId: null }],
        startDate: new Date('2026-07-20T00:00:00.000Z'),
        endDate: new Date('2026-07-20T23:59:59.999Z'),
        individualStudentId: 'student-1',
        defaultTeacherId: 'teacher-main',
        title: 'Индивидуально',
        classType: 'individual',
    });

    assert.equal(slots.length, 1);
    assert.equal(slots[0].teacherId, 'teacher-main');
});

test('преподаватель в строке регулярного расписания важнее fallback преподавателя', () => {
    const slots = buildRecurringSlots({
        schedules: [{ dayOfWeek: 1, time: '19:00', duration: 60, roomId: 'room-1', teacherId: 'teacher-slot' }],
        startDate: new Date('2026-07-20T00:00:00.000Z'),
        endDate: new Date('2026-07-20T23:59:59.999Z'),
        individualStudentId: 'student-1',
        defaultTeacherId: 'teacher-main',
        title: 'Индивидуально',
        classType: 'individual',
    });

    assert.equal(slots.length, 1);
    assert.equal(slots[0].teacherId, 'teacher-slot');
});

test('проверка регулярного расписания сравнивает занятия только внутри одного дня', async () => {
    const slot = {
        teacherId: 'teacher-1',
        roomId: 'room-1',
        date: new Date('2026-09-08T00:00:00.000Z'),
        startTime: '10:00',
        endTime: '10:45',
    };
    const db = {
        class: {
            findMany: async () => [
                {
                    id: 'other-day',
                    title: 'Другой день',
                    teacherId: 'teacher-1',
                    roomId: 'room-1',
                    groupId: null,
                    individualStudentId: 'student-2',
                    date: new Date('2026-09-09T00:00:00.000Z'),
                    startTime: '10:00',
                    endTime: '10:45',
                    notes: null,
                    room: { name: '1 кабинет' },
                    teacher: { name: 'Владислав', lastName: 'Сидоров', middleName: null },
                },
                {
                    id: 'same-day',
                    title: 'Занятое время',
                    teacherId: 'teacher-1',
                    roomId: 'room-2',
                    groupId: null,
                    individualStudentId: 'student-3',
                    date: new Date('2026-09-08T00:00:00.000Z'),
                    startTime: '10:15',
                    endTime: '11:00',
                    notes: null,
                    room: { name: '2 кабинет' },
                    teacher: { name: 'Владислав', lastName: 'Сидоров', middleName: null },
                },
            ],
        },
    };

    const conflicts = await findRecurringConflicts([slot], {}, db);

    assert.equal(conflicts.length, 1);
    assert.match(conflicts[0].reason, /Сидоров Владислав/);
});

test('пакетная проверка возвращает все конфликты с индексами слотов', async () => {
    const slots = Array.from({ length: 14 }, (_item, index) => ({
        teacherId: 'teacher-1',
        roomId: `room-${index}`,
        date: new Date('2026-09-08T00:00:00.000Z'),
        startTime: '10:00',
        endTime: '10:45',
    }));
    const db = { class: { findMany: async () => [] } };

    const limited = await findRecurringConflicts(slots, {}, db);
    const all = await findRecurringConflicts(slots, { limit: null }, db);

    assert.equal(limited.length, 12);
    assert.equal(all.length, 13);
    assert.deepEqual(all.map((conflict) => conflict.slotIndex), Array.from({ length: 13 }, (_item, index) => index + 1));
});

test('свободный слот не блокируется новым слотом, который сам не будет создан', () => {
    const slots = [{ id: 'blocked' }, { id: 'free' }, { id: 'later-overlap' }];
    const conflicts = [
        { slotIndex: 0, scope: 'existing', classId: 'existing-class' },
        { slotIndex: 1, conflictingSlotIndex: 0, scope: 'batch' },
        { slotIndex: 2, conflictingSlotIndex: 1, scope: 'batch' },
    ];

    assert.deepEqual(availableRecurringSlotIndexes(slots, conflicts), [1]);
});

test('пакетная проверка освобождает второй слот, если первый занят существующим уроком', async () => {
    const date = new Date('2026-09-08T00:00:00.000Z');
    const slots = [
        { roomId: 'room-busy', teacherId: 'teacher-new', date, startTime: '10:00', endTime: '10:45' },
        { roomId: 'room-free', teacherId: 'teacher-new', date, startTime: '10:00', endTime: '10:45' },
    ];
    const db = {
        class: {
            findMany: async () => [{
                id: 'existing-class',
                title: 'Занятый кабинет',
                roomId: 'room-busy',
                teacherId: 'teacher-existing',
                groupId: null,
                individualStudentId: null,
                date,
                startTime: '10:00',
                endTime: '10:45',
                room: { name: 'Кабинет 1' },
                teacher: null,
            }],
        },
    };

    const conflicts = await findRecurringConflicts(slots, { limit: null }, db);

    assert.deepEqual(availableRecurringSlotIndexes(slots, conflicts), [1]);
    assert.deepEqual(conflicts.map((item) => item.scope), ['existing', 'batch']);
});

test('пакетная проверка исключает редактируемые уроки по их идентификаторам', async () => {
    let receivedWhere = null;
    const db = {
        class: {
            findMany: async ({ where }) => {
                receivedWhere = where;
                return [];
            },
        },
    };

    await findRecurringConflicts([{
        teacherId: 'teacher-new',
        date: new Date('2026-09-08T00:00:00.000Z'),
        startTime: '10:00',
        endTime: '10:45',
    }], { excludeClassIds: ['class-current-1', 'class-current-2'] }, db);

    assert.deepEqual(receivedWhere.id, { notIn: ['class-current-1', 'class-current-2'] });
});

test('будущие регулярные занятия проверяются и создаются пакетно', async () => {
    const slots = [
        {
            individualStudentId: 'student-1',
            teacherId: 'teacher-1',
            roomId: 'room-1',
            title: 'Индивидуально',
            date: new Date('2026-09-08T00:00:00.000Z'),
            startTime: '10:00',
            endTime: '11:00',
            duration: 60,
            status: 'scheduled',
            notes: 'Автоматически из регулярного расписания',
        },
        {
            individualStudentId: 'student-1',
            teacherId: 'teacher-1',
            roomId: 'room-1',
            title: 'Индивидуально',
            date: new Date('2026-09-15T00:00:00.000Z'),
            startTime: '10:00',
            endTime: '11:00',
            duration: 60,
            status: 'scheduled',
            notes: 'Автоматически из регулярного расписания',
        },
    ];
    const findManyResults = [[], [], []];
    const lockCalls = [];
    const createManyCalls = [];
    const transaction = {
        class: {
            findMany: async () => findManyResults.shift() || [],
            deleteMany: async () => ({ count: 2 }),
            createMany: async ({ data }) => {
                createManyCalls.push(data);
                return { count: data.length };
            },
        },
        $queryRawUnsafe: async (_query, keys) => lockCalls.push(keys),
    };

    const result = await replaceFutureRecurringClasses({
        slots,
        individualStudentId: 'student-1',
        transaction,
    });

    assert.deepEqual(result, { created: 2, replaced: 2 });
    assert.equal(lockCalls.length, 1);
    assert.equal(createManyCalls.length, 1);
    assert.equal(createManyCalls[0].length, 2);
    assert.equal(findManyResults.length, 0);
});

test('при разрешённых пересечениях повторная проверка не выполняется', async () => {
    let findManyCalls = 0;
    const slot = {
        individualStudentId: 'student-1',
        teacherId: 'teacher-1',
        roomId: 'room-1',
        title: 'Индивидуально',
        date: new Date('2026-09-08T00:00:00.000Z'),
        startTime: '10:00',
        endTime: '11:00',
        duration: 60,
        status: 'scheduled',
        notes: 'Автоматически из регулярного расписания',
    };
    const transaction = {
        class: {
            findMany: async () => {
                findManyCalls += 1;
                return [];
            },
            deleteMany: async () => ({ count: 0 }),
            createMany: async ({ data }) => ({ count: data.length }),
        },
        $queryRawUnsafe: async () => [],
    };

    const result = await replaceFutureRecurringClasses({
        slots: [slot],
        individualStudentId: 'student-1',
        allowConflicts: true,
        transaction,
    });

    assert.equal(result.created, 1);
    assert.equal(findManyCalls, 2);
});
