const test = require('node:test');
const assert = require('node:assert/strict');

const {
    TRIAL_DURATION_MINUTES,
    addMinutesToTime,
    trialClassData,
} = require('../src/services/trialPolicy');

test('пробный урок всегда длится 30 минут', () => {
    assert.equal(TRIAL_DURATION_MINUTES, 30);
    assert.equal(addMinutesToTime('15:00'), '15:30');
    assert.equal(addMinutesToTime('23:45'), '00:15');
});

test('пробный создаётся как отдельный тип урока и не создаёт абонемент', () => {
    const data = trialClassData({
        booking: {
            name: 'Анна',
            lastName: 'Тест',
            phone: '+77000000000',
            direction: 'Вокал',
            processedById: 'manager-1',
            convertedToStudentId: null,
        },
        teacher: { id: 'teacher-1' },
        room: { id: 'room-1' },
        local: { date: new Date('2026-06-23T00:00:00Z'), startTime: '15:00' },
        actorId: 'admin-1',
        depositPaid: true,
    });
    assert.equal(data.classType, 'trial');
    assert.equal(data.duration, 30);
    assert.equal(data.startTime, '15:00');
    assert.equal(data.endTime, '15:30');
    assert.equal(data.individualStudentId, null);
    assert.match(data.notes, /Возвратный депозит: оплачен/);
    assert.equal(Object.hasOwn(data, 'membershipId'), false);
});
