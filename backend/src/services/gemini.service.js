/**
 * Gemini AI Service
 * Интеграция с Google Gemini 3.0 Pro для генерации ответов бота
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const BotSettings = require('../models/BotSettings');
const Group = require('../models/Group');
const Direction = require('../models/Direction');

class GeminiService {
    constructor() {
        this.genAI = null;
        this.model = null;
        this.isInitialized = false;
    }

    /**
     * Инициализация сервиса
     */
    async initialize() {
        try {
            const settings = await BotSettings.getSettings();

            if (!settings.geminiApiKey) {
                console.warn('⚠️ [Gemini] API ключ не настроен');
                return false;
            }

            this.genAI = new GoogleGenerativeAI(settings.geminiApiKey);
            this.model = this.genAI.getGenerativeModel({
                model: settings.geminiModel || 'gemini-1.5-pro'
            });

            this.isInitialized = true;
            console.log('✅ [Gemini] Сервис инициализирован');
            return true;
        } catch (error) {
            console.error('❌ [Gemini] Ошибка инициализации:', error.message);
            return false;
        }
    }

    /**
     * Переинициализация с новым API ключом
     */
    async reinitialize() {
        this.isInitialized = false;
        return await this.initialize();
    }

    /**
     * Получение актуального расписания групп для контекста
     */
    async getScheduleContext() {
        try {
            const groups = await Group.find({ isActive: true })
                .populate('teacher', 'name')
                .lean();

            const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

            const scheduleText = groups.map(g => {
                const scheduleStr = g.schedule
                    .map(s => `${days[s.dayOfWeek - 1]} ${s.time}`)
                    .join(', ');
                return `- ${g.name} (${g.direction}): ${scheduleStr}`;
            }).join('\n');

            return scheduleText || 'Расписание временно недоступно';
        } catch (error) {
            console.error('❌ [Gemini] Ошибка получения расписания:', error);
            return 'Расписание временно недоступно';
        }
    }

    /**
     * Получение списка направлений с возрастными ограничениями
     */
    async getDirectionsContext() {
        try {
            const directions = await Direction.find({ isActive: true }).lean();

            return directions.map(d =>
                `- ${d.name}: от ${d.minAge} лет, ${d.level}`
            ).join('\n');
        } catch (error) {
            return '';
        }
    }

    /**
     * Построение системного промпта с актуальными данными
     */
    async buildSystemPrompt(customPrompt = null) {
        const settings = await BotSettings.getSettings();
        const scheduleContext = await this.getScheduleContext();
        const directionsContext = await this.getDirectionsContext();

        const basePrompt = customPrompt || settings.systemPrompt;

        return `${basePrompt}

АКТУАЛЬНОЕ РАСПИСАНИЕ ГРУПП:
${scheduleContext}

НАПРАВЛЕНИЯ И ВОЗРАСТ:
${directionsContext}

ИНСТРУКЦИИ ДЛЯ СОЗДАНИЯ ЗАЯВКИ:
Когда клиент готов записаться на пробное, уточни:
1. Имя
2. Удобный день и время из расписания
3. Подтверди запись

После подтверждения напиши: "✅ Записала вас на пробное занятие! Ждём в студии по адресу: пр. Абулхаир хана 58в (ост. Казпочта). За день до занятия напомню!"`;
    }

    /**
     * Генерация ответа на сообщение клиента
     * Использует systemInstruction для автоматического кэширования на стороне Gemini
     * @param {Object} conversation - Объект диалога
     * @param {string} userMessage - Сообщение пользователя
     * @returns {Object} - { response, shouldCreateBooking, extractedData }
     */
    async generateResponse(conversation, userMessage) {
        if (!this.isInitialized) {
            const initialized = await this.initialize();
            if (!initialized) {
                return {
                    response: 'Извините, сейчас я не могу ответить. Наш администратор свяжется с вами в ближайшее время!',
                    shouldCreateBooking: false,
                    extractedData: null
                };
            }
        }

        try {
            const settings = await BotSettings.getSettings();

            // Получаем контекст диалога
            const { context, messages } = conversation.getContextForAI(10);

            // Формируем историю сообщений для Gemini
            const chatHistory = messages.map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }]
            }));

            // Добавляем динамический контекст клиента
            let clientContext = '';
            if (context.forWhom) {
                clientContext += `Клиент ищет занятия: ${context.forWhom === 'self' ? 'для себя' : 'для ребенка'}. `;
            }
            if (context.age || context.childAge) {
                clientContext += `Возраст: ${context.age || context.childAge} лет. `;
            }
            if (context.direction) {
                clientContext += `Интересует: ${context.direction}. `;
            }
            if (context.schoolShift) {
                clientContext += `Смена учебы: ${context.schoolShift === 'first' ? 'первая' : 'вторая'}. `;
            }

            // Создаём модель с systemInstruction — это кэшируется автоматически!
            // Системный промпт отправляется только один раз и переиспользуется
            const systemPrompt = await this.buildSystemPrompt();

            console.log(`🤖 [Gemini] Используем модель: ${settings.geminiModel || 'gemini-2.0-flash'}`);
            console.log(`📝 [Gemini] Системный промпт (${systemPrompt.length} символов): ${systemPrompt.substring(0, 100)}...`);

            const modelWithInstruction = this.genAI.getGenerativeModel({
                model: settings.geminiModel || 'gemini-2.0-flash',
                systemInstruction: {
                    role: 'system',
                    parts: [{ text: systemPrompt }]
                },
                generationConfig: {
                    maxOutputTokens: settings.maxTokensPerMessage || 500,
                    temperature: settings.temperature || 0.7,
                },
            });

            // Создаем чат с историей
            const chat = modelWithInstruction.startChat({
                history: chatHistory,
            });

            // Отправляем только сообщение пользователя + краткий контекст о нём
            // Системный промпт уже в systemInstruction и не отправляется повторно
            const messageToSend = clientContext
                ? `[О клиенте: ${clientContext}]\n\n${userMessage}`
                : userMessage;

            console.log(`💬 [Gemini] Отправляем сообщение: ${messageToSend.substring(0, 50)}...`);

            const result = await chat.sendMessage(messageToSend);

            const response = result.response.text();

            console.log(`✅ [Gemini] Ответ: ${response.substring(0, 80)}...`);

            // Логируем информацию о кэшировании (если доступна)
            const usageMetadata = result.response.usageMetadata;
            if (usageMetadata) {
                console.log(`📊 [Gemini] Токены: prompt=${usageMetadata.promptTokenCount}, ` +
                    `cached=${usageMetadata.cachedContentTokenCount || 0}, ` +
                    `response=${usageMetadata.candidatesTokenCount}`);
            }

            // Анализируем ответ на предмет создания заявки
            const shouldCreateBooking = this.checkIfBookingComplete(response, context);

            // Извлекаем данные из сообщения пользователя
            const extractedData = this.extractDataFromMessage(userMessage, context);

            return {
                response,
                shouldCreateBooking,
                extractedData
            };

        } catch (error) {
            console.error('❌ [Gemini] Ошибка генерации:', error);

            // Fallback ответ
            return {
                response: 'Добрый день! Подскажите, чем могу помочь? Ищете танцы для себя или для ребенка?',
                shouldCreateBooking: false,
                extractedData: null
            };
        }
    }

    /**
     * Проверка, завершена ли запись
     */
    checkIfBookingComplete(response, context) {
        const bookingIndicators = [
            'записала вас',
            'записал вас',
            'вы записаны',
            'ждём вас',
            'ждем вас',
            '✅ записала',
            'до встречи'
        ];

        const lowerResponse = response.toLowerCase();
        const hasBookingPhrase = bookingIndicators.some(phrase =>
            lowerResponse.includes(phrase)
        );

        // Проверяем, что есть минимальный контекст для заявки
        const hasMinimalContext = context.direction || context.age || context.childAge;

        return hasBookingPhrase && hasMinimalContext;
    }

    /**
     * Извлечение данных из сообщения пользователя
     */
    extractDataFromMessage(message, currentContext) {
        const extracted = {};
        const lowerMessage = message.toLowerCase();

        // Определяем для кого (себя/ребенка)
        if (!currentContext.forWhom) {
            if (lowerMessage.includes('для ребенка') ||
                lowerMessage.includes('для дочки') ||
                lowerMessage.includes('для сына') ||
                lowerMessage.includes('дочь') ||
                lowerMessage.includes('сын')) {
                extracted.forWhom = 'child';
            } else if (lowerMessage.includes('для себя') ||
                lowerMessage.includes('хочу сама') ||
                lowerMessage.includes('хочу сам') ||
                lowerMessage.includes('мне ')) {
                extracted.forWhom = 'self';
            }
        }

        // Извлекаем возраст
        const ageMatch = message.match(/(\d{1,2})\s*(лет|года|год)/i);
        if (ageMatch) {
            const age = parseInt(ageMatch[1]);
            if (age >= 3 && age <= 100) {
                if (currentContext.forWhom === 'child' || extracted.forWhom === 'child') {
                    extracted.childAge = age;
                } else {
                    extracted.age = age;
                }
            }
        }

        // Извлекаем направление
        const directions = {
            'k-pop': 'K-pop',
            'кпоп': 'K-pop',
            'кей-поп': 'K-pop',
            'бачата': 'Bachata lady style',
            'сальса': 'Social bachata',
            'хай хилс': 'High heels',
            'high heels': 'High heels',
            'каблуки': 'High heels',
            'джаз фанк': 'JUZZFUNK',
            'jazz funk': 'JUZZFUNK',
            'современ': 'CHOREO',
            'хорео': 'CHOREO'
        };

        for (const [keyword, direction] of Object.entries(directions)) {
            if (lowerMessage.includes(keyword)) {
                extracted.direction = direction;
                break;
            }
        }

        // Извлекаем смену учебы
        if (lowerMessage.includes('перв') && lowerMessage.includes('смен')) {
            extracted.schoolShift = 'first';
        } else if (lowerMessage.includes('втор') && lowerMessage.includes('смен')) {
            extracted.schoolShift = 'second';
        }

        // Извлекаем имя (простой паттерн)
        const nameMatch = message.match(/меня зовут\s+([а-яёА-ЯЁa-zA-Z]+)/i);
        if (nameMatch) {
            extracted.name = nameMatch[1];
        }

        return Object.keys(extracted).length > 0 ? extracted : null;
    }

    /**
     * Проверка доступности сервиса
     */
    async healthCheck() {
        if (!this.isInitialized) {
            return { status: 'not_initialized', message: 'API ключ не настроен' };
        }

        try {
            // Простой тестовый запрос
            const result = await this.model.generateContent('Привет');
            return {
                status: 'ok',
                message: 'Сервис работает',
                model: this.model.model
            };
        } catch (error) {
            return {
                status: 'error',
                message: error.message
            };
        }
    }
}

// Singleton instance
const geminiService = new GeminiService();

module.exports = geminiService;
