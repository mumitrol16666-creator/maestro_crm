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
        
        // Расширяем поиск на 90 дней назад, чтобы гарантированно покрыть 
        // ретроспективные списания с даты активации абонемента
        const searchStart = new Date(nowMs - 90 * 24 * 60 * 60 * 1000);
        const searchEnd = new Date(nowMs + 24 * 60 * 60 * 1000);

        log(`📍 Время Алматы сейчас: ${almatyNow.toISOString().replace('T', ' ').slice(0, 16)}`);

        // 2. Поиск всех актуальных занятий за 3 месяца
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
                },
                attendees: {
                    select: { studentId: true }
                }
            }
        });

        log(`🔍 Найдено занятий в окне поиска (90 дней): ${activeClasses.length}`);

        let totalDeducted = 0;

        for (const cls of activeClasses) {
            const clsDateAlmaty = new Date(cls.date.getTime() + almatyOffset);
            const clsDateStr = clsDateAlmaty.toISOString().split('T')[0];
            
            const clsEndAlmaty = new Date(clsDateAlmaty);
            const [endH, endM] = cls.endTime.split(':').map(Number);
            clsEndAlmaty.setUTCHours(endH, endM, 0, 0);

            if (almatyNow < clsEndAlmaty) continue;

            const candidates = [];
            if (cls.groupId && cls.group) {
                candidates.push(...cls.group.students.map(s => s.studentId));
            } else if (cls.individualStudentId) {
                candidates.push(cls.individualStudentId);
            }

            if (candidates.length === 0) continue;

            log(`📖 Проверка "${cls.title}" (${clsDateStr} ${cls.endTime}). Кандидатов: ${candidates.length}`);

            // ОПТИМИЗАЦИЯ: Получаем всех, у кого УЖЕ БЫЛО СПИСАНИЕ за это занятие
            // Это решает проблему: если ученик был добавлен в класс ДО покупки абонемента,
            // у него есть отметка, но нет списания. Теперь мы будем проверять транзакции.
            const transactions = await prisma.membershipTransaction.findMany({
                where: { classId: cls.id, type: 'deduct' },
                include: { membership: { select: { studentId: true } } }
            });
            const alreadyDeducted = new Set(transactions.map(t => t.membership.studentId));

            let deductedForThisClass = 0;

            for (const studentId of candidates) {
                // Если списание уже произошло ранее — пропускаем
                if (alreadyDeducted.has(studentId)) continue;

                try {
                    await prisma.$transaction(async (tx) => {
                        const memberships = await tx.membership.findMany({
                            where: { 
                                studentId, 
                                status: 'active',
                                OR: [ { groupId: cls.groupId }, { groupId: null } ]
                            },
                            orderBy: { createdAt: 'desc' }
                        });

                        let membership = memberships.find(m => {
                            if (cls.groupId && m.groupId && m.groupId !== cls.groupId) return false;
                            const startStr = new Date(m.startDate.getTime() + almatyOffset).toISOString().split('T')[0];
                            const endStr = new Date(m.endDate.getTime() + almatyOffset).toISOString().split('T')[0];
                            return clsDateStr >= startStr && clsDateStr <= endStr;
                        });

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
                                    reason: `Автосписание (ретро): ${cls.title} (${clsDateStr})`,
                                    classId: cls.id
                                }
                            });

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
                            log(`   ✅ Списано у ${studentId.slice(-4)} за ${clsDateStr}`);
                        } else {
                            if (!membership) {
                                log(`   ❌ Нет абонемента у ${studentId.slice(-4)} на ${clsDateStr} (Найдено: ${memberships.length})`);
                            } else {
                                log(`   ❌ Абонемент пуст (0 занятий) у ${studentId.slice(-4)}`);
                            }
                        }
                    });
                } catch (err) {
                    log(`   🔴 Ошибка обработки ученика ${studentId.slice(-4)}: ${err.message}`);
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
