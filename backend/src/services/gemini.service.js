/**
 * Gemini AI Service
 * Интеграция с Google Gemini 3.0 Pro для генерации ответов бота
 */

const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
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
    /**
     * Получение актуального расписания групп для контекста
     * Объединяем информацию о группах, направлениях и возрасте в один удобный список
     */
    async getScheduleContext() {
        try {
            // Получаем все активные группы
            const groups = await Group.find({ isActive: true })
                .populate('teacher', 'name')
                .lean();

            // Получаем информацию о направлениях для возрастных ограничений
            const directions = await Direction.find({ isActive: true }).lean();
            const directionsMap = {};
            directions.forEach(d => {
                directionsMap[d.name] = { minAge: d.minAge, maxAge: d.maxAge };
            });

            const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

            const scheduleText = groups.map(g => {
                const scheduleStr = g.schedule
                    .map(s => `${days[s.dayOfWeek - 1]} ${s.time}`)
                    .join(', ');

                // Пытаемся определить возраст для группы
                let ageInfo = '';
                // Сначала смотрим настройки группы (если бы они были), потом направления
                const dirInfo = directionsMap[g.direction];
                if (dirInfo) {
                    ageInfo = ` (возраст ${dirInfo.minAge}+)`;
                }

                return `- Группа "${g.name}" [${g.direction}]${ageInfo}: ${scheduleStr}`;
            }).join('\n');

            return scheduleText || 'Расписание временно недоступно';
        } catch (error) {
            console.error('❌ [Gemini] Ошибка получения расписания:', error);
            return 'Расписание временно недоступно';
        }
    }

    /**
     * Построение системного промпта с актуальными данными
     */
    async buildSystemPrompt(customPrompt = null) {
        const settings = await BotSettings.getSettings();
        const scheduleContext = await this.getScheduleContext();

        // Если пользователь задал свой промпт, используем его как базу, но добавляем контекст
        // Если нет - используем дефолтный жесткий промпт
        const basePrompt = customPrompt || settings.systemPrompt || `Ты Динара — администратор студии танцев "Sense of Dance" (Актобе).
Цель: записать клиента на пробное занятие.

ТВОЙ АЛГОРИТМ (СТРОГО СОБЛЮДАЙ):
1. Выясни для кого танцы (взрослый/ребенок).
2. Выясни ВОЗРАСТ (это критично для подбора группы).
3. Спроси о ПРЕДПОЧТЕНИЯХ по стилю (современные, k-pop, народные, и т.д.) ИЛИ спроси про удобное время/смену.
4. ТОЛЬКО ПОСЛЕ ЭТОГО предлагай подходящие группы из списка.
   - Предлагай ВСЕ варианты (будни и выходные).
   - Если вариантов много, сгруппируй их.
5. Когда клиент выбрал — запиши на пробное (спроси Имя и подтверди).

ПРАВИЛА:
- Не выдумывай группы, которых нет в списке.
- Будь вежливой, используй эмодзи (💃, ✨, 😊).
- Если клиент "тупит" или грубит — оставайся профессионалом, переспроси вежливо.`;

        return `${basePrompt}

=== АКТУАЛЬНЫЙ СПИСОК ГРУПП (ТОЛЬКО ЭТИ ГРУППЫ СУЩЕСТВУЮТ) ===
${scheduleContext}

=== ИНСТРУКЦИИ ПО ПОДБОРУ ===
- Ребенок 13 лет -> Подростковые группы (обычно 10-14, 12-16 лет).
- Взрослые -> Группы без возраста или 16/18+.
- Если клиент учится в 1 смену -> Предлагай время после 14:00.
- Если во 2 смену -> Предлагай утро (до 13:00) или поздний вечер, или ВЫХОДНЫЕ.
- Не забывай про группы выходного дня (Сб, Вс)!

=== ФИНАЛ ===
Для записи требуется: Имя клиента.
Фраза подтверждения: "✅ Записала вас на [Название группы] на [День] [Время]! Адрес: пр. Абулхаир хана 58в."`;
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
            // Формируем историю сообщений для Gemini
            let chatHistory = messages
                .filter(m => m.content && m.content.trim().length > 0) // Убираем пустые
                .map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }]
                }));

            // Gemini требует, чтобы история начиналась с сообщения пользователя
            // Удаляем сообщения модели из начала истории
            while (chatHistory.length > 0 && chatHistory[0].role === 'model') {
                chatHistory.shift();
            }

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
                safetySettings: [
                    {
                        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                        threshold: HarmBlockThreshold.BLOCK_NONE,
                    },
                    {
                        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                        threshold: HarmBlockThreshold.BLOCK_NONE,
                    },
                    {
                        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                        threshold: HarmBlockThreshold.BLOCK_NONE,
                    },
                    {
                        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                        threshold: HarmBlockThreshold.BLOCK_NONE,
                    },
                ],
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
            console.error('❌ [Gemini] Ошибка генерации:', error.message);
            console.error('❌ [Gemini] Полная ошибка:', error);
            console.error('❌ [Gemini] Stack:', error.stack);

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
