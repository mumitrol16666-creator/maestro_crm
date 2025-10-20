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

const Membership = require('./src/models/Membership');
const Student = require('./src/models/Student');

async function fixBrokenTrial() {
    try {
        console.log('\n🔧 ИСПРАВЛЕНИЕ "СЛОМАННЫХ" ПРОБНЫХ АБОНЕМЕНТОВ\n');
        
        // Находим все абонементы type=trial с странным количеством занятий или большой суммой
        const brokenTrials = await Membership.find({
            type: 'trial',
            $or: [
                { classesRemaining: { $gt: 1 } },  // Больше 1 занятия
                { paidAmount: { $gte: 20000 } }    // Оплачено >= 20000
            ]
        }).populate('student', 'name lastName');
        
        console.log(`Найдено "сломанных" пробных: ${brokenTrials.length}\n`);
        
        if (brokenTrials.length === 0) {
            console.log('✅ Все пробные абонементы в порядке!\n');
            return;
        }
        
        for (const membership of brokenTrials) {
            const studentName = membership.student ? `${membership.student.name} ${membership.student.lastName || ''}` : 'Неизвестно';
            
            console.log(`\n🔧 Исправление абонемента: ${studentName}`);
            console.log('📋 ДО:');
            console.log(`  Type: ${membership.type}`);
            console.log(`  TotalClasses: ${membership.totalClasses}`);
            console.log(`  ClassesRemaining: ${membership.classesRemaining}`);
            console.log(`  ClassesUsed: ${membership.classesUsed || 0}`);
            console.log(`  TotalPrice: ${membership.totalPrice}₸`);
            console.log(`  PaidAmount: ${membership.paidAmount}₸`);
            console.log(`  RemainingAmount: ${membership.remainingAmount}₸`);
            
            // КОНВЕРТАЦИЯ В МЕСЯЧНЫЙ
            const classesUsed = membership.classesUsed || 0;
            membership.type = 'monthly';
            membership.totalClasses = 8;
            membership.totalPrice = 22000;
            
            // Корректируем если оплачено больше
            if (membership.paidAmount > 22000) {
                membership.paidAmount = 22000;
            }
            
            membership.remainingAmount = 22000 - membership.paidAmount;
            membership.paymentStatus = membership.remainingAmount <= 0 ? 'paid' : 'partial';
            
            // Транзакция
            membership.transactions.push({
                type: 'extension',
                amount: 0,
                reason: 'Исправление: конвертация trial в monthly (миграция)',
                date: new Date(),
                addedBy: membership.createdBy
            });
            
            await membership.save();
            
            console.log('📋 ПОСЛЕ:');
            console.log(`  Type: ${membership.type}`);
            console.log(`  TotalClasses: ${membership.totalClasses}`);
            console.log(`  ClassesRemaining: ${membership.classesRemaining}`);
            console.log(`  TotalPrice: ${membership.totalPrice}₸`);
            console.log(`  PaidAmount: ${membership.paidAmount}₸`);
            console.log(`  RemainingAmount: ${membership.remainingAmount}₸`);
            console.log(`  PaymentStatus: ${membership.paymentStatus}`);
            console.log(`  ✅ Исправлено!`);
        }
        
        console.log(`\n✅ Всего исправлено абонементов: ${brokenTrials.length}\n`);
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await mongoose.connection.close();
        process.exit(0);
    }
}

fixBrokenTrial();

