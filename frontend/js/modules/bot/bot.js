// =====================================================
// BOT MODULE - Управление WhatsApp ботом
// =====================================================

let botSettings = null;
let botConversationsFilter = 'all';
let isPollingQR = false;
let qrPollingInterval = null;

// Дефолтный системный промпт
const DEFAULT_SYSTEM_PROMPT = `Ты Динара — менеджер студии танцев "Sense of Dance" (Актобе, пр.Абулхаир хана 58в, ост.Казпочта).

СТИЛЬ: Дружелюбно, с эмодзи (💃🔥✨). Заканчивай вопросом/предложением. Коротко, без простыней.

НАПРАВЛЕНИЯ:
- Дети/Подростки: K-Pop, Современная хореография, Jazz Funk
- Взрослые: High Heels, Бачата, Сальса, Jazz Funk
- 45+: Бачата Lady Style

ЦЕНА: ~25000тг/8 занятий (абонемент). Пробное занятие — отличный старт!

АЛГОРИТМ:
1. Приветствие: "Для себя или ребенка танцы ищете?"
2. Узнай возраст (для подбора группы)
3. Уточни смену учебы (для детей) или удобное время (для взрослых)
4. Предложи подходящую группу
5. Запиши на пробное занятие

ВОЗРАЖЕНИЯ:
- "Никогда не танцевала" → "90% учеников приходят с нуля! Педагоги объясняют на пальцах."
- "Мне N лет" → "Отличный возраст! У нас есть группа специально для вас."

ВАЖНО: Если не знаешь точного ответа — попроси номер, скажи что уточнишь у педагога.`;

