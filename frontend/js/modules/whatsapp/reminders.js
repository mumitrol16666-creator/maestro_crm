let whatsappReminderFilter = 'today';
let whatsappReminderData = null;
const WHATSAPP_PAYMENT_LINK = '';

function whatsappReminderEscape(value) {
    const node = document.createElement('div');
    node.textContent = value ?? '';
    return node.innerHTML;
}

function whatsappReminderPhone(phone) {
    let digits = String(phone || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
    if (digits.length === 10) digits = `7${digits}`;
    return digits;
}

function whatsappReminderFirstName(fullName) {
    return String(fullName || '').trim().split(/\s+/)[0] || '';
}

function whatsappReminderMessage(kind, item) {
    const name = whatsappReminderFirstName(item.studentName);
    const greeting = name ? `Привет, ${name}!` : 'Привет!';
    const subject = String(item.subject || 'занятию').trim().toLowerCase();

    if (kind === 'homework') {
        const topicText = item.topic ? `\n*Тема прошлого урока:* ${item.topic}` : '';
        const hwText = item.homework ? `\n*Домашнее задание:* ${item.homework}` : '';
        return `${greeting} Подготовили для тебя информацию по прошедшему уроку.${topicText}${hwText}`;
    }

    if (kind === 'today' || kind === 'tomorrow') {
        const day = kind === 'today' ? 'сегодня' : 'завтра';
        return `${greeting} У тебя ${day} урок в ${item.startTime} по направлению «${subject}» 😊`;
    }

    const paymentGreeting = name ? `Здравствуйте, ${name}!` : 'Здравствуйте!';

    if (kind === 'oneLesson') {
        const paymentText = WHATSAPP_PAYMENT_LINK
            ? `\n${WHATSAPP_PAYMENT_LINK}\nВы можете оплатить по ссылке. После оплаты отправьте, пожалуйста, чек 🙏`
            : '\nНапишите нам, и мы отправим ссылку на оплату 🙏';
        return `${paymentGreeting} У вас заканчиваются уроки в абонементе — остался всего 1 урок.${paymentText}`;
    }

    const paymentText = WHATSAPP_PAYMENT_LINK
        ? `\n${WHATSAPP_PAYMENT_LINK}\nПосле оплаты отправьте, пожалуйста, чек 🙏`
        : '\nНапишите нам, и мы отправим ссылку на оплату 🙏';
    return `${paymentGreeting} Напоминаем по оплате обучения. У вас заканчиваются уроки.${paymentText}`;
}

function openWhatsappReminder(kind, itemId, button) {
    if (button?.dataset.opening === '1') return;
    const item = whatsappReminderData?.[kind]?.find(entry => String(entry.id) === String(itemId));
    if (!item) {
        toast.error('Напоминание не найдено. Обновите список.');
        return;
    }
    const phone = whatsappReminderPhone(item.phone);
    if (!phone) {
        toast.error('У ученика не указан номер телефона');
        return;
    }

    if (button) {
        button.dataset.opening = '1';
        button.disabled = true;
        setTimeout(() => {
            button.dataset.opening = '0';
            button.disabled = false;
        }, 1200);
    }

    const message = whatsappReminderMessage(kind, item);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
}

async function copyWhatsappReminder(kind, itemId) {
    const item = whatsappReminderData?.[kind]?.find(entry => String(entry.id) === String(itemId));
    if (!item) return;
    const text = whatsappReminderMessage(kind, item);
    try {
        await navigator.clipboard.writeText(text);
        toast.success('Текст напоминания скопирован');
    } catch {
        toast.error('Не удалось скопировать текст');
    }
}

function setWhatsappReminderFilter(kind) {
    whatsappReminderFilter = kind;
    renderWhatsappReminderContent();
}

function whatsappReminderMeta(kind, item) {
    if (kind === 'homework') {
        const dateStr = item.date ? new Date(item.date).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : '';
        return [
            `Прошедший урок: ${dateStr}`,
            item.subject,
            item.groupName
        ].filter(Boolean).join(' · ');
    }
    if (kind === 'today' || kind === 'tomorrow') {
        return [
            item.startTime,
            item.subject,
            item.groupName,
            item.roomName ? `Кабинет: ${item.roomName}` : null,
        ].filter(Boolean).join(' · ');
    }
    if (kind === 'oneLesson') {
        return [item.subject, 'Остался 1 урок', `Баланс: ${new Intl.NumberFormat('ru-RU').format(item.accountBalance || 0)} ₸`].filter(Boolean).join(' · ');
    }

    const date = item.followUpAt
        ? new Date(item.followUpAt).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
        : 'Дата не указана';
    return `${date} · ${item.classesRemaining} занятий · баланс ${new Intl.NumberFormat('ru-RU').format(item.accountBalance || 0)} ₸`;
}

function whatsappReminderCard(kind, item) {
    const message = whatsappReminderMessage(kind, item);
    const hasPhone = Boolean(whatsappReminderPhone(item.phone));
    return `
        <article class="whatsapp-reminder-card">
            <div class="whatsapp-reminder-avatar">${whatsappReminderEscape(whatsappReminderFirstName(item.studentName).slice(0, 1) || '?')}</div>
            <div class="whatsapp-reminder-main">
                <div class="whatsapp-reminder-head">
                    <div>
                        <h3>${whatsappReminderEscape(item.studentName)}</h3>
                        <p>${whatsappReminderEscape(whatsappReminderMeta(kind, item))}</p>
                    </div>
                    <button type="button" class="whatsapp-open-btn" ${hasPhone ? '' : 'disabled'}
                        onclick="openWhatsappReminder('${kind}', '${whatsappReminderEscape(item.id)}', this)"
                        title="${hasPhone ? 'Открыть чат с готовым сообщением' : 'Телефон не указан'}"
                        aria-label="Открыть WhatsApp">
                        <svg viewBox="0 0 32 32" aria-hidden="true">
                            <path fill="currentColor" d="M16.04 3C9.43 3 4.06 8.2 4.06 14.61c0 2.25.67 4.45 1.94 6.32L4 28l7.34-1.91a12.2 12.2 0 0 0 4.7.93h.01c6.6 0 11.98-5.2 11.98-11.61C28.03 9 22.65 3 16.04 3Zm7.05 16.39c-.3.82-1.77 1.57-2.44 1.65-.62.06-1.41.09-2.28-.18-.53-.16-1.21-.38-2.08-.75-3.66-1.54-6.04-5.11-6.22-5.35-.18-.23-1.49-1.92-1.49-3.67s.94-2.61 1.27-2.97c.33-.35.72-.44.96-.44h.69c.22 0 .52-.08.81.59.3.7 1.01 2.38 1.1 2.55.09.18.15.38.03.61-.12.24-.18.38-.36.59-.18.2-.38.45-.54.61-.18.18-.37.37-.16.72.21.35.94 1.5 2.02 2.43 1.39 1.2 2.56 1.57 2.92 1.75.36.18.57.15.78-.09.21-.23.9-1.02 1.14-1.37.24-.35.48-.29.81-.18.33.12 2.1.96 2.46 1.14.36.18.6.26.69.41.09.15.09.85-.21 1.67Z"/>
                        </svg>
                    </button>
                </div>
                <div class="whatsapp-message-preview">${whatsappReminderEscape(message)}</div>
                <div class="whatsapp-reminder-actions">
                    <span>${whatsappReminderEscape(item.phone || 'Телефон не указан')}</span>
                    <button type="button" onclick="copyWhatsappReminder('${kind}', '${whatsappReminderEscape(item.id)}')">Скопировать текст</button>
                    <button type="button" onclick="viewStudent('${whatsappReminderEscape(item.studentId)}')">Открыть ученика</button>
                    <label class="whatsapp-sent-check">
                        <input type="checkbox" onchange="markWhatsappReminderSent('${kind}', '${whatsappReminderEscape(item.id)}', '${whatsappReminderEscape(item.studentId)}', this)">
                        <span>Отправлено</span>
                    </label>
                </div>
            </div>
        </article>
    `;
}

function renderWhatsappReminderContent() {
    const root = document.getElementById('whatsappRemindersRoot');
    if (!root || !whatsappReminderData) return;
    const labels = {
        today: 'Сегодня урок',
        tomorrow: 'Завтра урок',
        homework: 'Домашнее задание',
        oneLesson: 'Остался 1 урок',
        tasks: 'Запланированные контакты',
    };
    const items = whatsappReminderData[whatsappReminderFilter] || [];
    root.innerHTML = `
        <div class="ops-hero whatsapp-reminders-hero">
            <div>
                <p class="ops-eyebrow">Ручная отправка без риска спама</p>
                <h2>WhatsApp-напоминания</h2>
                <p>Нажмите зелёную кнопку — откроется чат ученика с уже заполненным сообщением. Отправку подтверждаете вы.</p>
            </div>
            <button class="ops-refresh" onclick="renderWhatsappReminders(true)">Обновить</button>
        </div>
        <div class="whatsapp-reminder-tabs">
            ${Object.entries(labels).map(([key, label]) => `
                <button class="${whatsappReminderFilter === key ? 'active' : ''}" onclick="setWhatsappReminderFilter('${key}')">
                    <span>${whatsappReminderData.counts?.[key] || 0}</span>${label}
                </button>
            `).join('')}
        </div>
        <div class="whatsapp-reminder-list">
            ${items.length
                ? items.map(item => whatsappReminderCard(whatsappReminderFilter, item)).join('')
                : '<div class="ops-empty">В этой очереди сейчас никого нет</div>'}
        </div>
        ${whatsappReminderFilter === 'oneLesson' && !WHATSAPP_PAYMENT_LINK
            ? '<div class="analytics-note">Ссылка на оплату пока не настроена, поэтому сообщение откроется без неё. Когда пришлёте Kaspi-ссылку, добавим её в один параметр.</div>'
            : ''}
    `;
}

async function renderWhatsappReminders(force = false) {
    const root = document.getElementById('whatsappRemindersRoot');
    if (!root) return;
    if (!whatsappReminderData || force) {
        root.innerHTML = '<div class="ops-loading">Собираем напоминания...</div>';
        try {
            const response = await fetch(`${API_URL}/admin/whatsapp-reminders`, {
                headers: { Authorization: `Bearer ${getAuthToken()}` },
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || 'Ошибка загрузки');
            whatsappReminderData = result;
            updateWhatsappRemindersBadge(result.counts?.total || 0);
        } catch (error) {
            root.innerHTML = `<div class="ops-empty is-error">${whatsappReminderEscape(error.message)}</div>`;
            return;
        }
    }
    renderWhatsappReminderContent();
}

async function markWhatsappReminderSent(kind, itemId, studentId, checkbox) {
    if (!checkbox.checked || checkbox.disabled) return;
    checkbox.disabled = true;
    try {
        const response = await fetch(`${API_URL}/admin/whatsapp-reminders/sent`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ kind, itemId, studentId }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Ошибка сохранения');
        whatsappReminderData[kind] = (whatsappReminderData[kind] || []).filter(item => String(item.id) !== String(itemId));
        whatsappReminderData.counts[kind] = Math.max(0, Number(whatsappReminderData.counts[kind] || 0) - 1);
        whatsappReminderData.counts.total = Math.max(0, Number(whatsappReminderData.counts.total || 0) - 1);
        updateWhatsappRemindersBadge(whatsappReminderData.counts.total);
        renderWhatsappReminderContent();
        toast.success('Отмечено отправленным');
    } catch (error) {
        checkbox.checked = false;
        checkbox.disabled = false;
        toast.error(error.message);
    }
}

async function updateWhatsappRemindersBadge(value) {
    const badge = document.getElementById('whatsappRemindersBadge');
    if (!badge) return;
    if (value === undefined) {
        if (!['admin', 'super_admin'].includes(getUserRole())) return;
        try {
            const response = await fetch(`${API_URL}/admin/whatsapp-reminders`, {
                headers: { Authorization: `Bearer ${getAuthToken()}` },
            });
            const result = await response.json();
            if (!response.ok || !result.success) return;
            value = result.counts?.total || 0;
            whatsappReminderData = result;
        } catch {
            return;
        }
    }
    const count = Number(value) || 0;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
}

window.renderWhatsappReminders = renderWhatsappReminders;
window.setWhatsappReminderFilter = setWhatsappReminderFilter;
window.openWhatsappReminder = openWhatsappReminder;
window.copyWhatsappReminder = copyWhatsappReminder;
window.markWhatsappReminderSent = markWhatsappReminderSent;
window.updateWhatsappRemindersBadge = updateWhatsappRemindersBadge;

setTimeout(() => updateWhatsappRemindersBadge(), 1200);
