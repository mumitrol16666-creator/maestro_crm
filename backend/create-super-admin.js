// Скрипт для создания супер-администратора
// Использование: node create-super-admin.js

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;

async function createSuperAdmin() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Подключено к MongoDB\n');
        
        const Student = require('./src/models/Student');
        
        // Данные супер-админа
        const adminData = {
            name: 'Администратор',
            phone: '+7 (700) 095-09-04',
            password: '123456', // Временный пароль
            gender: 'male',
            role: 'super_admin',
            birthDate: new Date('1990-01-01')
        };
        
        // Проверяем существует ли уже
        const existing = await Student.findOne({ phone: adminData.phone });
        
        if (existing) {
            console.log('⚠️  Пользователь с таким телефоном уже существует!');
            console.log(`   Имя: ${existing.name}`);
            console.log(`   Телефон: ${existing.phone}`);
            console.log(`   Роль: ${existing.role}\n`);
            
            // Обновляем роль если это не супер-админ
            if (existing.role !== 'super_admin') {
                await Student.updateOne(
                    { phone: adminData.phone },
                    { $set: { role: 'super_admin' } }
                );
                console.log('✅ Роль обновлена до super_admin!');
            }
            
            await mongoose.connection.close();
            console.log('\n✅ Готово!');
            console.log('🔑 Можете войти:');
            console.log(`   Телефон: ${adminData.phone}`);
            console.log(`   Пароль: <ваш текущий пароль>`);
            process.exit(0);
        }
        
        // Создаём нового супер-админа
        console.log('👤 Создание супер-администратора...');
        
        const admin = new Student(adminData);
        await admin.save();
        
        console.log('\n✅ Супер-администратор успешно создан!\n');
        console.log('👤 Данные для входа:');
        console.log(`   Имя: ${admin.name}`);
        console.log(`   Телефон: ${admin.phone}`);
        console.log(`   Пароль: ${adminData.password}`);
        console.log(`   Роль: ${admin.role}`);
        console.log(`   ID: ${admin._id}\n`);
        
        console.log('🔐 ВАЖНО: Смените пароль после первого входа!');
        
        await mongoose.connection.close();
        console.log('\n✅ Готово!');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        await mongoose.connection.close();
        process.exit(1);
    }
}

console.log('🔧 Создание супер-администратора...\n');
createSuperAdmin();

