const { prisma } = require('../config/db');

/**
 * Автоматическое списание занятий для прошедших уроков.
 * Списывает у всех учеников группы, независимо от отметки о присутствии.
 */
async function processPastClasses() {
    try {
        // 1. Получаем текущее время в Алматы (UTC+5)
        const now = new Date();
        const almatyOffset = 5 * 60 * 60 * 1000;
        const almatyNow = new Date(now.getTime() + almatyOffset);
        
        const currentHours = almatyNow.getUTCHours().toString().padStart(2, '0');
        const currentMinutes = almatyNow.getUTCMinutes().toString().padStart(2, '0');
        const currentTimeString = `${currentHours}:${currentMinutes}`;
        
        const todayAlmaty = new Date(almatyNow);
        todayAlmaty.setUTCHours(0, 0, 0, 0);

        console.log(`\n⏰ [CRON] ${almatyNow.toISOString().replace('T', ' ').slice(0, 19)} | Время Алматы: ${currentTimeString}`);

        // 2. Ищем занятия за последние 24 часа (чтобы не сканировать всю историю, но зацепить сегодняшние)
        const yesterdayAlmaty = new Date(todayAlmaty);
        yesterdayAlmaty.setDate(yesterdayAlmaty.getDate() - 1);

        const activeClasses = await prisma.class.findMany({
            where: {
                status: { not: 'cancelled' },
                isPractice: false,
                date: { gte: yesterdayAlmaty, lte: todayAlmaty }
            },
            include: {
                group: {
                    include: {
                        students: { where: { status: 'active' } }
                    }
                }
            }
        });

        let totalDeducted = 0;

        for (const cls of activeClasses) {
            // Проверяем, закончилось ли занятие
            const isPast = cls.date < todayAlmaty || (cls.date.getTime() === todayAlmaty.getTime() && cls.endTime < currentTimeString);
            
            if (!isPast) continue;

            const groupStudents = cls.group?.students || [];
            if (groupStudents.length === 0 && !cls.individualStudentId) continue;

            // Собираем всех, у кого должно быть списание
            const candidates = [];
            if (cls.groupId) {
                candidates.push(...groupStudents.map(s => s.studentId));
            } else if (cls.individualStudentId) {
                candidates.push(cls.individualStudentId);
            }

            for (const studentId of candidates) {
                try {
                    await prisma.$transaction(async (tx) => {
                        // Есть ли уже отметка?
                        const existing = await tx.classAttendee.findFirst({
                            where: { classId: cls.id, studentId }
                        });

                        if (existing) return; // Уже отмечен или списан

                        // Ищем абонемент, который:
                        // 1. Активен
                        // 2. Соответствует группе (или общий)
                        // 3. Дата занятия (cls.date) попадает в [startDate, endDate]
                        let membership = await tx.membership.findFirst({
                            where: { 
                                studentId, 
                                groupId: cls.groupId || undefined, 
                                status: 'active',
                                startDate: { lte: cls.date },
                                endDate: { gte: cls.date }
                            },
                            orderBy: { createdAt: 'desc' }
                        });

                        if (!membership && cls.groupId) {
                            membership = await tx.membership.findFirst({
                                where: { 
                                    studentId, 
                                    groupId: null, 
                                    status: 'active',
                                    startDate: { lte: cls.date },
                                    endDate: { gte: cls.date }
                                },
                                orderBy: { createdAt: 'desc' }
                            });
                        }

                        // Проверка на заморозку (дополнительная безопасность)
                        const freeze = await tx.freeze.findFirst({
                            where: {
                                studentId,
                                status: 'active',
                                startDate: { lte: cls.date },
                                endDate: { gte: cls.date }
                            }
                        });

                        if (freeze) {
                            console.log(`    ❄️ Пропуск: у студента ${studentId.slice(-4)} заморозка на ${cls.date.toLocaleDateString()}`);
                            return;
                        }

                        if (membership && membership.classesRemaining > 0) {
                            // Списываем
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
                                    reason: `Автосписание: ${cls.title} (${cls.date.toLocaleDateString('ru')})`,
                                    classId: cls.id
                                }
                            });

                            await tx.classAttendee.create({
                                data: {
                                    classId: cls.id,
                                    studentId,
                                    attended: false,
                                    autoDeducted: true,
                                    markedAt: now
                                }
                            });
                            totalDeducted++;
                            console.log(`✅ Списано: ${cls.title} | Студент: ${studentId.slice(-4)}`);
                        }
                    });
                } catch (err) {
                    console.error(`❌ Ошибка списания (Класс: ${cls.id}, Студент: ${studentId}):`, err.message);
                }
            }

            // Помечаем занятие как "обработанное" (для статистики), если оно еще не помечено
            if (!cls.autoDeductionDone) {
                await prisma.class.update({
                    where: { id: cls.id },
                    data: { autoDeductionDone: true }
                });
            }
        }

        if (totalDeducted > 0) {
            console.log(`📊 Итог: успешно списано занятий: ${totalDeducted}`);
        }
    } catch (error) {
        console.error('❌ Критическая ошибка автоматизации:', error);
    }
}

module.exports = { processPastClasses };
