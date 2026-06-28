const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { prisma } = require('../config/db');
const { getTeacherRate, getRateLabel, isPayableClass } = require('../services/salaryPolicy');

function parsePeriodDate(value, endOfDay = false) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
    const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function mapSalary(salary) {
    return {
        ...salary,
        _id: salary.id,
        teacher: salary.teacher ? { ...salary.teacher, _id: salary.teacher.id } : undefined,
        period: { start: salary.periodStart, end: salary.periodEnd }
    };
}

// @route   POST /api/salary/calculate
// @desc    Рассчитать зарплату преподавателя
// @access  Private (Admin)
router.post('/calculate', authenticate, requireAdmin, async (req, res) => {
    try {
        const { teacherId, startDate, endDate } = req.body;
        
        // Валидация
        if (!teacherId || !startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: 'Необходимо указать преподавателя, дату начала и дату окончания'
            });
        }
        
        const start = parsePeriodDate(startDate);
        const end = parsePeriodDate(endDate, true);

        if (!start || !end) {
            return res.status(400).json({
                success: false,
                message: 'Даты должны быть указаны в формате ГГГГ-ММ-ДД'
            });
        }
        
        if (start > end) {
            return res.status(400).json({
                success: false,
                message: 'Дата начала не может быть позже даты окончания'
            });
        }
        
        // Находим преподавателя
        const teacher = await prisma.student.findUnique({ where: { id: teacherId } });
        if (!teacher || teacher.role !== 'teacher') {
            return res.status(404).json({
                success: false,
                message: 'Преподаватель не найден'
            });
        }
        
        console.log(`👨‍🏫 Рассчитываем зарплату для: ${teacher.name} ${teacher.lastName || ''}`);
        console.log(`📅 Период: ${start.toISOString().split('T')[0]} - ${end.toISOString().split('T')[0]}`);
        
        // Находим уроки, закрытые администратором.
        // Финансы ученика не участвуют в расчёте зарплаты.
        const classes = await prisma.class.findMany({
            where: {
                teacherId,
                date: { gte: start, lte: end },
                status: { in: ['completed', 'cancelled'] }
            },
            include: {
                group: { select: { name: true, direction: true } },
                salaryRecords: {
                    where: {
                        totalEarnings: { gt: 0 },
                        salary: { status: { in: ['calculated', 'paid'] } }
                    },
                    select: { id: true, totalEarnings: true }
                },
                attendees: {
                    include: {
                        student: { select: { id: true, name: true, lastName: true } }
                    }
                }
            }
        });
        
        const alreadyCalculatedClasses = classes.filter((classItem) => classItem.salaryRecords.length > 0);
        const payableClasses = classes.filter((classItem) => classItem.salaryRecords.length === 0 && isPayableClass(classItem));
        const skippedTrialClasses = classes.filter((classItem) => classItem.classType === 'trial');
        const skippedExcusedClasses = classes.filter((classItem) =>
            classItem.classType !== 'trial'
            && classItem.salaryRecords.length === 0
            && !isPayableClass(classItem)
        );
        const missingRateLabels = Array.from(new Set(
            payableClasses
                .filter((classItem) => getTeacherRate(teacher, classItem) <= 0)
                .map(getRateLabel)
        ));

        console.log(`📚 Найдено подтверждённых занятий: ${classes.length}`);
        console.log(`📚 Уже включено в ведомости: ${alreadyCalculatedClasses.length}`);
        
        if (payableClasses.length === 0) {
            return res.json({
                success: true,
                message: classes.length === 0
                    ? 'В указанном периоде не найдено проведённых занятий'
                    : skippedTrialClasses.length === classes.length
                        ? 'В указанном периоде есть только пробные занятия. Они не оплачиваются.'
                        : skippedExcusedClasses.length + skippedTrialClasses.length === classes.length
                            ? 'В указанном периоде есть только пробные, отменённые по уважительной причине или замороженные занятия. Они не оплачиваются.'
                        : 'Все оплачиваемые занятия за этот период уже включены в ведомости',
                data: {
                    teacher: { id: teacherId, name: `${teacher.name} ${teacher.lastName || ''}`.trim() },
                    period: { start, end },
                    classes: [],
                    statistics: {
                        totalClasses: 0,
                        totalStudents: 0,
                        totalAttendedClasses: 0,
                        totalEarnings: 0,
                        teacherPercentage: 100,
                        teacherSalary: 0,
                        penaltyPoints: 0,
                        penaltyDeduction: 0,
                        skippedAlreadyCalculated: alreadyCalculatedClasses.length
                    }
                }
            });
        }

        if (missingRateLabels.length > 0) {
            return res.status(400).json({
                success: false,
                message: `В карточке преподавателя не указана ставка: ${missingRateLabels.join(', ')}. Откройте «Пользователи → Преподаватели», заполните цену за урок и повторите расчёт.`,
                data: {
                    teacher: {
                        id: teacherId,
                        name: `${teacher.name} ${teacher.lastName || ''}`.trim()
                    },
                    missingRates: missingRateLabels,
                    confirmedClasses: classes.length,
                    alreadyCalculatedClasses: alreadyCalculatedClasses.length
                }
            });
        }
        
        // Обрабатываем каждое занятие отдельно
        const classesData = [];
        let totalAttendedClasses = 0;
        let totalEarnings = 0;
        
        for (const classItem of payableClasses) {
            console.log(`📚 Обрабатываем занятие: ${classItem.title} (${classItem.date.toISOString().split('T')[0]})`);
            
            const flatRate = getTeacherRate(teacher, classItem);
            const classData = {
                classId: classItem.id,
                className: classItem.title,
                classDate: classItem.date,
                groupName: classItem.group ? classItem.group.name : 'Без группы',
                classType: classItem.isPractice ? 'practice' : classItem.classType,
                rate: flatRate,
                students: [],
                totalAttendedClasses: 0,
                    totalEarnings: flatRate
                };
            
            // Обрабатываем посещаемость на этом занятии
            if (classItem.attendees && classItem.attendees.length > 0) {
                console.log(`👥 Обрабатываем посещаемость: ${classItem.attendees.length} записей`);
                
                for (const attendance of classItem.attendees.filter((item) => item.attended)) {
                    if (!attendance.student) continue;
                    
                    classData.students.push({
                        studentId: attendance.student.id,
                        studentName: `${attendance.student.name} ${attendance.student.lastName || ''}`.trim(),
                        payment: {
                            type: 'flat_rate',
                            rate: flatRate
                        },
                        attendedClasses: 1,
                        totalEarnings: 0
                    });
                    
                    classData.totalAttendedClasses += 1;
                    totalAttendedClasses += 1;
                }
            } else {
                console.log(`⚠️ Нет данных о посещаемости для занятия ${classItem.title}`);
            }
            
            // Добавляем занятие в список (учитель провел занятие, поэтому платим фикс)
            classesData.push(classData);
            totalEarnings += flatRate;
        }
        
        console.log('📊 Итоговая статистика (Фикс. ставка):');
        console.log('📊 Занятий:', classesData.length);
        console.log('📊 Посещенные занятия:', totalAttendedClasses);
        console.log('📊 Сумма выплат преподавателю:', totalEarnings);

        const bonusAmount = Math.max(0, Number(req.body.bonus) || 0);
        const fineAmount = Math.max(0, Number(req.body.fine) || 0);
        const teacherSalary = totalEarnings + bonusAmount - fineAmount;
        
        // Зарплата зависит от уроков, премий и штрафов.
        const finalSalary = Math.max(0, Math.round(teacherSalary));

        const salary = await prisma.$transaction(async (tx) => {
            // Один преподаватель рассчитывается последовательно.
            // Параллельный второй расчёт дождётся первого и увидит его SalaryClass.
            await tx.$queryRaw`
                SELECT id FROM "Student" WHERE id = ${teacherId} FOR UPDATE
            `;
            const duplicateClass = await tx.salaryClass.findFirst({
                where: {
                    classId: { in: classesData.map((item) => item.classId) },
                    totalEarnings: { gt: 0 },
                    salary: { status: { in: ['calculated', 'paid'] } }
                },
                select: { classId: true }
            });
            if (duplicateClass) {
                const error = new Error('Один или несколько уроков уже включены в другую ведомость');
                error.code = 'SALARY_CLASS_ALREADY_CALCULATED';
                throw error;
            }

            return tx.salary.create({
                data: {
                    teacherId,
                    teacherName: `${teacher.name} ${teacher.lastName || ''}`.trim(),
                    periodStart: start,
                    periodEnd: end,
                    totalClasses: classesData.length,
                    totalStudents: classesData.reduce((sum, cls) => sum + cls.students.length, 0),
                    totalAttendedClasses,
                    totalEarnings: Math.round(totalEarnings),
                    teacherPercentage: 100,
                    teacherSalary: finalSalary,
                    penaltyPoints: 0,
                    penaltyDeduction: fineAmount,
                    bonus: bonusAmount,
                    status: 'calculated',
                    classes: {
                        create: classesData.map((classData) => ({
                            classId: classData.classId,
                            className: classData.className,
                            classDate: classData.classDate,
                            groupName: classData.groupName,
                            totalAttendedClasses: classData.totalAttendedClasses,
                            totalEarnings: Math.round(classData.totalEarnings),
                            students: {
                                create: classData.students.map((student) => ({
                                    studentId: student.studentId,
                                    studentName: student.studentName,
                                    paymentData: student.payment,
                                    attendedClasses: student.attendedClasses,
                                    totalEarnings: 0
                                }))
                            }
                        }))
                    }
                }
            });
        }, { isolationLevel: 'Serializable' });

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
                    teacherPercentage: 100,
                    teacherSalary: finalSalary,
                    penaltyPoints: 0,
                    penaltyDeduction: fineAmount,
                    bonus: bonusAmount,
                    skippedAlreadyCalculated: alreadyCalculatedClasses.length
                }
            }
        });
    } catch (error) {
        console.error('❌ Salary calculation error:', error);
        if (error.code === 'SALARY_CLASS_ALREADY_CALCULATED' || error.code === 'P2034') {
            return res.status(409).json({
                success: false,
                message: 'Часть уроков уже попала в другую ведомость. Обновите страницу и повторите расчёт.'
            });
        }
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
        
        const mapped = salaries.map(mapSalary);
        
        res.json({
            success: true,
            data: { salaries: mapped },
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
        
        const updatedSalary = await prisma.$transaction(async (tx) => {
            const paidAt = new Date();
            const claim = await tx.salary.updateMany({
                where: { id: req.params.id, status: 'calculated' },
                data: { status: 'paid', paidAt }
            });
            if (claim.count !== 1) {
                const error = new Error('Зарплата уже выплачена или недоступна для выплаты');
                error.code = 'SALARY_ALREADY_PAID';
                throw error;
            }

            let description = `Зарплата преподавателя: ${salary.teacherName}`;
            if (salary.bonus > 0 || salary.penaltyDeduction > 0) {
                description += ` (Уроки: ${salary.totalEarnings} ₸`;
                if (salary.bonus > 0) description += `, Премия: +${salary.bonus} ₸`;
                if (salary.penaltyDeduction > 0) description += `, Штраф: -${salary.penaltyDeduction} ₸`;
                description += `)`;
            }

            await tx.cashTransaction.create({
                data: {
                    type: 'expense',
                    category: 'salary',
                    amount: salary.teacherSalary,
                    description: description.trim(),
                    date: new Date(),
                    createdById: req.user.id
                }
            });

            return tx.salary.findUnique({ where: { id: req.params.id } });
        });
        
        console.log(`💰 Создан расход в кассе: ${salary.teacherSalary} тенге для ${salary.teacherName}`);
        
        res.json({
            success: true,
            message: 'Зарплата отмечена как выплаченная',
            data: { ...updatedSalary, _id: updatedSalary.id }
        });
    } catch (error) {
        console.error('❌ Pay salary error:', error);
        if (error.code === 'SALARY_ALREADY_PAID') {
            return res.status(409).json({ success: false, message: error.message });
        }
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

// @route   GET /api/salary/:id
// @desc    Получить ведомость с детализацией по занятиям
// @access  Private (Admin)
router.get('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const salary = await prisma.salary.findUnique({
            where: { id: req.params.id },
            include: {
                teacher: { select: { id: true, name: true, lastName: true } },
                classes: {
                    orderBy: [{ classDate: 'asc' }, { className: 'asc' }],
                    include: { students: true }
                }
            }
        });

        if (!salary) {
            return res.status(404).json({ success: false, message: 'Расчёт зарплаты не найден' });
        }

        const mapped = mapSalary(salary);
        return res.json({
            success: true,
            data: {
                ...mapped,
                teacher: {
                    id: salary.teacherId,
                    name: salary.teacherName
                },
                classes: salary.classes.map((classItem) => ({
                    ...classItem,
                    students: classItem.students.map((student) => ({
                        ...student,
                        payment: student.paymentData
                    }))
                })),
                statistics: {
                    totalClasses: salary.totalClasses,
                    totalStudents: salary.totalStudents,
                    totalAttendedClasses: salary.totalAttendedClasses,
                    totalEarnings: salary.totalEarnings,
                    teacherPercentage: salary.teacherPercentage,
                    teacherSalary: salary.teacherSalary,
                    penaltyPoints: salary.penaltyPoints,
                    penaltyDeduction: salary.penaltyDeduction,
                    bonus: salary.bonus
                }
            }
        });
    } catch (error) {
        console.error('❌ Get salary details error:', error);
        return res.status(500).json({ success: false, message: 'Ошибка при получении ведомости', error: error.message });
    }
});

module.exports = router;
