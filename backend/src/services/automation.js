const { prisma } = require('../config/db');

/**
 * Автоматическое списание занятий для прошедших уроков.
 * Списывает у всех учеников группы, независимо от отметки о присутствии.
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

        // 1. Базовые настройки времени
        const almatyOffset = 5 * 60 * 60 * 1000; // UTC+5
        const nowMs = Date.now();
        const almatyNow = new Date(nowMs + almatyOffset);
        
        // Расширяем поиск на 3 дня назад и 1 день вперед, 
        // чтобы точно не пропустить занятия из-за смещения часовых поясов в базе данных
        const searchStart = new Date(nowMs - 3 * 24 * 60 * 60 * 1000);
        const searchEnd = new Date(nowMs + 24 * 60 * 60 * 1000);

        log(`📍 Время Алматы сейчас: ${almatyNow.toISOString().replace('T', ' ').slice(0, 16)}`);

        // 2. Поиск всех актуальных занятий
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

        log(`🔍 Найдено занятий в окне поиска: ${activeClasses.length}`);

        let totalDeducted = 0;

        for (const cls of activeClasses) {
            // Вычисляем точную дату занятия в формате YYYY-MM-DD для Алматы
            const clsDateAlmaty = new Date(cls.date.getTime() + almatyOffset);
            const clsDateStr = clsDateAlmaty.toISOString().split('T')[0];
            
            // Вычисляем точное время ОКОНЧАНИЯ занятия в Алматы
            const clsEndAlmaty = new Date(clsDateAlmaty);
            const [endH, endM] = cls.endTime.split(':').map(Number);
            clsEndAlmaty.setUTCHours(endH, endM, 0, 0);

            // Если занятие ЕЩЕ НЕ ЗАВЕРШИЛОСЬ — пропускаем
            if (almatyNow < clsEndAlmaty) {
                // log(`⏳ Занятие "${cls.title}" (${clsDateStr} ${cls.endTime}) еще идет или в будущем.`);
                continue;
            }

            // Формируем список кандидатов на списание
            const candidates = [];
            if (cls.groupId && cls.group) {
                candidates.push(...cls.group.students.map(s => s.studentId));
            } else if (cls.individualStudentId) {
                candidates.push(cls.individualStudentId);
            }

            if (candidates.length === 0) {
                if (!cls.autoDeductionDone) {
                    await prisma.class.update({ where: { id: cls.id }, data: { autoDeductionDone: true } });
                }
                continue;
            }

            // log(`📖 Проверка "${cls.title}" (${clsDateStr} ${cls.endTime}). Кандидатов: ${candidates.length}`);

            let deductedForThisClass = 0;

            for (const studentId of candidates) {
                try {
                    await prisma.$transaction(async (tx) => {
                        // Проверяем, есть ли уже отметка (присутствовал, отсутствовал или автосписан)
                        const existing = await tx.classAttendee.findFirst({
                            where: { classId: cls.id, studentId }
                        });

                        if (existing) {
                            return; // Уже обработан
                        }

                        // Получаем ВСЕ активные абонементы ученика (для этой группы или общие)
                        const memberships = await tx.membership.findMany({
                            where: { 
                                studentId, 
                                status: 'active',
                                OR: [
                                    { groupId: cls.groupId },
                                    { groupId: null }
                                ]
                            },
                            orderBy: { createdAt: 'desc' }
                        });

                        // Ищем абонемент, который был активен ИМЕННО В ДЕНЬ ЗАНЯТИЯ
                        let membership = memberships.find(m => {
                            if (cls.groupId && m.groupId && m.groupId !== cls.groupId) return false;
                            
                            const startStr = new Date(m.startDate.getTime() + almatyOffset).toISOString().split('T')[0];
                            const endStr = new Date(m.endDate.getTime() + almatyOffset).toISOString().split('T')[0];
                            return clsDateStr >= startStr && clsDateStr <= endStr;
                        });

                        // Проверяем заморозку, которая была активна В ДЕНЬ ЗАНЯТИЯ
                        const freezes = await tx.freeze.findMany({
                            where: { studentId, status: 'active' }
                        });
                        const isFrozen = freezes.some(f => {
                            const startStr = new Date(f.startDate.getTime() + almatyOffset).toISOString().split('T')[0];
                            const endStr = new Date(f.endDate.getTime() + almatyOffset).toISOString().split('T')[0];
                            return clsDateStr >= startStr && clsDateStr <= endStr;
                        });

                        if (isFrozen) {
                            log(`   ❄️ Заморозка: студент ${studentId.slice(-4)} пропущен (${clsDateStr})`);
                            return;
                        }

                        if (membership && membership.classesRemaining > 0) {
                            // Выполняем списание
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

                            await tx.classAttendee.create({
                                data: {
                                    classId: cls.id,
                                    studentId,
                                    attended: false,
                                    autoDeducted: true,
                                    markedAt: new Date()
                                }
                            });
                            deductedForThisClass++;
                            totalDeducted++;
                            log(`   ✅ Списано у ${studentId.slice(-4)} за ${clsDateStr}`);
                        } else if (!membership) {
                            log(`   ❌ Нет абонемента на ${clsDateStr} у ${studentId.slice(-4)}`);
                        } else {
                            log(`   ❌ Абонемент пуст (0 занятий) у ${studentId.slice(-4)}`);
                        }
                    });
                } catch (err) {
                    log(`   🔴 Ошибка обработки ученика ${studentId.slice(-4)}: ${err.message}`);
                }
            }

            // Если мы обработали класс и больше нет кандидатов без отметок
            if (!cls.autoDeductionDone) {
                // Чтобы не ставить флаг преждевременно, если кто-то добавился
                // Мы можем оставить его false, но обновлять только если мы действительно
                // уверены. Оставим как есть: если скрипт дошел сюда, он проверил всех текущих учеников.
                // В будущем, если добавят ученика, он снова пройдется по кандидатам.
                // Если мы поставим autoDeductionDone = true, новые ученики НЕ спишутся.
                // Поэтому ЛУЧШЕ НЕ СТАВИТЬ autoDeductionDone = true, пока класс "вчерашний".
                // Но чтобы база не пухла, ставим true для классов старше 2 дней.
                const daysOld = (nowMs - cls.date.getTime()) / (1000 * 60 * 60 * 24);
                if (daysOld > 2) {
                    await prisma.class.update({
                        where: { id: cls.id },
                        data: { autoDeductionDone: true }
                    });
                }
            }
            
            if (deductedForThisClass > 0) {
                log(`   🏁 Завершено "${cls.title}" (${clsDateStr}): списано у ${deductedForThisClass}`);
            }
        }

        log(`🎉 Цикл завершен. Всего списано: ${totalDeducted}`);
        return { success: true, logs, totalDeducted };
    } catch (error) {
        log(`🚨 КРИТИЧЕСКАЯ ОШИБКА: ${error.message}`);
        return { success: false, logs, error: error.message };
    }
}

module.exports = { processPastClasses };
