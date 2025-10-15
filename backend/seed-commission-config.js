const mongoose = require('mongoose');
const dotenv = require('dotenv');
const CommissionConfig = require('./src/models/CommissionConfig');
const Student = require('./src/models/Student');

dotenv.config();

async function seedCommissionConfig() {
    try {
        console.log('🔄 Подключение к MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ MongoDB подключен');
        
        // Найти супер-админа для createdBy
        const superAdmin = await Student.findOne({ role: 'super_admin' });
        
        if (!superAdmin) {
            console.log('⚠️  Супер-админ не найден. Создайте супер-админа сначала.');
            process.exit(1);
        }
        
        console.log(`👤 Супер-админ найден: ${superAdmin.name}`);
        
        // Проверить есть ли уже конфигурация для менеджеров
        const existingManagerConfig = await CommissionConfig.findOne({
            role: 'sales_manager',
            user: null,
            isActive: true
        });
        
        if (existingManagerConfig) {
            console.log('ℹ️  Конфигурация для менеджеров уже существует. Пропускаем.');
        } else {
            // Создать конфигурацию для менеджеров
            const managerConfig = await CommissionConfig.create({
                role: 'sales_manager',
                user: null,  // Общая конфигурация
                membershipTiers: [
                    { min: 1, max: 10, rate: 10 },    // 1-10: 10%
                    { min: 11, max: 30, rate: 15 },   // 11-30: 15%
                    { min: 31, max: null, rate: 25 }  // 31+: 25%
                ],
                trialRate: 10,           // Пробные: 10%
                singleClassRate: 10,     // Разовые: 10%
                individualClassRate: 15, // Индивидуальные: 15%
                bonusForPlan: 20000,     // Премия за план: 20,000₸
                effectiveFrom: new Date('2024-01-01'),
                createdBy: superAdmin._id,
                changeNote: 'Первоначальная конфигурация',
                isActive: true
            });
            
            console.log('✅ Создана конфигурация для менеджеров:');
            console.log(`   • 1-10 абонементов: ${managerConfig.membershipTiers[0].rate}%`);
            console.log(`   • 11-30 абонементов: ${managerConfig.membershipTiers[1].rate}%`);
            console.log(`   • 31+ абонементов: ${managerConfig.membershipTiers[2].rate}%`);
            console.log(`   • Пробные: ${managerConfig.trialRate}%`);
            console.log(`   • Разовые: ${managerConfig.singleClassRate}%`);
            console.log(`   • Индивидуальные: ${managerConfig.individualClassRate}%`);
            console.log(`   • Премия за план: ${managerConfig.bonusForPlan}₸`);
        }
        
        // Проверить есть ли конфигурация для преподавателей
        const existingTeacherConfig = await CommissionConfig.findOne({
            role: 'teacher',
            user: null,
            isActive: true
        });
        
        if (existingTeacherConfig) {
            console.log('ℹ️  Конфигурация для преподавателей уже существует. Пропускаем.');
        } else {
            // Создать конфигурацию для преподавателей (базовая)
            const teacherConfig = await CommissionConfig.create({
                role: 'teacher',
                user: null,
                membershipTiers: [],  // Не используется для преподавателей
                teacherRates: {
                    groupClassFixed: 0,           // За групповое: 0₸ (или фикс. ставка)
                    individualClassRate: 0.20,    // За индивидуальное: 20%
                    membershipBonusRate: 0.05,    // Бонус от абонементов группы: 5%
                    perStudentFixed: 500          // За студента в группе: 500₸
                },
                effectiveFrom: new Date('2024-01-01'),
                createdBy: superAdmin._id,
                changeNote: 'Первоначальная конфигурация для преподавателей',
                isActive: true
            });
            
            console.log('✅ Создана конфигурация для преподавателей:');
            console.log(`   • Индивидуальные занятия: ${teacherConfig.teacherRates.individualClassRate * 100}%`);
            console.log(`   • Бонус от абонементов группы: ${teacherConfig.teacherRates.membershipBonusRate * 100}%`);
            console.log(`   • За студента в группе: ${teacherConfig.teacherRates.perStudentFixed}₸`);
        }
        
        console.log('');
        console.log('═══════════════════════════════════════════════════════');
        console.log('✅ Конфигурации комиссий успешно созданы!');
        console.log('═══════════════════════════════════════════════════════');
        
        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Ошибка при создании конфигураций:', error);
        await mongoose.connection.close();
        process.exit(1);
    }
}

seedCommissionConfig();

