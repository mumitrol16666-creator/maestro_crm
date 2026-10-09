const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function ui(student) {
    const elements = new Map();
    const errors = [];
    const element = id => {
        if (!elements.has(id)) elements.set(id, {
            innerHTML: '', textContent: '', style: {}, dataset: {},
            classList: { remove() {}, add() {}, toggle() {} },
            setAttribute() {}, addEventListener() {}, closest: () => null,
        });
        return elements.get(id);
    };
    const membership = { id: 'm1', status: 'active', billingModel: 'rate_card', type: 'rate_card', endDate: '9999-12-31' };
    const context = vm.createContext({
        window: { renderRateCardSummary: () => '<p>Обучение</p>' },
        document: { body: { dataset: {} }, addEventListener() {}, getElementById: element, querySelector: () => null },
        console: { log() {}, error: (...args) => console.error(...args), warn() {} },
        toast: { error: message => errors.push(message) },
        API_URL: '/api', getAuthToken: () => 'test', getUserRole: () => 'admin',
        escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
        normalizeSecureMediaUrl: () => '', getDeclension: () => 'уроков',
        setTimeout() {},
        fetch: async url => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => {
            if (url === '/api/students/s1') return { success: true, student };
            if (url === '/api/students/s1/stats') return { success: true, stats: { attendanceRate: 100, recentHistory: [] } };
            if (url === '/api/memberships/student/s1') return { success: true, memberships: [membership] };
            if (url === '/api/payments/student/s1') return { success: true, payments: [] };
            if (url === '/api/freezes?studentId=s1') return { success: true, freezes: [] };
            throw new Error(`Unexpected request ${url}`);
        } }),
    });
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../frontend/js/modules/students/students.js'), 'utf8'), context);
    // These unrelated panels have their own DOM and network dependencies.
    context.showStudentDetailModal = () => {};
    context.window.switchStudentDetailTab = () => {};
    context.initStudentRegularScheduleEditor = async () => {};
    context.renderStudentIntegrationBlock = () => {};
    return { context, element, errors };
}

function record(extra = {}) {
    return { id: 's1', name: 'QA', lastName: 'Ученик', status: 'active',
        isLost: true, lastPaymentDate: null, accountBalance: 41100,
        groups: [], assignedTeacherId: 't1', phone: '70000000000', customerName: 'Родитель',
        balanceCoverage: { coveredLessons: 18, stopReason: 'insufficient_balance' }, ...extra };
}

test('an active prepaid student stays active after all card panels load despite the old payment inactivity flag', async () => {
    const { context, element, errors } = ui(record());
    await context.viewStudent('s1');
    assert.deepEqual(errors, []);
    const profile = element('studentBasicInfo').innerHTML;
    assert.match(profile, /Активен/);
    assert.match(profile, /41[\s\u00a0\u202f]?100/);
    assert.doesNotMatch(profile, /Потерян|student-lost-block|Возврат будет/);
    assert.equal(context.getStudentSafetyItems(record()).some(item => item.icon === 'lost'), false);
});

test('a real pause remains visible independently of the payment inactivity flag', async () => {
    const { context, element, errors } = ui(record({ status: 'inactive', pausedUntil: '2026-10-20', isLost: false }));
    await context.viewStudent('s1');
    assert.deepEqual(errors, []);
    assert.match(element('studentBasicInfo').innerHTML, /На паузе до/);
});

test('a recorded departure retains the actual completed education status', async () => {
    const { context, element, errors } = ui(record({ status: 'inactive', lostAt: '2026-10-01' }));
    await context.viewStudent('s1');
    assert.deepEqual(errors, []);
    assert.match(element('studentBasicInfo').innerHTML, /Завершил обучение/);
    assert.doesNotMatch(element('studentBasicInfo').innerHTML, /Потерян|student-lost-block/);
});
