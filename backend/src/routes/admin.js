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
const { enrichMembershipBalance } = require('../utils/membershipBalance');
const {
    resolveStudentNotificationContact,
} = require('../services/studentNotificationRouting');
const {
    HOMEWORK_DRAFT_OPERATION,
    mapGeneratedHomeworkDrafts,
} = require('../services/whatsappReminderDrafts');
const {
    STAFF_ASSIGNEE_ROLES,
    mapStaffTask,
    staffPersonName,
    validateStaffTaskInput,
} = require('../services/staffTasks');
const { syncStaffTaskAssignedToLearningPlatform } = require('../services/learningPlatformNotifications');

const STAFF_TASK_INCLUDE = {
    assignee: { select: { id: true, name: true, lastName: true, middleName: true, role: true, appUserId: true } },
    createdBy: { select: { id: true, name: true, lastName: true, middleName: true, role: true } },
};

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

const MEMBERSHIP_ACTION_OPEN_STATUSES = new Set(['new', 'contacted', 'promised']);
const MEMBERSHIP_ACTION_STATUS_ORDER = {
    promised: 0,
    contacted: 1,
    new: 2,
    closed: 3,
};

function dateTimeValue(value) {
    const date = value ? new Date(value) : null;
    const time = date && !Number.isNaN(date.getTime()) ? date.getTime() : null;
    return time;
}

function firstDate(values, direction = 'asc') {
    const times = values
        .map(dateTimeValue)
        .filter(value => value !== null)
        .sort((a, b) => direction === 'desc' ? b - a : a - b);
    return times.length ? new Date(times[0]) : null;
}

function isMembershipRenewalCandidate(membership) {
    const balance = Number(membership.student?.accountBalance || 0);
    return balance >= 0
        && membership.estimatedLessonsRemaining !== null
        && Number(membership.estimatedLessonsRemaining) <= 1;
}

function membershipActionStatusForStudent(memberships) {
    const statuses = memberships
        .map(membership => membership.followUpStatus || 'new')
        .filter(status => status !== 'closed')
        .filter(status => MEMBERSHIP_ACTION_STATUS_ORDER[status] !== undefined)
        .sort((a, b) => MEMBERSHIP_ACTION_STATUS_ORDER[a] - MEMBERSHIP_ACTION_STATUS_ORDER[b]);
    return statuses[0] || 'new';
}

function pickPrimaryActionMembership(memberships) {
    return [...memberships].sort((a, b) => {
        const activeA = a.student?.activeMembershipId === a.id ? 0 : 1;
        const activeB = b.student?.activeMembershipId === b.id ? 0 : 1;
        if (activeA !== activeB) return activeA - activeB;

        const lessonA = a.estimatedLessonsRemaining ?? Number.POSITIVE_INFINITY;
        const lessonB = b.estimatedLessonsRemaining ?? Number.POSITIVE_INFINITY;
        if (lessonA !== lessonB) return lessonA - lessonB;

        return dateTimeValue(b.updatedAt) - dateTimeValue(a.updatedAt);
    })[0];
}

function compactMembershipSummary(memberships) {
    const labels = [];
    for (const membership of memberships) {
        const label = membership.group?.name || membership.plan?.name || membership.type || 'Абонемент';
        if (label && !labels.includes(label)) labels.push(label);
    }
    const visible = labels.slice(0, 2).join(' · ');
    const hidden = labels.length - 2;
    return hidden > 0 ? `${visible} +${hidden}` : visible || 'Абонемент';
}

