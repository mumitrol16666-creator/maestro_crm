const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const dotenv = require('dotenv');
const cron = require('node-cron');
const axios = require('axios');
const connectDB = require('./config/db');

// Загрузка переменных окружения
dotenv.config();

// Подключение к MongoDB ТОЛЬКО если не в тестах
if (process.env.NODE_ENV !== 'test') {
    connectDB();
}

// Создание Express приложения
const app = express();

// Middleware
app.use(helmet());
app.use(cors({
    origin: function(origin, callback) {
        // Разрешаем запросы без origin (например, мобильные приложения или Postman)
        if (!origin) return callback(null, true);
        
        // Разрешаем localhost и любой IP из локальной сети 192.168.x.x
        const allowedOrigins = [
            'http://localhost:8000',
            'http://127.0.0.1:8000'
        ];
        
        // Проверяем локальную сеть (192.168.x.x)
        const isLocalNetwork = /^http:\/\/192\.168\.\d+\.\d+:8000$/.test(origin);
        
        if (allowedOrigins.includes(origin) || isLocalNetwork) {
            callback(null, true);
        } else {
            console.warn(`⚠️  Blocked by CORS: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users')); // Управление ролями
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/students', require('./routes/students'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/directions', require('./routes/directions')); // Управление направлениями
app.use('/api/rooms', require('./routes/rooms')); // Управление залами
app.use('/api/permissions', require('./routes/permissions')); // Управление правами ролей
app.use('/api/classes', require('./routes/classes')); // Расписание занятий
app.use('/api/memberships', require('./routes/memberships')); // Абонементы
app.use('/api/freezes', require('./routes/freezes')); // Заморозки
app.use('/api/payments', require('./routes/payments'));
app.use('/api/admin', require('./routes/admin'));

// Базовый route
app.get('/', (req, res) => {
    res.json({
        message: '💃 Sense of Dance API',
        version: '1.0.0',
        status: 'active',
        endpoints: {
            auth: '/api/auth',
            users: '/api/users (управление ролями)',
            bookings: '/api/bookings',
            students: '/api/students',
            groups: '/api/groups',
            directions: '/api/directions (управление направлениями)',
            rooms: '/api/rooms (управление залами)',
            permissions: '/api/permissions (управление правами ролей)',
            classes: '/api/classes (календарь занятий)',
            memberships: '/api/memberships',
            practices: '/api/practices',
            payments: '/api/payments',
            admin: '/api/admin'
        }
    });
});

// 404 Handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl
    });
});

// Error Handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    
    res.status(err.status || 500).json({
        error: err.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// Запуск сервера
const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0'; // Слушаем на всех сетевых интерфейсах

app.listen(PORT, HOST, () => {
    console.log('\n🚀 ========================================');
    console.log(`💃 Sense of Dance API Server`);
    console.log(`📡 Local:   http://localhost:${PORT}`);
    console.log(`📡 Network: http://192.168.100.30:${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
    console.log(`🗄️  Database: ${process.env.MONGODB_URI ? 'Connected' : 'Waiting...'}`);
    console.log('========================================\n');
});

// ⏰ CRON JOB: Автоматическое списание занятий каждые 30 минут
// Запускаем ТОЛЬКО если не в test mode
if (process.env.NODE_ENV !== 'test') {
    cron.schedule('*/30 * * * *', async () => {
        try {
            console.log('⏰ [CRON] Запуск автоматического списания занятий...');
        
        // Вызываем внутренний эндпоинт для списания занятий
        const Class = require('./models/Class');
        const Student = require('./models/Student');
        const Membership = require('./models/Membership');
        
        // Используем логику из routes/classes.js напрямую
        const now = new Date();
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const classes = await Class.find({
            date: { $gte: sevenDaysAgo, $lt: now },
            group: { $ne: null }
        }).populate('group attendees.student');
        
        let stats = { totalClasses: classes.length, deducted: 0, frozen: 0, alreadyMarked: 0, skipped: 0 };
        
        for (const cls of classes) {
            if (!cls.group || !cls.attendees || cls.attendees.length === 0) continue;
            
            for (const attendee of cls.attendees) {
                if (!attendee.student || attendee.deducted || attendee.attended) {
                    if (attendee.deducted || attendee.attended) stats.alreadyMarked++;
                    continue;
                }
                
                const student = await Student.findById(attendee.student._id).populate('activeMembership');
                if (!student || !student.activeMembership || student.activeMembership.status !== 'active') {
                    stats.skipped++;
                    continue;
                }
                
                const membership = student.activeMembership;
                if (membership.classesRemaining > 0) {
                    membership.classesRemaining -= 1;
                    membership.classesUsed += 1;
                    await membership.save();
                    attendee.deducted = true;
                    await cls.save();
                    stats.deducted++;
                } else {
                    stats.skipped++;
                }
            }
        }
        
            console.log(`✅ [CRON] Автоматическое списание завершено:`, stats);
        } catch (error) {
            console.error('❌ [CRON] Ошибка автоматического списания:', error);
        }
    });
    console.log('⏰ Cron job настроен: автоматическое списание занятий каждые 30 минут');
} else {
    console.log('⚠️  Cron job отключен (test mode)');
}

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\nSIGINT received. Shutting down gracefully...');
    process.exit(0);
});

// Экспортируем app для тестов
module.exports = app;
