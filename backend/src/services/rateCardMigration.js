const { createHash } = require('node:crypto');
const { normalizeRates, RATE_LABELS } = require('./rateCards');

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
    return value;
}

function snapshotFingerprint(snapshot) {
    snapshot = JSON.parse(JSON.stringify(snapshot));
    return createHash('sha256').update(JSON.stringify(stable({
        memberships: snapshot.memberships.map(m => ({ ...m, createdAt: String(m.createdAt), updatedAt: String(m.updatedAt) })).sort((a, b) => a.id.localeCompare(b.id)),
        groups: snapshot.groups.map(g => ({ id: g.id, billingType: g.billingType || null, name: g.name, isActive: g.isActive,
            plans: g.billingPlans.map(p => p.id).sort(), students: g.students.map(s => s.studentId).sort() })).sort((a, b) => a.id.localeCompare(b.id)),
        students: snapshot.students.map(s => ({ id: s.id, status: s.status, activeMembershipId: s.activeMembershipId })).sort((a, b) => a.id.localeCompare(b.id)),
    }))).digest('hex');
}

function rowFor(price, basePrice = price, reason = '') {
    if (!Number.isSafeInteger(price) || price < 0) return null;
    const base = Number.isSafeInteger(basePrice) && basePrice >= price ? basePrice : price;
    return { basePrice: base, discountAmount: base - price, discountPercent: 0,
        reason: reason || (price === 0 || base !== price ? 'Сохранены персональные условия прежнего абонемента' : '') };
}

function legacyRates(m) {
    if (m.billingModel === 'rate_card') return normalizeRates(m.lessonRates);
    const type = m.type || m.plan?.legacyType || '';
    const prices = {};
    if (m.lessonFormat === 'program' || /^hybrid_\d+m$/.test(type)) {
        const months = m.programMonths || Number(type.match(/hybrid_(\d+)m/)?.[1] || 1);
        const defaults = { individual: months === 1 ? 4000 : 3500, quartet: 2250, theory: 1000 };
        const hasSnapshot = [m.individualLessonPrice, m.groupLessonPrice, m.theoryLessonPrice].every(v => Number.isSafeInteger(v) && v >= 0);
        if (hasSnapshot) {
            prices.individual = rowFor(m.individualLessonPrice, defaults.individual, m.additionalDiscountReason);
            prices.quartet = rowFor(m.groupLessonPrice, defaults.quartet);
            prices.theory = rowFor(m.theoryLessonPrice, defaults.theory);
        } else {
            const counts = { individual: m.plan?.individualClasses || 4 * months, quartet: m.plan?.groupClasses || 4 * months, theory: m.plan?.theoryClasses || 2 * months };
            const nominal = defaults.individual * counts.individual + defaults.quartet * counts.quartet + defaults.theory * counts.theory;
            if (m.totalPrice !== nominal) throw new Error('У гибрида нет однозначных сохранённых расценок со скидкой');
            for (const [kind, price] of Object.entries(defaults)) prices[kind] = rowFor(price);
        }
    } else if (m.lessonFormat === 'individual' || type.startsWith('individual') || type === 'single_lesson') {
        const price = Number.isSafeInteger(m.individualLessonPrice) && m.individualLessonPrice >= 0 ? m.individualLessonPrice
            : m.totalClasses > 0 && m.totalPrice > 0 ? Math.round(m.totalPrice / m.totalClasses) : null;
        if (price === null) throw new Error('Не задана стоимость индивидуального урока');
        const base = m.additionalDiscountAmount > 0 && m.totalClasses > 0 ? Math.round((m.totalPrice + m.additionalDiscountAmount) / m.totalClasses)
            : m.basePrice > 0 && m.totalClasses > 0 ? Math.round(m.basePrice / m.totalClasses) : price;
        prices.individual = rowFor(price, base, m.additionalDiscountReason);
    } else if (type === 'theory' || type === 'quartet_only' || type.startsWith('duet')) {
        const kind = type === 'theory' ? 'theory' : type === 'quartet_only' ? 'quartet' : 'duo';
        const snapshot = kind === 'theory' ? m.theoryLessonPrice : m.groupLessonPrice;
        const price = Number.isSafeInteger(snapshot) && snapshot >= 0 ? snapshot
            : m.totalClasses > 0 && m.totalPrice > 0 ? Math.round(m.totalPrice / m.totalClasses) : null;
        if (price === null) throw new Error('Не задана цена урока');
        prices[kind] = rowFor(price, m.basePrice > 0 && m.totalClasses > 0 ? Math.round(m.basePrice / m.totalClasses) : price);
    } else throw new Error(`Тариф ${type}: требуется выбрать вид занятия и цену`);
    return normalizeRates(prices);
}

function classifyGroup(group, overrides = {}) {
    if (overrides[group.id]) return overrides[group.id];
    if (group.billingType) return group.billingType;
    if (/теори/i.test(group.name)) return 'theory';
    const types = [...new Set(group.billingPlans.map(p => p.legacyType))];
    if (types.length && types.every(t => /^duet/.test(t))) return 'duo';
    if (types.some(t => t === 'quartet_only' || /^hybrid_\d+m$/.test(t))
        && types.every(t => t.startsWith('hybrid_') || ['quartet_only', 'group_mini'].includes(t))) return 'quartet';
    return null;
}