function buildStudentMembershipAction(memberships) {
    const primary = pickPrimaryActionMembership(memberships);
    const student = primary.student;
    const accountBalance = Number(student?.accountBalance || 0);
    const hasDebt = accountBalance < 0;
    const needsRenewal = !hasDebt && isMembershipRenewalCandidate(primary);
    const orderedMemberships = [
        primary,
        ...memberships.filter(membership => membership.id !== primary.id),
    ];
    const status = membershipActionStatusForStudent(memberships);
    const noteSource = [...memberships]
        .sort((a, b) => dateTimeValue(b.updatedAt) - dateTimeValue(a.updatedAt))
        .find(membership => String(membership.followUpNote || '').trim());
    const lessonsRemaining = primary.estimatedLessonsRemaining !== null
        && Number.isFinite(Number(primary.estimatedLessonsRemaining))
        ? primary.estimatedLessonsRemaining
        : null;
    const promiseDate = firstDate(memberships.map(membership => membership.paymentPromiseDate));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return {
        id: student.id,
        _id: student.id,
        studentId: student.id,
        membershipId: primary.id,
        membershipIds: memberships.map(membership => membership.id),
        activeMembershipsCount: memberships.length,
        student: {
            ...student,
            _id: student.id,
        },
        studentName: formatAdminFio(student),
        group: primary.group,
        plan: primary.plan,
        teacherName: primary.teacher ? formatAdminFio(primary.teacher) : null,
        membershipSummary: compactMembershipSummary(orderedMemberships),
        lessonFormat: primary.lessonFormat,
        lessonPrice: primary.lessonPrice,
        classesRemaining: lessonsRemaining,
        estimatedLessonsRemaining: lessonsRemaining,
        remainingAmount: accountBalance,
        followUpStatus: status,
        followUpNote: noteSource?.followUpNote || null,
        followUpAt: firstDate(memberships.map(membership => membership.followUpAt)),
        paymentPromiseDate: promiseDate,
        hasDebt,
        needsRenewal,
        taskKind: hasDebt ? 'debt' : 'renewal',
        isOverduePromise: Boolean(
            promiseDate
            && dateTimeValue(promiseDate) < today.getTime()
            && MEMBERSHIP_ACTION_OPEN_STATUSES.has(status)
        ),
    };
}

function buildStudentMembershipActions(memberships, kind = 'all') {
    const byStudent = new Map();
    for (const rawMembership of memberships) {
        const membership = enrichMembershipBalance(rawMembership);
        const studentId = membership.student?.id;
        if (!studentId) continue;
        if (!byStudent.has(studentId)) byStudent.set(studentId, []);
        byStudent.get(studentId).push(membership);
    }

    return Array.from(byStudent.values())
        .map(studentMemberships => {
            const primary = pickPrimaryActionMembership(studentMemberships);
            const hasDebt = Number(primary.student?.accountBalance || 0) < 0;
            const needsRenewal = !hasDebt && isMembershipRenewalCandidate(primary);
            const actionable = hasDebt || needsRenewal;

            if (!actionable) return null;
            if (kind === 'debt' && !hasDebt) return null;
            if (kind === 'renewal' && !needsRenewal) return null;

            return buildStudentMembershipAction(studentMemberships);
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (a.hasDebt !== b.hasDebt) return a.hasDebt ? -1 : 1;
            if (a.isOverduePromise !== b.isOverduePromise) return a.isOverduePromise ? -1 : 1;
            const lessonA = a.estimatedLessonsRemaining ?? Number.POSITIVE_INFINITY;
            const lessonB = b.estimatedLessonsRemaining ?? Number.POSITIVE_INFINITY;
            if (lessonA !== lessonB) return lessonA - lessonB;
            return a.studentName.localeCompare(b.studentName, 'ru');
        });
}

function membershipActionMatchesStatus(action, followUpStatus) {
    if (!followUpStatus || followUpStatus === 'open') {
        return MEMBERSHIP_ACTION_OPEN_STATUSES.has(action.followUpStatus);
    }
    if (followUpStatus === 'all') return true;
    return action.followUpStatus === followUpStatus;
}

function countMembershipActionsByStatus(actions) {
    return actions.reduce((result, action) => {
        result[action.followUpStatus] = (result[action.followUpStatus] || 0) + 1;
        result.total += 1;
        if (MEMBERSHIP_ACTION_OPEN_STATUSES.has(action.followUpStatus)) {
            result.open += 1;
        }
        if (action.hasDebt) result.debt += 1;
        if (action.needsRenewal) result.renewal += 1;
        return result;
    }, { new: 0, contacted: 0, promised: 0, closed: 0, open: 0, debt: 0, renewal: 0, total: 0 });
}

function canManageStaffTask(user, task) {
    return ['admin', 'super_admin'].includes(user.role)
        || task.createdById === user.id
        || task.assigneeId === user.id;
}

