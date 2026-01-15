const express = require('express');
const router = express.Router();
const Student = require('../models/Student');
const { authenticate, requireAdmin, requireSalesOrAdmin, requireNotStudent } = require('../middleware/auth');
const { cacheUtils } = require('../config/redis');

// @route   GET /api/students/teachers/public
// @desc    Получить всех преподавателей для публичного отображения
// @access  Public
router.get('/teachers/public', async (req, res) => {
    try {
        const teachers = await Student.find({
            role: 'teacher',
            status: 'active'
        })
            .select('name lastName teacherInfo')
            .sort({ 'teacherInfo.displayOrder': 1, createdAt: 1 });

        res.json({
            success: true,
            count: teachers.length,
            teachers
        });
    } catch (error) {
        console.error('Get public teachers error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении преподавателей'
        });
    }
});

// @route   GET /api/students
// @desc    Получить всех учеников (с пагинацией и поиском)
//         Для преподавателя - только ученики из его групп
// @access  Sales Manager, Admin, Teacher
router.get('/', authenticate, requireNotStudent, async (req, res) => {
    try {
        const { search, role, page = 1, limit = 20, filter } = req.query;
        const userRole = req.user?.role;
        const userId = req.user?._id;

        // 🚀 Redis кэширование (включая роль пользователя в ключ)
        const cacheKey = `students:${search || 'all'}:${role || 'all'}:${page}:${limit}:${filter || 'all'}:${userRole || 'all'}:${userId || 'all'}`;
        const cachedData = await cacheUtils.get(cacheKey);
        if (cachedData) {
            console.log('📦 Cache HIT for students');
            return res.json(cachedData);
        }
        console.log('🔄 Cache MISS for students - fetching from DB');

        let query = {};

        // Исключить студентов для раздела "Пользователи"
        if (req.query.excludeStudents === 'true') {
            query.role = { $ne: 'student' };
        }

        // Фильтр по роли (должен применяться ПОСЛЕ excludeStudents, чтобы перезаписать его)
        if (role) {
            query.role = role;
        }

        // ✅ Если пользователь - преподаватель, фильтруем студентов по его группам
        let teacherGroupIds = [];
        if (userRole === 'teacher' && userId) {
            const Group = require('../models/Group');
            const teacherGroups = await Group.find({ teacher: userId }).select('_id').lean();
            teacherGroupIds = teacherGroups.map(g => g._id);

            if (teacherGroupIds.length === 0) {
                // У преподавателя нет групп - возвращаем пустой список
                const responseData = {
                    success: true,
                    count: 0,
                    total: 0,
                    page: parseInt(page),
                    pages: 0,
                    students: []
                };
                await cacheUtils.set(cacheKey, responseData, 180);
                return res.json(responseData);
            }

            console.log(`👨‍🏫 Фильтрация студентов по группам преподавателя: ${teacherGroupIds.length} групп`);
        }

        // ⚡ Поиск по имени, фамилии И телефону
        if (search && search.trim()) {
            try {
                const searchTerm = search.trim();
                const phoneDigits = searchTerm.replace(/\D/g, '');

                // Разбиваем поиск на слова для поиска "Имя Фамилия"
                const words = searchTerm.split(/\s+/);

                const searchConditions = [];

                // Если одно слово - ищем по имени ИЛИ фамилии
                if (words.length === 1) {
                    // Экранируем специальные символы regex для безопасности
                    const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    searchConditions.push({ name: { $regex: escapedTerm, $options: 'i' } });
                    searchConditions.push({ lastName: { $regex: escapedTerm, $options: 'i' } });
                } else {
                    // Если несколько слов - ищем "Имя Фамилия" (И)
                    const escapedWord0 = words[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const escapedWord1 = words[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    searchConditions.push({
                        $and: [
                            { name: { $regex: escapedWord0, $options: 'i' } },
                            { lastName: { $regex: escapedWord1, $options: 'i' } }
                        ]
                    });
                    // Также проверяем обратный порядок "Фамилия Имя"
                    searchConditions.push({
                        $and: [
                            { lastName: { $regex: escapedWord0, $options: 'i' } },
                            { name: { $regex: escapedWord1, $options: 'i' } }
                        ]
                    });
                }

                // Если есть цифры, ищем по phoneDigits (только если есть минимум 3 цифры для производительности)
                if (phoneDigits && phoneDigits.length >= 3) {
                    // Для phoneDigits не нужно экранирование, так как это только цифры
                    searchConditions.push({ phoneDigits: { $regex: phoneDigits } });
                }

                if (searchConditions.length > 0) {
                    query.$or = searchConditions;
                }
            } catch (searchError) {
                console.error('Search query construction error:', searchError);
                // Если ошибка в построении запроса поиска, продолжаем без поиска
            }
        }

        // ✅ Если преподаватель - добавляем фильтр по группам
        // Нужно правильно объединить условия поиска и фильтр по группам
        if (teacherGroupIds.length > 0) {
            // Создаем условия для фильтрации по группам преподавателя
            const groupFilter = {
                'groups.groupId': { $in: teacherGroupIds },
                'groups.status': 'active'
            };

            // Если есть условия поиска ($or), объединяем их с фильтром по группам через $and
            if (query.$or) {
                query = {
                    $and: [
                        { $or: query.$or },
                        groupFilter
                    ],
                    ...(query.role && { role: query.role })
                };
            } else {
                // Если нет условий поиска, просто добавляем фильтр по группам
                query = {
                    ...query,
                    ...groupFilter
                };
            }
        }

        // ⚡ ПАГИНАЦИЯ
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        // Параллельно: данные + общий подсчет
        let [students, total] = await Promise.all([
            Student.find(query)
                .populate('groups.groupId')
                .populate('activeMembership')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),
            Student.countDocuments(query)
        ]);

        // 🔴 ДОБАВИТЬ ИНФОРМАЦИЮ О ДОЛГЕ И ПРОСРОЧКЕ
        const Payment = require('../models/Payment');
        const Membership = require('../models/Membership');

        const studentsWithDebt = await Promise.all(students.map(async (student) => {
            let debtAmount = 0;
            let isOverdue = false;
            let overdueDays = 0;

            // Проверяем активный абонемент на долг
            if (student.activeMembership) {
                const membership = student.activeMembership;
                debtAmount = membership.remainingAmount || 0;

                // Если есть долг, проверяем просрочку
                if (debtAmount > 0) {
                    // Найти незавершенные платежи с dueDate
                    const overduePayment = await Payment.findOne({
                        student: student._id,
                        membership: membership._id,
                        status: { $in: ['pending', 'not_paid'] },
                        $or: [
                            { dueDate: { $lt: new Date() } },
                            { maxClassesBeforePayment: { $lte: membership.classesUsed || 0 } }
                        ]
                    }).sort({ dueDate: 1 });

                    if (overduePayment) {
                        isOverdue = true;
                        overdueDays = overduePayment.getOverdueDays();
                    }
                }
            }

            return {
                ...student,
                debtAmount,
                isOverdue,
                overdueDays
            };
        }));

        // 🔴 ФИЛЬТРАЦИЯ ПО ДОЛГАМ (после расчета)
        let filteredStudents = studentsWithDebt;

        if (filter === 'with_debt') {
            filteredStudents = studentsWithDebt.filter(s => s.debtAmount > 0);
        } else if (filter === 'overdue') {
            filteredStudents = studentsWithDebt.filter(s => s.isOverdue);
        }

        const responseData = {
            success: true,
            count: filteredStudents.length,
            total: filter ? filteredStudents.length : total,  // Если фильтр - считаем отфильтрованных
            page: pageNum,
            pages: Math.ceil((filter ? filteredStudents.length : total) / limitNum),
            students: filteredStudents
        };

        // 🚀 Кэшируем результат на 3 минуты
        await cacheUtils.set(cacheKey, responseData, 180);
        console.log('💾 Cached students data');

        res.json(responseData);
    } catch (error) {
        console.error('Get students error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении учеников',
            message: error.message || 'Внутренняя ошибка сервера'
        });
    }
});

