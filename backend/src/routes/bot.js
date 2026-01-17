/**
 * Bot API Routes
 * Эндпоинты для управления WhatsApp ботом
 */

const express = require('express');
const router = express.Router();
const { protect, checkPermission } = require('../middleware/auth');
const BotSettings = require('../models/BotSettings');
const Conversation = require('../models/Conversation');
const whatsappService = require('../services/whatsapp.service');
const geminiService = require('../services/gemini.service');
const reminderService = require('../services/reminder.service');

// Все роуты требуют авторизации и роль admin/superadmin
router.use(protect);

/**
 * @route   GET /api/bot/settings
 * @desc    Получить настройки бота
 * @access  Admin
 */
router.get('/settings', checkPermission('bot', 'read'), async (req, res) => {
    try {
        const settings = await BotSettings.getSettings();

        // Скрываем API ключ для безопасности
        const safeSettings = settings.toObject();
        if (safeSettings.geminiApiKey) {
            safeSettings.geminiApiKey = '***' + safeSettings.geminiApiKey.slice(-4);
        }

        res.json({
            success: true,
            data: safeSettings
        });
    } catch (error) {
        console.error('❌ [Bot API] Ошибка получения настроек:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка получения настроек'
        });
    }
});

/**
 * @route   PUT /api/bot/settings
 * @desc    Обновить настройки бота
 * @access  Admin
 */
router.put('/settings', checkPermission('bot', 'update'), async (req, res) => {
    try {
        const settings = await BotSettings.getSettings();

        const allowedFields = [
            'isActive',
            'phoneNumber',
            'reminderHoursBefore',
            'quietHoursStart',
            'quietHoursEnd',
            'geminiApiKey',
            'geminiModel',
            'maxTokensPerMessage',
            'temperature',
            'systemPrompt',
            'welcomeMessage'
        ];

        // Обновляем только разрешенные поля
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                settings[field] = req.body[field];
            }
        }

        // МИГРАЦИЯ: Заменяем устаревшие модели на рабочие
        const deprecatedModels = ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-pro'];
        if (deprecatedModels.includes(settings.geminiModel)) {
            console.log(`⚠️ [Bot API] Мигрируем модель ${settings.geminiModel} -> gemini-2.0-flash`);
            settings.geminiModel = 'gemini-2.0-flash';
        }

        await settings.save();

        // Если обновлен API ключ, переинициализируем Gemini
        if (req.body.geminiApiKey) {
            await geminiService.reinitialize();
        }

        res.json({
            success: true,
            message: 'Настройки обновлены',
            data: settings
        });
    } catch (error) {
        console.error('❌ [Bot API] Ошибка обновления настроек:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка обновления настроек'
        });
    }
});

/**
 * @route   GET /api/bot/status
 * @desc    Получить статус бота и подключений
 * @access  Admin
 */
router.get('/status', checkPermission('bot', 'read'), async (req, res) => {
    try {
        const settings = await BotSettings.getSettings();
        const whatsappStatus = whatsappService.getStatus();
        const geminiStatus = await geminiService.healthCheck();
        const reminderStatus = reminderService.getStatus();

        res.json({
            success: true,
            data: {
                bot: {
                    isActive: settings.isActive,
                    stats: settings.stats
                },
                whatsapp: whatsappStatus,
                gemini: geminiStatus,
                reminder: reminderStatus
            }
        });
    } catch (error) {
        console.error('❌ [Bot API] Ошибка получения статуса:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка получения статуса'
        });
    }
});

/**
 * @route   POST /api/bot/connect
 * @desc    Подключить WhatsApp (получить QR код)
 * @access  Admin
 */
