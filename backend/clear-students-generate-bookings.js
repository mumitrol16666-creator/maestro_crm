const mongoose = require('mongoose');
require('dotenv').config();

const Student = require('./src/models/Student');
const Booking = require('./src/models/Booking');
const Membership = require('./src/models/Membership');
const Freeze = require('./src/models/Freeze');
const Group = require('./src/models/Group');
const Class = require('./src/models/Class');

// Генератор случайных имен и фамилий
const names = ['Александр', 'Максим', 'Артем', 'Дмитрий', 'Иван', 'Никита', 'Михаил', 'Даниил', 'Егор', 'Андрей',
               'Анна', 'Мария', 'Екатерина', 'Дарья', 'Софья', 'Алина', 'Виктория', 'Полина', 'Елена', 'Ольга'];

const lastNames = ['Иванов', 'Петров', 'Сидоров', 'Смирнов', 'Попов', 'Васильев', 'Козлов', 'Новиков', 'Морозов', 'Федоров',
                   'Иванова', 'Петрова', 'Сидорова', 'Смирнова', 'Попова', 'Васильева', 'Козлова', 'Новикова', 'Морозова', 'Федорова'];

const directions = ['K-pop', 'Hip-Hop', 'Contemporary', 'Jazz-Funk', 'Stretching', 'Breaking'];
const sources = ['Телефонный звонок', 'WhatsApp', 'Instagram Direct', 'Сайт', 'Рекомендация', '1fit'];

function randomElement(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomPhone() {
    const code = Math.floor(Math.random() * 900) + 100;
    const num1 = Math.floor(Math.random() * 900) + 100;
    const num2 = Math.floor(Math.random() * 90) + 10;
    const num3 = Math.floor(Math.random() * 90) + 10;
    return `+7 (${code}) ${num1}-${num2}-${num3}`;
}

async function clearAndGenerate() {
    try {
        console.log('🔄 Подключение к БД...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Подключено к MongoDB\n');
        
        // 1. Удаляем всех студентов (роль = student)
        console.log('🗑️  Удаление студентов...');
        const studentsToDelete = await Student.find({ role: 'student' });
        const studentIds = studentsToDelete.map(s => s._id);
        
        // Удаляем связанные данные
        if (studentIds.length > 0) {
            await Membership.deleteMany({ student: { $in: studentIds } });
            await Freeze.deleteMany({ student: { $in: studentIds } });
            await Class.updateMany(
                { 'attendees.student': { $in: studentIds } },
                { $pull: { attendees: { student: { $in: studentIds } } } }
            );
            await Group.updateMany(
                { students: { $in: studentIds } },
                { 
                    $pull: { students: { $in: studentIds } },
                    $inc: { currentStudents: -1 }
                }
            );
            
            await Student.deleteMany({ _id: { $in: studentIds } });
            console.log(`✅ Удалено студентов: ${studentIds.length}`);
            console.log(`  ↳ Удалено абонементов и заморозок`);
            console.log(`  ↳ Очищена посещаемость`);
            console.log(`  ↳ Обновлены группы\n`);
        } else {
            console.log('  ↳ Студентов не найдено\n');
        }
        
        // 2. Удаляем все заявки
        console.log('🗑️  Удаление заявок...');
        const deletedBookings = await Booking.deleteMany({});
        console.log(`✅ Удалено заявок: ${deletedBookings.deletedCount}\n`);
        
        // 3. Генерируем 40 новых заявок
        console.log('📋 Генерация 40 новых заявок...');
        const bookings = [];
        
        for (let i = 0; i < 40; i++) {
            const name = randomElement(names);
            const lastName = randomElement(lastNames);
            const phone = randomPhone();
            const direction = randomElement(directions);
            const source = randomElement(sources);
            
            // Распределяем статусы: 60% новые, 25% обработаны, 10% пробные, 5% отклонены
            let status = 'new';
            const rand = Math.random();
            if (rand > 0.6 && rand <= 0.85) status = 'processed';
            else if (rand > 0.85 && rand <= 0.95) status = 'trial';
            else if (rand > 0.95) status = 'rejected';
            
            // Случайная дата в пределах последних 7 дней
            const daysAgo = Math.floor(Math.random() * 7);
            const createdAt = new Date();
            createdAt.setDate(createdAt.getDate() - daysAgo);
            createdAt.setHours(Math.floor(Math.random() * 24));
            createdAt.setMinutes(Math.floor(Math.random() * 60));
            
            bookings.push({
                name,
                lastName,
                phone,
                direction,
                source,
                status,
                gender: Math.random() > 0.5 ? 'female' : 'male',
                createdAt
            });
        }
        
        const created = await Booking.insertMany(bookings);
        console.log(`✅ Создано заявок: ${created.length}`);
        
        // Статистика по статусам
        const newCount = created.filter(b => b.status === 'new').length;
        const processedCount = created.filter(b => b.status === 'processed').length;
        const trialCount = created.filter(b => b.status === 'trial').length;
        const rejectedCount = created.filter(b => b.status === 'rejected').length;
        
        console.log(`\n📊 Статистика заявок:`);
        console.log(`   Новые: ${newCount}`);
        console.log(`   Думают: ${processedCount}`);
        console.log(`   Пробное занятие: ${trialCount}`);
        console.log(`   Отклонены: ${rejectedCount}`);
        
        console.log(`\n✅ Готово! База обновлена.`);
        
        await mongoose.connection.close();
        console.log('🔌 Соединение закрыто');
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
        process.exit(1);
    }
}

clearAndGenerate();

