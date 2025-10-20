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

const Student = require('./src/models/Student');
const Membership = require('./src/models/Membership');
const Payment = require('./src/models/Payment');

async function checkStudent() {
    try {
        const studentId = '68f6803f7a169e450202d58b';
        
        console.log('\n🔍 ПРОВЕРКА НОВОГО УЧЕНИКА\n');
        
        const student = await Student.findById(studentId).select('name lastName phone');
        if (!student) {
            console.log('❌ Ученик не найден!\n');
            return;
        }
        
        console.log(`👤 Ученик: ${student.name} ${student.lastName || ''}`);
        console.log(`📱 Телефон: ${student.phone}\n`);
        
        // Все абонементы
        const memberships = await Membership.find({ student: studentId }).sort({ createdAt: -1 });
        console.log(`📋 ВСЕГО АБОНЕМЕНТОВ: ${memberships.length}\n`);
        
        memberships.forEach((m, i) => {
            console.log(`${i + 1}. ID: ${m._id}`);
            console.log(`   Type: ${m.type}`);
            console.log(`   Status: ${m.status}`);
            console.log(`   TotalClasses: ${m.totalClasses}`);
            console.log(`   ClassesRemaining: ${m.classesRemaining}`);
            console.log(`   ClassesUsed: ${m.classesUsed || 0}`);
            console.log(`   TotalPrice: ${m.totalPrice}₸`);
            console.log(`   PaidAmount: ${m.paidAmount}₸`);
            console.log(`   RemainingAmount: ${m.remainingAmount}₸`);
            console.log(`   PaymentStatus: ${m.paymentStatus}`);
            console.log(`   Created: ${m.createdAt.toLocaleString('ru')}`);
            console.log('');
        });
        
        // Все платежи
        const payments = await Payment.find({ student: studentId }).sort({ paymentDate: -1 });
        console.log(`💰 ВСЕГО ПЛАТЕЖЕЙ: ${payments.length}\n`);
        
        payments.forEach((p, i) => {
            console.log(`${i + 1}. ID: ${p._id}`);
            console.log(`   Type: ${p.type}`);
            console.log(`   Amount: ${p.amount}₸`);
            console.log(`   Status: ${p.status}`);
            console.log(`   Membership: ${p.membership || 'НЕТ'}`);
            console.log(`   Date: ${p.paymentDate.toLocaleString('ru')}`);
            console.log(`   Notes: ${p.notes || '-'}`);
            console.log('');
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await mongoose.connection.close();
        process.exit(0);
    }
}

checkStudent();

