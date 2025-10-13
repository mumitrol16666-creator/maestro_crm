// Скрипт для изменения роли пользователя
// Использование: node make-admin.js [phone] [role]
// Пример: node make-admin.js "+7 (700) 095-09-04" super_admin

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;

// Получаем параметры из командной строки
const phone = process.argv[2] || '+7 (700) 095-09-04';
const role = process.argv[3] || 'super_admin';

// Валидные роли
const VALID_ROLES = ['student', 'sales_manager', 'teacher', 'admin', 'super_admin'];

async function changeRole() {
    try {
        // Проверка роли
        if (!VALID_ROLES.includes(role)) {
            console.error('❌ Ошибка: Недопустимая роль!');
            console.log('Доступные роли:');
            console.log('  - student: обычный ученик');
            console.log('  - sales_manager: менеджер по продажам');
            console.log('  - teacher: преподаватель');
            console.log('  - admin: администратор');
            console.log('  - super_admin: супер-администратор');
            process.exit(1);
        }
        
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Подключено к MongoDB\n');
        
        const Student = require('./src/models/Student');
        
        // Проверяем существует ли пользователь
        const user = await Student.findOne({ phone });
        
        if (!user) {
            console.error(`❌ Пользователь с телефоном ${phone} не найден!`);
            await mongoose.connection.close();
            process.exit(1);
        }
        
        const oldRole = user.role;
        
        // Обновляем роль
        const result = await Student.updateOne(
            { phone },
            { $set: { role } }
        );
        
        if (result.modifiedCount > 0) {
            console.log(`✅ Роль успешно изменена: ${oldRole} → ${role}\n`);
            
            const updatedUser = await Student.findOne({ phone });
            console.log('👤 Информация о пользователе:');
            console.log(`   Имя: ${updatedUser.name}`);
            console.log(`   Телефон: ${updatedUser.phone}`);
            console.log(`   Роль: ${updatedUser.role}`);
            console.log(`   ID: ${updatedUser._id}`);
        } else {
            console.log(`⚠️  Роль уже "${role}", изменений не было.`);
        }
        
        await mongoose.connection.close();
        console.log('\n✅ Готово!');
        
        if (role === 'super_admin') {
            console.log('🔑 Теперь вы можете войти как супер-администратор!');
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        process.exit(1);
    }
}

console.log('🔧 Изменение роли пользователя...');
console.log(`📞 Телефон: ${phone}`);
console.log(`👤 Новая роль: ${role}\n`);

changeRole();


