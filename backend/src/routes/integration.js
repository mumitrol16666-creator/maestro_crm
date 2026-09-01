const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { getTeacherRate, isPayableClass } = require('../services/salaryPolicy');
const { requireIntegrationAuth } = require('../middleware/integrationAuth');
const { createIntegrationAuditMiddleware } = require('../services/integrationJournal');
const { buildCrmIntegrationSnapshot } = require('../services/integrationReconciliation');
const { getLinkStatus, linkUsers, syncFromApp, createSsoToken, getCrmProfileByPhone } = require('../services/userLink');
const {
    getTeacherOfflineClasses,
    getTeacherStudents,
    getTeacherGroups,
    getClassCard,
    getClassStudents,
    getStudentOfflineSummary,
    getStudentTeachers,
    getStudentFreezeStatus,
    getPendingReviewClasses,
    getAdminOfflineClasses,
    getManagementDayOverview,
} = require('../services/integrationRead');

function formatIntegrationFio(person, fallback = '') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function parseIntegrationDateRange(from, to) {
    const now = new Date();
    const start = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = to ? new Date(to) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return { error: 'Invalid from/to date' };
    }
    if (start > end) {
        return { error: 'from must be before to' };
    }
    return { start, end };
}

function formatIntegrationPeriodName(start, end) {
    const startIsMonthStart = start.getDate() === 1
        && start.getHours() === 0
        && start.getMinutes() === 0;
    const endOfStartMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
    const endIsSameMonthEnd = end.getFullYear() === endOfStartMonth.getFullYear()
        && end.getMonth() === endOfStartMonth.getMonth()
        && end.getDate() === endOfStartMonth.getDate();

    if (startIsMonthStart && endIsSameMonthEnd) {
        return start.toLocaleString('ru-RU', { month: 'long', year: 'numeric' });
    }
    return `${start.toLocaleDateString('ru-RU')} — ${end.toLocaleDateString('ru-RU')}`;
}
const {
    teacherStart,
    teacherFinish,
    teacherSubmit,
    teacherMarkNotHeld,
    teacherWithdraw,
    teacherSetAttendance,
    adminSetAttendance,
    adminApproveClass,
    returnClassToTeacher,
    reopenClass,
} = require('../services/integrationWrite');
const { createAppOnlineLessonBooking } = require('../services/integrationBooking');
const { mapStaffTask, staffPersonName } = require('../services/staffTasks');
const {
    buildShopOrderNumber,
    calculateSaleTotals,
    normalizeSaleItems,
    parseShopInteger,
} = require('../services/shopInventory');
const {
    debitStudentCoins,
    refundStudentCoins,
} = require('../services/learningPlatformShop');

const STAFF_TASK_INCLUDE = {
    assignee: { select: { id: true, name: true, lastName: true, middleName: true, role: true, appUserId: true } },
    createdBy: { select: { id: true, name: true, lastName: true, middleName: true, role: true } },
};

router.use(requireIntegrationAuth);
router.use(createIntegrationAuditMiddleware());

function requireLearningPlatform(req, res) {
    if (req.integrationSystem !== 'learning-platform') {
        res.status(403).json({ success: false, error: 'Эта операция доступна только приложению Maestro' });
        return false;
    }
    return true;
}

function cleanShopText(value, maxLength = 250) {
    const text = String(value || '').trim();
    return text ? text.slice(0, maxLength) : null;
}

function publicShopOrder(order) {
    return {
        id: order.id,
        number: order.number,
        externalKey: order.externalKey,
        status: order.status,
        subtotal: order.subtotal,
        discountAmount: order.discountAmount,
        coinsSpent: order.coinsSpent,
        coinsRefunded: order.coinsSpent === 0 || Boolean(order.coinRefundTransactionId),
        cashAmount: order.cashAmount,
        notes: order.notes,
        confirmedAt: order.confirmedAt,
        completedAt: order.completedAt,
        cancelledAt: order.cancelledAt,
        cancellationReason: order.cancellationReason,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        items: (order.items || []).map(item => ({
            id: item.id,
            productId: item.productId,
            productName: item.productName,
            sku: item.sku,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
            coinPaymentPercent: item.coinPaymentPercent,
            maxCoins: item.maxCoins,
        })),
    };
}

