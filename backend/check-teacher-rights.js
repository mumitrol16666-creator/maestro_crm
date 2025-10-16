const mongoose = require('mongoose');
const RolePermissions = require('./src/models/RolePermissions');
require('dotenv').config();

async function checkTeacherRights() {
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sense-of-dance';
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');
        
        const teacherPermissions = await RolePermissions.findOne({ role: 'teacher' });
        
        if (!teacherPermissions) {
            console.log('❌ NO TEACHER PERMISSIONS FOUND IN DATABASE!');
        } else {
            console.log('\n📋 CURRENT TEACHER PERMISSIONS IN DATABASE:');
            console.log('='.repeat(60));
            console.log('\n🔐 PERMISSIONS:');
            console.log(JSON.stringify(teacherPermissions.permissions, null, 2));
            console.log('\n👁️  VISIBILITY:');
            console.log(JSON.stringify(teacherPermissions.visibility, null, 2));
            console.log('\n' + '='.repeat(60));
        }
        
        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

checkTeacherRights();

