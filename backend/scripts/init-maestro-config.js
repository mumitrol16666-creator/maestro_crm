/**
 * Инициализация направлений и кабинетов для музыкальной школы Maestro.
 * Запуск: node scripts/init-maestro-config.js
 * FORCE=1 — пересоздать направления и кабинеты с нуля
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { prisma } = require('../src/config/db');

const DIRECTIONS = [
  { name: 'Гитара', description: 'Акустическая и электрогитара, с нуля до продвинутого уровня', minAge: 7, level: 'Все уровни', order: 1 },
  { name: 'Вокал', description: 'Постановка голоса, эстрадный и академический вокал', minAge: 6, level: 'Все уровни', order: 2 },
  { name: 'Фортепиано', description: 'Классическое фортепиано и подготовка к выступлениям', minAge: 5, level: 'Все уровни', order: 3 },
  { name: 'Укулеле', description: 'Лёгкий старт в музыку для детей и взрослых', minAge: 6, level: 'Начинающие', order: 4 },
  { name: 'Скрипка', description: 'Техника, интонация и развитие музыкального слуха', minAge: 7, level: 'Все уровни', order: 5 },
  { name: 'Барабаны', description: 'Ударная установка, ритм и координация', minAge: 8, level: 'Все уровни', order: 6 },
  { name: 'Сольфеджио', description: 'Нотная грамота, слух и теория музыки', minAge: 6, level: 'Все уровни', order: 7 },
  { name: 'Ансамбль', description: 'Совместные выступления и работа в группе', minAge: 10, level: 'Средний и выше', order: 8 },
];

const ROOMS = [
  { name: 'Кабинет 1', color: '#C9A227' },
  { name: 'Кабинет 2', color: '#2C2416' },
  { name: 'Зал ансамбля', color: '#4d97eb' },
  { name: 'Индивидуальный кабинет', color: '#8B7355' },
];

const PRICING = { trial: 2000, month: 22000, threeMonths: 55000 };

async function main() {
  const force = process.env.FORCE === '1';

  if (force) {
    console.log('🗑️  FORCE=1: удаляем старые направления и кабинеты...');
    await prisma.directionPlan.deleteMany();
    await prisma.direction.deleteMany();
    await prisma.room.deleteMany();
  }

  console.log('🎵 Направления...');
  for (const dir of DIRECTIONS) {
    await prisma.direction.upsert({
      where: { name: dir.name },
      update: {
        description: dir.description,
        minAge: dir.minAge,
        level: dir.level,
        order: dir.order,
        pricingTrial: PRICING.trial,
        pricingMonth: PRICING.month,
        pricingThreeMonths: PRICING.threeMonths,
        isActive: true,
      },
      create: {
        ...dir,
        pricingTrial: PRICING.trial,
        pricingMonth: PRICING.month,
        pricingThreeMonths: PRICING.threeMonths,
      },
    });
    console.log(`  ✅ ${dir.name}`);
  }

  console.log('🏠 Кабинеты...');
  for (const room of ROOMS) {
    const existing = await prisma.room.findFirst({ where: { name: room.name } });
    if (existing) {
      await prisma.room.update({ where: { id: existing.id }, data: { color: room.color } });
    } else {
      await prisma.room.create({ data: room });
    }
    console.log(`  ✅ ${room.name}`);
  }

  console.log('\n🎉 Готово! Направления и кабинеты Maestro настроены.');
}

main()
  .catch((err) => {
    console.error('❌', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
