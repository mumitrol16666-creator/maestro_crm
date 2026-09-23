const { normalizeRates, getLessonBillingType } = require('./rateCards');
function auditRateCardReadiness(snapshot) {
    const issues = [];
    const groups = new Map(snapshot.groups.map(g => [g.id, g]));
    const students = new Map(snapshot.students.map(s => [s.id, s]));
    const byStudent = new Map();
    const add = issue => issues.push({ severity: 'blocker', ...issue });
    for (const m of snapshot.memberships.filter(m => m.billingModel === 'rate_card' && ['active', 'frozen'].includes(m.status))) {
        try {
            const normalized = normalizeRates(m.lessonRates);
            if (Object.keys(normalized).some(k => normalized[k].price !== m.lessonRates[k].price)) throw new Error('Итоговая цена не соответствует скидке');
        } catch (error) { add({ kind: 'invalid_rate_card', studentId: m.studentId, membershipId: m.id, message: error.message }); continue; }
        if (m.status === 'active') byStudent.set(m.studentId, [...(byStudent.get(m.studentId) || []), m]);
    }
    for (const s of snapshot.students) {
        const cards = byStudent.get(s.id) || [];
        if (s.status === 'active' && !cards.length) add({ kind: 'no_rates', studentId: s.id, message: 'У активного ученика нет действующих расценок' });
        if (cards.length > 1) add({ kind: 'multiple_rate_cards', studentId: s.id, membershipIds: cards.map(m => m.id), message: 'Несколько активных назначений' });
        if (s.activeMembershipId && !snapshot.memberships.some(m => m.id === s.activeMembershipId && m.studentId === s.id && ['active', 'frozen'].includes(m.status))) add({ kind: 'invalid_active_reference', studentId: s.id, membershipId: s.activeMembershipId, message: 'Активная ссылка не соответствует назначению ученика' });
    }
    for (const f of snapshot.freezes || []) {
        const source = snapshot.memberships.find(m => m.id === f.membershipId);
        if (!source || !['active', 'frozen'].includes(source.status)) add({ kind: 'open_freeze_on_unavailable_source', studentId: f.studentId, membershipId: f.membershipId, freezeId: f.id, message: 'Действующая заморозка связана с недоступным назначением' });
    }
    const seen = new Set();
    function check(studentId, kind, context) {
        if (!studentId || !kind) return;
        const key = JSON.stringify([studentId, kind, context.classId || context.groupId]);
        if (seen.has(key)) return;
        seen.add(key);
        const cards = (byStudent.get(studentId) || []).filter(m => m.lessonRates[kind]);
        if (cards.length !== 1) add({ kind: cards.length ? 'ambiguous_lesson_rate' : 'missing_lesson_rate', studentId, billingType: kind, ...context, message: cards.length ? 'Требуется однозначное назначение' : `Нет расценки ${kind}` });
    }
    for (const g of snapshot.groups.filter(g => g.isActive)) {
        const kind = getLessonBillingType({ classType: 'group', group: g });
        if (!kind) add({ kind: 'group_type_missing', groupId: g.id, message: 'Не задан тип списания группы' });
        for (const member of g.students || []) if (students.get(member.studentId)?.status === 'active' && member.status !== 'frozen') check(member.studentId, kind, { groupId: g.id });
    }
    for (const l of snapshot.lessons || []) {
        if (l.isPractice || ['trial', 'rent'].includes(l.classType) || ['completed', 'cancelled'].includes(l.status)) continue;
        const g = groups.get(l.groupId);
        const kind = getLessonBillingType({ ...l, group: g });
        if (!kind) add({ kind: 'group_type_missing', groupId: l.groupId, classId: l.id, message: 'У незакрытого урока нет назначения группы' });
        const ids = new Set([l.individualStudentId, ...(l.attendees || []).filter(a => a.attendanceStatus !== 'excused_absence').map(a => a.studentId)]);
        if (!l.attendees?.length) for (const m of g?.students || []) if (m.status !== 'frozen' && students.get(m.studentId)?.status === 'active') ids.add(m.studentId);
        for (const id of ids) check(id, kind, { classId: l.id, ...(l.groupId ? { groupId: l.groupId } : {}) });
    }
    return { capturedAt: snapshot.capturedAt, horizon: snapshot.horizon, ready: !issues.length, counts: {
        activeStudents: snapshot.students.filter(s => s.status === 'active').length,
        activeCards: snapshot.memberships.filter(m => m.billingModel === 'rate_card' && m.status === 'active').length,
        migrationCards: snapshot.memberships.filter(m => m.source === 'rate_card_migration').length,
        lessons: (snapshot.lessons || []).length, blockers: issues.length }, issues };
}
module.exports = { auditRateCardReadiness };
