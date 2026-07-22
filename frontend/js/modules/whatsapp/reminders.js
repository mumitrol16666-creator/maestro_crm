let whatsappReminderFilter = 'today';
let whatsappReminderData = null;
let whatsappReminderEventsBound = false;
const WHATSAPP_PAYMENT_LINK = 'https://pay.kaspi.kz/pay/ku3aldre';

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
    const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    return parts[1] || parts[0] || '';
}

function whatsappReminderVariantIndex(item, count) {
    const key = String(item?.id || item?.studentId || 'reminder');
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) {
        hash = ((hash * 31) + key.charCodeAt(index)) >>> 0;
    }
    return count ? hash % count : 0;
}

function whatsappReminderMessage(kind, item) {
    const greeting = 'Здравствуйте!';
    const editedMessage = String(item.message || '').trim();
    if (editedMessage) return editedMessage;
    const subject = String(item.subject || '').trim().toLowerCase();
    const hasSubject = Boolean(subject && subject !== 'занятию');
    const subjectLabel = hasSubject ? ` — ${subject}` : '';
    const directionLabel = hasSubject ? ` по направлению «${subject}»` : '';

    if (kind === 'homework') {
        const topicText = item.topic ? `\n*Тема прошлого урока:* ${item.topic}` : '';
        const hwText = item.homework ? `\n*Домашнее задание:* ${item.homework}` : '';
        return `${greeting} Подготовили информацию по прошедшему уроку ученика.${topicText}${hwText}`;
    }

    if (kind === 'today' || kind === 'tomorrow') {
        const day = kind === 'today' ? 'сегодня' : 'завтра';
        const dayCapitalized = day.charAt(0).toUpperCase() + day.slice(1);
        const time = item.startTime ? ` в ${item.startTime}` : '';
        const variants = [
            `У вас ${day} урок${time}${subjectLabel} 😊`,
            `Напоминаем: ${day}${time} у вас занятие${hasSubject ? `. Направление — ${subject}` : ''} 🎵`,
            `${dayCapitalized} ждём вас на уроке${time}${directionLabel} 🎸`,
            `Ваш урок ${day}${time}${subjectLabel}. До встречи! ✨`,
            `${dayCapitalized}${time} у вас занятие${directionLabel} 🙌`,
        ];
        return variants[whatsappReminderVariantIndex(item, variants.length)];
    }

    if (kind === 'oneLesson') {
        const paymentText = `\n\nСумма: ___ ₸\nСсылка для оплаты:\n${WHATSAPP_PAYMENT_LINK}\n\nПосле оплаты отправьте, пожалуйста, чек 🙏`;
        return `${greeting} В абонементе ученика остался всего 1 урок.${paymentText}`;
    }

    const paymentText = `\n\nСумма: ___ ₸\nСсылка для оплаты:\n${WHATSAPP_PAYMENT_LINK}\n\nПосле оплаты отправьте, пожалуйста, чек 🙏`;
    return `${greeting} Напоминаем по оплате обучения. У ученика заканчиваются уроки.${paymentText}`;
}

function whatsappReminderItem(kind, itemId) {
    return whatsappReminderData?.[kind]?.find(entry => String(entry.id) === String(itemId));
}

function bindWhatsappReminderEvents() {
    if (whatsappReminderEventsBound) return;
    whatsappReminderEventsBound = true;

    document.addEventListener('click', (event) => {
        const source = event.target instanceof Element ? event.target : event.target?.parentElement;
        const control = source?.closest('[data-whatsapp-action]');
        if (!control || !control.closest('#whatsappRemindersRoot')) return;

        const { whatsappAction, kind, itemId, studentId } = control.dataset;
        if (whatsappAction === 'filter') {
            setWhatsappReminderFilter(kind || 'today');
            return;
        }
        if (whatsappAction === 'refresh') {
            renderWhatsappReminders(true);
            return;
        }
        if (whatsappAction === 'open') {
            openWhatsappReminder(kind, itemId, control);
            return;
        }
        if (whatsappAction === 'copy') {
            copyWhatsappReminder(kind, itemId);
            return;
        }
        if (whatsappAction === 'student' && studentId && typeof viewStudent === 'function') {
            viewStudent(studentId);
        }
    });

    document.addEventListener('change', (event) => {
        const checkbox = event.target;
        if (!(checkbox instanceof HTMLInputElement)) return;
        if (checkbox.dataset.whatsappAction !== 'sent' || !checkbox.closest('#whatsappRemindersRoot')) return;
        markWhatsappReminderSent(
            checkbox.dataset.kind,
            checkbox.dataset.itemId,
            checkbox.dataset.studentId,
            checkbox
        );
    });

    document.addEventListener('input', (event) => {
        const field = event.target;
        if (!(field instanceof HTMLTextAreaElement)) return;
        if (field.dataset.whatsappAction !== 'message' || !field.closest('#whatsappRemindersRoot')) return;
        const item = whatsappReminderItem(field.dataset.kind, field.dataset.itemId);
        if (item) item.message = field.value;
    });
}

