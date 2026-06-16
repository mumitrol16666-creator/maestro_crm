let membershipActionKind = 'all';
let membershipActionStatus = 'all';
let membershipActionSearch = '';

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
    const isRenewal = Number(item.classesRemaining) <= 2;
    return `
        <article class="membership-action-card status-${actionEscape(item.followUpStatus)}" data-membership-action="${item.id}">
            <div class="membership-action-head">
                <div>
                    <div class="membership-action-tags">
                        ${isDebt ? '<span class="is-debt">Баланс ученика</span>' : ''}
                        ${isRenewal ? '<span class="is-renewal">Продление</span>' : ''}
                    </div>
                    <h3>${actionEscape(item.studentName)}</h3>
                    <p>${actionEscape(item.group?.name || item.plan?.name || 'Индивидуальный абонемент')} · ${actionEscape(item.teacherName || 'Без преподавателя')}</p>
                </div>
                <div class="membership-action-balance">
                    ${isDebt ? `<strong>${actionMoney(item.remainingAmount)}</strong><span>баланс</span>` : ''}
                    ${isRenewal ? `<strong>${item.classesRemaining}</strong><span>занятий осталось</span>` : ''}
                </div>
            </div>
            <div class="membership-action-links">
                <a href="${actionPhoneLink(item.student.phone)}" target="_blank" rel="noopener">Написать в WhatsApp</a>
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

window.renderMembershipActions = renderMembershipActions;
window.setMembershipActionFilter = setMembershipActionFilter;
window.saveMembershipAction = saveMembershipAction;
