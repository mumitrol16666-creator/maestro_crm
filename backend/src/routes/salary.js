const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { prisma } = require('../config/db');

// @route   POST /api/salary/calculate
// @desc    Рассчитать зарплату преподавателя
// @access  Private (Admin)
router.post('/calculate', authenticate, requireAdmin, async (req, res) => {
    try {
        const { teacherId, startDate, endDate, percentage } = req.body;
        
        // Валидация
        if (!teacherId || !startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: 'Необходимо указать преподавателя, дату начала и дату окончания'
            });
        }
        
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        if (start > end) {
            return res.status(400).json({
                success: false,
                message: 'Дата начала не может быть позже даты окончания'
            });
        }
        
        // Находим преподавателя
        const teacher = await prisma.student.findUnique({ where: { id: teacherId } });
        if (!teacher) {
            return res.status(404).json({
                success: false,
                message: 'Преподаватель не найден'
            });
        }
        
        const validPercentage = Number(percentage) || 0;
        
        console.log(`👨‍🏫 Рассчитываем зарплату для: ${teacher.name} ${teacher.lastName || ''}`);
        console.log(`📅 Период: ${start.toISOString().split('T')[0]} - ${end.toISOString().split('T')[0]}`);
        console.log(`📊 Процент: ${validPercentage}%`);
        
        // Находим все занятия преподавателя в указанном периоде
        const classes = await prisma.class.findMany({
            where: {
                teacherId,
                date: { gte: start, lte: end },
                isPractice: false
            },
            include: {
                group: { select: { name: true, direction: true } },
                attendees: {
                    where: { attended: true },
                    include: {
                        student: { select: { id: true, name: true, lastName: true } }
                    }
                }
            }
        });
        
        console.log(`📚 Найдено занятий: ${classes.length}`);
        
        if (classes.length === 0) {
            return res.json({
                success: true,
                message: 'В указанном периоде не найдено занятий',
                data: {
                    teacher: { id: teacherId, name: `${teacher.name} ${teacher.lastName || ''}`.trim() },
                    period: { start, end },
                    classes: [],
                    totalAttendedClasses: 0,
                    totalEarnings: 0,
                    teacherPercentage: validPercentage,
                    teacherSalary: 0
                }
            });
        }
        
        // Обрабатываем каждое занятие отдельно
        const classesData = [];
        let totalAttendedClasses = 0;
        let totalEarnings = 0;
        
        for (const classItem of classes) {
            console.log(`📚 Обрабатываем занятие: ${classItem.title} (${classItem.date.toISOString().split('T')[0]})`);
            
            const classData = {
                classId: classItem.id,
                className: classItem.title,
                classDate: classItem.date,
                groupName: classItem.group ? classItem.group.name : 'Без группы',
                students: [],
                totalAttendedClasses: 0,
                totalEarnings: 0
            };
            
            // Обрабатываем посещаемость на этом занятии
            if (classItem.attendees && classItem.attendees.length > 0) {
                console.log(`👥 Обрабатываем посещаемость: ${classItem.attendees.length} записей`);
                
                const studentsMap = new Map();
                
                for (const attendance of classItem.attendees) {
                    if (!attendance.student) continue;
                    const studentId = attendance.student.id;
                    
                    // Ищем последнюю оплату студента в периоде расчета
                    const lastPayment = await prisma.payment.findFirst({
                        where: {
                            studentId,
                            status: 'completed',
                            createdAt: { gte: start, lte: end }
                        },
                        orderBy: { createdAt: 'desc' }
                    });
                    
                    if (!lastPayment) {
                        console.log(`❌ У студента ${attendance.student.name} нет оплат в периоде`);
                        continue;
                    }
                    
                    // Определяем тип оплаты и количество занятий
                    let totalClassesForPayment = 1;
                    let paymentType = 'trial';
                    
                    if (['membership_full', 'membership_advance', 'membership_balance'].includes(lastPayment.type)) {
                        totalClassesForPayment = 8;
                        paymentType = 'membership';
                    } else if (['single_class', 'individual_class'].includes(lastPayment.type)) {
                        totalClassesForPayment = 1;
                        paymentType = 'single';
                    } else if (['trial_full', 'trial_advance'].includes(lastPayment.type)) {
                        totalClassesForPayment = 1;
                        paymentType = 'trial';
                    }
                    
                    // Рассчитываем стоимость одного занятия
                    const paymentAmount = Number(lastPayment.amount) || 0;
                    const pricePerClass = totalClassesForPayment > 0 ? paymentAmount / totalClassesForPayment : 0;
                    
                    console.log(`💰 Расчет для ${attendance.student.name}: оплата=${paymentAmount}₸, тип=${paymentType}, занятий=${totalClassesForPayment}, за занятие=${pricePerClass}₸`);
                    
                    // Добавляем студента в занятие
                    if (!studentsMap.has(studentId)) {
                        studentsMap.set(studentId, {
                            studentId,
                            studentName: `${attendance.student.name} ${attendance.student.lastName || ''}`.trim(),
                            payment: {
                                paymentId: lastPayment.id,
                                amount: lastPayment.amount,
                                type: paymentType,
                                totalClasses: totalClassesForPayment,
                                pricePerClass
                            },
                            attendedClasses: 0,
                            totalEarnings: 0
                        });
                    }
                    
                    const studentData = studentsMap.get(studentId);
                    studentData.attendedClasses += 1;
                    studentData.totalEarnings = Number(studentData.totalEarnings) + Number(pricePerClass);
                    
                    classData.totalAttendedClasses += 1;
                    classData.totalEarnings = Number(classData.totalEarnings) + Number(pricePerClass);
                    
                    totalAttendedClasses += 1;
                    totalEarnings = Number(totalEarnings) + Number(pricePerClass);
                    
                    console.log(`✅ ${attendance.student.name}: +${pricePerClass}₸`);
                }
                
                classData.students = Array.from(studentsMap.values());
            } else {
                console.log(`⚠️ Нет данных о посещаемости для занятия ${classItem.title}`);
            }
            
            // Добавляем занятие в список только если есть посещаемость
            if (classData.totalAttendedClasses > 0) {
                classesData.push(classData);
            }
        }
        
        console.log('📊 Итоговая статистика:');
        console.log('📊 Занятий с посещаемостью:', classesData.length);
        console.log('📊 Посещенные занятия:', totalAttendedClasses);
        console.log('📊 Общий доход:', totalEarnings);
        console.log('📊 Процент преподавателя:', validPercentage);

        // Рассчитываем зарплату преподавателя с учетом специальных групп
        let teacherSalary = 0;
        
        let totalBachataSocialEarnings = 0;
        let totalOtherEarnings = 0;
        let bachataSocialClasses = 0;
        let otherClasses = 0;
        
        classesData.forEach(classData => {
            const classEarnings = Number(classData.totalEarnings) || 0;
            
            const isBachataSocial = classData.groupName && 
                classData.groupName.toLowerCase().startsWith('bachata social');
            
            const classPercentage = isBachataSocial ? 17 : validPercentage;
            const classTeacherSalary = (classEarnings * classPercentage) / 100;
            
            teacherSalary += classTeacherSalary;
            
            if (isBachataSocial) {
                totalBachataSocialEarnings += classEarnings;
                bachataSocialClasses += 1;
            } else {
                totalOtherEarnings += classEarnings;
                otherClasses += 1;
            }
            
            console.log(`💰 ${classData.className}: ${classEarnings}₸ × ${classPercentage}% = ${classTeacherSalary}₸`);
        });
        
        // Рассчитываем средневзвешенный процент
        const totalEarningsForPercentage = totalBachataSocialEarnings + totalOtherEarnings;
        let averagePercentage = validPercentage;
        
        if (totalEarningsForPercentage > 0) {
            const bachataSocialWeight = totalBachataSocialEarnings / totalEarningsForPercentage;
            const otherWeight = totalOtherEarnings / totalEarningsForPercentage;
            averagePercentage = (bachataSocialWeight * 17) + (otherWeight * validPercentage);
        }
        
        console.log(`📊 Средневзвешенный процент: ${averagePercentage.toFixed(1)}%`);
        console.log('💰 Зарплата преподавателя:', teacherSalary);
        
        // Если нет данных - показываем предупреждение
        if (totalEarnings === 0) {
            console.log('⚠️ ВНИМАНИЕ: Нет данных для расчета зарплаты!');
        }

        // Создаем запись о зарплате и обнуляем штрафы преподавателя
        const penaltyPoints = teacher.penaltyPoints || 0;
        const penaltyDeduction = penaltyPoints; // 1 Tenge per 1 point
        const finalSalary = Math.max(0, Math.round(teacherSalary) - penaltyDeduction);

        let salary;
        await prisma.$transaction(async (tx) => {
            salary = await tx.salary.create({
                data: {
                    teacherId,
                    teacherName: `${teacher.name} ${teacher.lastName || ''}`.trim(),
                    periodStart: start,
                    periodEnd: end,
                    totalClasses: classesData.length,
                    totalStudents: classesData.reduce((sum, cls) => sum + cls.students.length, 0),
                    totalAttendedClasses,
                    totalEarnings: Math.round(totalEarnings),
                    teacherPercentage: Math.round(averagePercentage * 10) / 10,
                    teacherSalary: finalSalary,
                    penaltyPoints,
                    penaltyDeduction,
                    status: 'calculated'
                }
            });

            await tx.student.update({
                where: { id: teacherId },
                data: { penaltyPoints: 0 }
            });
        });
        
        // Сохраняем детализацию по занятиям
        for (const classData of classesData) {
            const salaryClass = await prisma.salaryClass.create({
                data: {
                    salaryId: salary.id,
                    classId: classData.classId,
                    className: classData.className,
                    classDate: classData.classDate,
                    groupName: classData.groupName,
                    totalAttendedClasses: classData.totalAttendedClasses,
                    totalEarnings: Math.round(classData.totalEarnings)
                }
            });
            
            // Сохраняем данные по студентам для каждого занятия
            for (const student of classData.students) {
                await prisma.salaryClassStudent.create({
                    data: {
                        salaryClassId: salaryClass.id,
                        studentId: student.studentId,
                        studentName: student.studentName,
                        paymentData: student.payment,
                        attendedClasses: student.attendedClasses,
                        totalEarnings: Math.round(student.totalEarnings)
                    }
                });
            }
        }

        res.json({
            success: true,
            message: 'Зарплата успешно рассчитана',
            data: {
                salaryId: salary.id,
                teacher: { id: teacherId, name: `${teacher.name} ${teacher.lastName || ''}`.trim() },
                period: { start, end },
                classes: classesData,
                statistics: {
                    totalClasses: classesData.length,
                    totalStudents: classesData.reduce((sum, cls) => sum + cls.students.length, 0),
                    totalAttendedClasses,
                    totalEarnings,
                    teacherPercentage: Math.round(averagePercentage * 10) / 10,
                    teacherSalary: finalSalary,
                    penaltyPoints,
                    penaltyDeduction
                }
            }
        });
    } catch (error) {
        console.error('❌ Salary calculation error:', error);
        res.status(500).json({ success: false, message: 'Ошибка при расчете зарплаты', error: error.message });
    }
});

