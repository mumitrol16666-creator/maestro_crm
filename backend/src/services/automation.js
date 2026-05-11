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

        // 1. Время Алматы
        const now = new Date();
        const almatyOffset = 5 * 60 * 60 * 1000;
        const almatyNow = new Date(now.getTime() + almatyOffset);
        
        const currentHours = almatyNow.getUTCHours().toString().padStart(2, '0');
        const currentMinutes = almatyNow.getUTCMinutes().toString().padStart(2, '0');
        const currentTimeString = `${currentHours}:${currentMinutes}`;
        
        const todayAlmaty = new Date(almatyNow);
        todayAlmaty.setUTCHours(0, 0, 0, 0);
        
        const yesterdayAlmaty = new Date(todayAlmaty);
        yesterdayAlmaty.setDate(yesterdayAlmaty.getDate() - 1);

        log(`📍 Время Алматы: ${currentTimeString}, Дата: ${todayAlmaty.toISOString().split('T')[0]}`);

        // 2. Поиск занятий
        const activeClasses = await prisma.class.findMany({
            where: {
                status: { not: 'cancelled' },
                isPractice: false,
                date: { gte: yesterdayAlmaty, lte: todayAlmaty }
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

        log(`🔍 Найдено занятий в периоде: ${activeClasses.length}`);

        let totalDeducted = 0;

        for (const cls of activeClasses) {
            // Проверка: завершилось ли занятие?
            const clsDateStr = cls.date.toISOString().split('T')[0];
            const todayStr = todayAlmaty.toISOString().split('T')[0];
            const isToday = clsDateStr === todayStr;
            const isPast = cls.date < todayAlmaty || (isToday && cls.endTime < currentTimeString);
            
            if (!isPast) {
                log(`⏳ Занятие "${cls.title}" (${cls.endTime}) еще не закончилось. Пропуск.`);
                continue;
            }

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

            log(`📖 Обработка "${cls.title}" (${cls.endTime}). Учеников: ${candidates.length}`);

            for (const studentId of candidates) {
                try {
                    await prisma.$transaction(async (tx) => {
                        const existing = await tx.classAttendee.findFirst({
                            where: { classId: cls.id, studentId }
                        });

                        if (existing) {
                            // log(`   ⏭️ Уже есть отметка для ${studentId.slice(-4)}`);
                            return;
                        }

                        // Поиск абонемента с учетом дат
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
                            log(`   ❄️ Пропуск: у студента ${studentId.slice(-4)} заморозка на ${cls.date.toLocaleDateString()}`);
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
                            log(`   ✅ Списано у ${studentId.slice(-4)}`);
                        } else {
                            log(`   ❌ Нет активного абонемента на дату ${cls.date.toLocaleDateString()} у ${studentId.slice(-4)}`);
                        }
                    });
                } catch (err) {
                    log(`   🔴 Ошибка ученика ${studentId.slice(-4)}: ${err.message}`);
                }
            }

            if (!cls.autoDeductionDone) {
                await prisma.class.update({
                    where: { id: cls.id },
                    data: { autoDeductionDone: true }
                });
            }
        }

        log(`🏁 Автоматизация завершена. Списано: ${totalDeducted}`);
        return { success: true, logs, totalDeducted };
    } catch (error) {
        log(`🚨 КРИТИЧЕСКАЯ ОШИБКА: ${error.message}`);
        return { success: false, logs, error: error.message };
    }
}

module.exports = { processPastClasses };