// @route   GET /api/students/:id
// @desc    Получить одного ученика
// @access  Private
router.get('/:id', authenticate, async (req, res) => {
    try {
        // Проверка доступа: преподаватели, админы и sales могут видеть всех, студенты только себя
        const canViewAll = req.user.role !== 'student';
        const isOwnProfile = req.user._id.toString() === req.params.id;

        if (!canViewAll && !isOwnProfile) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }

        const student = await Student.findById(req.params.id)
            .populate('groups.groupId')
            .populate('activeMembership');

        if (!student) {
            return res.status(404).json({
                success: false,
                error: 'Ученик не найден'
            });
        }

        res.json({
            success: true,
            student
        });
    } catch (error) {
        console.error('Get student error:', error);
        res.status(500).json({
            error: 'Ошибка при получении ученика'
        });
    }
});

// @route   POST /api/students/:id/add-group
// @desc    Добавить ученика в группу
// @access  Private/Admin
router.post('/:id/add-group', authenticate, requireAdmin, async (req, res) => {
    try {
        const { groupId } = req.body;

        const student = await Student.findById(req.params.id);

        if (!student) {
            return res.status(404).json({
                success: false,
                error: 'Ученик не найден'
            });
        }

        // Проверка: максимум 2 группы
        const activeGroups = student.groups.filter(g => g.status === 'active');
        if (activeGroups.length >= 2) {
            return res.status(400).json({
                error: 'Ученик уже в 2 группах (максимум)'
            });
        }

        // Проверка: уже в этой группе?
        const alreadyInGroup = student.groups.some(g =>
            g.groupId.toString() === groupId && g.status === 'active'
        );

        if (alreadyInGroup) {
            return res.status(400).json({
                error: 'Ученик уже в этой группе'
            });
        }

        // Добавляем в группу
        student.groups.push({
            groupId,
            joinedAt: new Date(),
            status: 'active'
        });

        await student.save();

        // Обновляем счетчик в группе
        const Group = require('../models/Group');
        await Group.findByIdAndUpdate(groupId, {
            $inc: { currentStudents: 1 }
        });

        res.json({
            success: true,
            message: 'Ученик добавлен в группу',
            student
        });
    } catch (error) {
        console.error('Add to group error:', error);
        res.status(500).json({
            error: 'Ошибка при добавлении в группу'
        });
    }
});

