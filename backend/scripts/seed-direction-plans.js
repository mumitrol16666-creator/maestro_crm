/**
 * Скрипт: создаёт дефолтные планы абонементов для каждого направления,
 * у которого ещё нет ни одного плана.
 * 
 * Использует старые поля pricingTrial / pricingMonth / pricingThreeMonths
 * как основу для первоначальных планов.
 * 
 * Запуск: node scripts/seed-direction-plans.js
 */
require('dotenv').config();
const { prisma } = require('../src/config/db');

async function main() {
    await prisma.$connect();

    const directions = await prisma.direction.findMany({
        include: { plans: true }
    });

    let created = 0;

    for (const dir of directions) {
        if (dir.plans.length > 0) {
            console.log(`⏭️  ${dir.name} — уже есть ${dir.plans.length} план(ов), пропуск`);
            continue;
        }

        const defaults = [
            { label: 'Пробное (1 занятие)',           type: 'trial',              classes: 1,  days: 7,   price: dir.pricingTrial || 2000,         freezes: 0, order: 0 },
            { label: 'Разовое занятие (1 занятие)',     type: 'single_class',       classes: 1,  days: 1,   price: 3500,                            freezes: 0, order: 1 },
            { label: 'Месячный (8 занятий)',           type: 'monthly',            classes: 8,  days: 30,  price: dir.pricingMonth || 22000,        freezes: 1, order: 2 },
            { label: 'Месячный (12 занятий)',          type: 'monthly_12',         classes: 12, days: 30,  price: dir.pricingMonth || 22000,        freezes: 1, order: 3 },
            { label: 'Квартальный (24 занятия)',        type: 'quarterly',          classes: 24, days: 90,  price: dir.pricingThreeMonths || 55000,  freezes: 3, order: 4 },
            { label: 'Индивидуальное разовое (1)',      type: 'individual_single',  classes: 1,  days: 30,  price: 10000,                           freezes: 0, order: 5 },
            { label: 'Индивидуальный абонемент (8)',    type: 'individual_package', classes: 8,  days: 365, price: 55900,                           freezes: 0, order: 6 },
        ];

        for (const plan of defaults) {
            await prisma.directionPlan.create({
                data: { directionId: dir.id, ...plan }
            });
        }

        created += defaults.length;
        console.log(`✅ ${dir.name} — создано ${defaults.length} планов`);
    }

    console.log(`\n🏁 Готово! Создано ${created} планов`);
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
