const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const bcrypt = require('bcryptjs');

// GET /api/users
router.get('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const { role, search, page = 1, limit = 50 } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const where = { role: { not: 'student' } };

        if (role) where.role = role;
        if (search && search.trim()) {
            const term = search.trim();
            where.OR = [
                { name: { contains: term, mode: 'insensitive' } },
                { lastName: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term } }
            ];
        }

        const [users, total] = await Promise.all([
            prisma.student.findMany({
                where,
                select: { id: true, name: true, lastName: true, phone: true, email: true, role: true, status: true, createdAt: true, teacherDirections: true },
                orderBy: { createdAt: 'desc' },
                skip: (pageNum - 1) * limitNum, take: limitNum
            }),
            prisma.student.count({ where })
        ]);

        res.json({ success: true, users: users.map(u => ({ ...u, _id: u.id })), total, page: pageNum, pages: Math.ceil(total / limitNum) });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения пользователей' });
    }
});

// POST /api/users
router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const { name, lastName, phone, password, role, email, teacherDirections } = req.body;
        if (!name || !lastName || !phone || !password || !role) return res.status(400).json({ success: false, error: 'Все поля обязательны' });

        const existing = await prisma.student.findUnique({ where: { phone } });
        if (existing) return res.status(400).json({ success: false, error: 'Пользователь с таким телефоном уже существует' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.student.create({
            data: { name, lastName, phone, phoneDigits: phone.replace(/\D/g, ''), password: hashedPassword, role, email: email || null, teacherDirections: teacherDirections || [] }
        });

        res.status(201).json({ success: true, user: { ...user, _id: user.id, password: undefined } });
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ success: false, error: 'Ошибка создания пользователя' });
    }
});

// PUT /api/users/:id
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { name, lastName, phone, role, email, status, teacherDirections, password } = req.body;
        const data = {};
        if (name !== undefined) data.name = name;
        if (lastName !== undefined) data.lastName = lastName;
        if (phone !== undefined) { data.phone = phone; data.phoneDigits = phone.replace(/\D/g, ''); }
        if (role !== undefined) data.role = role;
        if (email !== undefined) data.email = email || null;
        if (status !== undefined) data.status = status;
        if (teacherDirections !== undefined) data.teacherDirections = teacherDirections;
        if (password) data.password = await bcrypt.hash(password, 10);

        const user = await prisma.student.update({ where: { id: req.params.id }, data });
        res.json({ success: true, user: { ...user, _id: user.id, password: undefined } });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ success: false, error: 'Ошибка обновления' });
    }
});

// DELETE /api/users/:id
router.delete('/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        await prisma.student.delete({ where: { id: req.params.id } });
        res.json({ success: true, message: 'Пользователь удален' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ success: false, error: 'Ошибка удаления' });
    }
});

module.exports = router;
