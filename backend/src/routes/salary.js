const express = require('express');
const router = express.Router();
const Salary = require('../models/Salary');
const Student = require('../models/Student');
const Group = require('../models/Group');
const Class = require('../models/Class');
const Membership = require('../models/Membership');
const CashTransaction = require('../models/CashTransaction');
const { authenticate, requireAdmin } = require('../middleware/auth');

// 🧮 РАСЧЕТ ЗАРПЛАТЫ ПРЕПОДАВАТЕЛЕЙ
// POST /api/salary/calculate
router.post('/calculate', authenticate, requireAdmin, async (req, res) => {
    try {
        console.log('🧮 Начинаем расчет зарплаты...');
        console.log('🧮 Данные запроса:', req.body);
        console.log('🧮 Пользователь:', req.user);
        
        const { teacherId, startDate, endDate, percentage = 35 } = req.body;

        // Валидация
        if (!teacherId || !startDate || !endDate) {
            console.log('❌ Недостаточно данных для расчета');
            return res.status(400).json({ 
                success: false, 
                message: 'Необходимо указать преподавателя и период' 
            });
        }

        // Проверяем, что пользователь имеет права
        if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Недостаточно прав для расчета зарплаты' 
            });
        }

        // Находим преподавателя
        console.log('👨‍🏫 Ищем преподавателя:', teacherId);
        const teacher = await Student.findById(teacherId);
        console.log('👨‍🏫 Найденный преподаватель:', teacher);
        
        if (!teacher || teacher.role !== 'teacher') {
            console.log('❌ Преподаватель не найден или неправильная роль');
            return res.status(404).json({ 
                success: false, 
                message: 'Преподаватель не найден' 
            });
        }

        // Период для поиска занятий
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        console.log('📅 Период расчета:', start.toISOString(), 'до', end.toISOString());

        // НОВАЯ ЛОГИКА: Находим все занятия где преподаватель вел урок
        console.log('👨‍🏫 Ищем занятия преподавателя...');
        const classes = await Class.find({
            teacher: teacherId,
            date: { $gte: start, $lte: end },
            isPractice: { $ne: true } // Исключаем практики
        }).populate('group', 'name direction');
        
        console.log('📚 Найдено занятий:', classes.length);
        
        if (classes.length === 0) {
            console.log('❌ У преподавателя нет занятий в указанном периоде');
            return res.status(404).json({ 
                success: false, 
                message: 'У преподавателя нет занятий в указанном периоде' 
            });
        }

        // Группируем занятия по группам для статистики
        const groupsMap = new Map();
        let totalAttendedClasses = 0;
        let totalEarnings = 0;

        for (const classItem of classes) {
            console.log(`📚 Обрабатываем занятие: ${classItem.title} (${classItem.date.toISOString().split('T')[0]})`);
            
            const groupId = classItem.group?._id?.toString() || 'unknown';
            const groupName = classItem.group?.name || 'Неизвестная группа';
            
            if (!groupsMap.has(groupId)) {
                groupsMap.set(groupId, {
                    groupId,
                    groupName,
                    classes: [],
                    students: new Map(),
                    totalAttendedClasses: 0,
                    totalEarnings: 0
                });
            }
            
            const groupData = groupsMap.get(groupId);
            groupData.classes.push({
                classId: classItem._id,
                date: classItem.date,
                title: classItem.title
            });
            
            // Обрабатываем посещаемость на этом занятии
            if (classItem.attendees && classItem.attendees.length > 0) {
                console.log(`👥 Обрабатываем посещаемость: ${classItem.attendees.length} записей`);
                
                for (const attendance of classItem.attendees) {
                    if (attendance.attended === true) {
                        const studentId = attendance.student.toString();
                        
                        // Находим студента
                        const student = await Student.findById(studentId);
                        if (!student) continue;
                        
                        // Находим активный абонемент студента
                        const membership = await Membership.findOne({
                            student: studentId,
                            status: 'active',
                            startDate: { $lte: classItem.date },
                            $or: [
                                { endDate: { $gte: classItem.date } },
                                { endDate: null }
                            ]
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
                        
                        // Добавляем студента в группу
                        if (!groupData.students.has(studentId)) {
                            groupData.students.set(studentId, {
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
                        
                        const studentData = groupData.students.get(studentId);
                        studentData.attendedClasses += 1;
                        studentData.totalEarnings = Number(studentData.totalEarnings) + Number(pricePerClass);
                        
                        groupData.totalAttendedClasses += 1;
                        groupData.totalEarnings = Number(groupData.totalEarnings) + Number(pricePerClass);
                        
                        totalAttendedClasses += 1;
                        totalEarnings = Number(totalEarnings) + Number(pricePerClass);
                        
                        console.log(`✅ ${student.name}: +${pricePerClass}₸ (${pricePerClass}₸ за занятие)`);
                    }
                }
            } else {
                console.log(`⚠️ Нет данных о посещаемости для занятия ${classItem.title}`);
            }
        }
        
        // Преобразуем Map в массив
        const groupsData = Array.from(groupsMap.values()).map(groupData => ({
            ...groupData,
            students: Array.from(groupData.students.values()),
            totalStudents: groupData.students.size
        }));

        // Общая статистика
        const totalGroups = groupsData.length;
        const totalStudents = groupsData.reduce((sum, group) => sum + group.totalStudents, 0);
        // Используем уже рассчитанные значения

        console.log('📊 Статистика расчета зарплаты:');
        console.log('📊 Группы:', totalGroups);
        console.log('📊 Студенты:', totalStudents);
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
            groups: groupsData,
            totalGroups,
            totalStudents,
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
                teacher: {
                    id: teacher._id,
                    name: salary.teacherName
                },
                period: {
                    start: start.toISOString().split('T')[0],
                    end: end.toISOString().split('T')[0]
                },
                statistics: {
                    totalGroups,
                    totalStudents,
                    totalAttendedClasses,
                    totalEarnings,
                    teacherPercentage: percentage,
                    teacherSalary
                },
                groups: groupsData
            }
        });

    } catch (error) {
        console.error('❌ Salary calculation error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка при расчете зарплаты',
            error: error.message 
        });
    }
});