router.post('/connect', checkPermission('bot', 'update'), async (req, res) => {
    try {
        // Проверяем, не подключен ли уже
        const status = whatsappService.getStatus();

        if (status.isReady) {
            return res.json({
                success: true,
                message: 'WhatsApp уже подключен',
                data: { status: 'connected' }
            });
        }

        // Если есть QR код, возвращаем его
        if (status.hasQR) {
            return res.json({
                success: true,
                message: 'QR код готов для сканирования',
                data: {
                    status: 'connecting',
                    qrCode: whatsappService.getQRCode()
                }
            });
        }

        // Ждем QR код или ready (максимум 60 секунд)
        const qrCodePromise = new Promise((resolve) => {
            const timeout = setTimeout(() => {
                console.log('⏰ [Bot API] Таймаут ожидания QR');
                resolve({ type: 'timeout' });
            }, 60000);

            const onQR = (qr) => {
                clearTimeout(timeout);
                whatsappService.removeListener('ready', onReady);
                whatsappService.removeListener('auth_failure', onError);
                resolve({ type: 'qr', data: qr });
            };

            const onReady = () => {
                clearTimeout(timeout);
                whatsappService.removeListener('qr', onQR);
                whatsappService.removeListener('auth_failure', onError);
                resolve({ type: 'ready' });
            };

            const onError = (msg) => {
                clearTimeout(timeout);
                whatsappService.removeListener('qr', onQR);
                whatsappService.removeListener('ready', onReady);
                resolve({ type: 'error', data: msg });
            };

            whatsappService.once('qr', onQR);
            whatsappService.once('ready', onReady);
            whatsappService.once('auth_failure', onError);
        });

        // Запускаем инициализацию (не await, так как она эмитит события)
        whatsappService.initialize().catch(err => {
            console.error('❌ [Bot API] Ошибка инициализации WhatsApp:', err.message);
        });

        const result = await qrCodePromise;

        if (result.type === 'ready') {
            return res.json({
                success: true,
                message: 'WhatsApp подключен (использована сохраненная сессия)',
                data: { status: 'connected' }
            });
        }

        if (result.type === 'qr') {
            return res.json({
                success: true,
                message: 'QR код готов для сканирования',
                data: {
                    status: 'connecting',
                    qrCode: result.data
                }
            });
        }

        if (result.type === 'error') {
            return res.status(500).json({
                success: false,
                message: `Ошибка авторизации: ${result.data}`
            });
        }

        res.status(408).json({
            success: false,
            message: 'Таймаут ожидания QR кода (60 сек). Проверьте логи сервера.'
        });

    } catch (error) {
        console.error('❌ [Bot API] Ошибка подключения:', error);
        res.status(500).json({
            success: false,
            message: `Ошибка подключения: ${error.message}`
        });
    }
});

/**
 * @route   GET /api/bot/qr
 * @desc    Получить текущий QR код
 * @access  Admin
 */
router.get('/qr', checkPermission('bot', 'read'), async (req, res) => {
    try {
        const qrCode = whatsappService.getQRCode();
        const status = whatsappService.getStatus();

        if (status.isReady) {
            return res.json({
                success: true,
                data: {
                    status: 'connected',
                    qrCode: null
                }
            });
        }

        res.json({
            success: true,
            data: {
                status: status.status,
                qrCode: qrCode
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Ошибка получения QR кода'
        });
    }
});

/**
 * @route   POST /api/bot/disconnect
 * @desc    Отключить WhatsApp
 * @access  Admin
 */
router.post('/disconnect', checkPermission('bot', 'update'), async (req, res) => {
    try {
        await whatsappService.disconnect();

        res.json({
            success: true,
            message: 'WhatsApp отключен'
        });
    } catch (error) {
        console.error('❌ [Bot API] Ошибка отключения:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка отключения WhatsApp'
        });
    }
});

/**
 * @route   POST /api/bot/restart
 * @desc    Перезапустить WhatsApp клиент
 * @access  Admin
 */
router.post('/restart', checkPermission('bot', 'update'), async (req, res) => {
    try {
        await whatsappService.restart();

        res.json({
            success: true,
            message: 'WhatsApp перезапущен'
        });
    } catch (error) {
        console.error('❌ [Bot API] Ошибка перезапуска:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка перезапуска WhatsApp'
        });
    }
});