// @route   GET /api/salary
// @desc    Получить список расчетов зарплаты
// @access  Private (Admin)
router.get('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const { teacher, status, page = 1, limit = 10 } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        
        const where = {};
        if (teacher) where.teacherId = teacher;
        if (status) where.status = status;
        
        const [salaries, total] = await Promise.all([
            prisma.salary.findMany({
                where,
                include: {
                    teacher: { select: { id: true, name: true, lastName: true } }
                },
                orderBy: { calculatedAt: 'desc' },
                take: limitNum,
                skip: (pageNum - 1) * limitNum
            }),
            prisma.salary.count({ where })
        ]);
        
        // Маппим для совместимости с фронтендом
        const mapped = salaries.map(s => ({
            ...s,
            _id: s.id,
            teacher: s.teacher ? { ...s.teacher, _id: s.teacher.id } : null,
            period: { start: s.periodStart, end: s.periodEnd }
        }));
        
        res.json({
            success: true,
            data: mapped,
            pagination: {
                current: pageNum,
                pages: Math.ceil(total / limitNum),
                total
            }
        });
    } catch (error) {
        console.error('❌ Get salaries error:', error);
        res.status(500).json({ success: false, message: 'Ошибка при получении списка зарплат', error: error.message });
    }
});

// @route   PUT /api/salary/:id/pay
// @desc    Отметить зарплату как выплаченную
// @access  Private (Admin)
router.put('/:id/pay', authenticate, requireAdmin, async (req, res) => {
    try {
        const salary = await prisma.salary.findUnique({ where: { id: req.params.id } });
        
        if (!salary) {
            return res.status(404).json({
                success: false,
                message: 'Расчет зарплаты не найден'
            });
        }
        
        if (salary.status === 'paid') {
            return res.status(400).json({
                success: false,
                message: 'Зарплата уже выплачена'
            });
        }
        
        // Обновляем статус зарплаты
        const updatedSalary = await prisma.salary.update({
            where: { id: req.params.id },
            data: {
                status: 'paid',
                paidAt: new Date()
            }
        });
        
        // Создаем запись о расходе в кассе
        await prisma.cashTransaction.create({
            data: {
                type: 'expense',
                category: 'salary',
                amount: salary.teacherSalary,
                description: `Зарплата преподавателя: ${salary.teacherName}`,
                date: new Date(),
                createdById: req.user.id
            }
        });
        
        console.log(`💰 Создан расход в кассе: ${salary.teacherSalary} тенге для ${salary.teacherName}`);
        
        res.json({
            success: true,
            message: 'Зарплата отмечена как выплаченная',
            data: { ...updatedSalary, _id: updatedSalary.id }
        });
    } catch (error) {
        console.error('❌ Pay salary error:', error);
        res.status(500).json({ success: false, message: 'Ошибка при выплате зарплаты', error: error.message });
    }
});