async function confirmShopOrderCoins(order) {
    if (order.coinsSpent <= 0 || order.status !== 'awaiting_coins') return order;
    const debit = await debitStudentCoins({
        crmStudentId: order.customerId,
        orderId: order.id,
        orderNumber: order.number,
        amount: order.coinsSpent,
    });
    const transition = await prisma.shopOrder.updateMany({
        where: { id: order.id, status: 'awaiting_coins' },
        data: {
            status: 'new',
            confirmedAt: order.confirmedAt || new Date(),
            coinTransactionId: debit.transactionId,
        },
    });
    if (transition.count === 1) {
        return prisma.shopOrder.findUniqueOrThrow({
            where: { id: order.id },
            include: { items: true },
        });
    }

    let current = await prisma.shopOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: { items: true },
    });
    if (current.status === 'cancelled' && !current.coinRefundTransactionId) {
        const refund = await refundStudentCoins({
            crmStudentId: current.customerId,
            orderId: current.id,
            orderNumber: current.number,
            amount: current.coinsSpent,
            reason: current.cancellationReason || 'Заказ отменён во время подтверждения',
        });
        current = await prisma.shopOrder.update({
            where: { id: current.id },
            data: {
                coinTransactionId: debit.transactionId,
                coinRefundTransactionId: refund.transactionId,
            },
            include: { items: true },
        });
    }
    return current;
}

function learningPlatformErrorCode(error) {
    return error.response?.data?.error?.code || error.response?.data?.code || error.code;
}

async function refundCancelledShopOrderCoins(order, reason) {
    if (order.status !== 'cancelled' || order.coinsSpent <= 0 || order.coinRefundTransactionId) {
        return order;
    }
    try {
        const refund = await refundStudentCoins({
            crmStudentId: order.customerId,
            orderId: order.id,
            orderNumber: order.number,
            amount: order.coinsSpent,
            reason,
        });
        return prisma.shopOrder.update({
            where: { id: order.id },
            data: { coinRefundTransactionId: refund.transactionId },
            include: { items: true },
        });
    } catch (error) {
        if (learningPlatformErrorCode(error) === 'SHOP_COIN_DEBIT_NOT_FOUND') return order;
        throw error;
    }
}

function integrationShopError(res, error, fallback) {
    console.error(`[integration-shop] ${fallback}:`, error);
    const responseStatus = error.response?.status;
    const responseError = error.response?.data?.error;
    const message = responseError?.message || responseError || error.message || fallback;
    const code = responseError?.code || error.response?.data?.code || error.code;
    if (responseStatus) {
        return res.status(responseStatus).json({ success: false, error: message, code });
    }
    if (error.status) {
        return res.status(error.status).json({ success: false, error: message, code });
    }
    if (error.code === 'P2002') {
        return res.status(409).json({ success: false, error: 'Заказ уже создан', code: 'SHOP_ORDER_EXISTS' });
    }
    return res.status(500).json({ success: false, error: fallback });
}

// GET /api/integration/v1/shop/catalog
router.get('/shop/catalog', async (req, res) => {
    if (!requireLearningPlatform(req, res)) return;
    try {
        const products = await prisma.shopProduct.findMany({
            where: { active: true, publishedInApp: true },
            orderBy: [{ category: 'asc' }, { name: 'asc' }],
            select: {
                id: true,
                sku: true,
                name: true,
                category: true,
                unit: true,
                description: true,
                imageUrl: true,
                salePrice: true,
                stockQuantity: true,
                coinPaymentPercent: true,
                updatedAt: true,
            },
        });
        return res.json({
            success: true,
            data: {
                products: products.map(product => ({
                    ...product,
                    available: product.stockQuantity > 0,
                    maxCoinsPerUnit: Math.floor((product.salePrice * product.coinPaymentPercent) / 100),
                })),
            },
        });
    } catch (error) {
        return integrationShopError(res, error, 'Не удалось загрузить товары');
    }
});