// @route   DELETE /api/students/:id/remove-group
// @desc    Убрать ученика из группы
// @access  Private/Admin
router.delete('/:id/remove-group', authenticate, requireAdmin, async (req, res) => {
    try {
        const { groupId } = req.body;

        const student = await Student.findById(req.params.id);

        if (!student) {
            return res.status(404).json({
                success: false,
                error: 'Ученик не найден'
            });
        }

        // Находим группу и меняем статус на 'left'
        const groupIndex = student.groups.findIndex(g =>
            g.groupId.toString() === groupId
        );

        if (groupIndex === -1) {
            return res.status(400).json({
                error: 'Ученик не найден в этой группе'
            });
        }

        student.groups[groupIndex].status = 'left';
        await student.save();

        // Уменьшаем счетчик в группе
        const Group = require('../models/Group');
        await Group.findByIdAndUpdate(groupId, {
            $inc: { currentStudents: -1 }
        });

        res.json({
            success: true,
            message: 'Ученик убран из группы',
            student
        });
    } catch (error) {
        console.error('Remove from group error:', error);
        res.status(500).json({
            error: 'Ошибка при удалении из группы'
        });
    }
});

// @route   PATCH /api/students/:id
// @desc    Обновить данные ученика
// @access  Private
router.patch('/:id', authenticate, async (req, res) => {
    try {
        // Проверка доступа: только админы могут редактировать других, остальные только себя
        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
        const isOwnProfile = req.user._id.toString() === req.params.id;

        if (!isAdmin && !isOwnProfile) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }

        const { name, lastName, phone, email, dateOfBirth } = req.body;

        const updateData = {};
        if (name) updateData.name = name;
        if (lastName !== undefined) updateData.lastName = lastName;
        if (phone) {
            // Проверяем уникальность телефона (кроме текущего пользователя)
            const existingStudent = await Student.findOne({
                phone: phone,
                _id: { $ne: req.params.id }
            });

            if (existingStudent) {
                return res.status(400).json({
                    success: false,
                    error: 'Телефон уже используется другим пользователем'
                });
            }

            updateData.phone = phone;
            // phoneDigits обновится автоматически через pre-save hook
        }
        if (email) updateData.email = email;
        if (dateOfBirth) updateData.dateOfBirth = dateOfBirth;

        const student = await Student.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true, runValidators: true }
        );

        if (!student) {
            return res.status(404).json({
                success: false,
                error: 'Ученик не найден'
            });
        }

        res.json({
            success: true,
            message: 'Данные обновлены',
            student
        });
    } catch (error) {
        console.error('Update student error:', error);
        res.status(500).json({
            error: 'Ошибка при обновлении данных'
        });
    }
});

