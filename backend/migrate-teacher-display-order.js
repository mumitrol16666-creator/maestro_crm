require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sense-of-dance', {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
});

const Student = require('./src/models/Student');

async function migrateTeacherDisplayOrder() {
    try {
        console.log('\n🔄 МИГРАЦИЯ: Установка displayOrder для преподавателей\n');
        
        // Находим всех преподавателей
        const teachers = await Student.find({ 
            role: 'teacher'
        });
        
        console.log(`Найдено преподавателей: ${teachers.length}\n`);
        
        let updated = 0;
        let skipped = 0;
        
        for (const teacher of teachers) {
            // Проверяем есть ли уже displayOrder
            if (teacher.teacherInfo && teacher.teacherInfo.displayOrder !== undefined) {
                console.log(`⏭️  ${teacher.name} ${teacher.lastName || ''} - уже имеет displayOrder: ${teacher.teacherInfo.displayOrder}`);
                skipped++;
                continue;
            }
            
            // Устанавливаем displayOrder = 0 (по умолчанию)
            if (!teacher.teacherInfo) {
                teacher.teacherInfo = {};
            }
            
            teacher.teacherInfo.displayOrder = 0;
            await teacher.save();
            
            console.log(`✅ ${teacher.name} ${teacher.lastName || ''} - установлен displayOrder: 0`);
            updated++;
        }
        
        console.log(`\n📊 РЕЗУЛЬТАТ:`);
        console.log(`✅ Обновлено: ${updated}`);
        console.log(`⏭️  Пропущено (уже есть): ${skipped}`);
        console.log(`📝 Всего: ${teachers.length}\n`);
        
        console.log('✅ Теперь можно менять порядок через админку!\n');
        
    } catch (error) {
        console.error('❌ Ошибка миграции:', error);
    } finally {
        await mongoose.connection.close();
        process.exit(0);
    }
}

migrateTeacherDisplayOrder();

