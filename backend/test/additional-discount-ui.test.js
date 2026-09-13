const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('switching to a free individual lesson clears the previous paid amount', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/modules/schedule/schedule.js'), 'utf8');
    const start = source.indexOf('function bindLessonBillingAmountSync(');
    const end = source.indexOf('function renderLessonBillingStudent(', start);
    assert.ok(start >= 0 && end > start);
    const amountInput = { value: 4000, readOnly: false, addEventListener() {} };
    let onChange;
    let renders = 0;
    const select = {
        value: 'free-program', selectedOptions: [{ dataset: { price: '0' } }],
        addEventListener(type, handler) { if (type === 'change') onChange = handler; },
        closest() { return { querySelector: () => amountInput }; },
    };
    const section = { querySelectorAll: selector => selector === '.lesson-billing-membership' ? [select] : [amountInput] };
    const context = vm.createContext({ renderLessonApprovalSummary: () => { renders += 1; } });
    vm.runInContext(source.slice(start, end), context);
    context.bindLessonBillingAmountSync(section);
    onChange();
    assert.equal(amountInput.value, 0);
    assert.equal(amountInput.readOnly, true);
    select.selectedOptions[0].dataset.price = '3374';
    onChange();
    assert.equal(amountInput.value, 3374);
    select.value = '';
    select.selectedOptions = [{}];
    onChange();
    assert.equal(amountInput.value, 3374);
    assert.equal(amountInput.readOnly, false);
    assert.equal(renders, 3);
});
