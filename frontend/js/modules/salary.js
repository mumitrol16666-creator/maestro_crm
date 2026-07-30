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
    accrualFilter: 'all',
    accrualsExpanded: false,
    operationsExpanded: false,
};

const SALARY_ACCRUALS_LIMIT = 10;
const SALARY_OPERATIONS_LIMIT = 8;
const SALARY_MANUAL_TYPES = ['payout', 'advance', 'bonus', 'penalty', 'legacy_payout'];
const SALARY_ACCRUAL_TYPES = [
    'lesson',
    'fixed_salary',
    'sales_commission',
    'first_payment_bonus',
    'lesson_penalty',
    'anomaly',
];

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

function salaryPlural(value, one, few, many) {
    const number = Math.abs(Number(value || 0));
    const lastTwo = number % 100;
    const last = number % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
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
        fixed_salary: 'Оклад',
        sales_commission: 'Процент с продаж',
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
    if (['fixed_salary', 'sales_commission'].includes(item.sourceType)) return 'banknote';
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
    salaryState.accrualsExpanded = false;
    salaryState.operationsExpanded = false;
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
    const employees = data.employees || data.teachers || [];
    renderSalarySummary(data.totals || {});
    renderSalaryTeachers(employees);
    renderSalaryAccruals(employees);
    renderSalaryOperations(employees);
    const title = document.getElementById('salaryMonthTitle');
    if (title) title.textContent = salaryMonthLabel(salaryState.month);
    const periodTitle = document.getElementById('salaryPeriodTitle');
    if (periodTitle) periodTitle.textContent = salaryPeriodLabel();
}