// @route   DELETE /api/students/:id
// @desc    Удалить ученика
// @access  Private/Admin
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const studentId = req.params.id;

        // Нельзя удалить себя
        if (studentId === req.user._id.toString()) {
            return res.status(400).json({
                success: false,
                error: 'Нельзя удалить свою собственную учетную запись'
            });
        }

        const student = await Student.findById(studentId);

        if (!student) {
            return res.status(404).json({
                success: false,
                error: 'Ученик не найден'
            });
        }

        // Проверяем роль - super_admin не может быть удален
        if (student.role === 'super_admin') {
            return res.status(400).json({
                success: false,
                error: 'Нельзя удалить супер-администратора'
            });
        }

        // КАСКАДНОЕ УДАЛЕНИЕ СВЯЗАННЫХ ДАННЫХ

        // 1. Удалить все абонементы ученика
        const Membership = require('../models/Membership');
        const deletedMemberships = await Membership.deleteMany({ student: studentId });
        console.log(`  ↳ Удалено абонементов: ${deletedMemberships.deletedCount}`);

        // 2. Удалить все заморозки ученика
        const Freeze = require('../models/Freeze');
        const deletedFreezes = await Freeze.deleteMany({ student: studentId });
        console.log(`  ↳ Удалено заморозок: ${deletedFreezes.deletedCount}`);

        // 3. Удалить посещаемость из всех занятий
        const Class = require('../models/Class');
        await Class.updateMany(
            { 'attendees.student': studentId },
            { $pull: { attendees: { student: studentId } } }
        );
        console.log(`  ↳ Посещаемость удалена из занятий`);

        // 4. Обновить счетчики в группах
        const Group = require('../models/Group');
        const activeGroups = student.groups.filter(g => g.status === 'active');

        // ⚡ ОПТИМИЗАЦИЯ: Обновляем ВСЕ группы ОДНИМ запросом вместо цикла
        if (activeGroups.length > 0) {
            const groupIds = activeGroups.map(g => g.groupId);
            await Group.updateMany(
                { _id: { $in: groupIds } },
                {
                    $inc: { currentStudents: -1 },
                    $pull: { students: studentId }
                }
            );
        }
        console.log(`  ↳ Убран из ${activeGroups.length} групп`);

        // 5. Удалить ученика
        await Student.findByIdAndDelete(studentId);

        console.log(`⚠️ Удален пользователь: ${student.name} (${student.phone}) - роль: ${student.role}`);

        // 6. Инвалидировать кэш студентов
        await cacheUtils.delPattern('students:*');
        console.log('  ↳ Кэш студентов очищен');

        res.json({
            success: true,
            message: 'Пользователь и все связанные данные удалены'
        });

    } catch (error) {
        console.error('Delete student error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при удалении пользователя'
        });
    }
});

// @route   POST /api/students/stats/batch-light
// @desc    Получить ТОЛЬКО пропуски за месяц (быстрый запрос)
// @access  Private
router.post('/stats/batch-light', authenticate, async (req, res) => {
    try {
        const { studentIds } = req.body;

        if (!studentIds || !Array.isArray(studentIds)) {
            return res.status(400).json({
                success: false,
                error: 'Требуется массив studentIds'
            });
        }

        // Доступ для всех, кроме студентов
        if (req.user.role === 'student') {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }

        const Class = require('../models/Class');

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        // Получить учеников с группами И абонементами
        const students = await Student.find({
            _id: { $in: studentIds }
        }).populate('groups.groupId', '_id').populate('activeMembership');

        // Собрать все ID групп
        const allGroupIds = [];
        students.forEach(student => {
            student.groups
                .filter(g => g.status === 'active')
                .forEach(g => {
                    if (g.groupId?._id) {
                        allGroupIds.push(g.groupId._id.toString());
                    }
                });
        });

        // Получить ТОЛЬКО занятия за текущий месяц (оптимизация!)
        // ИСКЛЮЧАЕМ ПРАКТИКИ - они не учитываются
        const monthClasses = await Class.find({
            group: { $in: allGroupIds },
            date: { $gte: startOfMonth, $lt: today },
            isPractice: { $ne: true }  // Практики не учитываем
        }).select('group attendees date');

        // Подсчитать пропуски для каждого ученика
        const statsMap = {};

        for (const student of students) {
            const studentId = student._id.toString();
            const studentGroupIds = student.groups
                .filter(g => g.status === 'active')
                .map(g => g.groupId?._id?.toString())
                .filter(Boolean);

            // Получить дату начала абонемента
            const membership = student.activeMembership;
            const membershipStartDate = membership ? (membership.startDate || membership.createdAt) : null;

            // ⚡ ВАЖНО: Используем дату регистрации студента как минимальную дату
            const studentStartDate = student.createdAt;
            const effectiveStartDate = membershipStartDate
                ? (membershipStartDate > studentStartDate ? membershipStartDate : studentStartDate)
                : studentStartDate;

            // Занятия этого ученика за месяц (ТОЛЬКО после регистрации студента!)
            const studentMonthClasses = monthClasses.filter(c => {
                if (!studentGroupIds.includes(c.group?.toString())) return false;
                if (c.date < effectiveStartDate) return false; // ДО регистрации
                return true;
            });

            // Посещено за месяц
            const monthAttended = studentMonthClasses.filter(c =>
                c.attendees.some(a =>
                    a.student.toString() === studentId && a.attended === true
                )
            ).length;

            const monthMissed = studentMonthClasses.length - monthAttended;

            statsMap[studentId] = {
                monthMissed
            };
        }

        res.json({
            success: true,
            stats: statsMap
        });
    } catch (error) {
        console.error('Batch light stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении статистики'
        });
    }
});

