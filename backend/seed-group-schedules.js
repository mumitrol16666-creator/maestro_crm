#!/usr/bin/env node
/**
 * seed-group-schedules.js
 *
 * Небольшой one-off скрипт, который:
 *   1) находит все активные группы;
 *   2) если у группы не назначен teacherId — подставляет одного из учителей
 *      (Student.role === 'teacher'), распределяя их по кругу;
 *   3) если у группы ещё нет записей в GroupSchedule —
 *      создаёт 2 слота в неделю из набора разумных вариантов,
 *      чтобы можно было протестировать автогенерацию занятий.
 *
 * Ничего не удаляет: если у группы уже есть расписание — пропускает её.
 *
 * Запуск из папки backend:
 *   node seed-group-schedules.js
 *
 * Опции (переменные окружения):
 *   DRY_RUN=1   — ничего не писать в БД, только вывести план
 *   FORCE=1     — перезаписать (удалить старые GroupSchedule и создать заново)
 */

require('dotenv').config();
const { prisma } = require('./src/config/db');

// Варианты слотов по 2 занятия в неделю (dayOfWeek: 1=Пн … 7=Вс, time HH:MM)
const SCHEDULE_TEMPLATES = [
    [ { dayOfWeek: 1, time: '18:00' }, { dayOfWeek: 3, time: '18:00' } ], // Пн/Ср 18:00
    [ { dayOfWeek: 2, time: '19:00' }, { dayOfWeek: 4, time: '19:00' } ], // Вт/Чт 19:00
    [ { dayOfWeek: 1, time: '19:30' }, { dayOfWeek: 5, time: '19:30' } ], // Пн/Пт 19:30
    [ { dayOfWeek: 3, time: '17:00' }, { dayOfWeek: 6, time: '12:00' } ], // Ср/Сб 17:00/12:00
    [ { dayOfWeek: 2, time: '17:30' }, { dayOfWeek: 5, time: '17:30' } ], // Вт/Пт 17:30
    [ { dayOfWeek: 4, time: '18:30' }, { dayOfWeek: 6, time: '13:00' } ], // Чт/Сб
    [ { dayOfWeek: 1, time: '20:00' }, { dayOfWeek: 3, time: '20:00' } ], // Пн/Ср 20:00
];

const DEFAULT_DURATION = 60;

const DAY_NAMES = { 1: 'Пн', 2: 'Вт', 3: 'Ср', 4: 'Чт', 5: 'Пт', 6: 'Сб', 7: 'Вс' };

async function main() {
    const DRY_RUN = process.env.DRY_RUN === '1';
    const FORCE = process.env.FORCE === '1';

    console.log('🔌 Подключение к БД...');
    await prisma.$connect();

    const [groups, teachers, rooms] = await Promise.all([
        prisma.group.findMany({
            where: { isActive: true },
            include: { schedules: true },
            orderBy: { name: 'asc' }
        }),
        prisma.student.findMany({
            where: { role: 'teacher', status: 'active' },
            select: { id: true, name: true, lastName: true }
        }),
        prisma.room.findMany({
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { name: 'asc' }
        })
    ]);

    console.log(`\n📊 Найдено:`);
    console.log(`  активных групп: ${groups.length}`);
    console.log(`  учителей:       ${teachers.length}`);
    console.log(`  залов:          ${rooms.length}`);
    if (DRY_RUN) console.log(`  🧪 DRY_RUN — изменения в БД не будут записаны`);
    if (FORCE)   console.log(`  ⚠️  FORCE — существующие расписания групп будут перезаписаны`);
    console.log('');

    if (groups.length === 0) {
        console.warn('⚠️ Нет активных групп. Сначала создайте группы в админке.');
        await prisma.$disconnect();
        process.exit(0);
    }

    if (teachers.length === 0) {
        console.warn('⚠️ Нет учителей (Student.role = "teacher"). teacherId будет оставлен пустым там, где его не было.');
    }

    const defaultRoomId = rooms[0]?.id || null;
    let teacherCursor = 0;
    let templateCursor = 0;

    const plan = [];

    for (const group of groups) {
        const hasSchedule = (group.schedules || []).length > 0;
        const needsSchedule = FORCE || !hasSchedule;

        const assignedTeacherId = group.teacherId
            || (teachers.length > 0 ? teachers[teacherCursor++ % teachers.length].id : null);

        const template = SCHEDULE_TEMPLATES[templateCursor++ % SCHEDULE_TEMPLATES.length];

        plan.push({
            group,
            assignedTeacherId,
            assignedTeacherChanged: !group.teacherId && !!assignedTeacherId,
            hasSchedule,
            needsSchedule,
            newSchedules: needsSchedule
                ? template.map(t => ({
                    ...t,
                    duration: DEFAULT_DURATION,
                    roomId: defaultRoomId,
                    isPractice: false
                }))
                : []
        });
    }

    console.log('📋 План:');
    for (const p of plan) {
        const scheduleStr = p.needsSchedule
            ? p.newSchedules.map(s => `${DAY_NAMES[s.dayOfWeek]} ${s.time}`).join(', ')
            : `уже есть (${p.group.schedules.length})`;
        const teacherStr = p.assignedTeacherChanged
            ? `назначим учителя ${p.assignedTeacherId}`
            : (p.group.teacherId ? `teacher=${p.group.teacherId}` : 'без учителя');
        console.log(`  • ${p.group.name.padEnd(30)}  ${scheduleStr.padEnd(30)}  ${teacherStr}`);
    }
    console.log('');

    if (DRY_RUN) {
        console.log('🧪 DRY_RUN — выходим без записи в БД.');
        await prisma.$disconnect();
        process.exit(0);
    }

    let createdSchedules = 0;
    let updatedTeachers = 0;
    let wipedSchedules = 0;

    for (const p of plan) {
        if (p.assignedTeacherChanged) {
            await prisma.group.update({
                where: { id: p.group.id },
                data: { teacherId: p.assignedTeacherId }
            });
            updatedTeachers++;
        }

        if (!p.needsSchedule) continue;

        if (FORCE && p.hasSchedule) {
            const { count } = await prisma.groupSchedule.deleteMany({
                where: { groupId: p.group.id }
            });
            wipedSchedules += count;
        }

        for (const s of p.newSchedules) {
            await prisma.groupSchedule.create({
                data: {
                    groupId: p.group.id,
                    dayOfWeek: s.dayOfWeek,
                    time: s.time,
                    duration: s.duration,
                    roomId: s.roomId,
                    isPractice: s.isPractice
                }
            });
            createdSchedules++;
        }
    }

    console.log('');
    console.log('✨ Готово.');
    console.log(`  teacherId проставлено:     ${updatedTeachers}`);
    if (FORCE) console.log(`  старых расписаний удалено: ${wipedSchedules}`);
    console.log(`  новых слотов создано:      ${createdSchedules}`);

    await prisma.$disconnect();
    process.exit(0);
}

main().catch(async (err) => {
    console.error('❌ Ошибка:', err);
    try { await prisma.$disconnect(); } catch (_) {}
    process.exit(1);
});
