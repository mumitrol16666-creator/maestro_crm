/**
 * Скрипт: Полная очистка и пересоздание направлений и их тарифных планов (абонементов).
 * 
 * Очищает: MembershipPlan, DirectionPlan, Direction.
 * Создает: 6 официальных направлений.
 * Создает: 7 тарифных планов для каждого направления.
 * Запускает: Синхронизацию планов.
 * 
 * Запуск: node scripts/reseed-directions-and-plans.js
 */
require('dotenv').config();
const { prisma } = require('../src/config/db');
const { syncAllMembershipPlans } = require('../src/services/membershipPlanSync');

async function main() {
    await prisma.$connect();
    console.log('🗑️  Очистка старых направлений и планов...');
    
    // Удаляем в правильном порядке зависимостей
    await prisma.membershipPlan.deleteMany();
    await prisma.directionPlan.deleteMany();
    
    // Чтобы не было конфликтов с внешними ключами у студентов/учителей
    // обнуляем ссылки на направления перед удалением
    await prisma.student.updateMany({
        where: { activeMembershipId: { not: null } },
        data: { activeMembershipId: null }
    });
    await prisma.membership.deleteMany();
    await prisma.direction.deleteMany();

    console.log('🎨 Создание 6 официальных направлений...');
    const directionNames = [
        'Гитара', 
        'Электрогитара', 
        'Басгитара', 
        'Вокал', 
        'Фортепиано', 
        'Укулеле'
    ];

    const directions = [];
    for (const name of directionNames) {
        const dir = await prisma.direction.create({
            data: {
                name,
                description: `Занятия по направлению «${name}» в музыкальной школе Maestro`,
                minAge: 6,
                level: 'Любой',
                pricingTrial: 2000,
                pricingMonth: 22000,
                pricingThreeMonths: 55000,
                order: 0
            }
        });
        directions.push(dir);
        console.log(`✅ Направление создано: ${name}`);
    }

    console.log('💳 Создание 7 тарифных планов для каждого направления...');
    for (const dir of directions) {
        const defaults = [
            { label: 'Пробное (1 занятие)',           type: 'trial',              classes: 1,  days: 7,   price: 2000,   order: 0 },
            { label: 'Разовое занятие (1 занятие)',     type: 'single_class',       classes: 1,  days: 1,   price: 3500,   order: 1 },
            { label: 'Месячный (8 занятий)',           type: 'monthly',            classes: 8,  days: 30,  price: 22000,  order: 2 },
            { label: 'Месячный (12 занятий)',          type: 'monthly_12',         classes: 12, days: 30,  price: 22000,  order: 3 },
            { label: 'Квартальный (24 занятия)',        type: 'quarterly',          classes: 24, days: 90,  price: 55000,  order: 4 },
            { label: 'Индивидуальное разовое (1)',      type: 'individual_single',  classes: 1,  days: 30,  price: 10000,  order: 5 },
            { label: 'Индивидуальный абонемент (8)',    type: 'individual_package', classes: 8,  days: 365, price: 55900,  order: 6 },
        ];

        for (const plan of defaults) {
            await prisma.directionPlan.create({
                data: { directionId: dir.id, ...plan }
            });
        }
        console.log(`   └─ 7 планов добавлено для ${dir.name}`);
    }

    console.log('🔄 Синхронизация планов абонементов...');
    await syncAllMembershipPlans();
    console.log('🏁 Пересоздание направлений и планов завершено успешно!');
}

main()
    .catch(e => { 
        console.error('❌ Ошибка:', e); 
        process.exit(1); 
    })
    .finally(() => prisma.$disconnect());
