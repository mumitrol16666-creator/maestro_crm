const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Возраст из строки «Возраст: …» в notes заявки с сайта (форма пробного урока).
function loadAgeHelpers() {
    const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/modules/bookings/bookings.js'), 'utf8');
    const pick = (from, to) => {
        const start = source.indexOf(from);
        const end = source.indexOf(to, start);
        assert.ok(start >= 0 && end > start, `не найден блок ${from}`);
        return source.slice(start, end);
    };
    const context = vm.createContext({});
    vm.runInContext(pick('function bookingStudentAge(', 'function bookingBirthDateLabel('), context);
    vm.runInContext(pick('function bookingNoteValue(', 'function bookingQuizLabel('), context);
    return context;
}

const { bookingNoteAge, bookingDisplayAge, bookingStudentAgeLabel } = loadAgeHelpers();
const notes = (value) => `Занятия: Ребенку\nВозраст: ${value}\nУдобное время: Будни вечером\nФорма: сайт, пробный урок`;

test('возраст из notes: «7 лет», «35», «1 год», «2 года»', () => {
    assert.equal(bookingNoteAge(notes('7 лет')), 7);
    assert.equal(bookingNoteAge(notes('35')), 35);
    assert.equal(bookingNoteAge(notes('1 год')), 1);
    assert.equal(bookingNoteAge(notes('2 года')), 2);
    assert.equal(bookingNoteAge('Возраст:   9  лет  '), 9);
    assert.equal(bookingNoteAge('Занятия: Взрослому\r\nВозраст: 41 год\r\n'), 41);
});

test('возраст из notes: пустое значение, мусор и вне диапазона дают null', () => {
    assert.equal(bookingNoteAge(notes('')), null);
    assert.equal(bookingNoteAge('Занятия: Ребенку'), null);
    assert.equal(bookingNoteAge(''), null);
    assert.equal(bookingNoteAge(null), null);
    assert.equal(bookingNoteAge(notes('не знаю')), null);
    assert.equal(bookingNoteAge(notes('7-8 лет')), null);
    assert.equal(bookingNoteAge(notes('7 лет и 3 месяца')), null);
    assert.equal(bookingNoteAge(notes('-5')), null);
    assert.equal(bookingNoteAge(notes('0')), null);
    assert.equal(bookingNoteAge(notes('121')), null);
    assert.equal(bookingNoteAge(notes('1234')), null);
    assert.equal(bookingNoteAge(notes('<b>7</b>')), null);
});

test('дата рождения главнее возраста из notes', () => {
    const now = new Date();
    const birth = new Date(Date.UTC(now.getUTCFullYear() - 20, 0, 1)).toISOString();
    assert.equal(bookingDisplayAge({ dateOfBirth: birth, notes: notes('7 лет') }), 20);
    assert.equal(bookingStudentAgeLabel({ dateOfBirth: birth, notes: notes('7 лет') }), '20 лет');
});

test('без даты рождения берётся возраст из notes, с правильным склонением', () => {
    assert.equal(bookingStudentAgeLabel({ dateOfBirth: null, notes: notes('7 лет') }), '7 лет');
    assert.equal(bookingStudentAgeLabel({ notes: notes('21') }), '21 год');
    assert.equal(bookingStudentAgeLabel({ notes: notes('3') }), '3 года');
    assert.equal(bookingStudentAgeLabel({ notes: notes('12') }), '12 лет');
    assert.equal(bookingStudentAgeLabel({ dateOfBirth: 'не дата', notes: notes('9') }), '9 лет');
});

test('нет ни даты рождения, ни возраста в notes: пустая метка', () => {
    assert.equal(bookingStudentAgeLabel({ dateOfBirth: null, notes: 'Занятия: Ребенку' }), '');
    assert.equal(bookingStudentAgeLabel({ notes: notes('мусор') }), '');
    assert.equal(bookingStudentAgeLabel(null), '');
});

test('карточка и список заявок берут возраст через bookingStudentAgeLabel(booking)', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/modules/bookings/bookings.js'), 'utf8');
    assert.doesNotMatch(source, /bookingStudentAgeLabel\(booking\.dateOfBirth\)/);
    assert.equal((source.match(/bookingStudentAgeLabel\(booking\)/g) || []).length >= 3, true);
});
