const test = require('node:test');
const assert = require('node:assert/strict');
const { formatBookingMessage } = require('../src/utils/telegram');

const base = {
    _id: 'b1',
    name: 'Айдана',
    lastName: 'Серикова',
    phone: '+77011234567',
    direction: 'Курсы в приложении',
    source: 'Приложение — регистрация',
    createdAt: new Date('2026-11-02T10:00:00Z'),
};

test('Telegram: регистрация в приложении имеет свою подпись, фамилию и комментарий', () => {
    const text = formatBookingMessage({
        ...base,
        requestType: 'app_registration',
        notes: 'Тип заявки: регистрация в приложении\nКомментарий: Ребёнок: <Мира>',
    });
    assert.match(text, /<b>Регистрация в приложении<\/b>/);
    assert.doesNotMatch(text, /Новая заявка/);
    assert.match(text, /Айдана Серикова/);
    assert.match(text, /Комментарий: Ребёнок: &lt;Мира&gt;/);
    assert.match(text, /Приложение — регистрация/);
});

test('Telegram: остальные заявки выглядят как раньше', () => {
    const text = formatBookingMessage({ ...base, requestType: 'online_lesson', notes: 'Комментарий: x' });
    assert.match(text, /<b>Новая заявка<\/b>/);
    assert.doesNotMatch(text, /Серикова/);
    assert.doesNotMatch(text, /💬/);
});

test('Telegram: имя и фамилия из заявки экранируются', () => {
    const text = formatBookingMessage({ ...base, requestType: 'app_registration', name: 'A<b>', lastName: 'B&C' });
    assert.match(text, /A&lt;b&gt; B&amp;C/);
    assert.doesNotMatch(text, /A<b>/);
});