// @route   POST /api/students/stats/batch
// @desc    Получить статистику для множества учеников за один запрос
// @access  Private
router.post('/stats/batch', authenticate, async (req, res) => {
    try {
        const { studentIds } = req.body;

        if (!studentIds || !Array.isArray(studentIds)) {
            return res.status(400).json({
                success: false,
                error: 'Требуется массив studentIds'
            });
        }

        // Проверка доступа: все, кроме студентов
        if (req.user.role === 'student') {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }

        const Class = require('../models/Class');

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        // Получить всех учеников с их группами
        const students = await Student.find({
            _id: { $in: studentIds }
        }).populate('groups.groupId');

        // Собрать все ID групп
        const allGroupIds = [];
        students.forEach(student => {
            student.groups
                .filter(g => g.status === 'active')
                .forEach(g => {
                    if (g.groupId?._id) {
                        allGroupIds.push(g.groupId._id.toString());
                    }
                });
        });

        // Получить все занятия этих групп одним запросом
        const allGroupClasses = await Class.find({
            group: { $in: allGroupIds },
            date: { $lt: today }
        }).populate('group', 'name direction');

        // Получить все посещаемости учеников одним запросом
        const allAttendances = await Class.find({
            'attendees.student': { $in: studentIds }
        }).populate('group', 'name direction').sort({ date: -1 });

        // Подсчитать статистику для каждого ученика
        const statsMap = {};

        for (const student of students) {
            const studentId = student._id.toString();
            const studentGroupIds = student.groups
                .filter(g => g.status === 'active')
                .map(g => g.groupId?._id?.toString())
                .filter(Boolean);

            // ⚡ ВАЖНО: Получаем дату начала для фильтрации
            const membership = student.activeMembership;
            const membershipStartDate = membership ? (membership.startDate || membership.createdAt) : null;
            const studentStartDate = student.createdAt;
            const effectiveStartDate = membershipStartDate
                ? (membershipStartDate > studentStartDate ? membershipStartDate : studentStartDate)
                : studentStartDate;

            // Занятия этого ученика (прошедшие, ТОЛЬКО после регистрации!)
            const studentClasses = allGroupClasses.filter(c =>
                studentGroupIds.includes(c.group?._id?.toString()) && c.date >= effectiveStartDate
            );

            // Посещаемость этого ученика (ТОЛЬКО после регистрации!)
            const studentAttendances = allAttendances.filter(c =>
                c.attendees.some(a => a.student.toString() === studentId) && c.date >= effectiveStartDate
            );

            const totalClasses = studentClasses.length;
            const attendedCount = studentAttendances.filter(c => {
                const attendee = c.attendees.find(a => a.student.toString() === studentId);
                return attendee && attendee.attended === true;
            }).length;

            const missedCount = totalClasses - attendedCount;
            const attendanceRate = totalClasses > 0 ? Math.round((attendedCount / totalClasses) * 100) : 0;

            // Последнее посещение
            const lastAttended = studentAttendances.find(c => {
                const attendee = c.attendees.find(a => a.student.toString() === studentId);
                return attendee && attendee.attended === true;
            });

            const lastAttendedDate = lastAttended ? lastAttended.date : null;

            // Пропуски за текущий месяц
            const monthClasses = studentClasses.filter(c => c.date >= startOfMonth);
            const monthAttended = studentAttendances.filter(c => {
                const attendee = c.attendees.find(a => a.student.toString() === studentId);
                return c.date >= startOfMonth && attendee && attendee.attended === true;
            }).length;
            const monthMissed = monthClasses.length - monthAttended;

            // История последних 10 посещений
            const recentHistory = studentAttendances.slice(0, 10).map(c => {
                const attendee = c.attendees.find(a => a.student.toString() === studentId);
                return {
                    date: c.date,
                    title: c.title,
                    group: c.group?.name || 'Специальное',
                    attended: attendee ? attendee.attended : false,
                    markedAt: attendee?.markedAt
                };
            });

            statsMap[studentId] = {
                totalClasses,
                attendedCount,
                missedCount,
                attendanceRate,
                lastAttendedDate,
                monthMissed,
                recentHistory
            };
        }

        res.json({
            success: true,
            stats: statsMap
        });
    } catch (error) {
        console.error('Batch stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении статистики'
        });
    }
});

