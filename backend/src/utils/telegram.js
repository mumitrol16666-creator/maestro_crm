const axios = require('axios');
const path = require('path');

// Загружаем конфигурацию
const TELEGRAM_CONFIG = require(path.join(__dirname, '../../../config/telegram-config.js'));

/**
 * Форматирование сообщения о новой заявке
 */
function formatBookingMessage(booking) {
    const { emoji, title, separator } = TELEGRAM_CONFIG.MESSAGE_TEMPLATE;
    
    const date = new Date(booking.createdAt).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    return `
${emoji} <b>${title}</b> ${emoji}
${separator}

👤 <b>Имя:</b> ${booking.name}
📱 <b>Телефон:</b> ${booking.phone}
🎭 <b>Направление:</b> ${booking.direction}
📍 <b>Источник:</b> ${booking.source || 'Не указан'}
📅 <b>Дата:</b> ${date}

${separator}
🆔 ID: ${booking._id}
`.trim();
}

/**
 * Отправка уведомления в Telegram
 */
async function sendTelegramNotification(message) {
    try {
        const { BOT_TOKEN, CHAT_ID } = TELEGRAM_CONFIG;
        
        if (!BOT_TOKEN || !CHAT_ID) {
            console.warn('⚠️ Telegram bot не настроен (отсутствует BOT_TOKEN или CHAT_ID)');
            return false;
        }
        
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        const response = await axios.post(url, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        }, {
            timeout: 5000 // 5 секунд таймаут
        });
        
        if (response.data.ok) {
            console.log('✅ Уведомление отправлено в Telegram');
            return true;
        } else {
            console.error('❌ Ошибка Telegram API:', response.data);
            return false;
        }
    } catch (error) {
        console.error('❌ Ошибка отправки в Telegram:', error.message);
        
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
        
        // Не прерываем выполнение основного запроса
        return false;
    }
}

/**
 * Тестирование подключения к Telegram боту
 */
async function testTelegramBot() {
    try {
        const { BOT_TOKEN, CHAT_ID } = TELEGRAM_CONFIG;
        
        if (!BOT_TOKEN || !CHAT_ID) {
            console.error('❌ Telegram не настроен');
            return false;
        }
        
        const testMessage = '🧪 <b>Тестовое сообщение</b>\n\nБот работает корректно! ✅';
        const result = await sendTelegramNotification(testMessage);
        
        if (result) {
            console.log('✅ Telegram бот работает корректно');
        } else {
            console.error('❌ Telegram бот не работает');
        }
        
        return result;
    } catch (error) {
        console.error('❌ Ошибка тестирования Telegram бота:', error.message);
        return false;
    }
}

module.exports = {
    sendTelegramNotification,
    formatBookingMessage,
    testTelegramBot
};