// GET /api/integration/v1/shop/orders?crmStudentId=...
router.get('/shop/orders', async (req, res) => {
    if (!requireLearningPlatform(req, res)) return;
    try {
        const crmStudentId = cleanShopText(req.query.crmStudentId, 64);
        if (!crmStudentId) return res.status(400).json({ success: false, error: 'Не указан ученик' });
        const orders = await prisma.shopOrder.findMany({
            where: { customerId: crmStudentId, source: 'student_app' },
            include: { items: true },
            orderBy: { createdAt: 'desc' },
            take: 50,
        });
        return res.json({ success: true, data: { orders: orders.map(publicShopOrder) } });
    } catch (error) {
        return integrationShopError(res, error, 'Не удалось загрузить заказы');
    }
});

// POST /api/integration/v1/shop/orders
router.post('/shop/orders', async (req, res) => {
    if (!requireLearningPlatform(req, res)) return;
    try {
        const externalKey = cleanShopText(req.body?.externalKey, 191);
        const crmStudentId = cleanShopText(req.body?.crmStudentId, 64);
        if (!externalKey || !crmStudentId) {
            return res.status(400).json({ success: false, error: 'Не удалось определить заказ или ученика' });
        }

        const existing = await prisma.shopOrder.findUnique({
            where: { externalKey },
            include: { items: true },
        });
        if (existing) {
            if (existing.customerId !== crmStudentId) {
                return res.status(409).json({
                    success: false,
                    error: 'Ключ заказа уже использован другим учеником',
                    code: 'SHOP_ORDER_IDEMPOTENCY_CONFLICT',
                });
            }
            let confirmed = await confirmShopOrderCoins(existing);
            confirmed = await refundCancelledShopOrderCoins(
                confirmed,
                confirmed.cancellationReason || 'Повторная проверка отменённого заказа',
            );
            return res.json({ success: true, data: { order: publicShopOrder(confirmed) } });
        }

        const student = await prisma.student.findFirst({
            where: { id: crmStudentId, role: 'student', status: 'active' },
            select: { id: true, name: true, lastName: true, middleName: true, phone: true },
        });
        if (!student) {
            return res.status(404).json({ success: false, error: 'Ученик не найден в CRM' });
        }

        const normalizedItems = normalizeSaleItems(req.body?.items);
        const productIds = normalizedItems.map(item => item.productId);
        const products = await prisma.shopProduct.findMany({
            where: { id: { in: productIds }, active: true, publishedInApp: true },
        });
        const totals = calculateSaleTotals(
            products,
            normalizedItems,
            0,
            parseShopInteger(req.body?.coinsToUse || 0, 'Сумма Coins', { min: 0 }),
        );
        const now = new Date();
        const suffix = externalKey.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase();
        let order = await prisma.shopOrder.create({
            data: {
                number: buildShopOrderNumber(now, suffix),
                externalKey,
                source: 'student_app',
                status: totals.coinsSpent > 0 ? 'awaiting_coins' : 'new',
                customerId: student.id,
                customerName: formatIntegrationFio(student),
                customerPhone: student.phone,
                subtotal: totals.subtotal,
                discountAmount: totals.discountAmount,
                coinsSpent: totals.coinsSpent,
                cashAmount: totals.cashAmount,
                notes: cleanShopText(req.body?.notes, 2000) || '',
                confirmedAt: totals.coinsSpent > 0 ? null : now,
                items: { create: totals.items },
            },
            include: { items: true },
        });

        if (order.coinsSpent > 0) {
            try {
                order = await confirmShopOrderCoins(order);
            } catch (error) {
                const code = learningPlatformErrorCode(error);
                if (code === 'INSUFFICIENT_COINS') {
                    await prisma.shopOrder.update({
                        where: { id: order.id },
                        data: {
                            status: 'cancelled',
                            coinsSpent: 0,
                            cashAmount: order.cashAmount + order.coinsSpent,
                            cancelledAt: new Date(),
                            cancellationReason: 'Недостаточно Coins',
                        },
                    });
                }
                throw error;
            }
        }

        return res.status(201).json({ success: true, data: { order: publicShopOrder(order) } });
    } catch (error) {
        return integrationShopError(res, error, 'Не удалось оформить заказ');
    }
});

