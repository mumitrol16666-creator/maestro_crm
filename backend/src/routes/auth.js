const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { prisma } = require('../config/db');
const { authenticate, requireSuperAdmin } = require('../middleware/auth');
const { syncPasswordToLearningPlatform } = require('../services/userLink');

// @route   POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { phone, password } = req.body;

        const user = await prisma.student.findUnique({ where: { phone } });

        if (!user) {
            return res.status(401).json({ success: false, error: 'Неверный телефон или пароль' });
        }

        if (['student', 'teacher'].includes(user.role)) {
            return res.status(403).json({ success: false, error: 'Доступ запрещен. У вас нет прав для входа в CRM.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, error: 'Неверный телефон или пароль' });
        }

        const token = jwt.sign(
            { userId: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        console.log(`✅ Вход: ${user.name} (${user.role})`);

        res.json({
            success: true,
            token,
            user: {
                _id: user.id,
                name: user.name,
                lastName: user.lastName,
                phone: user.phone,
                role: user.role,
                email: user.email
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при входе' });
    }
});

// @route   POST /api/auth/register
router.post('/register', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { name, lastName, phone, password, gender, email } = req.body;

        if (!name || !lastName || !phone || !password || !gender) {
            return res.status(400).json({ success: false, error: 'Имя, фамилия, телефон, пароль и пол обязательны' });
        }

        const existing = await prisma.student.findUnique({ where: { phone } });
        if (existing) {
            return res.status(400).json({ success: false, error: 'Пользователь с таким телефоном уже существует' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.student.create({
            data: {
                name,
                lastName,
                phone,
                phoneDigits: phone.replace(/\D/g, ''),
                password: hashedPassword,
                gender: gender === 'male' ? 'male' : 'female',
                email: email || null,
                role: 'student'
            }
        });

        const token = jwt.sign(
            { userId: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            success: true,
            token,
            user: { _id: user.id, name: user.name, phone: user.phone, role: user.role, email: user.email }
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при регистрации' });
    }
});

// @route   PATCH /api/auth/change-password
router.patch('/change-password', authenticate, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, error: 'Текущий и новый пароль обязательны' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ success: false, error: 'Новый пароль должен быть не менее 8 символов' });
        }

        if (currentPassword === newPassword) {
            return res.status(400).json({ success: false, error: 'Новый пароль не должен совпадать с текущим' });
        }

        // authenticate middleware удаляет password из req.user, поэтому получаем заново
        const user = await prisma.student.findUnique({ where: { id: req.user.id } });

        if (!user) {
            return res.status(404).json({ success: false, error: 'Пользователь не найден' });
        }

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, error: 'Неверный текущий пароль' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await prisma.student.update({
            where: { id: req.user.id },
            data: { password: hashedPassword }
        });

        // Если ученик привязан к Learning Platform, отправляем туда новый пароль
        if (user.appUserId && user.externalLinkStatus === 'linked') {
            await syncPasswordToLearningPlatform(user.id, user.role, newPassword);
        }

        console.log(`🔑 Смена пароля: ${user.name} (id: ${user.id})`);

        res.json({ ok: true, message: 'Пароль успешно изменён' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при смене пароля' });
    }
});

module.exports = router;
