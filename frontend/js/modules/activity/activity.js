// =====================================================
// ACTIVITY LOGS MODULE - Журнал действий
// =====================================================
console.log('✅ activity.js загружен!');

let currentActivityPage = 1;
let activityTotalPages = 1;
const activityPerPage = 50;
let activitySearch = '';

// Подписи для типов сущностей (с учётом старого формата из БД)
const ACTIVITY_ENTITY_LABELS = {
    Booking: 'Заявка', bookings: 'Заявка',
    Student: 'Ученик', students: 'Ученик',
    User: 'Пользователь', users: 'Пользователь',
    Group: 'Группа', groups: 'Группа',
    Payment: 'Платёж', payments: 'Платёж',
    Membership: 'Абонемент', memberships: 'Абонемент',
    Family: 'Семья', families: 'Семья',
    Direction: 'Направление', directions: 'Направление',
    Attendance: 'Посещаемость', attendance: 'Посещаемость',
    Rental: 'Аренда', rentals: 'Аренда',
    ActivityLog: 'Журнал', 'activity-logs': 'Журнал',
    Admin: 'Админ', admin: 'Админ',
    WhatsAppReminder: 'Рассылка',
    Schedule: 'Расписание', schedule: 'Расписание',
    Freeze: 'Заморозка', freezes: 'Заморозка',
    Room: 'Кабинет', rooms: 'Кабинет',
};

const ACTIVITY_ACTION_LABELS = {
    create: { text: 'Создание', color: '#10b981' },
    update: { text: 'Изменение', color: '#f59e0b' },
    delete: { text: 'УДАЛЕНИЕ', color: '#dc3545', bold: true },
    freeze: { text: 'Заморозка', color: '#3b82f6' },
    unfreeze: { text: 'Разморозка', color: '#3b82f6' },
    status: { text: 'Смена статуса', color: '#f59e0b' },
    convert: { text: 'Конвертация', color: '#10b981' },
    restore: { text: 'Восстановление', color: '#10b981' },
    price: { text: 'Изменение цены', color: '#f59e0b' },
    'promise-date': { text: 'Обещанный платёж', color: '#f59e0b' },
    payment: { text: 'Платёж', color: '#10b981' },
    renew: { text: 'Продление', color: '#10b981' },
    extend: { text: 'Продление', color: '#10b981' },
    comment: { text: 'Комментарий', color: '#6b7280' },
    'add-to-group': { text: 'Добавлен в группу', color: '#10b981' },
    'remove-from-group': { text: 'Удалён из группы', color: '#f59e0b' },
    'reset-password': { text: 'Сброс пароля', color: '#f59e0b' },
    sent: { text: 'Рассылка', color: '#25d366' },
    schedule: { text: 'Изменил расписание', color: '#f59e0b' },
};

const ACTIVITY_FIELD_LABELS = {
    name: 'имя',
    lastName: 'фамилию',
    phone: 'телефон',
    additionalPhones: 'дополнительные телефоны',
    learningDirections: 'направления обучения',
    assignedTeacherId: 'преподавателя',
    schedules: 'расписание',
    accountBalance: 'баланс',
    status: 'статус',
    role: 'роль',
    groupId: 'группу',
    teacherId: 'преподавателя',
    paymentMethod: 'способ оплаты',
    amount: 'сумму',
    paidAmount: 'оплаченную сумму',
    startDate: 'дату начала',
    endDate: 'дату окончания',
    direction: 'направление',
    title: 'название',
    note: 'заметку',
    notes: 'заметку',
    comment: 'комментарий',
};

const ACTIVITY_PAYMENT_TYPES = {
    membership_full: 'Полная оплата абонемента',
    membership_advance: 'Предоплата за абонемент',
    membership_balance: 'Доплата за абонемент',
    individual_class: 'Оплата индивидуального занятия',
    single_class: 'Оплата разового занятия',
    trial_advance: 'Депозит за пробный урок',
    trial_full: 'Оплата пробного урока',
};

function activityMoney(value) {
    return `${new Intl.NumberFormat('ru-RU').format(Number(value) || 0)} ₸`;
}

function activityMetadata(log) {
    return log?.metadata && typeof log.metadata === 'object' ? log.metadata : {};
}

