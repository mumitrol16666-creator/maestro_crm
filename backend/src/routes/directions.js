const express = require('express');
const router = express.Router();
const Direction = require('../models/Direction');
const { authenticate, requireSuperAdmin } = require('../middleware/auth');
const { cacheUtils } = require('../config/redis');

// @route   GET /api/directions/public
// @desc    Получить активные направления для публичного отображения
// @access  Public
router.get('/public', async (req, res) => {
    try {
        // 🚀 Redis кэширование
        const cacheKey = 'directions:public';
        const cachedData = await cacheUtils.get(cacheKey);
        if (cachedData) {
            console.log('📦 Cache HIT for public directions');
            return res.json(cachedData);
        }
        console.log('🔄 Cache MISS for public directions - fetching from DB');
        
        const directions = await Direction.find({ isActive: true })
            .select('name description minAge level image pricing order')
            .sort({ order: 1, name: 1 });
        
        const responseData = {
            success: true,
            count: directions.length,
            directions
        };
        
        // 🚀 Кэшируем результат на 30 минут
        await cacheUtils.set(cacheKey, responseData, 1800);
        console.log('💾 Cached public directions data');
        
        res.json(responseData);
    } catch (error) {
        console.error('Get public directions error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении направлений'
        });
    }
});

// @route   GET /api/directions
// @desc    Получить все направления (для админки)
// @access  Private
router.get('/', authenticate, async (req, res) => {
    try {
        // 🚀 Redis кэширование
        const cacheKey = 'directions:admin';
        const cachedData = await cacheUtils.get(cacheKey);
        if (cachedData) {
            console.log('📦 Cache HIT for admin directions');
            return res.json(cachedData);
        }
        console.log('🔄 Cache MISS for admin directions - fetching from DB');
        
        const directions = await Direction.find()
            .sort({ order: 1, name: 1 });
        
        const responseData = {
            success: true,
            count: directions.length,
            directions
        };
        
        // 🚀 Кэшируем результат на 10 минут
        await cacheUtils.set(cacheKey, responseData, 600);
        console.log('💾 Cached admin directions data');
        
        res.json(responseData);
    } catch (error) {
        console.error('Get directions error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении направлений'
        });
    }
});

// @route   POST /api/directions
// @desc    Создать новое направление
// @access  Private/SuperAdmin
router.post('/', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { name, description, minAge, level, image, pricing, order } = req.body;
        
        // Проверяем, существует ли уже такое направление
        const existing = await Direction.findOne({ name: name.trim() });
        if (existing) {
            return res.status(400).json({
                success: false,
                error: 'Направление с таким названием уже существует'
            });
        }
        
        const direction = await Direction.create({
            name: name.trim(),
            description: description || '',
            minAge: minAge || 0,
            level: level || '',
            image: image || '',
            pricing: pricing || { trial: 2000, month: 22000, threeMonths: 55000 },
            order: order || 0,
            createdBy: req.user._id
        });
        
        console.log(`✅ Добавлено направление: ${direction.name}`);
        
        res.status(201).json({
            success: true,
            message: 'Направление успешно создано',
            direction
        });
    } catch (error) {
        console.error('Create direction error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при создании направления'
        });
    }
});

// @route   PATCH /api/directions/:id
// @desc    Обновить направление
// @access  Private/SuperAdmin
router.patch('/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { name, description, minAge, level, image, pricing, isActive, order } = req.body;
        
        const direction = await Direction.findById(req.params.id);
        
        if (!direction) {
            return res.status(404).json({
                success: false,
                error: 'Направление не найдено'
            });
        }
        
        // Если меняется порядок - меняем местами с направлением на целевой позиции
        if (typeof order === 'number' && order !== direction.order) {
            const targetDirection = await Direction.findOne({ 
                order: order,
                _id: { $ne: req.params.id }
            });
            
            if (targetDirection) {
                // Меняем местами
                const oldOrder = direction.order;
                targetDirection.order = oldOrder;
                await targetDirection.save();
                console.log(`🔄 Направление "${targetDirection.name}" переместилось с ${order} на ${oldOrder}`);
            }
            
            direction.order = order;
        }
        
        // Проверяем уникальность имени если оно меняется
        if (name && name.trim() !== direction.name) {
            const existing = await Direction.findOne({ 
                name: name.trim(),
                _id: { $ne: req.params.id }
            });
            
            if (existing) {
                return res.status(400).json({
                    success: false,
                    error: 'Направление с таким названием уже существует'
                });
            }
            
            direction.name = name.trim();
        }
        
        // Обновляем остальные поля
        if (description !== undefined) {
            direction.description = description.trim();
        }
        
        if (minAge !== undefined) {
            direction.minAge = minAge;
        }
        
        if (level !== undefined) {
            direction.level = level.trim();
        }
        
        if (image !== undefined) {
            direction.image = image.trim();
        }
        
        if (pricing !== undefined) {
            direction.pricing = {
                trial: pricing.trial || direction.pricing?.trial || 2000,
                month: pricing.month || direction.pricing?.month || 22000,
                threeMonths: pricing.threeMonths || direction.pricing?.threeMonths || 55000
            };
        }
        
        if (typeof isActive === 'boolean') {
            direction.isActive = isActive;
        }
        
        await direction.save();
        
        console.log(`✏️ Обновлено направление: ${direction.name}`);
        
        res.json({
            success: true,
            message: 'Направление успешно обновлено',
            direction
        });
    } catch (error) {
        console.error('Update direction error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при обновлении направления'
        });
    }
});

// @route   DELETE /api/directions/:id
// @desc    Удалить направление
// @access  Private/SuperAdmin
router.delete('/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const direction = await Direction.findById(req.params.id);
        
        if (!direction) {
            return res.status(404).json({
                success: false,
                error: 'Направление не найдено'
            });
        }
        
        // Проверяем, не используется ли направление в группах
        const Group = require('../models/Group');
        const groupsCount = await Group.countDocuments({ direction: direction.name });
        
        if (groupsCount > 0) {
            return res.status(400).json({
                success: false,
                error: `Невозможно удалить направление. Оно используется в ${groupsCount} группах.`
            });
        }
        
        await direction.deleteOne();
        
        console.log(`⚠️ Удалено направление: ${direction.name}`);
        
        res.json({
            success: true,
            message: 'Направление успешно удалено'
        });
    } catch (error) {
        console.error('Delete direction error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при удалении направления'
        });
    }
});

module.exports = router;



