const axios = require('axios');
const path = require('path');
const fs = require('fs');

// Загружаем конфигурацию (или пустую для тестов)
let TELEGRAM_CONFIG = {
    BOT_TOKEN: '',
    CHAT_ID: '',
    MESSAGE_TEMPLATE: {
        emoji: '📝',
        title: 'Новая заявка',
        separator: '━━━━━━━━━━━━━━━━'
    }
};

try {
    const configPath = path.join(__dirname, '../../../config/telegram-config.js');
    if (fs.existsSync(configPath)) {
        TELEGRAM_CONFIG = require(configPath);
    }
} catch (error) {
    if (process.env.NODE_ENV !== 'test') {
        console.error('Telegram config load error:', error.message);
    }
}

// Приоритет: переменные окружения сервера (безопаснее, чем config в репозитории)
if (process.env.TELEGRAM_BOT_TOKEN) TELEGRAM_CONFIG.BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (process.env.TELEGRAM_CHAT_ID) TELEGRAM_CONFIG.CHAT_ID = process.env.TELEGRAM_CHAT_ID;

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

function formatLessonPendingReviewMessage(classRecord) {
    const date = new Date(classRecord.date).toLocaleDateString('ru-RU');
    return `
⏳ <b>Урок на подтверждении</b>
━━━━━━━━━━━━━━━━

📚 <b>${classRecord.title}</b>
📅 ${date} ${classRecord.startTime}–${classRecord.endTime}
${classRecord.topic ? `📝 Тема: ${classRecord.topic}` : ''}
${classRecord.noOneAttended ? '⚠️ Никто не пришёл' : ''}
`.trim();
}

function formatLessonApprovedMessage(classRecord, deductions = []) {
    const date = new Date(classRecord.date).toLocaleDateString('ru-RU');
    const deducted = deductions.filter(d => d.deducted).length;
    return `
✅ <b>Урок подтверждён</b>
━━━━━━━━━━━━━━━━

📚 ${classRecord.title}
📅 ${date}
💳 Списаний: ${deducted}
`.trim();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatMoney(amount) {
    return `${(amount || 0).toLocaleString('ru-RU')} ₸`;
}

function formatCountList(items = []) {
    if (!items.length) return '—';
    return items.map(item => `${escapeHtml(item.label)}: ${item.count}`).join(', ');
}

function formatAmountMap(amounts = {}) {
    const entries = Object.entries(amounts).filter(([, amount]) => amount);
    if (!entries.length) return '—';
    return entries
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([label, amount]) => `${escapeHtml(label)}: ${formatMoney(amount)}`)
        .join(', ');
}

function formatEveningReportMessage(stats) {
    if (!stats.lessons) {
        return `
📊 <b>Вечерний отчёт Maestro</b>
━━━━━━━━━━━━━━━━
📅 ${stats.date}

✅ Проведено сегодня: ${stats.completed}
⏳ На подтверждении: ${stats.pendingReview}
❌ Не заполнено: ${stats.notFilled}
📥 Новых заявок: ${stats.newBookings}
💰 Выручка: ${formatMoney(stats.revenue)}
`.trim();
    }

    return `
📊 <b>Вечерний отчёт Maestro</b>
━━━━━━━━━━━━━━━━
📅 <b>Дата:</b> ${escapeHtml(stats.date)}
👤 <b>Администратор:</b> ${escapeHtml(stats.admin || 'Система')}

💬 <b>Новые переписки / заявки:</b> ${stats.bookings.newNonParentChats}
📥 Источники: ${formatCountList(stats.bookings.bySource)}

🎸 <b>Пробные уроки</b>
• Запланировано сегодня: ${stats.trials.scheduled}
• Проведено: ${stats.trials.completed}
• На подтверждении: ${stats.trials.pendingReview}
• Не заполнено: ${stats.trials.notFilled}

📚 <b>Уроки</b>
• Проведено сегодня: ${stats.lessons.completed}
• На подтверждении всего: ${stats.lessons.pendingReview}
• Не заполнено сегодня: ${stats.lessons.notFilled}

💰 <b>Финансы</b>
• Оплачено абонементов: ${stats.finance.membershipPaymentsCount}
• Сумма оплат за день: ${formatMoney(stats.finance.revenue)}
• По способам: ${formatAmountMap(stats.finance.revenueByMethod)}
• Остальные доходы: ${formatMoney(stats.finance.otherIncome)}
• Детали доходов: ${formatAmountMap(stats.finance.otherIncomeByCategory)}
• Расходы: ${formatMoney(stats.finance.expenses)}
• Детали расходов: ${formatAmountMap(stats.finance.expensesByCategory)}

📌 <b>План на завтра</b>
• Запланированные оплаты: ${stats.tomorrow.plannedPaymentsCount}
• Ожидаемая выручка: ${formatMoney(stats.tomorrow.expectedRevenue)}

🏦 <b>Касса</b>
• Денег в кассе на конец дня: ${formatMoney(stats.finance.cashBalance)}
• Денег в кассе магазина: ${stats.finance.shopCashBalance == null ? '—' : formatMoney(stats.finance.shopCashBalance)}

👥 <b>Ученики</b>
• Всего активных: ${stats.students.active}
• Новые: ${stats.students.new}
• Ушли / пауза: ${stats.students.pausedOrLeft}

🚫 <b>Отказы:</b> ${stats.bookings.rejected}
Причины: ${formatCountList(stats.bookings.rejectionReasons)}

🤖 <b>AI-комментарий:</b>
${escapeHtml(stats.aiComment || '—')}
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
    formatLessonPendingReviewMessage,
    formatLessonApprovedMessage,
    formatEveningReportMessage,
    testTelegramBot
};
