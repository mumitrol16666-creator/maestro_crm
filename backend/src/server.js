require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cron = require('node-cron');
const axios = require('axios');
const { connectDB, prisma } = require('./config/db');
const { connectRedis } = require('./config/redis');

// Load environment variables (Moved to top)


if (process.env.NODE_ENV !== 'test') {
    connectDB().then(async () => {
        // Migration logic for permissions using Prisma
        try {
            const rolesToFix = ['sales_manager', 'admin', 'super_admin'];
            for (const role of rolesToFix) {
                const doc = await prisma.rolePermissions.findUnique({ where: { role } });
                if (doc && doc.visibility && !(doc.visibility).bot) {
                    console.log(`🛠️ [MIGRATION] Fixing bot visibility for ${role}...`);
                    await prisma.rolePermissions.update({
                        where: { role },
                        data: {
                            visibility: {
                                ...doc.visibility,
                                bot: true
                            }
                        }
                    });
                    console.log(`✅ [MIGRATION] ${role} updated.`);
                }
            }
        } catch (err) {
            console.error('⚠️ [MIGRATION] Failed to update permissions:', err.message);
        }
    });
    // connectRedis(); // Uncomment when redis is setup
}

const app = express();

app.use(helmet());

// Запрещаем кэширование ВСЕХ API запросов браузерами (особенно агрессивный кэш Safari)
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);

        const allowedOrigins = [
            'http://localhost:8000',
            'http://localhost:3000',
            'http://127.0.0.1:8000',
            'http://127.0.0.1:3000',
            'http://149.33.0.114',
            'http://149.33.0.114:3000',
            'http://65.108.61.178',
            'http://65.108.61.178:3000',
            'https://senseofdance.kz',
            'https://www.senseofdance.kz',
            'http://senseofdance.kz',
            'http://www.senseofdance.kz'
        ];

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

app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

app.get('/api/health/diagnostic', (req, res) => {
    const diagnostics = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: {
            NODE_ENV: process.env.NODE_ENV || 'NOT SET',
            PORT: process.env.PORT || 'NOT SET',
            JWT_SECRET: process.env.JWT_SECRET ? `SET (${process.env.JWT_SECRET.length} chars)` : '❌ NOT SET',
            DATABASE_URL: process.env.DATABASE_URL ? 'SET' : '❌ NOT SET',
            REDIS_HOST: process.env.REDIS_HOST || 'localhost (default)',
            REDIS_PORT: process.env.REDIS_PORT || '6379 (default)'
        },
        issues: []
    };

    if (!process.env.JWT_SECRET) {
        diagnostics.issues.push('JWT_SECRET не установлен');
        diagnostics.status = 'error';
    }

    if (!process.env.DATABASE_URL) {
        diagnostics.issues.push('DATABASE_URL не установлен');
        diagnostics.status = 'error';
    }

    const statusCode = diagnostics.status === 'error' ? 500 : 200;
    res.status(statusCode).json(diagnostics);
});

// -- COMMENTED ROUTES FOR INCREMENTAL REFACTORING --
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/students', require('./routes/students'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/directions', require('./routes/directions'));
app.use('/api/rooms', require('./routes/rooms'));
app.use('/api/permissions', require('./routes/permissions'));
app.use('/api/classes', require('./routes/classes'));
app.use('/api/memberships', require('./routes/memberships'));
app.use('/api/payments', require('./routes/payments'));
// app.use('/api/cashbox', require('./routes/cashbox')); // Needs Migration
// app.use('/api/cash-transactions', require('./routes/cashTransactions')); // Needs Migration
app.use('/api/commission-config', require('./routes/commission-config'));
app.use('/api/salary', require('./routes/salary'));
// app.use('/api/blog', require('./routes/blog')); // Needs Migration
app.use('/api/admin', require('./routes/admin'));
app.use('/api/freezes', require('./routes/freezes'));
app.use('/api/performance', require('./routes/performance'));
app.use('/api/activity-logs', require('./routes/activityLogs'));
// app.use('/api/bot', require('./routes/bot')); // Needs Migration

app.get('/', (req, res) => {
    res.json({
        message: '💃 Sense of Dance API (Prisma Migration Progress)',
        version: '1.0.0',
        status: 'migrating'
    });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Route not found or under migration', path: req.originalUrl });
});

app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        error: err.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

const PORT = process.env.PORT || 5001;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log('\n🚀 ========================================');
    console.log(`💃 Sense of Dance API Server (Prisma)`);
    console.log(`📡 Local:   http://localhost:${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
    console.log('========================================\n');
});

const gracefulShutdown = async (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    await prisma.$disconnect();
    process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;
