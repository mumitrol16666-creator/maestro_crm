const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireAdmin, requireSalesOrAdmin, requireNotStudent, requireSuperAdmin } = require('../middleware/auth');
const { cacheUtils } = require('../config/redis');
const {
    CONFIRMATION_PHRASE,
    getOperationalResetPreview,
    resetOperationalData,
} = require('../services/operationalReset');

// Функция для очистки кэша (экспортируем для использования в других модулях)
function clearStatsCache() {
    cacheUtils.delPattern('admin:stats:*');
    console.log('🗑️  Redis кэш статистики дашборда очищен');
}

function formatAdminFio(person, fallback = '') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

// @route GET /api/admin/operational-reset/preview
// @desc  Показать объём аварийной очистки без изменения данных
// @access Private/Super Admin
router.get('/operational-reset/preview', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const preview = await getOperationalResetPreview();
        res.json({ success: true, preview });
    } catch (error) {
        console.error('Operational reset preview error:', error);
        res.status(500).json({ success: false, error: 'Не удалось подготовить предварительный просмотр очистки' });
    }
});

// @route POST /api/admin/operational-reset
// @desc  Сделать резервную копию и удалить операционные тестовые данные
// @access Private/Super Admin
router.post('/operational-reset', authenticate, requireSuperAdmin, async (req, res) => {
    if (req.user?.isDemoUser) {
        return res.status(403).json({
            success: false,
            error: 'Очистка недоступна в демонстрационном режиме',
        });
    }

    if (req.body?.confirmation !== CONFIRMATION_PHRASE) {
        return res.status(400).json({
            success: false,
            error: `Для подтверждения введите точную фразу: ${CONFIRMATION_PHRASE}`,
        });
    }

    try {
        const result = await resetOperationalData();
        await Promise.all([
            cacheUtils.delPattern('admin:stats:*'),
            cacheUtils.delPattern('activity_logs:*'),
        ]);
        res.json({
            success: true,
            message: 'Операционные данные очищены. Аккаунты, заявки и настройки сохранены.',
            result,
        });
    } catch (error) {
        console.error('Operational reset error:', error);
        const status = error.code === 'RESET_IN_PROGRESS' ? 409 : 500;
        res.status(status).json({
            success: false,
            error: error.code === 'RESET_IN_PROGRESS'
                ? error.message
                : `Очистка отменена: ${error.message}`,
        });
    }
});

