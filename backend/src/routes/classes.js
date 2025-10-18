const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Class = require('../models/Class');
const Group = require('../models/Group');
const { authenticate, requireTeacherOrAdmin, requireAdmin } = require('../middleware/auth');

// @route   GET /api/classes
// @desc    Получить занятия (с фильтрами по дате, преподавателю, группе)
// @access  Private (Teacher/Admin)
router.get('/', authenticate, requireTeacherOrAdmin, async (req, res) => {
    try {
        const { start, end, teacherId, groupId, roomId } = req.query;
        const userRole = req.user.role;
        
        let filter = {};
        
        // ✅ Преподаватель видит ВСЕ занятия (убрали фильтр по teacher)
        // Админ может фильтровать по преподавателю через параметр
        if (teacherId) {
            filter.teacher = teacherId;
        }
        
        // Фильтр по залу
        if (roomId) {
            filter.room = roomId;
        }
        
        // Фильтр по датам (для календаря)
        if (start && end) {
            // Исправляем формат даты: заменяем пробел на + перед таймзоной
            const fixedStart = start.replace(/\s(\d{2}:\d{2})$/, '+$1');
            const fixedEnd = end.replace(/\s(\d{2}:\d{2})$/, '+$1');
            
            const startDate = new Date(fixedStart);
            const endDate = new Date(fixedEnd);
            
            // Проверяем что даты валидные
            if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
                filter.date = {
                    $gte: startDate,
                    $lte: endDate
                };
            } else {
                console.error('Invalid dates after fix:', { start, end, fixedStart, fixedEnd });
            }
        }
        
        // Фильтр по группе
        if (groupId) {
            filter.group = groupId;
        }
        
        // ⚡ ОПТИМИЗАЦИЯ: Убрали populate('attendees.student') - это ОЧЕНЬ дорого!
        // Данные студентов нужны только при открытии модалки посещаемости
        // В календаре достаточно знать количество attendees
        const classes = await Class.find(filter)
            .populate('group', 'name direction maxStudents currentStudents')
            .populate('teacher', 'name')
            .populate('room', 'name color')
            .select('-attendees.student')  // Исключаем детальные данные студентов
            .sort({ date: 1, startTime: 1 })
            .lean();  // Возвращаем plain JS объекты (быстрее)
        
        res.json({
            success: true,
            count: classes.length,
            classes
        });
    } catch (error) {
        console.error('Get classes error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении занятий'
        });
    }
});

