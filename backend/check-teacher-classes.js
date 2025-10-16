const mongoose = require('mongoose');
const Class = require('./src/models/Class');
require('dotenv').config();

async function checkTeacherClasses() {
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sense-of-dance';
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');
        
        const teacherId = '68f0a4e2a6151f02ab9e10be';
        
        // Поиск всех занятий этого преподавателя
        const classes = await Class.find({ teacher: teacherId })
            .populate('teacher', 'name lastName')
            .populate('group', 'name')
            .populate('room', 'name')
            .sort({ date: -1 })
            .limit(10);
        
        console.log(`\n📅 ЗАНЯТИЯ ПРЕПОДАВАТЕЛЯ (ID: ${teacherId}):`);
        console.log('='.repeat(60));
        
        if (classes.length === 0) {
            console.log('❌ НЕТ ЗАНЯТИЙ для этого преподавателя!');
        } else {
            console.log(`✅ Найдено занятий: ${classes.length}`);
            classes.forEach((cls, idx) => {
                console.log(`\n${idx + 1}. ${cls.title || 'Без названия'}`);
                console.log(`   Дата: ${cls.date.toISOString().split('T')[0]}`);
                console.log(`   Время: ${cls.startTime} - ${cls.endTime}`);
                console.log(`   Группа: ${cls.group?.name || 'Без группы'}`);
                console.log(`   Зал: ${cls.room?.name || 'Без зала'}`);
                console.log(`   Преподаватель: ${cls.teacher?.name || 'Не назначен'}`);
            });
        }
        
        // Проверим все занятия в системе
        const totalClasses = await Class.countDocuments();
        console.log(`\n📊 ВСЕГО занятий в системе: ${totalClasses}`);
        
        // Проверим занятия БЕЗ преподавателя
        const classesWithoutTeacher = await Class.countDocuments({ teacher: null });
        console.log(`⚠️  Занятий БЕЗ преподавателя: ${classesWithoutTeacher}`);
        
        // Покажем несколько занятий без преподавателя
        if (classesWithoutTeacher > 0) {
            const unassignedClasses = await Class.find({ teacher: null })
                .populate('group', 'name')
                .limit(5);
            
            console.log(`\n🔍 Примеры занятий БЕЗ преподавателя:`);
            unassignedClasses.forEach((cls, idx) => {
                console.log(`  ${idx + 1}. ${cls.title} (${cls.date.toISOString().split('T')[0]})`);
            });
        }
        
        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

checkTeacherClasses();

