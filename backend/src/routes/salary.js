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

        // Находим группы преподавателя
        console.log('👥 Ищем группы преподавателя...');
        const groups = await Group.find({ 
            teacher: teacherId,
            isActive: true 
        });
        
        console.log('👥 Найденные группы:', groups.length);
        console.log('👥 Группы:', groups);

        if (groups.length === 0) {
            console.log('❌ У преподавателя нет активных групп');
            return res.status(404).json({ 
                success: false, 
                message: 'У преподавателя нет активных групп' 
            });
        }

        // Период для поиска занятий
        const start = new Date(startDate);
        const end = new Date(endDate);

        // Собираем статистику по группам
        const groupsData = [];

        for (const group of groups) {
            // Находим студентов этой группы
            const groupStudents = await Student.find({
                'groups.groupId': group._id,
                'groups.status': 'active',
                status: 'active'
            });
            
            const groupData = {
                groupId: group._id,
                groupName: group.name,
                students: [],
                totalStudents: groupStudents.length,
                totalAttendedClasses: 0,
                totalEarnings: 0
            };

            // Обрабатываем каждого ученика в группе
            for (const student of groupStudents) {
                if (!student) continue;
                
                console.log(`👤 Обрабатываем студента: ${student.name} ${student.lastName || ''}`);

                // Находим активный абонемент студента
                const membership = await Membership.findOne({
                    student: student._id,
                    status: 'active',
                    startDate: { $lte: end },
                    $or: [
                        { endDate: { $gte: start } },
                        { endDate: null }
                    ]
                });

                if (!membership) {
                    console.log(`❌ У студента ${student.name} нет активного абонемента`);
                    continue;
                }
                
                console.log(`✅ Найден абонемент: ${membership.price}₸ за ${membership.totalClasses} занятий`);

                // Подсчитываем посещенные занятия в этом периоде
                const attendedClasses = await Class.countDocuments({
                    group: group._id,
                    date: { $gte: start, $lte: end },
                    attendance: {
                        $elemMatch: {
                            student: student._id,
                            status: 'attended'
                        }
                    }
                });
                
                console.log(`📅 Посещенных занятий: ${attendedClasses}`);

                // Рассчитываем стоимость одного занятия
                const pricePerClass = membership.price / membership.totalClasses;
                console.log(`💰 Стоимость за занятие: ${pricePerClass}₸`);

                // Общий заработок с этого ученика
                const totalEarnings = attendedClasses * pricePerClass;
                console.log(`💰 Заработок с студента: ${totalEarnings}₸`);

                groupData.students.push({
                    studentId: student._id,
                    studentName: `${student.name} ${student.lastName || ''}`.trim(),
                    membership: {
                        membershipId: membership._id,
                        totalClasses: membership.totalClasses,
                        price: membership.price,
                        pricePerClass: pricePerClass
                    },
                    attendedClasses,
                    totalEarnings
                });

                groupData.totalAttendedClasses += attendedClasses;
                groupData.totalEarnings += totalEarnings;
            }

            groupsData.push(groupData);
        }

        // Общая статистика
        const totalGroups = groupsData.length;
        const totalStudents = groupsData.reduce((sum, group) => sum + group.totalStudents, 0);
        const totalAttendedClasses = groupsData.reduce((sum, group) => sum + group.totalAttendedClasses, 0);
        const totalEarnings = groupsData.reduce((sum, group) => sum + group.totalEarnings, 0);

        console.log('📊 Статистика расчета зарплаты:');
        console.log('📊 Группы:', totalGroups);
        console.log('📊 Студенты:', totalStudents);
        console.log('📊 Посещенные занятия:', totalAttendedClasses);
        console.log('📊 Общий доход:', totalEarnings);
        console.log('📊 Процент преподавателя:', percentage);

        // Зарплата преподавателя
        const teacherSalary = (totalEarnings * percentage) / 100;
        
        console.log('💰 Зарплата преподавателя:', teacherSalary);

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
