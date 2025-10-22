const { createClient } = require('redis');

// Создаем Redis клиент
const redisClient = createClient({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
            console.error('❌ Redis connection refused');
            return new Error('Redis connection refused');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
            console.error('❌ Redis retry time exhausted');
            return new Error('Retry time exhausted');
        }
        if (options.attempt > 10) {
            console.error('❌ Redis max retry attempts reached');
            return undefined;
        }
        return Math.min(options.attempt * 100, 3000);
    }
});

// Обработка ошибок подключения
redisClient.on('error', (err) => {
    console.error('❌ Redis Client Error:', err);
});

redisClient.on('connect', () => {
    console.log('✅ Redis connected');
});

redisClient.on('ready', () => {
    console.log('🚀 Redis ready');
});

// Подключение к Redis
const connectRedis = async () => {
    try {
        await redisClient.connect();
        console.log('✅ Redis connected successfully');
    } catch (error) {
        console.error('❌ Redis connection failed:', error);
        // Не прерываем работу приложения, если Redis недоступен
    }
};

// Утилиты для кэширования
const cacheUtils = {
    // Получить данные из кэша
    async get(key) {
        try {
            const cached = await redisClient.get(key);
            return cached ? JSON.parse(cached) : null;
        } catch (error) {
            console.error('Redis GET error:', error);
            return null;
        }
    },

    // Сохранить данные в кэш
    async set(key, data, ttl = 300) { // TTL по умолчанию 5 минут
        try {
            await redisClient.setEx(key, ttl, JSON.stringify(data));
            return true;
        } catch (error) {
            console.error('Redis SET error:', error);
            return false;
        }
    },

    // Удалить ключ из кэша
    async del(key) {
        try {
            await redisClient.del(key);
            return true;
        } catch (error) {
            console.error('Redis DEL error:', error);
            return false;
        }
    },

    // Удалить все ключи по паттерну
    async delPattern(pattern) {
        try {
            const keys = await redisClient.keys(pattern);
            if (keys.length > 0) {
                await redisClient.del(keys);
            }
            return true;
        } catch (error) {
            console.error('Redis DEL pattern error:', error);
            return false;
        }
    },

    // Проверить существование ключа
    async exists(key) {
        try {
            return await redisClient.exists(key);
        } catch (error) {
            console.error('Redis EXISTS error:', error);
            return false;
        }
    }
};

module.exports = {
    redisClient,
    connectRedis,
    cacheUtils
};