// @route   POST /api/classes
// @desc    Создать занятие
// @access  Private (Teacher/Admin)
router.post('/', authenticate, requireTeacherOrAdmin, async (req, res) => {
    try {
        const { 
            groupId,
            teacherId,  // Опциональный параметр от админа
            roomId,     // Зал
            date, 
            startTime, 
            endTime, 
            duration,
            isRecurring,
            isPractice,  // Это практика или обычное занятие
            recurringRule,
            notes
        } = req.body;
        
        if (!groupId || !date || !startTime || !endTime) {
            return res.status(400).json({
                success: false,
                error: 'Группа, дата и время обязательны'
            });
        }
        
        // Проверяем специальные типы (Аренда, Индивидуальное, Практика)
        let isSpecial = false;
        let specialTitle = '';
        
        if (groupId === 'special_rent') {
            isSpecial = true;
            specialTitle = 'Аренда зала';
        } else if (groupId === 'special_individual') {
            isSpecial = true;
            specialTitle = 'Индивидуальное занятие';
        } else if (groupId === 'special_practice') {
            isSpecial = true;
            specialTitle = 'Практика';
        }
        
        // ⚡ ОПТИМИЗАЦИЯ: Выполняем ВСЕ запросы к БД ПАРАЛЛЕЛЬНО
        const Student = require('../models/Student');
        const Room = require('../models/Room');
        
        const [group, roomData, conflict] = await Promise.all([
            // Получаем группу (только если не спец. занятие)
            isSpecial ? null : Group.findById(groupId),
            // Получаем зал
            roomId ? Room.findById(roomId) : null,
            // Проверяем конфликт по времени
            roomId ? Class.findOne({
                room: roomId,
                date: new Date(date),
                $or: [
                    { startTime: { $lte: startTime }, endTime: { $gt: startTime } },
                    { startTime: { $lt: endTime }, endTime: { $gte: endTime } },
                    { startTime: { $gte: startTime }, endTime: { $lte: endTime } }
                ]
            }) : null
        ]);
        
        // Проверки после параллельных запросов
        if (!isSpecial && !group) {
            return res.status(404).json({
                success: false,
                error: 'Группа не найдена'
            });
        }
        
        if (roomId && !roomData) {
            return res.status(404).json({
                success: false,
                error: 'Зал не найден'
            });
        }
        
        if (conflict) {
            return res.status(409).json({
                success: false,
                error: `Зал ${roomData.name} уже занят в это время (${conflict.startTime} - ${conflict.endTime})`
            });
        }
        
        // Определяем преподавателя для занятия
        let finalTeacherId;
        
        if (isSpecial) {
            finalTeacherId = teacherId || req.user._id;
        } else {
            if (teacherId && (req.user.role === 'admin' || req.user.role === 'super_admin')) {
                finalTeacherId = teacherId;
                console.log(`👨‍🏫 Админ назначил преподавателя: ${teacherId}`);
            } else {
                finalTeacherId = group.teacher || req.user._id;
            }
            
            if (req.user.role === 'teacher') {
                if (group.teacher && group.teacher.toString() !== req.user._id.toString()) {
                    return res.status(403).json({
                        success: false,
                        error: 'Вы можете создавать занятия только для своих групп'
                    });
                }
                if (!group.teacher) {
                    finalTeacherId = req.user._id;
                }
            }
        }
        
        // Получаем имя преподавателя
        const teacher = await Student.findById(finalTeacherId).select('name');
        const teacherName = teacher ? teacher.name : 'Преподаватель';
        
        // Цвет из зала
        const roomColor = roomData?.color || '#eb4d77';
        
        // Формируем title в зависимости от типа занятия
        // Формат: Направление (Преподаватель)
        // Цвет карточки уже показывает зал
        let title;
        if (isSpecial) {
            title = `${specialTitle} (${teacherName})`;
        } else {
            title = `${group.direction} (${teacherName})`;
        }
        
        const classData = {
            group: isSpecial ? null : groupId,  // Для специальных занятий group = null
            teacher: finalTeacherId,
            room: roomId || null,
            title: title,
            date: new Date(date),
            startTime,
            endTime,
            duration: duration || 90,
            isRecurring: isRecurring || false,
            isPractice: isPractice || false,  // Это практика или обычное занятие
            recurringRule: recurringRule || { frequency: 'none' },
            backgroundColor: roomColor,
            notes: notes || '',
            createdBy: req.user._id
        };
        
        // Если это повторяющееся занятие - создаем серию
        if (isRecurring && recurringRule && recurringRule.frequency !== 'none') {
            const createdClasses = await createRecurringClasses(classData);
            
            res.status(201).json({
                success: true,
                message: `Создано ${createdClasses.length} повторяющихся занятий`,
                classes: createdClasses
            });
        } else {
            // Одиночное занятие
            const newClass = await Class.create(classData);
            
            console.log(`📅 Создано занятие: ${newClass.title} - ${newClass.date.toLocaleDateString()}`);
            
            res.status(201).json({
                success: true,
                message: 'Занятие создано',
                class: newClass
            });
        }
    } catch (error) {
        console.error('Create class error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при создании занятия'
        });
    }
});

// Функция создания повторяющихся занятий
async function createRecurringClasses(baseData) {
    const classes = [];
    const { recurringRule, date } = baseData;
    const startDate = new Date(date);
    const endDate = recurringRule.endDate ? new Date(recurringRule.endDate) : new Date(startDate.getTime() + 90 * 24 * 60 * 60 * 1000); // 3 месяца по умолчанию
    
    let currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
        // Проверяем день недели для weekly
        if (recurringRule.frequency === 'weekly') {
            const dayOfWeek = currentDate.getDay();
            if (recurringRule.daysOfWeek && recurringRule.daysOfWeek.includes(dayOfWeek)) {
                const classData = {
                    ...baseData,
                    date: new Date(currentDate)
                };
                delete classData.recurringRule; // Удаляем из отдельных занятий
                
                const newClass = await Class.create(classData);
                classes.push(newClass);
            }
            currentDate.setDate(currentDate.getDate() + 1);
        } else if (recurringRule.frequency === 'daily') {
            const classData = {
                ...baseData,
                date: new Date(currentDate)
            };
            delete classData.recurringRule;
            
            const newClass = await Class.create(classData);
            classes.push(newClass);
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }
    
    return classes;
}

