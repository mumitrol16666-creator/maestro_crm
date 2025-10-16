const jwt = require('jsonwebtoken');
const Student = require('../models/Student');

// Базовая проверка JWT токена (для всех авторизованных)
const authenticate = async (req, res, next) => {
    let token;
    
    // Получаем токен из заголовка Authorization
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }
    
    if (!token) {
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
        req.user = await Student.findById(userId).select('-password');
        
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        next();
    } catch (error) {
        console.error('Auth error:', error);
        return res.status(401).json({
            success: false,
            error: 'Недействительный токен'
        });
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

// Генерация JWT токена
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });
};

module.exports = {
    authenticate,
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

