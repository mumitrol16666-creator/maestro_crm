/**
 * Заполняет снапшоты цены урока у старых однородных абонементов
 * (lessonFormat = group: дуо, квартет, теория, старые групповые), у которых
 * все три поля *LessonPrice пустые. Источник цены: фактическая покупка
 * (lessonPrice или totalPrice / totalClasses), то есть цена уже со скидкой.
 *
 * Гибриды (mixed), программы, индивидуальные и пробные абонементы не трогает.
 *
 * По умолчанию dry-run: печатает сводку без PII и ничего не пишет.
 * Запись только с флагом --apply. Перед запуском на проде нужен бэкап.
 *
 * Usage:
 *   node scripts/backfill-legacy-membership-lesson-prices.js                  # dry-run
 *   node scripts/backfill-legacy-membership-lesson-prices.js --status=active  # только активные
 *   node scripts/backfill-legacy-membership-lesson-prices.js --apply          # запись
 */
require('dotenv').config();

const { prisma } = require('../src/config/db');
const { getMembershipAverageLessonPrice } = require('../src/services/lessonPricing');

const APPLY = process.argv.includes('--apply');
const CHUNK_SIZE = 100;

function argValue(name, fallback = null) {
    const prefix = `--${name}=`;
    const match = process.argv.find(arg => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : fallback;
}

async function main() {
    const status = argValue('status', null);
    const where = {
        lessonFormat: { notIn: ['program', 'individual', 'trial', 'mixed'] },
        groupLessonPrice: null,
        theoryLessonPrice: null,
        individualLessonPrice: null,
        ...(status ? { status } : {}),
    };

    const rows = await prisma.membership.findMany({
        where,
        select: {
            id: true, type: true, lessonFormat: true, status: true,
            lessonPrice: true, totalPrice: true, totalClasses: true, basePrice: true,
            plan: { select: { legacyType: true } },
        },
        orderBy: { createdAt: 'asc' },
    });

    const updates = [];
    const skipped = [];
    const byType = {};
    for (const membership of rows) {
        const average = getMembershipAverageLessonPrice(membership);
        const legacyType = String(membership.plan?.legacyType || membership.type || 'unknown');
        if (average === null) {
            skipped.push({ id: membership.id, type: legacyType, status: membership.status, reason: 'no_purchase_data' });
            continue;
        }
        const field = legacyType === 'theory' ? 'theoryLessonPrice' : 'groupLessonPrice';
        updates.push({ id: membership.id, field, value: average });
        const key = `${legacyType}:${field}:${average}`;
        byType[key] = (byType[key] || 0) + 1;
    }

    let updated = 0;
    if (APPLY) {
        for (let index = 0; index < updates.length; index += CHUNK_SIZE) {
            const chunk = updates.slice(index, index + CHUNK_SIZE);
            await prisma.$transaction(chunk.map(update => prisma.membership.update({
                where: { id: update.id },
                data: { [update.field]: update.value },
            })));
            updated += chunk.length;
        }
    }

    console.log(JSON.stringify({
        mode: APPLY ? 'apply' : 'dry-run',
        statusFilter: status,
        candidates: rows.length,
        planned: updates.length,
        updated,
        skipped,
        byTypeFieldValue: byType,
    }, null, 2));
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