// @route   PATCH /api/classes/:id
// @desc    Обновить занятие (перенести, изменить время)
// @access  Private (Teacher/Admin)
router.patch('/:id', authenticate, requireTeacherOrAdmin, async (req, res) => {
    try {
        const { date, startTime, endTime, duration, status, notes, teacherId } = req.body;
        
        const classItem = await Class.findById(req.params.id);
        
        if (!classItem) {
            return res.status(404).json({
                success: false,
                error: 'Занятие не найдено'
            });
        }
        
        // Проверка прав
        if (req.user.role === 'teacher' && classItem.teacher.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                error: 'Вы можете редактировать только свои занятия'
            });
        }
        
        // Обновляем поля
        if (date) classItem.date = new Date(date);
        if (startTime) classItem.startTime = startTime;
        if (endTime) classItem.endTime = endTime;
        if (duration) classItem.duration = duration;
        if (status) classItem.status = status;
        if (notes !== undefined) classItem.notes = notes;
        
        // Обновить преподавателя (только для админов)
        if (teacherId && ['admin', 'super_admin'].includes(req.user.role)) {
            classItem.teacher = teacherId;
            console.log(`👨‍🏫 Админ изменил преподавателя занятия на: ${teacherId}`);
        }
        
        await classItem.save();
        
        console.log(`✏️ Обновлено занятие: ${classItem.title} - ${classItem.date.toLocaleDateString()}`);
        
        res.json({
            success: true,
            message: 'Занятие обновлено',
            class: classItem
        });
    } catch (error) {
        console.error('Update class error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при обновлении занятия'
        });
    }
});

// @route   DELETE /api/classes/:id
// @desc    Удалить/отменить занятие
// @access  Private (Teacher/Admin)
router.delete('/:id', authenticate, requireTeacherOrAdmin, async (req, res) => {
    try {
        const classItem = await Class.findById(req.params.id);
        
        if (!classItem) {
            return res.status(404).json({
                success: false,
                error: 'Занятие не найдено'
            });
        }
        
        // Проверка прав
        if (req.user.role === 'teacher' && classItem.teacher.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                error: 'Вы можете удалять только свои занятия'
            });
        }
        
        await classItem.deleteOne();
        
        console.log(`⚠️ Удалено занятие: ${classItem.title} - ${classItem.date.toLocaleDateString()}`);
        
        res.json({
            success: true,
            message: 'Занятие удалено'
        });
    } catch (error) {
        console.error('Delete class error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при удалении занятия'
        });
    }
});

