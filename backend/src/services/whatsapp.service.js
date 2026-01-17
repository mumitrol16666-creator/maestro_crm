/**
 * WhatsApp Service
 * Интеграция с WhatsApp через whatsapp-web.js
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const EventEmitter = require('events');
const path = require('path');
const BotSettings = require('../models/BotSettings');
const Conversation = require('../models/Conversation');
const geminiService = require('./gemini.service');

class WhatsAppService extends EventEmitter {
    constructor() {
        super();
        this.client = null;
        this.isReady = false;
        this.qrCode = null;
        this.status = 'disconnected';
    }

    /**
     * Инициализация WhatsApp клиента
     */
    async initialize() {
        try {
            console.log('🔄 [WhatsApp] Инициализация клиента...');

            const sessionPath = process.env.WHATSAPP_SESSION_PATH || './sessions/whatsapp';

            this.client = new Client({
                authStrategy: new LocalAuth({
                    dataPath: sessionPath
                }),
                puppeteer: {
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--disable-gpu'
                    ]
                }
            });

            this.setupEventHandlers();

            await this.client.initialize();

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
    setupEventHandlers() {
        // QR код для авторизации
        this.client.on('qr', async (qr) => {
            console.log('📱 [WhatsApp] QR код получен');
            this.status = 'connecting';

            try {
                this.qrCode = await qrcode.toDataURL(qr);
                this.emit('qr', this.qrCode);
            } catch (error) {
                console.error('❌ [WhatsApp] Ошибка генерации QR:', error);
            }
        });

        // Успешная авторизация
        this.client.on('ready', async () => {
            console.log('✅ [WhatsApp] Клиент готов к работе!');
            this.isReady = true;
            this.status = 'connected';
            this.qrCode = null;

            await this.updateSettingsStatus('connected');
            this.emit('ready');
        });

        // Отключение
        this.client.on('disconnected', async (reason) => {
            console.log('🔌 [WhatsApp] Отключен:', reason);
            this.isReady = false;
            this.status = 'disconnected';

            await this.updateSettingsStatus('disconnected');
            this.emit('disconnected', reason);
        });

        // Ошибка аутентификации
        this.client.on('auth_failure', async (message) => {
            console.error('❌ [WhatsApp] Ошибка авторизации:', message);
            this.status = 'error';

            await this.updateSettingsStatus('error');
            this.emit('auth_failure', message);
        });

        // Входящее сообщение
        this.client.on('message', async (message) => {
            await this.handleIncomingMessage(message);
        });
    }

    /**
     * Обработка входящего сообщения
     */
    async handleIncomingMessage(message) {
        try {
            // Игнорируем сообщения от групп и статусы
            if (message.isGroupMsg || message.isStatus) {
                return;
            }

            // Игнорируем медиа-сообщения (пока)
            if (message.hasMedia && !message.body) {
                await message.reply('Спасибо за сообщение! К сожалению, я пока не могу обрабатывать медиа-файлы. Напишите мне текстом, чем могу помочь? 😊');
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
                // Можно сохранить сообщение для обработки позже
                return;
            }

            const phoneNumber = message.from.replace('@c.us', '');
            const userMessage = message.body.trim();

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
            await message.reply(response);

            // Обновляем статистику
            await settings.incrementStats('totalMessages');

            console.log(`📤 [WhatsApp] Ответ отправлен ${phoneNumber}`);

        } catch (error) {
            console.error('❌ [WhatsApp] Ошибка обработки сообщения:', error);

            try {
                await message.reply('Извините, произошла ошибка. Наш администратор свяжется с вами в ближайшее время! 📞');
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
     * @param {string} to - Номер телефона (без @c.us)
     * @param {string} text - Текст сообщения
     */
    async sendMessage(to, text) {
        if (!this.isReady) {
            throw new Error('WhatsApp клиент не готов');
        }

        // Проверяем тихие часы
        const settings = await BotSettings.getSettings();
        if (settings.isQuietHours()) {
            throw new Error('Тихие часы, сообщение не может быть отправлено сейчас');
        }

        const chatId = to.includes('@c.us') ? to : `${to}@c.us`;

        try {
            await this.client.sendMessage(chatId, text);
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
        if (this.client) {
            try {
                await this.client.logout();
                await this.client.destroy();
                this.client = null;
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
        await this.disconnect();
        await new Promise(resolve => setTimeout(resolve, 2000));
        return await this.initialize();
    }
}

// Singleton instance
const whatsappService = new WhatsAppService();

module.exports = whatsappService;