// POST /api/integration/v1/shop/orders/:id/cancel
router.post('/shop/orders/:id/cancel', async (req, res) => {
    if (!requireLearningPlatform(req, res)) return;
    try {
        const crmStudentId = cleanShopText(req.body?.crmStudentId, 64);
        const reason = cleanShopText(req.body?.reason, 1000) || 'Отменён учеником';
        if (!crmStudentId) return res.status(400).json({ success: false, error: 'Не указан ученик' });

        let order = await prisma.shopOrder.findFirst({
            where: { id: req.params.id, customerId: crmStudentId, source: 'student_app' },
            include: { items: true },
        });
        if (!order) return res.status(404).json({ success: false, error: 'Заказ не найден' });
        if (order.status === 'completed') {
            return res.status(409).json({ success: false, error: 'Выданный заказ нельзя отменить в приложении' });
        }

        if (order.status !== 'cancelled') {
            await prisma.shopOrder.updateMany({
                where: { id: order.id, status: { in: ['awaiting_coins', 'new'] } },
                data: { status: 'cancelled', cancelledAt: new Date(), cancellationReason: reason },
            });
            order = await prisma.shopOrder.findUniqueOrThrow({
                where: { id: order.id },
                include: { items: true },
            });
            if (order.status === 'completed') {
                return res.status(409).json({ success: false, error: 'Заказ уже выдан' });
            }
        }

        order = await refundCancelledShopOrderCoins(order, reason);

        return res.json({ success: true, data: { order: publicShopOrder(order) } });
    } catch (error) {
        return integrationShopError(res, error, 'Не удалось отменить заказ');
    }
});

// GET /api/integration/v1/directions
// CRM owns this directory. Consumers keep a read-only projection keyed by the
// stable CRM id and use updatedAt to ignore stale synchronization results.
router.get('/directions', async (_req, res) => {
    try {
        const directions = await prisma.direction.findMany({
            select: {
                id: true,
                name: true,
                isActive: true,
                updatedAt: true,
            },
            orderBy: [{ order: 'asc' }, { name: 'asc' }],
        });

        return res.json({
            success: true,
            data: {
                directions: directions.map((direction) => ({
                    crmDirectionId: direction.id,
                    title: direction.name,
                    isActive: direction.isActive,
                    updatedAt: direction.updatedAt.toISOString(),
                })),
            },
        });
    } catch (error) {
        console.error('[integration] directions error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load directions' });
    }
});

// POST /api/integration/v1/bookings/online-lesson
router.post('/bookings/online-lesson', async (req, res) => {
    try {
        const result = await createAppOnlineLessonBooking(req.body || {});
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.status(201).json(result);
    } catch (error) {
        console.error('[integration] online lesson booking error:', error);
        return res.status(500).json({ success: false, error: 'Failed to create online lesson booking' });
    }
});

// POST /api/integration/v1/bookings/:externalSourceId/app-status
router.post('/bookings/:externalSourceId/app-status', async (req, res) => {
    try {
        const appStatus = String(req.body?.status || '').trim();
        const allowed = ['new', 'assigned', 'scheduled', 'completed', 'cancelled', 'no_show'];
        if (!allowed.includes(appStatus)) {
            return res.status(400).json({ success: false, error: 'Invalid app status' });
        }
        const booking = await prisma.booking.update({
            where: { externalSourceId: req.params.externalSourceId },
            data: { appStatus },
        });
        return res.json({ success: true, data: { crmBookingId: booking.id, appStatus: booking.appStatus } });
    } catch (error) {
        console.error('[integration] app booking status error:', error);
        return res.status(error.code === 'P2025' ? 404 : 500).json({
            success: false,
            error: error.code === 'P2025' ? 'Booking not found' : 'Failed to update booking status',
        });
    }
});

// GET /api/integration/v1/teachers/:crmTeacherId/staff-tasks
// Active manual tasks shown on the teacher home screen.
router.get('/teachers/:crmTeacherId/staff-tasks', async (req, res) => {
    try {
        const teacher = await prisma.student.findFirst({
            where: {
                id: req.params.crmTeacherId,
                role: 'teacher',
                status: 'active',
            },
            select: { id: true },
        });
        if (!teacher) {
            return res.status(404).json({ success: false, error: 'Teacher not found' });
        }

        const tasks = await prisma.staffTask.findMany({
            where: {
                assigneeId: teacher.id,
                status: { in: ['open', 'in_progress'] },
            },
            include: STAFF_TASK_INCLUDE,
            orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
            take: 50,
        });

        return res.json({ success: true, data: { tasks: tasks.map(mapStaffTask) } });
    } catch (error) {
        console.error('[integration] teacher staff tasks error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load staff tasks' });
    }
});

