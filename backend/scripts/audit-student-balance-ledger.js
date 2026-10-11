// Read-only: snapshot before cutover, reconcile after it. Never repairs money.
const { createHash } = require('node:crypto');

function verifyCutover(before, after) {
    if (!Array.isArray(before?.snapshot?.students) || !Array.isArray(after?.snapshot?.students)
        || after.consistent !== true || JSON.stringify(before.snapshot) !== JSON.stringify(after.snapshot)) {
        throw new Error('BALANCE_CUTOVER_MISMATCH: balances changed or the journal does not reconcile; keep writes stopped');
    }
    return true;
}

async function auditBalanceLedger(db, { snapshotOnly = false } = {}) {
    return db.$transaction(async tx => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const students = await tx.student.findMany({ where: { role: 'student' },
            select: { id: true, accountBalance: true }, orderBy: { id: 'asc' } });
        const snapshot = {
            count: students.length,
            total: students.reduce((sum, student) => sum + student.accountBalance, 0),
            fingerprint: createHash('sha256').update(JSON.stringify(students)).digest('hex'),
            students,
        };
        if (snapshotOnly) return { capturedAt: new Date().toISOString(), snapshot };
        const discrepancies = await tx.$queryRaw`
            WITH chain AS (
                SELECT *, lag("balanceAfter") OVER (PARTITION BY "studentId" ORDER BY position) AS previous,
                    row_number() OVER (PARTITION BY "studentId" ORDER BY position) - 1 AS expected_position
                FROM "StudentBalanceEntry"
            ), totals AS (
                SELECT "studentId", sum(amount)::BIGINT AS total, count(*)::INT AS entries,
                    count(*) FILTER (WHERE kind = 'opening')::INT AS openings,
                    count(*) FILTER (WHERE position <> expected_position OR
                        (position = 0 AND (kind <> 'opening' OR "balanceBefore" <> 0)) OR
                        (position > 0 AND "balanceBefore" IS DISTINCT FROM previous) OR
                        "balanceAfter"::BIGINT - "balanceBefore"::BIGINT <> amount::BIGINT)::INT AS broken
                FROM chain GROUP BY "studentId"
            )
            SELECT s.id AS "studentId", s."accountBalance", COALESCE(t.total, 0)::TEXT AS "journalBalance",
                COALESCE(t.entries, 0) AS entries, COALESCE(t.openings, 0) AS openings, COALESCE(t.broken, 0) AS "brokenLinks"
            FROM "Student" s LEFT JOIN totals t ON t."studentId" = s.id
            WHERE (s.role = 'student' OR t.entries IS NOT NULL)
              AND (t.openings IS DISTINCT FROM 1 OR t.broken > 0 OR t.total IS DISTINCT FROM s."accountBalance"::BIGINT)
            ORDER BY s.id
        `;
        const pendingReview = await tx.studentBalanceEntry.count({ where: { needsReview: true } });
        return { capturedAt: new Date().toISOString(), snapshot,
            consistent: discrepancies.length === 0, discrepancies, pendingReview };
    }, { isolationLevel: 'RepeatableRead' });
}

if (require.main === module) {
    require('dotenv').config();
    const { prisma } = require('../src/config/db');
    auditBalanceLedger(prisma, { snapshotOnly: process.argv.includes('--snapshot') })
        .then(result => {
            const compareIndex = process.argv.indexOf('--compare-with');
            if (compareIndex !== -1) {
                const before = JSON.parse(require('node:fs').readFileSync(process.argv[compareIndex + 1], 'utf8'));
                verifyCutover(before, result);
            }
            console.log(JSON.stringify(result, null, 2));
            if (result.consistent === false) process.exitCode = 1;
        })
        .catch(error => { console.error(error.message); process.exitCode = 1; })
        .finally(() => prisma.$disconnect());
}

module.exports = { auditBalanceLedger, verifyCutover };
