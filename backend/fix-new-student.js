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

async function fixStudent() {
    try {
        const membershipId = '68f6803f7a169e450202d58e';
        
        console.log('\n🔧 ИСПРАВЛЕНИЕ НОВОГО УЧЕНИКА\n');
        
        const membership = await Membership.findById(membershipId);
        
        if (!membership) {
            console.log('❌ Абонемент не найден!\n');
            return;
        }
        
        console.log('📋 ДО:');
        console.log(`  Type: ${membership.type}`);
        console.log(`  TotalClasses: ${membership.totalClasses}`);
        console.log(`  ClassesRemaining: ${membership.classesRemaining}`);
        console.log(`  TotalPrice: ${membership.totalPrice}₸`);
        console.log(`  PaidAmount: ${membership.paidAmount}₸\n`);
        
        // КОНВЕРТАЦИЯ
        membership.type = 'monthly';
        membership.totalClasses = 8;
        membership.totalPrice = 22000;
        membership.paidAmount = 22000;
        membership.remainingAmount = 0;
        membership.paymentStatus = 'paid';
        
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
        console.log(`  PaymentStatus: ${membership.paymentStatus}\n`);
        
        console.log('✅ Абонемент исправлен!\n');
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await mongoose.connection.close();
        process.exit(0);
    }
}

fixStudent();

