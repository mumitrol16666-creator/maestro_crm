// =====================================================
// SALARY MODULE - monthly accrual and payment register
// =====================================================

const salaryState = {
    month: '',
    mode: 'month',
    startDate: '',
    endDate: '',
    data: null,
    loading: false,
    reloadPending: false,
    initialized: false,
};

function salaryEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[char]));
}

function salaryMoney(value) {
    return `${Number(value || 0).toLocaleString('ru-RU')} ₸`;
}

function salaryIcon(name, size = 18) {
    const paths = {
        previous: '<path d="m15 18-6-6 6-6"/>',
        next: '<path d="m9 18 6-6-6-6"/>',
        refresh: '<path d="M20 6v6h-6"/><path d="M4 18v-6h6"/><path d="M18.5 9A7 7 0 0 0 6.2 6.2L4 9m16 6-2.2 2.8A7 7 0 0 1 5.5 15"/>',
        users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
        banknote: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 10h.01M18 14h.01"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        minus: '<path d="M5 12h14"/>',
        receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z"/><path d="M8 9h8M8 13h6"/>',
        details: '<path d="M3 5h18M3 12h18M3 19h18"/><circle cx="7" cy="5" r="1"/><circle cx="7" cy="12" r="1"/><circle cx="7" cy="19" r="1"/>',
        trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/>',
        close: '<path d="M18 6 6 18M6 6l12 12"/>',
        calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
        alert: '<path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
        check: '<path d="m5 12 4 4L19 6"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    };
    return `
        <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
             aria-hidden="true">${paths[name] || paths.details}</svg>
    `;
}

function salaryCurrentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function salaryMonthLabel(month) {
    const [year, monthNumber] = String(month).split('-').map(Number);
    if (!year || !monthNumber) return month;
    const label = new Intl.DateTimeFormat('ru-RU', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
    return label.charAt(0).toUpperCase() + label.slice(1);
}

function salaryDefaultPeriod(month) {
    const [year, monthNumber] = month.split('-').map(Number);
    const lastDay = new Date(year, monthNumber, 0).getDate();
    return {
        startDate: `${year}-${String(monthNumber).padStart(2, '0')}-01`,
        endDate: `${year}-${String(monthNumber).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    };
}

function salaryPeriodLabel() {
    if (salaryState.mode === 'month') return salaryMonthLabel(salaryState.month);
    const start = new Date(`${salaryState.startDate}T12:00:00`);
    const end = new Date(`${salaryState.endDate}T12:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Выбранный период';
    return `${start.toLocaleDateString('ru-RU')} - ${end.toLocaleDateString('ru-RU')}`;
}

function salaryShiftMonth(offset) {
    const [year, month] = salaryState.month.split('-').map(Number);
    const next = new Date(year, month - 1 + offset, 1);
    salaryState.month = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    const input = document.getElementById('salaryMonthInput');
    if (input) input.value = salaryState.month;
    loadSalaryRegister();
}

function setSalaryMode(mode) {
    salaryState.mode = mode === 'period' ? 'period' : 'month';
    document.querySelectorAll('[data-salary-mode]').forEach(button => {
        button.classList.toggle('is-active', button.dataset.salaryMode === salaryState.mode);
    });
    document.getElementById('salaryMonthControl')?.classList.toggle('hidden', salaryState.mode !== 'month');
    document.getElementById('salaryPeriodControl')?.classList.toggle('hidden', salaryState.mode !== 'period');
    document.querySelectorAll('[data-salary-operation]').forEach(button => {
        button.disabled = salaryState.mode === 'period';
        button.title = salaryState.mode === 'period'
            ? 'Операции создаются в режиме месяца'
            : '';
    });
    loadSalaryRegister();
}

function salaryNotify(message, type = 'success') {
    if (typeof toast !== 'undefined' && typeof toast[type] === 'function') {
        toast[type](message);
        return;
    }
    alert(message);
}

function salaryStatusMeta(status) {
    const statuses = {
        accruing: { label: 'Начисляется', icon: 'clock' },
        unpaid: { label: 'К выплате', icon: 'banknote' },
        partial: { label: 'Частично', icon: 'clock' },
        paid: { label: 'Выплачено', icon: 'check' },
        attention: { label: 'Проверить', icon: 'alert' },
    };
    return statuses[status] || statuses.accruing;
}

function salaryOperationLabel(type) {
    return {
        payout: 'Выплата',
        advance: 'Аванс',
        bonus: 'Премия',
        penalty: 'Штраф',
    }[type] || 'Операция';
}

function salaryTimelineLabel(item) {
    return {
        lesson: item.classType === 'trial'
            ? 'Пробный урок'
            : item.classType === 'group'
                ? 'Групповой урок'
                : item.classType === 'individual'
                    ? 'Индивидуальный урок'
                    : 'Урок',
        first_payment_bonus: 'Бонус за первый платеж',
        lesson_penalty: 'Штраф по уроку',
        bonus: 'Премия',
        penalty: 'Штраф',
        payout: 'Выплата',
        advance: 'Аванс',
        legacy_payout: 'Выплата по старой ведомости',
        anomaly: 'Требует проверки',
    }[item.sourceType] || item.label || 'Операция';
}

function salaryTimelineIcon(item) {
    if (item.sourceType === 'lesson') return 'calendar';
    if (item.sourceType === 'anomaly') return 'alert';
    if (['payout', 'advance', 'legacy_payout'].includes(item.sourceType)) return 'banknote';
    if (['penalty', 'lesson_penalty'].includes(item.sourceType)) return 'minus';
    return 'plus';
}

function initSalaryModule() {
    salaryState.month = salaryState.month || salaryCurrentMonth();
    if (!salaryState.startDate || !salaryState.endDate) {
        Object.assign(salaryState, salaryDefaultPeriod(salaryState.month));
    }
    const monthInput = document.getElementById('salaryMonthInput');
    if (monthInput) monthInput.value = salaryState.month;
    const startInput = document.getElementById('salaryPeriodStart');
    const endInput = document.getElementById('salaryPeriodEnd');
    if (startInput) startInput.value = salaryState.startDate;
    if (endInput) endInput.value = salaryState.endDate;

    if (!salaryState.initialized) {
        document.getElementById('salaryMonthPrevious')?.addEventListener('click', () => salaryShiftMonth(-1));
        document.getElementById('salaryMonthNext')?.addEventListener('click', () => salaryShiftMonth(1));
        document.getElementById('salaryRefreshBtn')?.addEventListener('click', loadSalaryRegister);
        document.getElementById('salaryMonthInput')?.addEventListener('change', event => {
            if (!event.target.value) return;
            salaryState.month = event.target.value;
            loadSalaryRegister();
        });
        document.querySelectorAll('[data-salary-mode]').forEach(button => {
            button.addEventListener('click', () => setSalaryMode(button.dataset.salaryMode));
        });
        document.getElementById('salaryPeriodStart')?.addEventListener('change', event => {
            salaryState.startDate = event.target.value;
            if (salaryState.startDate && salaryState.endDate) loadSalaryRegister();
        });
        document.getElementById('salaryPeriodEnd')?.addEventListener('change', event => {
            salaryState.endDate = event.target.value;
            if (salaryState.startDate && salaryState.endDate) loadSalaryRegister();
        });
        salaryState.initialized = true;
    }

    setSalaryMode(salaryState.mode);
}

async function loadSalaryRegister() {
    if (salaryState.loading) {
        salaryState.reloadPending = true;
        return;
    }
    salaryState.loading = true;
    const body = document.getElementById('salaryRegisterBody');
    if (body) {
        body.innerHTML = `
            <tr><td colspan="7" class="salary-empty">
                <span class="salary-spinner"></span> Собираем начисления...
            </td></tr>
        `;
    }

    try {
        const endpoint = salaryState.mode === 'period'
            ? `/salary/report?startDate=${encodeURIComponent(salaryState.startDate)}&endDate=${encodeURIComponent(salaryState.endDate)}`
            : `/salary/monthly?month=${encodeURIComponent(salaryState.month)}`;
        const response = await fetch(`${API_URL}${endpoint}`, {
            headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Не удалось загрузить зарплаты');
        }
        if (!salaryState.reloadPending) {
            salaryState.data = data;
            renderSalaryRegister();
        }
    } catch (error) {
        console.error('Salary register load error:', error);
        if (body) {
            body.innerHTML = `
                <tr><td colspan="7" class="salary-empty salary-empty--error">
                    Не удалось загрузить реестр: ${salaryEsc(error.message)}
                </td></tr>
            `;
        }
    } finally {
        salaryState.loading = false;
        if (salaryState.reloadPending) {
            salaryState.reloadPending = false;
            loadSalaryRegister();
        }
    }
}

function renderSalaryRegister() {
    const data = salaryState.data || {};
    renderSalarySummary(data.totals || {});
    renderSalaryTeachers(data.teachers || []);
    renderSalaryOperations(data.teachers || []);
    const title = document.getElementById('salaryMonthTitle');
    if (title) title.textContent = salaryMonthLabel(salaryState.month);
    const periodTitle = document.getElementById('salaryPeriodTitle');
    if (periodTitle) periodTitle.textContent = salaryPeriodLabel();
}

function renderSalarySummary(totals) {
    const container = document.getElementById('salarySummary');
    if (!container) return;
    const accrued = Number(totals.lessonEarnings || 0) + Number(totals.bonuses || 0);
    const items = [
        { label: 'Уроки', value: Number(totals.lessons || 0), suffix: '', tone: 'neutral' },
        { label: 'Начислено', value: accrued, suffix: 'money', tone: 'accent' },
        { label: 'Премии', value: totals.bonuses, suffix: 'money', tone: 'positive' },
        { label: 'Штрафы', value: totals.penalties, suffix: 'money', tone: 'negative' },
        { label: 'Выплачено', value: totals.paid, suffix: 'money', tone: 'neutral' },
        { label: 'Остаток', value: totals.due, suffix: 'money', tone: 'due' },
    ];
    container.innerHTML = items.map(item => `
        <div class="salary-stat salary-stat--${item.tone}">
            <span>${salaryEsc(item.label)}</span>
            <strong>${item.suffix === 'money' ? salaryMoney(item.value) : Number(item.value || 0)}</strong>
        </div>
    `).join('');
}

function renderSalaryTeachers(teachers) {
    const body = document.getElementById('salaryRegisterBody');
    if (!body) return;
    if (!teachers.length) {
        body.innerHTML = '<tr><td colspan="7" class="salary-empty">Преподавателей пока нет</td></tr>';
        return;
    }

    body.innerHTML = teachers.map(teacher => {
        const status = salaryStatusMeta(teacher.status);
        const correction = Number(teacher.bonuses || 0) - Number(teacher.penalties || 0);
        return `
            <tr class="salary-register-row">
                <td>
                    <button type="button" class="salary-teacher-link"
                            onclick="openSalaryDetails('${salaryEsc(teacher.teacherId)}')">
                        ${salaryEsc(teacher.teacherName)}
                    </button>
                    ${teacher.anomalies > 0
                        ? `<span class="salary-row-warning">${salaryIcon('alert', 14)} ${teacher.anomalies}</span>`
                        : ''}
                </td>
                <td>${Number(teacher.lessons || 0)}</td>
                <td class="salary-money-cell">${salaryMoney(teacher.lessonEarnings)}</td>
                <td class="salary-correction ${correction > 0 ? 'is-positive' : correction < 0 ? 'is-negative' : ''}">
                    ${correction > 0 ? '+' : ''}${salaryMoney(correction)}
                </td>
                <td class="salary-money-cell">${salaryMoney(teacher.paid)}</td>
                <td class="salary-due-cell">${salaryMoney(teacher.due)}</td>
                <td>
                    <div class="salary-row-actions">
                        <span class="salary-status salary-status--${salaryEsc(teacher.status)}">
                            ${salaryIcon(status.icon, 14)} ${salaryEsc(status.label)}
                        </span>
                        <button type="button" class="salary-icon-btn" title="Детализация"
                                onclick="openSalaryDetails('${salaryEsc(teacher.teacherId)}')">
                            ${salaryIcon('details')}
                        </button>
                        ${teacher.due > 0 ? `
                            <button type="button" class="salary-icon-btn salary-icon-btn--pay" title="Выплатить"
                                    onclick="openSalaryOperation('payout', '${salaryEsc(teacher.teacherId)}')">
                                ${salaryIcon('banknote')}
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderSalaryOperations(teachers) {
    const list = document.getElementById('salaryOperationsList');
    if (!list) return;
    const operations = teachers
        .flatMap(teacher => (teacher.timeline || [])
            .filter(item => ['payout', 'advance', 'bonus', 'penalty'].includes(item.sourceType))
            .map(item => ({ ...item, teacherName: teacher.teacherName })))
        .sort((a, b) => new Date(b.date) - new Date(a.date));

    if (!operations.length) {
        list.innerHTML = '<div class="salary-empty">В этом месяце ручных операций нет</div>';
        return;
    }

    list.innerHTML = operations.map(item => `
        <div class="salary-operation-row">
            <div class="salary-operation-icon salary-operation-icon--${salaryEsc(item.sourceType)}">
                ${salaryIcon(salaryTimelineIcon(item))}
            </div>
            <div class="salary-operation-main">
                <strong>${salaryEsc(salaryTimelineLabel(item))}</strong>
                <span>${salaryEsc(item.teacherName)} · ${salaryEsc(item.label || '')}</span>
            </div>
            <time>${new Date(item.date).toLocaleDateString('ru-RU')}</time>
            <b class="${Number(item.amount) < 0 ? 'is-negative' : 'is-positive'}">
                ${Number(item.amount) > 0 ? '+' : ''}${salaryMoney(item.amount)}
            </b>
            <button type="button" class="salary-icon-btn salary-icon-btn--danger" title="Аннулировать"
                    onclick="voidSalaryOperation('${salaryEsc(item.id)}')">
                ${salaryIcon('trash', 17)}
            </button>
        </div>
    `).join('');
}

function openSalaryDetails(teacherId) {
    const teacher = salaryState.data?.teachers?.find(item => item.teacherId === teacherId);
    if (!teacher) return;
    document.getElementById('salaryDetailsModal')?.remove();

    const status = salaryStatusMeta(teacher.status);
    const modal = document.createElement('div');
    modal.className = 'modal show salary-modal';
    modal.id = 'salaryDetailsModal';
    modal.innerHTML = `
        <div class="modal-overlay" data-salary-close></div>
        <div class="modal-content salary-detail-dialog">
            <header class="salary-modal-header">
                <div>
                    <span>${salaryEsc(salaryPeriodLabel())}</span>
                    <h3>${salaryEsc(teacher.teacherName)}</h3>
                </div>
                <button type="button" class="salary-icon-btn" title="Закрыть" data-salary-close>
                    ${salaryIcon('close', 20)}
                </button>
            </header>

            <div class="salary-detail-summary">
                <div><span>Уроки</span><strong>${teacher.lessons}</strong></div>
                <div><span>Начислено</span><strong>${salaryMoney(teacher.lessonEarnings + teacher.bonuses)}</strong></div>
                <div><span>Выплачено</span><strong>${salaryMoney(teacher.paid)}</strong></div>
                <div class="is-due"><span>Остаток</span><strong>${salaryMoney(teacher.due)}</strong></div>
            </div>

            <div class="salary-detail-ledger">
                ${(teacher.timeline || []).length
                    ? teacher.timeline.map(item => renderSalaryTimelineItem(item)).join('')
                    : '<div class="salary-empty">За этот месяц операций нет</div>'}
            </div>

            <footer class="salary-modal-footer">
                <span class="salary-status salary-status--${salaryEsc(teacher.status)}">
                    ${salaryIcon(status.icon, 14)} ${salaryEsc(status.label)}
                </span>
                <div>
                    <button type="button" class="btn-secondary"
                            onclick="openSalaryOperation('bonus', '${salaryEsc(teacher.teacherId)}')">
                        ${salaryIcon('plus', 16)} Премия
                    </button>
                    <button type="button" class="btn-secondary"
                            onclick="openSalaryOperation('penalty', '${salaryEsc(teacher.teacherId)}')">
                        ${salaryIcon('minus', 16)} Штраф
                    </button>
                    ${teacher.due > 0 ? `
                        <button type="button" class="btn-primary"
                                onclick="openSalaryOperation('payout', '${salaryEsc(teacher.teacherId)}')">
                            ${salaryIcon('banknote', 16)} Выплатить
                        </button>
                    ` : ''}
                </div>
            </footer>
        </div>
    `;
    modal.querySelectorAll('[data-salary-close]').forEach(element => {
        element.addEventListener('click', () => modal.remove());
    });
    document.body.appendChild(modal);
}

function renderSalaryTimelineItem(item) {
    const amount = Number(item.amount || 0);
    const date = new Date(item.date);
    const detail = [item.time, item.detail].filter(Boolean).join(' · ');
    return `
        <div class="salary-ledger-row salary-ledger-row--${salaryEsc(item.sourceType)}">
            <div class="salary-ledger-icon">${salaryIcon(salaryTimelineIcon(item), 17)}</div>
            <div class="salary-ledger-copy">
                <strong>${salaryEsc(salaryTimelineLabel(item))}</strong>
                <span>${salaryEsc(item.label || '')}${detail ? ` · ${salaryEsc(detail)}` : ''}</span>
            </div>
            <time>${date.toLocaleDateString('ru-RU')}</time>
            <b class="${amount < 0 ? 'is-negative' : amount > 0 ? 'is-positive' : ''}">
                ${amount > 0 ? '+' : ''}${salaryMoney(amount)}
            </b>
            ${item.deletable ? `
                <button type="button" class="salary-icon-btn salary-icon-btn--danger" title="Аннулировать"
                        onclick="voidSalaryOperation('${salaryEsc(item.id)}')">
                    ${salaryIcon('trash', 16)}
                </button>
            ` : '<span></span>'}
        </div>
    `;
}

function openSalaryOperation(type, teacherId = '') {
    if (salaryState.mode !== 'month') {
        salaryNotify('Для выплаты или корректировки переключитесь в режим месяца', 'error');
        return;
    }
    const teachers = salaryState.data?.teachers || [];
    const selectedTeacher = teachers.find(item => item.teacherId === teacherId);
    const operationLabel = salaryOperationLabel(type);
    const isAdjustment = ['bonus', 'penalty'].includes(type);
    const affectsCashbox = ['payout', 'advance'].includes(type);
    const today = new Date();
    const dateValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    document.getElementById('salaryOperationModal')?.remove();

    const modal = document.createElement('div');
    modal.className = 'modal show salary-modal';
    modal.id = 'salaryOperationModal';
    modal.innerHTML = `
        <div class="modal-overlay" data-salary-close></div>
        <form class="modal-content salary-operation-dialog" id="salaryOperationForm">
            <header class="salary-modal-header">
                <div>
                    <span>${salaryEsc(salaryMonthLabel(salaryState.month))}</span>
                    <h3>${salaryEsc(operationLabel)}</h3>
                </div>
                <button type="button" class="salary-icon-btn" title="Закрыть" data-salary-close>
                    ${salaryIcon('close', 20)}
                </button>
            </header>

            <input type="hidden" name="type" value="${salaryEsc(type)}">
            <label class="salary-form-field">
                <span>Преподаватель</span>
                <select class="admin-input" name="teacherId" required>
                    <option value="">Выберите преподавателя</option>
                    ${teachers.map(teacher => `
                        <option value="${salaryEsc(teacher.teacherId)}"
                                ${teacher.teacherId === teacherId ? 'selected' : ''}>
                            ${salaryEsc(teacher.teacherName)}
                        </option>
                    `).join('')}
                </select>
            </label>
            <div class="salary-form-grid">
                <label class="salary-form-field">
                    <span>Сумма</span>
                    <input class="admin-input" type="number" name="amount" min="1" step="1"
                           value="${type === 'payout' && selectedTeacher ? selectedTeacher.due : ''}" required>
                </label>
                <label class="salary-form-field">
                    <span>Дата</span>
                    <input class="admin-input" type="date" name="date" value="${dateValue}" required>
                </label>
            </div>
            ${affectsCashbox ? `
                <label class="salary-form-field">
                    <span>Счёт списания</span>
                    <select class="admin-input" name="paymentMethod" required>
                        <option value="">Выберите счёт</option>
                        <option value="kaspi">Каспи</option>
                        <option value="cash">Наличные</option>
                        <option value="kaspi_pay">КаспиПей</option>
                        <option value="freedom">Фридом</option>
                        <option value="halyk">Халык Банк</option>
                    </select>
                </label>
            ` : ''}
            <label class="salary-form-field">
                <span>${isAdjustment ? 'Причина' : 'Комментарий'}</span>
                <textarea class="admin-input" name="description" rows="3"
                          placeholder="${type === 'bonus'
        ? 'Например: премия за результат месяца'
        : type === 'penalty'
            ? 'Например: опоздание на урок'
            : 'Необязательно'}"
                          ${isAdjustment ? 'required' : ''}></textarea>
            </label>
            <footer class="salary-modal-footer">
                <span>Операция попадет в ${salaryEsc(salaryMonthLabel(salaryState.month))}</span>
                <button type="submit" class="btn-primary">
                    ${salaryIcon(type === 'penalty' ? 'minus' : type === 'payout' || type === 'advance' ? 'banknote' : 'plus', 16)}
                    Сохранить
                </button>
            </footer>
        </form>
    `;
    modal.querySelectorAll('[data-salary-close]').forEach(element => {
        element.addEventListener('click', () => modal.remove());
    });
    modal.querySelector('form').addEventListener('submit', createSalaryOperation);
    document.body.appendChild(modal);
}

async function createSalaryOperation(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    const payload = {
        teacherId: formData.get('teacherId'),
        type: formData.get('type'),
        amount: Number(formData.get('amount')),
        date: formData.get('date'),
        description: String(formData.get('description') || '').trim(),
        paymentMethod: formData.get('paymentMethod') || null,
        periodKey: salaryState.month,
    };

    try {
        submit.disabled = true;
        const response = await fetch(`${API_URL}/salary/operations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${getAuthToken()}`,
            },
            body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Не удалось сохранить операцию');
        }
        form.closest('.modal')?.remove();
        document.getElementById('salaryDetailsModal')?.remove();
        salaryNotify(data.message || 'Операция сохранена');
        await loadSalaryRegister();
    } catch (error) {
        salaryNotify(error.message, 'error');
    } finally {
        submit.disabled = false;
    }
}

async function voidSalaryOperation(operationId) {
    const reason = prompt('Причина аннулирования операции:');
    if (reason === null) return;
    if (!reason.trim()) {
        salaryNotify('Укажите причину аннулирования', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/salary/operations/${encodeURIComponent(operationId)}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${getAuthToken()}`,
            },
            body: JSON.stringify({ reason: reason.trim() }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Не удалось аннулировать операцию');
        }
        document.getElementById('salaryDetailsModal')?.remove();
        salaryNotify(data.message || 'Операция аннулирована');
        await loadSalaryRegister();
    } catch (error) {
        salaryNotify(error.message, 'error');
    }
}

function openTeachersFromSalary() {
    const usersLink = document.querySelector('.sidebar-link[data-section="users"]');
    if (usersLink) {
        usersLink.click();
        setTimeout(() => document.querySelector('.filter-btn[data-role="teacher"]')?.click(), 120);
    }
}

window.initSalaryModule = initSalaryModule;
window.openSalaryDetails = openSalaryDetails;
window.openSalaryOperation = openSalaryOperation;
window.voidSalaryOperation = voidSalaryOperation;
window.openTeachersFromSalary = openTeachersFromSalary;
