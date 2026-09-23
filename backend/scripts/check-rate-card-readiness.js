// Non-mutating billing diagnostic. --input permits offline review of a private snapshot.
const fs = require('node:fs');
const { auditRateCardReadiness } = require('../src/services/rateCardReadiness');
async function main() {
    let db;
    try {
        const index = process.argv.indexOf('--input');
        let snapshot;
        if (index >= 0) snapshot = JSON.parse(fs.readFileSync(process.argv[index + 1], 'utf8'));
        else {
            require('dotenv').config({ quiet: true });
            db = require('../src/config/db').prisma;
            snapshot = await require('./audit-rate-cards').readSnapshot(db);
        }
        const report = auditRateCardReadiness(snapshot);
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        if (!report.ready) process.exitCode = 2;
    } finally { if (db) await db.$disconnect(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