// POST /api/integration/v1/staff-tasks/:taskId/complete
// A teacher completes their own task from the learning application.
router.post('/staff-tasks/:taskId/complete', async (req, res) => {
    try {
        const crmAssigneeId = String(req.body?.crmAssigneeId || '').trim();
        if (!crmAssigneeId) {
            return res.status(400).json({ success: false, error: 'crmAssigneeId is required' });
        }

        const existing = await prisma.staffTask.findFirst({
            where: {
                id: req.params.taskId,
                assigneeId: crmAssigneeId,
                assignee: { role: 'teacher', status: 'active' },
            },
            include: STAFF_TASK_INCLUDE,
        });
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Task not found for this teacher' });
        }
        if (existing.status === 'completed') {
            return res.json({ success: true, data: { task: mapStaffTask(existing) } });
        }
        if (existing.status === 'cancelled') {
            return res.status(409).json({ success: false, error: 'Task is cancelled' });
        }

        const task = await prisma.staffTask.update({
            where: { id: existing.id },
            data: {
                status: 'completed',
                completedAt: new Date(),
                completedById: crmAssigneeId,
            },
            include: STAFF_TASK_INCLUDE,
        });
        await prisma.activityLog.create({
            data: {
                userId: crmAssigneeId,
                action: 'complete',
                entityType: 'StaffTask',
                entityId: task.id,
                details: `Завершена задача в приложении: ${task.title}`,
                metadata: {
                    status: task.status,
                    assigneeId: task.assigneeId,
                    completedBy: staffPersonName(task.assignee),
                    source: 'learning-platform',
                },
            },
        });

        return res.json({ success: true, data: { task: mapStaffTask(task) } });
    } catch (error) {
        console.error('[integration] complete staff task error:', error);
        return res.status(500).json({ success: false, error: 'Failed to complete staff task' });
    }
});

// POST /api/integration/v1/users/link
router.post('/users/link', async (req, res) => {
    try {
        const { phone, crmStudentId, crmTeacherId, appUserId, initiatedBy, force } = req.body || {};
        const crmUserId = crmStudentId || crmTeacherId;
        if (!phone && !crmUserId) {
            return res.status(400).json({ success: false, error: 'phone or crmStudentId/crmTeacherId is required' });
        }

        const result = await linkUsers({ phone, crmStudentId: crmUserId, appUserId, initiatedBy, force: force === true });
        if (!result.success) {
            const status = result.status === 'conflict' ? 409 : 400;
            return res.status(status).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] link error:', error);
        return res.status(500).json({ success: false, error: 'Link failed' });
    }
});

// POST /api/integration/v1/users/sync-from-app
router.post('/users/sync-from-app', async (req, res) => {
    try {
        const { appUserId, phone, firstName, lastName, middleName, dateOfBirth, email } = req.body || {};
        const result = await syncFromApp({ appUserId, phone, firstName, lastName, middleName, dateOfBirth, email });
        if (!result.success) {
            const status = result.status === 'conflict' ? 409 : 400;
            return res.status(status).json(result);
        }
        return res.status(result.data.created ? 201 : 200).json(result);
    } catch (error) {
        console.error('[integration] sync-from-app error:', error);
        return res.status(500).json({ success: false, error: 'Sync failed' });
    }
});

