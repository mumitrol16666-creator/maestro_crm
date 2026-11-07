let whatsappReminderFilter = 'today';
let whatsappReminderData = null;
let whatsappReminderEventsBound = false;
let whatsappBroadcastData = null;
let whatsappBroadcastTimer = null;
let whatsappBroadcastStarting = false;
const WHATSAPP_BROADCAST_INTERVAL_MIN = 3;
const WHATSAPP_CUSTOM_DRAFT_KEY = 'maestro-whatsapp-custom-draft';
let whatsappCustomDraft = whatsappCustomLoadDraft();
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
        const sections = [
            item.topic ? `*Тема урока:*\n${item.topic}` : '',
            item.homework ? `*Домашнее задание:*\n${item.homework}` : '',
            item.summary ? `*Итог урока:*\n${item.summary}` : '',
        ].filter(Boolean);
        return sections.join('\n\n');
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
        if (whatsappAction === 'show-qr') {
            window.openWhatsappQrFromHub?.();
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
        if (whatsappAction === 'broadcast') {
            startWhatsappBroadcast(kind);
            return;
        }
        if (whatsappAction === 'custom-broadcast') {
            startWhatsappCustomBroadcast();
            return;
        }
        if (whatsappAction === 'broadcast-cancel') {
            cancelWhatsappBroadcast(control.dataset.broadcastId);
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
        if (['custom-message', 'custom-contacts'].includes(field.dataset.whatsappAction) && field.closest('#whatsappRemindersRoot')) {
            whatsappCustomDraft[field.dataset.whatsappAction === 'custom-message' ? 'message' : 'contacts'] = field.value;
            whatsappCustomSaveDraft();
            updateWhatsappCustomSummary();
            return;
        }
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
    const wasInbox = whatsappReminderFilter === 'inbox';
    whatsappReminderFilter = kind;
    renderWhatsappReminderContent();
    if (kind === 'inbox' && !wasInbox && typeof renderWhatsappInbox === 'function') renderWhatsappInbox();
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
    if (kind === 'exam') {
        const date = item.date
            ? new Date(item.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' })
            : null;
        return [date && item.startTime ? `${date}, ${item.startTime}` : date, item.subject, item.roomName ? `Кабинет: ${item.roomName}` : null]
            .filter(Boolean).join(' · ');
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
    const draftLabel = item.messageSource === 'unavailable'
        ? 'Нужен получатель'
        : kind === 'homework'
            ? 'Шаблон итогов урока'
            : kind === 'exam'
                ? 'Приглашение на экзамен'
                : 'Готовый черновик';
    const isPayment = kind === 'oneLesson' || kind === 'tasks';
    const lockState = whatsappBroadcastLock(item);
    const queued = ['pending', 'claimed', 'duplicate'].includes(lockState?.status);
    const broadcastNote = queued
        ? '<p class="whatsapp-message-note is-broadcast">В рассылке: сообщение уйдёт автоматически, текст уже не меняется</p>'
        : lockState?.status === 'uncertain'
            ? `<p class="whatsapp-message-note is-broadcast">Возможно, уже ушло рассылкой в ${whatsappReminderEscape(whatsappBroadcastTime(lockState.at))}. Проверьте чат в WhatsApp: если не ушло, отправьте вручную</p>`
            : '';
    const messageField = `
        <div class="whatsapp-message-meta">
            <span class="whatsapp-message-source">${whatsappReminderEscape(draftLabel)}</span>
            <span class="whatsapp-message-recipient">Получатель: ${whatsappReminderEscape(whatsappReminderRecipientLabel(item))}</span>
        </div>
        ${item.messageNote ? `<p class="whatsapp-message-note">${whatsappReminderEscape(item.messageNote)}</p>` : ''}
        ${isPayment ? '<p class="whatsapp-message-note">Укажите сумму перед отправкой</p>' : ''}
        ${broadcastNote}
        <textarea class="whatsapp-message-preview" data-whatsapp-action="message" data-kind="${safeKind}" data-item-id="${safeItemId}" aria-label="Текст сообщения" ${queued ? 'readonly' : ''}>${whatsappReminderEscape(message)}</textarea>
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
                    <button type="button" class="whatsapp-open-btn" ${hasPhone && !queued ? '' : 'disabled'}
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
                        <input type="checkbox" data-whatsapp-action="sent" data-kind="${safeKind}" data-item-id="${safeItemId}" data-student-id="${safeStudentId}" ${queued ? 'disabled' : ''}>
                        <span>Отправлено</span>
                    </label>
                </div>
            </div>
        </article>
    `;
}


// Одна строка состояния бота WhatsApp для всего раздела: выключен, сломан, вышел из аккаунта или готов.
function whatsappWorkerStatus() {
    const worker = whatsappBroadcastData?.worker;
    if (!worker) return null;
    const lastSeen = worker.lastHeartbeatAt ? ` (последний раз в ${whatsappBroadcastTime(worker.lastHeartbeatAt)})` : '';
    if (worker.online && !worker.broadcastEnabled) {
        return { tone: 'warn', text: 'Бот WhatsApp подключён, но рассылка в нём выключена: сообщения встанут в очередь и будут ждать' };
    }
    if (worker.online) return { tone: 'ok', text: 'Бот WhatsApp подключён: входящие приходят, рассылка пойдёт сразу' };
    if (worker.alive && worker.status === 'qr_required') {
        return { tone: 'warn', qr: true, text: 'Бот WhatsApp вышел из аккаунта: отсканируйте QR. До этого входящих и рассылки нет' };
    }
    if (worker.alive && worker.status === 'degraded') {
        return { tone: 'bad', text: 'Бот WhatsApp запущен, но WhatsApp в нём не открывается: входящих и рассылки нет, пока его не перезапустить' };
    }
    return { tone: 'bad', text: `Бот WhatsApp выключен${lastSeen}: входящих и рассылки нет, пока его не запустить на компьютере школы` };
}

function whatsappWorkerStatusHtml() {
    const status = whatsappWorkerStatus();
    if (!status) return '';
    return `<p class="wa-hub-status is-${status.tone}"><i aria-hidden="true"></i><span>${whatsappReminderEscape(status.text)}</span>${status.qr ? '<button type="button" data-whatsapp-action="show-qr">Показать QR</button>' : ''}</p>`;
}

function whatsappReminderPanels() {
    const isInbox = whatsappReminderFilter === 'inbox';
    const inboxRoot = document.getElementById('whatsappInboxRoot');
    if (inboxRoot) inboxRoot.hidden = !isInbox;
}

function renderWhatsappReminderContent() {
    const root = document.getElementById('whatsappRemindersRoot');
    if (!root || !whatsappReminderData) return;
    const labels = {
        inbox: 'Переписка',
        today: 'Сегодня урок',
        tomorrow: 'Завтра урок',
        homework: 'После урока',
        oneLesson: 'Низкий баланс',
        tasks: 'Контакты по плану',
        exam: 'Экзамены',
        custom: 'Своя рассылка',
    };
    const isInbox = whatsappReminderFilter === 'inbox';
    const items = isInbox ? [] : (whatsappReminderData[whatsappReminderFilter] || []);
    const isCustom = whatsappReminderFilter === 'custom';
    const inboxCount = Number(window.whatsappInboxNeedsReply?.() || 0);
    const count = key => key === 'inbox'
        ? `<span class="wa-hub-count${inboxCount ? ' is-hot' : ''}" id="waHubInboxCount">${inboxCount > 99 ? '99+' : inboxCount}</span>`
        : key === 'custom'
            ? '<span class="wa-hub-count" aria-hidden="true">✎</span>'
            : `<span class="wa-hub-count">${whatsappReminderData.counts?.[key] || 0}</span>`;
    root.innerHTML = `
        <header class="wa-hub-head">
            ${whatsappWorkerStatusHtml()}
            <button class="ops-refresh wa-hub-refresh" data-whatsapp-action="refresh">Обновить</button>
        </header>
        <nav class="wa-hub-tabs" aria-label="Разделы WhatsApp">
            ${Object.entries(labels).map(([key, label]) => `
                <button type="button" class="${whatsappReminderFilter === key ? 'active' : ''}${key === 'inbox' ? ' is-inbox' : ''}" data-whatsapp-action="filter" data-kind="${whatsappReminderEscape(key)}" ${whatsappReminderFilter === key ? 'aria-current="page"' : ''}>
                    ${label}${count(key)}
                </button>
            `).join('')}
        </nav>
        ${isInbox ? '' : isCustom ? whatsappCustomComposer() : whatsappBroadcastPanel(whatsappReminderFilter, items)}
        ${isInbox || isCustom ? '' : `<div class="whatsapp-reminder-list">
            ${items.length
                ? items.map(item => whatsappReminderCard(whatsappReminderFilter, item)).join('')
                : '<div class="ops-empty">В этой очереди сейчас никого нет</div>'}
        </div>`}
    `;
    whatsappReminderPanels();
    if (isCustom) updateWhatsappCustomSummary();
}

// Те же правила, что у сервера (services/whatsappBroadcast.js): иначе число на кнопке не совпадёт с очередью.
function whatsappBroadcastPhone(phone) {
    const digits = whatsappReminderPhone(phone);
    return digits.length >= 11 && digits.length <= 15 ? digits : '';
}

function whatsappBroadcastLock(item) {
    return whatsappBroadcastData?.reminderStates?.[item.id] || null;
}

function whatsappBroadcastFillable(kind, item) {
    const message = whatsappReminderMessage(kind, item);
    return Boolean(whatsappBroadcastPhone(item.phone) && message.trim() && !/_{3,}/.test(message));
}

function whatsappBroadcastReady(kind, item) {
    return whatsappBroadcastFillable(kind, item) && !whatsappBroadcastLock(item);
}

// После этого времени CRM сообщение не отправит: «Сегодня урок» — до начала урока, остальное — до конца дня.
function whatsappBroadcastExpiry(kind, item) {
    if ((kind === 'today' || kind === 'tomorrow') && item.date && item.startTime) {
        const start = new Date(item.date);
        const [hours, minutes] = String(item.startTime).split(':').map(Number);
        if (!Number.isNaN(start.getTime()) && Number.isFinite(hours)) {
            start.setHours(hours, Number.isFinite(minutes) ? minutes : 0, 0, 0);
            return start.toISOString();
        }
    }
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 0, 0);
    return endOfDay.toISOString();
}

function whatsappBroadcastTime(value) {
    return value ? new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
}

const WHATSAPP_BROADCAST_PROBLEMS = {
    invalid: 'номера нет в WhatsApp',
    failed: 'не отправилось',
    uncertain: 'не удалось проверить, ушло ли',
    expired: 'время прошло, не отправляли',
};

function whatsappBroadcastPanel(kind, items, { startButton = true } = {}) {
    const overview = whatsappBroadcastData;
    const running = overview?.broadcasts?.find(row => row.status === 'running') || null;
    const recent = overview?.broadcasts?.find(row => row.status !== 'running' && row.kind === kind) || null;
    const ready = items.filter(item => whatsappBroadcastReady(kind, item)).length;
    const locked = items.filter(item => whatsappBroadcastLock(item)).length;
    const notReady = items.filter(item => !whatsappBroadcastLock(item) && !whatsappBroadcastFillable(kind, item)).length;
    const block = (row, isRunning) => {
        const total = row.items.length;
        const counts = row.counts || {};
        const done = (counts.sent || 0);
        const problems = row.items.filter(item => WHATSAPP_BROADCAST_PROBLEMS[item.status]);
        const next = isRunning && overview?.nextSendAt ? ` Следующее около ${whatsappReminderEscape(whatsappBroadcastTime(overview.nextSendAt))}.` : '';
        const state = isRunning
            ? `Идёт рассылка «${whatsappReminderEscape(row.label)}»: отправлено ${done} из ${total}.${next}`
            : row.status === 'cancelled'
                ? `Рассылка «${whatsappReminderEscape(row.label)}» остановлена: отправлено ${done} из ${total}.`
                : `Рассылка «${whatsappReminderEscape(row.label)}» закончена в ${whatsappReminderEscape(whatsappBroadcastTime(row.finishedAt))}: отправлено ${done} из ${total}.`;
        return `
            <div class="whatsapp-broadcast-progress">
                <p>${state}</p>
                ${problems.length ? `<ul>${problems.map(item => `<li>${whatsappReminderEscape(item.recipientName || '+' + item.phone)}: ${whatsappReminderEscape(WHATSAPP_BROADCAST_PROBLEMS[item.status])}</li>`).join('')}</ul>` : ''}
                ${isRunning ? `<button type="button" class="whatsapp-broadcast-stop" data-whatsapp-action="broadcast-cancel" data-broadcast-id="${whatsappReminderEscape(row.id)}">Остановить рассылку</button>` : ''}
            </div>`;
    };

    const busy = Boolean(running) || whatsappBroadcastStarting;
    return `
        <section class="whatsapp-broadcast" aria-label="Рассылка">
            <div class="whatsapp-broadcast-head">
                ${startButton ? `<button type="button" class="whatsapp-broadcast-start" data-whatsapp-action="broadcast" data-kind="${whatsappReminderEscape(kind)}" ${ready && !busy ? '' : 'disabled'}>
                    Разослать всем (${ready}) · раз в ${WHATSAPP_BROADCAST_INTERVAL_MIN} мин
                </button>` : ''}
            </div>
            ${running && running.kind !== kind ? `<p class="whatsapp-broadcast-note">Сейчас идёт рассылка «${whatsappReminderEscape(running.label)}». Новую можно запустить после неё.</p>` : ''}
            ${notReady ? `<p class="whatsapp-broadcast-note">Не войдут в рассылку: ${notReady}. У них нет телефона или в тексте пропуск «___» (например, сумма), их можно отправить вручную.</p>` : ''}
            ${locked ? `<p class="whatsapp-broadcast-note">Уже в рассылке или, возможно, ушли рассылкой: ${locked}.</p>` : ''}
            ${running ? block(running, true) : recent ? block(recent, false) : ''}
        </section>`;
}

async function loadWhatsappBroadcasts() {
    try {
        const response = await fetch(`${API_URL}/admin/whatsapp-broadcasts`, {
            headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        const result = await response.json();
        if (!response.ok || !result.success) return;
        const previousSent = whatsappBroadcastSentCount();
        whatsappBroadcastData = result;
        if (previousSent !== null && whatsappBroadcastSentCount() !== previousSent) {
            // Отправленные рассылкой карточки уходят из очереди так же, как после галочки.
            await refreshWhatsappReminderQueue();
        }
    } catch {
        // Панель рассылки не мешает ручной отправке: при ошибке просто не обновляем её.
    } finally {
        scheduleWhatsappBroadcastPoll();
    }
}

function whatsappBroadcastSentCount() {
    if (!whatsappBroadcastData) return null;
    return whatsappBroadcastData.broadcasts.reduce((sum, row) => sum + (row.counts?.sent || 0), 0);
}

async function refreshWhatsappReminderQueue() {
    try {
        const response = await fetch(`${API_URL}/admin/whatsapp-reminders`, {
            headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        const result = await response.json();
        if (!response.ok || !result.success) return;
        // Тексты, которые администратор поправил вручную, не теряем.
        for (const kind of Object.keys(result)) {
            if (!Array.isArray(result[kind])) continue;
            for (const item of result[kind]) {
                const previous = whatsappReminderItem(kind, item.id);
                if (previous?.message && previous.message !== item.message) item.message = previous.message;
            }
        }
        whatsappReminderData = result;
        updateWhatsappRemindersBadge(result.counts?.total || 0);
    } catch {
        // Следующий опрос попробует снова.
    }
}

function scheduleWhatsappBroadcastPoll() {
    clearTimeout(whatsappBroadcastTimer);
    const root = document.getElementById('whatsappRemindersRoot');
    if (!root || !root.isConnected || root.offsetParent === null) return;
    const running = whatsappBroadcastData?.broadcasts?.some(row => row.status === 'running');
    whatsappBroadcastTimer = setTimeout(async () => {
        await loadWhatsappBroadcasts();
        // Не перерисовывать, пока человек печатает в любом поле вкладки: иначе собьётся курсор.
        if (!document.activeElement?.matches?.('#whatsappRemindersRoot textarea, #whatsappRemindersRoot input')) {
            renderWhatsappReminderContent();
        }
    }, running ? 10000 : 30000);
}

async function startWhatsappBroadcast(kind) {
    if (whatsappBroadcastStarting) return;
    const labels = { today: 'Сегодня урок', tomorrow: 'Завтра урок', homework: 'После урока', oneLesson: 'Низкий баланс', tasks: 'Запланированные контакты', exam: 'Экзамены' };
    // Очередь могла устареть с момента открытия страницы: берём свежую, ручные правки текста сохраняются.
    await refreshWhatsappReminderQueue();
    await loadWhatsappBroadcasts();
    renderWhatsappReminderContent();
    const items = (whatsappReminderData?.[kind] || []).filter(item => whatsappBroadcastReady(kind, item));
    if (!items.length) {
        toast.error('Отправлять некому: очередь обновилась');
        return;
    }
    const minutes = (items.length - 1) * WHATSAPP_BROADCAST_INTERVAL_MIN;
    const timing = items.length > 1
        ? ` Между сообщениями ${WHATSAPP_BROADCAST_INTERVAL_MIN} минуты, последнее уйдёт примерно через ${minutes} мин.`
        : '';
    const question = `Разослать «${labels[kind]}»: ${items.length} сообщ.?\n\nКаждому уйдёт текст из его карточки.${timing} Компьютер с WhatsApp должен быть включён.`;
    if (!await customConfirm(question, { yesText: 'Разослать', noText: 'Отмена' })) return;
    whatsappBroadcastStarting = true;
    renderWhatsappReminderContent();
    try {
        const response = await fetch(`${API_URL}/admin/whatsapp-broadcasts`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                kind,
                intervalSec: WHATSAPP_BROADCAST_INTERVAL_MIN * 60,
                items: items.map(item => ({
                    reminderId: item.id,
                    studentId: item.studentId,
                    recipientName: item.studentName,
                    phone: item.phone,
                    content: whatsappReminderMessage(kind, item),
                    expiresAt: whatsappBroadcastExpiry(kind, item),
                })),
            }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Не удалось запустить рассылку');
        const skippedText = result.skipped?.length
            ? ` Пропущено ${result.skipped.length}: ${result.skipped.slice(0, 3).map(row => `${row.recipientName || 'без имени'} — ${row.reason}`).join('; ')}${result.skipped.length > 3 ? '…' : ''}.`
            : '';
        toast.success(`Рассылка запущена: ${result.broadcast.count} сообщ.${skippedText}`);
    } catch (error) {
        toast.error(error.message || 'Не удалось запустить рассылку');
    } finally {
        whatsappBroadcastStarting = false;
        await loadWhatsappBroadcasts();
        renderWhatsappReminderContent();
    }
}

async function cancelWhatsappBroadcast(broadcastId) {
    if (!broadcastId) return;
    if (!await customConfirm('Остановить рассылку? Сообщение, которое отправляется прямо сейчас, уйдёт, остальные — нет.', { icon: 'warning', yesText: 'Остановить', noText: 'Продолжить' })) return;
    try {
        const response = await fetch(`${API_URL}/admin/whatsapp-broadcasts/${encodeURIComponent(broadcastId)}/cancel`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Не удалось остановить рассылку');
        toast.success('Рассылка остановлена');
    } catch (error) {
        toast.error(error.message || 'Не удалось остановить рассылку');
    } finally {
        await loadWhatsappBroadcasts();
        renderWhatsappReminderContent();
    }
}

function whatsappCustomLoadDraft() {
    try {
        const saved = JSON.parse(localStorage.getItem(WHATSAPP_CUSTOM_DRAFT_KEY) || '{}');
        return { message: String(saved.message || ''), contacts: String(saved.contacts || '') };
    } catch {
        return { message: '', contacts: '' };
    }
}

function whatsappCustomSaveDraft() {
    try {
        localStorage.setItem(WHATSAPP_CUSTOM_DRAFT_KEY, JSON.stringify(whatsappCustomDraft));
    } catch {
        // Черновик — удобство: без хранилища вкладка работает, просто не помнит текст.
    }
}

// Одна строка — один контакт: «Имя; телефон», «Имя, телефон», «Имя телефон» или только телефон.
function whatsappCustomContacts(text) {
    const contacts = [];
    const bad = [];
    const seen = new Set();
    for (const rawLine of String(text || '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const match = line.match(/\+?\d[\d\s()\-]{8,}\d/);
        const phone = match ? whatsappBroadcastPhone(match[0]) : '';
        if (!phone) {
            bad.push(line);
            continue;
        }
        if (seen.has(phone)) continue;
        seen.add(phone);
        const name = (line.slice(0, match.index) + line.slice(match.index + match[0].length)).replace(/^[\s;,\-—]+|[\s;,\-—]+$/g, '');
        contacts.push({ name, phone });
    }
    return { contacts, bad };
}

// {имя} — первое слово имени. Без имени «Здравствуйте, {имя}!» становится «Здравствуйте!».
function whatsappCustomText(message, name) {
    const first = String(name || '').trim().split(/\s+/)[0] || '';
    return first
        ? String(message).replace(/\{[иИ]мя\}/g, first).trim()
        : String(message).replace(/,?[ \t]*\{[иИ]мя\}/g, '').trim();
}

function whatsappCustomComposer() {
    return `
        <section class="whatsapp-custom" aria-label="Своя рассылка">
            <label class="whatsapp-custom-field">
                <span>Сообщение</span>
                <textarea class="admin-input" rows="4" data-whatsapp-action="custom-message" placeholder="Здравствуйте, {имя}! Урок сегодня переносится на 19:00.">${whatsappReminderEscape(whatsappCustomDraft.message)}</textarea>
                <small>{имя} заменится на первое слово из строки контакта. Если имени нет, получится «Здравствуйте!».</small>
            </label>
            <label class="whatsapp-custom-field">
                <span>Номера, по одному на строку</span>
                <textarea class="admin-input" rows="8" data-whatsapp-action="custom-contacts" placeholder="Айгерим; +7 701 123 45 67&#10;Данияр, 87021234567&#10;+77051234567">${whatsappReminderEscape(whatsappCustomDraft.contacts)}</textarea>
                <small data-whatsapp-custom="parsed"></small>
            </label>
            <div class="whatsapp-custom-preview" data-whatsapp-custom="preview" hidden></div>
            <div class="whatsapp-broadcast-head">
                <button type="button" class="whatsapp-broadcast-start" data-whatsapp-action="custom-broadcast" data-whatsapp-custom="start" disabled>Разослать</button>
            </div>
        </section>
        ${whatsappBroadcastPanel('custom', [], { startButton: false })}
    `;
}

// Обновляет счётчик, пример и кнопку без перерисовки вкладки, чтобы не сбивать курсор в поле.
function updateWhatsappCustomSummary() {
    const root = document.getElementById('whatsappRemindersRoot');
    if (!root) return;
    const { contacts, bad } = whatsappCustomContacts(whatsappCustomDraft.contacts);
    const message = whatsappCustomDraft.message.trim();
    const running = whatsappBroadcastData?.broadcasts?.some(row => row.status === 'running');
    const parsed = root.querySelector('[data-whatsapp-custom="parsed"]');
    const preview = root.querySelector('[data-whatsapp-custom="preview"]');
    const start = root.querySelector('[data-whatsapp-custom="start"]');
    if (parsed) {
        parsed.textContent = `Номеров: ${contacts.length}.`
            + (bad.length ? ` Не понял строки (${bad.length}): ${bad.slice(0, 3).join(' · ')}${bad.length > 3 ? '…' : ''}` : ' Повторы номеров убираются.');
    }
    if (preview) {
        preview.hidden = !(message && contacts.length);
        preview.textContent = message && contacts.length ? `Так увидит первый: ${whatsappCustomText(message, contacts[0].name)}` : '';
    }
    if (start) {
        start.textContent = `Разослать (${contacts.length}) · раз в ${WHATSAPP_BROADCAST_INTERVAL_MIN} мин`;
        start.disabled = !message || !contacts.length || running || whatsappBroadcastStarting;
    }
}

async function startWhatsappCustomBroadcast() {
    if (whatsappBroadcastStarting) return;
    const { contacts } = whatsappCustomContacts(whatsappCustomDraft.contacts);
    const message = whatsappCustomDraft.message.trim();
    if (!message || !contacts.length) return;
    const minutes = (contacts.length - 1) * WHATSAPP_BROADCAST_INTERVAL_MIN;
    const timing = contacts.length > 1
        ? ` Между сообщениями ${WHATSAPP_BROADCAST_INTERVAL_MIN} минуты, последнее уйдёт примерно через ${minutes} мин.`
        : '';
    const question = `Разослать своё сообщение на ${contacts.length} номер(ов)?\n\n«${whatsappCustomText(message, contacts[0].name).slice(0, 200)}»\n${timing} Компьютер с WhatsApp должен быть включён.`;
    if (!await customConfirm(question, { yesText: 'Разослать', noText: 'Отмена' })) return;
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 0, 0);
    whatsappBroadcastStarting = true;
    updateWhatsappCustomSummary();
    try {
        const response = await fetch(`${API_URL}/admin/whatsapp-broadcasts`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                kind: 'custom',
                intervalSec: WHATSAPP_BROADCAST_INTERVAL_MIN * 60,
                items: contacts.map(contact => ({
                    recipientName: contact.name || null,
                    phone: contact.phone,
                    content: whatsappCustomText(message, contact.name),
                    expiresAt: endOfDay.toISOString(),
                })),
            }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Не удалось запустить рассылку');
        const skippedText = result.skipped?.length
            ? ` Пропущено ${result.skipped.length}: ${result.skipped.slice(0, 3).map(row => `${row.recipientName || 'без имени'} — ${row.reason}`).join('; ')}${result.skipped.length > 3 ? '…' : ''}.`
            : '';
        toast.success(`Рассылка запущена: ${result.broadcast.count} сообщ.${skippedText}`);
        // Список ушёл в очередь: очищаем, чтобы второе нажатие не отправило его снова. Текст оставляем.
        whatsappCustomDraft.contacts = '';
        whatsappCustomSaveDraft();
    } catch (error) {
        toast.error(error.message || 'Не удалось запустить рассылку');
    } finally {
        whatsappBroadcastStarting = false;
        await loadWhatsappBroadcasts();
        renderWhatsappReminderContent();
    }
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
    await Promise.all([
        loadWhatsappBroadcasts(),
        window.loadWhatsappInboxStatus?.().catch(() => {}),
    ]);
    renderWhatsappReminderContent();
    if (whatsappReminderFilter === 'inbox' && typeof renderWhatsappInbox === 'function') await renderWhatsappInbox();
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
window.whatsappReminderOpenInbox = () => { whatsappReminderFilter = 'inbox'; };
window.openWhatsappReminder = openWhatsappReminder;
window.copyWhatsappReminder = copyWhatsappReminder;
window.markWhatsappReminderSent = markWhatsappReminderSent;
window.updateWhatsappRemindersBadge = updateWhatsappRemindersBadge;

setTimeout(() => updateWhatsappRemindersBadge(), 1200);
