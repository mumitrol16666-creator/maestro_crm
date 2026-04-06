const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const bcrypt = require('bcryptjs');

// ============================
// Role-specific endpoints (MUST be before /:id routes)
// ============================

// POST /api/users/teachers
router.post('/teachers', authenticate, requireAdmin, async (req, res) => {
    try {
        const { name, lastName, phone, password, gender, directions, bio, photo } = req.body;
        if (!name || !lastName || !phone || !password) return res.status(400).json({ success: false, error: 'Все поля обязательны' });

        const existing = await prisma.student.findUnique({ where: { phone } });
        if (existing) return res.status(400).json({ success: false, error: 'Пользователь с таким телефоном уже существует' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.student.create({
            data: {
                name, lastName, phone, phoneDigits: phone.replace(/\D/g, ''),
                password: hashedPassword, role: 'teacher',
                gender: gender === 'female' ? 'female' : 'male',
                teacherDirections: directions || [],
                teacherBio: bio || '', teacherPhoto: photo || ''
            }
        });

        console.log(`✅ Создан преподаватель: ${name} ${lastName}`);
        res.status(201).json({ success: true, teacher: { ...user, _id: user.id, password: undefined }, generatedPassword: password });
    } catch (error) {
        console.error('Create teacher error:', error);
        res.status(500).json({ success: false, error: 'Ошибка создания преподавателя' });
    }
});

// PATCH /api/users/teachers/:id
router.patch('/teachers/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { name, lastName, directions, bio, photo, displayOrder } = req.body;
        const data = {};
        if (name !== undefined) data.name = name;
        if (lastName !== undefined) data.lastName = lastName;
        if (directions !== undefined) data.teacherDirections = directions;
        if (bio !== undefined) data.teacherBio = bio;
        if (photo !== undefined) data.teacherPhoto = photo;
        if (displayOrder !== undefined) data.teacherDisplayOrder = displayOrder;

        const user = await prisma.student.update({ where: { id: req.params.id }, data });
        res.json({ success: true, teacher: { ...user, _id: user.id, password: undefined } });
    } catch (error) {
        console.error('Update teacher error:', error);
        res.status(500).json({ success: false, error: 'Ошибка обновления преподавателя' });
    }
});

// DELETE /api/users/teachers/:id
router.delete('/teachers/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const teacherId = req.params.id;
        
        // Проверяем, есть ли привязанные группы
        const groupsCount = await prisma.group.count({ where: { teacherId } });
        if (groupsCount > 0) {
            return res.status(400).json({ success: false, error: `Невозможно удалить преподавателя. Сначала отвяжите его от ${groupsCount} групп(ы).` });
        }

        await prisma.student.delete({ where: { id: teacherId } });
        res.json({ success: true, message: 'Преподаватель удален' });
    } catch (error) {
        console.error('Delete teacher error:', error);
        res.status(500).json({ success: false, error: 'Ошибка удаления преподавателя' });
    }
});

// POST /api/users/admins
router.post('/admins', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { name, lastName, phone, password, gender } = req.body;
        if (!name || !lastName || !phone || !password) return res.status(400).json({ success: false, error: 'Все поля обязательны' });

        const existing = await prisma.student.findUnique({ where: { phone } });
        if (existing) return res.status(400).json({ success: false, error: 'Пользователь с таким телефоном уже существует' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.student.create({
            data: {
                name, lastName, phone, phoneDigits: phone.replace(/\D/g, ''),
                password: hashedPassword, role: 'admin',
                gender: gender === 'female' ? 'female' : 'male'
            }
        });

        console.log(`✅ Создан администратор: ${name} ${lastName}`);
        res.status(201).json({ success: true, admin: { ...user, _id: user.id, password: undefined }, generatedPassword: password });
    } catch (error) {
        console.error('Create admin error:', error);
        res.status(500).json({ success: false, error: 'Ошибка создания администратора' });
    }
});

// DELETE /api/users/admins/:id
router.delete('/admins/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        await prisma.student.delete({ where: { id: req.params.id } });
        res.json({ success: true, message: 'Администратор удален' });
    } catch (error) {
        console.error('Delete admin error:', error);
        res.status(500).json({ success: false, error: 'Ошибка удаления' });
    }
});

// POST /api/users/sales-managers
router.post('/sales-managers', authenticate, requireAdmin, async (req, res) => {
    try {
        const { name, lastName, phone, password, gender } = req.body;
        if (!name || !lastName || !phone || !password) return res.status(400).json({ success: false, error: 'Все поля обязательны' });

        const existing = await prisma.student.findUnique({ where: { phone } });
        if (existing) return res.status(400).json({ success: false, error: 'Пользователь с таким телефоном уже существует' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.student.create({
            data: {
                name, lastName, phone, phoneDigits: phone.replace(/\D/g, ''),
                password: hashedPassword, role: 'sales_manager',
                gender: gender === 'female' ? 'female' : 'male'
            }
        });

        console.log(`✅ Создан менеджер: ${name} ${lastName}`);
        res.status(201).json({ success: true, manager: { ...user, _id: user.id, password: undefined }, generatedPassword: password });
    } catch (error) {
        console.error('Create sales manager error:', error);
        res.status(500).json({ success: false, error: 'Ошибка создания менеджера' });
    }
});

// DELETE /api/users/sales-managers/:id
router.delete('/sales-managers/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        await prisma.student.delete({ where: { id: req.params.id } });
        res.json({ success: true, message: 'Менеджер удален' });
    } catch (error) {
        console.error('Delete sales manager error:', error);
        res.status(500).json({ success: false, error: 'Ошибка удаления' });
    }
});

// POST /api/users/upload-teacher-photo
router.post('/upload-teacher-photo', authenticate, requireAdmin, (req, res) => {
    // TODO: implement file upload (multer)
    res.status(501).json({ success: false, error: 'Загрузка фото пока не реализована' });
});

// ============================
// Generic endpoints (after role-specific)
// ============================

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

// PATCH /api/users/:id/change-role
router.patch('/:id/change-role', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { role } = req.body;
        const validRoles = ['admin', 'super_admin', 'sales_manager', 'teacher', 'student'];
        if (!validRoles.includes(role)) return res.status(400).json({ success: false, error: 'Неверная роль' });

        const user = await prisma.student.update({ where: { id: req.params.id }, data: { role } });
        res.json({ success: true, user: { ...user, _id: user.id, password: undefined } });
    } catch (error) {
        console.error('Change role error:', error);
        res.status(500).json({ success: false, error: 'Ошибка изменения роли' });
    }
});

// POST /api/users/:id/reset-password
router.post('/:id/reset-password', authenticate, requireAdmin, async (req, res) => {
    try {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let newPassword = '';
        for (let i = 0; i < 8; i++) newPassword += chars.charAt(Math.floor(Math.random() * chars.length));

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await prisma.student.update({ where: { id: req.params.id }, data: { password: hashedPassword } });

        res.json({ success: true, newPassword });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ success: false, error: 'Ошибка сброса пароля' });
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
