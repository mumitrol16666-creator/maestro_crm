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

const Payment = require('./src/models/Payment');
const Membership = require('./src/models/Membership');

async function fixAdvancePayments() {
    try {
        console.log('\n🔧 ИСПРАВЛЕНИЕ ВСЕХ АВАНСОВЫХ ПЛАТЕЖЕЙ\n');
        
        // Находим все авансы со статусом pending
        const pendingAdvances = await Payment.find({
            type: 'membership_advance',
            status: 'pending'
        }).populate('membership', 'paidAmount totalPrice remainingAmount').lean();
        
        console.log(`Найдено pending авансов: ${pendingAdvances.length}\n`);
        
        if (pendingAdvances.length === 0) {
            console.log('✅ Нет pending авансов для исправления!\n');
            return;
        }
        
        let fixed = 0;
        
        for (const advance of pendingAdvances) {
            // Проверяем: если paidAmount в абонементе > 0, значит аванс УЖЕ ОПЛАЧЕН
            const membership = advance.membership;
            
            if (membership && membership.paidAmount >= advance.amount) {
                console.log(`🔄 Исправление платежа ${advance._id}:`);
                console.log(`   Сумма: ${advance.amount}₸`);
                console.log(`   Абонемент paidAmount: ${membership.paidAmount}₸`);
                console.log(`   Статус ДО: pending`);
                
                // Меняем статус на completed
                await Payment.findByIdAndUpdate(advance._id, {
                    status: 'completed',
                    notes: advance.notes || `Аванс ${advance.amount}₸ (исправлено миграцией)`
                });
                
                console.log(`   Статус ПОСЛЕ: completed ✅\n`);
                fixed++;
            } else {
                console.log(`⏭️  Платеж ${advance._id} пропущен (paidAmount = ${membership?.paidAmount || 0}, не соответствует авансу)\n`);
            }
        }
        
        console.log(`\n📊 РЕЗУЛЬТАТ:`);
        console.log(`✅ Исправлено: ${fixed}`);
        console.log(`⏭️  Пропущено: ${pendingAdvances.length - fixed}`);
        console.log(`📝 Всего: ${pendingAdvances.length}\n`);
        
        console.log('✅ Миграция завершена! Теперь данные согласованы.\n');
        
    } catch (error) {
        console.error('❌ Ошибка миграции:', error);
    } finally {
        await mongoose.connection.close();
        process.exit(0);
    }
}

fixAdvancePayments();