// @route   POST /api/classes/:id/attendance
// @desc    Отметить посещаемость
// @access  Private (Teacher/Admin)
router.post('/:id/attendance', authenticate, requireTeacherOrAdmin, async (req, res) => {
    try {
        const { studentId, attended } = req.body;
        
        const classItem = await Class.findById(req.params.id);
        
        if (!classItem) {
            return res.status(404).json({
                success: false,
                error: 'Занятие не найдено'
            });
        }
        
        const Student = require('../models/Student');
        const Membership = require('../models/Membership');
        const Freeze = require('../models/Freeze');
        
        // Найти ученика с активным абонементом
        const student = await Student.findById(studentId).populate({
            path: 'activeMembership',
            populate: { path: 'group', select: '_id name' }
        });
        
        // Ищем студента в списке посещаемости
        const attendeeIndex = classItem.attendees.findIndex(
            a => a.student.toString() === studentId
        );
        
        const wasAttended = attendeeIndex >= 0 ? classItem.attendees[attendeeIndex].attended : null;
        
        if (attendeeIndex >= 0) {
            // Обновляем существующую запись
            classItem.attendees[attendeeIndex].attended = attended;
            classItem.attendees[attendeeIndex].markedAt = new Date();
        } else {
            // Добавляем нового
            classItem.attendees.push({
                student: studentId,
                attended,
                markedAt: new Date()
            });
        }
        
        await classItem.save();
        
        // ========== АВТОМАТИЧЕСКОЕ СПИСАНИЕ С АБОНЕМЕНТА ==========
        
        // Проверяем нужно ли списывать занятие
        const shouldDeduct = wasAttended === null; // Первая отметка (не было раньше)
        
        if (shouldDeduct && student && student.activeMembership && student.activeMembership.status === 'active') {
            const membership = student.activeMembership;
            const classDate = classItem.date;
            const membershipStartDate = membership.startDate || membership.createdAt;
            
            // ВАЖНО: Практики НЕ списывают занятия!
            if (classItem.isPractice) {
                console.log(`⏭️  Занятие НЕ списано: это практика`);
            }
            // ВАЖНО: Специальные занятия без группы не списывают
            else if (!classItem.group) {
                console.log(`⏭️  Занятие НЕ списано: нет группы (специальное занятие)`);
            }
            // ВАЖНО: Проверяем что абонемент для ЭТОЙ группы!
            else {
                const membershipGroupId = membership.group?._id || membership.group;
                const classGroupId = classItem.group?._id || classItem.group;
                
                if (membershipGroupId.toString() !== classGroupId.toString()) {
                    console.log(`⏭️  Занятие НЕ списано: абонемент для другой группы`);
                }
                // ВАЖНО: Нельзя списывать занятия, которые были ДО создания абонемента!
                else if (classDate < membershipStartDate) {
                    console.log(`⏭️  Занятие НЕ списано: было ДО создания абонемента (${classDate.toLocaleDateString()} < ${membershipStartDate.toLocaleDateString()})`);
                } else {
                    console.log(`💳 Проверка списания для ${student.name}: ${attended ? 'присутствовал' : 'отсутствовал'}`);
                    
                    // Проверить есть ли активная заморозка на эту дату
                    let activeFreeze = await Freeze.findOne({
                        student: studentId,
                        membership: membership._id,
                        status: 'active',
                        startDate: { $lte: classDate },
                        endDate: { $gte: classDate }
                    });
                    
                    // Дополнительная проверка: есть ли еще доступные замороженные занятия
                    if (activeFreeze && activeFreeze.classesUsed >= activeFreeze.frozenClasses) {
                        // Все замороженные занятия использованы
                        activeFreeze = null;
                    }
                    
                    if (activeFreeze) {
                        // Есть заморозка - НЕ списываем, но отмечаем использование заморозки
                        await activeFreeze.useClass();
                        console.log(`🧊 Занятие не списано - активна заморозка ${activeFreeze.type}`);
                    } else {
                        // Нет заморозки - списываем занятие
                        // Независимо от того, пришёл или нет!
                        await membership.deductClass(classItem._id, attended ? 'Занятие посещено' : 'Занятие пропущено');
                        console.log(`➖ Списано занятие с абонемента. Осталось: ${membership.classesRemaining}`);
                    }
                }
            }
        }
        
        res.json({
            success: true,
            message: 'Посещаемость отмечена',
            class: classItem
        });
    } catch (error) {
        console.error('Mark attendance error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при отметке посещаемости'
        });
    }
});

