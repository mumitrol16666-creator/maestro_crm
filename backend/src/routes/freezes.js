const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// @route   POST /api/freezes
// @desc    Создать заморозку (ученик или админ)
// @access  Private
router.post('/', authenticate, async (req, res) => {
    try {
        const { membershipId, type, startDate, endDate, reason } = req.body;
        
        if (!membershipId || !type || !startDate || !endDate) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        // Найти абонемент вместе с информацией о студенте
        const membership = await prisma.membership.findUnique({
            where: { id: membershipId },
            include: {
                student: {
                    select: {
                        id: true, name: true, lastName: true, middleName: true, phone: true, gender: true,
                        groups: { where: { status: 'active' }, select: { groupId: true } }
                    }
                }
            }
        });
        
        if (!membership) {
            return res.status(404).json({
                success: false,
                error: 'Абонемент не найден'
            });
        }
        
        const student = membership.student;
        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
        const isOwnMembership = student.id === req.user.id;
        
        // Проверка доступа
        if (!isAdmin && !isOwnMembership) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }
        
        // Ученик может создавать только 'regular' и 'period'
        if (!isAdmin && !['regular', 'period'].includes(type)) {
            return res.status(403).json({
                success: false,
                error: 'Этот тип заморозки может создать только администратор'
            });
        }
        
        // Проверить доступность заморозок
        if (type === 'regular' || type === 'period') {
            if (membership.freezesUsed >= membership.freezesAvailable) {
                return res.status(400).json({
                    success: false,
                    error: 'Все бесплатные заморозки использованы'
                });
            }
        }
        
        // Проверить пол для менструации
        if (type === 'period' && student.gender !== 'female') {
            return res.status(400).json({
                success: false,
                error: 'Этот тип заморозки доступен только женщинам'
            });
        }
        
        // Подсчитать сколько занятий попадает в период заморозки
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        console.log('🔍 Freeze period:', { startDate, endDate, start, end });
        
        // Найти группы ученика
        const studentGroupIds = student.groups.map(g => g.groupId);
        
        console.log('👥 Student groups:', studentGroupIds);
        
        // Найти занятия в период заморозки
        const classesInPeriod = await prisma.class.findMany({
            where: {
                groupId: { in: studentGroupIds },
                date: { gte: start, lte: end }
            }
        });
        
        console.log('📅 Classes found in period:', classesInPeriod.length);
        
        const frozenClasses = classesInPeriod.length;
        
        if (frozenClasses === 0) {
            return res.status(400).json({
                success: false,
                error: 'В указанный период нет занятий'
            });
        }
        
        // Менструация: фиксировано макс 2 занятия
        let actualFrozenClasses = frozenClasses;
        if (type === 'period') {
            actualFrozenClasses = Math.min(frozenClasses, 2);
        }
        
        // Определить статус
        let status = 'pending';
        
        // Автоодобрение для regular и period
        if (type === 'regular' || type === 'period') {
            status = 'active';
        }
        
        const freeze = await prisma.$transaction(async (tx) => {
            const lockedMemberships = await tx.$queryRaw`
                SELECT * FROM "Membership" WHERE id = ${membershipId} FOR UPDATE
            `;
            const lockedMembership = lockedMemberships[0];
            if (!lockedMembership) {
                const error = new Error('Абонемент не найден');
                error.code = 'MEMBERSHIP_NOT_FOUND';
                throw error;
            }
            if (
                (type === 'regular' || type === 'period')
                && lockedMembership.freezesUsed >= lockedMembership.freezesAvailable
            ) {
                const error = new Error('Все бесплатные заморозки использованы');
                error.code = 'FREEZE_LIMIT_REACHED';
                throw error;
            }
            const duplicateFreeze = await tx.freeze.findFirst({
                where: {
                    membershipId,
                    status: { in: ['pending', 'active'] },
                    startDate: { lte: end },
                    endDate: { gte: start },
                },
                select: { id: true },
            });
            if (duplicateFreeze) {
                const error = new Error('На этот период уже существует заморозка');
                error.code = 'FREEZE_PERIOD_DUPLICATE';
                throw error;
            }

            const created = await tx.freeze.create({
                data: {
                    studentId: student.id,
                    membershipId,
                    type,
                    frozenClasses: actualFrozenClasses,
                    classesUsed: 0,
                    startDate: start,
                    endDate: end,
                    reason: reason || null,
                    createdById: req.user.id,
                    status
                }
            });

            if (status === 'active' && (type === 'regular' || type === 'period')) {
                await tx.membership.update({
                    where: { id: membershipId },
                    data: {
                        freezesUsed: { increment: 1 },
                        classesRemaining: { increment: actualFrozenClasses },
                        totalClasses: { increment: actualFrozenClasses }
                    }
                });
                await tx.membershipTransaction.create({
                    data: {
                        membershipId,
                        type: 'freeze_used',
                        amount: actualFrozenClasses,
                        reason: `Заморозка (${type}): +${actualFrozenClasses} занятий компенсировано`,
                        freezeId: created.id,
                        addedById: req.user.id
                    }
                });
            }
            return created;
        });
        
        console.log(`🧊 Создана заморозка ${type} для ${student.name}: ${actualFrozenClasses} занятий`);
        
        res.status(201).json({
            success: true,
            freeze: { ...freeze, _id: freeze.id }
        });
    } catch (error) {
        console.error('Create freeze error:', error);
        if (error.code === 'MEMBERSHIP_NOT_FOUND') {
            return res.status(404).json({ success: false, error: error.message });
        }
        if (['FREEZE_LIMIT_REACHED', 'FREEZE_PERIOD_DUPLICATE'].includes(error.code)) {
            return res.status(409).json({ success: false, error: error.message });
        }
        res.status(500).json({
            success: false,
            error: error.message || 'Ошибка при создании заморозки'
        });
    }
});

