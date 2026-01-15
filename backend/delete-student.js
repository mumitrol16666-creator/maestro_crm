const mongoose = require('mongoose');
require('dotenv').config();

const Student = require('./src/models/Student');
const Booking = require('./src/models/Booking');
const Membership = require('./src/models/Membership');
const Freeze = require('./src/models/Freeze');
const Group = require('./src/models/Group');
const Class = require('./src/models/Class');
const Payment = require('./src/models/Payment');

// Используем MONGODB_URI из .env или fallback
const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://Dmitriy:Coolpopitd12@cluster0.ecwubgs.mongodb.net/SenseOfDance?retryWrites=true&w=majority';

mongoose.connect(mongoUri)
.then(async () => {
    console.log('✅ Подключено к MongoDB\n');
    
    // Ищем ученика по имени и телефону
    const studentName = 'Ольга';
    const studentLastName = 'Нагматжанова';
    const studentPhone = '+7 (707) 897-36-10';
    
    // Извлекаем только цифры из телефона для поиска
    const phoneDigits = studentPhone.replace(/\D/g, '');
    
    console.log(`🔍 Поиск ученика: ${studentName} ${studentLastName}, телефон: ${studentPhone}`);
    console.log(`   (цифры телефона: ${phoneDigits})\n`);
    
    // Ищем по имени, фамилии и телефону
    const student = await Student.findOne({
        name: studentName,
        lastName: studentLastName,
        $or: [
            { phone: studentPhone },
            { phoneDigits: phoneDigits }
        ]
    });
    
    if (!student) {
        console.log('❌ Ученик не найден в базе данных');
        console.log('   Проверьте правильность имени, фамилии и телефона');
        process.exit(1);
    }
    
    console.log(`✅ Найден ученик:`);
    console.log(`   ID: ${student._id}`);
    console.log(`   Имя: ${student.name} ${student.lastName}`);
    console.log(`   Телефон: ${student.phone}`);
    console.log(`   Роль: ${student.role}`);
    console.log(`   Групп: ${student.groups?.length || 0}\n`);
    
    // Проверяем, что это действительно ученик
    if (student.role !== 'student') {
        console.log(`⚠️  ВНИМАНИЕ: Это не ученик, а ${student.role}!`);
        console.log('   Удаление отменено для безопасности');
        process.exit(1);
    }
    
    const studentId = student._id;
    
    // КАСКАДНОЕ УДАЛЕНИЕ СВЯЗАННЫХ ДАННЫХ
    
    // 1. Удалить все заявки ученика
    console.log('🗑️  Удаление заявок...');
    const deletedBookings = await Booking.deleteMany({ student: studentId });
    console.log(`   ✅ Удалено заявок: ${deletedBookings.deletedCount}`);
    
    // 2. Удалить все абонементы ученика
    console.log('🗑️  Удаление абонементов...');
    const deletedMemberships = await Membership.deleteMany({ student: studentId });
    console.log(`   ✅ Удалено абонементов: ${deletedMemberships.deletedCount}`);
    
    // 3. Удалить все заморозки ученика
    console.log('🗑️  Удаление заморозок...');
    const deletedFreezes = await Freeze.deleteMany({ student: studentId });
    console.log(`   ✅ Удалено заморозок: ${deletedFreezes.deletedCount}`);
    
    // 4. Удалить все платежи ученика
    console.log('🗑️  Удаление платежей...');
    const deletedPayments = await Payment.deleteMany({ student: studentId });
    console.log(`   ✅ Удалено платежей: ${deletedPayments.deletedCount}`);
    
    // 5. Удалить посещаемость из всех занятий
    console.log('🗑️  Удаление посещаемости из занятий...');
    const updatedClasses = await Class.updateMany(
        { 'attendees.student': studentId },
        { $pull: { attendees: { student: studentId } } }
    );
    console.log(`   ✅ Обновлено занятий: ${updatedClasses.modifiedCount}`);
    
    // 6. Убрать ученика из групп и обновить счетчики
    console.log('🗑️  Удаление из групп...');
    const activeGroups = student.groups?.filter(g => g.status === 'active') || [];
    
    if (activeGroups.length > 0) {
        const groupIds = activeGroups.map(g => g.groupId);
        await Group.updateMany(
            { _id: { $in: groupIds } },
            { 
                $inc: { currentStudents: -1 },
                $pull: { students: studentId }
            }
        );
        console.log(`   ✅ Убран из ${activeGroups.length} групп`);
    } else {
        console.log(`   ℹ️  Ученик не был в активных группах`);
    }
    
    // 7. Удалить самого ученика
    console.log('🗑️  Удаление ученика...');
    await Student.findByIdAndDelete(studentId);
    console.log(`   ✅ Ученик удален\n`);
    
    console.log('✅ Готово! Ученик и все связанные данные успешно удалены.');
    
    process.exit(0);
})
.catch(err => { 
    console.error('❌ Ошибка:', err.message); 
    process.exit(1); 
});

