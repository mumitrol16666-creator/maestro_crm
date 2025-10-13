require('dotenv').config();
const mongoose = require('mongoose');
const Class = require('./src/models/Class');

async function deleteAllClasses() {
    try {
        console.log('🔍 Подключение к MongoDB...');
        const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
        
        if (!mongoUri) {
            throw new Error('MONGODB_URI не найден в переменных окружения');
        }
        
        await mongoose.connect(mongoUri);
        console.log('✅ Подключено к MongoDB');
        
        // Получаем все занятия
        const allClasses = await Class.find({}).lean();
        console.log(`\n📊 Найдено занятий: ${allClasses.length}`);
        
        if (allClasses.length === 0) {
            console.log('✅ База данных уже пустая!');
            process.exit(0);
        }
        
        // Показываем список
        console.log('\n📋 Список занятий для удаления:');
        allClasses.forEach((cls, index) => {
            const date = new Date(cls.date);
            console.log(`   ${index + 1}. ${cls.title} - ${date.toLocaleDateString('ru-RU')} ${cls.startTime}`);
        });
        
        // Удаляем все
        console.log('\n🗑️  Удаление всех занятий...');
        const result = await Class.deleteMany({});
        
        console.log(`\n✅ Удалено занятий: ${result.deletedCount}`);
        console.log('✨ База данных очищена!');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Ошибка:', error);
        process.exit(1);
    }
}

deleteAllClasses();