// 📊 ПОЛУЧИТЬ РАСЧЕТЫ ЗАРПЛАТЫ
// GET /api/salary
router.get('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const { teacherId, status, page = 1, limit = 10 } = req.query;

        // Фильтры
        const filters = {};
        if (teacherId) filters.teacher = teacherId;
        if (status) filters.status = status;

        // Пагинация
        const skip = (page - 1) * limit;

        const salaries = await Salary.find(filters)
            .populate('teacher', 'name lastName')
            .sort({ calculatedAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Salary.countDocuments(filters);

        res.json({
            success: true,
            data: {
                salaries,
                pagination: {
                    current: parseInt(page),
                    total: Math.ceil(total / limit),
                    count: salaries.length,
                    totalCount: total
                }
            }
        });

    } catch (error) {
        console.error('❌ Get salaries error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка при получении расчетов зарплаты',
            error: error.message 
        });
    }
});

// 💰 ОТМЕТИТЬ ЗАРПЛАТУ КАК ВЫПЛАЧЕННУЮ
// PUT /api/salary/:id/pay
router.put('/:id/pay', authenticate, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;

        // Проверяем права
        if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Недостаточно прав для выплаты зарплаты' 
            });
        }

        const salary = await Salary.findById(id);
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

        // Обновляем статус
        salary.status = 'paid';
        salary.paidAt = new Date();
        if (notes) salary.notes = notes;

        await salary.save();

        // 💰 СОЗДАЕМ РАСХОД В КАССЕ
        try {
            const expenseTransaction = new CashTransaction({
                type: 'expense',
                amount: salary.teacherSalary,
                category: 'Зарплата преподавателей',
                description: `Зарплата преподавателя ${salary.teacherName} за период ${salary.period.start.toISOString().split('T')[0]} - ${salary.period.end.toISOString().split('T')[0]}`,
                date: new Date(),
                createdBy: req.user.id,
                salaryId: salary._id, // Связываем с расчетом зарплаты
                notes: notes || `Автоматически создано при выплате зарплаты. Статистика: ${salary.totalAttendedClasses} занятий, ${salary.totalStudents} учеников`
            });

            await expenseTransaction.save();
            console.log(`💰 Создан расход в кассе: ${salary.teacherSalary} тенге для ${salary.teacherName}`);
        } catch (expenseError) {
            console.error('❌ Ошибка создания расхода в кассе:', expenseError);
            // Не прерываем процесс выплаты зарплаты из-за ошибки в кассе
        }

        res.json({
            success: true,
            message: 'Зарплата отмечена как выплаченная',
            data: salary
        });

    } catch (error) {
        console.error('❌ Pay salary error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка при отметке выплаты',
            error: error.message 
        });
    }
});

// 📈 СТАТИСТИКА ЗАРПЛАТ
// GET /api/salary/statistics
router.get('/statistics', authenticate, requireAdmin, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        // Фильтры по дате
        const dateFilters = {};
        if (startDate && endDate) {
            dateFilters.calculatedAt = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }

        // Общая статистика
        const totalSalaries = await Salary.countDocuments(dateFilters);
        const paidSalaries = await Salary.countDocuments({ ...dateFilters, status: 'paid' });
        const pendingSalaries = await Salary.countDocuments({ ...dateFilters, status: 'calculated' });

        // Суммы
        const totalPaid = await Salary.aggregate([
            { $match: { ...dateFilters, status: 'paid' } },
            { $group: { _id: null, total: { $sum: '$teacherSalary' } } }
        ]);

        const totalPending = await Salary.aggregate([
            { $match: { ...dateFilters, status: 'calculated' } },
            { $group: { _id: null, total: { $sum: '$teacherSalary' } } }
        ]);

        res.json({
            success: true,
            data: {
                totalSalaries,
                paidSalaries,
                pendingSalaries,
                totalPaidAmount: totalPaid[0]?.total || 0,
                totalPendingAmount: totalPending[0]?.total || 0
            }
        });

    } catch (error) {
        console.error('❌ Salary statistics error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка при получении статистики',
            error: error.message 
        });
    }
});

module.exports = router;
