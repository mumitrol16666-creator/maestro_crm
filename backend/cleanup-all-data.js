const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const Student = require('./src/models/Student');
const Booking = require('./src/models/Booking');
const Membership = require('./src/models/Membership');
const Freeze = require('./src/models/Freeze');
const Class = require('./src/models/Class');

async function cleanupAllData() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Подключено к MongoDB');
        
        // Удалить всех учеников (кроме админов/преподавателей)
        const deletedStudents = await Student.deleteMany({ 
            role: 'student'
        });
        console.log(`🗑️  Удалено учеников: ${deletedStudents.deletedCount}`);
        
        // Удалить все заявки
        const deletedBookings = await Booking.deleteMany({});
        console.log(`🗑️  Удалено заявок: ${deletedBookings.deletedCount}`);
        
        // Удалить все абонементы
        const deletedMemberships = await Membership.deleteMany({});
        console.log(`🗑️  Удалено абонементов: ${deletedMemberships.deletedCount}`);
        
        // Удалить все заморозки
        const deletedFreezes = await Freeze.deleteMany({});
        console.log(`🗑️  Удалено заморозок: ${deletedFreezes.deletedCount}`);
        
        // Удалить все занятия
        const deletedClasses = await Class.deleteMany({});
        console.log(`🗑️  Удалено занятий: ${deletedClasses.deletedCount}`);
        
        // Сбросить счетчики в группах
        const Group = require('./src/models/Group');
        await Group.updateMany({}, { 
            currentStudents: 0,
            students: []
        });
        console.log(`🔄 Счетчики групп сброшены`);
        
        console.log('\n✅ ВСЕ ДАННЫЕ ОЧИЩЕНЫ!');
        console.log('База данных готова к работе с нуля.');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Ошибка:', error);
        process.exit(1);
    }
}

cleanupAllData();

