const mongoose = require('mongoose');
require('dotenv').config();

const Student = require('./src/models/Student');
const Booking = require('./src/models/Booking');
const Membership = require('./src/models/Membership');
const Freeze = require('./src/models/Freeze');
const Group = require('./src/models/Group');
const Class = require('./src/models/Class');
const CashTransaction = require('./src/models/CashTransaction');
const Payment = require('./src/models/Payment');
const { cacheUtils } = require('./src/config/redis');

async function clearData() {
    try {
        console.log('🔄 Подключение к БД...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Подключено к MongoDB\n');
        
        // 1. Удаляем все заявки
        console.log('🗑️  Удаление заявок...');
        const deletedBookings = await Booking.deleteMany({});
        console.log(`✅ Удалено заявок: ${deletedBookings.deletedCount}\n`);
        
        // 2. Удаляем всех студентов (роль = student)
        console.log('🗑️  Удаление учеников (роль = student)...');
        const studentsToDelete = await Student.find({ role: 'student' });
        const studentIds = studentsToDelete.map(s => s._id);
        
        // Удаляем связанные данные учеников
        if (studentIds.length > 0) {
            await Membership.deleteMany({ student: { $in: studentIds } });
            await Freeze.deleteMany({ student: { $in: studentIds } });
            
            // Удаляем студентов из групп
            await Group.updateMany(
                { students: { $in: studentIds } },
                { $pull: { students: { $in: studentIds } } }
            );
            
            // Обновляем счетчики в группах
            const groups = await Group.find({});
            for (const group of groups) {
                group.currentStudents = group.students ? group.students.length : 0;
                await group.save();
            }
            
            await Student.deleteMany({ _id: { $in: studentIds } });
            console.log(`✅ Удалено учеников: ${studentIds.length}`);
            console.log(`  ↳ Удалено связанных абонементов и заморозок`);
            console.log(`  ↳ Обновлены группы\n`);
        } else {
            console.log('  ↳ Учеников не найдено\n');
        }
        
        // 3. Удаляем все занятия из расписания
        console.log('🗑️  Удаление занятий из расписания...');
        const deletedClasses = await Class.deleteMany({});
        console.log(`✅ Удалено занятий: ${deletedClasses.deletedCount}\n`);
        
        // 4. Удаляем все транзакции кассы
        console.log('🗑️  Удаление транзакций кассы...');
        const deletedTransactions = await CashTransaction.deleteMany({});
        console.log(`✅ Удалено транзакций кассы: ${deletedTransactions.deletedCount}`);
        
        // 5. Удаляем все платежи
        console.log('🗑️  Удаление платежей...');
        const deletedPayments = await Payment.deleteMany({});
        console.log(`✅ Удалено платежей: ${deletedPayments.deletedCount}\n`);
        
        // 6. Очищаем кэш кассы
        console.log('🗑️  Очистка кэша кассы...');
        await cacheUtils.delPattern('cashbox:*');
        await cacheUtils.delPattern('payments:*');
        await cacheUtils.delPattern('admin:stats:*');
        console.log(`✅ Кэш очищен\n`);
        
        // Проверяем, что остальные пользователи не тронуты
        const remainingAdmins = await Student.countDocuments({ 
            role: { $in: ['admin', 'super_admin', 'teacher', 'sales_manager'] } 
        });
        console.log(`✅ Сохранено администраторов и персонала: ${remainingAdmins}`);
        
        console.log(`\n✅ Готово! База данных очищена.`);
        
        await mongoose.connection.close();
        console.log('🔌 Соединение закрыто');
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
        process.exit(1);
    }
}

clearData();

