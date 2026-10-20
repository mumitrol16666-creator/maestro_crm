const test = require('node:test');
const assert = require('node:assert/strict');

const dbModulePath = require.resolve('../src/config/db');
require.cache[dbModulePath] = {
    id: dbModulePath, filename: dbModulePath, loaded: true, exports: { prisma: {} }, children: [], paths: [],
};

const { buildExamInvitationMessage, examLessonAt, sectorExamTitle, isSectorExamClass } = require('../src/services/sectorExams');
const { resolveStudentExamContacts } = require('../src/services/studentNotificationRouting');

test('the exam lesson time is sent to the platform as an Aqtobe instant', () => {
    assert.equal(examLessonAt(new Date('2026-10-21T00:00:00.000Z'), '12:00'), '2026-10-21T07:00:00.000Z');
    assert.equal(examLessonAt('2026-10-21', '09:30'), '2026-10-21T04:30:00.000Z');
});

test('the lesson title names the sector, a retake and the direction', () => {
    assert.equal(sectorExamTitle({ sectorSequence: 2, attempt: 1, directionTitle: 'Гитара' }), 'Экзамен сектора 2 · Гитара');
    assert.equal(sectorExamTitle({ sectorSequence: 2, attempt: 2, directionTitle: 'Гитара' }), 'Экзамен сектора 2, пересдача · Гитара');
    assert.equal(isSectorExamClass({ classType: 'exam' }), true);
    assert.equal(isSectorExamClass({ classType: 'individual' }), false);
});

test('the WhatsApp invitation speaks to the student or to the parent', () => {
    const base = { title: 'Экзамен сектора 1 · Гитара', date: new Date('2026-10-21T00:00:00.000Z'), startTime: '12:00', roomName: 'Синий' };
    const student = buildExamInvitationMessage({ ...base, audience: 'student', recipientName: 'Камбар' });
    assert.match(student, /^Здравствуйте, Камбар! Приглашаем вас на экзамен сектора 1 · Гитара: 21 октября в 12:00, кабинет «Синий»\./);
    assert.match(student, /бесплатный дополнительный урок/);
    const parent = buildExamInvitationMessage({ ...base, audience: 'parent', recipientName: 'Руслан', studentName: 'Камбар' });
    assert.match(parent, /^Здравствуйте, Руслан! Камбар приглашается на экзамен/);
});

test('an exam invitation goes once to the student and once to a parent', () => {
    const student = {
        name: 'Камбар', customerName: 'Камбар', phone: '+7 700 000 00 21', notifyLessons: true,
        additionalPhones: [
            { phone: '+7 700 000 00 31', label: 'Мама Айгуль', notifyLessons: false },
            { phone: '87000000021', label: 'Второй номер' },
        ],
    };
    const contacts = resolveStudentExamContacts(student);
    assert.deepEqual(contacts.map(contact => [contact.audience, contact.phone]), [
        ['student', '+7 700 000 00 21'],
        ['parent', '+7 700 000 00 31'],
    ]);
    // A student whose primary phone belongs to the parent: one parent contact, no duplicate.
    const child = { name: 'Алия', customerName: 'Ерлан', phone: '+77001112233', additionalPhones: [] };
    assert.deepEqual(resolveStudentExamContacts(child).map(contact => contact.audience), ['parent']);
});

test('avatars sent with http:// are upgraded to https, local ones are kept', () => {
    const { secureMediaAvatarUrl } = require('../src/routes/integration');
    assert.equal(secureMediaAvatarUrl('http://maestro.kz/api/v1/media/images/a.png'), 'https://maestro.kz/api/v1/media/images/a.png');
    assert.equal(secureMediaAvatarUrl('https://maestro.kz/api/v1/media/images/a.png'), 'https://maestro.kz/api/v1/media/images/a.png');
    assert.equal(secureMediaAvatarUrl('http://127.0.0.1:4001/api/v1/media/images/a.png'), 'http://127.0.0.1:4001/api/v1/media/images/a.png');
    assert.equal(secureMediaAvatarUrl('http://example.com/photo.png'), 'http://example.com/photo.png');
});
