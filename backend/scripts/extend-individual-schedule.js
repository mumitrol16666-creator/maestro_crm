// Read-only preview by default. --apply creates only missing future lessons.
require('dotenv').config({ quiet: true });
const { prisma } = require('../src/config/db');
const { extendStudentIndividualSchedule } = require('../src/services/individualScheduleExtension');

async function main() {
    const args = process.argv.slice(2);
    const studentId = args.find(arg => arg.startsWith('--student-id='))?.slice('--student-id='.length);
    if (!studentId || args.some(arg => !arg.startsWith('--student-id=') && arg !== '--apply')) {
        throw new Error('Usage: node scripts/extend-individual-schedule.js --student-id=ID [--apply]');
    }
    const dryRun = !args.includes('--apply');
    const result = await extendStudentIndividualSchedule(studentId, { dryRun });
    console.log(JSON.stringify({ studentId, dryRun, ...result }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(async () => { await prisma.$disconnect(); });