// @route   GET /api/freezes
// @desc    Получить все заморозки (для админа) или свои (для ученика)
// @access  Private
router.get('/', authenticate, async (req, res) => {
    try {
        const { status, studentId } = req.query;
        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
        
        const where = {};
        
        // Админ видит все, ученик только свои
        if (!isAdmin) {
            where.studentId = req.user.id;
        } else if (studentId) {
            where.studentId = studentId;
        }
        
        // Фильтр по статусу
        if (status) {
            where.status = status;
        }
        
        const freezes = await prisma.freeze.findMany({
            where,
            include: {
                student: { select: { id: true, name: true, lastName: true, middleName: true, phone: true, gender: true } },
                membership: {
                    select: {
                        id: true, type: true, totalClasses: true,
                        classesRemaining: true, status: true,
                        group: { select: { id: true, name: true } }
                    }
                },
                createdBy: { select: { id: true, name: true, lastName: true, middleName: true } },
                processedBy: { select: { id: true, name: true, lastName: true, middleName: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        
        // Маппим для совместимости с фронтендом
        const mapped = freezes.map(f => ({
            ...f,
            _id: f.id,
            student: f.student ? { ...f.student, _id: f.student.id } : null,
            membership: f.membership ? { ...f.membership, _id: f.membership.id } : null
        }));
        
        res.json({
            success: true,
            freezes: mapped
        });
    } catch (error) {
        console.error('Get freezes error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении заморозок'
        });
    }
});

// @route   GET /api/freezes/pending/count
// @desc    Получить количество заморозок на одобрении
// @access  Admin only
router.get('/pending/count', authenticate, requireAdmin, async (req, res) => {
    try {
        const count = await prisma.freeze.count({ where: { status: 'pending' } });
        
        res.json({
            success: true,
            count
        });
    } catch (error) {
        console.error('Get pending freezes count error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при подсчете заморозок'
        });
    }
});

// @route   PATCH /api/freezes/:id/approve
// @desc    Одобрить заморозку
// @access  Admin only
router.patch('/:id/approve', authenticate, requireAdmin, async (req, res) => {
    try {
        const freezeSnapshot = await prisma.freeze.findUnique({
            where: { id: req.params.id },
            select: { membershipId: true },
        });
        if (!freezeSnapshot) {
            return res.status(404).json({ success: false, error: 'Заморозка не найдена' });
        }
        const updatedFreeze = await prisma.$transaction(async (tx) => {
            const lockedMemberships = await tx.$queryRaw`
                SELECT * FROM "Membership" WHERE id = ${freezeSnapshot.membershipId} FOR UPDATE
            `;
            const lockedMembership = lockedMemberships[0];
            const lockedFreezes = await tx.$queryRaw`
                SELECT * FROM "Freeze" WHERE id = ${req.params.id} FOR UPDATE
            `;
            const freeze = lockedFreezes[0];
            if (!freeze) {
                const error = new Error('Заморозка не найдена');
                error.code = 'FREEZE_NOT_FOUND';
                throw error;
            }
            if (freeze.status !== 'pending') {
                const error = new Error('Можно одобрить только ожидающие заморозки');
                error.code = 'FREEZE_ALREADY_PROCESSED';
                throw error;
            }
            if (!lockedMembership || freeze.membershipId !== freezeSnapshot.membershipId) {
                const error = new Error('Абонемент не найден');
                error.code = 'MEMBERSHIP_NOT_FOUND';
                throw error;
            }
            if (lockedMembership.freezesUsed >= lockedMembership.freezesAvailable) {
                const error = new Error('Все бесплатные заморозки использованы');
                error.code = 'FREEZE_LIMIT_REACHED';
                throw error;
            }

            const processed = await tx.freeze.update({
                where: { id: freeze.id },
                data: {
                    status: 'active',
                    processedById: req.user.id,
                    processedAt: new Date()
                }
            });
            await tx.membership.update({
                where: { id: freeze.membershipId },
                data: {
                    freezesUsed: { increment: 1 },
                    classesRemaining: { increment: freeze.frozenClasses },
                    totalClasses: { increment: freeze.frozenClasses }
                }
            });
            await tx.membershipTransaction.create({
                data: {
                    membershipId: freeze.membershipId,
                    type: 'freeze_used',
                    amount: freeze.frozenClasses,
                    reason: `Заморозка одобрена (${freeze.type}): +${freeze.frozenClasses} занятий компенсировано`,
                    freezeId: freeze.id,
                    addedById: req.user.id
                }
            });
            return processed;
        });
        
        console.log(`✅ Админ ${req.user.name} одобрил заморозку ${updatedFreeze.type}`);
        
        res.json({
            success: true,
            freeze: { ...updatedFreeze, _id: updatedFreeze.id }
        });
    } catch (error) {
        console.error('Approve freeze error:', error);
        if (error.code === 'FREEZE_NOT_FOUND' || error.code === 'MEMBERSHIP_NOT_FOUND') {
            return res.status(404).json({ success: false, error: error.message });
        }
        if (['FREEZE_ALREADY_PROCESSED', 'FREEZE_LIMIT_REACHED'].includes(error.code)) {
            return res.status(409).json({ success: false, error: error.message });
        }
        res.status(500).json({
            success: false,
            error: error.message || 'Ошибка при одобрении заморозки'
        });
    }
});

// @route   PATCH /api/freezes/:id/reject
// @desc    Отклонить заморозку
// @access  Admin only
router.patch('/:id/reject', authenticate, requireAdmin, async (req, res) => {
    try {
        const { reason } = req.body;
        
        if (!reason) {
            return res.status(400).json({
                success: false,
                error: 'Укажите причину отклонения'
            });
        }
        
        const updatedFreeze = await prisma.$transaction(async (tx) => {
            const lockedFreezes = await tx.$queryRaw`
                SELECT * FROM "Freeze" WHERE id = ${req.params.id} FOR UPDATE
            `;
            const freeze = lockedFreezes[0];
            if (!freeze) {
                const error = new Error('Заморозка не найдена');
                error.code = 'FREEZE_NOT_FOUND';
                throw error;
            }
            if (freeze.status !== 'pending') {
                const error = new Error('Заморозка уже обработана');
                error.code = 'FREEZE_ALREADY_PROCESSED';
                throw error;
            }
            return tx.freeze.update({
                where: { id: freeze.id },
                data: {
                    status: 'rejected',
                    rejectionReason: reason,
                    processedById: req.user.id,
                    processedAt: new Date()
                }
            });
        });
        
        console.log(`❌ Админ ${req.user.name} отклонил заморозку: ${reason}`);
        
        res.json({
            success: true,
            freeze: { ...updatedFreeze, _id: updatedFreeze.id }
        });
    } catch (error) {
        console.error('Reject freeze error:', error);
        if (error.code === 'FREEZE_NOT_FOUND') {
            return res.status(404).json({ success: false, error: error.message });
        }
        if (error.code === 'FREEZE_ALREADY_PROCESSED') {
            return res.status(409).json({ success: false, error: error.message });
        }
        res.status(500).json({
            success: false,
            error: error.message || 'Ошибка при отклонении заморозки'
        });
    }
});

// @route   DELETE /api/freezes/:id
// @desc    Отменить заморозку (ученик отменяет свою pending заморозку)
// @access  Private
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const freeze = await prisma.freeze.findUnique({
            where: { id: req.params.id }
        });
        
        if (!freeze) {
            return res.status(404).json({
                success: false,
                error: 'Заморозка не найдена'
            });
        }
        
        // Проверка доступа
        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
        const isOwnFreeze = freeze.studentId === req.user.id;
        
        if (!isAdmin && !isOwnFreeze) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }
        
        // Можно отменить только pending заморозки (если не админ)
        if (freeze.status !== 'pending' && !isAdmin) {
            return res.status(400).json({
                success: false,
                error: 'Можно отменить только ожидающие заморозки'
            });
        }
        
        await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`
                SELECT id FROM "Membership" WHERE id = ${freeze.membershipId} FOR UPDATE
            `;
            const lockedFreezes = await tx.$queryRaw`
                SELECT * FROM "Freeze" WHERE id = ${req.params.id} FOR UPDATE
            `;
            const lockedFreeze = lockedFreezes[0];
            if (!lockedFreeze) {
                const error = new Error('Заморозка не найдена');
                error.code = 'FREEZE_NOT_FOUND';
                throw error;
            }
            if (lockedFreeze.status === 'cancelled') {
                const error = new Error('Заморозка уже отменена');
                error.code = 'FREEZE_ALREADY_CANCELLED';
                throw error;
            }
            if (lockedFreeze.status === 'active') {
                await tx.membership.update({
                    where: { id: lockedFreeze.membershipId },
                    data: {
                        freezesUsed: { decrement: 1 },
                        classesRemaining: { decrement: lockedFreeze.frozenClasses },
                        totalClasses: { decrement: lockedFreeze.frozenClasses }
                    }
                });
                await tx.membershipTransaction.create({
                    data: {
                        membershipId: lockedFreeze.membershipId,
                        type: 'freeze_used',
                        amount: -lockedFreeze.frozenClasses,
                        reason: `Заморозка отменена: -${lockedFreeze.frozenClasses} занятий`,
                        freezeId: lockedFreeze.id,
                        addedById: req.user.id
                    }
                });
            }
            await tx.freeze.update({
                where: { id: lockedFreeze.id },
                data: { status: 'cancelled' }
            });
        });
        
        console.log(`🚫 Заморозка отменена`);
        
        res.json({
            success: true,
            message: 'Заморозка отменена'
        });
    } catch (error) {
        console.error('Cancel freeze error:', error);
        if (error.code === 'FREEZE_NOT_FOUND') {
            return res.status(404).json({ success: false, error: error.message });
        }
        if (error.code === 'FREEZE_ALREADY_CANCELLED') {
            return res.status(409).json({ success: false, error: error.message });
        }
        res.status(500).json({
            success: false,
            error: 'Ошибка при отмене заморозки'
        });
    }
});

module.exports = router;
