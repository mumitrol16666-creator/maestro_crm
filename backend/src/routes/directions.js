const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireSuperAdmin } = require('../middleware/auth');

// @route   GET /api/directions/public
// @desc    Получить активные направления для публичного отображения
// @access  Public
router.get('/public', async (req, res) => {
    try {
        const directions = await prisma.direction.findMany({
            where: { isActive: true },
            select: {
                id: true, name: true, description: true, minAge: true, level: true,
                image: true, pricingTrial: true, pricingMonth: true, pricingThreeMonths: true, order: true
            },
            orderBy: [{ order: 'asc' }, { name: 'asc' }]
        });

        const mapped = directions.map(d => ({
            ...d, _id: d.id,
            pricing: { trial: d.pricingTrial, month: d.pricingMonth, threeMonths: d.pricingThreeMonths }
        }));

        res.json({ success: true, count: mapped.length, directions: mapped });
    } catch (error) {
        console.error('Get public directions error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при получении направлений' });
    }
});

// @route   GET /api/directions
// @desc    Получить все направления (для админки)
// @access  Private
router.get('/', authenticate, async (req, res) => {
    try {
        const directions = await prisma.direction.findMany({
            orderBy: [{ order: 'asc' }, { name: 'asc' }]
        });

        const mapped = directions.map(d => ({
            ...d, _id: d.id,
            pricing: { trial: d.pricingTrial, month: d.pricingMonth, threeMonths: d.pricingThreeMonths }
        }));

        res.json({ success: true, count: mapped.length, directions: mapped });
    } catch (error) {
        console.error('Get directions error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при получении направлений' });
    }
});

// @route   POST /api/directions
// @desc    Создать новое направление
// @access  Private/SuperAdmin
router.post('/', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { name, description, minAge, level, image, pricing, order } = req.body;

        // Проверяем уникальность
        const existing = await prisma.direction.findUnique({ where: { name: name.trim() } });
        if (existing) {
            return res.status(400).json({ success: false, error: 'Направление с таким названием уже существует' });
        }

        const direction = await prisma.direction.create({
            data: {
                name: name.trim(),
                description: description || '',
                minAge: minAge || 0,
                level: level || '',
                image: image || '',
                pricingTrial: pricing?.trial || 2000,
                pricingMonth: pricing?.month || 22000,
                pricingThreeMonths: pricing?.threeMonths || 55000,
                order: order || 0,
                createdById: req.user.id
            }
        });

        console.log(`✅ Добавлено направление: ${direction.name}`);

        res.status(201).json({
            success: true,
            message: 'Направление успешно создано',
            direction: {
                ...direction, _id: direction.id,
                pricing: { trial: direction.pricingTrial, month: direction.pricingMonth, threeMonths: direction.pricingThreeMonths }
            }
        });
    } catch (error) {
        console.error('Create direction error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при создании направления' });
    }
});

// @route   PATCH /api/directions/:id
// @desc    Обновить направление
// @access  Private/SuperAdmin
router.patch('/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { name, description, minAge, level, image, pricing, isActive, order } = req.body;

        const direction = await prisma.direction.findUnique({ where: { id: req.params.id } });
        if (!direction) {
            return res.status(404).json({ success: false, error: 'Направление не найдено' });
        }

        // Проверяем уникальность имени если оно меняется
        if (name && name.trim() !== direction.name) {
            const existing = await prisma.direction.findFirst({
                where: { name: name.trim(), NOT: { id: req.params.id } }
            });
            if (existing) {
                return res.status(400).json({ success: false, error: 'Направление с таким названием уже существует' });
            }
        }

        // Если меняется порядок — меняем местами
        if (typeof order === 'number' && order !== direction.order) {
            const target = await prisma.direction.findFirst({
                where: { order, NOT: { id: req.params.id } }
            });
            if (target) {
                await prisma.direction.update({ where: { id: target.id }, data: { order: direction.order } });
            }
        }

        const updateData = {};
        if (name !== undefined) updateData.name = name.trim();
        if (description !== undefined) updateData.description = description.trim();
        if (minAge !== undefined) updateData.minAge = minAge;
        if (level !== undefined) updateData.level = level.trim();
        if (image !== undefined) updateData.image = image.trim();
        if (typeof isActive === 'boolean') updateData.isActive = isActive;
        if (typeof order === 'number') updateData.order = order;
        if (pricing) {
            if (pricing.trial !== undefined) updateData.pricingTrial = pricing.trial;
            if (pricing.month !== undefined) updateData.pricingMonth = pricing.month;
            if (pricing.threeMonths !== undefined) updateData.pricingThreeMonths = pricing.threeMonths;
        }

        const updated = await prisma.direction.update({ where: { id: req.params.id }, data: updateData });

        console.log(`✏️ Обновлено направление: ${updated.name}`);

        res.json({
            success: true,
            message: 'Направление успешно обновлено',
            direction: {
                ...updated, _id: updated.id,
                pricing: { trial: updated.pricingTrial, month: updated.pricingMonth, threeMonths: updated.pricingThreeMonths }
            }
        });
    } catch (error) {
        console.error('Update direction error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при обновлении направления' });
    }
});

// @route   DELETE /api/directions/:id
// @desc    Удалить направление
// @access  Private/SuperAdmin
router.delete('/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const direction = await prisma.direction.findUnique({ where: { id: req.params.id } });
        if (!direction) {
            return res.status(404).json({ success: false, error: 'Направление не найдено' });
        }

        // Проверяем использование в группах
        const groupsCount = await prisma.group.count({ where: { direction: direction.name } });
        if (groupsCount > 0) {
            return res.status(400).json({
                success: false,
                error: `Невозможно удалить направление. Оно используется в ${groupsCount} группах.`
            });
        }

        await prisma.direction.delete({ where: { id: req.params.id } });
        console.log(`⚠️ Удалено направление: ${direction.name}`);

        res.json({ success: true, message: 'Направление успешно удалено' });
    } catch (error) {
        console.error('Delete direction error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при удалении направления' });
    }
});

module.exports = router;
