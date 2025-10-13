require('dotenv').config();
const mongoose = require('mongoose');
const Room = require('./src/models/Room');

const rooms = [
    {
        name: 'Большой зал',
        color: '#eb4d77'  // Розовый
    },
    {
        name: 'Малый зал',
        color: '#9b4dd4'  // Фиолетовый
    },
    {
        name: 'Зеркальный зал',
        color: '#4d9beb'  // Голубой
    }
];

async function initRooms() {
    try {
        console.log('🔍 Подключение к MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Подключено к MongoDB\n');
        
        // Удаляем старые залы
        await Room.deleteMany({});
        console.log('🗑️  Старые залы удалены\n');
        
        // Создаём новые
        console.log('🏢 Создание залов...\n');
        for (const roomData of rooms) {
            const room = await Room.create(roomData);
            console.log(`✅ ${room.name} - ${room.color}`);
        }
        
        console.log('✨ Залы успешно инициализированы!');
        console.log(`📊 Всего залов: ${rooms.length}`);
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Ошибка:', error);
        process.exit(1);
    }
}

initRooms();

