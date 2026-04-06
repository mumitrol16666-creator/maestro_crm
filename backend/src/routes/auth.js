const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { prisma } = require('../config/db');

// @route   POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { phone, password } = req.body;

        const user = await prisma.student.findUnique({ where: { phone } });

        if (!user) {
            return res.status(401).json({ success: false, error: 'Неверный телефон или пароль' });
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
router.post('/register', async (req, res) => {
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

module.exports = router;