function activityObjectName(log) {
    const metadata = activityMetadata(log);
    if (log.subjectName) return log.subjectName;
    if (metadata.studentName) return metadata.studentName;
    const before = metadata.before || {};
    const body = metadata.body || {};
    const source = before.name || before.lastName ? before : body;
    const name = [source.name, source.lastName].filter(Boolean).join(' ').trim();
    if (name) return name;

    const details = String(log.details || '');
    const mailingMatch = details.match(/^(.+?)\s+—\s+Рассылка\s+—/i);
    if (mailingMatch) return mailingMatch[1].trim();
    const identityMatch = details.match(/(?:Создание|Изменение|Удаление)\s+—\s+([^·,]+)/i);
    if (identityMatch) return identityMatch[1].trim();
    return ACTIVITY_ENTITY_LABELS[log.entityType] || 'Система';
}

function activityReminderResult(log) {
    const metadata = activityMetadata(log);
    const labels = {
        today: 'Сегодня урок',
        tomorrow: 'Завтра урок',
        oneLesson: 'Оплата',
        tasks: 'Запланированный контакт',
    };
    if (metadata.reminderLabel) return metadata.reminderLabel;
    if (labels[metadata.kind]) return labels[metadata.kind];
    const details = String(log.details || '');
    if (details.includes('tomorrow')) return 'Завтра урок';
    if (details.includes('today')) return 'Сегодня урок';
    if (details.includes('oneLesson')) return 'Оплата';
    if (details.includes('tasks')) return 'Запланированный контакт';
    return 'Сообщение отправлено';
}

function activityChangedFields(log) {
    const body = activityMetadata(log).body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
    return Object.keys(body)
        .filter(key => !['id', '_id', 'password', 'scope'].includes(key))
        .map(key => ACTIVITY_FIELD_LABELS[key])
        .filter(Boolean);
}

function activityPresentation(log) {
    const entity = ACTIVITY_ENTITY_LABELS[log.entityType] || 'Действие';
    const metadata = activityMetadata(log);
    const body = metadata.body || {};
    const objectName = activityObjectName(log);

    const isWhatsappReminder = log.entityType === 'WhatsAppReminder'
        || String(metadata.path || '').includes('/whatsapp-reminders/sent');
    if (isWhatsappReminder) {
        return {
            object: objectName,
            action: 'Рассылка',
            color: '#25d366',
            result: activityReminderResult(log),
        };
    }

    const isRefund = String(metadata.path || '').includes('/payments/refund')
        || body.status === 'refunded';
    if (['Payment', 'payments'].includes(log.entityType) && isRefund) {
        return {
            object: objectName === 'Платёж' ? 'Ученик' : objectName,
            action: 'Оформил возврат',
            color: '#ef8585',
            result: `${body.amount !== undefined ? activityMoney(body.amount) : 'Возврат средств'}${body.reason ? ` — ${body.reason}` : ''}`,
        };
    }

    if (['Payment', 'payments'].includes(log.entityType) && log.action === 'create') {
        const type = ACTIVITY_PAYMENT_TYPES[body.type] || 'Оплата ученика';
        return {
            object: objectName === 'Платёж' ? 'Ученик' : objectName,
            action: 'Принял оплату',
            color: '#10b981',
            result: `${type}${body.amount !== undefined ? ` — ${activityMoney(body.amount)}` : ''}`,
        };
    }

    if (['Student', 'students'].includes(log.entityType) && (log.action === 'schedule' || body.schedules)) {
        return {
            object: objectName,
            action: 'Изменил расписание',
            color: '#f59e0b',
            result: 'Новое расписание сохранено',
        };
    }

    const actionInfo = ACTIVITY_ACTION_LABELS[log.action] || { text: 'Изменение', color: '#6b7280' };
    const fields = activityChangedFields(log);
    let result = fields.length ? `Изменил: ${fields.join(', ')}` : String(log.details || '').trim();
    if (!result || /^(Создание|Изменение|Удаление)$/.test(result)) {
        result = `${actionInfo.text}: ${entity.toLowerCase()}`;
    }
    result = result
        .replace(/\bcompleted\b/g, 'завершено')
        .replace(/\bactive\b/g, 'активен')
        .replace(/\binactive\b/g, 'неактивен')
        .replace(/\bmembership_full\b/g, 'полная оплата абонемента')
        .replace(/\bindividual\b/g, 'индивидуально')
        .replace(/\bgroup\b/g, 'группа')
        .replace(/\bschedule\b/g, 'расписание')
        .replace(/\s*\[[\s\S]*$/, '')
        .slice(0, 240);

    return {
        object: objectName,
        action: actionInfo.text,
        color: actionInfo.color,
        bold: actionInfo.bold,
        result,
    };
}

// Инициализация модуля
function initActivityLogs() {
    console.log('🚀 Инициализация журнала действий...');
    const searchInput = document.getElementById('activitySearch');
    if (searchInput && !searchInput.dataset.bound) {
        searchInput.dataset.bound = '1';
        let timer;
        searchInput.addEventListener('input', event => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                activitySearch = event.target.value.trim();
                currentActivityPage = 1;
                renderActivityLogs();
            }, 300);
        });
    }
    renderActivityLogs();
}

