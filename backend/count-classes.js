const mongoose = require('mongoose');
const Class = require('./src/models/Class');
require('dotenv').config();

async function countClasses() {
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sense-of-dance';
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');
        
        const total = await Class.countDocuments();
        console.log(`📊 ВСЕГО занятий в базе: ${total}`);
        
        if (total > 0) {
            const recentClasses = await Class.find()
                .populate('teacher', 'name')
                .populate('group', 'name')
                .sort({ date: -1 })
                .limit(5);
            
            console.log('\n📅 Последние 5 занятий:');
            recentClasses.forEach((cls, idx) => {
                console.log(`  ${idx + 1}. ${cls.title} - ${cls.date.toISOString().split('T')[0]} (Группа: ${cls.group?.name || 'нет'}, Преподаватель: ${cls.teacher?.name || 'не назначен'})`);
            });
        }
        
        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

countClasses();

