const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireSuperAdmin } = require('../middleware/auth');
const { LESSON_RATES } = require('../utils/pricing');

function positivePrice(value, fallback) {
    const normalized = Number(value);
    return Number.isInteger(normalized) && normalized > 0 ? normalized : fallback;
}

function pricingFromDirection(direction) {
    return {
        trial: direction.trialLessonPrice,
        group: direction.groupLessonPrice,
        theory: direction.theoryLessonPrice,
        individual: direction.individualLessonPrice,
    };
}

function mapDirection(direction) {
    return {
        ...direction,
        _id: direction.id,
        pricing: pricingFromDirection(direction),
    };
}

function directionSelect(isPublic = false) {
    return {
        id: true,
        name: true,
        description: true,
        minAge: true,
        level: true,
        image: true,
        trialLessonPrice: true,
        groupLessonPrice: true,
        theoryLessonPrice: true,
        individualLessonPrice: true,
        isActive: true,
        order: true,
        ...(!isPublic ? { createdAt: true, updatedAt: true } : {}),
    };
}

router.get('/public', async (req, res) => {
    try {
        const directions = await prisma.direction.findMany({
            where: { isActive: true },
            select: directionSelect(true),
            orderBy: [{ order: 'asc' }, { name: 'asc' }],
        });
        const mapped = directions.map(mapDirection);
        res.json({ success: true, count: mapped.length, directions: mapped });
    } catch (error) {
        console.error('Get public directions error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при получении направлений' });
    }
});

router.get('/', authenticate, async (req, res) => {
    try {
        const directions = await prisma.direction.findMany({
            select: directionSelect(false),
            orderBy: [{ order: 'asc' }, { name: 'asc' }],
        });
        const mapped = directions.map(mapDirection);
        res.json({ success: true, count: mapped.length, directions: mapped });
    } catch (error) {
        console.error('Get directions error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при получении направлений' });
    }
});

router.post('/', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { name, description, minAge, level, image, pricing, order } = req.body;
        const normalizedName = String(name || '').trim();
        if (!normalizedName) {
            return res.status(400).json({ success: false, error: 'Укажите название направления' });
        }

        const existing = await prisma.direction.findUnique({ where: { name: normalizedName } });
        if (existing) {
            return res.status(400).json({ success: false, error: 'Направление с таким названием уже существует' });
        }

        const direction = await prisma.direction.create({
            data: {
                name: normalizedName,
                description: description || '',
                minAge: Number(minAge) || 0,
                level: level || '',
                image: image || '',
                trialLessonPrice: positivePrice(pricing?.trial, LESSON_RATES.trial.price),
                groupLessonPrice: positivePrice(pricing?.group, LESSON_RATES.group.price),
                theoryLessonPrice: positivePrice(pricing?.theory, LESSON_RATES.theory.price),
                individualLessonPrice: positivePrice(pricing?.individual, LESSON_RATES.individual.price),
                order: Number(order) || 0,
                createdById: req.user.id,
            },
            select: directionSelect(false),
        });

        res.status(201).json({
            success: true,
            message: 'Направление успешно создано',
            direction: mapDirection(direction),
        });
    } catch (error) {
        console.error('Create direction error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при создании направления' });
    }
});

router.patch('/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { name, description, minAge, level, image, pricing, isActive, order } = req.body;
        const direction = await prisma.direction.findUnique({ where: { id: req.params.id } });
        if (!direction) {
            return res.status(404).json({ success: false, error: 'Направление не найдено' });
        }

        if (name && name.trim() !== direction.name) {
            const existing = await prisma.direction.findFirst({
                where: { name: name.trim(), NOT: { id: req.params.id } },
            });
            if (existing) {
                return res.status(400).json({ success: false, error: 'Направление с таким названием уже существует' });
            }
        }

        if (typeof order === 'number' && order !== direction.order) {
            const target = await prisma.direction.findFirst({ where: { order, NOT: { id: req.params.id } } });
            if (target) {
                await prisma.direction.update({ where: { id: target.id }, data: { order: direction.order } });
            }
        }

        const updateData = {};
        if (name !== undefined) updateData.name = name.trim();
        if (description !== undefined) updateData.description = description.trim();
        if (minAge !== undefined) updateData.minAge = Number(minAge) || 0;
        if (level !== undefined) updateData.level = level.trim();
        if (image !== undefined) updateData.image = image.trim();
        if (typeof isActive === 'boolean') updateData.isActive = isActive;
        if (typeof order === 'number') updateData.order = order;
        if (pricing?.trial !== undefined) updateData.trialLessonPrice = positivePrice(pricing.trial, direction.trialLessonPrice);
        if (pricing?.group !== undefined) updateData.groupLessonPrice = positivePrice(pricing.group, direction.groupLessonPrice);
        if (pricing?.theory !== undefined) updateData.theoryLessonPrice = positivePrice(pricing.theory, direction.theoryLessonPrice);
        if (pricing?.individual !== undefined) updateData.individualLessonPrice = positivePrice(pricing.individual, direction.individualLessonPrice);

        const updated = await prisma.direction.update({
            where: { id: req.params.id },
            data: updateData,
            select: directionSelect(false),
        });

        res.json({
            success: true,
            message: 'Направление успешно обновлено',
            direction: mapDirection(updated),
        });
    } catch (error) {
        console.error('Update direction error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при обновлении направления' });
    }
});

router.delete('/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const direction = await prisma.direction.findUnique({ where: { id: req.params.id } });
        if (!direction) {
            return res.status(404).json({ success: false, error: 'Направление не найдено' });
        }

        const [groupsCount, membershipsCount] = await Promise.all([
            prisma.group.count({ where: { direction: direction.name } }),
            prisma.membership.count({
                where: {
                    status: { not: 'deleted' },
                    OR: [
                        { directionId: direction.id },
                        { plan: { is: { directionId: direction.id } } },
                    ],
                },
            }),
        ]);
        if (groupsCount > 0 || membershipsCount > 0) {
            return res.status(400).json({
                success: false,
                error: 'Направление используется в группах или абонементах. Отключите его вместо удаления.',
            });
        }

        await prisma.$transaction([
            prisma.direction.update({ where: { id: req.params.id }, data: { isActive: false } }),
            prisma.directionPlan.updateMany({ where: { directionId: req.params.id }, data: { isActive: false } }),
            prisma.membershipPlan.updateMany({
                where: { directionId: req.params.id },
                data: { status: 'archived', isVisible: false },
            }),
        ]);
        res.json({ success: true, message: 'Направление отключено. История сохранена.' });
    } catch (error) {
        console.error('Delete direction error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при удалении направления' });
    }
});

module.exports = router;
