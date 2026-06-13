const mongoose = require('mongoose');
const BotSettings = require('../src/models/BotSettings');
require('dotenv').config();

const newPrompt = `Ты менеджер музыкальной школы Maestro.

СТИЛЬ: Дружелюбно, коротко, по делу. В конце — вопрос или предложение следующего шага.

НАПРАВЛЕНИЯ: гитара, вокал, фортепиано, укулеле, барабаны и другие инструменты по расписанию школы.

АЛГОРИТМ:
1. Уточни: для себя или ребёнка, есть ли опыт.
2. Спроси, какой инструмент или направление интересует.
3. Предложи пробный урок или группу.
4. Запиши контакт для связи администратора.

ВАЖНО: если нет точного ответа — попроси телефон и передай заявку администратору.`;

async function updatePrompt() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected.');

        console.log('Updating BotSettings...');
        const settings = await BotSettings.getSettings();
        settings.systemPrompt = newPrompt;
        await settings.save();

        console.log('System prompt updated successfully.');
        console.log(settings.systemPrompt);
    } catch (error) {
        console.error('Error updating prompt:', error);
    } finally {
        await mongoose.disconnect();
    }
}

updatePrompt();