// Загрузка настроек бота
async function loadBotSettings() {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/bot/settings`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (data.success) {
            botSettings = data.data;
            updateBotUI();
        } else {
            console.error('Ошибка загрузки настроек бота:', data.message);
        }
    } catch (error) {
        console.error('Ошибка загрузки настроек бота:', error);
    }
}

// Обновление UI на основе настроек
function updateBotUI() {
    if (!botSettings) return;

    // Основные настройки
    const isActiveCheckbox = document.getElementById('botIsActive');
    if (isActiveCheckbox) {
        isActiveCheckbox.checked = botSettings.isActive;
    }

    // API ключ показываем как маску
    const apiKeyInput = document.getElementById('geminiApiKey');
    if (apiKeyInput && botSettings.geminiApiKey) {
        apiKeyInput.value = botSettings.geminiApiKey;
        apiKeyInput.placeholder = 'Ключ установлен';
    }

    // Модель (скрытое поле)
    const modelInput = document.getElementById('geminiModel');
    if (modelInput && botSettings.geminiModel) {
        modelInput.value = botSettings.geminiModel;
    }

    // Температура (скрытое поле)
    const temperatureInput = document.getElementById('temperature');
    if (temperatureInput && botSettings.temperature !== undefined) {
        temperatureInput.value = botSettings.temperature;
    }

    // Напоминания
    const reminderHours = document.getElementById('reminderHoursBefore');
    if (reminderHours && botSettings.reminderHoursBefore) {
        reminderHours.value = botSettings.reminderHoursBefore;
    }

    const quietStart = document.getElementById('quietHoursStart');
    const quietEnd = document.getElementById('quietHoursEnd');
    if (quietStart && botSettings.quietHoursStart !== undefined) {
        quietStart.value = botSettings.quietHoursStart;
    }
    if (quietEnd && botSettings.quietHoursEnd !== undefined) {
        quietEnd.value = botSettings.quietHoursEnd;
    }

    if (quietEnd && botSettings.quietHoursEnd !== undefined) {
        quietEnd.value = botSettings.quietHoursEnd;
    }

    // Follow-up
    const followUpCheck = document.getElementById('followUpEnabled');
    if (followUpCheck) {
        followUpCheck.checked = botSettings.followUpEnabled !== false;
    }

    const followUpDelay = document.getElementById('followUpDelayMinutes');
    if (followUpDelay && botSettings.followUpDelayMinutes) {
        followUpDelay.value = botSettings.followUpDelayMinutes;
    }

    // Системный промпт
    const promptTextarea = document.getElementById('botSystemPrompt');
    if (promptTextarea && botSettings.systemPrompt) {
        promptTextarea.value = botSettings.systemPrompt;
    }

    // Статистика
    if (botSettings.stats) {
        updateElement('botTotalConversations', botSettings.stats.totalConversations || 0);
        updateElement('botTotalBookings', botSettings.stats.totalBookings || 0);
        updateElement('botTotalMessages', botSettings.stats.totalMessages || 0);

        if (botSettings.stats.lastMessageAt) {
            const lastMsg = new Date(botSettings.stats.lastMessageAt);
            updateElement('botLastMessage', lastMsg.toLocaleString('ru-RU', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit'
            }));
        }
    }

    // Статус WhatsApp
    updateWhatsAppStatus(botSettings.whatsappStatus || 'disconnected');
}

function updateElement(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

// Обновление статуса WhatsApp
function updateWhatsAppStatus(status) {
    const statusDot = document.getElementById('whatsappStatusDot');
    const statusText = document.getElementById('whatsappStatusText');
    const connectBtn = document.getElementById('connectWhatsAppBtn');
    const disconnectBtn = document.getElementById('disconnectWhatsAppBtn');
    const qrContainer = document.getElementById('qrCodeContainer');

    const statusColors = {
        connected: '#22c55e',
        connecting: '#f59e0b',
        disconnected: '#ef4444',
        error: '#ef4444'
    };

    const statusTexts = {
        connected: '✅ Подключен',
        connecting: '🔄 Подключение...',
        disconnected: '❌ Не подключен',
        error: '⚠️ Ошибка'
    };

    if (statusDot) {
        statusDot.style.background = statusColors[status] || statusColors.disconnected;
    }
    if (statusText) {
        statusText.textContent = statusTexts[status] || statusTexts.disconnected;
    }

    // Кнопки
    if (connectBtn) {
        connectBtn.style.display = status === 'connected' ? 'none' : 'inline-flex';
        connectBtn.disabled = status === 'connecting';
    }
    if (disconnectBtn) {
        disconnectBtn.style.display = status === 'connected' ? 'inline-flex' : 'none';
    }

    // QR код скрываем если подключен
    if (qrContainer && status === 'connected') {
        qrContainer.style.display = 'none';
        stopQRPolling();
    }
}

// Подключение WhatsApp
async function connectWhatsApp() {
    try {
        const token = getAuthToken();
        const connectBtn = document.getElementById('connectWhatsAppBtn');

        if (connectBtn) {
            connectBtn.disabled = true;
            connectBtn.innerHTML = '🔄 Подключение...';
        }

        updateWhatsAppStatus('connecting');

        const response = await fetch(`${API_URL}/bot/connect`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (data.success) {
            if (data.data.status === 'connected') {
                showToast('WhatsApp подключен!', 'success');
                updateWhatsAppStatus('connected');
            } else if (data.data.qrCode) {
                showQRCode(data.data.qrCode);
                startQRPolling();
            }
        } else {
            showToast(data.message || 'Ошибка подключения', 'error');
            updateWhatsAppStatus('error');
        }
    } catch (error) {
        console.error('Ошибка подключения WhatsApp:', error);
        showToast('Ошибка подключения', 'error');
        updateWhatsAppStatus('error');
    } finally {
        const connectBtn = document.getElementById('connectWhatsAppBtn');
        if (connectBtn) {
            connectBtn.disabled = false;
            connectBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72"></path>
            </svg> Подключить`;
        }
    }
}

// Показать QR код
function showQRCode(qrDataUrl) {
    const container = document.getElementById('qrCodeContainer');
    const img = document.getElementById('qrCodeImage');

    if (container && img) {
        img.src = qrDataUrl;
        container.style.display = 'block';
    }
}

