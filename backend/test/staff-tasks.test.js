const test = require('node:test');
const assert = require('node:assert/strict');
const { validateStaffTaskInput } = require('../src/services/staffTasks');

test('ручная задача принимает сотрудника, срок и приоритет', () => {
    const result = validateStaffTaskInput({
        title: 'Позвонить родителю',
        description: 'Уточнить расписание на август',
        priority: 'high',
        dueAt: '2026-07-22T12:00:00.000Z',
    });

    assert.equal(result.valid, true);
    assert.equal(result.data.title, 'Позвонить родителю');
    assert.equal(result.data.priority, 'high');
    assert.equal(result.data.dueAt.toISOString(), '2026-07-22T12:00:00.000Z');
});

test('пустое название и неизвестный приоритет отклоняются', () => {
    const result = validateStaffTaskInput({ title: ' ', priority: 'impossible' });

    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /название/i);
    assert.match(result.errors.join(' '), /приоритет/i);
});

test('частичное обновление не требует повторно передавать название', () => {
    const result = validateStaffTaskInput({ status: 'completed' }, { partial: true });

    assert.equal(result.valid, true);
    assert.deepEqual(result.data, { status: 'completed' });
});
