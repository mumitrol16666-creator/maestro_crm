const mongoose = require('mongoose');
const dotenv = require('dotenv');
const CommissionConfig = require('./src/models/CommissionConfig');
const Student = require('./src/models/Student');

dotenv.config();

async function updateCommissionConfig() {
    try {
        console.log('🔄 Подключение к MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ MongoDB подключен');
        
        // Найти супер-админа для createdBy
        const superAdmin = await Student.findOne({ role: 'super_admin' });
        
        if (!superAdmin) {
            console.log('⚠️  Супер-админ не найден. Пропускаем обновление.');
            process.exit(1);
        }
        
        console.log(`👤 Супер-админ найден: ${superAdmin.name}`);
        
        // УДАЛИТЬ все старые конфигурации для менеджеров
        console.log('🗑️  Удаление старых конфигураций для менеджеров...');
        await CommissionConfig.deleteMany({ role: 'sales_manager' });
        
        // Создать НОВУЮ конфигурацию с правильными значениями
        const managerConfig = await CommissionConfig.create({
            role: 'sales_manager',
            user: null,
            membershipTiers: [
                { min: 1, max: 10, rate: 10 },    // 1-10: 10%
                { min: 11, max: 30, rate: 15 },   // 11-30: 15%
                { min: 31, max: null, rate: 25 }  // 31+: 25%
            ],
            trialRate: 10,           // Пробные: 10%
            singleClassRate: 10,     // Разовые: 10%
            individualClassRate: 15, // Индивидуальные: 15%
            bonusForPlan: 20000,
            effectiveFrom: new Date('2024-01-01'),
            createdBy: superAdmin._id,
            changeNote: 'Обновление: исправлены проценты (15% вместо 0.15)',
            isActive: true
        });
        
        console.log('✅ Конфигурация обновлена:');
        console.log(`   • 1-10 абонементов: ${managerConfig.membershipTiers[0].rate}%`);
        console.log(`   • 11-30 абонементов: ${managerConfig.membershipTiers[1].rate}%`);
        console.log(`   • 31+ абонементов: ${managerConfig.membershipTiers[2].rate}%`);
        console.log(`   • Пробные: ${managerConfig.trialRate}%`);
        console.log(`   • Разовые: ${managerConfig.singleClassRate}%`);
        console.log(`   • Индивидуальные: ${managerConfig.individualClassRate}%`);
        
        console.log('');
        console.log('═══════════════════════════════════════════════════════');
        console.log('✅ Конфигурации успешно обновлены!');
        console.log('═══════════════════════════════════════════════════════');
        
        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Ошибка при обновлении конфигураций:', error);
        await mongoose.connection.close();
        process.exit(1);
    }
}

updateCommissionConfig();

