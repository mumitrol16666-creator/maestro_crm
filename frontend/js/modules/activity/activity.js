// =====================================================
// ACTIVITY LOGS MODULE - Журнал действий
// =====================================================
console.log('✅ activity.js загружен!');

let currentActivityPage = 1;
let activityTotalPages = 1;
const activityPerPage = 50;

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

        let actionStyle = '';
        let actionText = log.action;

        switch (log.action) {
            case 'delete':
                actionStyle = 'color: #dc3545; font-weight: 600;';
                actionText = 'УДАЛЕНИЕ';
                break;
            case 'create':
                actionStyle = 'color: #10b981;';
                actionText = 'Создание';
                break;
            case 'update':
                actionStyle = 'color: #f59e0b;';
                actionText = 'Изменение';
                break;
        }

        return `
            <tr>
                <td style="white-space: nowrap; font-size: 0.9em; opacity: 0.8;">${date}</td>
                <td>${user}</td>
                <td style="${actionStyle}">${actionText}</td>
                <td>${log.entityType}</td>
                <td style="font-size: 0.9em;">${log.details}</td>
            </tr>
        `;
    }).join('');

    tableBody.innerHTML = rows;
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
