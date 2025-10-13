require('dotenv').config({ path: __dirname + '/.env' });
const mongoose = require('mongoose');
const Direction = require('./src/models/Direction');

console.log('MONGODB_URI:', process.env.MONGODB_URI ? '✅ Loaded' : '❌ Not found');

const directions = [
    { 
        name: 'K-pop', 
        description: 'Энергичный корейский поп-данс с яркой хореографией',
        minAge: 10,
        level: 'Все уровни',
        pricing: { trial: 2000, month: 22000, threeMonths: 55000 },
        order: 1 
    },
    { 
        name: 'CHOREO', 
        description: 'Постановочная хореография с элементами современного танца',
        minAge: 12,
        level: 'Все уровни',
        pricing: { trial: 2000, month: 22000, threeMonths: 55000 },
        order: 2 
    },
    { 
        name: 'K-pop CHOREO', 
        description: 'Сочетание K-pop стиля с постановочной хореографией',
        minAge: 10,
        level: 'Средний уровень',
        pricing: { trial: 2000, month: 22000, threeMonths: 55000 },
        order: 3 
    },
    { 
        name: 'All styles', 
        description: 'Микс различных танцевальных стилей и направлений',
        minAge: 14,
        level: 'Все уровни',
        pricing: { trial: 2000, month: 22000, threeMonths: 55000 },
        order: 4 
    },
    { 
        name: 'JAZZFUNK', 
        description: 'Яркий и сексуальный танец с элементами джаза и фанка',
        minAge: 16,
        level: 'Все уровни',
        pricing: { trial: 2000, month: 22000, threeMonths: 55000 },
        order: 5 
    },
    { 
        name: 'Girlish', 
        description: 'Женственный и нежный танец, подчеркивающий красоту движений',
        minAge: 16,
        level: 'Все уровни',
        pricing: { trial: 2000, month: 22000, threeMonths: 55000 },
        order: 6 
    },
    { 
        name: 'High heels', 
        description: 'Танец на каблуках, развивающий грацию и уверенность',
        minAge: 18,
        level: 'Все уровни',
        pricing: { trial: 2000, month: 22000, threeMonths: 55000 },
        order: 7 
    },
    { 
        name: 'Bachata lady style', 
        description: 'Женский стиль бачаты с акцентом на пластику и технику',
        minAge: 18,
        level: 'Все уровни',
        pricing: { trial: 2000, month: 22000, threeMonths: 55000 },
        order: 8 
    },
    { 
        name: 'Bachata lady style 45+', 
        description: 'Бачата для элегантных женщин в возрасте 45+',
        minAge: 45,
        level: 'Все уровни',
        pricing: { trial: 2000, month: 22000, threeMonths: 55000 },
        order: 9 
    },
    { 
        name: 'Social bachata', 
        description: 'Социальная бачата для танцев в паре на вечеринках',
        minAge: 16,
        level: 'Начинающие и продолжающие',
        pricing: { trial: 2000, month: 22000, threeMonths: 55000 },
        order: 10 
    }
];

async function initDirections() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');
        
        // Проверяем существующие направления
        const existing = await Direction.find();
        console.log(`📊 Существующих направлений: ${existing.length}`);
        
        if (existing.length > 0) {
            console.log('⚠️  Направления уже существуют. Удаляем старые данные...');
            await Direction.deleteMany({});
            console.log('✅ Старые данные удалены');
        }
        
        // Создаем направления
        for (const dir of directions) {
            await Direction.create(dir);
            console.log(`✅ Создано: ${dir.name}`);
        }
        
        console.log('\n🎉 Все направления успешно созданы!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Ошибка:', error);
        process.exit(1);
    }
}

initDirections();




