const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Student = require('../models/Student');

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', async (req, res) => {
    try {
        const { phone, password } = req.body;

        // Найти пользователя по телефону (включая пароль)
        const user = await Student.findOne({ phone }).select('+password');
        
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Неверный телефон или пароль'
            });
        }

        // Проверить пароль
        const isMatch = await user.comparePassword(password);
        
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                error: 'Неверный телефон или пароль'
            });
        }

        // Создать JWT токен
        const token = jwt.sign(
            { userId: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        console.log(`✅ Вход выполнен: ${user.name} (${user.role})`);

        res.json({
            success: true,
            token,
            user: {
                _id: user._id,
                name: user.name,
                phone: user.phone,
                role: user.role,
                email: user.email
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при входе'
        });
    }
});

// @route   POST /api/auth/register
// @desc    Register new user (student)
// @access  Public
router.post('/register', async (req, res) => {
    try {
        const { name, phone, password, gender, email } = req.body;

        // Валидация обязательных полей
        if (!name || !phone || !password || !gender) {
            return res.status(400).json({
                success: false,
                error: 'Имя, телефон, пароль и пол обязательны'
            });
        }

        // Проверить существует ли пользователь
        const existingUser = await Student.findOne({ phone });
        
        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'Пользователь с таким телефоном уже существует'
            });
        }

        // Создать нового пользователя
        const user = await Student.create({
            name,
            phone,
            password,
            gender,
            email,
            role: 'student',
            groups: []
        });

        // Создать JWT токен
        const token = jwt.sign(
            { userId: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        console.log(`✅ Регистрация: ${user.name}`);

        res.status(201).json({
            success: true,
            token,
            user: {
                _id: user._id,
                name: user.name,
                phone: user.phone,
                role: user.role,
                email: user.email
            }
        });
    } catch (error) {
        console.error('Register error:', error);
        
        // Если ошибка валидации - возвращаем 400
        if (error.name === 'ValidationError') {
            return res.status(400).json({
                success: false,
                error: 'Ошибка валидации',
                errors: Object.keys(error.errors).map(key => ({
                    field: key,
                    message: error.errors[key].message
                }))
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Ошибка при регистрации'
        });
    }
});

module.exports = router;