// @route   GET /api/students/:id/stats
// @desc    Получить статистику ученика (посещаемость, пропуски)
// @access  Private
router.get('/:id/stats', authenticate, async (req, res) => {
    try {
        const studentId = req.params.id;

        // Проверка доступа: преподаватели могут видеть всех, студенты только себя
        const canViewAll = req.user.role !== 'student';
        const isOwnProfile = req.user._id.toString() === studentId;

        if (!canViewAll && !isOwnProfile) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }

        const Class = require('../models/Class');

        // ⚡ ОПТИМИЗАЦИЯ: Сначала получаем ученика (нужен для фильтрации)
        const student = await Student.findById(studentId).populate('groups.groupId').populate('activeMembership');
        const studentGroupIds = student.groups
            .filter(g => g.status === 'active')
            .map(g => g.groupId?._id?.toString())
            .filter(Boolean);

        const membership = student.activeMembership;
        const membershipStartDate = membership ? (membership.startDate || membership.createdAt) : null;

        // ⚡ ВАЖНО: Используем дату регистрации студента как минимальную дату
        // Студент не мог пропустить занятия ДО своей регистрации!
        const studentStartDate = student.createdAt;
        const effectiveStartDate = membershipStartDate
            ? (membershipStartDate > studentStartDate ? membershipStartDate : studentStartDate)
            : studentStartDate;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Формируем фильтр для занятий групп (только после регистрации студента!)
        let classFilter = {
            group: { $in: studentGroupIds },
            date: {
                $gte: effectiveStartDate,
                $lt: today
            },
            isPractice: { $ne: true }
        };

        // ⚡ ПАРАЛЛЕЛЬНО загружаем оба списка занятий
        const [allAttendances, allGroupClasses] = await Promise.all([
            // Все занятия где ученик был отмечен
            Class.find({
                'attendees.student': studentId,
                isPractice: { $ne: true }
            })
                .populate('group', 'name direction')
                .sort({ date: -1 }),
            // Все занятия его групп
            Class.find(classFilter).sort({ date: -1 })
        ]);

        // Подсчитать статистику (ТОЛЬКО занятия после создания абонемента!)
        const totalClasses = allGroupClasses.length;

        // Фильтруем attendance только для занятий после регистрации студента
        const relevantAttendances = allAttendances.filter(c => {
            if (c.date < effectiveStartDate) {
                return false; // Занятие до регистрации - не учитываем
            }
            return true;
        });

        const attendedCount = relevantAttendances.filter(c => {
            const attendee = c.attendees.find(a => a.student.toString() === studentId);
            return attendee && attendee.attended === true;
        }).length;

        const missedCount = totalClasses - attendedCount;
        const attendanceRate = totalClasses > 0 ? Math.round((attendedCount / totalClasses) * 100) : 0;

        // Последнее посещение (в рамках абонемента)
        const lastAttended = relevantAttendances.find(c => {
            const attendee = c.attendees.find(a => a.student.toString() === studentId);
            return attendee && attendee.attended === true;
        });

        const lastAttendedDate = lastAttended ? lastAttended.date : null;

        // Пропуски за текущий месяц
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const monthClasses = allGroupClasses.filter(c => c.date >= startOfMonth);
        const monthAttended = relevantAttendances.filter(c => {
            const attendee = c.attendees.find(a => a.student.toString() === studentId);
            return c.date >= startOfMonth && attendee && attendee.attended === true;
        }).length;
        const monthMissed = monthClasses.length - monthAttended;

        // История последних 10 посещений (только в рамках абонемента)
        const recentHistory = relevantAttendances.slice(0, 10).map(c => {
            const attendee = c.attendees.find(a => a.student.toString() === studentId);
            return {
                date: c.date,
                title: c.title,
                group: c.group?.name || 'Специальное',
                attended: attendee ? attendee.attended : false,
                markedAt: attendee?.markedAt
            };
        });

        res.json({
            success: true,
            stats: {
                totalClasses,
                attendedCount,
                missedCount,
                attendanceRate,
                lastAttendedDate,
                monthMissed,
                recentHistory
            }
        });
    } catch (error) {
        console.error('Get student stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении статистики ученика'
        });
    }
});