// @route   POST /api/classes/auto-deduct
// @desc    Автоматическое списание занятий для всех прошедших занятий
// @access  Private (Admin/System)
router.post('/auto-deduct', authenticate, requireAdmin, async (req, res) => {
    try {
        const Membership = require('../models/Membership');
        const Freeze = require('../models/Freeze');
        const Group = require('../models/Group');
        const Student = require('../models/Student');
        
        const now = new Date();
        
        // Найти ВСЕ прошедшие занятия (НЕ практики)
        const pastClasses = await Class.find({
            group: { $ne: null },
            isPractice: { $ne: true }
        }).populate('group');
        
        // Фильтруем только те, которые РЕАЛЬНО закончились (по времени окончания)
        const reallyPastClasses = [];
        for (const cls of pastClasses) {
            const classDate = new Date(cls.date);
            const [endHours, endMinutes] = cls.endTime.split(':');
            classDate.setHours(parseInt(endHours), parseInt(endMinutes), 0, 0);
            
            if (classDate < now) {
                reallyPastClasses.push(cls);
            }
        }
        
        console.log(`🔍 Найдено прошедших занятий: ${reallyPastClasses.length}`);
        
        let totalDeducted = 0;
        let totalFrozen = 0;
        let totalAlready = 0;
        let totalSkipped = 0;
        
        for (const classItem of reallyPastClasses) {
            if (!classItem.group || !classItem.group._id) continue;
            
            // Найти всех учеников группы
            const students = await Student.find({
                'groups.groupId': classItem.group._id,
                'groups.status': 'active'
            }).populate({
                path: 'activeMembership',
                populate: { path: 'group', select: '_id name' }
            });
            
            for (const student of students) {
                // Проверить, не было ли уже списано
                const alreadyMarked = classItem.attendees.some(
                    a => a.student.toString() === student._id.toString()
                );
                
                if (alreadyMarked) {
                    totalAlready++;
                    continue;
                }
                
                // Проверить активный абонемент
                const membership = student.activeMembership;
                if (!membership || membership.status !== 'active') {
                    console.log(`  ⏭️  Пропущен ${student.name}: нет активного абонемента`);
                    totalSkipped++;
                    continue;
                }
                
                // ВАЖНО: Проверяем что абонемент для ЭТОЙ группы!
                const membershipGroupId = membership.group?._id || membership.group;
                const classGroupId = classItem.group?._id || classItem.group;
                
                if (membershipGroupId.toString() !== classGroupId.toString()) {
                    console.log(`  ⏭️  Пропущен ${student.name}: абонемент для другой группы`);
                    totalSkipped++;
                    continue;
                }
                
                // ВАЖНО: Нельзя списывать занятия, которые были ДО создания абонемента!
                // Сравниваем только ДАТЫ (без времени)
                const membershipStartDate = membership.startDate || membership.createdAt;
                const classDateOnly = new Date(classItem.date);
                classDateOnly.setHours(0, 0, 0, 0);
                const membershipDateOnly = new Date(membershipStartDate);
                membershipDateOnly.setHours(0, 0, 0, 0);
                
                if (classDateOnly < membershipDateOnly) {
                    console.log(`  ⏭️  Пропущен ${student.name}: занятие было ДО абонемента (${classItem.date.toLocaleDateString()} < ${membershipStartDate.toLocaleDateString()})`);
                    totalSkipped++;
                    continue;
                }
                
                // Проверить заморозку
                let activeFreeze = await Freeze.findOne({
                    student: student._id,
                    membership: membership._id,
                    status: 'active',
                    startDate: { $lte: classItem.date },
                    endDate: { $gte: classItem.date }
                });
                
                // Проверить есть ли еще доступные замороженные занятия
                if (activeFreeze && activeFreeze.classesUsed >= activeFreeze.frozenClasses) {
                    activeFreeze = null;
                }
                
                if (activeFreeze) {
                    // Использовать заморозку
                    await activeFreeze.useClass();
                    totalFrozen++;
                    console.log(`🧊 Заморозка применена: ${student.name} - ${classItem.title}`);
                } else {
                    // Списать занятие
                    await membership.deductClass(classItem._id, 'Автоматическое списание (занятие прошло)');
                    totalDeducted++;
                    console.log(`➖ Списано: ${student.name} - ${classItem.title}`);
                }
                
                // Добавить запись в attendance как "отсутствовал"
                classItem.attendees.push({
                    student: student._id,
                    attended: false,
                    markedAt: new Date(),
                    autoDeducted: true
                });
            }
            
            await classItem.save();
        }
        
        console.log(`📊 Итого: ${reallyPastClasses.length} занятий, ${totalDeducted} списано, ${totalFrozen} заморожено, ${totalAlready} уже отмечено, ${totalSkipped} пропущено`);
        
        res.json({
            success: true,
            message: 'Автоматическое списание выполнено',
            stats: {
                totalClasses: reallyPastClasses.length,
                deducted: totalDeducted,
                frozen: totalFrozen,
                alreadyMarked: totalAlready,
                skipped: totalSkipped
            }
        });
    } catch (error) {
        console.error('Auto deduct error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при автоматическом списании'
        });
    }
});