function openWhatsappReminder(kind, itemId, button) {
    if (button?.dataset.opening === '1') return;
    const item = whatsappReminderItem(kind, itemId);
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
    const item = whatsappReminderItem(kind, itemId);
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
        return [item.subject, 'Низкий баланс', `Баланс: ${new Intl.NumberFormat('ru-RU').format(item.accountBalance || 0)} ₸`].filter(Boolean).join(' · ');
    }

    const date = item.followUpAt
        ? new Date(item.followUpAt).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
        : 'Дата не указана';
    return `${date} · ${item.classesRemaining} занятий · баланс ${new Intl.NumberFormat('ru-RU').format(item.accountBalance || 0)} ₸`;
}

function whatsappReminderRecipientLabel(item) {
    const audience = String(item?.recipientAudience || '').trim();
    const label = String(item?.recipientLabel || '').trim();
    if (audience === 'parent') return label && label !== 'Родитель' ? `Родитель · ${label}` : 'Родитель';
    if (audience === 'student') return 'Сам ученик';
    return label || 'Получатель не определён';
}

function whatsappReminderCard(kind, item) {
    const message = whatsappReminderMessage(kind, item);
    const hasPhone = Boolean(whatsappReminderPhone(item.phone));
    const safeKind = whatsappReminderEscape(kind);
    const safeItemId = whatsappReminderEscape(item.id);
    const safeStudentId = whatsappReminderEscape(item.studentId);
    const draftLabel = item.messageSource === 'ai'
        ? 'AI-черновик'
        : item.messageSource === 'unavailable'
            ? 'Нужен получатель'
            : 'Готовый черновик';
    const isPayment = kind === 'oneLesson' || kind === 'tasks';
    const messageField = `
        <div class="whatsapp-message-meta">
            <span class="whatsapp-message-source ${item.messageSource === 'ai' ? 'is-ai' : ''}">${whatsappReminderEscape(draftLabel)}</span>
            <span class="whatsapp-message-recipient">Получатель: ${whatsappReminderEscape(whatsappReminderRecipientLabel(item))}</span>
        </div>
        ${item.messageNote ? `<p class="whatsapp-message-note">${whatsappReminderEscape(item.messageNote)}</p>` : ''}
        ${isPayment ? '<p class="whatsapp-message-note">Укажите сумму перед отправкой</p>' : ''}
        <textarea class="whatsapp-message-preview" data-whatsapp-action="message" data-kind="${safeKind}" data-item-id="${safeItemId}" aria-label="Текст сообщения">${whatsappReminderEscape(message)}</textarea>
    `;
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
                        data-whatsapp-action="open"
                        data-kind="${safeKind}"
                        data-item-id="${safeItemId}"
                        title="${hasPhone ? 'Открыть чат с готовым сообщением' : 'Телефон не указан'}"
                        aria-label="Открыть WhatsApp">
                        <svg viewBox="0 0 32 32" aria-hidden="true">
                            <path fill="currentColor" d="M16.04 3C9.43 3 4.06 8.2 4.06 14.61c0 2.25.67 4.45 1.94 6.32L4 28l7.34-1.91a12.2 12.2 0 0 0 4.7.93h.01c6.6 0 11.98-5.2 11.98-11.61C28.03 9 22.65 3 16.04 3Zm7.05 16.39c-.3.82-1.77 1.57-2.44 1.65-.62.06-1.41.09-2.28-.18-.53-.16-1.21-.38-2.08-.75-3.66-1.54-6.04-5.11-6.22-5.35-.18-.23-1.49-1.92-1.49-3.67s.94-2.61 1.27-2.97c.33-.35.72-.44.96-.44h.69c.22 0 .52-.08.81.59.3.7 1.01 2.38 1.1 2.55.09.18.15.38.03.61-.12.24-.18.38-.36.59-.18.2-.38.45-.54.61-.18.18-.37.37-.16.72.21.35.94 1.5 2.02 2.43 1.39 1.2 2.56 1.57 2.92 1.75.36.18.57.15.78-.09.21-.23.9-1.02 1.14-1.37.24-.35.48-.29.81-.18.33.12 2.1.96 2.46 1.14.36.18.6.26.69.41.09.15.09.85-.21 1.67Z"/>
                        </svg>
                    </button>
                </div>
                ${messageField}
                <div class="whatsapp-reminder-actions">
                    <span>${whatsappReminderEscape(item.phone || 'Телефон не указан')}</span>
                    <button type="button" data-whatsapp-action="copy" data-kind="${safeKind}" data-item-id="${safeItemId}">Скопировать текст</button>
                    <button type="button" data-whatsapp-action="student" data-student-id="${safeStudentId}">Открыть ученика</button>
                    <label class="whatsapp-sent-check">
                        <input type="checkbox" data-whatsapp-action="sent" data-kind="${safeKind}" data-item-id="${safeItemId}" data-student-id="${safeStudentId}">
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
        homework: 'После урока',
        oneLesson: 'Низкий баланс',
        tasks: 'Запланированные контакты',
    };
    const items = whatsappReminderData[whatsappReminderFilter] || [];
    root.innerHTML = `
        <div class="ops-hero whatsapp-reminders-hero">
            <div>
                <p class="ops-eyebrow">Ручная отправка без риска спама</p>
                <h2>WhatsApp-напоминания</h2>
                <p>После подтверждения урока здесь появляется готовый AI-черновик. Проверьте текст, при необходимости поправьте и отправьте вручную.</p>
            </div>
            <button class="ops-refresh" data-whatsapp-action="refresh">Обновить</button>
        </div>
        <div class="whatsapp-reminder-tabs">
            ${Object.entries(labels).map(([key, label]) => `
                <button class="${whatsappReminderFilter === key ? 'active' : ''}" data-whatsapp-action="filter" data-kind="${whatsappReminderEscape(key)}">
                    <span>${whatsappReminderData.counts?.[key] || 0}</span>${label}
                </button>
            `).join('')}
        </div>
        <div class="whatsapp-reminder-list">
            ${items.length
                ? items.map(item => whatsappReminderCard(whatsappReminderFilter, item)).join('')
                : '<div class="ops-empty">В этой очереди сейчас никого нет</div>'}
        </div>
    `;
}