// @route   GET /api/salary/statistics
// @desc    Получить статистику по зарплатам
// @access  Private (Admin)
router.get('/statistics', authenticate, requireAdmin, async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        
        let startDate, endDate;
        const now = new Date();
        
        switch (period) {
            case 'week':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                endDate = now;
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                break;
            case 'year':
                startDate = new Date(now.getFullYear(), 0, 1);
                endDate = new Date(now.getFullYear(), 11, 31);
                break;
            default:
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        }
        
        const [totalSalariesCount, paidTotal, pendingTotal, earningsTotal] = await Promise.all([
            prisma.salary.count({
                where: { calculatedAt: { gte: startDate, lte: endDate } }
            }),
            prisma.salary.aggregate({
                where: { calculatedAt: { gte: startDate, lte: endDate }, status: 'paid' },
                _sum: { teacherSalary: true }
            }),
            prisma.salary.aggregate({
                where: { calculatedAt: { gte: startDate, lte: endDate }, status: 'calculated' },
                _sum: { teacherSalary: true }
            }),
            prisma.salary.aggregate({
                where: { calculatedAt: { gte: startDate, lte: endDate } },
                _sum: { totalEarnings: true }
            })
        ]);
        
        res.json({
            success: true,
            data: {
                period,
                startDate,
                endDate,
                totalSalaries: totalSalariesCount,
                totalPaid: paidTotal._sum.teacherSalary || 0,
                totalPending: pendingTotal._sum.teacherSalary || 0,
                totalEarnings: earningsTotal._sum.totalEarnings || 0
            }
        });
    } catch (error) {
        console.error('❌ Get salary statistics error:', error);
        res.status(500).json({ success: false, message: 'Ошибка при получении статистики', error: error.message });
    }
});

module.exports = router;
