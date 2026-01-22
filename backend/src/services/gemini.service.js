/**
 * Gemini AI Service
 * Интеграция с Google Gemini 3.0 Pro для генерации ответов бота
 */

const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const BotSettings = require('../models/BotSettings');
const Group = require('../models/Group');
const Direction = require('../models/Direction');
const Student = require('../models/Student');

class GeminiService {
    constructor() {
        this.genAI = null;
        this.model = null;
        this.isInitialized = false;

        // Локальный кэш модели с системным промптом
        this.cachedModel = null;
        this.cachedModelTimestamp = 0;
        this.MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 минут
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

            const apiKey = settings.geminiApiKey.trim();
            console.log(`🔑 [Gemini] Используем ключ: ${apiKey.substring(0, 5)}...${apiKey.slice(-4)}`);

            this.genAI = new GoogleGenerativeAI(apiKey);
            // ВАЖНО: Gemini 1.5 Pro отключена Google в сентябре 2025 года.
            // Мы принудительно используем gemini-2.0-flash, независимо от настроек в базе,
            // чтобы избежать ошибок 404.
            const MODEL_NAME = 'gemini-2.0-flash';

            console.log(`🤖 [Gemini] Принудительно используем модель: ${MODEL_NAME}`);

            this.model = this.genAI.getGenerativeModel({ model: MODEL_NAME });

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
        this.cachedModel = null; // Сбрасываем кэш модели
        this.cachedModelTimestamp = 0;
        return await this.initialize();
    }