async function renderWhatsappReminders(force = false) {
    const root = document.getElementById('whatsappRemindersRoot');
    if (!root) return;
    bindWhatsappReminderEvents();
    if (!whatsappReminderData || force) {
        root.innerHTML = '<div class="ops-loading">Собираем напоминания...</div>';
        try {
            const response = await fetch(`${API_URL}/admin/whatsapp-reminders`, {
                headers: { Authorization: `Bearer ${getAuthToken()}` },
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || 'Не удалось загрузить напоминания');
            whatsappReminderData = result;
            updateWhatsappRemindersBadge(result.counts?.total || 0);
        } catch (error) {
            root.innerHTML = '<div class="ops-empty is-error">Не удалось загрузить напоминания. Обновите страницу.</div>';
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
        if (!response.ok || !result.success) throw new Error(result.error || 'Не удалось сохранить отметку');
        whatsappReminderData[kind] = (whatsappReminderData[kind] || []).filter(item => String(item.id) !== String(itemId));
        whatsappReminderData.counts[kind] = Math.max(0, Number(whatsappReminderData.counts[kind] || 0) - 1);
        whatsappReminderData.counts.total = Math.max(0, Number(whatsappReminderData.counts.total || 0) - 1);
        updateWhatsappRemindersBadge(whatsappReminderData.counts.total);
        renderWhatsappReminderContent();
        toast.success('Отмечено отправленным');
    } catch (error) {
        checkbox.checked = false;
        checkbox.disabled = false;
        toast.error('Не удалось отметить отправку. Попробуйте ещё раз.');
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
