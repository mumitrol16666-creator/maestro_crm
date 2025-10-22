const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const dotenv = require('dotenv');
const cron = require('node-cron');
const axios = require('axios');
const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');

// Загрузка переменных окружения
dotenv.config();

// Подключение к MongoDB ТОЛЬКО если не в тестах
if (process.env.NODE_ENV !== 'test') {
    connectDB();
    connectRedis();
}

// Создание Express приложения
const app = express();

// Middleware
app.use(helmet());
app.use(cors({
    origin: function(origin, callback) {
        // Разрешаем запросы без origin (например, мобильные приложения или Postman)
        if (!origin) return callback(null, true);
        
        // Разрешаем localhost, продакшн сервер, домен и любой IP из локальной сети 192.168.x.x
        const allowedOrigins = [
            'http://localhost:8000',
            'http://localhost:3000',
            'http://127.0.0.1:8000',
            'http://127.0.0.1:3000',
            'http://149.33.0.114',
            'http://149.33.0.114:3000',
            'https://senseofdance.kz',
            'https://www.senseofdance.kz',
            'http://senseofdance.kz',
            'http://www.senseofdance.kz'
        ];
        
        // Проверяем локальную сеть (192.168.x.x)
        const isLocalNetwork = /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin);
        
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

// Health check endpoint (для мониторинга)
app.get('/api/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

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
app.use('/api/payments', require('./routes/payments')); // Платежи
app.use('/api/cashbox', require('./routes/cashbox')); // Касса
app.use('/api/cash-transactions', require('./routes/cashTransactions')); // Транзакции кассы (расходы/доходы)
app.use('/api/commission-config', require('./routes/commission-config')); // Настройки комиссий
app.use('/api/blog', require('./routes/blog')); // Блог
app.use('/api/admin', require('./routes/admin'));
app.use('/api/performance', require('./routes/performance')); // Мониторинг производительности

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
        
            const Class = require('./models/Class');
            const Student = require('./models/Student');
            const Membership = require('./models/Membership');
            const Freeze = require('./models/Freeze');
            
            const now = new Date();
            
            // Найти ВСЕ прошедшие занятия (НЕ практики) за последние 7 дней
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            
            const pastClasses = await Class.find({
                date: { $gte: sevenDaysAgo },
                group: { $ne: null },
                isPractice: { $ne: true }
            }).populate('group');
            
            // Фильтруем только те, которые РЕАЛЬНО закончились (по времени окончания)
            const reallyPastClasses = [];
            for (const cls of pastClasses) {
                const classDate = new Date(cls.date);
                const [endHours, endMinutes] = cls.endTime.split(':');
                classDate.setHours(parseInt(endHours), parseInt(endMinutes), 0, 0);
                
                if (classDate < now) {
                    reallyPastClasses.push(cls);
                }
            }
            
            console.log(`🔍 [CRON] Найдено прошедших занятий: ${reallyPastClasses.length}`);
            
            let stats = { totalClasses: reallyPastClasses.length, deducted: 0, frozen: 0, alreadyMarked: 0, skipped: 0 };
            
            for (const classItem of reallyPastClasses) {
                // Найти ВСЕХ студентов этой группы
                const groupStudents = await Student.find({
                    'groups.groupId': classItem.group._id,
                    'groups.status': 'active',
                    status: 'active'
                }).populate('activeMembership');
                
                for (const student of groupStudents) {
                    // Проверяем, не отмечен ли уже этот студент
                    const alreadyMarked = classItem.attendees.some(a => 
                        a.student && a.student.toString() === student._id.toString()
                    );
                    
                    if (alreadyMarked) {
                        stats.alreadyMarked++;
                        continue;
                    }
                    
                    // Проверяем активный абонемент
                    const membership = student.activeMembership;
                    if (!membership || membership.status !== 'active' || membership.classesRemaining <= 0) {
                        stats.skipped++;
                        continue;
                    }
                    
                    // Проверяем заморозку
                    const activeFreeze = await Freeze.findOne({
                        student: student._id,
                        startDate: { $lte: classItem.date },
                        endDate: { $gte: classItem.date }
                    });
                    
                    if (activeFreeze && activeFreeze.classesRemaining > 0) {
                        // Списываем с заморозки
                        await activeFreeze.useClass();
                        stats.frozen++;
                    } else {
                        // Списываем с абонемента
                        await membership.deductClass(classItem._id, 'Автоматическое списание (занятие прошло)');
                        stats.deducted++;
                    }
                    
                    // Добавляем запись в attendees как "отсутствовал" (auto)
                    classItem.attendees.push({
                        student: student._id,
                        attended: false,
                        markedAt: new Date(),
                        autoDeducted: true
                    });
                }
                
                await classItem.save();
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