async function notifyTeacherAboutStaffTask(task, assignee, createdByName) {
    if (assignee?.role !== 'teacher') return;
    try {
        await syncStaffTaskAssignedToLearningPlatform(task, assignee, createdByName);
    } catch (error) {
        console.error('Staff task teacher notification error:', error.message);
    }
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
            message: 'Рабочие данные очищены. Сотрудники, настройки и справочники сохранены.',
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
        const newBookings = await prisma.booking.count({
            where: { status: 'new', convertedToStudentId: null },
        });
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

// @route GET /api/admin/staff-tasks
// @desc  Ручные задачи сотрудников
router.get('/staff-tasks', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const scope = String(req.query.scope || 'mine');
        const status = String(req.query.status || 'active');
        const where = {};

        if (scope === 'mine') where.assigneeId = req.user.id;
        else if (scope === 'created') where.createdById = req.user.id;
        else if (scope !== 'all' || !['admin', 'super_admin'].includes(req.user.role)) {
            where.OR = [{ assigneeId: req.user.id }, { createdById: req.user.id }];
        }

        if (status === 'active') where.status = { in: ['open', 'in_progress'] };
        else if (['open', 'in_progress', 'completed', 'cancelled'].includes(status)) where.status = status;

        const tasks = await prisma.staffTask.findMany({
            where,
            include: STAFF_TASK_INCLUDE,
            orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
            take: 100,
        });

        res.json({ success: true, tasks: tasks.map(mapStaffTask) });
    } catch (error) {
        console.error('Get staff tasks error:', error);
        res.status(500).json({ success: false, error: 'Не удалось загрузить задачи команды' });
    }
});

// @route POST /api/admin/staff-tasks
// @desc  Поставить задачу сотруднику
router.post('/staff-tasks', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const validation = validateStaffTaskInput(req.body);
        if (!validation.valid) {
            return res.status(400).json({ success: false, error: validation.errors[0] });
        }

        const assigneeId = String(req.body?.assigneeId || '');
        const assignee = await prisma.student.findFirst({
            where: { id: assigneeId, status: 'active', role: { in: [...STAFF_ASSIGNEE_ROLES] } },
            select: { id: true, name: true, lastName: true, middleName: true, role: true, appUserId: true },
        });
        if (!assignee) {
            return res.status(400).json({ success: false, error: 'Выберите действующего сотрудника' });
        }

        const task = await prisma.staffTask.create({
            data: {
                ...validation.data,
                assigneeId: assignee.id,
                createdById: req.user.id,
            },
            include: STAFF_TASK_INCLUDE,
        });

        await prisma.activityLog.create({
            data: {
                userId: req.user.id,
                action: 'create',
                entityType: 'StaffTask',
                entityId: task.id,
                details: `Поставлена задача: ${task.title} — ${staffPersonName(assignee)}`,
                metadata: {
                    assigneeId: assignee.id,
                    priority: task.priority,
                    dueAt: task.dueAt?.toISOString() || null,
                },
            },
        });
        await notifyTeacherAboutStaffTask(task, assignee, staffPersonName(task.createdBy));

        res.status(201).json({ success: true, task: mapStaffTask(task) });
    } catch (error) {
        console.error('Create staff task error:', error);
        res.status(500).json({ success: false, error: 'Не удалось создать задачу' });
    }
});

