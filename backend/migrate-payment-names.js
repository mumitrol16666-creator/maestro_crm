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
const Student = require('./src/models/Student');

async function migratePaymentNames() {
    try {
        console.log('\n🔄 МИГРАЦИЯ: Добавление имен в платежи\n');
        
        // Находим все платежи где нет сохраненных имен
        const payments = await Payment.find({
            $or: [
                { studentName: { $exists: false } },
                { studentName: null },
                { studentName: '' }
            ]
        });
        
        console.log(`Найдено платежей без сохраненных имен: ${payments.length}\n`);
        
        if (payments.length === 0) {
            console.log('✅ Все платежи уже имеют сохраненные имена!\n');
            return;
        }
        
        let updated = 0;
        let failed = 0;
        
        for (const payment of payments) {
            try {
                // Получаем студента
                if (payment.student) {
                    const student = await Student.findById(payment.student).select('name lastName phone').lean();
                    if (student) {
                        payment.studentName = `${student.name} ${student.lastName || ''}`.trim();
                        payment.studentPhone = student.phone;
                    } else {
                        payment.studentName = 'Студент удален';
                        payment.studentPhone = '';
                    }
                }
                
                // Получаем менеджера
                if (payment.manager) {
                    const manager = await Student.findById(payment.manager).select('name lastName').lean();
                    if (manager) {
                        payment.managerName = `${manager.name} ${manager.lastName || ''}`.trim();
                    } else {
                        payment.managerName = 'Менеджер удален';
                    }
                }
                
                await payment.save();
                updated++;
                
                if (updated % 10 === 0) {
                    console.log(`✅ Обновлено: ${updated}/${payments.length}`);
                }
            } catch (error) {
                console.error(`❌ Ошибка обновления платежа ${payment._id}:`, error.message);
                failed++;
            }
        }
        
        console.log(`\n📊 РЕЗУЛЬТАТ:`);
        console.log(`✅ Обновлено: ${updated}`);
        console.log(`❌ Ошибок: ${failed}`);
        console.log(`📝 Всего: ${payments.length}\n`);
        
    } catch (error) {
        console.error('❌ Ошибка миграции:', error);
    } finally {
        await mongoose.connection.close();
        process.exit(0);
    }
}

migratePaymentNames();

