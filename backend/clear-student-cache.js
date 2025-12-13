const mongoose = require('mongoose');
require('dotenv').config();
const { cacheUtils } = require('./src/config/redis');

async function clearStudentCache() {
    try {
        console.log('🔄 Подключение к Redis...');
        
        // Очищаем все ключи студентов
        const pattern = 'students:*';
        const deleted = await cacheUtils.delPattern(pattern);
        console.log(`✅ Удалено ключей студентов: ${deleted}`);
        
        // Также очищаем кэш платежей
        const paymentPattern = 'payments:*';
        const deletedPayments = await cacheUtils.delPattern(paymentPattern);
        console.log(`✅ Удалено ключей платежей: ${deletedPayments}`);
        
        console.log('\n✅ Кэш студентов очищен!');
        console.log('💡 Теперь обновите страницу в браузере (Ctrl+F5 или Cmd+Shift+R)');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        if (error.message.includes('ECONNREFUSED') || error.message.includes('connect')) {
            console.log('💡 Redis не запущен или недоступен.');
            console.log('💡 Это нормально, если Redis не используется. Данные будут загружаться напрямую из БД.');
        }
        process.exit(0);
    }
}

clearStudentCache();