// @route   GET /api/admin/stats
// @desc    Получить статистику для дашборда
// @access  Private (все, кроме студентов)
router.get('/stats', authenticate, requireNotStudent, async (req, res) => {
    try {
        const userRole = req.user.role;
        const userId = req.user.id;
        
        // 🚀 Redis кэширование
        const cacheKey = `admin:stats:${userRole}:${userId}`;
        const cachedData = await cacheUtils.get(cacheKey);
        if (cachedData) {
            console.log('📦 Cache HIT for admin stats');
            return res.json(cachedData);
        }
        console.log('🔄 Cache MISS for admin stats - fetching from DB');
        
        // Доход за текущий месяц
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        
        // ⚡ ОПТИМИЗАЦИЯ: Выполняем запросы последовательно или малыми порциями, 
        // чтобы не забивать пул коннектов Prisma (что вызывает долгое подвисание)
        const totalStudents = await prisma.student.count({ where: { status: 'active', role: 'student' } });
        const totalGroups = await prisma.group.count({ where: { isActive: true } });
        const newBookings = await prisma.booking.count({ where: { status: 'new' } });
        const activeMemberships = await prisma.membership.count({ where: { status: 'active' } });
        
        const monthlyPayments = await prisma.payment.aggregate({
            where: { status: 'completed', paymentDate: { gte: startOfMonth } },
            _sum: { amount: true }
        });
        
        const enrolledThisMonth = await prisma.booking.count({
            where: { status: 'trial', processedAt: { gte: startOfMonth } }
        });
        
        const directionStats = await prisma.group.groupBy({
            by: ['direction'],
            where: { isActive: true },
            _sum: { currentStudents: true },
            _count: { id: true }
        });
        
        const recentBookings = await prisma.booking.findMany({
            orderBy: { createdAt: 'desc' },
            take: 5
        });
        
        const totalDebt = await prisma.student.aggregate({
            where: { role: 'student', accountBalance: { lt: 0 } },
            _sum: { accountBalance: true }
        });
        
                const monthlyRevenue = monthlyPayments._sum.amount || 0;
        const totalDebtAmount = Math.abs(totalDebt._sum.accountBalance || 0);
        const overdueAmount = 0;
        const overdueCount = 0;
        
        // Форматируем directionStats для совместимости с фронтендом
        const formattedDirectionStats = directionStats.map(d => ({
            _id: d.direction,
            totalStudents: d._sum.currentStudents || 0,
            groupsCount: d._count.id
        })).sort((a, b) => b.totalStudents - a.totalStudents);
        
        // Маппим recentBookings для фронтенда
        const mappedRecentBookings = recentBookings.map(b => ({ ...b, _id: b.id }));
        
        // 👨‍🏫 ДЛЯ ПРЕПОДАВАТЕЛЯ: Подсчет посещений в этом месяце
        let teacherAttendanceCount = 0;
        if (userRole === 'teacher') {
            const teacherClasses = await prisma.class.findMany({
                where: {
                    teacherId: userId,
                    date: { gte: startOfMonth, lt: new Date() }
                },
                include: {
                    attendees: true
                }
            });
            
            teacherClasses.forEach(cls => {
                const presentCount = cls.attendees.filter(a => a.attended === true).length;
                teacherAttendanceCount += presentCount;
            });
        }
        
        const stats = {
            totalStudents,
            totalGroups,
            newBookings,
            activeMemberships,
            monthlyRevenue,
            enrolledThisMonth,
            directionStats: formattedDirectionStats,
            recentBookings: mappedRecentBookings,
            // 🔴 ДОЛГИ
            totalDebt: totalDebtAmount,
            overdueAmount,
            overdueCount,
            // 👨‍🏫 ДЛЯ ПРЕПОДАВАТЕЛЯ
            teacherAttendanceCount
        };
        
        // Сохраняем в кэш
        const responseData = { success: true, stats };
        
        // 🚀 Кэшируем результат на 2 минуты
        await cacheUtils.set(cacheKey, responseData, 120);
        console.log('💾 Cached admin stats data');
        
        res.json(responseData);
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({
            error: 'Ошибка при получении статистики'
        });
    }
});