// GET /api/integration/v1/users/crm-lookup/:phone
router.get('/users/crm-lookup/:phone', async (req, res) => {
    try {
        const result = await getCrmProfileByPhone(req.params.phone);
        if (!result.success) {
            return res.status(400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] crm-lookup error:', error);
        return res.status(500).json({ success: false, error: 'CRM lookup failed' });
    }
});

// GET /api/integration/v1/users/link-status/:phone
router.get('/users/link-status/:phone', async (req, res) => {
    try {
        const result = await getLinkStatus(req.params.phone);
        if (!result.success) {
            return res.status(400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] link-status error:', error);
        return res.status(500).json({ success: false, error: 'Status check failed' });
    }
});

// POST /api/integration/v1/auth/sso-token
router.post('/auth/sso-token', async (req, res) => {
    try {
        const { crmStudentId } = req.body || {};
        if (!crmStudentId) {
            return res.status(400).json({ success: false, error: 'crmStudentId is required' });
        }

        const result = await createSsoToken(crmStudentId);
        if (!result.success) {
            return res.status(400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] sso-token error:', error);
        return res.status(500).json({ success: false, error: 'SSO token failed' });
    }
});

// GET /api/integration/v1/teachers/:crmTeacherId/offline-classes?from=&to=
router.get('/teachers/:crmTeacherId/offline-classes', async (req, res) => {
    try {
        const result = await getTeacherOfflineClasses(
            req.params.crmTeacherId,
            req.query.from,
            req.query.to,
        );
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] teacher offline-classes error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load teacher schedule' });
    }
});

// GET /api/integration/v1/teachers/:crmTeacherId/salary-summary
router.get('/teachers/:crmTeacherId/salary-summary', async (req, res) => {
    try {
        const { crmTeacherId } = req.params;
        const range = parseIntegrationDateRange(req.query.from, req.query.to);
        if (range.error) {
            return res.status(400).json({ success: false, error: range.error });
        }
        const { start, end } = range;

        const teacher = await prisma.student.findUnique({ where: { id: crmTeacherId } });
        if (!teacher || teacher.role !== 'teacher') {
            return res.status(404).json({ success: false, error: 'Teacher not found' });
        }

        const salaries = await prisma.salary.findMany({
            where: {
                teacherId: crmTeacherId,
                periodStart: { lte: end },
                periodEnd: { gte: start },
                status: { in: ['calculated', 'paid'] }
            }
        });

        let calculatedSalary = 0;
        let paidSalary = 0;
        let monthlyBonus = 0;
        let monthlyFine = 0;
        let monthlyAdvance = 0;

        for (const sal of salaries) {
            if (sal.status === 'paid') {
                paidSalary += sal.teacherSalary;
            } else if (sal.status === 'calculated') {
                calculatedSalary += sal.teacherSalary;
            }
            monthlyBonus += sal.bonus;
            monthlyFine += sal.penaltyDeduction;
            monthlyAdvance += sal.advance;
        }

        const classes = await prisma.class.findMany({
            where: {
                teacherId: crmTeacherId,
                date: { gte: start, lte: end },
                status: { in: ['completed', 'cancelled'] },
                salaryRecords: { none: {} }
            },
            include: {
                attendees: true
            }
        });

        let currentMonthPendingEarnings = 0;
        let pendingLessonsCount = 0;

        for (const cls of classes) {
            if (isPayableClass(cls)) {
                currentMonthPendingEarnings += getTeacherRate(teacher, cls);
                pendingLessonsCount++;
            }
        }

        return res.json({
            success: true,
            data: {
                teacherName: formatIntegrationFio(teacher),
                periodName: formatIntegrationPeriodName(start, end),
                from: start.toISOString(),
                to: end.toISOString(),
                calculatedSalary,
                paidSalary,
                pendingSalary: currentMonthPendingEarnings,
                monthlyBonus,
                monthlyFine,
                monthlyAdvance,
                pendingLessonsCount,
                rates: {
                    individual: teacher.salaryIndividual || 0,
                    group: teacher.salaryGroup || 0,
                    other: teacher.salaryOther || 0
                }
            }
        });
    } catch (error) {
        console.error('[integration] teacher salary-summary error:', error);
        return res.status(500).json({ success: false, error: 'Failed to compute salary summary' });
    }
});

// GET /api/integration/v1/teachers/:crmTeacherId/students
router.get('/teachers/:crmTeacherId/students', async (req, res) => {
    try {
        const result = await getTeacherStudents(req.params.crmTeacherId);
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] teacher students error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load teacher students' });
    }
});

// GET /api/integration/v1/teachers/:crmTeacherId/groups
router.get('/teachers/:crmTeacherId/groups', async (req, res) => {
    try {
        const result = await getTeacherGroups(req.params.crmTeacherId);
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] teacher groups error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load teacher groups' });
    }
});

// GET /api/integration/v1/classes/pending-review
router.get('/classes/pending-review', async (req, res) => {
    try {
        const result = await getPendingReviewClasses();
        return res.json(result);
    } catch (error) {
        console.error('[integration] pending-review error:', error);
        return res.status(500).json({ success: false, error: 'Failed to list pending review classes' });
    }
});