// Polling для проверки статуса подключения
function startQRPolling() {
    if (isPollingQR) return;

    isPollingQR = true;
    qrPollingInterval = setInterval(async () => {
        try {
            const token = getAuthToken();
            const response = await fetch(`${API_URL}/bot/qr`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            const data = await response.json();

            if (data.success) {
                if (data.data.status === 'connected') {
                    showToast('WhatsApp подключен!', 'success');
                    updateWhatsAppStatus('connected');
                    stopQRPolling();
                    loadBotSettings();
                } else if (data.data.qrCode) {
                    showQRCode(data.data.qrCode);
                }
            }
        } catch (error) {
            console.error('Ошибка polling QR:', error);
        }
    }, 3000);
}

function stopQRPolling() {
    isPollingQR = false;
    if (qrPollingInterval) {
        clearInterval(qrPollingInterval);
        qrPollingInterval = null;
    }
}

// Отключение WhatsApp
async function disconnectWhatsApp() {
    if (!confirm('Отключить WhatsApp?')) return;

    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/bot/disconnect`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (data.success) {
            showToast('WhatsApp отключен', 'info');
            updateWhatsAppStatus('disconnected');
            loadBotSettings();
        } else {
            showToast(data.message || 'Ошибка отключения', 'error');
        }
    } catch (error) {
        console.error('Ошибка отключения:', error);
        showToast('Ошибка отключения', 'error');
    }
}

// Сохранение настроек
async function saveBotSettings() {
    try {
        const token = getAuthToken();

        const settings = {
            isActive: document.getElementById('botIsActive')?.checked || false,
            geminiModel: document.getElementById('geminiModel')?.value,
            temperature: parseFloat(document.getElementById('temperature')?.value) || 0.7,
            reminderHoursBefore: parseInt(document.getElementById('reminderHoursBefore')?.value) || 12,
            quietHoursStart: parseInt(document.getElementById('quietHoursStart')?.value) || 20,
            quietHoursStart: parseInt(document.getElementById('quietHoursStart')?.value) || 20,
            quietHoursEnd: parseInt(document.getElementById('quietHoursEnd')?.value) || 9,
            followUpEnabled: document.getElementById('followUpEnabled')?.checked || false,
            followUpDelayMinutes: parseInt(document.getElementById('followUpDelayMinutes')?.value) || 30,
            systemPrompt: document.getElementById('botSystemPrompt')?.value
        };

        // API ключ только если изменён (не маска)
        const apiKeyInput = document.getElementById('geminiApiKey');
        if (apiKeyInput && apiKeyInput.value && !apiKeyInput.value.startsWith('***')) {
            settings.geminiApiKey = apiKeyInput.value;
        }

        const response = await fetch(`${API_URL}/bot/settings`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        });

        const data = await response.json();

        if (data.success) {
            showToast('Настройки сохранены!', 'success');
            botSettings = data.data;
            updateBotUI();
        } else {
            showToast(data.message || 'Ошибка сохранения', 'error');
        }
    } catch (error) {
        console.error('Ошибка сохранения настроек:', error);
        showToast('Ошибка сохранения', 'error');
    }
}

// Переключение видимости API ключа
function toggleApiKeyVisibility() {
    const input = document.getElementById('geminiApiKey');
    if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
    }
}

// Сброс системного промпта
function resetSystemPrompt() {
    const textarea = document.getElementById('botSystemPrompt');
    if (textarea && confirm('Сбросить промпт к значению по умолчанию?')) {
        textarea.value = DEFAULT_SYSTEM_PROMPT;
    }
}

// Тестирование AI
async function testBotAI() {
    const message = prompt('Введите тестовое сообщение для AI:');
    if (!message) return;

    try {
        const token = getAuthToken();
        showToast('Отправка запроса...', 'info');

        const response = await fetch(`${API_URL}/bot/test-ai`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message })
        });

        const data = await response.json();

        if (data.success) {
            alert(`🤖 Ответ AI:\n\n${data.data.response}`);
        } else {
            showToast(data.message || 'Ошибка AI', 'error');
        }
    } catch (error) {
        console.error('Ошибка теста AI:', error);
        showToast('Ошибка теста AI', 'error');
    }
}

// Загрузка диалогов
async function loadBotConversations() {
    try {
        const token = getAuthToken();
        const status = botConversationsFilter !== 'all' ? botConversationsFilter : '';

        const response = await fetch(`${API_URL}/bot/conversations?status=${status}&limit=20`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (data.success) {
            renderBotConversations(data.data.conversations);
        }
    } catch (error) {
        console.error('Ошибка загрузки диалогов:', error);
    }
}

// Рендер таблицы диалогов
function renderBotConversations(conversations) {
    const tbody = document.getElementById('botConversationsTable');
    if (!tbody) return;

    if (!conversations || conversations.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 40px; opacity: 0.5;">Нет диалогов</td></tr>`;
        return;
    }

    const statusLabels = {
        active: '<span class="status-badge status-new">Активный</span>',
        qualified: '<span class="status-badge status-processed">Квалиф.</span>',
        booked: '<span class="status-badge status-trial">Записан</span>',
        closed: '<span class="status-badge status-rejected">Закрыт</span>'
    };

    tbody.innerHTML = conversations.map(conv => `
        <tr>
            <td>${formatPhone(conv.phoneNumber)}</td>
            <td>${conv.name || '—'}</td>
            <td>${statusLabels[conv.status] || conv.status}</td>
            <td>${conv.messageCount || 0}</td>
            <td>${conv.lastMessageAt ? new Date(conv.lastMessageAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
            <td>
                <button class="action-btn" onclick="viewConversation('${conv._id}')" title="Просмотр">
                    👁
                </button>
            </td>
        </tr>
    `).join('');
}