function buildMigrationPlan(snapshot, overrides = {}) {
    const groups = snapshot.groups.filter(g => g.isActive).map(g => ({ id: g.id, name: g.name, billingType: classifyGroup(g, overrides) }));
    const assignments = [];
    const issues = [];
    const archiveIds = snapshot.memberships.filter(m => m.billingModel !== 'rate_card' && ['active', 'frozen'].includes(m.status)).map(m => m.id);
    for (const student of snapshot.students) {
        if (student.status !== 'active') continue;
        const existingCards = snapshot.memberships.filter(m => m.studentId === student.id && m.billingModel === 'rate_card' && m.status === 'active');
        if (existingCards.length) continue;
        const sources = snapshot.memberships.filter(m => m.studentId === student.id && m.status === 'active' && m.type !== 'trial')
            .sort((a, b) => Number(b.id === student.activeMembershipId) - Number(a.id === student.activeMembershipId)
                || new Date(b.createdAt) - new Date(a.createdAt));
        const rates = {};
        const rateSources = {};
        for (const m of sources) {
            // The first release blocks legacy mixed pricing until its conversion
            // can be reviewed; the old calculator differs from program defaults.
            if (m.lessonFormat === 'mixed') issues.push({ studentId: student.id, membershipId: m.id,
                kind: 'legacy_price_review', message: 'Смешанный абонемент требует проверки сохранения прежних расценок' });
            if (m.individualBudgetRemaining != null) issues.push({ studentId: student.id, membershipId: m.id,
                kind: 'legacy_budget_review', message: 'Остаток индивидуального бюджета требует отдельной проверки переноса' });
            try {
                for (const [kind, row] of Object.entries(legacyRates(m))) {
                    if (!rates[kind]) { rates[kind] = row; rateSources[kind] = m.id; }
                    else if (rates[kind].price !== row.price) issues.push({ studentId: student.id, name: `${student.lastName || ''} ${student.name}`.trim(),
                        kind: 'superseded_rate', message: `${RATE_LABELS[kind]}: сохранена цена ${rates[kind].price} из ${rateSources[kind]}; другой старый тариф ${m.id}: ${row.price}` });
                }
            } catch (error) { issues.push({ studentId: student.id, membershipId: m.id, kind: 'unresolved_legacy', message: error.message }); }
        }
        if (Object.keys(rates).length) assignments.push({ studentId: student.id, name: `${student.lastName || ''} ${student.name}`.trim(),
            tariffName: sources[0]?.tariffName || sources[0]?.plan?.name || (sources[0]?.type === 'program' ? `Основная программа ${sources[0].programMonths === 2 ? '50 000' : '27 000'}` : 'Персональный тариф'),
            lessonRates: rates, sourceIds: sources.map(m => m.id), rateSources });
        else issues.push({ studentId: student.id, name: `${student.lastName || ''} ${student.name}`.trim(), kind: 'no_rates', message: 'Нет действующего абонемента с однозначными расценками' });
    }
    for (const group of groups) {
        if (!group.billingType) { issues.push({ groupId: group.id, name: group.name, kind: 'group_type_missing', message: 'Укажите назначение группы' }); continue; }
        for (const member of snapshot.groups.find(g => g.id === group.id).students) {
            const assignment = assignments.find(a => a.studentId === member.studentId);
            const existing = snapshot.memberships.find(m => m.studentId === member.studentId && m.status === 'active' && m.billingModel === 'rate_card');
            if (!(assignment?.lessonRates || existing?.lessonRates)?.[group.billingType]) issues.push({ studentId: member.studentId, groupId: group.id,
                name: snapshot.students.find(s => s.id === member.studentId)?.name, kind: 'missing_group_rate', message: `Группа «${group.name}»: нет расценки ${RATE_LABELS[group.billingType]}` });
        }
    }
    const replacedSources = new Set(assignments.flatMap(row => row.sourceIds));
    for (const id of archiveIds) {
        if (!replacedSources.has(id)) issues.push({ membershipId: id, kind: 'unreplaced_source',
            message: 'Нельзя архивировать абонемент без проверенной замены' });
    }
    for (const freeze of snapshot.freezes || []) {
        if (archiveIds.includes(freeze.membershipId)) issues.push({ membershipId: freeze.membershipId,
            kind: 'open_freeze', message: 'Нельзя архивировать источник действующей или ожидающей заморозки' });
    }
    return { version: 1, fingerprint: snapshotFingerprint(snapshot), inputs: { groupOverrides: overrides }, groups, assignments, archiveIds, issues };
}

function validatePlan(snapshot, plan) {
    if (!plan || plan.version !== 1 || !plan.fingerprint) throw new Error('Некорректный план переноса');
    if (snapshotFingerprint(snapshot) !== plan.fingerprint) throw new Error('Данные изменились после подготовки плана. Подготовьте перенос заново.');
    const expected = buildMigrationPlan(snapshot, plan.inputs?.groupOverrides || {});
    if (JSON.stringify(stable(expected)) !== JSON.stringify(stable(plan))) {
        throw new Error('План изменён. Подготовьте перенос заново; удалять issues или изменять назначения нельзя.');
    }
    if (expected.issues.length) throw new Error(`Перенос заблокирован: ${expected.issues.length} нерешённых проблем`);
    return expected;
}

module.exports = { buildMigrationPlan, validatePlan, snapshotFingerprint, legacyRates, classifyGroup, rowFor };
