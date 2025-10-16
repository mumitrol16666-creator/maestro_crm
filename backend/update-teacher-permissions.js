const mongoose = require('mongoose');
const RolePermissions = require('./src/models/RolePermissions');
require('dotenv').config();

async function updateTeacherPermissions() {
    try {
        // Подключение к БД
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sense-of-dance';
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');
        
        // Получаем дефолтные права для teacher
        const defaults = RolePermissions.getDefaultPermissions('teacher');
        
        // Обновляем или создаем права для teacher
        const result = await RolePermissions.findOneAndUpdate(
            { role: 'teacher' },
            {
                role: 'teacher',
                permissions: defaults.permissions,
                visibility: defaults.visibility
            },
            { upsert: true, new: true }
        );
        
        console.log('✅ Teacher permissions updated:');
        console.log('   Permissions:', result.permissions);
        console.log('   Visibility:', result.visibility);
        
        await mongoose.connection.close();
        console.log('✅ Done!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

updateTeacherPermissions();

