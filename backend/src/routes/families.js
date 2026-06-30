const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireSalesOrAdmin } = require('../middleware/auth');

// Нормализация карточки семьи (Mongoose-совместимый _id)
function mapFamily(family) {
    if (!family) return null;
    return {
        ...family,
        _id: family.id,
        students: Array.isArray(family.students)
            ? family.students.map(s => ({ ...s, _id: s.id }))
            : []
    };
}

// GET /api/families — список всех семей (для выбора в UI)
router.get('/', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { search } = req.query;
        const where = {};
        if (search && search.trim()) {
            const term = search.trim();
            where.OR = [
                { name: { contains: term, mode: 'insensitive' } },
                { students: { some: { name: { contains: term, mode: 'insensitive' } } } },
                { students: { some: { lastName: { contains: term, mode: 'insensitive' } } } }
            ];
        }
        const families = await prisma.family.findMany({
            where,
            include: {
                students: {
                    select: { id: true, name: true, lastName: true, middleName: true, phone: true }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        res.json({ success: true, families: families.map(mapFamily) });
    } catch (error) {
        console.error('List families error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения семей' });
    }
});

// POST /api/families — создать семью
router.post('/', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { name, studentIds } = req.body;
        const family = await prisma.family.create({
            data: { name: name || null }
        });
        // Если переданы учеников — сразу привязать их к новой семье
        if (Array.isArray(studentIds) && studentIds.length > 0) {
            await prisma.student.updateMany({
                where: { id: { in: studentIds } },
                data: { familyId: family.id }
            });
        }
        const full = await prisma.family.findUnique({
            where: { id: family.id },
            include: {
                students: {
                    select: { id: true, name: true, lastName: true, middleName: true, phone: true }
                }
            }
        });
        res.status(201).json({ success: true, family: mapFamily(full) });
    } catch (error) {
        console.error('Create family error:', error);
        res.status(500).json({ success: false, error: 'Ошибка создания семьи' });
    }
});

// GET /api/families/:id — семья + ученики
router.get('/:id', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const family = await prisma.family.findUnique({
            where: { id: req.params.id },
            include: {
                students: {
                    select: { id: true, name: true, lastName: true, middleName: true, phone: true }
                }
            }
        });
        if (!family) return res.status(404).json({ success: false, error: 'Семья не найдена' });
        res.json({ success: true, family: mapFamily(family) });
    } catch (error) {
        console.error('Get family error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения семьи' });
    }
});

// PATCH /api/families/:id — переименовать
router.patch('/:id', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        const family = await prisma.family.update({
            where: { id: req.params.id },
            data: { name: name === undefined ? undefined : (name || null) },
            include: {
                students: {
                    select: { id: true, name: true, lastName: true, middleName: true, phone: true }
                }
            }
        });
        res.json({ success: true, family: mapFamily(family) });
    } catch (error) {
        console.error('Update family error:', error);
        res.status(500).json({ success: false, error: 'Ошибка обновления семьи' });
    }
});

// POST /api/families/:id/members { studentId } — добавить ученика в семью
router.post('/:id/members', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { studentId } = req.body;
        if (!studentId) return res.status(400).json({ success: false, error: 'Укажите studentId' });

        const family = await prisma.family.findUnique({ where: { id: req.params.id } });
        if (!family) return res.status(404).json({ success: false, error: 'Семья не найдена' });

        await prisma.student.update({
            where: { id: studentId },
            data: { familyId: family.id }
        });

        const full = await prisma.family.findUnique({
            where: { id: family.id },
            include: {
                students: {
                    select: { id: true, name: true, lastName: true, middleName: true, phone: true }
                }
            }
        });
        res.json({ success: true, family: mapFamily(full) });
    } catch (error) {
        console.error('Add family member error:', error);
        res.status(500).json({ success: false, error: 'Ошибка добавления в семью' });
    }
});

// DELETE /api/families/:id/members/:studentId — убрать ученика из семьи
router.delete('/:id/members/:studentId', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { id, studentId } = req.params;
        const student = await prisma.student.findUnique({ where: { id: studentId } });
        if (!student || student.familyId !== id) {
            return res.status(404).json({ success: false, error: 'Ученик не в этой семье' });
        }
        await prisma.student.update({
            where: { id: studentId },
            data: { familyId: null }
        });

        const full = await prisma.family.findUnique({
            where: { id },
            include: {
                students: {
                    select: { id: true, name: true, lastName: true, middleName: true, phone: true }
                }
            }
        });
        res.json({ success: true, family: mapFamily(full) });
    } catch (error) {
        console.error('Remove family member error:', error);
        res.status(500).json({ success: false, error: 'Ошибка удаления из семьи' });
    }
});

// DELETE /api/families/:id — удалить семью (предварительно отвязав учеников)
router.delete('/:id', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.student.updateMany({
            where: { familyId: id },
            data: { familyId: null }
        });
        await prisma.family.delete({ where: { id } });
        res.json({ success: true });
    } catch (error) {
        console.error('Delete family error:', error);
        res.status(500).json({ success: false, error: 'Ошибка удаления семьи' });
    }
});

module.exports = router;
