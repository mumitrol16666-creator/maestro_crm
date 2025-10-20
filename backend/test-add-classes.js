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

async function testAddClasses() {
    try {
        console.log('\n🧪 ТЕСТ: Добавление занятий к абонементу\n');
        
        // Находим любой активный абонемент
        const membership = await Membership.findOne({ status: 'active' });
        
        if (!membership) {
            console.log('❌ Нет активных абонементов для теста\n');
            return;
        }
        
        console.log(`📋 Найден абонемент: ${membership._id}`);
        console.log(`   Занятий до: ${membership.classesRemaining}`);
        console.log(`   Всего занятий: ${membership.totalClasses}\n`);
        
        // Находим админа
        const admin = await Student.findOne({ role: 'super_admin' });
        
        if (!admin) {
            console.log('❌ Админ не найден\n');
            return;
        }
        
        console.log(`👤 Админ: ${admin.name} ${admin.lastName || ''}\n`);
        
        // ТЕСТ 1: С причиной
        console.log('🧪 ТЕСТ 1: Добавление с причиной');
        try {
            await membership.addClasses(2, 'Уважительная причина - пропуск по болезни', admin._id);
            console.log(`✅ УСПЕХ! Занятий стало: ${membership.classesRemaining}\n`);
        } catch (err) {
            console.log(`❌ ОШИБКА: ${err.message}\n`);
        }
        
        // ТЕСТ 2: Без причины (должна быть ошибка)
        console.log('🧪 ТЕСТ 2: Добавление БЕЗ причины (должна быть ошибка)');
        try {
            await membership.addClasses(1, '', admin._id);
            console.log(`✅ Занятий стало: ${membership.classesRemaining}\n`);
        } catch (err) {
            console.log(`❌ ОЖИДАЕМАЯ ОШИБКА: ${err.message}\n`);
        }
        
        // ТЕСТ 3: С undefined причиной
        console.log('🧪 ТЕСТ 3: Добавление с undefined причиной (должна быть ошибка)');
        try {
            await membership.addClasses(1, undefined, admin._id);
            console.log(`✅ Занятий стало: ${membership.classesRemaining}\n`);
        } catch (err) {
            console.log(`❌ ОЖИДАЕМАЯ ОШИБКА: ${err.message}\n`);
        }
        
        console.log('📊 ИТОГО:');
        console.log(`   Текущее состояние: ${membership.classesRemaining} занятий`);
        console.log(`   Транзакций: ${membership.transactions.length}\n`);
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error);
    } finally {
        await mongoose.connection.close();
        process.exit(0);
    }
}

testAddClasses();

