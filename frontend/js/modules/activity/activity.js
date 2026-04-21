// =====================================================
// ACTIVITY LOGS MODULE - Журнал действий
// =====================================================
console.log('✅ activity.js загружен!');

let currentActivityPage = 1;
let activityTotalPages = 1;
const activityPerPage = 50;

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
};

// Инициализация модуля
function initActivityLogs() {
    console.log('🚀 Инициализация журнала действий...');
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

    const rows = logs.map(log => {
        const user = log.user ? `${log.user.name} ${log.user.lastName || ''}` : 'Неизвестный';
        const date = new Date(log.createdAt).toLocaleString('ru', {
            day: '2-digit', month: '2-digit', year: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });

        const actionInfo = ACTIVITY_ACTION_LABELS[log.action] || { text: log.action, color: '#6b7280' };
        const actionStyle = `color: ${actionInfo.color};${actionInfo.bold ? ' font-weight: 600;' : ''}`;
        const actionText = actionInfo.text;
        const entityText = ACTIVITY_ENTITY_LABELS[log.entityType] || log.entityType;
        const details = log.details ? escapeActivityHtml(log.details) : '—';

        return `
            <tr>
                <td style="white-space: nowrap; font-size: 0.9em; opacity: 0.8;">${date}</td>
                <td>${escapeActivityHtml(user)}</td>
                <td style="${actionStyle}">${actionText}</td>
                <td>${entityText}</td>
                <td style="font-size: 0.9em;">${details}</td>
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