// Загрузка и отображение логов
async function renderActivityLogs() {
    const tableBody = document.getElementById('activityLogsTable');
    if (!tableBody) return;

    // Показать лоадер
    tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Загрузка...</td></tr>';

    if (window.showLoading) window.showLoading();

    try {
        const token = getAuthToken();
        if (!token) {
            console.error('❌ No auth token');
            return;
        }

        const actionFilter = document.getElementById('activityActionFilter')?.value || '';
        const entityFilter = document.getElementById('activityEntityFilter')?.value || '';

        let url = `${API_URL}/activity-logs?page=${currentActivityPage}&limit=${activityPerPage}`;
        if (actionFilter) url += `&action=${actionFilter}`;
        if (entityFilter) url += `&entityType=${entityFilter}`;
        if (activitySearch) url += `&search=${encodeURIComponent(activitySearch)}`;

        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (data.success) {
            activityTotalPages = data.pagination.totalPages;
            updateActivityPagination();
            renderActivityTable(data.logs);
        } else {
            console.error('❌ Ошибка загрузки логов:', data.error);
            tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: red;">Ошибка: ${data.error}</td></tr>`;
        }

    } catch (error) {
        console.error('❌ Ошибка при получении логов:', error);
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red;">Ошибка соединения</td></tr>';
    } finally {
        if (window.hideLoading) window.hideLoading();
    }
}

// Отрисовка таблицы
function renderActivityTable(logs) {
    const tableBody = document.getElementById('activityLogsTable');
    if (!tableBody) return;

    if (!logs || logs.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; opacity: 0.6;">Нет записей</td></tr>';
        return;
    }

    const visibleLogs = logs.filter(log => !(
        ['Admin', 'admin'].includes(log.entityType)
        && log.action === 'create'
        && String(activityMetadata(log).path || '').includes('/whatsapp-reminders/sent')
    ));
    if (!visibleLogs.length) {
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; opacity: 0.6;">Нет записей</td></tr>';
        return;
    }

    const rows = visibleLogs.map(log => {
        const user = log.user ? `${log.user.name} ${log.user.lastName || ''}` : 'Неизвестный';
        const date = new Date(log.createdAt).toLocaleString('ru', {
            day: '2-digit', month: '2-digit', year: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });

        const view = activityPresentation(log);
        const actionStyle = `color: ${view.color};${view.bold ? ' font-weight: 600;' : ''}`;

        return `
            <tr>
                <td style="white-space: nowrap; font-size: 0.9em; opacity: 0.8;">${date}</td>
                <td>${escapeActivityHtml(user)}</td>
                <td>${escapeActivityHtml(view.object)}</td>
                <td style="${actionStyle}">${escapeActivityHtml(view.action)}</td>
                <td style="font-size: 0.9em;">${escapeActivityHtml(view.result)}</td>
            </tr>
        `;
    }).join('');

    tableBody.innerHTML = rows;
}

function escapeActivityHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Пагинация
function updateActivityPagination() {
    const prevBtn = document.getElementById('activityPrevBtn');
    const nextBtn = document.getElementById('activityNextBtn');
    const pageInfo = document.getElementById('activityPageInfo');

    if (pageInfo) pageInfo.textContent = `Страница ${currentActivityPage} из ${activityTotalPages}`;
    if (prevBtn) prevBtn.disabled = currentActivityPage <= 1;
    if (nextBtn) nextBtn.disabled = currentActivityPage >= activityTotalPages;
}

// Глобальные функции
window.changeActivityPage = function (delta) {
    const newPage = currentActivityPage + delta;
    if (newPage >= 1 && newPage <= activityTotalPages) {
        currentActivityPage = newPage;
        renderActivityLogs();
    }
};

window.filterActivityLogs = function () {
    currentActivityPage = 1;
    renderActivityLogs();
};

// Экспорт для использования в других модулях, если нужно
window.initActivityLogs = initActivityLogs;
