#!/usr/bin/env node

/**
 * Диагностический скрипт для проверки состояния API
 * Проверяет:
 * - Наличие и корректность .env файла
 * - Подключение к MongoDB
 * - Подключение к Redis
 * - JWT_SECRET
 */

require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

console.log('\n🔍 ========================================');
console.log('   ДИАГНОСТИКА API СЕРВЕРА');
console.log('========================================\n');

// 1. Проверка переменных окружения
console.log('1️⃣  Проверка переменных окружения:');
console.log('   ✓ NODE_ENV:', process.env.NODE_ENV || '❌ НЕ УСТАНОВЛЕН');
console.log('   ✓ PORT:', process.env.PORT || '❌ НЕ УСТАНОВЛЕН');
console.log('   ✓ MONGODB_URI:', process.env.MONGODB_URI ? '✅ УСТАНОВЛЕН' : '❌ НЕ УСТАНОВЛЕН');
console.log('   ✓ JWT_SECRET:', process.env.JWT_SECRET ? '✅ УСТАНОВЛЕН (' + process.env.JWT_SECRET.length + ' символов)' : '❌ НЕ УСТАНОВЛЕН - ЭТО ПРОБЛЕМА!');
console.log('   ✓ REDIS_HOST:', process.env.REDIS_HOST || 'localhost (по умолчанию)');
console.log('   ✓ REDIS_PORT:', process.env.REDIS_PORT || '6379 (по умолчанию)');

if (!process.env.JWT_SECRET) {
    console.log('\n❌ КРИТИЧЕСКАЯ ОШИБКА: JWT_SECRET не установлен!');
    console.log('   Это объясняет все 401 ошибки.');
    console.log('   Решение: проверьте файл .env в /root/sense-of-dance/backend/.env\n');
    process.exit(1);
}

// 2. Проверка подключения к MongoDB
console.log('\n2️⃣  Проверка подключения к MongoDB:');
const testMongoConnection = async () => {
    try {
        if (!process.env.MONGODB_URI) {
            console.log('   ❌ MONGODB_URI не установлен');
            return false;
        }
        
        await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000
        });
        console.log('   ✅ MongoDB подключен успешно');
        
        // Проверяем, можем ли найти пользователей
        const Student = require('./src/models/Student');
        const userCount = await Student.countDocuments();
        console.log('   ✅ Найдено пользователей в БД:', userCount);
        
        await mongoose.disconnect();
        return true;
    } catch (error) {
        console.log('   ❌ Ошибка подключения к MongoDB:', error.message);
        return false;
    }
};

// 3. Проверка JWT токена (тестовая генерация)
console.log('\n3️⃣  Проверка JWT токена:');
try {
    const testToken = jwt.sign({ id: 'test' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const decoded = jwt.verify(testToken, process.env.JWT_SECRET);
    console.log('   ✅ JWT токен генерируется и проверяется корректно');
} catch (error) {
    console.log('   ❌ Ошибка работы с JWT:', error.message);
}

// 4. Проверка Redis (опционально)
console.log('\n4️⃣  Проверка Redis:');
const testRedisConnection = async () => {
    try {
        const { createClient } = require('redis');
        const redisClient = createClient({
            socket: {
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379
            },
            password: process.env.REDIS_PASSWORD || undefined
        });
        
        redisClient.on('error', (err) => {
            console.log('   ⚠️  Redis не доступен (это не критично):', err.message);
        });
        
        await redisClient.connect();
        await redisClient.ping();
        console.log('   ✅ Redis подключен успешно');
        await redisClient.quit();
        return true;
    } catch (error) {
        console.log('   ⚠️  Redis не доступен (это не критично):', error.message);
        return false;
    }
};

// Запуск всех проверок
(async () => {
    const mongoOk = await testMongoConnection();
    await testRedisConnection();
    
    console.log('\n📊 ========================================');
    console.log('   ИТОГОВЫЙ СТАТУС');
    console.log('========================================\n');
    
    if (!process.env.JWT_SECRET) {
        console.log('❌ КРИТИЧЕСКАЯ ПРОБЛЕМА: JWT_SECRET отсутствует');
        console.log('   → Все запросы будут возвращать 401');
        process.exit(1);
    }
    
    if (!mongoOk) {
        console.log('❌ КРИТИЧЕСКАЯ ПРОБЛЕМА: MongoDB недоступен');
        console.log('   → API не может найти пользователей');
        process.exit(1);
    }
    
    console.log('✅ Все критичные компоненты работают');
    console.log('\n💡 Если API все еще возвращает 401:');
    console.log('   1. Проверьте логи PM2: pm2 logs sense-of-dance-backend');
    console.log('   2. Перезапустите сервер: pm2 restart sense-of-dance-backend');
    console.log('   3. Проверьте, что токены в браузере были созданы с тем же JWT_SECRET\n');
    
    process.exit(0);
})();

