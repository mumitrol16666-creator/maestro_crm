require('dotenv').config();
const mongoose = require('mongoose');
const Class = require('./src/models/Class');

async function cleanInvalidClasses() {
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
        console.log(`📊 Найдено занятий: ${allClasses.length}`);
        
        // Находим занятия с невалидными датами
        const invalidClasses = allClasses.filter(cls => {
            const date = new Date(cls.date);
            return isNaN(date.getTime());
        });
        
        console.log(`❌ Занятий с невалидными датами: ${invalidClasses.length}`);
        
        if (invalidClasses.length > 0) {
            console.log('\n🗑️  Удаление невалидных занятий...');
            
            for (const cls of invalidClasses) {
                console.log(`   - ${cls.title} (ID: ${cls._id}) - date: ${cls.date}`);
                await Class.deleteOne({ _id: cls._id });
            }
            
            console.log(`\n✅ Удалено ${invalidClasses.length} занятий с невалидными датами`);
        } else {
            console.log('\n✅ Все занятия имеют валидные даты!');
        }
        
        // Показываем оставшиеся занятия
        const remainingClasses = await Class.find({}).lean();
        console.log(`\n📅 Осталось занятий: ${remainingClasses.length}`);
        
        if (remainingClasses.length > 0) {
            console.log('\nВалидные занятия:');
            remainingClasses.forEach(cls => {
                const date = new Date(cls.date);
                console.log(`   - ${cls.title} - ${date.toLocaleDateString('ru-RU')} ${cls.startTime}`);
            });
        }
        
        console.log('\n✨ Готово!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Ошибка:', error);
        process.exit(1);
    }
}

cleanInvalidClasses();

