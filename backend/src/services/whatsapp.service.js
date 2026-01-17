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

            // Проверяем тихие часы
            if (settings.isQuietHours()) {
                console.log('🌙 [WhatsApp] Тихие часы, сообщение будет обработано позже');
                return;
            }

            // Извлекаем номер телефона
            const phoneNumber = message.key.remoteJid.replace('@s.whatsapp.net', '');
            const userMessage = textMessage.trim();

            console.log(`📩 [WhatsApp] Сообщение от ${phoneNumber}: ${userMessage.substring(0, 50)}...`);

            // Получаем или создаем диалог
            const conversation = await Conversation.findOrCreate(phoneNumber);

            // Добавляем сообщение пользователя
            await conversation.addMessage('user', userMessage);

            // Генерируем ответ через Gemini
            const { response, shouldCreateBooking, extractedData } =
                await geminiService.generateResponse(conversation, userMessage);

            // Обновляем контекст, если извлечены данные
            if (extractedData) {
                await conversation.updateContext(extractedData);

                // Обновляем имя если найдено
                if (extractedData.name && !conversation.name) {
                    conversation.name = extractedData.name;
                    await conversation.save();
                }
            }

            // Добавляем ответ бота в историю
            await conversation.addMessage('assistant', response);

            // Создаем заявку если бот определил готовность
            if (shouldCreateBooking && !conversation.bookingId) {
                const booking = await conversation.createBooking();
                console.log(`📝 [WhatsApp] Создана заявка #${booking._id} для ${phoneNumber}`);

                // Обновляем статистику
                await settings.incrementStats('totalBookings');
            }

            // Отправляем ответ
            await this.sendMessage(message.key.remoteJid, response);

            // Обновляем статистику
            await settings.incrementStats('totalMessages');

            console.log(`📤 [WhatsApp] Ответ отправлен ${phoneNumber}`);

        } catch (error) {
            console.error('❌ [WhatsApp] Ошибка обработки сообщения:', error);

            try {
                await this.sendMessage(message.key.remoteJid, 'Извините, произошла ошибка. Наш администратор свяжется с вами в ближайшее время!');
            } catch (replyError) {
                console.error('❌ [WhatsApp] Не удалось отправить сообщение об ошибке');
            }
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

        // Проверяем тихие часы
        const settings = await BotSettings.getSettings();
        if (settings.isQuietHours()) {
            throw new Error('Тихие часы, сообщение не может быть отправлено сейчас');
        }

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
