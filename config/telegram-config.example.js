// ==================== TELEGRAM BOT КОНФИГУРАЦИЯ (ПРИМЕР) ====================
// 
// ЭТО ПРИМЕР ФАЙЛА!
// 
// 1. Скопируйте этот файл и переименуйте в: telegram-config.js
// 2. Замените ВАШ_ТОКЕН_БОТА и ВАШ_CHAT_ID на реальные значения
// 3. НЕ коммитьте telegram-config.js в Git (он в .gitignore)
//

const TELEGRAM_CONFIG = {
    // Получите токен от @BotFather
    BOT_TOKEN: 'ВАШ_ТОКЕН_БОТА',
    
    // Получите ваш ID от @userinfobot
    CHAT_ID: 'ВАШ_CHAT_ID',
    
    // Настройки сообщений (можно изменить)
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

