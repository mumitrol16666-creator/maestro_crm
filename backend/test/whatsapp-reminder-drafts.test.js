const test = require('node:test');
const assert = require('node:assert/strict');
const { mapGeneratedHomeworkDrafts } = require('../src/services/whatsappReminderDrafts');

test('очередь WhatsApp оставляет последний AI-черновик для урока и ученика', () => {
    const drafts = mapGeneratedHomeworkDrafts([
        {
            entityId: 'class-1',
            createdAt: new Date('2026-07-21T12:00:00Z'),
            responseBody: {
                data: {
                    drafts: [{
                        crmStudentId: 'student-1',
                        studentName: 'Иванов Дима',
                        recipient: { phone: '+77000000000', label: 'Мама Алла', audience: 'parent' },
                        message: 'Новый текст',
                        source: 'ai',
                        model: 'gpt-4o-mini',
                    }],
                },
            },
        },
        {
            entityId: 'class-1',
            createdAt: new Date('2026-07-21T11:00:00Z'),
            responseBody: {
                data: {
                    drafts: [{
                        crmStudentId: 'student-1',
                        message: 'Старый текст',
                        source: 'template',
                    }],
                },
            },
        },
    ]);

    assert.equal(drafts.size, 1);
    assert.equal(drafts.get('homework:class-1:student-1').message, 'Новый текст');
    assert.equal(drafts.get('homework:class-1:student-1').messageSource, 'ai');
    assert.equal(drafts.get('homework:class-1:student-1').recipientAudience, 'parent');
});

test('некорректные ответы интеграции не создают пустые карточки', () => {
    const drafts = mapGeneratedHomeworkDrafts([
        { entityId: null, responseBody: { data: { drafts: [{ crmStudentId: 'student-1' }] } } },
        { entityId: 'class-1', responseBody: { data: { drafts: [{ message: 'Без ученика' }] } } },
    ]);

    assert.equal(drafts.size, 0);
});
