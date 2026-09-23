require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const { prisma } = require('../src/config/db');
const { capture } = require('./audit-rate-cards');
const { buildMigrationPlan, validatePlan } = require('../src/services/rateCardMigration');
const { rateCardMembershipData, normalizeRates, GROUP_BILLING_TYPES } = require('../src/services/rateCards');

async function applyPlan(db, plan) {
    if (!plan || plan.version !== 1 || !plan.fingerprint) throw new Error('Некорректный план переноса');
    return db.$transaction(async tx => {
        // Lock all financial participants in the same order as lesson approval.
        await tx.$queryRaw`SELECT id FROM "Student" WHERE role = 'student' ORDER BY id FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "Membership" ORDER BY id FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "Group" ORDER BY id FOR UPDATE`;
        const before = await capture(tx);
        plan = validatePlan(before, plan);
        const approvedArchiveIds = new Set(before.memberships.filter(m => m.billingModel !== 'rate_card' && ['active', 'frozen'].includes(m.status)).map(m => m.id));
        if (plan.archiveIds.some(id => !approvedArchiveIds.has(id))) throw new Error('В плане есть недопустимые архивируемые абонементы');
        for (const row of plan.groups) {
            if (!row.billingType) continue;
            if (!GROUP_BILLING_TYPES.includes(row.billingType)) throw new Error('Недопустимый тип группы');
            await tx.group.update({ where: { id: row.id }, data: { billingType: row.billingType, billingPlans: { set: [] } } });
        }
        await tx.membership.updateMany({ where: { id: { in: plan.archiveIds } }, data: { status: 'archived' } });
        await tx.student.updateMany({ where: { activeMembershipId: { in: plan.archiveIds } }, data: { activeMembershipId: null } });
        await tx.membershipPlan.updateMany({ where: { billingModel: { not: 'rate_card' } }, data: { status: 'archived', isVisible: false } });
        await tx.directionPlan.updateMany({ where: { isActive: true }, data: { isActive: false } });
        const created = [];
        for (const row of plan.assignments) {
            const student = before.students.find(s => s.id === row.studentId && s.status === 'active');
            const sources = before.memberships.filter(m => row.sourceIds.includes(m.id) && m.studentId === row.studentId && plan.archiveIds.includes(m.id));
            if (!student || sources.length !== row.sourceIds.length || !sources.length || created.some(c => c.studentId === row.studentId)) throw new Error('Некорректные источники тарифа в плане переноса');
            const membership = await tx.membership.create({ data: rateCardMembershipData({ studentId: row.studentId,
                name: row.tariffName, rates: normalizeRates(row.lessonRates), previousMembershipId: row.sourceIds[0] || null, source: 'rate_card_migration',
                teacherId: sources.find(m => m.teacherId)?.teacherId || null,
                emergencyFreezesAvailable: sources.reduce((sum, m) => sum + (m.emergencyFreezesAvailable || 0), 0),
                emergencyFreezesUsed: sources.reduce((sum, m) => sum + (m.emergencyFreezesUsed || 0), 0),
                freezesAvailable: sources.reduce((sum, m) => sum + (m.freezesAvailable || 0), 0),
            }) });
            await tx.membershipTransaction.create({ data: { membershipId: membership.id, type: 'initial', amount: 0,
                reason: `Перенос расценок без изменения денег. Источники: ${row.sourceIds.join(', ')}` } });
            await tx.student.update({ where: { id: row.studentId }, data: { activeMembershipId: membership.id } });
            created.push({ studentId: row.studentId, membershipId: membership.id });
        }
        // Catalog values are explicit editable templates, never a fallback for charging.
        const templates = [
            ['program_27000', 'Основная программа 27 000', { individual: 4000, quartet: 2250, theory: 1000 }],
            ['program_50000', 'Основная программа 50 000', { individual: 3500, quartet: 2250, theory: 1000 }],
            ['individual_32000', 'Индивидуально 32 000 / 8', { individual: 4000 }],
            ['individual_62000', 'Индивидуально 62 000 / 16', { individual: 3875 }],
            ['individual_90000', 'Индивидуально 90 000 / 24', { individual: 3750 }],
            ['duo_22000', 'Дуо 22 000 / 8', { duo: 2750 }],
            ['duo_40000', 'Дуо 40 000 / 16', { duo: 2500 }],
            ['theory', 'Теория', { theory: 1000 }],
            ['quartet', 'Квартет', { quartet: 2250 }],
        ];
        for (const [key, name, rates] of templates) {
            const id = `rate_card_${key}_v1`;
            await tx.membershipPlan.upsert({ where: { id }, update: {}, create: {
                id, name, legacyType: id, lessonRates: normalizeRates(rates), billingModel: 'rate_card', lessonFormat: 'rate_card',
                includedUnits: 0, price: 0, groupBindMode: 'none', validityModel: 'unlimited', validityDays: null,
            } });
        }
        const after = await tx.student.findMany({ where: { role: 'student' }, select: { id: true, accountBalance: true } });
        const balanceById = new Map(before.students.map(s => [s.id, s.accountBalance]));
        if (after.some(s => s.accountBalance !== balanceById.get(s.id))) throw new Error('Перенос изменил денежный баланс');
        return { created, archived: plan.archiveIds.length, unresolved: plan.issues, balancesUnchanged: true };
    }, { timeout: 60000, maxWait: 10000, isolationLevel: 'Serializable' });
}

async function main() {
    if (process.argv[2] === '--apply') {
        const path = process.argv[3];
        if (!path) throw new Error('Укажите файл подготовленного плана');
        const result = await applyPlan(prisma, JSON.parse(fs.readFileSync(path, 'utf8')));
        process.stdout.write(JSON.stringify(result, null, 2));
    } else {
        const snapshot = await capture(prisma);
        const overrides = process.env.RATE_CARD_GROUP_OVERRIDES ? JSON.parse(process.env.RATE_CARD_GROUP_OVERRIDES) : {};
        const plan = buildMigrationPlan(snapshot, overrides);
        process.stdout.write(JSON.stringify(plan, null, 2));
        if (plan.issues.length) process.exitCode = 2;
    }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
module.exports = { applyPlan };