router.get('/classes/admin-agenda', async (req, res) => {
    try {
        const result = await getAdminOfflineClasses();
        return res.json(result);
    } catch (error) {
        console.error('[integration] admin agenda error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load admin class agenda' });
    }
});

router.get('/management/day-overview', async (req, res) => {
    try {
        const result = await getManagementDayOverview();
        return res.json(result);
    } catch (error) {
        console.error('[integration] management day overview error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load management day overview' });
    }
});

// GET /api/integration/v1/reconciliation/snapshot
// Snapshot для сверки со стороны приложения. Только service-token.
router.get('/reconciliation/snapshot', async (req, res) => {
    try {
        const snapshot = await buildCrmIntegrationSnapshot();
        return res.json({ success: true, data: snapshot });
    } catch (error) {
        console.error('[integration] reconciliation snapshot error:', error);
        return res.status(500).json({ success: false, error: 'Failed to build reconciliation snapshot' });
    }
});

// GET /api/integration/v1/classes/:crmClassId
router.get('/classes/:crmClassId', async (req, res) => {
    try {
        const result = await getClassCard(req.params.crmClassId);
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] class card error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load class' });
    }
});

// GET /api/integration/v1/classes/:crmClassId/students
router.get('/classes/:crmClassId/students', async (req, res) => {
    try {
        const result = await getClassStudents(req.params.crmClassId);
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] class students error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load class students' });
    }
});

// GET /api/integration/v1/students/:crmStudentId/offline-summary
router.get('/students/:crmStudentId/offline-summary', async (req, res) => {
    try {
        const result = await getStudentOfflineSummary(req.params.crmStudentId);
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] offline-summary error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load student summary' });
    }
});

// GET /api/integration/v1/students/:crmStudentId/teachers
router.get('/students/:crmStudentId/teachers', async (req, res) => {
    try {
        const result = await getStudentTeachers(req.params.crmStudentId);
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] student teachers error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load student teachers' });
    }
});

// POST /api/integration/v1/students/:crmStudentId/avatar
router.post('/students/:crmStudentId/avatar', async (req, res) => {
    try {
        let avatarUrl = String(req.body?.avatarUrl || '').trim();
        if (!avatarUrl || avatarUrl.length > 512) {
            return res.status(400).json({ success: false, error: 'avatarUrl is required' });
        }
        if (!/^https?:\/\//i.test(avatarUrl)) {
            return res.status(400).json({ success: false, error: 'avatarUrl must be absolute URL' });
        }
        avatarUrl = avatarUrl.replace(/^http:\/\/maestro-school\.duckdns\.org/i, 'https://maestro-school.duckdns.org');

        const existing = await prisma.student.findUnique({
            where: { id: req.params.crmStudentId },
            select: { id: true, role: true },
        });
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Student not found' });
        }
        if (existing.role !== 'student') {
            return res.status(400).json({ success: false, error: 'CRM user is not a student' });
        }

        const student = await prisma.student.update({
            where: { id: req.params.crmStudentId },
            data: { studentAvatar: avatarUrl },
            select: { id: true, studentAvatar: true },
        });

        return res.json({
            success: true,
            data: {
                crmStudentId: student.id,
                studentAvatar: student.studentAvatar,
            },
        });
    } catch (error) {
        console.error('[integration] student avatar error:', error);
        return res.status(error.code === 'P2025' ? 404 : 500).json({
            success: false,
            error: error.code === 'P2025' ? 'Student not found' : 'Failed to update student avatar',
        });
    }
});

// GET /api/integration/v1/students/:crmStudentId/freeze-status?date=
router.get('/students/:crmStudentId/freeze-status', async (req, res) => {
    try {
        const result = await getStudentFreezeStatus(req.params.crmStudentId, req.query.date);
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] freeze-status error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load freeze status' });
    }
});

// POST /api/integration/v1/classes/:crmClassId/teacher-start
router.post('/classes/:crmClassId/teacher-start', async (req, res) => {
    try {
        const { crmTeacherId } = req.body || {};
        const result = await teacherStart(req.params.crmClassId, { crmTeacherId });
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] teacher-start error:', error);
        return res.status(500).json({ success: false, error: 'Failed to start class' });
    }
});