// @route PATCH /api/admin/staff-tasks/:id
// @desc  Изменить или завершить ручную задачу
router.patch('/staff-tasks/:id', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const existing = await prisma.staffTask.findUnique({ where: { id: req.params.id } });
        if (!existing) return res.status(404).json({ success: false, error: 'Задача не найдена' });
        if (!canManageStaffTask(req.user, existing)) {
            return res.status(403).json({ success: false, error: 'Нет доступа к этой задаче' });
        }

        const validation = validateStaffTaskInput(req.body, { partial: true });
        if (!validation.valid) {
            return res.status(400).json({ success: false, error: validation.errors[0] });
        }

        const data = { ...validation.data };
        let nextAssignee = null;
        if (Object.prototype.hasOwnProperty.call(req.body, 'assigneeId')) {
            const assigneeId = String(req.body.assigneeId || '');
            nextAssignee = await prisma.student.findFirst({
                where: { id: assigneeId, status: 'active', role: { in: [...STAFF_ASSIGNEE_ROLES] } },
                select: { id: true, name: true, lastName: true, middleName: true, role: true, appUserId: true },
            });
            if (!nextAssignee) {
                return res.status(400).json({ success: false, error: 'Выберите действующего сотрудника' });
            }
            data.assigneeId = nextAssignee.id;
        }

        if (data.status === 'completed') {
            data.completedAt = existing.completedAt || new Date();
            data.completedById = req.user.id;
        } else if (data.status && existing.status === 'completed') {
            data.completedAt = null;
            data.completedById = null;
        }

        const task = await prisma.staffTask.update({
            where: { id: existing.id },
            data,
            include: STAFF_TASK_INCLUDE,
        });
        await prisma.activityLog.create({
            data: {
                userId: req.user.id,
                action: data.status === 'completed' ? 'complete' : 'update',
                entityType: 'StaffTask',
                entityId: task.id,
                details: `${data.status === 'completed' ? 'Завершена' : 'Изменена'} задача: ${task.title}`,
                metadata: { status: task.status, assigneeId: task.assigneeId },
            },
        });

        if (nextAssignee && nextAssignee.id !== existing.assigneeId) {
            await notifyTeacherAboutStaffTask(task, nextAssignee, staffPersonName(task.createdBy));
        }

        res.json({ success: true, task: mapStaffTask(task) });
    } catch (error) {
        console.error('Update staff task error:', error);
        res.status(500).json({ success: false, error: 'Не удалось обновить задачу' });
    }
});

