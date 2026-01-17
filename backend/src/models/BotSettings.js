const mongoose = require('mongoose');

/**
 * Модель настроек WhatsApp бота
 * Singleton - только одна запись в базе
 */
const botSettingsSchema = new mongoose.Schema({
    // Основные настройки
    isActive: {
        type: Boolean,
        default: false,
        description: 'Включен ли бот'
    },

    phoneNumber: {
        type: String,
        trim: true,
        description: 'Номер телефона бота'
    },

    // Настройки напоминаний
    reminderHoursBefore: {
        type: Number,
        default: 12,
        min: 1,
        max: 48,
        description: 'За сколько часов до занятия напоминать'
    },

    quietHoursStart: {
        type: Number,
        default: 20,
        min: 0,
        max: 23,
        description: 'Начало тихих часов (не отправлять сообщения)'
    },

    quietHoursEnd: {
        type: Number,
        default: 9,
        min: 0,
        max: 23,
        description: 'Конец тихих часов'
    },

    quietHoursEnd: {
        type: Number,
        default: 9,
        min: 0,
        max: 23,
        description: 'Конец тихих часов'
    },

    // Настройки "дожима" (follow-up)
    followUpEnabled: {
        type: Boolean,
        default: true,
        description: 'Включить автоматическое повторное обращение'
    },
    followUpDelayMinutes: {
        type: Number,
        default: 30,
        min: 5,
        max: 1440, // 24 часа
        description: 'Через сколько минут писать, если клиент молчит'
    },

    // Настройки AI (Gemini)
    geminiApiKey: {
        type: String,
        trim: true,
        description: 'API ключ Gemini'
    },

    geminiModel: {
        type: String,
        default: 'gemini-3.0-flash',
        enum: [
            'gemini-3.0-flash',         // NEW! Самый новый и быстрый
            'gemini-2.0-flash',
            'gemini-1.5-pro',
            'gemini-1.5-flash',
            'gemini-1.5-flash-8b',
            'gemini-pro'
        ],
        description: 'Модель Gemini для использования'
    },

    maxTokensPerMessage: {
        type: Number,
        default: 500,
        min: 100,
        max: 2000,
        description: 'Максимум токенов на ответ'
    },

    temperature: {
        type: Number,
        default: 0.7,
        min: 0,
        max: 1,
        description: 'Температура генерации (креативность)'
    },

    // Системный промпт (оптимизированный для экономии токенов)
    systemPrompt: {
        type: String,
        default: `Ты Динара — менеджер студии танцев "Sense of Dance" (Актобе, пр.Абулхаир хана 58в, ост.Казпочта).

СТИЛЬ: Дружелюбно, с эмодзи (💃🔥✨). Заканчивай вопросом/предложением. Коротко, без простыней.

НАПРАВЛЕНИЯ:
- Дети/Подростки: K-Pop, Современная хореография, Jazz Funk
- Взрослые: High Heels, Бачата, Сальса, Jazz Funk
- 45+: Бачата Lady Style

ЦЕНА: ~25000тг/8 занятий (абонемент). Пробное занятие — отличный старт!

АЛГОРИТМ:
1. Приветствие: "Для себя или ребенка танцы ищете?"
2. Узнай возраст (для подбора группы)
3. Уточни смену учебы (для детей) или удобное время (для взрослых)
4. Предложи подходящую группу
5. Запиши на пробное занятие

ВОЗРАЖЕНИЯ:
- "Никогда не танцевала" → "90% учеников приходят с нуля! Педагоги объясняют на пальцах."
- "Мне N лет" → "Отличный возраст! У нас есть группа специально для вас."

ВАЖНО: Если не знаешь точного ответа — попроси номер, скажи что уточнишь у педагога.`
    },

    // Приветственное сообщение
    welcomeMessage: {
        type: String,
        default: 'Здравствуйте! 👋 Это студия Sense of Dance. Рады вас видеть! Подскажите, танцы ищете для себя или для ребенка?'
    },

    // Статус подключения WhatsApp
    whatsappStatus: {
        type: String,
        enum: ['disconnected', 'connecting', 'connected', 'error'],
        default: 'disconnected'
    },

    whatsappLastConnected: {
        type: Date
    },

    // Статистика
    stats: {
        totalConversations: { type: Number, default: 0 },
        totalBookings: { type: Number, default: 0 },
        totalMessages: { type: Number, default: 0 },
        lastMessageAt: { type: Date }
    }

}, {
    timestamps: true
});

// Статический метод для получения настроек (singleton)
botSettingsSchema.statics.getSettings = async function () {
    let settings = await this.findOne();
    if (!settings) {
        settings = await this.create({});
    }
    return settings;
};

// Метод для обновления статистики
botSettingsSchema.methods.incrementStats = async function (field) {
    if (this.stats[field] !== undefined) {
        this.stats[field]++;
        if (field === 'totalMessages') {
            this.stats.lastMessageAt = new Date();
        }
        await this.save();
    }
};

// Метод проверки тихих часов
botSettingsSchema.methods.isQuietHours = function (date = new Date()) {
    const hour = date.getHours();

    // Если start > end (например, 20:00 - 09:00), то тихие часы пересекают полночь
    if (this.quietHoursStart > this.quietHoursEnd) {
        return hour >= this.quietHoursStart || hour < this.quietHoursEnd;
    }

    return hour >= this.quietHoursStart && hour < this.quietHoursEnd;
};

// Индекс для singleton
botSettingsSchema.index({}, { unique: true });

module.exports = mongoose.model('BotSettings', botSettingsSchema);
