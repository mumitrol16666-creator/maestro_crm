const test = require('node:test');
const assert = require('node:assert/strict');
const { auditRateCardReadiness } = require('../src/services/rateCardReadiness');
const { normalizeRates } = require('../src/services/rateCards');
const member = (extra = {}) => ({ id: 'm', studentId: 's', type: 'duet', lessonFormat: 'group', billingModel: 'legacy', status: 'active', totalPrice: 22000, totalClasses: 8, ...extra });
const snapshot = (memberships = [member()], extra = {}) => ({ capturedAt: '2026-09-23T00:00:00.000Z', students: [{ id: 's', status: 'active', name: 'Test', activeMembershipId: 'm', accountBalance: 50000 }], memberships, groups: [], lessons: [], plans: [], directions: [], transactions: [], ...extra });

test('readiness covers old lessons of inactive groups, missing individual rates and duplicate cards', () => {
    const cards=[member({billingModel:'rate_card',lessonRates:normalizeRates({duo:2750})})];
    const s=snapshot(cards,{groups:[{id:'g',isActive:false,students:[],billingType:null}],lessons:[{id:'old',classType:'group',status:'pending_admin_review',groupId:'g',attendees:[{studentId:'s'}]},{id:'individual',classType:'individual',individualStudentId:'s',attendees:[]}]});
    const r=auditRateCardReadiness(s);assert.ok(r.issues.some(i=>i.classId==='old'&&i.kind==='group_type_missing'));assert.ok(r.issues.some(i=>i.classId==='individual'));
    assert.ok(auditRateCardReadiness({...s,memberships:[...cards,{...cards[0],id:'other'}]}).issues.some(i=>i.kind==='multiple_rate_cards'));
});
