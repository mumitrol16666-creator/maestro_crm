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

async function check() {
    try {
        console.log('\n🔍 ПОИСК УЧЕНИКА С 17 ЗАНЯТИЯМИ\n');
        
        // Ищем абонемент с 17 занятиями
        const memberships = await Membership.find({
            $or: [
                { totalClasses: 17 },
                { classesRemaining: 17 }
            ]
        }).populate('student', 'name lastName phone').sort({ updatedAt: -1 });
        
        console.log(`📋 Найдено абонементов с 17 занятиями: ${memberships.length}\n`);
        
        if (memberships.length === 0) {
            console.log('❌ Не найдено абонементов с 17 занятиями');
            console.log('🔍 Ищем недавно созданные месячные абонементы...\n');
            
            const recent = await Membership.find({
                type: 'monthly',
                createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) }  // Последний час
            }).populate('student', 'name lastName phone').sort({ createdAt: -1 }).limit(5);
            
            console.log(`📋 Найдено недавних месячных: ${recent.length}\n`);
            
            for (const m of recent) {
                const studentName = m.student ? `${m.student.name} ${m.student.lastName || ''}` : 'Неизвестно';
                console.log(`👤 ${studentName}`);
                console.log(`   ID: ${m._id}`);
                console.log(`   Type: ${m.type}`);
                console.log(`   TotalClasses: ${m.totalClasses}`);
                console.log(`   ClassesRemaining: ${m.classesRemaining}`);
                console.log(`   Created: ${m.createdAt.toLocaleString('ru')}`);
                console.log(`   Updated: ${m.updatedAt.toLocaleString('ru')}`);
                console.log('');
            }
            
            return;
        }
        
        for (const membership of memberships) {
            const studentName = membership.student ? `${membership.student.name} ${membership.student.lastName || ''}` : 'Неизвестно';
            const phone = membership.student?.phone || 'Нет';
            
            console.log(`👤 УЧЕНИК: ${studentName}`);
            console.log(`📱 Телефон: ${phone}`);
            console.log(`🆔 Student ID: ${membership.student?._id}`);
            console.log(`🆔 Membership ID: ${membership._id}`);
            console.log('');
            console.log(`📋 АБОНЕМЕНТ:`);
            console.log(`   Type: ${membership.type}`);
            console.log(`   Status: ${membership.status}`);
            console.log(`   TotalClasses: ${membership.totalClasses}`);
            console.log(`   ClassesRemaining: ${membership.classesRemaining}`);
            console.log(`   ClassesUsed: ${membership.classesUsed || 0}`);
            console.log(`   TotalPrice: ${membership.totalPrice}₸`);
            console.log(`   PaidAmount: ${membership.paidAmount}₸`);
            console.log(`   Created: ${membership.createdAt.toLocaleString('ru')}`);
            console.log(`   Updated: ${membership.updatedAt.toLocaleString('ru')}`);
            console.log('');
            
            if (membership.transactions && membership.transactions.length > 0) {
                console.log(`📜 ТРАНЗАКЦИИ (${membership.transactions.length}):`);
                membership.transactions.forEach((t, i) => {
                    console.log(`   ${i + 1}. ${t.type} | ${t.amount > 0 ? '+' : ''}${t.amount} | ${t.reason}`);
                    console.log(`      Дата: ${t.date.toLocaleString('ru')}`);
                });
                console.log('');
            }
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await mongoose.connection.close();
        process.exit(0);
    }
}

check();