function renderSalarySummary(totals) {
    const container = document.getElementById('salarySummary');
    if (!container) return;
    const items = [
        { label: 'Оклады', value: totals.fixedSalary, suffix: 'money', tone: 'accent' },
        { label: 'За уроки', value: totals.lessonEarnings, suffix: 'money', tone: 'neutral' },
        { label: 'С продаж', value: totals.salesCommission, suffix: 'money', tone: 'positive' },
        { label: 'Премии', value: totals.bonuses, suffix: 'money', tone: 'positive' },
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

function renderSalaryTeachers(employees) {
    const body = document.getElementById('salaryRegisterBody');
    if (!body) return;
    if (!employees.length) {
        body.innerHTML = '<tr><td colspan="7" class="salary-empty">Сотрудники в ведомость пока не добавлены</td></tr>';
        return;
    }

    body.innerHTML = employees.map(employee => {
        const employeeId = employee.employeeId || employee.teacherId;
        const employeeName = employee.employeeName || employee.teacherName;
        const status = salaryStatusMeta(employee.status);
        const correction = Number(employee.bonuses || 0) - Number(employee.penalties || 0);
        const accrued = Number(employee.fixedSalary || 0)
            + Number(employee.lessonEarnings || 0)
            + Number(employee.salesCommission || 0);
        return `
            <tr class="salary-register-row">
                <td>
                    <button type="button" class="salary-teacher-link"
                            onclick="openSalaryDetails('${salaryEsc(employeeId)}')">
                        ${salaryEsc(employeeName)}
                    </button>
                    <small class="salary-position">${salaryEsc(employee.position || 'Сотрудник')}</small>
                    ${employee.anomalies > 0
                        ? `<span class="salary-row-warning">${salaryIcon('alert', 14)} ${employee.anomalies}</span>`
                        : ''}
                </td>
                <td>${Number(employee.lessons || 0)}</td>
                <td class="salary-money-cell">${salaryMoney(accrued)}</td>
                <td class="salary-correction ${correction > 0 ? 'is-positive' : correction < 0 ? 'is-negative' : ''}">
                    ${correction > 0 ? '+' : ''}${salaryMoney(correction)}
                </td>
                <td class="salary-money-cell">${salaryMoney(employee.paid)}</td>
                <td class="salary-due-cell">${salaryMoney(employee.due)}</td>
                <td>
                    <div class="salary-row-actions">
                        <span class="salary-status salary-status--${salaryEsc(employee.status)}">
                            ${salaryIcon(status.icon, 14)} ${salaryEsc(status.label)}
                        </span>
                        <button type="button" class="salary-icon-btn" title="Детализация"
                                onclick="openSalaryDetails('${salaryEsc(employeeId)}')">
                            ${salaryIcon('details')}
                        </button>
                        ${employee.due > 0 ? `
                            <button type="button" class="salary-icon-btn salary-icon-btn--pay" title="Выплатить"
                                    onclick="openSalaryOperation('payout', '${salaryEsc(employeeId)}')">
                                ${salaryIcon('banknote')}
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function salaryTimelineEntries(employees, allowedTypes) {
    return employees
        .flatMap(employee => (employee.timeline || [])
            .filter(item => allowedTypes.includes(item.sourceType))
            .map(item => ({
                ...item,
                employeeId: employee.employeeId || employee.teacherId,
                employeeName: employee.employeeName || employee.teacherName,
            })))
        .sort((a, b) => {
            const dateDifference = new Date(b.date) - new Date(a.date);
            if (dateDifference !== 0) return dateDifference;
            return String(b.time || '').localeCompare(String(a.time || ''));
        });
}

function salaryAccrualCategory(item) {
    if (item.sourceType === 'lesson') return 'lessons';
    if (['fixed_salary', 'sales_commission'].includes(item.sourceType)) return 'base';
    if (item.sourceType === 'first_payment_bonus') return 'bonuses';
    return 'attention';
}

function salaryDateKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'unknown';
    return date.toISOString().slice(0, 10);
}

function salaryDateHeading(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Дата не указана';
    return new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
        weekday: 'short',
    }).format(date).replace(/^./, char => char.toUpperCase());
}

function salaryRenderDateGroups(items, renderItem) {
    const groups = [];
    items.forEach(item => {
        const key = salaryDateKey(item.date);
        let group = groups.find(entry => entry.key === key);
        if (!group) {
            group = { key, date: item.date, items: [] };
            groups.push(group);
        }
        group.items.push(item);
    });
    return groups.map(group => `
        <div class="salary-history-group">
            <div class="salary-history-date">
                <span>${salaryEsc(salaryDateHeading(group.date))}</span>
                <b>${group.items.length}</b>
            </div>
            ${group.items.map(renderItem).join('')}
        </div>
    `).join('');
}

function salaryHistoryRow(item, { deletable = false } = {}) {
    const amount = Number(item.amount || 0);
    const detail = [item.employeeName, item.label, item.detail]
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index)
        .join(' · ');
    return `
        <div class="salary-history-row salary-history-row--${salaryEsc(item.sourceType)}">
            <div class="salary-history-icon salary-operation-icon--${salaryEsc(item.sourceType)}">
                ${salaryIcon(salaryTimelineIcon(item), 17)}
            </div>
            <div class="salary-history-main">
                <strong>${salaryEsc(salaryTimelineLabel(item))}</strong>
                <span>${salaryEsc(detail || 'Без комментария')}</span>
            </div>
            ${item.time ? `<time>${salaryEsc(item.time)}</time>` : '<time></time>'}
            <b class="${amount < 0 ? 'is-negative' : amount > 0 ? 'is-positive' : ''}">
                ${amount > 0 ? '+' : ''}${salaryMoney(amount)}
            </b>
            ${deletable && item.deletable !== false ? `
                <button type="button" class="salary-icon-btn salary-icon-btn--danger" title="Аннулировать"
                        onclick="voidSalaryOperation('${salaryEsc(item.id)}')">
                    ${salaryIcon('trash', 16)}
                </button>
            ` : '<span class="salary-history-row-spacer" aria-hidden="true"></span>'}
        </div>
    `;
}

function salaryListFooter(kind, total, shown, expanded) {
    if (total <= shown && !expanded) return '';
    const isAccruals = kind === 'accruals';
    const label = expanded ? 'Свернуть' : `Показать ещё ${total - shown}`;
    return `
        <div class="salary-history-footer">
            <span>Показано ${shown} из ${total}</span>
            <button type="button" class="salary-history-toggle"
                    onclick="toggleSalaryHistory('${isAccruals ? 'accruals' : 'operations'}')">
                ${salaryEsc(label)}
                ${salaryIcon(expanded ? 'previous' : 'next', 15)}
            </button>
        </div>
    `;
}

function renderSalaryAccruals(employees) {
    const list = document.getElementById('salaryAccrualsList');
    const filters = document.getElementById('salaryAccrualFilters');
    const meta = document.getElementById('salaryAccrualsMeta');
    if (!list || !filters || !meta) return;

    const accruals = salaryTimelineEntries(employees, SALARY_ACCRUAL_TYPES);
    const filterItems = [
        { key: 'all', label: 'Все', count: accruals.length },
        { key: 'lessons', label: 'Уроки', count: accruals.filter(item => salaryAccrualCategory(item) === 'lessons').length },
        { key: 'base', label: 'Оклад и продажи', count: accruals.filter(item => salaryAccrualCategory(item) === 'base').length },
        { key: 'bonuses', label: 'Автобонусы', count: accruals.filter(item => salaryAccrualCategory(item) === 'bonuses').length },
        { key: 'attention', label: 'Корректировки', count: accruals.filter(item => salaryAccrualCategory(item) === 'attention').length },
    ];
    if (!filterItems.some(item => item.key === salaryState.accrualFilter && item.count > 0)) {
        salaryState.accrualFilter = 'all';
    }

    const filtered = salaryState.accrualFilter === 'all'
        ? accruals
        : accruals.filter(item => salaryAccrualCategory(item) === salaryState.accrualFilter);
    const amount = filtered.reduce((total, item) => total + Number(item.amount || 0), 0);
    const shownItems = salaryState.accrualsExpanded
        ? filtered
        : filtered.slice(0, SALARY_ACCRUALS_LIMIT);

    meta.innerHTML = `
        <strong>${salaryMoney(amount)}</strong>
        <span>${filtered.length} ${salaryPlural(filtered.length, 'запись', 'записи', 'записей')}</span>
    `;
    filters.innerHTML = filterItems
        .filter(item => item.key === 'all' || item.count > 0)
        .map(item => `
            <button type="button" class="${item.key === salaryState.accrualFilter ? 'is-active' : ''}"
                    onclick="setSalaryAccrualFilter('${salaryEsc(item.key)}')">
                ${salaryEsc(item.label)} <span>${item.count}</span>
            </button>
        `).join('');

    if (!filtered.length) {
        list.innerHTML = '<div class="salary-empty">За выбранный период автоматических начислений нет</div>';
        return;
    }

    list.innerHTML = `
        ${salaryRenderDateGroups(shownItems, item => salaryHistoryRow(item))}
        ${salaryListFooter(
        'accruals',
        filtered.length,
        shownItems.length,
        salaryState.accrualsExpanded,
    )}
    `;
}

function renderSalaryOperations(employees) {
    const list = document.getElementById('salaryOperationsList');
    const meta = document.getElementById('salaryOperationsMeta');
    const summary = document.getElementById('salaryOperationsSummary');
    if (!list || !meta || !summary) return;
    const operations = salaryTimelineEntries(employees, SALARY_MANUAL_TYPES);
    const totalPaid = operations
        .filter(item => ['payout', 'advance', 'legacy_payout'].includes(item.sourceType))
        .reduce((total, item) => total + Math.abs(Number(item.amount || 0)), 0);
    const adjustments = operations
        .filter(item => ['bonus', 'penalty'].includes(item.sourceType))
        .reduce((total, item) => total + Number(item.amount || 0), 0);

    meta.innerHTML = `
        <strong>${operations.length}</strong>
        <span>${salaryPlural(operations.length, 'операция', 'операции', 'операций')}</span>
    `;
    summary.innerHTML = `
        <div>
            <span>Выплаты и авансы</span>
            <b>${salaryMoney(totalPaid)}</b>
        </div>
        <div>
            <span>Корректировки</span>
            <b class="${adjustments < 0 ? 'is-negative' : adjustments > 0 ? 'is-positive' : ''}">
                ${adjustments > 0 ? '+' : ''}${salaryMoney(adjustments)}
            </b>
        </div>
    `;

    if (!operations.length) {
        list.innerHTML = '<div class="salary-empty">За выбранный период ручных операций нет</div>';
        return;
    }

    const shownItems = salaryState.operationsExpanded
        ? operations
        : operations.slice(0, SALARY_OPERATIONS_LIMIT);
    list.innerHTML = `
        ${salaryRenderDateGroups(shownItems, item => salaryHistoryRow(item, { deletable: true }))}
        ${salaryListFooter(
        'operations',
        operations.length,
        shownItems.length,
        salaryState.operationsExpanded,
    )}
    `;
}

function setSalaryAccrualFilter(filter) {
    salaryState.accrualFilter = filter;
    salaryState.accrualsExpanded = false;
    const employees = salaryState.data?.employees || salaryState.data?.teachers || [];
    renderSalaryAccruals(employees);
}

function toggleSalaryHistory(kind) {
    if (kind === 'accruals') {
        salaryState.accrualsExpanded = !salaryState.accrualsExpanded;
    } else {
        salaryState.operationsExpanded = !salaryState.operationsExpanded;
    }
    const employees = salaryState.data?.employees || salaryState.data?.teachers || [];
    if (kind === 'accruals') renderSalaryAccruals(employees);
    else renderSalaryOperations(employees);
}

function openSalaryDetails(employeeId) {
    const employees = salaryState.data?.employees || salaryState.data?.teachers || [];
    const employee = employees.find(item => (item.employeeId || item.teacherId) === employeeId);
    if (!employee) return;
    document.getElementById('salaryDetailsModal')?.remove();

    const status = salaryStatusMeta(employee.status);
    const employeeName = employee.employeeName || employee.teacherName;
    const accrued = Number(employee.fixedSalary || 0)
        + Number(employee.lessonEarnings || 0)
        + Number(employee.salesCommission || 0)
        + Number(employee.bonuses || 0)
        - Number(employee.penalties || 0);
    const modal = document.createElement('div');
    modal.className = 'modal show salary-modal';
    modal.id = 'salaryDetailsModal';
    modal.innerHTML = `
        <div class="modal-overlay" data-salary-close></div>
        <div class="modal-content salary-detail-dialog">
            <header class="salary-modal-header">
                <div>
                    <span>${salaryEsc(salaryPeriodLabel())}</span>
                    <h3>${salaryEsc(employeeName)}</h3>
                    <small>${salaryEsc(employee.position || 'Сотрудник')}</small>
                </div>
                <button type="button" class="salary-icon-btn" title="Закрыть" data-salary-close>
                    ${salaryIcon('close', 20)}
                </button>
            </header>

            <div class="salary-detail-summary">
                <div><span>Уроки</span><strong>${employee.lessons}</strong></div>
                <div><span>Начислено</span><strong>${salaryMoney(accrued)}</strong></div>
                <div><span>Выплачено</span><strong>${salaryMoney(employee.paid)}</strong></div>
                <div class="is-due"><span>Остаток</span><strong>${salaryMoney(employee.due)}</strong></div>
            </div>

            <div class="salary-detail-ledger">
                ${(employee.timeline || []).length
                    ? employee.timeline.map(item => renderSalaryTimelineItem(item)).join('')
                    : '<div class="salary-empty">За этот месяц операций нет</div>'}
            </div>

            <footer class="salary-modal-footer">
                <span class="salary-status salary-status--${salaryEsc(employee.status)}">
                    ${salaryIcon(status.icon, 14)} ${salaryEsc(status.label)}
                </span>
                <div>
                    <button type="button" class="btn-secondary"
                            onclick="openSalaryOperation('bonus', '${salaryEsc(employeeId)}')">
                        ${salaryIcon('plus', 16)} Премия
                    </button>
                    <button type="button" class="btn-secondary"
                            onclick="openSalaryOperation('penalty', '${salaryEsc(employeeId)}')">
                        ${salaryIcon('minus', 16)} Штраф
                    </button>
                    ${employee.due > 0 ? `
                        <button type="button" class="btn-primary"
                                onclick="openSalaryOperation('payout', '${salaryEsc(employeeId)}')">
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

function openSalaryOperation(type, employeeId = '') {
    if (salaryState.mode !== 'month') {
        salaryNotify('Для выплаты или корректировки переключитесь в режим месяца', 'error');
        return;
    }
    const employees = salaryState.data?.employees || salaryState.data?.teachers || [];
    const selectedEmployee = employees.find(
        item => (item.employeeId || item.teacherId) === employeeId,
    );
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
                <span>Сотрудник</span>
                <select class="admin-input" name="employeeId" required>
                    <option value="">Выберите сотрудника</option>
                    ${employees.map(employee => {
                        const optionId = employee.employeeId || employee.teacherId;
                        const optionName = employee.employeeName || employee.teacherName;
                        return `
                        <option value="${salaryEsc(optionId)}" data-due="${Number(employee.due || 0)}"
                                ${optionId === employeeId ? 'selected' : ''}>
                            ${salaryEsc(optionName)} · ${salaryEsc(employee.position || 'Сотрудник')}
                        </option>
                    `; }).join('')}
                </select>
            </label>
            <div class="salary-form-grid">
                <label class="salary-form-field">
                    <span>Сумма</span>
                    <input class="admin-input" type="number" name="amount" min="1" step="1"
                           value="${type === 'payout' && selectedEmployee ? selectedEmployee.due : ''}" required>
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
                        ${typeof renderPaymentMethodOptions === 'function'
                            ? renderPaymentMethodOptions('', { emptyLabel: 'Выберите счёт' })
                            : '<option value="">Выберите счёт</option>'}
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
    if (type === 'payout') {
        modal.querySelector('[name="employeeId"]')?.addEventListener('change', event => {
            const amountInput = modal.querySelector('[name="amount"]');
            if (amountInput) amountInput.value = event.target.selectedOptions[0]?.dataset.due || '';
        });
    }
    if (affectsCashbox && typeof loadPaymentAccountBalances === 'function') {
        void loadPaymentAccountBalances({ force: true });
    }
}

async function createSalaryOperation(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    const payload = {
        employeeId: formData.get('employeeId'),
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
        setTimeout(() => document.querySelector('.filter-btn[data-role="all"]')?.click(), 120);
    }
}

window.initSalaryModule = initSalaryModule;
window.openSalaryDetails = openSalaryDetails;
window.openSalaryOperation = openSalaryOperation;
window.voidSalaryOperation = voidSalaryOperation;
window.openTeachersFromSalary = openTeachersFromSalary;
window.setSalaryAccrualFilter = setSalaryAccrualFilter;
window.toggleSalaryHistory = toggleSalaryHistory;