/**
 * @route   GET /api/bot/conversations
 * @desc    Получить историю диалогов
 * @access  Admin
 */
router.get('/conversations', checkPermission('bot', 'read'), async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const status = req.query.status;

        const query = {};
        if (status) {
            query.status = status;
        }

        const total = await Conversation.countDocuments(query);
        const conversations = await Conversation.find(query)
            .sort({ lastMessageAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .populate('bookingId', 'name status')
            .lean();

        res.json({
            success: true,
            data: {
                conversations,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error('❌ [Bot API] Ошибка получения диалогов:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка получения диалогов'
        });
    }
});

/**
 * @route   GET /api/bot/conversations/:id
 * @desc    Получить конкретный диалог
 * @access  Admin
 */
router.get('/conversations/:id', checkPermission('bot', 'read'), async (req, res) => {
    try {
        const conversation = await Conversation.findById(req.params.id)
            .populate('bookingId')
            .populate('studentId', 'name lastName phone');

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'Диалог не найден'
            });
        }

        res.json({
            success: true,
            data: conversation
        });
    } catch (error) {
        console.error('❌ [Bot API] Ошибка получения диалога:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка получения диалога'
        });
    }
});

/**
 * @route   DELETE /api/bot/conversations/:id
 * @desc    Удалить диалог (для тестирования)
 * @access  Admin
 */
router.delete('/conversations/:id', checkPermission('bot', 'delete'), async (req, res) => {
    try {
        const conversation = await Conversation.findById(req.params.id);

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'Диалог не найден'
            });
        }

        await Conversation.findByIdAndDelete(req.params.id);

        console.log(`🗑️ [Bot API] Диалог ${req.params.id} удален`);

        res.json({
            success: true,
            message: 'Диалог удален'
        });
    } catch (error) {
        console.error('❌ [Bot API] Ошибка удаления диалога:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка удаления диалога'
        });
    }
});

/**
 * @route   POST /api/bot/send-message
 * @desc    Отправить сообщение вручную
 * @access  Admin
 */
router.post('/send-message', checkPermission('bot', 'update'), async (req, res) => {
    try {
        const { phoneNumber, message } = req.body;

        if (!phoneNumber || !message) {
            return res.status(400).json({
                success: false,
                message: 'Требуется номер телефона и сообщение'
            });
        }

        await whatsappService.sendMessage(phoneNumber, message);

        res.json({
            success: true,
            message: 'Сообщение отправлено'
        });
    } catch (error) {
        console.error('❌ [Bot API] Ошибка отправки:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Ошибка отправки сообщения'
        });
    }
});

/**
 * @route   POST /api/bot/test-reminder
 * @desc    Тестовый запуск проверки напоминаний
 * @access  Admin
 */
router.post('/test-reminder', checkPermission('bot', 'update'), async (req, res) => {
    try {
        await reminderService.runManually();

        res.json({
            success: true,
            message: 'Проверка напоминаний запущена'
        });
    } catch (error) {
        console.error('❌ [Bot API] Ошибка тестового запуска:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка запуска проверки'
        });
    }
});

/**
 * @route   POST /api/bot/test-ai
 * @desc    Тестирование AI ответа
 * @access  Admin
 */
router.post('/test-ai', checkPermission('bot', 'update'), async (req, res) => {
    try {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({
                success: false,
                message: 'Требуется тестовое сообщение'
            });
        }

        // Создаем временный контекст диалога
        const mockConversation = {
            context: {},
            messages: [],
            getContextForAI: function () {
                return { context: this.context, messages: this.messages };
            }
        };

        const result = await geminiService.generateResponse(mockConversation, message);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('❌ [Bot API] Ошибка тестирования AI:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка тестирования AI'
        });
    }
});

module.exports = router;
