const mongoose = require('mongoose');
const RolePermissions = require('./src/models/RolePermissions');
require('dotenv').config();

async function updateTeacherVisibility() {
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sense-of-dance';
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');
        
        // Обновляем видимость для teacher
        const result = await RolePermissions.findOneAndUpdate(
            { role: 'teacher' },
            {
                $set: {
                    'visibility.students': false  // Скрываем студентов
                }
            },
            { new: true }
        );
        
        if (result) {
            console.log('✅ Teacher visibility updated:');
            console.log('   students:', result.visibility.students);
        } else {
            console.log('⚠️  Teacher permissions not found in DB');
        }
        
        await mongoose.connection.close();
        console.log('✅ Done!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

updateTeacherVisibility();

