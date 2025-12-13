const jwt = require('jsonwebtoken');
const Student = require('../models/Student');

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
        
        // Получаем пользователя из БД (поддержка обоих форматов: id и userId)
        const userId = decoded.userId || decoded.id;
        
        if (!userId) {
            console.error('❌ Токен не содержит userId или id:', decoded);
            return res.status(401).json({
                success: false,
                error: 'Недействительный токен: отсутствует идентификатор пользователя'
            });
        }
        
        req.user = await Student.findById(userId).select('-password');
        
        if (!req.user) {
            console.error('❌ Пользователь не найден в БД:', userId);
            return res.status(401).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        next();
    } catch (error) {
        // Детальное логирование ошибок
        if (error.name === 'JsonWebTokenError') {
            console.error('❌ JWT ошибка (неверный токен):', error.message);
            return res.status(401).json({
                success: false,
                error: 'Недействительный токен. Пожалуйста, войдите в систему заново.'
            });
        } else if (error.name === 'TokenExpiredError') {
            console.error('❌ JWT ошибка (токен истек):', error.message);
            if (error.expiredAt) {
                console.error('   Токен истек:', new Date(error.expiredAt).toLocaleString());
            }
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

// Проверка роли Super Admin (только владелец)
const requireSuperAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'Требуется авторизация'
        });
    }
    
    if (req.user.role !== 'super_admin') {
        return res.status(403).json({
            success: false,
            error: 'Доступ запрещен. Требуются права супер-администратора.'
        });
    }
    
    next();
};

// Проверка роли Admin или Super Admin
const requireAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'Требуется авторизация'
        });
    }
    
    if (!['admin', 'super_admin'].includes(req.user.role)) {
        return res.status(403).json({
            success: false,
            error: 'Доступ запрещен. Требуются права администратора.'
        });
    }
    
    next();
};

// Проверка роли Sales Manager, Admin или Super Admin
const requireSalesOrAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'Требуется авторизация'
        });
    }
    
    if (!['sales_manager', 'admin', 'super_admin'].includes(req.user.role)) {
        return res.status(403).json({
            success: false,
            error: 'Доступ запрещен. Требуются права менеджера или администратора.'
        });
    }
    
    next();
};

// Проверка роли Teacher, Admin или Super Admin
const requireTeacherOrAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'Требуется авторизация'
        });
    }
    
    if (!['teacher', 'admin', 'super_admin'].includes(req.user.role)) {
        return res.status(403).json({
            success: false,
            error: 'Доступ запрещен. Требуются права преподавателя или администратора.'
        });
    }
    
    next();
};

// Проверка роли: все, кроме студентов (для дашборда)
const requireNotStudent = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'Требуется авторизация'
        });
    }
    
    if (req.user.role === 'student') {
        return res.status(403).json({
            success: false,
            error: 'Доступ запрещен для студентов.'
        });
    }
    
    next();
};

// Опциональная проверка JWT токена (не блокирует запрос, если токен отсутствует)
const optionalAuth = async (req, res, next) => {
    let token;
    
    // Получаем токен из заголовка Authorization
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }
    
    // Если токена нет - просто продолжаем без req.user
    if (!token) {
        return next();
    }
    
    try {
        // Проверяем токен
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Получаем пользователя из БД (поддержка обоих форматов: id и userId)
        const userId = decoded.userId || decoded.id;
        req.user = await Student.findById(userId).select('-password');
        
        // Если пользователь не найден - продолжаем без req.user
        if (!req.user) {
            req.user = null;
        }
        
        next();
    } catch (error) {
        // Если токен недействителен - продолжаем без req.user
        req.user = null;
        next();
    }
};

// Генерация JWT токена
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
    // Алиасы для совместимости со старым кодом
    protect: authenticate,
    adminOnly: requireAdmin,
    teacherOrAdmin: requireTeacherOrAdmin
};

