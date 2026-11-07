const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function renderOperationForm(data, type = 'bonus', employeeId = '') {
    const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/modules/salary.js'), 'utf8');
    const start = source.indexOf('function openSalaryOperation(');
    const end = source.indexOf('async function createSalaryOperation(', start);
    assert.ok(start >= 0 && end > start);
    const modal = { querySelectorAll: () => [], querySelector: () => ({ addEventListener() {} }), remove() {} };
    const context = vm.createContext({
        salaryState: { mode: 'month', month: '2026-11', data },
        document: { createElement: () => modal, getElementById: () => null, body: { appendChild() {} } },
        salaryNotify() {}, salaryOperationLabel: () => 'Премия', salaryMonthLabel: () => 'Ноябрь 2026',
        salaryIcon: () => '', salaryEsc: value => String(value ?? ''), createSalaryOperation() {},
        Date,
    });
    vm.runInContext(source.slice(start, end), context);
    context.openSalaryOperation(type, employeeId);
    return modal.innerHTML;
}

test('the operation form lists former employees in their own group', () => {
    const html = renderOperationForm({
        employees: [{ employeeId: 'current', employeeName: 'Анна', position: 'Преподаватель', due: 3000 }],
        formerEmployees: [{ employeeId: 'former', employeeName: 'Борис', position: 'Менеджер', isInactive: true, due: 0 }],
    });
    assert.match(html, /<option value="current" data-due="3000"/);
    assert.match(html, /<optgroup label="Бывшие сотрудники">[\s\S]*<option value="former" data-due="0"[\s\S]*Борис · Менеджер/);
});

test('no former-employee group when the list is empty or missing', () => {
    const html = renderOperationForm({ employees: [{ employeeId: 'current', employeeName: 'Анна', due: 0 }] });
    assert.doesNotMatch(html, /Бывшие сотрудники/);
});

test('a preselected former employee is selected in the form', () => {
    const html = renderOperationForm({
        employees: [],
        formerEmployees: [{ employeeId: 'former', employeeName: 'Борис', position: 'Менеджер', isInactive: true, due: 0 }],
    }, 'penalty', 'former');
    assert.match(html, /<option value="former" data-due="0"\s+selected>/);
});
