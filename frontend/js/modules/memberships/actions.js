let membershipActionKind = 'all';
let membershipActionSearch = '';
let currentMembershipActions = [];

const membershipActionColumns = [
    { status: 'new', label: 'Новые' },
    { status: 'contacted', label: 'Связались' },
    { status: 'promised', label: 'Обещали' },
];

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

function actionDateText(value) {
    if (!value) return 'не задано';
    return new Date(value).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

function actionTomorrowInput() {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return date.toISOString().slice(0, 10);
}

function actionPhoneLink(phone) {
    const normalized = String(phone || '').replace(/\D/g, '');
    return normalized ? `https://wa.me/${normalized}` : '#';
}

function actionNotificationPhone(student, field) {
    const contacts = [student, ...(student?.additionalPhones || [])];
    const explicit = contacts.find(contact => contact?.[field] === true && contact?.phone);
    if (explicit) return explicit.phone;
    const configured = contacts.some(contact => typeof contact?.[field] === 'boolean');
    return configured ? '' : contacts.find(contact => contact?.phone)?.phone || '';
}

function actionColumnLabel(status) {
    return membershipActionColumns.find(column => column.status === status)?.label || status;
}

function actionFind(id) {
    return currentMembershipActions.find(entry => String(entry.id) === String(id));
}

function actionFieldValue(card, selector, fallback = null) {
    const value = card?.querySelector(selector)?.value;
    return value === undefined ? fallback : value;
}

async function saveMembershipAction(id, overrides = {}, options = {}) {
    const card = document.querySelector(`[data-membership-action="${id}"]`);
    const item = actionFind(id);
    const body = {
        followUpStatus: overrides.followUpStatus
            || card?.dataset.status
            || item?.followUpStatus
            || 'new',
        followUpNote: overrides.followUpNote !== undefined
            ? overrides.followUpNote
            : actionFieldValue(card, '[data-field="note"]', item?.followUpNote || ''),
        followUpAt: overrides.followUpAt !== undefined
            ? overrides.followUpAt
            : actionFieldValue(card, '[data-field="followUpAt"]', actionDateInput(item?.followUpAt) || null),
        paymentPromiseDate: overrides.paymentPromiseDate !== undefined
            ? overrides.paymentPromiseDate
            : actionFieldValue(card, '[data-field="promiseDate"]', actionDateInput(item?.paymentPromiseDate) || null),
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
        if (!options.silent) toast.success(options.message || 'Результат контакта сохранён');
        invalidateCache('dashboard', 'membership-actions');
        if (typeof updateOperationalIndicators === 'function') {
            updateOperationalIndicators({ force: true });
        }
        await renderMembershipActions();
    } catch (error) {
        toast.error(error.message);
        await renderMembershipActions();
    }
}

async function moveMembershipAction(id, nextStatus) {
    const item = actionFind(id);
    if (!item || item.followUpStatus === nextStatus) return;

    const overrides = { followUpStatus: nextStatus };
    if (nextStatus === 'promised' && !item.paymentPromiseDate) {
        overrides.paymentPromiseDate = actionTomorrowInput();
    }

    await saveMembershipAction(id, overrides, {
        silent: false,
        message: `Перенесено: ${actionColumnLabel(nextStatus)}`,
    });
}

function setMembershipActionFilter(kind) {
    if (kind !== undefined) membershipActionKind = kind;
    renderMembershipActions();
}

function applyMembershipActionSearch() {
    membershipActionSearch = document.getElementById('membershipActionsSearch')?.value.trim() || '';
    renderMembershipActions();
}

async function renderMembershipActions() {
    const root = document.getElementById('membershipActionsRoot');
    if (!root) return;
    root.innerHTML = '<div class="ops-loading">Собираем очередь оплат...</div>';
    const params = new URLSearchParams({
        kind: membershipActionKind,
        followUpStatus: 'open',
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
        const debtCount = counts.debt || currentMembershipActions.filter(item => item.hasDebt).length;
        const renewalCount = counts.renewal || currentMembershipActions.filter(item => item.needsRenewal).length;

        root.innerHTML = `
            <div class="ops-command membership-actions-command ${currentMembershipActions.length ? '' : 'is-clear'}">
                <div class="ops-command-head">
                    <div>
                        <p class="ops-eyebrow">Контроль оплат</p>
                        <h3>Очередь оплат</h3>
                        <p>Одна карточка на ученика. Абонементы внутри карточки идут только как контекст.</p>
                    </div>
                    <span>${currentMembershipActions.length} в работе</span>
                </div>
                <div class="membership-actions-stats">
                    <button type="button" class="${membershipActionKind === 'all' ? 'active' : ''}" onclick="setMembershipActionFilter('all')">
                        <strong>${counts.open || currentMembershipActions.length}</strong><span>Все</span>
                    </button>
                    <button type="button" class="${membershipActionKind === 'debt' ? 'active' : ''}" onclick="setMembershipActionFilter('debt')">
                        <strong>${debtCount}</strong><span>Долг</span>
                    </button>
                    <button type="button" class="${membershipActionKind === 'renewal' ? 'active' : ''}" onclick="setMembershipActionFilter('renewal')">
                        <strong>${renewalCount}</strong><span>Низкий баланс</span>
                    </button>
                    <div class="membership-actions-search-wrap">
                        <input id="membershipActionsSearch" class="admin-input membership-actions-search" value="${actionEscape(membershipActionSearch)}" placeholder="Ученик или телефон" onkeydown="if(event.key==='Enter')applyMembershipActionSearch()">
                        <button type="button" onclick="applyMembershipActionSearch()">Найти</button>
                    </div>
                </div>
            </div>
            ${currentMembershipActions.length ? renderMembershipActionBoard(currentMembershipActions) : '<div class="ops-empty">Активных задач по оплатам сейчас нет</div>'}
        `;
        initMembershipActionBoardDnd(root);
    } catch (error) {
        root.innerHTML = `<div class="ops-empty is-error">${actionEscape(error.message)}</div>`;
    }
}

function renderMembershipActionBoard(actions) {
    return `
        <div class="membership-actions-board">
            ${membershipActionColumns.map(column => {
                const columnItems = actions.filter(item => item.followUpStatus === column.status);
                return `
                    <section class="membership-actions-column" data-action-drop-status="${column.status}">
                        <header>
                            <span>${column.label}</span>
                            <strong>${columnItems.length}</strong>
                        </header>
                        <div class="membership-actions-column-body">
                            ${columnItems.length
                                ? columnItems.map(renderMembershipActionCard).join('')
                                : '<div class="membership-actions-empty-column">Нет карточек</div>'}
                        </div>
                    </section>
                `;
            }).join('')}
        </div>
    `;
}

function renderMembershipActionCard(item) {
    const isDebt = Boolean(item.hasDebt || Number(item.remainingAmount) < 0);
    const lessonsLeft = Number(item.estimatedLessonsRemaining ?? item.classesRemaining);
    const lessonsText = Number.isFinite(lessonsLeft) ? `${lessonsLeft} ур.` : 'нет оценки';
    const balanceText = isDebt ? actionMoney(item.remainingAmount) : lessonsText;
    const balanceLabel = isDebt ? 'баланс' : 'остаток';
    const phone = item.student?.phone || '';

    return `
        <article class="membership-action-card status-${actionEscape(item.followUpStatus)} ${item.isOverduePromise ? 'is-overdue' : ''}"
            data-membership-action="${actionEscape(item.id)}"
            data-status="${actionEscape(item.followUpStatus)}"
            draggable="true">
            <div class="membership-action-card-top">
                <div class="membership-action-tags">
                    ${isDebt ? '<span class="is-debt">Долг</span>' : ''}
                    ${item.needsRenewal ? '<span class="is-renewal">Низкий баланс</span>' : ''}
                    ${item.isOverduePromise ? '<span class="is-overdue">Просрочено</span>' : ''}
                    ${Number(item.activeMembershipsCount || 0) > 1 ? `<span>${item.activeMembershipsCount} абон.</span>` : ''}
                </div>
                <div class="membership-action-balance">
                    <strong>${actionEscape(balanceText)}</strong>
                    <span>${balanceLabel}</span>
                </div>
            </div>

            <button type="button" class="membership-action-student" onclick="viewStudent('${actionEscape(item.studentId)}')">
                <strong>${actionEscape(item.studentName)}</strong>
                <span>${actionEscape(item.membershipSummary || item.group?.name || item.plan?.name || 'Абонемент')}</span>
            </button>

            <div class="membership-action-meta">
                <span>${actionEscape(phone || 'Телефон не указан')}</span>
                <span>Обещал: ${actionEscape(actionDateText(item.paymentPromiseDate))}</span>
            </div>

            <div class="membership-action-buttons">
                <button type="button" class="is-whatsapp" onclick="openMembershipActionWhatsapp('${actionEscape(item.id)}')">WhatsApp</button>
                <button type="button" onclick="openMembershipActionPayment('${actionEscape(item.id)}')">Платёж</button>
                <button type="button" onclick="viewStudent('${actionEscape(item.studentId)}')">Профиль</button>
            </div>

            <details class="membership-action-details">
                <summary>Контакт</summary>
                <div class="membership-action-form">
                    <label>Вернуться
                        <input class="admin-input" type="date" data-field="followUpAt" value="${actionDateInput(item.followUpAt)}">
                    </label>
                    <label>Дата оплаты
                        <input class="admin-input" type="date" data-field="promiseDate" value="${actionDateInput(item.paymentPromiseDate)}">
                    </label>
                    <label class="membership-action-note">Комментарий
                        <textarea class="admin-input" data-field="note" placeholder="Что обсудили">${actionEscape(item.followUpNote || '')}</textarea>
                    </label>
                    <button type="button" class="membership-action-save" onclick="saveMembershipAction('${actionEscape(item.id)}')">Сохранить</button>
                </div>
            </details>
        </article>
    `;
}

function initMembershipActionBoardDnd(root) {
    root.querySelectorAll('.membership-action-card').forEach(card => {
        card.addEventListener('dragstart', (event) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', card.dataset.membershipAction);
            card.classList.add('is-dragging');
        });
        card.addEventListener('dragend', () => {
            card.classList.remove('is-dragging');
            root.querySelectorAll('.membership-actions-column').forEach(column => column.classList.remove('is-drag-over'));
        });
    });

    root.querySelectorAll('[data-action-drop-status]').forEach(column => {
        column.addEventListener('dragover', (event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            column.classList.add('is-drag-over');
        });
        column.addEventListener('dragleave', () => {
            column.classList.remove('is-drag-over');
        });
        column.addEventListener('drop', async (event) => {
            event.preventDefault();
            column.classList.remove('is-drag-over');
            const id = event.dataTransfer.getData('text/plain');
            const status = column.dataset.actionDropStatus;
            await moveMembershipAction(id, status);
        });
    });
}

async function openMembershipActionPayment(id) {
    const item = actionFind(id);
    if (!item) {
        toast.error('Карточка не найдена');
        return;
    }
    if (typeof viewStudent !== 'function' || typeof openAddPaymentModal !== 'function') {
        toast.error('Форма платежа недоступна');
        return;
    }

    await viewStudent(item.studentId);
    window.setTimeout(() => openAddPaymentModal(), 220);
}

function openMembershipActionWhatsapp(id) {
    const item = actionFind(id);
    if (!item) {
        toast.error('Карточка не найдена');
        return;
    }
    const phone = actionPhoneLink(actionNotificationPhone(item.student, 'notifyPayments')).replace('https://wa.me/', '');
    if (!phone || phone === '#') {
        toast.error('У ученика не указан номер телефона');
        return;
    }

    const message = 'Здравствуйте! У вас подошла оплата по обучению. Когда сможете оплатить?';

    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
}

window.renderMembershipActions = renderMembershipActions;
window.setMembershipActionFilter = setMembershipActionFilter;
window.applyMembershipActionSearch = applyMembershipActionSearch;
window.saveMembershipAction = saveMembershipAction;
window.moveMembershipAction = moveMembershipAction;
window.openMembershipActionPayment = openMembershipActionPayment;
window.openMembershipActionWhatsapp = openMembershipActionWhatsapp;