// @route GET /api/admin/operations
// @desc  Операционная очередь администратора: что требует внимания сейчас
router.get('/operations', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const now = new Date();
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const tomorrow = new Date(todayStart);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        const [
            newBookingsCount,
            pendingReviewCount,
            notFilledCount,
            todayClassesCount,
            expiringMembershipsCount,
            debtMembershipsCount,
            newBookings,
            pendingReview,
            notFilled,
            todayClasses,
            expiringMemberships,
            debtMemberships,
        ] = await Promise.all([
            prisma.booking.count({ where: { status: 'new' } }),
            prisma.class.count({ where: { isPractice: false, status: 'pending_admin_review' } }),
            prisma.class.count({
                where: {
                    isPractice: false,
                    status: { in: ['not_filled', 'scheduled', 'started'] },
                    OR: [
                        { date: { lt: todayStart } },
                        { date: { gte: todayStart, lt: tomorrow }, endTime: { lt: currentTime } },
                    ],
                },
            }),
            prisma.class.count({ where: { isPractice: false, status: { not: 'cancelled' }, date: { gte: todayStart, lt: tomorrow } } }),
            prisma.student.count({
                where: {
                    role: 'student',
                    status: 'active',
                    accountBalance: { gte: 0, lte: 4000 },
                },
            }),
            prisma.student.count({ where: { role: 'student', accountBalance: { lt: 0 } } }),
            prisma.booking.findMany({
                where: { status: 'new' },
                orderBy: { createdAt: 'asc' },
                take: 8,
                select: { id: true, name: true, lastName: true, middleName: true, phone: true, direction: true, source: true, createdAt: true, appStatus: true },
            }),
            prisma.class.findMany({
                where: { isPractice: false, status: 'pending_admin_review' },
                orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
                take: 8,
                include: {
                    teacher: { select: { name: true, lastName: true, middleName: true } },
                    group: { select: { name: true } },
                    individualStudent: { select: { name: true, lastName: true, middleName: true } },
                },
            }),
            prisma.class.findMany({
                where: {
                    isPractice: false,
                    status: { in: ['not_filled', 'scheduled', 'started'] },
                    OR: [
                        { date: { lt: todayStart } },
                        { date: { gte: todayStart, lt: tomorrow }, endTime: { lt: currentTime } },
                    ],
                },
                orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
                take: 8,
                include: { teacher: { select: { name: true, lastName: true, middleName: true } }, group: { select: { name: true } } },
            }),
            prisma.class.findMany({
                where: { isPractice: false, status: { not: 'cancelled' }, date: { gte: todayStart, lt: tomorrow } },
                orderBy: { startTime: 'asc' },
                take: 12,
                include: {
                    teacher: { select: { name: true, lastName: true, middleName: true } },
                    group: { select: { name: true } },
                    room: { select: { name: true } },
                    individualStudent: { select: { name: true, lastName: true, middleName: true } },
                },
            }),
            prisma.student.findMany({
                where: {
                    role: 'student',
                    status: 'active',
                    accountBalance: { gte: 0, lte: 4000 },
                },
                orderBy: { accountBalance: 'asc' },
                take: 8,
                select: { id: true, name: true, lastName: true, middleName: true, phone: true, accountBalance: true },
            }),
            prisma.student.findMany({
                where: { role: 'student', accountBalance: { lt: 0 } },
                orderBy: { accountBalance: 'asc' },
                take: 8,
                select: { id: true, name: true, lastName: true, middleName: true, phone: true, accountBalance: true },
            }),
        ]);

        const teacherName = (teacher) => formatAdminFio(teacher) || null;
        const studentName = (student) => formatAdminFio(student) || null;
        const mapClass = (cls) => ({
            id: cls.id,
            title: cls.title,
            date: cls.date,
            startTime: cls.startTime,
            endTime: cls.endTime,
            status: cls.status,
            teacherName: teacherName(cls.teacher),
            audienceName: cls.group?.name || studentName(cls.individualStudent) || 'Без группы',
            roomName: cls.room?.name || null,
        });

        res.json({
            success: true,
            data: {
                generatedAt: now,
                counts: {
                    newBookings: newBookingsCount,
                    pendingReview: pendingReviewCount,
                    notFilled: notFilledCount,
                    todayClasses: todayClassesCount,
                    expiringMemberships: expiringMembershipsCount,
                    debtMemberships: debtMembershipsCount,
                },
                newBookings: newBookings.map((item) => ({ ...item, _id: item.id })),
                pendingReview: pendingReview.map(mapClass),
                notFilled: notFilled.map(mapClass),
                todayClasses: todayClasses.map(mapClass),
                expiringMemberships: expiringMemberships.map((student) => ({
                    id: student.id,
                    studentId: student.id,
                    studentName: studentName(student),
                    phone: student.phone,
                    remainingAmount: student.accountBalance,
                })),
                debtMemberships: debtMemberships.map((student) => ({
                    id: student.id,
                    studentId: student.id,
                    studentName: studentName(student),
                    phone: student.phone,
                    remainingAmount: student.accountBalance,
                })),
            },
        });
    } catch (error) {
        console.error('Get operations dashboard error:', error);
        res.status(500).json({ success: false, error: 'Не удалось загрузить рабочий стол' });
    }
});

function reminderStudentName(student) {
    return formatAdminFio(student, 'Ученик');
}

function reminderLessonSubject(classRecord) {
    return classRecord.group?.direction
        || classRecord.individualStudent?.learningDirections?.[0]
        || classRecord.title
        || 'занятию';
}

