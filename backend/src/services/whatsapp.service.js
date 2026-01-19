/**
 * WhatsApp Service using Baileys 6.x
 * Совместимо с Node.js 18+
 * Не требует Chromium/Puppeteer, работает через WebSocket
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const EventEmitter = require('events');
const fs = require('fs');
const pino = require('pino');
const BotSettings = require('../models/BotSettings');
const Conversation = require('../models/Conversation');
const geminiService = require('./gemini.service');

class WhatsAppService extends EventEmitter {
    constructor() {
        super();
        this.socket = null;
        this.isReady = false;
        this.qrCode = null;
        this.status = 'disconnected';
        this.authPath = process.env.WHATSAPP_SESSION_PATH || './sessions/whatsapp-auth';

        // Буфер сообщений для debounce (объединение нескольких сообщений подряд)
        this.messageBuffer = {}; // { phoneNumber: { messages: [], timer: null } }
        this.debounceDelayMs = 10000; // Ждём 10 секунд после последнего сообщения

        // Счётчик активных операций для graceful shutdown
        this.pendingOperations = 0;

        // Флаг graceful shutdown - при true пропускаем задержки
        this.isShuttingDown = false;
    }

    /**
     * Немедленно обрабатываем все сообщения в буфере (для graceful shutdown)
     */
    async flushMessageBuffer() {
        // Устанавливаем флаг чтобы пропустить все задержки
        this.isShuttingDown = true;

        const phoneNumbers = Object.keys(this.messageBuffer);
        if (phoneNumbers.length === 0) {
            console.log('✅ [WhatsApp] Буфер сообщений пуст');
            return;
        }

        console.log(`🔄 [WhatsApp] Flush: обрабатываем ${phoneNumbers.length} буферизованных диалогов (БЕЗ ЗАДЕРЖЕК!)...`);

        for (const phoneNumber of phoneNumbers) {
            const buffer = this.messageBuffer[phoneNumber];
            if (buffer && buffer.timer) {
                clearTimeout(buffer.timer); // Отменяем debounce таймер
            }
            // Получаем настройки и обрабатываем
            try {
                const BotSettings = require('../models/BotSettings');
                const settings = await BotSettings.getSettings();
                await this.processBufferedMessages(phoneNumber, settings);
            } catch (error) {
                console.error(`❌ [WhatsApp] Ошибка flush для ${phoneNumber}:`, error);
            }
        }
    }

    /**
     * Ждём завершения всех активных операций (для graceful shutdown)
     */
    async waitForPendingOperations(maxWaitMs = 15000) {
        // Сначала немедленно обрабатываем все ожидающие сообщения
        await this.flushMessageBuffer();

        const startTime = Date.now();
        while (this.pendingOperations > 0 && (Date.now() - startTime) < maxWaitMs) {
            console.log(`⏳ [WhatsApp] Ожидаем завершения ${this.pendingOperations} операций...`);
            await new Promise(r => setTimeout(r, 1000));
        }
        if (this.pendingOperations > 0) {
            console.warn(`⚠️ [WhatsApp] Таймаут ожидания, осталось ${this.pendingOperations} незавершённых операций`);
        } else {
            console.log('✅ [WhatsApp] Все операции завершены');
        }
    }

    /**
     * Инициализация WhatsApp клиента
     */
    async initialize() {
        try {
            console.log('🔄 [WhatsApp] Инициализация Baileys клиента...');

            // Создаем папку для сессии если не существует
            if (!fs.existsSync(this.authPath)) {
                fs.mkdirSync(this.authPath, { recursive: true });
            }

            // Загружаем состояние аутентификации
            const { state, saveCreds } = await useMultiFileAuthState(this.authPath);

            // Получаем последнюю версию
            const { version } = await fetchLatestBaileysVersion();
            console.log(`📦 [WhatsApp] Baileys версия: ${version.join('.')}`);

            // Создаем сокет
            this.socket = makeWASocket({
                version,
                auth: state,
                printQRInTerminal: false, // Мы сами обрабатываем QR
                logger: pino({ level: 'warn' }),
                browser: ['Sense of Dance Bot', 'Chrome', '120.0.0'],
            });

            // Настраиваем обработчики событий
            this.setupEventHandlers(saveCreds);

            return true;
        } catch (error) {
            console.error('❌ [WhatsApp] Ошибка инициализации:', error);
            this.status = 'error';
            await this.updateSettingsStatus('error');
            return false;
        }
    }

    /**
     * Настройка обработчиков событий
     */
    setupEventHandlers(saveCreds) {
        // Обновление соединения
        this.socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // QR код для авторизации
            if (qr) {
                console.log('📱 [WhatsApp] QR код получен');
                this.status = 'connecting';

                try {
                    this.qrCode = await qrcode.toDataURL(qr);
                    this.emit('qr', this.qrCode);
                } catch (error) {
                    console.error('❌ [WhatsApp] Ошибка генерации QR:', error);
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                console.log(`🔌 [WhatsApp] Соединение закрыто. Код: ${statusCode}. Переподключаемся: ${shouldReconnect}`);

                this.isReady = false;
                this.status = 'disconnected';
                await this.updateSettingsStatus('disconnected');

                this.emit('disconnected', lastDisconnect?.error?.message);

                // Переподключаемся если не вылогинились
                if (shouldReconnect) {
                    setTimeout(() => {
                        console.log('🔄 [WhatsApp] Попытка переподключения...');
                        this.initialize();
                    }, 5000);
                }
            }

            if (connection === 'open') {
                console.log('✅ [WhatsApp] Подключен!');
                this.isReady = true;
                this.status = 'connected';
                this.qrCode = null;

                await this.updateSettingsStatus('connected');
                this.startFollowUpChecker(); // Запускаем проверку "дожима"
                this.emit('ready');
            }
        });

        // Сохраняем credentials при обновлении
        this.socket.ev.on('creds.update', saveCreds);

        // Входящие сообщения
        this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            for (const message of messages) {
                await this.handleIncomingMessage(message);
            }
        });
    }

    /**
     * Обработка входящего сообщения
     */
    async handleIncomingMessage(message) {
        try {
            // Игнорируем свои сообщения
            if (message.key.fromMe) return;

            // Игнорируем сообщения из групп
            if (message.key.remoteJid?.endsWith('@g.us')) return;

            // Игнорируем статусы
            if (message.key.remoteJid === 'status@broadcast') return;

            // Получаем текст сообщения
            const messageContent = message.message;
            if (!messageContent) return;

            const textMessage = messageContent.conversation ||
                messageContent.extendedTextMessage?.text ||
                messageContent.imageMessage?.caption ||
                messageContent.videoMessage?.caption;

            if (!textMessage) {
                // Медиа без текста
                await this.sendMessage(message.key.remoteJid, 'Спасибо за сообщение! К сожалению, я пока не могу обрабатывать медиа-файлы. Напишите мне текстом, чем могу помочь?');
                return;
            }

            const settings = await BotSettings.getSettings();

            // Проверяем, активен ли бот
            if (!settings.isActive) {
                console.log('⏸️ [WhatsApp] Бот неактивен, пропускаем сообщение');
                return;
            }

            // Примечание: Тихие часы НЕ применяются к входящим сообщениям.
            // Бот отвечает клиентам всегда. Тихие часы блокируют только 
            // автоматические исходящие сообщения (напоминания, follow-up).

            // Извлекаем номер телефона
            const jid = message.key.remoteJid;
            let phoneNumber;

            // Проверяем формат JID
            if (jid.endsWith('@s.whatsapp.net')) {
                // Обычный номер телефона
                phoneNumber = jid.replace('@s.whatsapp.net', '');
            } else if (jid.endsWith('@lid')) {
                // WhatsApp Lead (из рекламы/каталога) - у них нет номера телефона
                // Используем lead ID как идентификатор, но помечаем как лида
                phoneNumber = jid.replace('@lid', '');
                console.log(`📢 [WhatsApp] Сообщение от лида (реклама): ${phoneNumber}`);
            } else if (jid.endsWith('@g.us')) {
                // Групповой чат - игнорируем
                console.log('👥 [WhatsApp] Игнорируем групповой чат');
                return;
            } else {
                // Неизвестный формат
                console.log(`⚠️ [WhatsApp] Неизвестный формат JID: ${jid}`);
                phoneNumber = jid.split('@')[0];
            }

            const userMessage = textMessage.trim();

            console.log(`📩 [WhatsApp] Сообщение от ${phoneNumber}: ${userMessage.substring(0, 50)}...`);

            // === DEBOUNCE: Собираем сообщения в буфер ===
            if (!this.messageBuffer[phoneNumber]) {
                this.messageBuffer[phoneNumber] = { messages: [], timer: null, jid: jid };
            }

            // Добавляем сообщение в буфер
            this.messageBuffer[phoneNumber].messages.push(userMessage);

            // Сбрасываем таймер (если клиент продолжает писать — ждём ещё)
            if (this.messageBuffer[phoneNumber].timer) {
                clearTimeout(this.messageBuffer[phoneNumber].timer);
            }

            // Устанавливаем новый таймер
            this.messageBuffer[phoneNumber].timer = setTimeout(async () => {
                await this.processBufferedMessages(phoneNumber, settings);
            }, this.debounceDelayMs);

        } catch (error) {
            console.error('❌ [WhatsApp] Ошибка обработки сообщения:', error);
        }
    }

    /**
     * Обработка накопленных сообщений после debounce
     */
    async processBufferedMessages(phoneNumber, settings) {
        const buffer = this.messageBuffer[phoneNumber];
        if (!buffer || buffer.messages.length === 0) return;

        const jid = buffer.jid;
        const combinedMessage = buffer.messages.join('\n');

        // Очищаем буфер сразу
        delete this.messageBuffer[phoneNumber];

        console.log(`🔄 [WhatsApp] Обрабатываем ${buffer.messages.length} сообщений от ${phoneNumber}`);

        // Увеличиваем счётчик активных операций (для graceful shutdown)
        this.pendingOperations++;

        try {
            // Получаем или создаем диалог
            const conversation = await Conversation.findOrCreate(phoneNumber);

            // Добавляем ВСЕ сообщения пользователя (как одно)
            await conversation.addMessage('user', combinedMessage);

            // Генерируем ответ через Gemini
            const { response, shouldCreateBooking, extractedData } =
                await geminiService.generateResponse(conversation, combinedMessage);

            // Обновляем контекст
            if (extractedData) {
                await conversation.updateContext(extractedData);
                if (extractedData.name && !conversation.name) {
                    conversation.name = extractedData.name;
                    await conversation.save();
                }
            }

            // Добавляем ответ бота в историю
            await conversation.addMessage('assistant', response);

            // Создаем заявку
            if (shouldCreateBooking && !conversation.bookingId) {
                const booking = await conversation.createBooking();
                console.log(`📝 [WhatsApp] Создана заявка #${booking._id} для ${phoneNumber}`);
                await settings.incrementStats('totalBookings');
            }

            // --- ИМИТАЦИЯ ЧЕЛОВЕКА (Менеджер) ---
            // jid уже определен выше из buffer

            // Разбиваем ответ на части (если есть разделитель |||)
            const messageParts = response.split('|||').map(p => p.trim()).filter(p => p.length > 0);

            // При shutdown пропускаем ВСЕ задержки и отправляем мгновенно
            if (this.isShuttingDown) {
                console.log(`⚡ [Shutdown] Мгновенная отправка ${messageParts.length} сообщений (без задержек)`);
                for (const part of messageParts) {
                    await this.sendMessage(jid, part);
                    console.log(`📤 [Shutdown] Отправлено: ${part.substring(0, 50)}...`);
                }
            } else {
                // Обычный режим с задержками
                // Определяем, это начало диалога или продолжение
                const isStartOfConversation = conversation.messageCount <= 2;

                // Задержка перед началом печати ("время реакции")
                // Первый ответ: 3-6 секунд (быстро, чтобы не потерять клиента!)
                // Последующие: 2-4 секунды
                const reactionDelay = isStartOfConversation
                    ? 3000 + Math.random() * 3000
                    : 2000 + Math.random() * 2000;

                console.log(`⏳ [Humanize] Пауза перед ответом: ${Math.round(reactionDelay / 1000)}с (Сообщений: ${conversation.messageCount})`);
                await new Promise(r => setTimeout(r, reactionDelay));

                // Отправляем каждую часть сообщения отдельно
                for (let i = 0; i < messageParts.length; i++) {
                    const part = messageParts[i];

                    // Статус "печатает..."
                    console.log(`typing... для ${phoneNumber} (часть ${i + 1}/${messageParts.length})`);
                    await this.socket.sendPresenceUpdate('composing', jid);

                    // Время печати: минимум 2с, 50мс на символ, максимум 15 секунд
                    // Пример: 100 символов = 2000 + 100*50 = 7000мс = 7с
                    // Пример: 300 символов = 2000 + 300*50 = 17000мс → 15с (ограничено)
                    const typingTime = Math.min(15000, 2000 + part.length * 50);
                    console.log(`⌨️ [Humanize] Время печати: ${Math.round(typingTime / 1000)}с (${part.length} символов)`);
                    await new Promise(r => setTimeout(r, typingTime));

                    // Отправка и сброс статуса
                    await this.socket.sendPresenceUpdate('paused', jid);
                    await this.sendMessage(jid, part);

                    // Пауза между частями (1-2 секунды)
                    if (i < messageParts.length - 1) {
                        await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
                    }
                }
            } // Закрываем else блок

            // Обновляем статистику
            await settings.incrementStats('totalMessages');

            console.log(`📤 [WhatsApp] Ответ отправлен ${phoneNumber} (${messageParts.length} сообщений)`);

        } catch (error) {
            console.error('❌ [WhatsApp] Ошибка обработки сообщения:', error);

            try {
                const buffer = this.messageBuffer[phoneNumber];
                const errorJid = buffer?.jid || `${phoneNumber}@s.whatsapp.net`;
                await this.sendMessage(errorJid, 'Извините, произошла ошибка. Наш администратор свяжется с вами в ближайшее время!');
            } catch (replyError) {
                console.error('❌ [WhatsApp] Не удалось отправить сообщение об ошибке');
            }
        } finally {
            // Уменьшаем счётчик активных операций
            this.pendingOperations--;
        }
    }

    /**
     * Обновление статуса в настройках
     */
    async updateSettingsStatus(status) {
        try {
            const settings = await BotSettings.getSettings();
            settings.whatsappStatus = status;

            if (status === 'connected') {
                settings.whatsappLastConnected = new Date();
            }

            await settings.save();
        } catch (error) {
            console.error('❌ [WhatsApp] Ошибка обновления статуса:', error);
        }
    }

    /**
     * Отправка сообщения
     * @param {string} to - JID или номер телефона
     * @param {string} text - Текст сообщения
     */
    async sendMessage(to, text) {
        if (!this.isReady || !this.socket) {
            throw new Error('WhatsApp клиент не готов');
        }

        // Примечание: Тихие часы проверяются на уровне вызывающего кода
        // (напоминания, follow-up), а не здесь, чтобы бот мог отвечать клиентам в любое время.

        // Форматируем JID если нужно
        const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;

        try {
            await this.socket.sendMessage(jid, { text });
            console.log(`📤 [WhatsApp] Сообщение отправлено на ${to}`);
            return true;
        } catch (error) {
            console.error(`❌ [WhatsApp] Ошибка отправки на ${to}:`, error);
            throw error;
        }
    }

    /**
     * Отправка напоминания о занятии
     */
    async sendReminder(phoneNumber, studentName, className, classTime, classDate) {
        const message = `Привет${studentName ? `, ${studentName}` : ''}! 👋

Напоминаем, что завтра у вас пробное занятие в студии Sense of Dance! 💃

📅 ${classDate}
⏰ ${classTime}
🎯 ${className}
📍 пр. Абулхаир хана 58в (ост. Казпочта)

Форма одежды: удобная спортивная одежда и чистая сменная обувь.

Ждём вас! Если есть вопросы — пишите 😊`;

        return await this.sendMessage(phoneNumber, message);
    }

    /**
     * Получение текущего QR кода
     */
    getQRCode() {
        return this.qrCode;
    }

    /**
     * Получение статуса подключения
     */
    getStatus() {
        return {
            status: this.status,
            isReady: this.isReady,
            hasQR: !!this.qrCode
        };
    }

    /**
     * Отключение клиента
     */
    async disconnect() {
        if (this.socket) {
            try {
                await this.socket.logout();
                this.socket = null;
                this.isReady = false;
                this.status = 'disconnected';
                this.qrCode = null;

                await this.updateSettingsStatus('disconnected');
                console.log('🔌 [WhatsApp] Клиент отключен');
            } catch (error) {
                console.error('❌ [WhatsApp] Ошибка отключения:', error);
            }
        }
    }

    /**
     * Перезапуск клиента
     */
    async restart() {
        if (this.socket) {
            this.socket.end();
            this.socket = null;
        }

        this.isReady = false;
        this.status = 'disconnected';
        this.qrCode = null;

        await new Promise(resolve => setTimeout(resolve, 2000));
        return await this.initialize();
    }
    /**
     * Запуск проверки для follow-up сообщений
     */
    startFollowUpChecker() {
        // Проверяем каждые 5 минут
        if (this.followUpInterval) clearInterval(this.followUpInterval);

        this.followUpInterval = setInterval(() => {
            this.checkAndSendFollowUps();
        }, 5 * 60 * 1000);

        console.log('✅ [FollowUp] Сервис проверки запущен (интервал 5 мин)');
    }

    /**
     * Проверка и отправка follow-up сообщений
     */
    async checkAndSendFollowUps() {
        if (!this.isReady) return;

        try {
            const settings = await BotSettings.getSettings();

            if (!settings.followUpEnabled) return;
            if (settings.isQuietHours()) return; // Не пишем ночью

            const delayMinutes = settings.followUpDelayMinutes || 30;
            const cutoffTime = new Date(Date.now() - delayMinutes * 60 * 1000);

            // Ищем диалоги, где статус pending и прошло достаточно времени
            const pendingConversations = await Conversation.find({
                followUpStatus: 'pending',
                lastMessageAt: { $lt: cutoffTime },
                status: { $in: ['active', 'qualified'] }, // Только активные
                bookingId: null // Если уже записан, не трогаем
            }).limit(5); // Обрабатываем пачками по 5, чтобы не спамить массово

            for (const conv of pendingConversations) {
                console.log(`⏳ [FollowUp] Отправка напоминания для ${conv.phoneNumber}...`);

                // Генерируем мягкое напоминание через Gemini или берем шаблон
                let message = "Здравствуйте! Вы еще с нами? 😉 Удалось ли вам выбрать группу или время? Если есть вопросы — я на связи!";

                // Пробуем сгенерировать более контекстное сообщение, если есть Gemini
                try {
                    message = await geminiService.generateFollowUp(conv);
                } catch (e) {
                    // Fallback to default
                }

                // Имитация печати для естественности
                const jid = typeof conv.phoneNumber === 'string' && conv.phoneNumber.includes('@')
                    ? conv.phoneNumber
                    : `${conv.phoneNumber}@s.whatsapp.net`;

                await this.socket.sendPresenceUpdate('composing', jid);
                await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
                await this.socket.sendPresenceUpdate('paused', jid);

                await this.sendMessage(conv.phoneNumber, message);

                // Добавляем сообщение в историю как от бота
                // ВАЖНО: Ставим pending снова? Нет, sent. Иначе заспамим.
                await conv.addMessage('assistant', message);

                conv.followUpStatus = 'sent';
                await conv.save();
            }
        } catch (error) {
            console.error('❌ [FollowUp] Ошибка при проверке:', error);
        }
    }
}

// Singleton instance
const whatsappService = new WhatsAppService();

module.exports = whatsappService;