// @route   GET /api/classes/pending-attendance/count
// @desc    Получить количество занятий, требующих отметки посещаемости
// @access  Private (Teacher/Admin)
router.get('/pending-attendance/count', authenticate, requireTeacherOrAdmin, async (req, res) => {
    try {
        const userRole = req.user.role;
        const now = new Date();
        
        // Берем все занятия за последние 30 дней + сегодня
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        thirtyDaysAgo.setHours(0, 0, 0, 0);
        
        let filter = {
            date: { $gte: thirtyDaysAgo },  // За последние 30 дней
            group: { $ne: null }   // Только занятия с группами (исключаем Аренду, Индивидуальные)
        };
        
        // Если преподаватель - только его занятия
        if (userRole === 'teacher') {
            filter.teacher = req.user._id;
        }
        
        // Найти все занятия
        // ⚡ ОПТИМИЗАЦИЯ: Убрали populate('attendees.student') - имена не нужны для подсчета
        const classes = await Class.find(filter)
            .populate('group', 'name currentStudents')
            .select('-attendees.student')  // Исключаем детали студентов
            .lean();  // Plain JS объекты для скорости
        
        // Подсчитать занятия где посещаемость не отмечена
        // Занятие считается неотмеченным если:
        // 1. Занятие закончилось (дата + время окончания < now)
        // 2. В группе есть ученики (currentStudents > 0)
        // 3. НИ ОДИН ученик не отмечен с attended=true
        let pendingCount = 0;
        
        for (const cls of classes) {
            // Пропускаем если нет группы
            if (!cls.group) {
                continue;
            }
            
            // Пропускаем если в группе нет учеников
            const groupStudentsCount = cls.group.currentStudents || 0;
            if (groupStudentsCount === 0) {
                continue;
            }
            
            // Проверяем что занятие действительно прошло (с учетом времени окончания)
            const classDate = new Date(cls.date);
            const [hours, minutes] = cls.endTime.split(':');
            classDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
            
            // Пропускаем будущие занятия (которые еще не закончились)
            if (classDate > now) {
                continue;
            }
            
            // Проверяем есть ли хоть один ученик с attended: true
            const attendedStudents = cls.attendees ? cls.attendees.filter(a => a.attended === true).length : 0;
            const hasAnyAttendance = attendedStudents > 0;
            
            // Если НИ ОДИН ученик не отмечен как присутствовавший - требуется отметка
            if (!hasAnyAttendance) {
                pendingCount++;
            }
        }
        
        res.json({
            success: true,
            count: pendingCount
        });
    } catch (error) {
        console.error('Get pending attendance count error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении количества неотмеченных занятий'
        });
    }
});

