const mongoose = require('mongoose');
const dotenvFlow = require('dotenv-flow');
const path = require('path');
const BlogPost = require('./src/models/BlogPost');

dotenvFlow.config({
    path: path.join(__dirname)
});

const SLUGS_TO_DELETE = [
    'novyj-zal-otkryt',
    '5-uprazhnenij-dlya-razminki',
    'istoriya-poliny',
    'otchetnyj-koncert-2025'
];

async function purge() {
    try {
        if (!process.env.MONGODB_URI) {
            console.error('❌ Переменная окружения MONGODB_URI не задана');
            process.exit(1);
        }

        console.log('🔌 Подключаюсь к MongoDB…');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Подключение установлено');

        const result = await BlogPost.deleteMany({ slug: { $in: SLUGS_TO_DELETE } });

        if (result.deletedCount) {
            console.log(`🧹 Удалено записей: ${result.deletedCount}`);
        } else {
            console.log('ℹ️ Указанные статьи не найдены — база чистая');
        }

        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Ошибка очистки:', error);
        process.exit(1);
    }
}

purge();
