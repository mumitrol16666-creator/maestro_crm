/**
 * Replaces the CRM direction catalog with Maestro's official directions and tariffs.
 * Existing student memberships are intentionally preserved. Run after a database backup.
 *
 * Usage: node scripts/reseed-directions-and-plans.js
 */
require('dotenv').config();

const { prisma } = require('../src/config/db');
const { replaceOfficialCatalog } = require('../src/services/officialCatalogSeeder');

async function main() {
    await prisma.$connect();

    const membershipCount = await prisma.membership.count();
    if (membershipCount > 0) {
        throw new Error(`Каталог не заменён: в базе есть ${membershipCount} абонемент(ов). Архивируйте или перенесите их отдельно.`);
    }

    console.log('Official catalog loaded:', await replaceOfficialCatalog());
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
