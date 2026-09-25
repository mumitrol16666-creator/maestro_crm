const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function ui() {
    const dashboard = { innerHTML: '' };
    const context = vm.createContext({
        window: {},
        document: { body: { dataset: {} }, addEventListener() {}, getElementById: () => dashboard },
        escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
        normalizeSecureMediaUrl: () => '',
        getDeclension: () => 'уроков',
    });
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../frontend/js/modules/students/students.js'), 'utf8'), context);
    return { context, dashboard };
}

test('unlimited rate card displays its name and no technical expiry in both profile sections', () => {
    const { context, dashboard } = ui();
    const membership = { billingModel: 'rate_card', tariffName: 'Индивидуально', endDate: '9999-12-31T00:00:00.000Z' };
    const student = { name: 'QA', status: 'active', groups: [], activeMembership: membership,
        accountBalance: 23100, balanceCoverage: { coveredLessons: 6, stopReason: 'insufficient_balance' } };
    assert.equal(context.getMembershipFormatLabel(membership), 'Индивидуально');
    const overview = context.buildStudentProfileOverview(student);
    assert.match(overview, /Бессрочно/);
    assert.doesNotMatch(overview, /9999/);
    context.renderStudentOverviewDashboard(student, {}, membership);
    assert.match(dashboard.innerHTML, /Бессрочно/);
    assert.doesNotMatch(dashboard.innerHTML, /9999/);
    assert.equal(context.getBalanceBadgeClass(student, membership), 'active');
    // Old, dated memberships must keep their actual end date.
    const dated = { lessonFormat: 'individual', endDate: '2026-10-31T00:00:00.000Z' };
    assert.match(context.buildStudentProfileOverview({ ...student, activeMembership: dated }), /31\.10\.2026/);
});

test('a real missing price is shown as critical even with a positive balance', () => {
    const { context } = ui();
    const student = { accountBalance: 29250, balanceCoverage: { coveredLessons: 0, stopReason: 'price_unavailable' } };
    assert.equal(context.getBalanceBadgeClass(student, { billingModel: 'rate_card' }), 'critical');
});

test('tariff names render as text inside a balance badge', () => {
    const { context } = ui();
    const badge = context.renderMembershipBalanceBadge({ accountBalance: 0 }, {
        billingModel: 'rate_card', tariffName: '<b>Тариф</b>',
    });
    assert.match(badge, /&lt;b&gt;Тариф&lt;\/b&gt;/);
    assert.doesNotMatch(badge, /<b>/);
});