    /**
     * Получение модели с кэшированным системным промптом
     * Кэш живёт 5 минут для обновления расписания/преподавателей
     */
    async getCachedModel(settings) {
        const now = Date.now();

        // Проверяем валидность кэша
        if (this.cachedModel && (now - this.cachedModelTimestamp) < this.MODEL_CACHE_TTL) {
            console.log('🚀 [Gemini] Используем кэшированную модель');
            return this.cachedModel;
        }

        // Создаём новую модель с системным промптом
        console.log('🔄 [Gemini] Создаём модель с системным промптом...');
        const systemPrompt = await this.buildSystemPrompt();
        const MODEL_NAME = 'gemini-2.0-flash';

        const model = this.genAI.getGenerativeModel({
            model: MODEL_NAME,
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

        // Сохраняем в кэш
        this.cachedModel = model;
        this.cachedModelTimestamp = now;
        console.log(`✅ [Gemini] Модель закэширована на ${this.MODEL_CACHE_TTL / 1000}с (промпт: ${systemPrompt.length} символов)`);

        return model;
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

            // Получаем информацию о направлениях для возрастных ограничений и цен
            const directions = await Direction.find({ isActive: true }).lean();
            const directionsMap = {};
            directions.forEach(d => {
                directionsMap[d.name] = {
                    minAge: d.minAge,
                    maxAge: d.maxAge,
                    trialPrice: d.pricing?.trial || 2000
                };
            });

            const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

            const scheduleText = groups.map(g => {
                const scheduleStr = g.schedule
                    .map(s => `${days[s.dayOfWeek - 1]} ${s.time}`)
                    .join(', ');

                // Пытаемся определить возраст и цену для группы
                let ageInfo = '';
                let priceInfo = '';
                const dirInfo = directionsMap[g.direction];
                if (dirInfo) {
                    ageInfo = ` (возраст ${dirInfo.minAge}+)`;
                    priceInfo = `, Пробное: ${dirInfo.trialPrice}₸`;
                }

                return `- Группа "${g.name}" [${g.direction}]${ageInfo}: ${scheduleStr}${priceInfo}`;
            }).join('\n');

            return scheduleText || 'Расписание временно недоступно';
        } catch (error) {
            console.error('❌ [Gemini] Ошибка получения расписания:', error);
            return 'Расписание временно недоступно';
        }
    }

    /**
     * Получение контекста преподавателей из БД
     */
    async getTeachersContext() {
        try {
            const teachers = await Student.find({
                role: 'teacher',
                status: 'active'
            }).select('name lastName teacherInfo').lean();

            if (!teachers || teachers.length === 0) {
                return 'Информация о преподавателях временно недоступна';
            }

            const teachersText = teachers.map(t => {
                const fullName = `${t.name} ${t.lastName || ''}`.trim();
                const directions = t.teacherInfo?.directions?.join(', ') || 'Разные направления';
                const bio = t.teacherInfo?.bio || '';

                let info = `• ${fullName} — ${directions}`;
                if (bio) {
                    // Ограничиваем биографию 150 символами для промпта
                    const shortBio = bio.length > 150 ? bio.substring(0, 150) + '...' : bio;
                    info += `\n  ${shortBio}`;
                }
                return info;
            }).join('\n');

            return teachersText;
        } catch (error) {
            console.error('❌ [Gemini] Ошибка получения преподавателей:', error);
            return 'Информация о преподавателях временно недоступна';
        }
    }

    /**
     * Построение системного промпта с актуальными данными
     */
    async buildSystemPrompt(customPrompt = null) {
        const settings = await BotSettings.getSettings();
        const scheduleContext = await this.getScheduleContext();
        const teachersContext = await this.getTeachersContext();

        // ВАЖНО: Всегда используем встроенный промпт, игнорируем настройки из базы
        // Это гарантирует, что бот всегда работает с актуальным промптом
        const basePrompt = `Ты Алина — менеджер студии танцев "Sense of Dance" в Актобе.
ТЫ — ДЕВУШКА!
ВСЕГДА пиши о себе в ЖЕНСКОМ РОДЕ: "я записала", "я посмотрела", "я рада", "я видела".
НИКОГДА не пиши "я записал", "я рад" или "я сделал"! ЭТО СТРОГО ЗАПРЕЩЕНО!

═══════════════════════════════════════
ТВОЯ ГЛАВНАЯ ЦЕЛЬ: ЗАПИСАТЬ КЛИЕНТА!
═══════════════════════════════════════

СТИЛЬ ОБЩЕНИЯ (ОБЯЗАТЕЛЬНО!):
• Пиши как живой человек в WhatsApp, НЕ как робот!
• Используй 2-4 эмодзи в сообщении! Будь эмоциональной и живой! 💃✨🔥
• Короткие предложения, восклицательные знаки!
• НИКОГДА не пиши "Привет"! Только "Здравствуйте", "Добрый день" или "Добрый вечер"!
• ВСЕГДА представляйся: "Алина, студия Sense of Dance"

⚠️ ГЛАВНОЕ ПРАВИЛО: КАЖДОЕ сообщение ОБЯЗАТЕЛЬНО заканчивай ВОПРОСОМ или ПРИЗЫВОМ К ДЕЙСТВИЮ!
Примеры:
- "Записать вас на пробное?"
- "Когда вам удобнее — будни или выходные?"
- "Давайте запишу вас на ближайшее занятие?"
НЕ ОСТАНАВЛИВАЙ ДИАЛОГ! Всегда двигай клиента к записи!

РАЗДЕЛЕНИЕ СООБЩЕНИЙ:
• Используй разделитель ||| чтобы отправить несколько сообщений
• Пример: "Здравствуйте! Меня зовут Алина, студия Sense of Dance! 💃|||Для кого танцы ищете — для себя или для ребенка?"
• Это отправит ДВА отдельных сообщения клиенту
• ПРИВЕТСТВИЕ всегда должно заканчиваться ВОПРОСОМ (для кого танцы?)

═══════════════════════════════════════
СКРИПТ ПРОДАЖ (СЛЕДУЙ ЭТАПАМ!)
═══════════════════════════════════════

【ЭТАП 1: ПРИВЕТСТВИЕ】
• Поздоровайся ВЕЖЛИВО: "Здравствуйте!" или "Добрый день!"
• ПРЕДСТАВЬСЯ: "Меня зовут Алина, студия танцев Sense of Dance!"
• Поблагодари за обращение
• Пример: "Здравствуйте! Меня зовут Алина, студия Sense of Dance! 💃 Рада, что написали нам! Для кого ищете танцы — для себя или для ребенка?"

【ЭТАП 2: ВЫЯВЛЕНИЕ ПОТРЕБНОСТЕЙ】 САМЫЙ ВАЖНЫЙ ЭТАП!
НЕ СПЕШИ! Сначала пойми клиента, только потом предлагай!

Обязательные вопросы (задавай по очереди, по ОДНОМУ за раз!):
1. Для КОГО танцы? (себя / ребенка)
2. ВОЗРАСТ — "Сколько вам лет?" (критически важно!)
3. МОТИВАЦИЯ — почему танцы?
   - "А что вас привлекает в танцах?"
   - "Хотите для здоровья, красоты, уверенности или просто для души?"
   - "Может, есть конкретное направление, которое вы давно хотели попробовать?"

ВАЖНО: НЕ переходи к этапу 3, пока не узнал ВСЕ ответы!
- Нет возраста? -> Не предлагай группы!
- Не понял мотивацию? -> Уточни, чего хочет клиент!

Слушай внимательно! Клиент сам скажет, что для него важно.

【ЭТАП 3: ПРЕЗЕНТАЦИЯ РЕШЕНИЯ】
Только когда ПОНЯЛ потребности — предложи ИДЕАЛЬНЫЙ вариант:

• Назови подходящую группу и ПОЧЕМУ она идеальна для клиента
• Свяжи с мотивацией: "Вы говорили, что хотите для уверенности — бачата идеально для этого!"
• Расскажи про ПРЕИМУЩЕСТВА:
  - "У нас крутые тренеры с опытом выступлений!"
  - "Группы небольшие — каждому уделяем внимание!"
  - "Первое занятие ПРОБНОЕ — можно просто посмотреть!"
• Покажи ВСЕ варианты по времени (будни + выходные)
• ВСЕГДА заканчивай: "Записать вас на пробное?" или "Когда вам удобнее?"

【ЭТАП 4: РАБОТА С ВОЗРАЖЕНИЯМИ】
Если клиент сомневается — НЕ сдавайся! ВСЕГДА заканчивай ВОПРОСОМ!

"Дорого" -> "Понимаю! Пробное занятие стоит всего 2000тг — это цена одного кофе. 😊 Записать вас на ближайшее?"
"Нет времени" -> "А когда обычно свободны? Может, выходные подойдут? У нас есть субботние группы!"
"Боюсь, не получится" -> "Все так думают в начале! У нас 90% учеников — новички! Давайте запишу вас на пробное, сами всё увидите?"
"Подумаю" -> "Конечно! Но места ограничены — давайте запишу вас на пробное, а если передумаете — просто напишите! Когда удобнее — будни или выходные?"
"Далеко" -> "Мы на Абулхаир хана 58в, ост. Казпочта! Может, это ближе чем кажется? Записать вас?"
"Почему не бесплатно" -> "Пробное занятие стоит 2000тг — это позволяет нам держать качество на высоте! 💃 Записать вас на ближайшее?"

【ЭТАП 5: ЗАКРЫТИЕ СДЕЛКИ】
Когда клиент готов — ЗАПИСЫВАЙ!

• Спроси ИМЯ и ФАМИЛИЮ
• Подтверди группу, день и время
• Дай адрес: пр. Абулхаир хана 58в, ост. Казпочта
• ОБЯЗАТЕЛЬНО напомни: "Возьмите с собой сменную обувь и удобную одежду!"
• Пример: "Отлично! Записала вас, Анна, на K-pop teens в субботу в 14:00! 🎉 Ждём по адресу: пр. Абулхаир хана 58в! Не забудьте сменную обувь и удобную одежду! До встречи!"

═══════════════════════════════════════
⚠️⚠️⚠️ КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА ⚠️⚠️⚠️
═══════════════════════════════════════

🚫 ЕСЛИ КЛИЕНТ УЖЕ СОГЛАСИЛСЯ — НЕ ПЕРЕСПРАШИВАЙ!
• Клиент сказал "да", "ладно", "вторник", "запишите" → СРАЗУ ЗАПИСЫВАЙ!
• НЕ переспрашивай "точно записываю?" — это раздражает!
• НЕ начинай заново объяснять направления!
• НЕ сомневайся в своём предложении!

🚫 НИКОГДА НЕ ПРЕДЛАГАЙ LADY STYLE МУЖЧИНЕ!
• Если клиент — МУЖЧИНА (имя мужское: Дмитрий, Алексей, Максим и т.д.) 
• ИЛИ клиент сказал "я мужчина"
• ИЛИ использовал мужской род (хотел, был, записался)
→ НИКОГДА не упоминай Lady Style! Это ТОЛЬКО для женщин!

🚫 НЕ ПЕРЕОЦЕНИВАЙ РЕШЕНИЕ ПОСЛЕ СОГЛАСИЯ!
• Если ты уже предложила группу и клиент согласился — НЕ меняй рекомендацию!
• Просто завершай запись!

═══════════════════════════════════════
ДРУГИЕ ВАЖНЫЕ ПРАВИЛА
═══════════════════════════════════════
• НЕ выдумывай группы — только из списка ниже!
• ВОЗРАСТ ОБЯЗАТЕЛЕН! Спроси "Сколько вам лет?" в начале разговора!
• НЕ предлагай группы, пока не знаешь возраст!
• При записи запроси: "Как ваши имя и фамилия?"
• Если клиент грубит — извинись и продолжай профессионально
• НИКОГДА не говори "Привет" — только "Здравствуйте/Добрый день"!
• НЕ СПРАШИВАЙ ПОЛ напрямую! Определяй по грамматике или имени

═══════════════════════════════════════
ПРАВИЛА ПО ПОЛУ (ОЧЕНЬ ВАЖНО!)
═══════════════════════════════════════  
⚠️ ПОЛ НЕИЗВЕСТЕН (клиент пишет нейтрально):
• ИСПОЛЬЗУЙ ГЕНДЕРНО-НЕЙТРАЛЬНЫЕ ФОРМУЛИРОВКИ!
  - НЕ "одна/один" -> "самостоятельно" или "без партнёра"
  - НЕ "хотели бы заниматься одна" -> "хотите заниматься самостоятельно или в паре"
  - НЕ "готова/готов" -> "готовы"
  - НЕ "записана/записан" -> "записаны"

⚠️ ОСОБЫЙ СЛУЧАЙ — БАЧАТА:
Если клиент говорит "бачата" и пол НЕИЗВЕСТЕН — ПРЕДЛОЖИ ВЫБОР:
"У нас есть два направления бачаты:
• Social Bachata — парные танцы (партнёр не нужен, на занятиях меняемся)
• Bachata Lady Style — сольные танцы для женщин
Какое вам интереснее?"

Это поможет определить пол (если выберут Lady Style — женщина) и предложить правильный вариант.

• Жди, пока клиент использует глагол с окончанием (-л/-ла) или местоимение

КЛИЕНТ — ЖЕНЩИНА (определено по грамматике: хотела, была, сама):
• Можешь использовать женский род и предлагать ВСЕ направления: Lady Style, K-pop, Social Bachata, Stretching

КЛИЕНТ — МУЖЧИНА (определено по грамматике: хотел, был, сам):
• Используй мужской род
• Предлагай ТОЛЬКО "Social Bachata" (парные танцы с партнёршей)!
• Lady Style, K-pop, Stretching — вежливо объясни, что они для женщин
• Пример: "Для мужчин у нас есть отличная группа Social Bachata — это парные танцы!"

═══════════════════════════════════════
ПАРНЫЕ ТАНЦЫ (Social Bachata)
═══════════════════════════════════════
• ПАРТНЁР/ПАРТНЁРША НЕ НУЖНЫ! Приходите сами, мы подберём пару на занятии!
• НЕ говори "приходите одни" — говори "приходите сами" или "приходите без партнёра"
• Это важно уточнить, если клиент спрашивает или сомневается
• Пример: "Приходите сами — на занятиях мы меняемся парами, так что партнёр не нужен!"`;

        return `${basePrompt}

АКТУАЛЬНЫЕ ГРУППЫ СТУДИИ:
${scheduleContext}

НАШИ ПРЕПОДАВАТЕЛИ:
${teachersContext}

ПОДСКАЗКИ ПО ПОДБОРУ:
• Ребенок 8-12 лет -> Детские группы (kids)
• Подросток 13-16 лет -> Подростковые группы (teens)  
• Взрослый -> Группы 16+ или без ограничений
• 1 смена в школе -> после 14:00 или выходные
• 2 смена -> утро до 13:00 или выходные

НАШИ ПРЕИМУЩЕСТВА (используй в презентации!):
• Первое занятие — ПРОБНОЕ (цена указана у каждой группы выше!)
• НЕ ГОВОРИ что пробное бесплатно! Смотри цену в списке групп!
• Опытные тренеры с конкурсным опытом
• Небольшие группы — внимание каждому
• Современная студия в центре города
• Дружная атмосфера и регулярные мероприятия`;
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

            // ВАЖНО: messages уже содержит последнее сообщение (текущее), так как мы его добавили в conversation
            // Но метод chat.sendMessage() добавляет сообщение в историю тоже.
            // Чтобы не дублировать последнее сообщение ("9" -> "99"), нужно исключить его из истории initialization.
            const historyMessages = messages.length > 0 && messages[messages.length - 1].role === 'user'
                ? messages.slice(0, -1)
                : messages;

            // Формируем историю сообщений для Gemini
            let chatHistory = historyMessages
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

            // Информация о поле для правильного подбора групп
            if (context.gender === 'male') {
                clientContext += `⚠️ КЛИЕНТ — МУЖЧИНА! Предлагай ТОЛЬКО Social Bachata! `;
            } else if (context.gender === 'female') {
                clientContext += `👩 Клиент — женщина. Можно предлагать все направления. `;
            } else if (context.forWhom === 'self' && context.age && context.age >= 16) {
                // Взрослый клиент с неизвестным полом
                clientContext += `⚠️ ПОЛ НЕИЗВЕСТЕН! Предлагай ТОЛЬКО Social Bachata, пока не определишь пол по грамматике! `;
            }

            // Получаем кэшированную модель с системным промптом
            const modelWithInstruction = await this.getCachedModel(settings);

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
        // Достаточно имя ИЛИ направление ИЛИ возраст
        const hasMinimalContext = context.name || context.direction || context.age || context.childAge;

        console.log(`📝 [Gemini] Проверка заявки: фраза=${hasBookingPhrase}, контекст=${hasMinimalContext}`, context);

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
                // Если возраст > 18 — это точно взрослый, используем поле 'age'
                // Если <= 18 и контекст указывает на ребёнка — используем 'childAge'
                if (age > 18) {
                    extracted.age = age;
                    extracted.forWhom = 'self'; // Если > 18, значит для себя
                } else if (currentContext.forWhom === 'child' || extracted.forWhom === 'child') {
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

        // Определяем пол по русским склонениям/спряжениям (НЕ спрашиваем напрямую!)
        // Мужской род: хотел, записался, был, пришёл, занимался, ходил и т.д.
        const malePatterns = [
            /\bя\s+(хотел|записался|был|пришёл|пришел|занимался|ходил|решил|думал|смотрел|выбрал|интересовался)\b/i,
            /\bмне\s+\d+\s+(год|года|лет)\b/i, // "мне 30 лет" - нейтрально, но проверяем контекст
            /\b(заинтересован|готов|рад|согласен|уверен)\b/i,  // краткие прилагательные муж. рода
            /\bя\s+(сам|один)\b/i
        ];

        // Женский род: хотела, записалась, была, пришла и т.д.
        const femalePatterns = [
            /\bя\s+(хотела|записалась|была|пришла|занималась|ходила|решила|думала|смотрела|выбрала|интересовалась)\b/i,
            /\b(заинтересована|готова|рада|согласна|уверена)\b/i,  // краткие прилагательные жен. рода
            /\bя\s+(сама|одна)\b/i
        ];

        for (const pattern of malePatterns) {
            if (pattern.test(message)) {
                extracted.gender = 'male';
                console.log(`👨 [Gemini] Определён пол: мужской (по грамматике)`);
                break;
            }
        }

        if (!extracted.gender) {
            for (const pattern of femalePatterns) {
                if (pattern.test(message)) {
                    extracted.gender = 'female';
                    console.log(`👩 [Gemini] Определён пол: женский (по грамматике)`);
                    break;
                }
            }
        }

        // Извлекаем смену учебы
        if (lowerMessage.includes('перв') && lowerMessage.includes('смен')) {
            extracted.schoolShift = 'first';
        } else if (lowerMessage.includes('втор') && lowerMessage.includes('смен')) {
            extracted.schoolShift = 'second';
        }

        // Список слов-исключений, которые НЕ являются именами (приветствия и т.д.)
        const nameBlocklist = new Set([
            'добрый', 'доброе', 'доброго', 'здравствуйте', 'здрасьте',
            'привет', 'салам', 'хай', 'hello', 'hi',
            'хочу', 'хотела', 'хотел', 'можно', 'скажите', 'подскажите',
            'меня', 'меня зовут', 'зовут', 'алина', 'бот', 'менеджер',
            'сколько', 'какие', 'когда', 'адрес', 'где', 'цена', 'стоимость'
        ]);

        // Извлекаем имя
        // Паттерн 1: "меня зовут Имя" или просто "зовут Имя"
        const nameMatch1 = message.match(/(?:меня\s+)?зовут\s+([А-ЯЁа-яёA-Za-z]+)(?:\s+([А-ЯЁа-яёA-Za-z]+))?/i);
        if (nameMatch1) {
            const potentialName = nameMatch1[1];
            if (!nameBlocklist.has(potentialName.toLowerCase())) {
                extracted.name = potentialName;
                if (nameMatch1[2]) {
                    extracted.lastName = nameMatch1[2];
                }
            }
        }

        // Паттерн 2: Просто "Имя Фамилия" (два слова с большой буквы)
        // Применяем только если сообщение короткое (1-3 слова) — вероятно, ответ на вопрос об имени
        const words = message.trim().split(/\s+/);
        if (!extracted.name && words.length >= 1 && words.length <= 3) {
            const firstWord = words[0];
            // Проверяем: первая буква заглавная, остальные строчные, минимум 2 буквы
            // И слово НЕ входит в список исключений (Добрый, Привет и т.д.)
            if (/^[А-ЯЁA-Z][а-яёa-zа-я]{1,}$/.test(firstWord) &&
                firstWord.length >= 2 &&
                !nameBlocklist.has(firstWord.toLowerCase())) {

                extracted.name = firstWord;
                // Если есть фамилия
                if (words.length >= 2 && /^[А-ЯЁA-Z][а-яёa-zа-я]{1,}$/.test(words[1])) {
                    extracted.lastName = words[1];
                }
            }
        }

        // Извлекаем номер телефона (для лидов из рекламы)
        // Паттерны: +7..., 8..., 87..., 707..., и т.д.
        const phonePatterns = [
            /\+7\s*\(?(\d{3})\)?[\s-]*(\d{3})[\s-]*(\d{2})[\s-]*(\d{2})/,  // +7 (707) 123-45-67
            /8\s*\(?(\d{3})\)?[\s-]*(\d{3})[\s-]*(\d{2})[\s-]*(\d{2})/,     // 8 (707) 123-45-67
            /\b(7\d{10})\b/,        // 77071234567
            /\b(8\d{10})\b/,        // 87071234567
            /\b(\d{10})\b/          // 7071234567 (10 цифр)
        ];

        for (const pattern of phonePatterns) {
            const phoneMatch = message.match(pattern);
            if (phoneMatch) {
                let phone;
                if (phoneMatch[4]) {
                    // Формат с группами (707) 123-45-67
                    phone = `+7${phoneMatch[1]}${phoneMatch[2]}${phoneMatch[3]}${phoneMatch[4]}`;
                } else {
                    // Простой формат
                    phone = phoneMatch[1] || phoneMatch[0];
                    // Нормализуем
                    const digits = phone.replace(/\D/g, '');
                    if (digits.length === 10) {
                        phone = '+7' + digits;
                    } else if (digits.length === 11 && digits.startsWith('8')) {
                        phone = '+7' + digits.slice(1);
                    } else if (digits.length === 11 && digits.startsWith('7')) {
                        phone = '+' + digits;
                    }
                }
                extracted.realPhone = phone;
                console.log(`📱 [Gemini] Извлечён номер телефона: ${phone}`);
                break;
            }
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
    /**
     * Генерация follow-up сообщения (напоминания)
     * ВАЖНО: Продолжает диалог с контекстом, НЕ начинает заново!
     */
    async generateFollowUp(conversation) {
        // Дефолтные ответы БЕЗ приветствия (продолжение диалога)
        const defaultFollowUps = [
            "Подскажите, удалось ли определиться с группой или временем?",
            "Может, остались вопросы? Буду рада помочь!",
            "Напишите, если нужна помощь с выбором!"
        ];
        const randomDefault = defaultFollowUps[Math.floor(Math.random() * defaultFollowUps.length)];

        if (!conversation) return randomDefault;

        try {
            const settings = await BotSettings.getSettings();

            // Если ключ не настроен, возвращаем дефолт
            if (!settings.geminiApiKey || !this.isInitialized) {
                return randomDefault;
            }

            const { context, messages } = conversation.getContextForAI(5);

            // Определяем, на каком этапе остановился диалог
            let stage = 'начало';
            if (context.name) stage = 'запись';
            else if (context.direction) stage = 'выбор группы';
            else if (context.age || context.childAge) stage = 'подбор направления';
            else if (context.forWhom) stage = 'уточнение возраста';

            // Промпт для ПРОДОЛЖЕНИЯ диалога, НЕ начала нового
            const prompt = `
Ты Алина — менеджер студии танцев "Sense of Dance".
Клиент перестал отвечать. Тебе нужно ПРОДОЛЖИТЬ диалог, а не начинать его заново.

ВАЖНЫЕ ПРАВИЛА:
- НЕ пиши "Здравствуйте", "Добрый день" или любые приветствия!
- НЕ представляйся заново!
- НЕ используй эмодзи!
- Продолжай с того места, где остановились.
- Напиши ОДНО короткое предложение + вопрос для продолжения.
- Будь дружелюбной, но не навязчивой.

Этап разговора: ${stage}
Контекст клиента:
- Для кого: ${context.forWhom === 'self' ? 'для себя' : context.forWhom === 'child' ? 'для ребенка' : 'не определено'}
- Возраст: ${context.age || context.childAge || 'не известен'}
- Направление: ${context.direction || 'не выбрано'}
- Имя: ${context.name || 'не известно'}

Последние сообщения:
${messages.slice(-4).map(m => `${m.role === 'assistant' ? 'Ты' : 'Клиент'}: ${m.content}`).join('\n')}

Напиши короткое follow-up сообщение (БЕЗ приветствия!):
`;

            const model = this.genAI.getGenerativeModel({
                model: 'gemini-2.0-flash'
            });

            const result = await model.generateContent(prompt);
            let response = result.response.text().trim();

            // Убираем приветствия, если AI их всё-таки добавила
            response = response
                .replace(/^(Здравствуйте|Добрый день|Добрый вечер|Привет)[!.,]?\s*/i, '')
                .replace(/^Это Алина[^.]*[.,]?\s*/i, '')
                .trim();

            // Убираем эмодзи
            response = response.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();

            return response || randomDefault;
        } catch (error) {
            console.error('❌ [Gemini] Ошибка генерации follow-up:', error);
            return randomDefault;
        }
    }

    /**
     * Транскрибация аудио сообщения
     * @param {Buffer} audioBuffer - Буфер с аудио данными
     * @param {string} mimeType - MIME тип аудио (например 'audio/ogg; codecs=opus')
     * @returns {string|null} - Текст сообщения или null при ошибке
     */
    async transcribeAudio(audioBuffer, mimeType = 'audio/ogg') {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            console.log(`🎤 [Gemini] Начинаем транскрибацию аудио (${audioBuffer.length} байт)...`);

            // Используем ту же модель gemini-2.0-flash, она мультимодальная
            const model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

            const result = await model.generateContent([
                {
                    inlineData: {
                        mimeType: mimeType,
                        data: audioBuffer.toString('base64')
                    }
                },
                { text: "Транскрибируй это голосовое сообщение. Напиши ТОЛЬКО текст того, что было сказано, без комментариев и вступлений. Если ничего не слышно или неразборчиво, напиши '(неразборчиво)'." }
            ]);

            const response = result.response.text();
            console.log(`🗣️ [Gemini] Транскрипция: "${response}"`);

            return response;

        } catch (error) {
            console.error('❌ [Gemini] Ошибка транскрибации:', error.message);
            return null;
        }
    }
}

// Singleton instance
const geminiService = new GeminiService();

module.exports = geminiService;
