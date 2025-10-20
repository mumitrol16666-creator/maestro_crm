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

async function fixAll() {
    try {
        console.log('\n🔧 ИСПРАВЛЕНИЕ КОНВЕРТИРОВАННЫХ АБОНЕМЕНТОВ\n');
        
        // Находим всех кто был конвертирован (по транзакциям)
        const converted = await Membership.find({
            type: 'monthly',
            totalClasses: { $lte: 9 },  // 8 или 9 (на случай если уже исправлено)
            'transactions.reason': { $regex: /Автоматическая конвертация|конвертация trial в monthly/i }
        }).populate('student', 'name lastName');
        
        console.log(`📋 Найдено конвертированных абонементов: ${converted.length}\n`);
        
        if (converted.length === 0) {
            console.log('✅ Все абонементы в порядке!\n');
            return;
        }
        
        let fixed = 0;
        
        for (const membership of converted) {
            const studentName = membership.student ? `${membership.student.name} ${membership.student.lastName || ''}` : 'Неизвестно';
            
            // Проверяем нужно ли исправлять
            if (membership.totalClasses === 8 && membership.classesRemaining === 8) {
                console.log(`🔧 Исправление: ${studentName}`);
                console.log(`   ДО: totalClasses = ${membership.totalClasses}, classesRemaining = ${membership.classesRemaining}`);
                
                // Добавляем 1 занятие от пробного
                membership.totalClasses = 9;
                membership.classesRemaining = 9;
                
                membership.transactions.push({
                    type: 'add',
                    amount: 1,
                    reason: 'Исправление: добавлено 1 занятие от пробного (было утеряно при автоконвертации)',
                    date: new Date(),
                    addedBy: membership.createdBy
                });
                
                await membership.save();
                
                console.log(`   ПОСЛЕ: totalClasses = ${membership.totalClasses}, classesRemaining = ${membership.classesRemaining}`);
                console.log(`   ✅ Исправлено!\n`);
                fixed++;
            } else if (membership.totalClasses === 9) {
                console.log(`✅ ${studentName} - уже исправлено (${membership.totalClasses} занятий)`);
            } else if (membership.classesUsed > 0) {
                // Если уже использовали занятия - корректируем аккуратно
                const shouldHave = 9;
                const actualRemaining = membership.classesRemaining;
                const expectedRemaining = shouldHave - membership.classesUsed;
                
                if (actualRemaining < expectedRemaining) {
                    console.log(`🔧 Исправление: ${studentName} (с учетом использованных)`);
                    console.log(`   ДО: totalClasses = ${membership.totalClasses}, classesRemaining = ${membership.classesRemaining}, classesUsed = ${membership.classesUsed}`);
                    
                    membership.totalClasses = shouldHave;
                    membership.classesRemaining = expectedRemaining;
                    
                    membership.transactions.push({
                        type: 'add',
                        amount: 1,
                        reason: 'Исправление: добавлено 1 занятие от пробного (было утеряно при автоконвертации)',
                        date: new Date(),
                        addedBy: membership.createdBy
                    });
                    
                    await membership.save();
                    
                    console.log(`   ПОСЛЕ: totalClasses = ${membership.totalClasses}, classesRemaining = ${membership.classesRemaining}`);
                    console.log(`   ✅ Исправлено!\n`);
                    fixed++;
                }
            }
        }
        
        console.log(`\n✅ Всего исправлено абонементов: ${fixed}\n`);
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await mongoose.connection.close();
        process.exit(0);
    }
}

fixAll();

