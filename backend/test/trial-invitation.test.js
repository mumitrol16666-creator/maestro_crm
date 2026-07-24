const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildTrialInvitation,
    normalizeExternalUrl,
    whatsappPhoneDigits,
} = require('../src/services/trialInvitation');

test('после назначения пробного формируется персональное приглашение', () => {
    const invitation = buildTrialInvitation({
        name: 'Анри',
        phone: '8 (707) 757-03-07',
        direction: 'Акустическая гитара',
        trialScheduledAt: '2026-07-25T10:00:00.000Z',
    });

    assert.ok(invitation);
    assert.equal(invitation.phone, '77077570307');
    assert.match(invitation.message, /Здравствуйте, Анри!/);
    assert.match(invitation.message, /Акустическая гитара/);
    assert.match(invitation.message, /Марата Оспанова, 52\/2/);
    assert.match(invitation.message, /2\s000 ₸/);
    assert.match(invitation.message, /https:\/\/pay\.kaspi\.kz\/pay\/ku3aldre/);
    assert.match(invitation.message, /инструмент/);
    assert.match(invitation.whatsappUrl, /^https:\/\/wa\.me\/77077570307\?text=/);
});

test('приглашение не создаётся без даты пробного', () => {
    assert.equal(buildTrialInvitation({ name: 'Анри' }), null);
});

test('ссылка и телефон приводятся к формату WhatsApp', () => {
    assert.equal(normalizeExternalUrl('kaspi.kz/pay/test'), 'https://kaspi.kz/pay/test');
    assert.equal(whatsappPhoneDigits('+7 701 123 45 67'), '77011234567');
    assert.equal(whatsappPhoneDigits('7011234567'), '77011234567');
});
