const express = require('express');
const router = express.Router();
const CommissionConfig = require('../models/CommissionConfig');
const { authenticate, requireSuperAdmin } = require('../middleware/auth');

// @route   GET /api/commission-config/current
// @desc    Получить текущую активную конфигурацию
// @access  Private (admin)
router.get('/current', authenticate, async (req, res) => {
    try {
        const { role = 'sales_manager', userId } = req.query;
        
        const config = await CommissionConfig.getActiveConfig(role, new Date(), userId || null);
        
        if (!config) {
            return res.status(404).json({
                success: false,
                error: 'Конфигурация не найдена'
            });
        }
        
        res.json({
            success: true,
            config
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
        
        const filter = {};
        if (role) filter.role = role;
        
        const configs = await CommissionConfig.find(filter)
            .populate('createdBy', 'name lastName')
            .populate('user', 'name lastName')
            .sort({ effectiveFrom: -1, createdAt: -1 });
        
        res.json({
            success: true,
            configs
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
            teacherRates,
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
            await CommissionConfig.updateMany(
                { role, user: userId, isActive: true },
                { isActive: false }
            );
        } else {
            await CommissionConfig.updateMany(
                { role, user: null, isActive: true },
                { isActive: false }
            );
        }
        
        // Создать новую конфигурацию
        const config = await CommissionConfig.create({
            role,
            user: userId || null,
            membershipTiers: membershipTiers || [],
            trialRate: trialRate !== undefined ? trialRate : 0.10,
            singleClassRate: singleClassRate !== undefined ? singleClassRate : 0.10,
            individualClassRate: individualClassRate !== undefined ? individualClassRate : 0.10,
            teacherRates: teacherRates || {},
            bonusForPlan: bonusForPlan !== undefined ? bonusForPlan : 20000,
            effectiveFrom: effectiveFrom || new Date(),
            createdBy: req.user._id,
            changeNote: changeNote || '',
            isActive: true
        });
        
        res.status(201).json({
            success: true,
            config: await config.populate('createdBy', 'name lastName')
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
            teacherRates,
            bonusForPlan,
            effectiveFrom,
            changeNote
        } = req.body;
        
        const config = await CommissionConfig.findById(req.params.id);
        
        if (!config) {
            return res.status(404).json({
                success: false,
                error: 'Конфигурация не найдена'
            });
        }
        
        // Обновляемые поля
        if (membershipTiers) config.membershipTiers = membershipTiers;
        if (trialRate !== undefined) config.trialRate = trialRate;
        if (singleClassRate !== undefined) config.singleClassRate = singleClassRate;
        if (individualClassRate !== undefined) config.individualClassRate = individualClassRate;
        if (teacherRates) config.teacherRates = teacherRates;
        if (bonusForPlan !== undefined) config.bonusForPlan = bonusForPlan;
        if (effectiveFrom) config.effectiveFrom = effectiveFrom;
        if (changeNote) config.changeNote = changeNote;
        
        await config.save();
        
        res.json({
            success: true,
            config: await config.populate('createdBy', 'name lastName')
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
        const config = await CommissionConfig.findById(req.params.id);
        
        if (!config) {
            return res.status(404).json({
                success: false,
                error: 'Конфигурация не найдена'
            });
        }
        
        // Деактивировать (не удалять!)
        config.isActive = false;
        await config.save();
        
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