// @route DELETE /api/admin/staff-tasks/:id
// @desc  Удалить созданную вручную задачу
router.delete('/staff-tasks/:id', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const existing = await prisma.staffTask.findUnique({ where: { id: req.params.id } });
        if (!existing) return res.status(404).json({ success: false, error: 'Задача не найдена' });
        const canDelete = ['admin', 'super_admin'].includes(req.user.role) || existing.createdById === req.user.id;
        if (!canDelete) return res.status(403).json({ success: false, error: 'Нет доступа к удалению задачи' });

        await prisma.staffTask.delete({ where: { id: existing.id } });
        await prisma.activityLog.create({
            data: {
                userId: req.user.id,
                action: 'delete',
                entityType: 'StaffTask',
                entityId: existing.id,
                details: `Удалена задача: ${existing.title}`,
            },
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Delete staff task error:', error);
        res.status(500).json({ success: false, error: 'Не удалось удалить задачу' });
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
            debtMembershipsCount,
            newBookings,
            pendingReview,
            notFilled,
            todayClasses,
            expiringMembershipCandidatesForList,
            debtMemberships,
            myStaffTasks,
            delegatedStaffTasks,
            staffAssignees,
        ] = await Promise.all([
            prisma.booking.count({ where: { status: 'new', convertedToStudentId: null } }),
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
            prisma.student.count({ where: { role: 'student', accountBalance: { lt: 0 } } }),
            prisma.booking.findMany({
                where: { status: 'new', convertedToStudentId: null },
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
            prisma.membership.findMany({
                where: {
                    status: 'active',
                    student: { role: 'student', status: 'active', accountBalance: { gte: 0 } },
                },
                orderBy: { updatedAt: 'desc' },
                include: {
                    student: { select: { id: true, name: true, lastName: true, middleName: true, phone: true, accountBalance: true, activeMembershipId: true } },
                    group: { select: { name: true } },
                    teacher: { select: { name: true, lastName: true, middleName: true } },
                    plan: { select: { name: true, price: true, includedUnits: true } },
                },
            }),
            prisma.student.findMany({
                where: { role: 'student', accountBalance: { lt: 0 } },
                orderBy: { accountBalance: 'asc' },
                take: 8,
                select: { id: true, name: true, lastName: true, middleName: true, phone: true, accountBalance: true },
            }),
            prisma.staffTask.findMany({
                where: { assigneeId: req.user.id, status: { in: ['open', 'in_progress'] } },
                include: STAFF_TASK_INCLUDE,
                orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
                take: 20,
            }),
            prisma.staffTask.findMany({
                where: {
                    createdById: req.user.id,
                    assigneeId: { not: req.user.id },
                    status: { in: ['open', 'in_progress'] },
                },
                include: STAFF_TASK_INCLUDE,
                orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
                take: 20,
            }),
            prisma.student.findMany({
                where: { status: 'active', role: { in: [...STAFF_ASSIGNEE_ROLES] } },
                select: { id: true, name: true, lastName: true, middleName: true, role: true, appUserId: true },
                orderBy: [{ role: 'asc' }, { name: 'asc' }, { lastName: 'asc' }],
            }),
        ]);

        const teacherName = (teacher) => formatAdminFio(teacher) || null;
        const studentName = (student) => formatAdminFio(student) || null;
        const expiringMembershipActions = buildStudentMembershipActions(expiringMembershipCandidatesForList, 'renewal');
        const expiringMemberships = expiringMembershipActions.slice(0, 8);
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
                    expiringMemberships: expiringMembershipActions.length,
                    debtMemberships: debtMembershipsCount,
                    manualTasks: myStaffTasks.length,
                    delegatedTasks: delegatedStaffTasks.length,
                },
                newBookings: newBookings.map((item) => ({ ...item, _id: item.id })),
                pendingReview: pendingReview.map(mapClass),
                notFilled: notFilled.map(mapClass),
                todayClasses: todayClasses.map(mapClass),
                expiringMemberships: expiringMemberships.map((membership) => ({
                    id: membership.id,
                    membershipId: membership.membershipId,
                    studentId: membership.studentId,
                    studentName: membership.studentName,
                    phone: membership.student.phone,
                    remainingAmount: membership.remainingAmount,
                    classesRemaining: membership.classesRemaining,
                    estimatedLessonsRemaining: membership.estimatedLessonsRemaining,
                    lessonPrice: membership.lessonPrice,
                    planName: membership.membershipSummary,
                })),
                debtMemberships: debtMemberships.map((student) => ({
                    id: student.id,
                    studentId: student.id,
                    studentName: studentName(student),
                    phone: student.phone,
                    remainingAmount: student.accountBalance,
                })),
                manualTasks: {
                    mine: myStaffTasks.map(mapStaffTask),
                    delegated: delegatedStaffTasks.map(mapStaffTask),
                    assignees: staffAssignees.map((person) => ({
                        id: person.id,
                        name: staffPersonName(person),
                        role: person.role,
                        appUserId: person.appUserId || null,
                    })),
                },
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
            const recipient = resolveStudentNotificationContact(
                student,
                kind === 'homework' ? 'homework' : 'lessons'
            );
            reminders.push({
                id: key,
                classId: classRecord.id,
                studentId: student.id,
                studentName: reminderStudentName(student),
                phone: recipient?.phone || null,
                recipientLabel: recipient?.label || null,
                recipientAudience: recipient?.audience || null,
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
                    customerName: true,
                    phone: true,
                    notifyHomework: true,
                    notifyLessons: true,
                    notifyPayments: true,
                    additionalPhones: {
                        orderBy: { createdAt: 'asc' },
                        select: { phone: true, label: true, notifyHomework: true, notifyLessons: true, notifyPayments: true },
                    },
                    learningDirections: true,
                },
            },
            attendees: {
                include: {
                    student: {
                        select: {
                            id: true,
                            name: true,
                            lastName: true,
                            middleName: true,
                            customerName: true,
                            phone: true,
                            notifyHomework: true,
                            notifyLessons: true,
                            notifyPayments: true,
                            additionalPhones: {
                                orderBy: { createdAt: 'asc' },
                                select: { phone: true, label: true, notifyHomework: true, notifyLessons: true, notifyPayments: true },
                            },
                        },
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
                                select: {
                                    id: true,
                                    name: true,
                                    lastName: true,
                                    middleName: true,
                                    customerName: true,
                                    phone: true,
                                    notifyHomework: true,
                                    notifyLessons: true,
                                    notifyPayments: true,
                                    additionalPhones: {
                                        orderBy: { createdAt: 'asc' },
                                        select: { phone: true, label: true, notifyHomework: true, notifyLessons: true, notifyPayments: true },
                                    },
                                },
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

        const generatedDraftLogs = await prisma.integrationLog.findMany({
            where: {
                direction: 'outbound',
                operation: HOMEWORK_DRAFT_OPERATION,
                status: 'success',
            },
            select: {
                entityId: true,
                requestBody: true,
                responseBody: true,
                createdAt: true,
                completedAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 2000,
        });
        const generatedHomeworkDrafts = mapGeneratedHomeworkDrafts(generatedDraftLogs);
        if (generatedHomeworkDrafts.size) {
            const sentGeneratedRows = await prisma.activityLog.findMany({
                where: {
                    entityType: 'WhatsAppReminder',
                    action: 'sent',
                    entityId: { in: Array.from(generatedHomeworkDrafts.keys()) },
                },
                select: { entityId: true },
            });
            for (const row of sentGeneratedRows) generatedHomeworkDrafts.delete(row.entityId);
        }
        const generatedClassIds = Array.from(new Set(
            Array.from(generatedHomeworkDrafts.values()).map((draft) => draft.classId)
        ));

        const [todayClasses, tomorrowClasses, lowBalanceStudents, plannedContacts, completedClasses] = await Promise.all([
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
            prisma.student.findMany({
                where: {
                    status: 'active',
                    role: 'student',
                    accountBalance: { lte: 4000 },
                    memberships: { some: {} },
                },
                select: {
                    id: true,
                    name: true,
                    lastName: true,
                    middleName: true,
                    customerName: true,
                    phone: true,
                    notifyHomework: true,
                    notifyLessons: true,
                    notifyPayments: true,
                    additionalPhones: {
                        orderBy: { createdAt: 'asc' },
                        select: { phone: true, label: true, notifyHomework: true, notifyLessons: true, notifyPayments: true },
                    },
                    accountBalance: true,
                    learningDirections: true,
                    memberships: {
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                        select: {
                            id: true,
                            group: { select: { name: true, direction: true } },
                            plan: { select: { name: true } },
                        },
                    },
                },
                orderBy: { accountBalance: 'asc' },
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
                            customerName: true,
                            phone: true,
                            notifyHomework: true,
                            notifyLessons: true,
                            notifyPayments: true,
                            activeMembershipId: true,
                            additionalPhones: {
                                orderBy: { createdAt: 'asc' },
                                select: { phone: true, label: true, notifyHomework: true, notifyLessons: true, notifyPayments: true },
                            },
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
                    OR: [
                        { date: { gte: sevenDaysAgo, lt: tomorrowStart } },
                        ...(generatedClassIds.length ? [{ id: { in: generatedClassIds } }] : []),
                    ],
                },
                include: lessonInclude,
                orderBy: { date: 'desc' },
            }),
        ]);

        const today = mapReminderLessons(todayClasses, 'today');
        const tomorrow = mapReminderLessons(tomorrowClasses, 'tomorrow');
        const oneLesson = lowBalanceStudents.map((student) => {
            const recipient = resolveStudentNotificationContact(student, 'payments');
            return {
                id: `oneLesson:${dayKey}:${student.id}`,
                studentId: student.id,
                studentName: reminderStudentName(student),
                phone: recipient?.phone || null,
                recipientLabel: recipient?.label || null,
                recipientAudience: recipient?.audience || null,
                accountBalance: student.accountBalance,
                subject: student.memberships?.[0]?.group?.direction
                    || student.memberships?.[0]?.plan?.name
                    || student.memberships?.[0]?.group?.name
                    || student.learningDirections?.[0]
                    || 'занятия',
            };
        });
        const tasks = buildStudentMembershipActions(plannedContacts, 'all')
            .filter(action => action.followUpAt && action.followUpStatus !== 'closed')
            .map((action) => {
                const recipient = resolveStudentNotificationContact(action.student, 'payments');
                return {
                    id: `tasks:${action.followUpAt.toISOString().slice(0, 10)}:${action.studentId}`,
                    membershipId: action.membershipId,
                    studentId: action.studentId,
                    studentName: action.studentName || reminderStudentName(action.student),
                    phone: recipient?.phone || null,
                    recipientLabel: recipient?.label || null,
                    recipientAudience: recipient?.audience || null,
                    followUpAt: action.followUpAt,
                    followUpStatus: action.followUpStatus,
                    followUpNote: action.followUpNote,
                    paymentPromiseDate: action.paymentPromiseDate,
                    classesRemaining: action.classesRemaining,
                    accountBalance: action.remainingAmount,
                    subject: action.membershipSummary || action.group?.direction || action.plan?.name || action.group?.name || 'обучение',
                };
            });
        const homeworkIds = new Set();
        const homework = mapReminderLessons(completedClasses, 'homework')
            .filter((item) => item.topic || item.homework || generatedHomeworkDrafts.has(item.id))
            .map((item) => {
                homeworkIds.add(item.id);
                const generated = generatedHomeworkDrafts.get(item.id);
                return generated
                    ? {
                        ...item,
                        ...generated,
                        phone: generated.phone || item.phone,
                        recipientLabel: generated.recipientLabel || item.recipientLabel,
                        recipientAudience: generated.recipientAudience || item.recipientAudience,
                    }
                    : { ...item, messageSource: 'template' };
            });
        for (const generated of generatedHomeworkDrafts.values()) {
            if (!homeworkIds.has(generated.id)) homework.push(generated);
        }

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
                student: { role: 'student', status: 'active', accountBalance: { gte: 0 } },
            },
            include: {
                student: { select: { id: true, name: true, lastName: true, middleName: true, phone: true, accountBalance: true } },
                group: { select: { id: true, name: true } },
                plan: { select: { price: true, includedUnits: true } },
            },
            orderBy: { updatedAt: 'asc' }
        });
        
        // Маппим для совместимости с фронтендом
        const mapped = memberships
            .map(m => enrichMembershipBalance(m))
            .filter(m => m.estimatedLessonsRemaining !== null && m.estimatedLessonsRemaining <= 1)
            .sort((a, b) => a.estimatedLessonsRemaining - b.estimatedLessonsRemaining || new Date(a.updatedAt) - new Date(b.updatedAt))
            .map(m => ({
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
        const { kind = 'all', followUpStatus = 'open', search = '' } = req.query;
        const searchCondition = search ? {
            student: {
                OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { lastName: { contains: search, mode: 'insensitive' } },
                    { middleName: { contains: search, mode: 'insensitive' } },
                    { phone: { contains: search } },
                ],
            },
        } : null;

        const memberships = await prisma.membership.findMany({
            where: {
                status: 'active',
                AND: [
                    { student: { role: 'student', status: 'active' } },
                    ...(searchCondition ? [searchCondition] : []),
                ],
            },
            include: {
                student: {
                    select: {
                        id: true, name: true, lastName: true, middleName: true, phone: true,
                        notifyHomework: true, notifyLessons: true, notifyPayments: true,
                        accountBalance: true, activeMembershipId: true,
                        additionalPhones: {
                            orderBy: { createdAt: 'asc' },
                            select: { phone: true, notifyHomework: true, notifyLessons: true, notifyPayments: true },
                        },
                    },
                },
                group: { select: { name: true } },
                teacher: { select: { name: true, lastName: true, middleName: true } },
                plan: { select: { name: true, price: true, includedUnits: true } },
            },
            orderBy: [
                { followUpAt: 'asc' },
                { updatedAt: 'asc' },
            ],
        });

        const allActions = buildStudentMembershipActions(memberships, kind);
        const visibleActions = allActions.filter(action => membershipActionMatchesStatus(action, followUpStatus));
        const counts = countMembershipActionsByStatus(allActions);

        res.json({
            success: true,
            counts,
            memberships: visibleActions,
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

        const targetMembership = await prisma.membership.findUnique({
            where: { id: req.params.id },
            select: { studentId: true },
        });
        let studentId = targetMembership?.studentId || null;
        if (!studentId) {
            const student = await prisma.student.findUnique({
                where: { id: req.params.id },
                select: { id: true },
            });
            studentId = student?.id || null;
        }
        if (!studentId) {
            return res.status(404).json({ success: false, error: 'Ученик или абонемент не найден' });
        }

        const updated = await prisma.membership.updateMany({
            where: { studentId, status: 'active' },
            data: {
                followUpStatus,
                followUpNote: followUpNote?.trim() || null,
                followUpAt: followUpAt ? new Date(followUpAt) : null,
                paymentPromiseDate: paymentPromiseDate ? new Date(paymentPromiseDate) : null,
            },
        });
        clearStatsCache();
        res.json({ success: true, studentId, updatedCount: updated.count });
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
