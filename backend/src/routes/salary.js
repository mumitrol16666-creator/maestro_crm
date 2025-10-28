const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const Salary = require('../models/Salary');
const Student = require('../models/Student');
const Class = require('../models/Class');
const Membership = require('../models/Membership');
const CashTransaction = require('../models/CashTransaction');

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
        const teacher = await Student.findById(teacherId);
        if (!teacher) {
            return res.status(404).json({
                success: false,
                message: 'Преподаватель не найден'
            });
        }
        
        console.log(`👨‍🏫 Рассчитываем зарплату для: ${teacher.name} ${teacher.lastName || ''}`);
        console.log(`📅 Период: ${start.toISOString().split('T')[0]} - ${end.toISOString().split('T')[0]}`);
        console.log(`📊 Процент: ${percentage}%`);
        
        // Находим все занятия преподавателя в указанном периоде
        const classes = await Class.find({
            teacher: teacherId,
            date: { $gte: start, $lte: end },
            isPractice: { $ne: true }
        }).populate('group', 'name direction');
        
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
                    teacherPercentage: percentage,
                    teacherSalary: 0
                }
            });
        }
        
        // Обрабатываем каждое занятие отдельно (не группируем по группам)
        const classesData = [];
        let totalAttendedClasses = 0;
        let totalEarnings = 0;
        
        for (const classItem of classes) {
            console.log(`📚 Обрабатываем занятие: ${classItem.title} (${classItem.date.toISOString().split('T')[0]})`);
            
            const classData = {
                classId: classItem._id,
                className: classItem.title,
                classDate: classItem.date,
                groupName: classItem.group ? classItem.group.name : 'Без группы',
                students: new Map(),
                totalAttendedClasses: 0,
                totalEarnings: 0
            };
            
            // Обрабатываем посещаемость на этом занятии
            if (classItem.attendees && classItem.attendees.length > 0) {
                console.log(`👥 Обрабатываем посещаемость: ${classItem.attendees.length} записей`);
                
                for (const attendance of classItem.attendees) {
                    if (attendance.attended === true) {
                        const studentId = attendance.student.toString();
                        
                        // Находим студента
                        const student = await Student.findById(studentId);
                        if (!student) continue;

                        // Ищем активный абонемент студента на дату занятия
                        const membership = await Membership.findOne({
                            student: studentId,
                            status: 'active',
                            startDate: { $lte: classItem.date },
                            $or: [{ endDate: { $gte: classItem.date } }, { endDate: null }]
                        });

                        if (!membership) {
                            console.log(`❌ У студента ${student.name} нет активного абонемента на ${classItem.date.toISOString().split('T')[0]}`);
                            continue;
                        }
                        
                        // Рассчитываем стоимость одного занятия с проверкой на валидные числа
                        const membershipPrice = Number(membership.price) || 0;
                        const totalClasses = Number(membership.totalClasses) || 1;
                        const pricePerClass = totalClasses > 0 ? membershipPrice / totalClasses : 0;
                        
                        console.log(`💰 Расчет для ${student.name}: цена=${membershipPrice}, занятий=${totalClasses}, за занятие=${pricePerClass}`);
                        
                        // Добавляем студента в занятие
                        if (!classData.students.has(studentId)) {
                            classData.students.set(studentId, {
                                studentId,
                                studentName: `${student.name} ${student.lastName || ''}`.trim(),
                                membership: {
                                    membershipId: membership._id,
                                    totalClasses: membership.totalClasses,
                                    price: membership.price,
                                    pricePerClass: pricePerClass
                                },
                                attendedClasses: 0,
                                totalEarnings: 0
                            });
                        }
                        
                        const studentData = classData.students.get(studentId);
                        studentData.attendedClasses += 1;
                        studentData.totalEarnings = Number(studentData.totalEarnings) + Number(pricePerClass);
                        
                        classData.totalAttendedClasses += 1;
                        classData.totalEarnings = Number(classData.totalEarnings) + Number(pricePerClass);
                        
                        totalAttendedClasses += 1;
                        totalEarnings = Number(totalEarnings) + Number(pricePerClass);
                        
                        console.log(`✅ ${student.name}: +${pricePerClass}₸ (${pricePerClass}₸ за занятие)`);
                    }
                }
            } else {
                console.log(`⚠️ Нет данных о посещаемости для занятия ${classItem.title}`);
            }
            
            // Добавляем занятие в список только если есть посещаемость
            if (classData.totalAttendedClasses > 0) {
                classesData.push(classData);
            }
        }
        
        // Преобразуем Map в Array для JSON
        const processedClasses = classesData.map(classData => ({
            classId: classData.classId,
            className: classData.className,
            classDate: classData.classDate,
            groupName: classData.groupName,
            students: Array.from(classData.students.values()),
            totalAttendedClasses: classData.totalAttendedClasses,
            totalEarnings: classData.totalEarnings
        }));
        
        console.log('📊 Итоговая статистика:');
        console.log('📊 Занятий с посещаемостью:', processedClasses.length);
        console.log('📊 Посещенные занятия:', totalAttendedClasses);
        console.log('📊 Общий доход:', totalEarnings);
        console.log('📊 Процент преподавателя:', percentage);

        // Зарплата преподавателя с проверкой на валидные числа
        const validTotalEarnings = Number(totalEarnings) || 0;
        const validPercentage = Number(percentage) || 0;
        const teacherSalary = (validTotalEarnings * validPercentage) / 100;
        
        console.log('💰 Зарплата преподавателя:', teacherSalary);
        
        // Если нет данных - показываем предупреждение
        if (totalEarnings === 0) {
            console.log('⚠️ ВНИМАНИЕ: Нет данных для расчета зарплаты!');
            console.log('⚠️ Возможные причины:');
            console.log('⚠️ 1. Нет студентов в группах');
            console.log('⚠️ 2. Нет активных абонементов');
            console.log('⚠️ 3. Нет посещенных занятий в указанном периоде');
            console.log('⚠️ 4. Проблемы с данными в базе');
        }

        // Создаем запись о зарплате
        const salary = new Salary({
            teacher: teacherId,
            teacherName: `${teacher.name} ${teacher.lastName || ''}`.trim(),
            period: {
                start,
                end
            },
            classes: processedClasses, // Изменили с groups на classes
            totalClasses: processedClasses.length,
            totalStudents: processedClasses.reduce((sum, cls) => sum + cls.students.length, 0),
            totalAttendedClasses,
            totalEarnings,
            teacherPercentage: percentage,
            teacherSalary,
            status: 'calculated'
        });

        await salary.save();

        res.json({
            success: true,
            message: 'Зарплата успешно рассчитана',
            data: {
                salaryId: salary._id,
                teacher: { id: teacherId, name: `${teacher.name} ${teacher.lastName || ''}`.trim() },
                period: { start, end },
                classes: processedClasses,
                statistics: {
                    totalClasses: processedClasses.length,
                    totalStudents: processedClasses.reduce((sum, cls) => sum + cls.students.length, 0),
                    totalAttendedClasses,
                    totalEarnings,
                    teacherPercentage: percentage,
                    teacherSalary
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
        
        const query = {};
        if (teacher) query.teacher = teacher;
        if (status) query.status = status;
        
        const salaries = await Salary.find(query)
            .populate('teacher', 'name lastName')
            .sort({ calculatedAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);
        
        const total = await Salary.countDocuments(query);
        
        res.json({
            success: true,
            data: salaries,
            pagination: {
                current: parseInt(page),
                pages: Math.ceil(total / limit),
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
        const salary = await Salary.findById(req.params.id);
        
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
        salary.status = 'paid';
        salary.paidAt = new Date();
        await salary.save();
        
        // Создаем запись о расходе в кассе
        const expense = new CashTransaction({
            type: 'expense',
            category: 'salary',
            amount: salary.teacherSalary,
            description: `Зарплата преподавателя: ${salary.teacherName}`,
            date: new Date(),
            createdBy: req.user.id
        });
        
        await expense.save();
        
        console.log(`💰 Создан расход в кассе: ${salary.teacherSalary} тенге для ${salary.teacherName}`);
        
        res.json({
            success: true,
            message: 'Зарплата отмечена как выплаченная',
            data: salary
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
        
        const stats = await Salary.aggregate([
            {
                $match: {
                    calculatedAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: null,
                    totalSalaries: { $sum: 1 },
                    totalPaid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$teacherSalary', 0] } },
                    totalPending: { $sum: { $cond: [{ $eq: ['$status', 'calculated'] }, '$teacherSalary', 0] } },
                    totalEarnings: { $sum: '$totalEarnings' }
                }
            }
        ]);
        
        const result = stats[0] || {
            totalSalaries: 0,
            totalPaid: 0,
            totalPending: 0,
            totalEarnings: 0
        };
        
        res.json({
            success: true,
            data: {
                period,
                startDate,
                endDate,
                ...result
            }
        });
    } catch (error) {
        console.error('❌ Get salary statistics error:', error);
        res.status(500).json({ success: false, message: 'Ошибка при получении статистики', error: error.message });
    }
});

module.exports = router;