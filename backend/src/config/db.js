const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        // 🚀 ОПТИМИЗАЦИЯ: Connection pooling для MongoDB
        const conn = await mongoose.connect(process.env.MONGODB_URI, {
            // Connection pool settings
            maxPoolSize: 10,        // Максимум 10 подключений в пуле
            minPoolSize: 2,         // Минимум 2 подключения в пуле
            maxIdleTimeMS: 30000,   // Закрывать неиспользуемые подключения через 30 сек
            serverSelectionTimeoutMS: 5000, // Таймаут выбора сервера 5 сек
            socketTimeoutMS: 45000, // Таймаут сокета 45 сек
            bufferMaxEntries: 0,    // Отключить буферизацию команд
            bufferCommands: false, // Не буферизировать команды при отключении
        });
        
        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
        console.log(`📊 Database: ${conn.connection.name}`);
        console.log(`🚀 Connection Pool: maxPoolSize=10, minPoolSize=2`);
    } catch (error) {
        console.error(`❌ MongoDB Connection Error: ${error.message}`);
        process.exit(1);
    }
};

module.exports = connectDB;