// @route   GET /api/students/:id/attendance-history
// @desc    Получить историю посещений ученика
// @access  Private (own profile or admin)
router.get('/:id/attendance-history', authenticate, async (req, res) => {
    try {
        const isAdmin = ['admin', 'super_admin', 'sales_manager', 'teacher'].includes(req.user.role);
        const isOwnProfile = req.user._id.toString() === req.params.id;

        if (!isAdmin && !isOwnProfile) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }

        const Class = require('../models/Class');
        const Freeze = require('../models/Freeze');

        // Найти ученика
        const student = await Student.findById(req.params.id).populate('groups.groupId');

        if (!student) {
            return res.status(404).json({
                success: false,
                error: 'Ученик не найден'
            });
        }

        // Получить ID групп ученика
        const groupIds = student.groups
            .filter(g => g.status === 'active')
            .map(g => g.groupId?._id || g.groupId);

        if (groupIds.length === 0) {
            return res.json({
                success: true,
                history: []
            });
        }

        // Найти занятия групп за последний месяц (только прошедшие)
        // ИСКЛЮЧАЕМ ПРАКТИКИ - они не учитываются в истории
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        const now = new Date();

        // ⚡ ВАЖНО: Учитываем дату регистрации студента
        const studentStartDate = student.createdAt;
        const effectiveStartDate = oneMonthAgo > studentStartDate ? oneMonthAgo : studentStartDate;

        const classes = await Class.find({
            group: { $in: groupIds },
            date: { $gte: effectiveStartDate, $lt: now },
            isPractice: { $ne: true }  // Практики не учитываем
        })
            .populate('group', 'name')
            .sort({ date: -1 })
            .limit(10); // Последние 10 занятий

        // Найти активные заморозки ученика
        const activeFreezes = await Freeze.find({
            student: req.params.id,
            status: 'active'
        });

        // Проверить статус посещения для каждого занятия
        const history = classes.map(cls => {
            const attendee = cls.attendees.find(a =>
                a.student && a.student.toString() === req.params.id
            );

            // Проверить была ли заморозка
            const wasFrozen = activeFreezes.some(freeze => {
                const freezeStart = new Date(freeze.startDate);
                const freezeEnd = new Date(freeze.endDate);
                const clsDate = new Date(cls.date);

                freezeStart.setHours(0, 0, 0, 0);
                freezeEnd.setHours(23, 59, 59, 999);
                clsDate.setHours(12, 0, 0, 0);

                return clsDate >= freezeStart && clsDate <= freezeEnd;
            });

            let status = 'missed'; // По умолчанию пропущено
            if (wasFrozen) {
                status = 'frozen';
            } else if (attendee && attendee.attended) {
                status = 'attended';
            }

            return {
                date: cls.date,
                group: cls.group?.name || 'Группа',
                startTime: cls.startTime,
                status: status
            };
        });

        res.json({
            success: true,
            history
        });

    } catch (error) {
        console.error('Get attendance history error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении истории посещений'
        });
    }
});

// @route   GET /api/students/:id/upcoming-classes
// @desc    Получить ближайшие занятия ученика (из реальной базы данных)
// @access  Private (own profile or admin)
router.get('/:id/upcoming-classes', authenticate, async (req, res) => {
    try {
        const isAdmin = ['admin', 'super_admin', 'sales_manager', 'teacher'].includes(req.user.role);
        const isOwnProfile = req.user._id.toString() === req.params.id;

        if (!isAdmin && !isOwnProfile) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }

        const Class = require('../models/Class');

        // Найти ученика
        const student = await Student.findById(req.params.id).populate('groups.groupId');

        if (!student) {
            return res.status(404).json({
                success: false,
                error: 'Ученик не найден'
            });
        }

        // Получить ID групп ученика
        const groupIds = student.groups
            .filter(g => g.status === 'active')
            .map(g => g.groupId?._id || g.groupId);

        if (groupIds.length === 0) {
            return res.json({
                success: true,
                classes: []
            });
        }

        // Найти ближайшие занятия
        const now = new Date();
        const today = new Date(now);
        today.setHours(0, 0, 0, 0); // Начало сегодняшнего дня

        const twoWeeksLater = new Date(now);
        twoWeeksLater.setDate(twoWeeksLater.getDate() + 14);

        // Получаем обычные занятия ИЛИ практики где группа ученика в списке
        // Используем today вместо now, чтобы включить все занятия сегодня
        const classes = await Class.find({
            $or: [
                // Обычные занятия для групп ученика
                {
                    group: { $in: groupIds },
                    isPractice: { $ne: true }
                },
                // Практики где группа ученика в списке practiceGroups
                {
                    practiceGroups: { $in: groupIds },
                    isPractice: true
                }
            ],
            date: { $gte: today, $lte: twoWeeksLater },
            status: { $ne: 'cancelled' }
        })
            .populate('group', 'name direction')
            .populate('practiceGroups', 'name direction')
            .populate('room', 'name')
            .sort({ date: 1, startTime: 1 })
            .limit(20); // Увеличиваем лимит, так как будем фильтровать

        // Фильтруем занятия: для сегодняшних показываем только те, у которых время начала еще не прошло
        const filteredClasses = classes.filter(cls => {
            const classDate = new Date(cls.date);
            const classDateOnly = new Date(classDate);
            classDateOnly.setHours(0, 0, 0, 0);
            const todayOnly = new Date(today);
            todayOnly.setHours(0, 0, 0, 0);

            // Если занятие сегодня, проверяем время начала
            if (classDateOnly.getTime() === todayOnly.getTime()) {
                // Парсим время начала занятия
                const [hours, minutes] = cls.startTime.split(':').map(Number);
                const classStartTime = new Date(classDate);
                classStartTime.setHours(hours, minutes || 0, 0, 0);

                // Показываем только если время начала еще не прошло
                return classStartTime > now;
            }

            // Для будущих занятий показываем все
            return true;
        }).slice(0, 10); // Ограничиваем до 10 занятий после фильтрации

        const formattedClasses = filteredClasses.map(cls => {
            // Для практик показываем все группы
            let displayGroup = cls.group?.name || cls.title || 'Группа';
            if (cls.isPractice && cls.practiceGroups && cls.practiceGroups.length > 0) {
                displayGroup = cls.practiceGroups.map(g => g.name).join(', ');
            }

            return {
                _id: cls._id,
                title: cls.title,
                group: displayGroup,
                direction: cls.group?.direction || (cls.practiceGroups?.[0]?.direction) || '',
                date: cls.date,
                startTime: cls.startTime,
                endTime: cls.endTime,
                room: cls.room?.name || '',
                isPractice: cls.isPractice || false
            };
        });

        res.json({
            success: true,
            classes: formattedClasses
        });

    } catch (error) {
        console.error('Get upcoming classes error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении ближайших занятий'
        });
    }
});

