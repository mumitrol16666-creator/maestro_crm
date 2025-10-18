const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Загрузка переменных окружения
dotenv.config();

const Class = require('./src/models/Class');

async function deleteAllClasses() {
    try {
        console.log('🔌 Подключение к MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Подключено к MongoDB');
        
        console.log('\n⚠️  ВНИМАНИЕ: Вы собираетесь удалить ВСЕ занятия из базы данных!');
        console.log('⏳ Начинаем удаление через 2 секунды...\n');
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const result = await Class.deleteMany({});
        
        console.log(`✅ Удалено занятий: ${result.deletedCount}`);
        console.log('🎉 Все занятия успешно удалены из базы данных');
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await mongoose.connection.close();
        console.log('🔌 Отключено от MongoDB');
        process.exit(0);
    }
}

deleteAllClasses();
