const whatsappInboxState = {
    filter: 'needs_reply',
    search: '',
    conversations: [],
    selectedId: null,
    detail: null,
    status: null,
    bound: false,
    linkTimer: null,
};

function whatsappInboxEscape(value) {
    const node = document.createElement('div');
    node.textContent = value ?? '';
    return node.innerHTML;
}

function whatsappInboxDate(value, includeDate = false) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const today = new Date().toDateString() === date.toDateString();
    return date.toLocaleString('ru-RU', today && !includeDate
        ? { hour: '2-digit', minute: '2-digit' }
        : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function whatsappInboxName(conversation) {
    const student = conversation.student
        ? [conversation.student.lastName, conversation.student.name].filter(Boolean).join(' ')
        : '';
    const booking = conversation.booking
        ? [conversation.booking.lastName, conversation.booking.name].filter(Boolean).join(' ')
        : '';
    return conversation.name || student || booking || conversation.phoneNumber || 'Без имени';
}

async function whatsappInboxFetch(path, options = {}) {
    const response = await apiRequest(`/whatsapp-inbox${path}`, options);
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Ошибка WhatsApp inbox');
    return data;
}

function whatsappInboxShell() {
    const root = document.getElementById('whatsappInboxRoot');
    if (!root || root.dataset.ready === '1') return root;
    root.dataset.ready = '1';
    root.innerHTML = `
        <div class="wa-inbox-page">
            <header class="wa-inbox-hero">
                <div>
                    <p class="wa-inbox-eyebrow">Рабочая переписка</p>
                    <h2>WhatsApp школы</h2>
                    <p>Входящие, привязка к CRM и ручная работа без автоответов AI.</p>
                </div>
                <div class="wa-inbox-session" id="waInboxSession"></div>
            </header>
            <div class="wa-inbox-stats" id="waInboxStats"></div>
            <div class="wa-inbox-toolbar">
                <div class="wa-inbox-filters" id="waInboxFilters">
                    <button type="button" data-wa-action="filter" data-filter="needs_reply">Ждут ответа</button>
                    <button type="button" data-wa-action="filter" data-filter="all">Все</button>
                    <button type="button" data-wa-action="filter" data-filter="taken">Забраны</button>
                    <button type="button" data-wa-action="filter" data-filter="unlinked">Без привязки</button>
                </div>
                <label class="wa-inbox-search">
                    <span>Поиск</span>
                    <input type="search" id="waInboxSearch" placeholder="Имя или телефон">
                </label>
                <button type="button" class="wa-inbox-refresh" data-wa-action="refresh">Обновить</button>
            </div>
            <div class="wa-inbox-workspace">
                <aside class="wa-conversation-list" id="waConversationList"></aside>
                <section class="wa-conversation-detail" id="waConversationDetail">
                    <div class="wa-inbox-empty"><strong>Выберите диалог</strong><span>История и действия появятся здесь.</span></div>
                </section>
            </div>
        </div>`;
    return root;
}

function whatsappInboxRenderStatus() {
    const status = whatsappInboxState.status;
    const sessionRoot = document.getElementById('waInboxSession');
    const statsRoot = document.getElementById('waInboxStats');
    const badge = document.getElementById('whatsappInboxBadge');
    if (!status || !sessionRoot || !statsRoot) return;
    const online = status.online;
    const session = status.session;
    sessionRoot.innerHTML = `
        <span class="wa-status-dot ${online ? 'online' : 'offline'}"></span>
        <span><strong>${online ? `WhatsApp подключён · ${session?.mode === 'manual' ? 'ручная отправка' : 'наблюдение'}` : 'Worker не в сети'}</strong>
        <small>${session ? `Последний сигнал: ${whatsappInboxEscape(whatsappInboxDate(session.lastHeartbeatAt, true))}` : 'Сессия ещё не запускалась'}</small></span>`;
    const totals = status.totals || {};
    statsRoot.innerHTML = [
        ['Диалогов', totals.conversations || 0, 'all'],
        ['Ждут ответа', totals.needsReply || 0, 'needs_reply'],
        ['В ручной работе', totals.taken || 0, 'taken'],
        ['В очереди', totals.queued || 0, 'queue'],
    ].map(([label, value, filter]) => `
        <button type="button" data-wa-action="filter" data-filter="${filter}" ${filter === 'queue' ? 'disabled' : ''}>
            <span>${whatsappInboxEscape(label)}</span><strong>${value}</strong>
        </button>`).join('');
    const needsReply = Number(totals.needsReply || 0);
    if (badge) {
        badge.textContent = needsReply > 99 ? '99+' : String(needsReply);
        badge.style.display = needsReply ? 'inline-flex' : 'none';
    }
}

function whatsappInboxRenderList() {
    const root = document.getElementById('waConversationList');
    if (!root) return;
    document.querySelectorAll('#waInboxFilters [data-filter]').forEach(button => {
        button.classList.toggle('active', button.dataset.filter === whatsappInboxState.filter);
    });
    if (!whatsappInboxState.conversations.length) {
        root.innerHTML = '<div class="wa-inbox-empty"><strong>Диалогов нет</strong><span>Измените фильтр или дождитесь входящего сообщения.</span></div>';
        return;
    }
    root.innerHTML = whatsappInboxState.conversations.map(item => {
        const last = item.messages?.[0];
        const needsReply = item.lastInboundAt && (!item.lastOutboundAt || new Date(item.lastInboundAt) > new Date(item.lastOutboundAt));
        const linked = item.student ? 'Ученик' : item.booking ? 'Заявка' : 'Не привязан';
        return `
            <button type="button" class="wa-conversation-item ${item.id === whatsappInboxState.selectedId ? 'active' : ''}"
                data-wa-action="select" data-id="${whatsappInboxEscape(item.id)}">
                <span class="wa-conversation-avatar">${whatsappInboxEscape(whatsappInboxName(item).slice(0, 1).toUpperCase())}</span>
                <span class="wa-conversation-copy">
                    <span class="wa-conversation-head"><strong>${whatsappInboxEscape(whatsappInboxName(item))}</strong><time>${whatsappInboxEscape(whatsappInboxDate(item.lastMessageAt))}</time></span>
                    <span class="wa-conversation-preview">${whatsappInboxEscape(last?.content || 'История пока пуста')}</span>
                    <span class="wa-conversation-meta"><em>${whatsappInboxEscape(linked)}</em>${item.automationStatus === 'paused' ? '<em class="taken">Ручной режим</em>' : ''}</span>
                </span>
                ${needsReply ? '<span class="wa-needs-reply" title="Ждёт ответа"></span>' : ''}
            </button>`;
    }).join('');
}

function whatsappInboxMessage(message) {
    const outgoing = message.direction === 'outgoing';
    return `<article class="wa-message ${outgoing ? 'outgoing' : 'incoming'}">
        <div>${whatsappInboxEscape(message.content)}</div>
        <footer><span>${outgoing ? 'Администратор' : 'Клиент'}</span><time>${whatsappInboxEscape(whatsappInboxDate(message.timestamp, true))}</time></footer>
    </article>`;
}

function whatsappInboxRenderDetail() {
    const root = document.getElementById('waConversationDetail');
    const item = whatsappInboxState.detail;
    if (!root || !item) return;
    const mine = item.takeoverById && item.takeoverById === getUserId();
    const taken = item.automationStatus === 'paused';
    const linkedLabel = item.student
        ? `Ученик: ${[item.student.lastName, item.student.name].filter(Boolean).join(' ')}`
        : item.booking
            ? `Заявка: ${[item.booking.lastName, item.booking.name].filter(Boolean).join(' ')}`
            : 'Не привязан к CRM';
    const pending = (item.outbox || []).filter(entry => entry.status !== 'sent' && entry.status !== 'cancelled');
    root.innerHTML = `
        <header class="wa-detail-head">
            <div><p>${whatsappInboxEscape(item.phoneNumber)}</p><h3>${whatsappInboxEscape(whatsappInboxName(item))}</h3>
                <span class="wa-link-label">${whatsappInboxEscape(linkedLabel)}</span></div>
            <div class="wa-detail-actions">
                <button type="button" data-wa-action="link-panel">Привязать</button>
                ${taken && mine
                    ? '<button type="button" class="danger" data-wa-action="release">Вернуть наблюдателю</button>'
                    : `<button type="button" class="primary" data-wa-action="take">${taken ? 'Перехватить' : 'Забрать диалог'}</button>`}
            </div>
        </header>
        <div class="wa-link-panel" id="waLinkPanel" hidden>
            <div class="wa-link-current">
                ${item.student ? '<button type="button" data-wa-action="unlink-student">Отвязать ученика</button>' : ''}
                ${item.booking ? '<button type="button" data-wa-action="unlink-booking">Отвязать заявку</button>' : ''}
            </div>
            <input type="search" id="waLinkSearch" placeholder="ФИО или телефон ученика/заявки">
            <div id="waLinkResults"></div>
        </div>
        ${taken ? `<div class="wa-takeover-banner ${mine ? 'mine' : ''}"><strong>${mine ? 'Диалог у вас' : 'Диалог забрал другой администратор'}</strong><span>${whatsappInboxEscape(item.takeoverReason || 'Ручная работа')}</span></div>` : ''}
        <div class="wa-message-stream" id="waMessageStream">
            ${(item.messages || []).slice().reverse().map(whatsappInboxMessage).join('') || '<div class="wa-inbox-empty">Сообщений пока нет</div>'}
            ${pending.map(entry => `<article class="wa-outbox-state ${whatsappInboxEscape(entry.status)}"><strong>${entry.status === 'uncertain' ? 'Нужно проверить WhatsApp' : 'Исходящее в очереди'}</strong><span>${whatsappInboxEscape(entry.content)}</span><small>${whatsappInboxEscape(entry.status)}</small></article>`).join('')}
        </div>
        <form class="wa-composer ${mine ? '' : 'locked'}" id="waComposer">
            <textarea id="waComposerText" maxlength="4000" placeholder="${mine ? 'Напишите сообщение клиенту' : 'Чтобы написать, сначала заберите диалог'}" ${mine ? '' : 'disabled'}></textarea>
            <button type="submit" ${mine ? '' : 'disabled'}>Отправить</button>
            <small>${mine ? 'Сообщение уйдёт через подтверждаемую очередь.' : 'AI не отвечает в этом режиме.'}</small>
        </form>`;
    requestAnimationFrame(() => {
        const stream = document.getElementById('waMessageStream');
        if (stream) stream.scrollTop = stream.scrollHeight;
    });
}

async function whatsappInboxLoadList() {
    const params = new URLSearchParams({ filter: whatsappInboxState.filter, limit: '60' });
    if (whatsappInboxState.search) params.set('search', whatsappInboxState.search);
    const data = await whatsappInboxFetch(`/conversations?${params}`);
    whatsappInboxState.conversations = data.conversations || [];
    whatsappInboxRenderList();
}

async function whatsappInboxLoadDetail(id) {
    const data = await whatsappInboxFetch(`/conversations/${encodeURIComponent(id)}`);
    whatsappInboxState.selectedId = id;
    whatsappInboxState.detail = data.conversation;
    whatsappInboxRenderList();
    whatsappInboxRenderDetail();
}

async function whatsappInboxRefresh({ keepDetail = true } = {}) {
    const [status] = await Promise.all([
        whatsappInboxFetch('/status'),
        whatsappInboxLoadList(),
    ]);
    whatsappInboxState.status = status.status;
    whatsappInboxRenderStatus();
    if (keepDetail && whatsappInboxState.selectedId) {
        await whatsappInboxLoadDetail(whatsappInboxState.selectedId).catch(() => {
            whatsappInboxState.selectedId = null;
            whatsappInboxState.detail = null;
        });
    }
}

async function whatsappInboxMutation(path, body) {
    const data = await whatsappInboxFetch(path, { method: 'PATCH', body: JSON.stringify(body) });
    await whatsappInboxRefresh();
    return data;
}

async function whatsappInboxSearchLinks(value) {
    const results = document.getElementById('waLinkResults');
    if (!results) return;
    if (value.trim().length < 2) {
        results.innerHTML = '<small>Введите минимум два символа.</small>';
        return;
    }
    const data = await whatsappInboxFetch(`/link-options?search=${encodeURIComponent(value.trim())}`);
    const rows = [
        ...(data.students || []).map(item => ({ ...item, type: 'student', label: 'Ученик' })),
        ...(data.bookings || []).map(item => ({ ...item, type: 'booking', label: 'Заявка' })),
    ];
    results.innerHTML = rows.length ? rows.map(item => `
        <button type="button" data-wa-action="link" data-link-type="${item.type}" data-id="${whatsappInboxEscape(item.id)}">
            <span><strong>${whatsappInboxEscape([item.lastName, item.name].filter(Boolean).join(' ') || 'Без имени')}</strong><small>${whatsappInboxEscape(item.phone || '')}</small></span>
            <em>${item.label}</em>
        </button>`).join('') : '<small>Совпадений не найдено.</small>';
}

function bindWhatsappInboxEvents() {
    if (whatsappInboxState.bound) return;
    whatsappInboxState.bound = true;
    document.addEventListener('click', async event => {
        const control = event.target.closest?.('[data-wa-action]');
        if (!control || !control.closest('#whatsappInboxRoot')) return;
        const action = control.dataset.waAction;
        try {
            if (action === 'refresh') await whatsappInboxRefresh();
            if (action === 'filter' && control.dataset.filter !== 'queue') {
                whatsappInboxState.filter = control.dataset.filter;
                whatsappInboxState.selectedId = null;
                whatsappInboxState.detail = null;
                await whatsappInboxLoadList();
            }
            if (action === 'select') await whatsappInboxLoadDetail(control.dataset.id);
            if (action === 'take') await whatsappInboxMutation(`/conversations/${whatsappInboxState.selectedId}/takeover`, { action: 'take' });
            if (action === 'release') await whatsappInboxMutation(`/conversations/${whatsappInboxState.selectedId}/takeover`, { action: 'release' });
            if (action === 'link-panel') document.getElementById('waLinkPanel').hidden = !document.getElementById('waLinkPanel').hidden;
            if (action === 'unlink-student') await whatsappInboxMutation(`/conversations/${whatsappInboxState.selectedId}/link`, { studentId: null, bookingId: whatsappInboxState.detail.bookingId });
            if (action === 'unlink-booking') await whatsappInboxMutation(`/conversations/${whatsappInboxState.selectedId}/link`, { studentId: whatsappInboxState.detail.studentId, bookingId: null });
            if (action === 'link') {
                const isStudent = control.dataset.linkType === 'student';
                await whatsappInboxMutation(`/conversations/${whatsappInboxState.selectedId}/link`, {
                    studentId: isStudent ? control.dataset.id : whatsappInboxState.detail.studentId,
                    bookingId: isStudent ? whatsappInboxState.detail.bookingId : control.dataset.id,
                });
            }
        } catch (error) {
            toast.error(error.message);
        }
    });
    document.addEventListener('input', event => {
        if (event.target?.id === 'waInboxSearch') {
            clearTimeout(whatsappInboxState.linkTimer);
            whatsappInboxState.linkTimer = setTimeout(() => {
                whatsappInboxState.search = event.target.value.trim();
                whatsappInboxLoadList().catch(error => toast.error(error.message));
            }, 300);
        }
        if (event.target?.id === 'waLinkSearch') {
            clearTimeout(whatsappInboxState.linkTimer);
            whatsappInboxState.linkTimer = setTimeout(() => whatsappInboxSearchLinks(event.target.value).catch(error => toast.error(error.message)), 300);
        }
    });
    document.addEventListener('submit', async event => {
        if (event.target?.id !== 'waComposer') return;
        event.preventDefault();
        const field = document.getElementById('waComposerText');
        const content = field?.value.trim();
        if (!content) return toast.warning('Введите текст сообщения');
        try {
            const response = await apiRequest(`/whatsapp-inbox/conversations/${whatsappInboxState.selectedId}/messages`, {
                method: 'POST',
                body: JSON.stringify({ content }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Не удалось отправить сообщение');
            field.value = '';
            toast.success('Сообщение поставлено в очередь');
            await whatsappInboxRefresh();
        } catch (error) {
            toast.error(error.message);
        }
    });
}

async function renderWhatsappInbox() {
    whatsappInboxShell();
    bindWhatsappInboxEvents();
    try {
        await whatsappInboxRefresh();
    } catch (error) {
        const root = document.getElementById('waConversationList');
        if (root) root.innerHTML = `<div class="wa-inbox-empty"><strong>Не удалось загрузить WhatsApp</strong><span>${whatsappInboxEscape(error.message)}</span></div>`;
        toast.error(error.message);
    }
}

window.renderWhatsappInbox = renderWhatsappInbox;
window.refreshWhatsappInbox = () => whatsappInboxRefresh();
