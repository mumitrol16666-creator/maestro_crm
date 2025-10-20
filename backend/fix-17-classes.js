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

async function fix() {
    try {
        const membershipId = '68f6843b64f8258b85829735';
        
        console.log('\n🔧 ИСПРАВЛЕНИЕ АБОНЕМЕНТА С 17 ЗАНЯТИЯМИ\n');
        
        const membership = await Membership.findById(membershipId);
        
        if (!membership) {
            console.log('❌ Абонемент не найден!\n');
            return;
        }
        
        console.log('📋 ДО:');
        console.log(`  TotalClasses: ${membership.totalClasses}`);
        console.log(`  ClassesRemaining: ${membership.classesRemaining}`);
        console.log(`  Транзакций: ${membership.transactions.length}\n`);
        
        // ИСПРАВЛЕНИЕ: убираем дублирующуюся транзакцию и лишние занятия
        membership.totalClasses = 9;  // Должно быть 1 (trial) + 8 (monthly)
        membership.classesRemaining = 9;
        
        // Удаляем последнюю транзакцию (дублирующаяся автоконвертация)
        if (membership.transactions.length > 0) {
            const lastTransaction = membership.transactions[membership.transactions.length - 1];
            if (lastTransaction.reason && lastTransaction.reason.includes('Автоматическая конвертация')) {
                membership.transactions.pop();
                console.log('❌ Удалена дублирующаяся транзакция автоконвертации');
            }
        }
        
        // Добавляем транзакцию о коррекции
        membership.transactions.push({
            type: 'deduct',
            amount: -8,
            reason: 'Исправление: убрано 8 занятий (дубль автоконвертации)',
            date: new Date(),
            addedBy: membership.createdBy
        });
        
        await membership.save();
        
        console.log('\n📋 ПОСЛЕ:');
        console.log(`  TotalClasses: ${membership.totalClasses}`);
        console.log(`  ClassesRemaining: ${membership.classesRemaining}`);
        console.log(`  Транзакций: ${membership.transactions.length}\n`);
        
        console.log('✅ Абонемент исправлен!\n');
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await mongoose.connection.close();
        process.exit(0);
    }
}

fix();

