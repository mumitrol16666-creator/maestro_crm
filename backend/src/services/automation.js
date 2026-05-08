const { prisma } = require('../config/db');

/**
 * Автоматическое списание занятий для прошедших уроков.
 * Списывает у всех учеников группы, независимо от отметки о присутствии.
 */
async function processPastClasses() {
    try {
        const now = new Date();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const currentHours = now.getHours().toString().padStart(2, '0');
        const currentMinutes = now.getMinutes().toString().padStart(2, '0');
        const currentTimeString = `${currentHours}:${currentMinutes}`;

        // Находим занятия, которые уже закончились, но еще не были обработаны автоматически
        // Исключаем отмененные и практики (если нужно)
        const pastClasses = await prisma.class.findMany({
            where: {
                autoDeductionDone: false,
                status: { not: 'cancelled' },
                isPractice: false,
                OR: [
                    { date: { lt: today } },
                    { 
                        date: today, 
                        endTime: { lt: currentTimeString } 
                    }
                ]
            },
            include: {
                group: {
                    include: {
                        students: {
                            where: { status: 'active' }
                        }
                    }
                }
            }
        });

        if (pastClasses.length === 0) return;

        console.log(`🤖 [AUTOMATION] Найдено ${pastClasses.length} занятий для автоматического списания...`);

        for (const cls of pastClasses) {
            try {
                // Обрабатываем каждое занятие в отдельной транзакции
                await prisma.$transaction(async (tx) => {
                    const studentIds = [];
                    if (cls.groupId && cls.group) {
                        studentIds.push(...cls.group.students.map(s => s.studentId));
                    } else if (cls.individualStudentId) {
                        studentIds.push(cls.individualStudentId);
                    }

                    for (const studentId of studentIds) {
                        // 1. Ищем подходящий активный абонемент (та же логика, что в ручном списании)
                        let membership = null;
                        if (cls.groupId) {
                            membership = await tx.membership.findFirst({
                                where: { studentId, groupId: cls.groupId, status: 'active' },
                                orderBy: { createdAt: 'desc' }
                            });
                            if (!membership) {
                                membership = await tx.membership.findFirst({
                                    where: { studentId, groupId: null, status: 'active' },
                                    orderBy: { createdAt: 'desc' }
                                });
                            }
                        } else if (cls.classType === 'individual') {
                            membership = await tx.membership.findFirst({
                                where: { 
                                    studentId, 
                                    status: 'active', 
                                    type: { in: ['individual_single', 'individual_package'] } 
                                },
                                orderBy: { createdAt: 'desc' }
                            });
                        }

                        if (membership) {
                            // Проверяем, не было ли уже списано вручную через ClassAttendee
                            const existingAttendee = await tx.classAttendee.findFirst({
                                where: { classId: cls.id, studentId }
                            });

                            if (!existingAttendee || !existingAttendee.autoDeducted) {
                                // Списываем занятие
                                await tx.membership.update({
                                    where: { id: membership.id },
                                    data: {
                                        classesRemaining: { decrement: 1 },
                                        classesUsed: { increment: 1 }
                                    }
                                });

                                // Создаем запись о транзакции
                                await tx.membershipTransaction.create({
                                    data: {
                                        membershipId: membership.id,
                                        type: 'deduct',
                                        amount: 1,
                                        reason: `Автосписание (занятие прошло): ${cls.title} (${cls.date.toLocaleDateString('ru')})`,
                                        classId: cls.id
                                    }
                                });

                                // Создаем или обновляем запись посещаемости
                                if (existingAttendee) {
                                    await tx.classAttendee.update({
                                        where: { id: existingAttendee.id },
                                        data: { autoDeducted: true }
                                    });
                                } else {
                                    await tx.classAttendee.create({
                                        data: {
                                            classId: cls.id,
                                            studentId,
                                            attended: false, // Оставляем false, так как это авто-списание (учитель не отметил)
                                            autoDeducted: true,
                                            markedAt: now
                                        }
                                    });
                                }
                            }
                        }
                    }

                    // Помечаем занятие как обработанное и завершенное
                    await tx.class.update({
                        where: { id: cls.id },
                        data: { 
                            autoDeductionDone: true,
                            status: 'completed'
                        }
                    });
                });
                console.log(`✅ [AUTOMATION] Занятие "${cls.title}" обработано.`);
            } catch (classError) {
                console.error(`❌ [AUTOMATION] Ошибка при обработке занятия ${cls.id}:`, classError);
            }
        }
    } catch (error) {
        console.error('❌ [AUTOMATION] Глобальная ошибка автоматизации:', error);
    }
}

module.exports = { processPastClasses };