// @route   POST /api/classes/generate-from-schedule
// @desc    Автоматическая генерация занятий на основе расписания групп
// @access  Private (Admin only)
router.post('/generate-from-schedule', authenticate, requireAdmin, async (req, res) => {
    try {
        const { period, roomId } = req.body; // 'week' или 'month' и обязательный roomId
        
        if (!period || !['week', 'month'].includes(period)) {
            return res.status(400).json({
                success: false,
                error: 'Необходимо указать период: week или month'
            });
        }
        
        if (!roomId) {
            return res.status(400).json({
                success: false,
                error: 'Необходимо указать зал (roomId)'
            });
        }
        
        // Проверяем что зал существует
        const Room = require('../models/Room');
        const selectedRoom = await Room.findById(roomId);
        if (!selectedRoom) {
            return res.status(400).json({
                success: false,
                error: 'Указанный зал не найден'
            });
        }
        
        // Получаем все активные группы с расписанием
        const groups = await Group.find({ isActive: true })
            .populate('teacher', 'name')
            .select('name direction schedule teacher');
        
        if (groups.length === 0) {
            return res.json({
                success: true,
                message: 'Нет активных групп с расписанием',
                created: 0
            });
        }
        
        // Определяем период генерации
        const startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(startDate);
        if (period === 'week') {
            endDate.setDate(endDate.getDate() + 7);
        } else {
            endDate.setDate(endDate.getDate() + 30);
        }
        
        const createdClasses = [];
        const skippedClasses = [];
        
        // Для каждой группы генерируем занятия
        for (const group of groups) {
            if (!group.schedule || group.schedule.length === 0) {
                continue;
            }
            
            // Проверяем что у группы есть преподаватель
            if (!group.teacher) {
                console.log(`⚠️  Группа "${group.name}" не имеет преподавателя. Пропускаем.`);
                continue;
            }
            
            // Для каждого слота расписания
            for (const scheduleItem of group.schedule) {
                const { dayOfWeek, time, duration, isPractice } = scheduleItem;
                // Используем выбранный зал вместо зала из расписания
                
                // Генерируем занятия на каждый день соответствующий dayOfWeek
                let currentDate = new Date(startDate);
                
                // Находим первый день недели соответствующий dayOfWeek
                while (currentDate < endDate) {
                    const currentDayOfWeek = currentDate.getDay() === 0 ? 7 : currentDate.getDay();
                    
                    if (currentDayOfWeek === dayOfWeek) {
                        // Проверяем нет ли уже занятия в это время
                        const [hours, minutes] = time.split(':');
                        const classStartTime = time;
                        
                        // Вычисляем время окончания
                        const endHours = parseInt(hours) + Math.floor(duration / 60);
                        const endMinutes = parseInt(minutes) + (duration % 60);
                        const classEndTime = `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
                        
                        // Проверяем конфликт
                        const existingClass = await Class.findOne({
                            date: currentDate,
                            $or: [
                                {
                                    $and: [
                                        { startTime: { $lte: classStartTime } },
                                        { endTime: { $gt: classStartTime } }
                                    ]
                                },
                                {
                                    $and: [
                                        { startTime: { $lt: classEndTime } },
                                        { endTime: { $gte: classEndTime } }
                                    ]
                                },
                                {
                                    $and: [
                                        { startTime: { $gte: classStartTime } },
                                        { endTime: { $lte: classEndTime } }
                                    ]
                                }
                            ],
                            teacher: group.teacher._id
                        });
                        
                        if (existingClass) {
                            skippedClasses.push({
                                group: group.name,
                                date: currentDate.toISOString().split('T')[0],
                                time: classStartTime,
                                reason: 'Занятие уже существует'
                            });
                        } else {
                            // Используем цвет выбранного зала
                            const roomColor = selectedRoom.color || '#eb4d77';
                            
                            // Создаем занятие с выбранным залом
                            const newClass = await Class.create({
                                group: group._id,
                                teacher: group.teacher._id,
                                room: roomId,  // Используем выбранный зал
                                title: group.name,
                                date: currentDate,
                                startTime: classStartTime,
                                endTime: classEndTime,
                                duration: duration,
                                status: 'scheduled',
                                isPractice: isPractice || false,
                                isRecurring: false,
                                backgroundColor: roomColor,
                                notes: `Автоматически создано из расписания группы (${selectedRoom.name})`
                            });
                            
                            createdClasses.push({
                                group: group.name,
                                date: currentDate.toISOString().split('T')[0],
                                time: classStartTime
                            });
                            
                            console.log(`✅ Создано занятие: ${group.name} - ${currentDate.toLocaleDateString()} ${classStartTime}`);
                        }
                    }
                    
                    currentDate.setDate(currentDate.getDate() + 1);
                }
            }
        }
        
        res.json({
            success: true,
            message: `Создано ${createdClasses.length} занятий${skippedClasses.length > 0 ? `, пропущено ${skippedClasses.length}` : ''}`,
            created: createdClasses.length,
            skipped: skippedClasses.length,
            details: {
                createdClasses,
                skippedClasses
            }
        });
        
    } catch (error) {
        console.error('Generate classes from schedule error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при генерации занятий'
        });
    }
});

module.exports = router;

