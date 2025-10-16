const mongoose = require('mongoose');
require('dotenv').config();

// Импортируем все модели
const Student = require('./src/models/Student');
const Group = require('./src/models/Group');
const Class = require('./src/models/Class');
const Membership = require('./src/models/Membership');
const Freeze = require('./src/models/Freeze');
const Booking = require('./src/models/Booking');
const Payment = require('./src/models/Payment');
const Attendance = require('./src/models/Attendance');
const Room = require('./src/models/Room');
const Direction = require('./src/models/Direction');
const BlogPost = require('./src/models/BlogPost');

async function clearDatabase() {
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sense-of-dance';
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');
        
        // Находим суперадмина ПЕРЕД очисткой
        const superAdmin = await Student.findOne({ role: 'super_admin' });
        
        if (!superAdmin) {
            console.log('❌ СУПЕРАДМИН НЕ НАЙДЕН! Отмена очистки для безопасности.');
            process.exit(1);
        }
        
        console.log(`\n🔐 Найден суперадмин: ${superAdmin.name} (${superAdmin.phone})`);
        console.log(`   ID: ${superAdmin._id}`);
        
        console.log('\n⚠️  НАЧИНАЕМ ОЧИСТКУ БАЗЫ ДАННЫХ...\n');
        
        // Удаляем всё кроме суперадмина
        const deletedStudents = await Student.deleteMany({ 
            _id: { $ne: superAdmin._id } 
        });
        console.log(`✅ Удалено пользователей (кроме суперадмина): ${deletedStudents.deletedCount}`);
        
        const deletedGroups = await Group.deleteMany({});
        console.log(`✅ Удалено групп: ${deletedGroups.deletedCount}`);
        
        const deletedClasses = await Class.deleteMany({});
        console.log(`✅ Удалено занятий: ${deletedClasses.deletedCount}`);
        
        const deletedMemberships = await Membership.deleteMany({});
        console.log(`✅ Удалено абонементов: ${deletedMemberships.deletedCount}`);
        
        const deletedFreezes = await Freeze.deleteMany({});
        console.log(`✅ Удалено заморозок: ${deletedFreezes.deletedCount}`);
        
        const deletedBookings = await Booking.deleteMany({});
        console.log(`✅ Удалено заявок: ${deletedBookings.deletedCount}`);
        
        const deletedPayments = await Payment.deleteMany({});
        console.log(`✅ Удалено платежей: ${deletedPayments.deletedCount}`);
        
        const deletedAttendances = await Attendance.deleteMany({});
        console.log(`✅ Удалено записей посещаемости: ${deletedAttendances.deletedCount}`);
        
        const deletedRooms = await Room.deleteMany({});
        console.log(`✅ Удалено залов: ${deletedRooms.deletedCount}`);
        
        const deletedDirections = await Direction.deleteMany({});
        console.log(`✅ Удалено направлений: ${deletedDirections.deletedCount}`);
        
        const deletedBlogPosts = await BlogPost.deleteMany({});
        console.log(`✅ Удалено статей блога: ${deletedBlogPosts.deletedCount}`);
        
        console.log('\n========================================');
        console.log('🎉 БАЗА ДАННЫХ ОЧИЩЕНА!');
        console.log('========================================');
        console.log(`\n🔐 Остался только суперадмин:`);
        console.log(`   Имя: ${superAdmin.name}`);
        console.log(`   Телефон: ${superAdmin.phone}`);
        console.log(`   Роль: ${superAdmin.role}`);
        console.log('\n✅ Готово! База данных чистая.\n');
        
        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

clearDatabase();