function formatPhone(phone) {
    if (!phone) return '—';
    // Форматируем как +7 (XXX) XXX-XX-XX
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 11) {
        return `+${digits[0]} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
    }
    return phone;
}

// Фильтрация диалогов
function filterBotConversations(status) {
    botConversationsFilter = status;

    // Обновляем активную кнопку
    document.querySelectorAll('#section-bot .filters .filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

    loadBotConversations();
}

// Просмотр диалога
async function viewConversation(conversationId) {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/bot/conversations/${conversationId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (data.success) {
            const conv = data.data;
            const messages = conv.messages.map(m =>
                `${m.role === 'user' ? '👤' : '🤖'} ${m.content}`
            ).join('\n\n');

            alert(`📱 Диалог с ${formatPhone(conv.phoneNumber)}\n\nКонтекст:\n- Для кого: ${conv.context?.forWhom || 'не определено'}\n- Возраст: ${conv.context?.age || conv.context?.childAge || 'не указан'}\n- Направление: ${conv.context?.direction || 'не выбрано'}\n\nСообщения:\n${messages || 'Пусто'}`);
        }
    } catch (error) {
        console.error('Ошибка загрузки диалога:', error);
        showToast('Ошибка загрузки диалога', 'error');
    }
}

// Обновление настроек при переключении активности
function updateBotSettings() {
    // Можно добавить автосохранение при изменении чекбокса
}

// Инициализация при открытии секции
function initBotSection() {
    loadBotSettings();
    loadBotConversations();
    loadBotStatus();
}

// Загрузка актуального статуса
async function loadBotStatus() {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/bot/status`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (data.success) {
            updateWhatsAppStatus(data.data.whatsapp?.status || 'disconnected');
        }
    } catch (error) {
        console.error('Ошибка загрузки статуса:', error);
    }
}

// Экспорт функций в глобальную область
window.loadBotSettings = loadBotSettings;
window.saveBotSettings = saveBotSettings;
window.connectWhatsApp = connectWhatsApp;
window.disconnectWhatsApp = disconnectWhatsApp;
window.toggleApiKeyVisibility = toggleApiKeyVisibility;
window.resetSystemPrompt = resetSystemPrompt;
window.testBotAI = testBotAI;
window.filterBotConversations = filterBotConversations;
window.viewConversation = viewConversation;
window.updateBotSettings = updateBotSettings;
window.initBotSection = initBotSection;
