/**
 * Reminder Service
 * CRON задача для отправки напоминаний о занятиях
 */

const cron = require('node-cron');
const BotSettings = require('../models/BotSettings');
const Booking = require('../models/Booking');
const Class = require('../models/Class');
const Group = require('../models/Group');
const whatsappService = require('./whatsapp.service');

class ReminderService {
    constructor() {
        this.cronJob = null;
        this.isRunning = false;
    }

    /**
     * Запуск сервиса напоминаний
     */
    start() {
        if (this.cronJob) {
            console.log('⚠️ [Reminder] Сервис уже запущен');
            return;
        }

        // Запускаем каждый час в начале часа
        this.cronJob = cron.schedule('0 * * * *', async () => {
            await this.checkAndSendReminders();
        });

        console.log('✅ [Reminder] Сервис напоминаний запущен (каждый час)');
        this.isRunning = true;
    }

    /**
     * Остановка сервиса
     */
    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            this.cronJob = null;
            this.isRunning = false;
            console.log('⏹️ [Reminder] Сервис напоминаний остановлен');
        }
    }

    /**
     * Проверка и отправка напоминаний
     */
    async checkAndSendReminders() {
        try {
            console.log('🔔 [Reminder] Проверка напоминаний...');

            const settings = await BotSettings.getSettings();

            // Проверяем, активен ли бот
            if (!settings.isActive) {
                console.log('⏸️ [Reminder] Бот неактивен, пропускаем');
                return;
            }

            // Проверяем, включены ли напоминания
            if (settings.remindersEnabled === false) {
                console.log('⏸️ [Reminder] Напоминания отключены в настройках');
                return;
            }

            // Проверяем тихие часы
            if (settings.isQuietHours()) {
                console.log('🌙 [Reminder] Тихие часы, пропускаем');
                return;
            }

            // Проверяем подключение WhatsApp
            if (!whatsappService.isReady) {
                console.log('📵 [Reminder] WhatsApp не подключен, пропускаем');
                return;
            }

            const hoursBefore = settings.reminderHoursBefore || 12;

            // Вычисляем время для напоминания
            const now = new Date();
            const reminderTime = new Date(now.getTime() + (hoursBefore * 60 * 60 * 1000));

            // Ищем занятия, которые начнутся через N часов
            const classes = await this.findUpcomingClasses(reminderTime, hoursBefore);

            console.log(`📅 [Reminder] Найдено занятий: ${classes.length}`);

            for (const classItem of classes) {
                await this.sendRemindersForClass(classItem);
            }

            console.log('✅ [Reminder] Проверка напоминаний завершена');

        } catch (error) {
            console.error('❌ [Reminder] Ошибка:', error);
        }
    }

    /**
     * Поиск предстоящих занятий
     */
    async findUpcomingClasses(targetTime, hoursWindow) {
        try {
            // Определяем диапазон времени (+-30 минут от целевого времени)
            const rangeStart = new Date(targetTime.getTime() - (30 * 60 * 1000));
            const rangeEnd = new Date(targetTime.getTime() + (30 * 60 * 1000));

            const classes = await Class.find({
                date: {
                    $gte: rangeStart,
                    $lte: rangeEnd
                },
                status: { $ne: 'cancelled' }
            }).populate('group');

            return classes;
        } catch (error) {
            console.error('❌ [Reminder] Ошибка поиска занятий:', error);
            return [];
        }
    }

    /**
     * Отправка напоминаний для конкретного занятия
     */
    async sendRemindersForClass(classItem) {
        try {
            // Ищем заявки со статусом 'trial' для этой группы
            const bookings = await Booking.find({
                status: 'trial',
                group: classItem.group._id
            });

            if (bookings.length === 0) {
                return;
            }

            console.log(`📨 [Reminder] Отправка ${bookings.length} напоминаний для занятия ${classItem.group.name}`);

            const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
            const classDate = new Date(classItem.date);
            const dateStr = `${days[classDate.getDay()]}, ${classDate.toLocaleDateString('ru-RU')}`;
            const timeStr = classItem.startTime || '00:00';

            for (const booking of bookings) {
                try {
                    // Проверяем, есть ли номер телефона
                    if (!booking.phone) {
                        continue;
                    }

                    // Форматируем номер телефона
                    const phoneNumber = this.formatPhoneNumber(booking.phone);

                    if (!phoneNumber) {
                        console.log(`⚠️ [Reminder] Некорректный номер: ${booking.phone}`);
                        continue;
                    }

                    await whatsappService.sendReminder(
                        phoneNumber,
                        booking.name,
                        classItem.group.name,
                        timeStr,
                        dateStr
                    );

                    // Небольшая задержка между сообщениями
                    await this.sleep(2000);

                } catch (sendError) {
                    console.error(`❌ [Reminder] Ошибка отправки для ${booking.phone}:`, sendError.message);
                }
            }

        } catch (error) {
            console.error('❌ [Reminder] Ошибка отправки напоминаний:', error);
        }
    }

    /**
     * Форматирование номера телефона для WhatsApp
     */
    formatPhoneNumber(phone) {
        // Убираем все кроме цифр
        let digits = phone.replace(/\D/g, '');

        // Если начинается с 8, заменяем на 7 (Казахстан/Россия)
        if (digits.startsWith('8') && digits.length === 11) {
            digits = '7' + digits.substring(1);
        }

        // Если без кода страны, добавляем 7
        if (digits.length === 10) {
            digits = '7' + digits;
        }

        // Проверяем валидность
        if (digits.length < 10 || digits.length > 15) {
            return null;
        }

        return digits;
    }

    /**
     * Вспомогательная функция для задержки
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Ручной запуск проверки (для тестирования)
     */
    async runManually() {
        console.log('🔧 [Reminder] Ручной запуск проверки');
        await this.checkAndSendReminders();
    }

    /**
     * Получение статуса сервиса
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            hasJob: !!this.cronJob
        };
    }
}

// Singleton instance
const reminderService = new ReminderService();

module.exports = reminderService;