// @route   GET /api/students/:id/upcoming-practices
// @desc    Получить ближайшие практики ученика
// @access  Private (own profile or admin)
router.get('/:id/upcoming-practices', authenticate, async (req, res) => {
    try {
        const isAdmin = ['admin', 'super_admin', 'sales_manager', 'teacher'].includes(req.user.role);
        const isOwnProfile = req.user._id.toString() === req.params.id;

        if (!isAdmin && !isOwnProfile) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }

        const Class = require('../models/Class');

        // Найти ученика
        const student = await Student.findById(req.params.id).populate('groups.groupId');

        if (!student) {
            return res.status(404).json({
                success: false,
                error: 'Ученик не найден'
            });
        }

        // Получить ID групп ученика
        const groupIds = student.groups
            .filter(g => g.status === 'active')
            .map(g => g.groupId?._id || g.groupId);

        if (groupIds.length === 0) {
            return res.json({
                success: true,
                practices: []
            });
        }

        // Найти ближайшие практики
        const now = new Date();
        const twoWeeksLater = new Date(now);
        twoWeeksLater.setDate(twoWeeksLater.getDate() + 14);

        const practices = await Class.find({
            group: { $in: groupIds },
            isPractice: true,
            date: { $gte: now, $lte: twoWeeksLater },
            status: { $ne: 'cancelled' }
        })
            .populate('group', 'name direction')
            .populate('room', 'name')
            .sort({ date: 1, startTime: 1 })
            .limit(5);

        const formattedPractices = practices.map(practice => ({
            _id: practice._id,
            title: practice.title,
            group: practice.group?.name || 'Практика',
            direction: practice.group?.direction || '',
            date: practice.date,
            startTime: practice.startTime,
            endTime: practice.endTime,
            room: practice.room?.name || ''
        }));

        res.json({
            success: true,
            practices: formattedPractices
        });

    } catch (error) {
        console.error('Get upcoming practices error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении практик'
        });
    }
});

// @route   POST /api/students/:id/accept-offer
// @desc    Принять публичную оферту
// @access  Private (own profile)
router.post('/:id/accept-offer', authenticate, async (req, res) => {
    try {
        const studentId = req.params.id;

        // Проверка доступа (только свой профиль)
        if (req.user._id.toString() !== studentId) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }

        const student = await Student.findById(studentId);

        if (!student) {
            return res.status(404).json({
                success: false,
                error: 'Ученик не найден'
            });
        }

        // Сохраняем согласие
        student.offerAccepted = true;
        student.offerAcceptedAt = new Date();
        await student.save();

        console.log(`📋 ${student.name} принял публичную оферту`);

        res.json({
            success: true,
            message: 'Согласие с офертой сохранено'
        });

    } catch (error) {
        console.error('Accept offer error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при сохранении согласия'
        });
    }
});

module.exports = router;