function mapReminderLessons(classes, kind) {
    const reminders = [];
    const seen = new Set();

    for (const classRecord of classes) {
        const students = [];
        if (classRecord.individualStudent) students.push(classRecord.individualStudent);
        for (const attendee of classRecord.attendees || []) {
            if (attendee.student) students.push(attendee.student);
        }
        for (const member of classRecord.group?.students || []) {
            if (member.student) students.push(member.student);
        }

        for (const student of students) {
            const key = `${kind}:${classRecord.id}:${student.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            reminders.push({
                id: key,
                classId: classRecord.id,
                studentId: student.id,
                studentName: reminderStudentName(student),
                phone: student.phone,
                date: classRecord.date,
                startTime: classRecord.startTime,
                endTime: classRecord.endTime,
                subject: reminderLessonSubject(classRecord),
                lessonType: classRecord.classType,
                groupName: classRecord.group?.name || null,
                roomName: classRecord.room?.name || null,
                topic: classRecord.topic || null,
                homework: classRecord.homeworkDraft || null,
            });
        }
    }

    return reminders;
}

// @route GET /api/admin/whatsapp-reminders
// @desc  Очередь ручных WhatsApp-напоминаний с готовыми текстами
// @access Private/Admin
router.get('/whatsapp-reminders', authenticate, requireAdmin, async (req, res) => {
    try {
        const now = new Date();
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const tomorrowStart = new Date(todayStart);
        tomorrowStart.setDate(tomorrowStart.getDate() + 1);
        const dayAfterTomorrow = new Date(tomorrowStart);
        dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        const lessonInclude = {
            individualStudent: {
                select: {
                    id: true,
                    name: true,
                    lastName: true,
                    middleName: true,
                    phone: true,
                    learningDirections: true,
                },
            },
            attendees: {
                include: {
                    student: {
                        select: { id: true, name: true, lastName: true, middleName: true, phone: true },
                    },
                },
            },
            group: {
                select: {
                    id: true,
                    name: true,
                    direction: true,
                    students: {
                        where: { status: 'active' },
                        include: {
                            student: {
                                select: { id: true, name: true, lastName: true, middleName: true, phone: true },
                            },
                        },
                    },
                },
            },
            room: { select: { name: true } },
        };

        const dayKey = todayStart.toISOString().slice(0, 10);
        const sevenDaysAgo = new Date(todayStart);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const [todayClasses, tomorrowClasses, oneLessonMemberships, plannedContacts, completedClasses] = await Promise.all([
            prisma.class.findMany({
                where: {
                    isPractice: false,
                    status: { in: ['scheduled', 'started', 'not_filled'] },
                    date: { gte: todayStart, lt: tomorrowStart },
                    endTime: { gte: currentTime },
                },
                include: lessonInclude,
                orderBy: { startTime: 'asc' },
            }),
            prisma.class.findMany({
                where: {
                    isPractice: false,
                    status: { in: ['scheduled', 'started', 'not_filled'] },
                    date: { gte: tomorrowStart, lt: dayAfterTomorrow },
                },
                include: lessonInclude,
                orderBy: { startTime: 'asc' },
            }),
            prisma.membership.findMany({
                where: {
                    status: 'active',
                    classesRemaining: 1,
                    student: { role: 'student', status: 'active' },
                },
                include: {
                    student: {
                        select: {
                            id: true,
                            name: true,
                            lastName: true,
                            middleName: true,
                            phone: true,
                            accountBalance: true,
                            learningDirections: true,
                        },
                    },
                    group: { select: { name: true, direction: true } },
                    plan: { select: { name: true } },
                },
                orderBy: { updatedAt: 'desc' },
            }),
            prisma.membership.findMany({
                where: {
                    status: 'active',
                    followUpStatus: { not: 'closed' },
                    followUpAt: { not: null },
                    student: { role: 'student', status: 'active' },
                },
                include: {
                    student: {
                        select: {
                            id: true,
                            name: true,
                            lastName: true,
                            phone: true,
                            accountBalance: true,
                        },
                    },
                    group: { select: { name: true, direction: true } },
                    plan: { select: { name: true } },
                },
                orderBy: { followUpAt: 'asc' },
            }),
            prisma.class.findMany({
                where: {
                    isPractice: false,
                    status: 'completed',
                    date: { gte: sevenDaysAgo, lt: tomorrowStart },
                },
                include: lessonInclude,
                orderBy: { date: 'desc' },
            }),
        ]);

        const today = mapReminderLessons(todayClasses, 'today');
        const tomorrow = mapReminderLessons(tomorrowClasses, 'tomorrow');
        const oneLesson = oneLessonMemberships.map((membership) => ({
            id: `oneLesson:${dayKey}:${membership.id}`,
            membershipId: membership.id,
            studentId: membership.studentId,
            studentName: reminderStudentName(membership.student),
            phone: membership.student.phone,
            accountBalance: membership.student.accountBalance,
            classesRemaining: membership.classesRemaining,
            subject: membership.group?.direction
                || membership.plan?.name
                || membership.group?.name
                || membership.student.learningDirections?.[0]
                || 'занятия',
        }));
        const tasks = plannedContacts.map((membership) => ({
            id: `tasks:${membership.followUpAt.toISOString().slice(0, 10)}:${membership.id}`,
            membershipId: membership.id,
            studentId: membership.studentId,
            studentName: reminderStudentName(membership.student),
            phone: membership.student.phone,
            followUpAt: membership.followUpAt,
            followUpStatus: membership.followUpStatus,
            followUpNote: membership.followUpNote,
            paymentPromiseDate: membership.paymentPromiseDate,
            classesRemaining: membership.classesRemaining,
            accountBalance: membership.student.accountBalance,
            subject: membership.group?.direction || membership.plan?.name || membership.group?.name || 'обучение',
        }));
        const homework = mapReminderLessons(completedClasses, 'homework').filter(
            (item) => item.topic || item.homework
        );

        const allItems = [...today, ...tomorrow, ...oneLesson, ...tasks, ...homework];
        const sentRows = allItems.length
            ? await prisma.activityLog.findMany({
                where: {
                    entityType: 'WhatsAppReminder',
                    action: 'sent',
                    entityId: { in: allItems.map(item => item.id) },
                },
                select: { entityId: true },
            })
            : [];
        const sentIds = new Set(sentRows.map(row => row.entityId));
        const pending = list => list.filter(item => !sentIds.has(item.id));
        const pendingToday = pending(today);
        const pendingTomorrow = pending(tomorrow);
        const pendingOneLesson = pending(oneLesson);
        const pendingTasks = pending(tasks);
        const pendingHomework = pending(homework);

        res.json({
            success: true,
            generatedAt: now,
            counts: {
                today: pendingToday.length,
                tomorrow: pendingTomorrow.length,
                homework: pendingHomework.length,
                oneLesson: pendingOneLesson.length,
                tasks: pendingTasks.length,
                total: pendingToday.length + pendingTomorrow.length + pendingHomework.length + pendingOneLesson.length + pendingTasks.length,
            },
            today: pendingToday,
            tomorrow: pendingTomorrow,
            homework: pendingHomework,
            oneLesson: pendingOneLesson,
            tasks: pendingTasks,
        });
    } catch (error) {
        console.error('Get WhatsApp reminders error:', error);
        res.status(500).json({ success: false, error: 'Не удалось собрать WhatsApp-напоминания' });
    }
});

router.post('/whatsapp-reminders/sent', authenticate, requireAdmin, async (req, res) => {
    try {
        const kind = String(req.body?.kind || '');
        const itemId = String(req.body?.itemId || '');
        const studentId = String(req.body?.studentId || '');
        if (!['today', 'tomorrow', 'oneLesson', 'tasks', 'homework'].includes(kind) || !itemId || !studentId) {
            return res.status(400).json({ success: false, error: 'Некорректное напоминание' });
        }

        const existing = await prisma.activityLog.findFirst({
            where: { entityType: 'WhatsAppReminder', action: 'sent', entityId: itemId },
            select: { id: true },
        });
        if (!existing) {
            const student = await prisma.student.findUnique({
                where: { id: studentId },
                select: { name: true, lastName: true, middleName: true },
            });
            const studentName = formatAdminFio(student, 'Ученик');
            const reminderLabels = {
                today: 'Сегодня урок',
                tomorrow: 'Завтра урок',
                homework: 'Домашнее задание',
                oneLesson: 'Оплата',
                tasks: 'Запланированный контакт',
            };
            const reminderLabel = reminderLabels[kind];
            await prisma.activityLog.create({
                data: {
                    userId: req.user.id,
                    action: 'sent',
                    entityType: 'WhatsAppReminder',
                    entityId: itemId,
                    details: `${studentName} — Рассылка — ${reminderLabel}`,
                    metadata: { kind, studentId, studentName, reminderLabel },
                },
            });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Mark WhatsApp reminder sent error:', error);
        res.status(500).json({ success: false, error: 'Не удалось отметить напоминание отправленным' });
    }
});

// @route   GET /api/admin/expiring-memberships
// @desc    Получить абонементы которые скоро истекут
// @access  Private/Admin
router.get('/expiring-memberships', authenticate, requireAdmin, async (req, res) => {
    try {
        const memberships = await prisma.membership.findMany({
            where: {
                status: 'active',
                student: {
                    role: 'student',
                    status: 'active',
                    accountBalance: { gte: 0, lte: 4000 },
                },
            },
            include: {
                student: { select: { id: true, name: true, lastName: true, middleName: true, phone: true } },
                group: { select: { id: true, name: true } }
            },
            orderBy: { classesRemaining: 'asc' }
        });
        
        // Маппим для совместимости с фронтендом
        const mapped = memberships.map(m => ({
            ...m,
            _id: m.id,
            student: m.student ? { ...m.student, _id: m.student.id } : null,
            group: m.group ? { ...m.group, _id: m.group.id } : null
        }));
        
        res.json({
            success: true,
            count: mapped.length,
            memberships: mapped
        });
    } catch (error) {
        console.error('Get expiring memberships error:', error);
        res.status(500).json({
            error: 'Ошибка при получении истекающих абонементов'
        });
    }
});

// @route GET /api/admin/membership-actions
// @desc  Очередь оплат и продлений с результатами контакта
router.get('/membership-actions', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { kind = 'all', followUpStatus = 'all', search = '' } = req.query;
        const attentionCondition = kind === 'debt'
            ? { student: { accountBalance: { lt: 0 } } }
            : kind === 'renewal'
                ? { student: { accountBalance: { gte: 0, lte: 4000 } } }
                : { student: { accountBalance: { lte: 4000 } } };

        const memberships = await prisma.membership.findMany({
            where: {
                status: 'active',
                ...attentionCondition,
                ...(followUpStatus !== 'all' ? { followUpStatus } : {}),
                ...(search ? {
                    student: {
                        OR: [
                            { name: { contains: search, mode: 'insensitive' } },
                            { lastName: { contains: search, mode: 'insensitive' } },
                            { phone: { contains: search } },
                        ],
                    },
                } : {}),
            },
            include: {
                student: { select: { id: true, name: true, lastName: true, middleName: true, phone: true, accountBalance: true } },
                group: { select: { name: true } },
                teacher: { select: { name: true, lastName: true, middleName: true } },
                plan: { select: { name: true } },
            },
            orderBy: [
                { followUpAt: 'asc' },
                { updatedAt: 'asc' },
            ],
        });

        const counts = await prisma.membership.groupBy({
            by: ['followUpStatus'],
            where: {
                status: 'active',
                student: { accountBalance: { lte: 4000 } },
            },
            _count: { id: true },
        });

        res.json({
            success: true,
            counts: counts.reduce((result, item) => {
                result[item.followUpStatus] = item._count.id;
                return result;
            }, {}),
            memberships: memberships.map((membership) => ({
                ...membership,
                _id: membership.id,
                studentName: formatAdminFio(membership.student),
                teacherName: membership.teacher
                    ? formatAdminFio(membership.teacher)
                    : null,
                remainingAmount: membership.student.accountBalance,
            })),
        });
    } catch (error) {
        console.error('Get membership actions error:', error);
        res.status(500).json({ success: false, error: 'Не удалось загрузить оплаты и продления' });
    }
});

// @route PATCH /api/admin/membership-actions/:id
// @desc  Зафиксировать результат контакта по абонементу
router.patch('/membership-actions/:id', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const allowedStatuses = new Set(['new', 'contacted', 'promised', 'closed']);
        const { followUpStatus, followUpNote, followUpAt, paymentPromiseDate } = req.body;
        if (!allowedStatuses.has(followUpStatus)) {
            return res.status(400).json({ success: false, error: 'Некорректный статус контакта' });
        }

        const membership = await prisma.membership.update({
            where: { id: req.params.id },
            data: {
                followUpStatus,
                followUpNote: followUpNote?.trim() || null,
                followUpAt: followUpAt ? new Date(followUpAt) : null,
                paymentPromiseDate: paymentPromiseDate ? new Date(paymentPromiseDate) : null,
            },
        });
        clearStatsCache();
        res.json({ success: true, membership });
    } catch (error) {
        console.error('Update membership action error:', error);
        res.status(500).json({ success: false, error: 'Не удалось сохранить результат контакта' });
    }
});

// @route   GET /api/admin/attendance-report
// @desc    Отчет по посещаемости
// @access  Private/Admin
router.get('/attendance-report', authenticate, requireAdmin, async (req, res) => {
    try {
        const { startDate, endDate, groupId } = req.query;
        
        const where = {};
        
        if (startDate && endDate) {
            where.date = {
                gte: new Date(startDate),
                lte: new Date(endDate)
            };
        }
        
        if (groupId) {
            where.groupId = groupId;
        }
        
        // В Prisma схеме нет модели Attendance отдельно — 
        // посещаемость хранится в ClassAttendee.
        // Извлекаем через связь class -> attendees
        const classes = await prisma.class.findMany({
            where,
            include: {
                attendees: {
                    include: {
                        student: { select: { id: true, name: true, lastName: true, middleName: true, phone: true } }
                    }
                },
                group: { select: { id: true, name: true, direction: true } }
            },
            orderBy: { date: 'desc' }
        });
        
        // Формируем плоский список посещений для совместимости
        const attendance = [];
        for (const cls of classes) {
            for (const att of cls.attendees) {
                attendance.push({
                    _id: att.id,
                    id: att.id,
                    date: cls.date,
                    attended: att.attended,
                    student: att.student ? { ...att.student, _id: att.student.id } : null,
                    group: cls.group ? { ...cls.group, _id: cls.group.id } : null
                });
            }
        }
        
        res.json({
            success: true,
            count: attendance.length,
            attendance
        });
    } catch (error) {
        console.error('Get attendance report error:', error);
        res.status(500).json({
            error: 'Ошибка при получении отчета'
        });
    }
});

// @route   POST /api/admin/trigger-automation
// @desc    Вручную запустить housekeeping (без автосписания)
// @access  Private/Admin
router.post('/trigger-automation', authenticate, requireAdmin, async (req, res) => {
    try {
        const { processHousekeeping } = require('../services/automation');
        const result = await processHousekeeping();
        res.json({ 
            success: result.success, 
            message: result.success ? 'Housekeeping завершён' : 'Housekeeping завершён с ошибками',
            logs: result.logs,
            markedNotFilled: result.markedNotFilled,
            totalDeducted: 0,
            error: result.error
        });
    } catch (error) {
        console.error('Manual automation trigger error:', error);
        res.status(500).json({ error: 'Ошибка при запуске автоматизации', details: error.message });
    }
});

// Экспортируем и router и функцию очистки кэша
module.exports = router;
module.exports.clearStatsCache = clearStatsCache;
