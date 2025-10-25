const mongoose = require('mongoose');
const Student = require('./src/models/Student');

// Подключение к базе данных
async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/senseofdance', {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('✅ Подключено к MongoDB');
    } catch (error) {
        console.error('❌ Ошибка подключения к MongoDB:', error);
        process.exit(1);
    }
}

// Создание тестовых пользователей
async function createTestUsers() {
    try {
        console.log('👥 Создаем тестовых пользователей...');
        
        // Создаем менеджеров
        const managers = [
            {
                name: 'Анна',
                lastName: 'Иванова',
                phone: '+7 (701) 111-11-11',
                email: 'anna@example.com',
                role: 'sales_manager',
                gender: 'female'
            },
            {
                name: 'Дмитрий',
                lastName: 'Петров',
                phone: '+7 (701) 222-22-22',
                email: 'dmitry@example.com',
                role: 'sales_manager',
                gender: 'male'
            }
        ];
        
        // Создаем преподавателей
        const teachers = [
            {
                name: 'Елена',
                lastName: 'Смирнова',
                phone: '+7 (701) 333-33-33',
                email: 'elena@example.com',
                role: 'teacher',
                gender: 'female',
                teacherInfo: {
                    direction: 'Hip-Hop',
                    experience: '5 лет',
                    displayOrder: 1
                }
            },
            {
                name: 'Алексей',
                lastName: 'Козлов',
                phone: '+7 (701) 444-44-44',
                email: 'alexey@example.com',
                role: 'teacher',
                gender: 'male',
                teacherInfo: {
                    direction: 'K-pop',
                    experience: '3 года',
                    displayOrder: 2
                }
            },
            {
                name: 'Мария',
                lastName: 'Новикова',
                phone: '+7 (701) 555-55-55',
                email: 'maria@example.com',
                role: 'teacher',
                gender: 'female',
                teacherInfo: {
                    direction: 'Contemporary',
                    experience: '7 лет',
                    displayOrder: 3
                }
            }
        ];
        
        // Удаляем существующих тестовых пользователей
        await Student.deleteMany({ 
            phone: { $in: ['+7 (701) 111-11-11', '+7 (701) 222-22-22', '+7 (701) 333-33-33', '+7 (701) 444-44-44', '+7 (701) 555-55-55'] }
        });
        console.log('🗑️ Удалены старые тестовые пользователи');
        
        // Создаем менеджеров
        for (const managerData of managers) {
            const manager = new Student({
                ...managerData,
                password: 'test123456',
                status: 'active'
            });
            await manager.save();
            console.log(`✅ Создан менеджер: ${managerData.name} ${managerData.lastName}`);
        }
        
        // Создаем преподавателей
        for (const teacherData of teachers) {
            const teacher = new Student({
                ...teacherData,
                password: 'test123456',
                status: 'active'
            });
            await teacher.save();
            console.log(`✅ Создан преподаватель: ${teacherData.name} ${teacherData.lastName}`);
        }
        
        console.log('🎉 Все тестовые пользователи созданы!');
        console.log('👥 Менеджеры: 2');
        console.log('👨‍🏫 Преподаватели: 3');
        
    } catch (error) {
        console.error('❌ Ошибка создания пользователей:', error);
    }
}

// Основная функция
async function main() {
    await connectDB();
    await createTestUsers();
    await mongoose.disconnect();
    console.log('✅ Готово!');
}

// Запуск
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { createTestUsers };
