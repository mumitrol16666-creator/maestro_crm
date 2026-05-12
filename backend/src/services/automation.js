const { prisma } = require('../config/db');

/**
 * Автоматическое списание занятий для прошедших уроков.
 * 
 * БИЗНЕС-ЛОГИКА:
 * 1. Берём ВСЕ прошедшие занятия за последние 90 дней (чтобы покрыть ретроспективу)
 * 2. Для каждого занятия берём учеников группы (через StudentGroup, status='active')
 * 3. Для каждого ученика проверяем:
 *    a) Было ли уже списание за это занятие? (через MembershipTransaction с classId)
 *    b) Была ли заморозка на дату занятия?
 *    c) Есть ли активный абонемент с classesRemaining > 0 для этой группы?
 * 4. Если всё ок — списываем 1 занятие.
 * 
 * ВАЖНО: Мы НЕ проверяем startDate/endDate абонемента жёстко.
 * Абонемент с оставшимися занятиями списывается, пока есть остаток.
 * Дата окончания — это рекомендация, а не блокировка.
 * Единственный критерий: status='active' И classesRemaining > 0.
 */
async function processPastClasses() {
    const logs = [];
    const log = (msg) => {
        const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const entry = `[${timestamp}] ${msg}`;
        console.log(entry);
        logs.push(entry);
    };

    try {
        log('🚀 Запуск процесса автоматизации...');

        const almatyOffset = 5 * 60 * 60 * 1000; // UTC+5
        const nowMs = Date.now();
        const almatyNow = new Date(nowMs + almatyOffset);

        // Окно поиска: 90 дней назад — сейчас
        const searchStart = new Date(nowMs - 90 * 24 * 60 * 60 * 1000);
        const searchEnd = new Date(nowMs + 24 * 60 * 60 * 1000);

        log(`📍 Время Алматы сейчас: ${almatyNow.toISOString().replace('T', ' ').slice(0, 16)}`);

        // ══════════════════════════════════════════
        // ШАГ 1: Получить ВСЕ занятия за 90 дней
        // ══════════════════════════════════════════
        const activeClasses = await prisma.class.findMany({
            where: {
                status: { not: 'cancelled' },
                isPractice: false,
                date: { gte: searchStart, lte: searchEnd }
            },
            include: {
                group: {
                    include: {
                        students: {
                            where: { status: { in: ['active', 'Active'] } }
                        }
                    }
                }
            }
        });

        log(`🔍 Найдено занятий: ${activeClasses.length}`);

        let totalDeducted = 0;
        let totalSkipped = 0;

        for (const cls of activeClasses) {
            // ── Вычисляем дату/время окончания в Алматы ──
            const clsDateAlmaty = new Date(cls.date.getTime() + almatyOffset);
            const clsDateStr = clsDateAlmaty.toISOString().split('T')[0];

            const clsEndAlmaty = new Date(clsDateAlmaty);
            const [endH, endM] = cls.endTime.split(':').map(Number);
            clsEndAlmaty.setUTCHours(endH, endM, 0, 0);

            // Если занятие ещё не закончилось — пропускаем
            if (almatyNow < clsEndAlmaty) continue;

            // ── Формируем список кандидатов ──
            const candidates = [];
            if (cls.groupId && cls.group) {
                candidates.push(...cls.group.students.map(s => s.studentId));
            } else if (cls.individualStudentId) {
                candidates.push(cls.individualStudentId);
            }

            if (candidates.length === 0) continue;

            // ══════════════════════════════════════════
            // ШАГ 2: Кто уже получил списание за ЭТОТ класс?
            // Проверяем по MembershipTransaction (единственный надёжный источник)
            // ══════════════════════════════════════════
            const existingDeductions = await prisma.membershipTransaction.findMany({
                where: { classId: cls.id, type: { in: ['deduct', 'manual_deduct'] } },
                include: { membership: { select: { studentId: true } } }
            });
            const alreadyDeducted = new Set(existingDeductions.map(t => t.membership.studentId));

            let deductedForThisClass = 0;

            for (const studentId of candidates) {
                // Уже списано — мгновенный пропуск
                if (alreadyDeducted.has(studentId)) {
                    totalSkipped++;
                    continue;
                }

                try {
                    await prisma.$transaction(async (tx) => {
                        // ── Проверка заморозки на дату занятия ──
                        const freezes = await tx.freeze.findMany({
                            where: { studentId, status: 'active' }
                        });
                        const isFrozen = freezes.some(f => {
                            const fStart = new Date(f.startDate.getTime() + almatyOffset).toISOString().split('T')[0];
                            const fEnd = new Date(f.endDate.getTime() + almatyOffset).toISOString().split('T')[0];
                            return clsDateStr >= fStart && clsDateStr <= fEnd;
                        });

                        if (isFrozen) {
                            log(`   ❄️ Заморозка: ${studentId.slice(-4)} на ${clsDateStr}`);
                            return;
                        }

                        // ══════════════════════════════════════════
                        // ШАГ 3: Найти абонемент для списания
                        // Приоритет: 
                        //   1. Абонемент этой группы с остатком
                        //   2. Общий абонемент (groupId=null) с остатком
                        // НЕ проверяем startDate/endDate — пока status='active'
                        // и classesRemaining > 0, абонемент валиден.
                        // ══════════════════════════════════════════
                        const memberships = await tx.membership.findMany({
                            where: {
                                studentId,
                                status: 'active',
                                classesRemaining: { gt: 0 },
                                OR: [
                                    { groupId: cls.groupId },
                                    { groupId: null }
                                ]
                            },
                            orderBy: { createdAt: 'desc' }
                        });

                        // Сначала ищем абонемент именно этой группы
                        let membership = memberships.find(m => m.groupId === cls.groupId);
                        // Если нет — берём общий (groupId=null)
                        if (!membership) {
                            membership = memberships.find(m => m.groupId === null);
                        }

                        if (!membership) {
                            // Нет абонемента с остатком — ничего не списываем
                            return;
                        }

                        // ══════════════════════════════════════════
                        // ШАГ 4: Выполняем списание
                        // ══════════════════════════════════════════
                        await tx.membership.update({
                            where: { id: membership.id },
                            data: {
                                classesRemaining: { decrement: 1 },
                                classesUsed: { increment: 1 }
                            }
                        });

                        await tx.membershipTransaction.create({
                            data: {
                                membershipId: membership.id,
                                type: 'deduct',
                                amount: 1,
                                reason: `Автосписание: ${cls.title} (${clsDateStr})`,
                                classId: cls.id
                            }
                        });

                        // Создаём или обновляем запись посещения
                        const existingAttendee = await tx.classAttendee.findFirst({
                            where: { classId: cls.id, studentId }
                        });

                        if (!existingAttendee) {
                            await tx.classAttendee.create({
                                data: {
                                    classId: cls.id,
                                    studentId,
                                    attended: false,
                                    autoDeducted: true,
                                    markedAt: new Date()
                                }
                            });
                        } else if (!existingAttendee.autoDeducted) {
                            await tx.classAttendee.update({
                                where: { id: existingAttendee.id },
                                data: { autoDeducted: true }
                            });
                        }

                        deductedForThisClass++;
                        totalDeducted++;
                        log(`   ✅ Списано у ${studentId.slice(-4)} за ${clsDateStr} (абонемент ${membership.id.slice(-6)})`);
                    });
                } catch (err) {
                    log(`   🔴 Ошибка ${studentId.slice(-4)}: ${err.message}`);
                }
            }

            if (deductedForThisClass > 0) {
                log(`   🏁 "${cls.title}" (${clsDateStr}): списано ${deductedForThisClass}`);
            }
        }

        log(`🎉 Завершено. Списано: ${totalDeducted}. Пропущено (уже обработаны): ${totalSkipped}`);
        return { success: true, logs, totalDeducted };
    } catch (error) {
        log(`🚨 КРИТИЧЕСКАЯ ОШИБКА: ${error.message}`);
        return { success: false, logs, error: error.message };
    }
}

module.exports = { processPastClasses };
