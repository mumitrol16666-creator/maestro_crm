const test = require('node:test');
const assert = require('node:assert/strict');

const {
    TRIAL_DURATION_MINUTES,
    addMinutesToTime,
    trialClassData,
} = require('../src/services/trialPolicy');

test('диагностический пробный урок всегда длится 60 минут', () => {
    assert.equal(TRIAL_DURATION_MINUTES, 60);
    assert.equal(addMinutesToTime('15:00'), '16:00');
    assert.equal(addMinutesToTime('23:45'), '00:45');
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
    assert.equal(data.duration, 60);
    assert.equal(data.startTime, '15:00');
    assert.equal(data.endTime, '16:00');
    assert.equal(data.individualStudentId, null);
    assert.match(data.notes, /Диагностический урок 2000 ₸: оплачен/);
    assert.equal(Object.hasOwn(data, 'membershipId'), false);
});
