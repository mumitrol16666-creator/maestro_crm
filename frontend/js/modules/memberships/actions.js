let membershipActionKind = 'all';
let membershipActionStatus = 'all';
let membershipActionSearch = '';
let currentMembershipActions = [];

function actionEscape(value) {
    const element = document.createElement('div');
    element.textContent = value ?? '';
    return element.innerHTML;
}

function actionMoney(value) {
    return `${new Intl.NumberFormat('ru-RU').format(Number(value) || 0)} ₸`;
}

function actionDateInput(value) {
    return value ? new Date(value).toISOString().slice(0, 10) : '';
}

function actionPhoneLink(phone) {
    const normalized = String(phone || '').replace(/\D/g, '');
    return normalized ? `https://wa.me/${normalized}` : '#';
}

async function saveMembershipAction(id) {
    const card = document.querySelector(`[data-membership-action="${id}"]`);
    if (!card) return;
    const body = {
        followUpStatus: card.querySelector('[data-field="status"]').value,
        followUpNote: card.querySelector('[data-field="note"]').value,
        followUpAt: card.querySelector('[data-field="followUpAt"]').value || null,
        paymentPromiseDate: card.querySelector('[data-field="promiseDate"]').value || null,
    };
    try {
        const response = await fetch(`${API_URL}/admin/membership-actions/${id}`, {
            method: 'PATCH',
            headers: {
                Authorization: `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Ошибка сохранения');
        toast.success('Результат контакта сохранён');
        invalidateCache('dashboard', 'membership-actions');
        await renderMembershipActions();
    } catch (error) {
        toast.error(error.message);
    }
}

function setMembershipActionFilter(kind, status) {
    if (kind !== undefined) membershipActionKind = kind;
    if (status !== undefined) membershipActionStatus = status;
    renderMembershipActions();
}

async function renderMembershipActions() {
    const root = document.getElementById('membershipActionsRoot');
    if (!root) return;
    root.innerHTML = '<div class="ops-loading">Собираем очередь оплат и продлений...</div>';
    const params = new URLSearchParams({
        kind: membershipActionKind,
        followUpStatus: membershipActionStatus,
        search: membershipActionSearch,
    });

    try {
        const response = await fetch(`${API_URL}/admin/membership-actions?${params}`, {
            headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Ошибка загрузки');
        currentMembershipActions = result.memberships || [];
        const counts = result.counts || {};

        root.innerHTML = `
            <div class="ops-hero membership-actions-hero">
                <div>
                    <p class="ops-eyebrow">Контроль выручки и удержания</p>
                    <h2>Оплаты и продления</h2>
                    <p>Здесь видно, с кем уже связались и кто обещал оплатить.</p>
                </div>
                <div class="membership-actions-summary">
                    <strong>${(counts.new || 0) + (counts.contacted || 0) + (counts.promised || 0)}</strong>
                    <span>требуют внимания</span>
                </div>
            </div>
            <div class="membership-actions-toolbar">
                <div class="ops-filter-group">
                    ${[['all', 'Все'], ['debt', 'Отрицательный баланс'], ['renewal', 'Продления']].map(([value, label]) =>
                        `<button class="${membershipActionKind === value ? 'active' : ''}" onclick="setMembershipActionFilter('${value}')">${label}</button>`).join('')}
                </div>
                <div class="ops-filter-group">
                    ${[['all', 'Все статусы'], ['new', `Не обработаны · ${counts.new || 0}`], ['contacted', `Связались · ${counts.contacted || 0}`], ['promised', `Обещали · ${counts.promised || 0}`], ['closed', `Закрыты · ${counts.closed || 0}`]].map(([value, label]) =>
                        `<button class="${membershipActionStatus === value ? 'active' : ''}" onclick="setMembershipActionFilter(undefined, '${value}')">${label}</button>`).join('')}
                </div>
                <input class="admin-input membership-actions-search" value="${actionEscape(membershipActionSearch)}" placeholder="Поиск ученика или телефона" onkeydown="if(event.key==='Enter'){membershipActionSearch=this.value.trim();renderMembershipActions()}">
            </div>
            <div class="membership-actions-grid">
                ${result.memberships.length ? result.memberships.map(renderMembershipActionCard).join('') : '<div class="ops-empty">В этой очереди сейчас никого нет</div>'}
            </div>
        `;
    } catch (error) {
        root.innerHTML = `<div class="ops-empty is-error">${actionEscape(error.message)}</div>`;
    }
}

function renderMembershipActionCard(item) {
    const isDebt = Number(item.remainingAmount) < 0;
    const isRenewal = Number(item.remainingAmount) >= 0 && Number(item.remainingAmount) <= 4000;
    return `
        <article class="membership-action-card status-${actionEscape(item.followUpStatus)}" data-membership-action="${item.id}">
            <div class="membership-action-head">
                <div>
                    <div class="membership-action-tags">
                        ${isDebt ? '<span class="is-debt">Баланс ученика</span>' : ''}
                        ${isRenewal ? '<span class="is-renewal">Остался 1 урок</span>' : ''}
                    </div>
                    <h3>${actionEscape(item.studentName)}</h3>
                    <p>${actionEscape(item.group?.name || item.plan?.name || 'Индивидуальный абонемент')} · ${actionEscape(item.teacherName || 'Без преподавателя')}</p>
                </div>
                <div class="membership-action-balance">
                    <strong>${actionMoney(item.remainingAmount)}</strong><span>баланс</span>
                </div>
            </div>
            <div class="membership-action-links">
                <button onclick="openMembershipActionWhatsapp('${item.id}')" style="background:#25d366; color:white; border-color:#25d366; border:none; padding:6px 12px; border-radius:12px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:6px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                    Напомнить в WhatsApp
                </button>
                <button onclick="viewStudent('${item.studentId}')">Открыть ученика</button>
                <span>${actionEscape(item.student.phone || 'Телефон не указан')}</span>
            </div>
            <div class="membership-action-form">
                <label>Результат контакта
                    <select class="admin-select" data-field="status">
                        <option value="new" ${item.followUpStatus === 'new' ? 'selected' : ''}>Не обработан</option>
                        <option value="contacted" ${item.followUpStatus === 'contacted' ? 'selected' : ''}>Связались</option>
                        <option value="promised" ${item.followUpStatus === 'promised' ? 'selected' : ''}>Обещал оплатить</option>
                        <option value="closed" ${item.followUpStatus === 'closed' ? 'selected' : ''}>Закрыто</option>
                    </select>
                </label>
                <label>Вернуться к клиенту
                    <input class="admin-input" type="date" data-field="followUpAt" value="${actionDateInput(item.followUpAt)}">
                </label>
                <label>Обещанная дата оплаты
                    <input class="admin-input" type="date" data-field="promiseDate" value="${actionDateInput(item.paymentPromiseDate)}">
                </label>
                <label class="membership-action-note">Комментарий
                    <textarea class="admin-input" data-field="note" placeholder="Что обсудили, что обещал клиент">${actionEscape(item.followUpNote || '')}</textarea>
                </label>
                <button class="membership-action-save" onclick="saveMembershipAction('${item.id}')">Сохранить результат</button>
            </div>
        </article>
    `;
}

function openMembershipActionWhatsapp(id) {
    const item = currentMembershipActions.find(entry => String(entry.id) === String(id));
    if (!item) {
        toast.error('Информационная карточка не найдена');
        return;
    }
    const phone = actionPhoneLink(item.student?.phone).replace('https://wa.me/', '');
    if (!phone || phone === '#') {
        toast.error('У ученика не указан номер телефона');
        return;
    }
    const name = String(item.studentName || '').trim().split(/\s+/)[0] || '';
    const greeting = name ? `Привет, ${name}!` : 'Привет!';
    const isDebt = Number(item.remainingAmount) < 0;

    let message = '';
    if (isDebt) {
        const debtVal = Math.abs(Number(item.remainingAmount) || 0);
        message = `${greeting} Напоминаем, что на балансе по обучению образовался долг в размере ${debtVal.toLocaleString('ru-RU')} ₸. Пожалуйста, пополните баланс в ближайшее время 🙏`;
    } else {
        message = `${greeting} У тебя осталось всего 1 занятие по абонементу. Самое время продлить обучение, чтобы сохранить удобное расписание и время 😊`;
    }

    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
}

window.renderMembershipActions = renderMembershipActions;
window.setMembershipActionFilter = setMembershipActionFilter;
window.saveMembershipAction = saveMembershipAction;
window.openMembershipActionWhatsapp = openMembershipActionWhatsapp;
