const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;
let isConnected = false;

// Подключение к тестовой БД перед всеми тестами
beforeAll(async () => {
    if (!isConnected && mongoose.connection.readyState === 0) {
        // В CI используем реальную БД, локально - Memory Server
        if (process.env.CI === 'true' && process.env.MONGODB_URI) {
            console.log('🔄 CI mode: Using real test database');
            await mongoose.connect(process.env.MONGODB_URI);
            isConnected = true;
            console.log('✅ Test DB connected (Real MongoDB for CI)');
        } else {
            console.log('💻 Local mode: Using Memory Server');
            mongoServer = await MongoMemoryServer.create();
            const mongoUri = mongoServer.getUri();
            await mongoose.connect(mongoUri);
            isConnected = true;
            console.log('✅ Test DB connected (Memory Server - Fast!)');
        }
    }
}, 60000);

// Быстрая очистка БД после каждого теста
afterEach(async () => {
    if (mongoose.connection.readyState !== 0) {
        const collections = mongoose.connection.collections;
        const promises = Object.keys(collections).map(key => 
            collections[key].deleteMany({})
        );
        await Promise.all(promises);
    }
});

// Отключение от БД после всех тестов
afterAll(async () => {
    if (isConnected) {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
        if (mongoServer) {
            await mongoServer.stop();
        }
        isConnected = false;
        console.log('✅ Test DB disconnected');
    }
}, 60000);

// Вспомогательные функции для тестов
const createTestUser = async (role = 'student', customData = {}) => {
    const Student = require('../src/models/Student');
    
    const defaultPassword = 'test123456';
    
    const userData = {
        name: customData.name || 'Test User',
        phone: customData.phone || '+7 (700) 000-00-00',
        password: defaultPassword, // НЕ хешируем - это сделает pre-save hook в модели
        role: role,
        gender: customData.gender || 'male',
        ...customData
    };
    
    const user = await Student.create(userData);
    return { user, password: defaultPassword };
};

const generateAuthToken = (user) => {
    const jwt = require('jsonwebtoken');
    return jwt.sign(
        { 
            userId: user._id.toString(),
            id: user._id.toString(), 
            role: user.role 
        },
        process.env.JWT_SECRET || 'test-secret-key',
        { expiresIn: '7d' }
    );
};

module.exports = {
    createTestUser,
    generateAuthToken
};

