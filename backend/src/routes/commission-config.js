const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireSuperAdmin } = require('../middleware/auth');

// @route   GET /api/commission-config/current
// @desc    Получить текущую активную конфигурацию
// @access  Private (admin)
router.get('/current', authenticate, async (req, res) => {
    try {
        const { role = 'sales_manager', userId } = req.query;
        
        // Ищем сначала персональную конфигурацию, потом общую для роли
        let config = null;
        
        if (userId) {
            config = await prisma.commissionConfig.findFirst({
                where: {
                    role,
                    userId,
                    isActive: true,
                    effectiveFrom: { lte: new Date() }
                },
                orderBy: { effectiveFrom: 'desc' }
            });
        }
        
        if (!config) {
            config = await prisma.commissionConfig.findFirst({
                where: {
                    role,
                    userId: null,
                    isActive: true,
                    effectiveFrom: { lte: new Date() }
                },
                orderBy: { effectiveFrom: 'desc' }
            });
        }
        
        if (!config) {
            return res.status(404).json({
                success: false,
                error: 'Конфигурация не найдена'
            });
        }
        
        res.json({
            success: true,
            config: { ...config, _id: config.id }
        });
    } catch (error) {
        console.error('Get current config error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении конфигурации'
        });
    }
});

// @route   GET /api/commission-config/history
// @desc    История всех конфигураций
// @access  Private (super_admin)
router.get('/history', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { role } = req.query;
        
        const where = {};
        if (role) where.role = role;
        
        const configs = await prisma.commissionConfig.findMany({
            where,
            include: {
                createdBy: { select: { id: true, name: true, lastName: true } },
                user: { select: { id: true, name: true, lastName: true } }
            },
            orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }]
        });
        
        const mapped = configs.map(c => ({
            ...c,
            _id: c.id,
            createdBy: c.createdBy ? { ...c.createdBy, _id: c.createdBy.id } : null,
            user: c.user ? { ...c.user, _id: c.user.id } : null
        }));
        
        res.json({
            success: true,
            configs: mapped
        });
    } catch (error) {
        console.error('Get config history error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении истории'
        });
    }
});

// @route   POST /api/commission-config
// @desc    Создать новую конфигурацию комиссий
// @access  Private (super_admin)
router.post('/', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const {
            role,
            userId,
            membershipTiers,
            trialRate,
            singleClassRate,
            individualClassRate,
            teacherGroupFixed,
            teacherIndividualRate,
            teacherMembershipBonus,
            teacherPerStudentFixed,
            bonusForPlan,
            effectiveFrom,
            changeNote
        } = req.body;
        
        // Валидация
        if (!role) {
            return res.status(400).json({
                success: false,
                error: 'Требуется поле role'
            });
        }
        
        // Деактивировать предыдущие конфигурации для этой роли/пользователя
        if (userId) {
            await prisma.commissionConfig.updateMany({
                where: { role, userId, isActive: true },
                data: { isActive: false }
            });
        } else {
            await prisma.commissionConfig.updateMany({
                where: { role, userId: null, isActive: true },
                data: { isActive: false }
            });
        }
        
        // Создать новую конфигурацию
        const config = await prisma.commissionConfig.create({
            data: {
                role,
                userId: userId || null,
                membershipTiers: membershipTiers || null,
                trialRate: trialRate !== undefined ? trialRate : 10,
                singleClassRate: singleClassRate !== undefined ? singleClassRate : 10,
                individualClassRate: individualClassRate !== undefined ? individualClassRate : 10,
                teacherGroupFixed: teacherGroupFixed || 0,
                teacherIndividualRate: teacherIndividualRate || 20,
                teacherMembershipBonus: teacherMembershipBonus || 5,
                teacherPerStudentFixed: teacherPerStudentFixed || 0,
                bonusForPlan: bonusForPlan !== undefined ? bonusForPlan : 20000,
                effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
                createdById: req.user.id,
                changeNote: changeNote || '',
                isActive: true
            },
            include: {
                createdBy: { select: { id: true, name: true, lastName: true } }
            }
        });
        
        res.status(201).json({
            success: true,
            config: { ...config, _id: config.id }
        });
    } catch (error) {
        console.error('Create config error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при создании конфигурации'
        });
    }
});

// @route   PATCH /api/commission-config/:id
// @desc    Обновить конфигурацию
// @access  Private (super_admin)
router.patch('/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const {
            membershipTiers,
            trialRate,
            singleClassRate,
            individualClassRate,
            teacherGroupFixed,
            teacherIndividualRate,
            teacherMembershipBonus,
            teacherPerStudentFixed,
            bonusForPlan,
            effectiveFrom,
            changeNote
        } = req.body;
        
        const existingConfig = await prisma.commissionConfig.findUnique({
            where: { id: req.params.id }
        });
        
        if (!existingConfig) {
            return res.status(404).json({
                success: false,
                error: 'Конфигурация не найдена'
            });
        }
        
        // Собираем обновляемые поля
        const updateData = {};
        if (membershipTiers !== undefined) updateData.membershipTiers = membershipTiers;
        if (trialRate !== undefined) updateData.trialRate = trialRate;
        if (singleClassRate !== undefined) updateData.singleClassRate = singleClassRate;
        if (individualClassRate !== undefined) updateData.individualClassRate = individualClassRate;
        if (teacherGroupFixed !== undefined) updateData.teacherGroupFixed = teacherGroupFixed;
        if (teacherIndividualRate !== undefined) updateData.teacherIndividualRate = teacherIndividualRate;
        if (teacherMembershipBonus !== undefined) updateData.teacherMembershipBonus = teacherMembershipBonus;
        if (teacherPerStudentFixed !== undefined) updateData.teacherPerStudentFixed = teacherPerStudentFixed;
        if (bonusForPlan !== undefined) updateData.bonusForPlan = bonusForPlan;
        if (effectiveFrom) updateData.effectiveFrom = new Date(effectiveFrom);
        if (changeNote) updateData.changeNote = changeNote;
        
        const config = await prisma.commissionConfig.update({
            where: { id: req.params.id },
            data: updateData,
            include: {
                createdBy: { select: { id: true, name: true, lastName: true } }
            }
        });
        
        res.json({
            success: true,
            config: { ...config, _id: config.id }
        });
    } catch (error) {
        console.error('Update config error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при обновлении конфигурации'
        });
    }
});

// @route   DELETE /api/commission-config/:id
// @desc    Деактивировать конфигурацию
// @access  Private (super_admin)
router.delete('/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const config = await prisma.commissionConfig.findUnique({
            where: { id: req.params.id }
        });
        
        if (!config) {
            return res.status(404).json({
                success: false,
                error: 'Конфигурация не найдена'
            });
        }
        
        // Деактивировать (не удалять!)
        await prisma.commissionConfig.update({
            where: { id: req.params.id },
            data: { isActive: false }
        });
        
        res.json({
            success: true,
            message: 'Конфигурация деактивирована'
        });
    } catch (error) {
        console.error('Delete config error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при деактивации конфигурации'
        });
    }
});

module.exports = router;
