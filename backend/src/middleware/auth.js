const jwt = require('jsonwebtoken');
const { prisma } = require('../config/db');

const isLocalDemoUserId = (userId) => typeof userId === 'string' && userId.startsWith('demo_');

const buildLocalDemoUser = (decoded, userId) => ({
    id: userId,
    name: 'Локальный Админ',
    role: decoded.role || 'super_admin',
    isDemoUser: true
});

// Базовая проверка JWT токена (для всех авторизованных)
const authenticate = async (req, res, next) => {
    // Проверяем наличие JWT_SECRET
    if (!process.env.JWT_SECRET) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: JWT_SECRET не установлен в переменных окружения!');
        return res.status(500).json({
            success: false,
            error: 'Ошибка конфигурации сервера: JWT_SECRET не установлен'
        });
    }

    let token;

    // Получаем токен из заголовка Authorization
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        console.warn('⚠️  Запрос без токена:', req.method, req.path);
        return res.status(401).json({
            success: false,
            error: 'Доступ запрещен. Требуется авторизация.'
        });
    }

    try {
        // Проверяем токен
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Получаем пользователя из БД
        const userId = decoded.userId || decoded.id;

        if (!userId) {
            console.error('❌ Токен не содержит userId или id:', decoded);
            return res.status(401).json({
                success: false,
                error: 'Недействительный токен: отсутствует идентификатор пользователя'
            });
        }

        // Локальный demo-режим
        if (isLocalDemoUserId(userId)) {
            req.user = buildLocalDemoUser(decoded, userId);
            return next();
        }

        const user = await prisma.student.findUnique({ where: { id: userId } });

        if (!user) {
            console.error('❌ Пользователь не найден в БД:', userId);
            return res.status(401).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }

        delete user.password;
        req.user = user;

        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            console.error('❌ JWT ошибка (неверный токен):', error.message);
            return res.status(401).json({
                success: false,
                error: 'Недействительный токен. Пожалуйста, войдите в систему заново.'
            });
        } else if (error.name === 'TokenExpiredError') {
            console.error('❌ JWT ошибка (токен истек):', error.message);
            return res.status(401).json({
                success: false,
                error: 'Сессия истекла. Пожалуйста, войдите в систему заново.',
                expired: true
            });
        } else if (error.name === 'NotBeforeError') {
            console.error('❌ JWT ошибка (токен еще не активен):', error.message);
            return res.status(401).json({
                success: false,
                error: 'Токен еще не активен'
            });
        } else {
            console.error('❌ Auth error:', error.name, error.message);
            return res.status(401).json({
                success: false,
                error: 'Ошибка аутентификации. Пожалуйста, войдите в систему заново.'
            });
        }
    }
};

const requireSuperAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
    }
    if (req.user.role !== 'super_admin') {
        return res.status(403).json({ success: false, error: 'Доступ запрещен. Требуются права супер-администратора.' });
    }
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
    }
    if (!['admin', 'super_admin'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Доступ запрещен. Требуются права администратора.' });
    }
    next();
};

const requireSalesOrAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
    }
    if (!['sales_manager', 'admin', 'super_admin'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Доступ запрещен. Требуются права менеджера или администратора.' });
    }
    next();
};

const requireTeacherOrAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
    }
    if (!['teacher', 'admin', 'super_admin'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Доступ запрещен. Требуются права преподавателя или администратора.' });
    }
    next();
};

const requireNotStudent = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
    }
    if (req.user.role === 'student') {
        return res.status(403).json({ success: false, error: 'Доступ запрещен для студентов.' });
    }
    next();
};

const optionalAuth = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) return next();

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userId || decoded.id;

        if (isLocalDemoUserId(userId)) {
            req.user = buildLocalDemoUser(decoded, userId);
            return next();
        }

        const user = await prisma.student.findUnique({ where: { id: userId } });
        if (user) {
            delete user.password;
            req.user = user;
        } else {
            req.user = null;
        }
        next();
    } catch (error) {
        req.user = null;
        next();
    }
};

const checkPermission = (module, action) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, error: 'Требуется авторизация' });
        }

        if (module === 'bot') {
            if (['admin', 'super_admin'].includes(req.user.role)) return next();
            if (req.user.role === 'sales_manager' && ['read', 'delete'].includes(action)) return next();
            return res.status(403).json({ success: false, error: 'У вас нет прав для доступа к этому разделу' });
        }

        next();
    };
};

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });
};

module.exports = {
    authenticate,
    optionalAuth,
    requireSuperAdmin,
    requireAdmin,
    requireSalesOrAdmin,
    requireTeacherOrAdmin,
    requireNotStudent,
    generateToken,
    checkPermission,
    protect: authenticate,
    adminOnly: requireAdmin,
    teacherOrAdmin: requireTeacherOrAdmin
};

