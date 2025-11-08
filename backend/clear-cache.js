const { createClient } = require('redis');
require('dotenv').config();

async function clearCache() {
    const redisClient = createClient({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined
    });

    try {
        await redisClient.connect();
        console.log('✅ Подключено к Redis');

        // Очищаем все ключи кассы
        const cashboxKeys = await redisClient.keys('cashbox:*');
        if (cashboxKeys.length > 0) {
            await redisClient.del(cashboxKeys);
            console.log(`🗑️  Удалено ключей кассы: ${cashboxKeys.length}`);
        }

        // Очищаем все ключи платежей
        const paymentKeys = await redisClient.keys('payments:*');
        if (paymentKeys.length > 0) {
            await redisClient.del(paymentKeys);
            console.log(`🗑️  Удалено ключей платежей: ${paymentKeys.length}`);
        }

        // Очищаем все ключи админ статистики
        const adminKeys = await redisClient.keys('admin:stats:*');
        if (adminKeys.length > 0) {
            await redisClient.del(adminKeys);
            console.log(`🗑️  Удалено ключей админ статистики: ${adminKeys.length}`);
        }

        console.log('✅ Кэш полностью очищен');
        
    } catch (error) {
        console.error('❌ Ошибка очистки кэша:', error);
    } finally {
        await redisClient.quit();
        console.log('🔌 Соединение с Redis закрыто');
    }
}

clearCache();





