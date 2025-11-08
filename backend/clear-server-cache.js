const { createClient } = require('redis');
require('dotenv').config();

async function clearServerCache() {
    // Используем настройки Redis с сервера
    const redisClient = createClient({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined
    });

    try {
        await redisClient.connect();
        console.log('✅ Подключено к Redis серверу');

        // Очищаем все ключи кассы
        const cashboxKeys = await redisClient.keys('cashbox:*');
        if (cashboxKeys.length > 0) {
            await redisClient.del(cashboxKeys);
            console.log(`🗑️  Удалено ключей кассы: ${cashboxKeys.length}`);
        } else {
            console.log('📦 Ключей кассы не найдено');
        }

        // Очищаем все ключи платежей
        const paymentKeys = await redisClient.keys('payments:*');
        if (paymentKeys.length > 0) {
            await redisClient.del(paymentKeys);
            console.log(`🗑️  Удалено ключей платежей: ${paymentKeys.length}`);
        } else {
            console.log('📦 Ключей платежей не найдено');
        }

        // Очищаем все ключи админ статистики
        const adminKeys = await redisClient.keys('admin:stats:*');
        if (adminKeys.length > 0) {
            await redisClient.del(adminKeys);
            console.log(`🗑️  Удалено ключей админ статистики: ${adminKeys.length}`);
        } else {
            console.log('📦 Ключей админ статистики не найдено');
        }

        // Очищаем все ключи заявок
        const bookingKeys = await redisClient.keys('bookings:*');
        if (bookingKeys.length > 0) {
            await redisClient.del(bookingKeys);
            console.log(`🗑️  Удалено ключей заявок: ${bookingKeys.length}`);
        } else {
            console.log('📦 Ключей заявок не найдено');
        }

        // Очищаем все ключи студентов
        const studentKeys = await redisClient.keys('students:*');
        if (studentKeys.length > 0) {
            await redisClient.del(studentKeys);
            console.log(`🗑️  Удалено ключей студентов: ${studentKeys.length}`);
        } else {
            console.log('📦 Ключей студентов не найдено');
        }

        console.log('✅ Кэш сервера полностью очищен');
        
    } catch (error) {
        console.error('❌ Ошибка очистки кэша:', error);
    } finally {
        await redisClient.quit();
        console.log('🔌 Соединение с Redis закрыто');
    }
}

clearServerCache();





