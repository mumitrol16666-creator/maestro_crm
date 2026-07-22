const test = require('node:test');
const assert = require('node:assert/strict');
const {
    assertUniqueNotificationRoutes,
    resolveStudentNotificationContact,
    resolveStudentNotificationPhone,
} = require('../src/services/studentNotificationRouting');

test('legacy student notifications fall back to the first valid phone', () => {
    assert.equal(resolveStudentNotificationPhone({
        phone: '+7 777 100 20 30',
        additionalPhones: [{ phone: '+7 777 200 30 40' }],
    }, 'lessons'), '+7 777 100 20 30');
});

test('each notification kind resolves to its explicitly selected phone', () => {
    const student = {
        phone: '+7 777 100 20 30',
        notifyHomework: true,
        notifyLessons: false,
        notifyPayments: false,
        additionalPhones: [{
            phone: '+7 777 200 30 40',
            notifyHomework: false,
            notifyLessons: true,
            notifyPayments: true,
        }],
    };

    assert.equal(resolveStudentNotificationPhone(student, 'homework'), student.phone);
    assert.equal(resolveStudentNotificationPhone(student, 'lessons'), student.additionalPhones[0].phone);
    assert.equal(resolveStudentNotificationPhone(student, 'payments'), student.additionalPhones[0].phone);
});

test('configured notification kind without a recipient does not silently fall back', () => {
    assert.equal(resolveStudentNotificationPhone({
        phone: '+7 777 100 20 30',
        notifyPayments: false,
        additionalPhones: [{ phone: '+7 777 200 30 40', notifyPayments: false }],
    }, 'payments'), null);
});

test('duplicate recipients for one notification kind are rejected', () => {
    assert.throws(
        () => assertUniqueNotificationRoutes(
            { notifyLessons: true },
            [{ notifyLessons: true }]
        ),
        error => error.code === 'DUPLICATE_NOTIFICATION_ROUTE' && error.statusCode === 400
    );
});

test('homework recipient includes parent name from an additional phone label', () => {
    const recipient = resolveStudentNotificationContact({
        name: 'Дима',
        phone: '+7 777 100 20 30',
        notifyHomework: false,
        additionalPhones: [{
            phone: '+7 777 200 30 40',
            label: 'Мама Алла',
            notifyHomework: true,
        }],
    }, 'homework');

    assert.deepEqual(recipient, {
        phone: '+7 777 200 30 40',
        notifyHomework: true,
        notifyLessons: undefined,
        notifyPayments: undefined,
        source: 'additional',
        audience: 'parent',
        recipientName: 'Алла',
        label: 'Мама Алла',
    });
});

test('primary homework recipient is addressed as the student when no customer is set', () => {
    const recipient = resolveStudentNotificationContact({
        name: 'Дима',
        phone: '+7 777 100 20 30',
        notifyHomework: true,
    }, 'homework');

    assert.equal(recipient.audience, 'student');
    assert.equal(recipient.recipientName, 'Дима');
    assert.equal(recipient.label, 'Ученик');
});

test('primary payment recipient is marked as the parent when a customer is set', () => {
    const recipient = resolveStudentNotificationContact({
        name: 'Дима',
        customerName: 'Алла',
        phone: '+7 777 100 20 30',
        notifyPayments: true,
    }, 'payments');

    assert.equal(recipient.audience, 'parent');
    assert.equal(recipient.recipientName, 'Алла');
    assert.equal(recipient.label, 'Родитель');
});
