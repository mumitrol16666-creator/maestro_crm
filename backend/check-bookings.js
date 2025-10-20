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

const Booking = require('./src/models/Booking');

async function check() {
    try {
        console.log('\n🔍 ПРОВЕРКА ЗАЯВОК\n');
        
        // Ищем все заявки со статусом new
        const newBookings = await Booking.find({ status: 'new' }).sort({ createdAt: -1 });
        
        console.log(`📋 Заявок со статусом "new": ${newBookings.length}\n`);
        
        if (newBookings.length === 0) {
            console.log('✅ Нет заявок со статусом "new"');
            
            // Ищем заявку с именем "4к43к"
            console.log('\n🔍 Поиск заявки "4к43к 435435"...\n');
            const suspectBooking = await Booking.find({
                $or: [
                    { name: { $regex: /4к43к/i } },
                    { name: { $regex: /435435/i } }
                ]
            });
            
            if (suspectBooking.length > 0) {
                console.log(`📋 Найдено заявок: ${suspectBooking.length}\n`);
                suspectBooking.forEach((b, i) => {
                    console.log(`${i + 1}. ID: ${b._id}`);
                    console.log(`   Имя: ${b.name}`);
                    console.log(`   Телефон: ${b.phone}`);
                    console.log(`   Статус: ${b.status}`);
                    console.log(`   Создана: ${b.createdAt.toLocaleString('ru')}`);
                    console.log('');
                });
            } else {
                console.log('❌ Заявка не найдена в базе данных!');
                console.log('Возможно, это кэш в дашборде.\n');
            }
            
            return;
        }
        
        // Показываем все новые заявки
        newBookings.forEach((booking, i) => {
            console.log(`${i + 1}. ID: ${booking._id}`);
            console.log(`   Имя: ${booking.name}`);
            console.log(`   Телефон: ${booking.phone}`);
            console.log(`   Статус: ${booking.status}`);
            console.log(`   Создана: ${booking.createdAt.toLocaleString('ru')}`);
            console.log('');
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await mongoose.connection.close();
        process.exit(0);
    }
}

check();

