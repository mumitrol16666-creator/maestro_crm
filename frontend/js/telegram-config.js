// ==================== TELEGRAM BOT КОНФИГУРАЦИЯ ====================
// 
// ИНСТРУКЦИЯ ПО НАСТРОЙКЕ:
// 
// 1. Создайте бота через @BotFather в Telegram:
//    - Отправьте /newbot
//    - Введите имя: Sense of Dance Bot
//    - Введите username: senseofdance_bot (или другой)
//    - Скопируйте TOKEN
//
// 2. Получите свой CHAT_ID:
//    - Найдите @userinfobot в Telegram
//    - Отправьте ему любое сообщение
//    - Скопируйте ваш ID
//
// 3. Вставьте TOKEN и CHAT_ID ниже:

const TELEGRAM_CONFIG = {
    // TOKEN бота от @BotFather
    BOT_TOKEN: '8368842118:AAGF8Ni_9flfi4wrfZXk5VQLervZFxYdH-U',
    
    // Ваш CHAT_ID
    CHAT_ID: '5515902792',
    
    // Настройки сообщений
    MESSAGE_TEMPLATE: {
        emoji: '💃',
        title: 'НОВАЯ ЗАЯВКА | SENSE OF DANCE',
        separator: '━━━━━━━━━━━━━━━━━━━━'
    }
};

// Экспортируем для использования в script.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TELEGRAM_CONFIG;
}