// POST /api/integration/v1/classes/:crmClassId/teacher-finish
router.post('/classes/:crmClassId/teacher-finish', async (req, res) => {
    try {
        const { crmTeacherId, comment } = req.body || {};
        const result = await teacherFinish(req.params.crmClassId, { crmTeacherId, comment });
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] teacher-finish error:', error);
        return res.status(500).json({ success: false, error: 'Failed to finish class' });
    }
});

// POST /api/integration/v1/classes/:crmClassId/teacher-submit
router.post('/classes/:crmClassId/teacher-submit', async (req, res) => {
    try {
        const result = await teacherSubmit(req.params.crmClassId, req.body || {});
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] teacher-submit error:', error);
        return res.status(500).json({ success: false, error: 'Failed to submit class review' });
    }
});

// POST /api/integration/v1/classes/:crmClassId/teacher-mark-not-held
router.post('/classes/:crmClassId/teacher-mark-not-held', async (req, res) => {
    try {
        const { crmTeacherId, comment } = req.body || {};
        const result = await teacherMarkNotHeld(req.params.crmClassId, { crmTeacherId, comment });
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] teacher-mark-not-held error:', error);
        return res.status(500).json({ success: false, error: 'Failed to mark class as not held' });
    }
});

router.post('/classes/:crmClassId/teacher-withdraw', async (req, res) => {
    try {
        const { crmTeacherId, reason } = req.body || {};
        const result = await teacherWithdraw(req.params.crmClassId, { crmTeacherId, reason });
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] teacher-withdraw error:', error);
        return res.status(500).json({ success: false, error: 'Failed to withdraw class review' });
    }
});

// POST /api/integration/v1/classes/:crmClassId/teacher-attendance
router.post('/classes/:crmClassId/teacher-attendance', async (req, res) => {
    try {
        const { crmTeacherId, studentId, attended, attendanceStatus, teacherNote, homeworkReview } = req.body || {};
        const result = await teacherSetAttendance(req.params.crmClassId, {
            crmTeacherId,
            studentId,
            attended: Boolean(attended),
            attendanceStatus,
            teacherNote,
            homeworkReview,
        });
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] teacher-attendance error:', error);
        return res.status(500).json({ success: false, error: 'Failed to save attendance' });
    }
});

// POST /api/integration/v1/classes/:crmClassId/admin-attendance
router.post('/classes/:crmClassId/admin-attendance', async (req, res) => {
    try {
        const { studentId, attended, attendanceStatus, teacherNote, homeworkReview } = req.body || {};
        const result = await adminSetAttendance(req.params.crmClassId, {
            studentId,
            attended: Boolean(attended),
            attendanceStatus,
            teacherNote,
            homeworkReview,
        });
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] admin-attendance error:', error);
        return res.status(500).json({ success: false, error: 'Failed to save attendance' });
    }
});

// POST /api/integration/v1/classes/:crmClassId/approve
router.post('/classes/:crmClassId/approve', async (req, res) => {
    try {
        const result = await adminApproveClass(req.params.crmClassId, req.body || {});
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] approve class error:', error);
        return res.status(500).json({ success: false, error: 'Failed to approve class' });
    }
});

router.post('/classes/:crmClassId/return-to-teacher', async (req, res) => {
    try {
        const result = await returnClassToTeacher(
            req.params.crmClassId,
            req.body?.crmAdminId || req.body?.actorId,
            req.body?.reason,
        );
        if (!result.success) return res.status(result.status || 400).json(result);
        return res.json(result);
    } catch (error) {
        console.error('[integration] return class error:', error);
        return res.status(500).json({ success: false, error: 'Failed to return class to teacher' });
    }
});

router.post('/classes/:crmClassId/reopen', async (req, res) => {
    try {
        const result = await reopenClass(
            req.params.crmClassId,
            req.body?.crmAdminId || req.body?.actorId,
            req.body?.reason,
            req.body?.correction,
        );
        if (!result.success) return res.status(result.status || 400).json(result);
        return res.json(result);
    } catch (error) {
        console.error('[integration] reopen class error:', error);
        return res.status(500).json({ success: false, error: 'Failed to reopen class' });
    }
});

module.exports = router;
