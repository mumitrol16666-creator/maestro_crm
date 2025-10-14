const mongoose = require('mongoose');
require('dotenv').config();

const Student = require('./src/models/Student');
const Booking = require('./src/models/Booking');

async function migratePhoneDigits() {
    try {
        console.log('🔄 Подключение к БД...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Подключено к MongoDB');
        
        // Обновляем Students
        console.log('\n📚 Обновление студентов...');
        const students = await Student.find({});
        let studentsUpdated = 0;
        
        for (const student of students) {
            const phoneDigits = student.phone.replace(/\D/g, '');
            if (student.phoneDigits !== phoneDigits) {
                student.phoneDigits = phoneDigits;
                // Сохраняем БЕЗ валидации пароля
                await student.save({ validateBeforeSave: false });
                studentsUpdated++;
            }
        }
        console.log(`✅ Обновлено студентов: ${studentsUpdated} из ${students.length}`);
        
        // Обновляем Bookings
        console.log('\n📋 Обновление заявок...');
        const bookings = await Booking.find({});
        let bookingsUpdated = 0;
        
        for (const booking of bookings) {
            const phoneDigits = booking.phone.replace(/\D/g, '');
            if (booking.phoneDigits !== phoneDigits) {
                booking.phoneDigits = phoneDigits;
                await booking.save();
                bookingsUpdated++;
            }
        }
        console.log(`✅ Обновлено заявок: ${bookingsUpdated} из ${bookings.length}`);
        
        console.log('\n✅ Миграция завершена!');
        console.log(`\n📊 Итого:`);
        console.log(`   Студенты: ${studentsUpdated}/${students.length}`);
        console.log(`   Заявки: ${bookingsUpdated}/${bookings.length}`);
        
        await mongoose.connection.close();
        console.log('\n🔌 Соединение закрыто');
        
    } catch (error) {
        console.error('❌ Ошибка миграции:', error);
        process.exit(1);
    }
}

migratePhoneDigits();

