function dashboardMoney(value) {
    return `${new Intl.NumberFormat('ru-RU').format(Number(value) || 0)} ₸`;
}

function dashboardDate(value, time) {
    const date = new Date(value);
    return `${date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}${time ? ` · ${time}` : ''}`;
}

function dashboardGo(section) {
    document.querySelector(`.sidebar-link[data-section="${section}"]`)?.click();
}

function dashboardList(items, renderItem, emptyText) {
    if (!items?.length) return `<div class="ops-empty">${emptyText}</div>`;
    return `<div class="ops-list">${items.map(renderItem).join('')}</div>`;
}

async function renderDashboard() {
    const root = document.getElementById('operationsDashboard');
    if (!root) return;
    root.innerHTML = '<div class="ops-loading">Собираем рабочий день...</div>';

    try {
        const response = await fetch(`${API_URL}/admin/operations`, {
            headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Ошибка загрузки');
        const data = result.data;

        root.innerHTML = `
            <div class="ops-hero">
                <div>
                    <p class="ops-eyebrow">Центр управления школой</p>
                    <h2>Добрый день, ${escapeBookingText(getUserName() || 'администратор')}</h2>
                    <p>Здесь собраны задачи, которые требуют решения сегодня.</p>
                </div>
                <button class="ops-refresh" onclick="renderDashboard()">Обновить</button>
            </div>

            <div class="ops-priority-grid">
                <button class="ops-metric is-accent" onclick="dashboardGo('bookings')"><span>${data.counts.newBookings}</span><strong>Новых заявок</strong><small>Ответить и назначить урок</small></button>
                <button class="ops-metric is-warning" onclick="dashboardGo('lesson-review')"><span>${data.counts.pendingReview}</span><strong>На подтверждении</strong><small>Проверить отчёты преподавателей</small></button>
                <button class="ops-metric is-danger" onclick="dashboardGo('schedule')"><span>${data.counts.notFilled}</span><strong>Не заполнено</strong><small>Прошедшие уроки без результата</small></button>
                <button class="ops-metric" onclick="dashboardGo('schedule')"><span>${data.counts.todayClasses}</span><strong>Уроков сегодня</strong><small>Текущее расписание школы</small></button>
                <button class="ops-metric" onclick="dashboardGo('membership-actions')"><span>${data.counts.expiringMemberships}</span><strong>Заканчиваются</strong><small>Осталось два занятия или меньше</small></button>
                <button class="ops-metric is-danger" onclick="dashboardGo('membership-actions')"><span>${data.counts.debtMemberships}</span><strong>Отрицательный баланс</strong><small>Ученики с долгом на балансе</small></button>
            </div>

            <div class="ops-columns">
                <section class="ops-panel">
                    <div class="ops-panel-head"><div><p>Сегодня</p><h3>Расписание</h3></div><button onclick="dashboardGo('schedule')">Открыть</button></div>
                    ${dashboardList(data.todayClasses, item => `
                        <button class="ops-row" onclick="dashboardGo('schedule')">
                            <span class="ops-time">${escapeBookingText(item.startTime)}</span>
                            <span><strong>${escapeBookingText(item.title)}</strong><small>${escapeBookingText(item.audienceName)} · ${escapeBookingText(item.teacherName || 'Без преподавателя')}${item.roomName ? ` · ${escapeBookingText(item.roomName)}` : ''}</small></span>
                        </button>`, 'На сегодня уроков нет')}
                </section>

                <section class="ops-panel">
                    <div class="ops-panel-head"><div><p>Контроль</p><h3>Требует внимания</h3></div><button onclick="dashboardGo('lesson-review')">К очереди</button></div>
                    ${dashboardList([...data.pendingReview.map(x => ({ ...x, kind: 'review' })), ...data.notFilled.map(x => ({ ...x, kind: 'empty' }))].slice(0, 8), item => `
                        <button class="ops-row" onclick="dashboardGo('${item.kind === 'review' ? 'lesson-review' : 'schedule'}')">
                            <span class="ops-dot ${item.kind === 'empty' ? 'is-danger' : 'is-warning'}"></span>
                            <span><strong>${escapeBookingText(item.title)}</strong><small>${dashboardDate(item.date, item.startTime)} · ${escapeBookingText(item.teacherName || 'Без преподавателя')}</small></span>
                        </button>`, 'Нет просроченных задач')}
                </section>

                <section class="ops-panel">
                    <div class="ops-panel-head"><div><p>Продажи</p><h3>Новые заявки</h3></div><button onclick="dashboardGo('bookings')">Все заявки</button></div>
                    ${dashboardList(data.newBookings, item => `
                        <button class="ops-row" onclick="dashboardGo('bookings')">
                            <span class="ops-avatar">${escapeBookingText((item.name || '?').slice(0, 1))}</span>
                            <span><strong>${escapeBookingText(`${item.name} ${item.lastName || ''}`)}</strong><small>${escapeBookingText(item.direction)} · ${escapeBookingText(item.source)}</small></span>
                        </button>`, 'Новых заявок нет')}
                </section>

                <section class="ops-panel">
                    <div class="ops-panel-head"><div><p>Финансы</p><h3>Долги и продления</h3></div><button onclick="dashboardGo('membership-actions')">Открыть очередь</button></div>
                    ${dashboardList(data.debtMemberships.slice(0, 4), item => `
                        <button class="ops-row" onclick="viewStudent('${item.studentId}')">
                            <span class="ops-dot is-danger"></span>
                            <span><strong>${escapeBookingText(item.studentName)}</strong><small>Баланс: ${dashboardMoney(item.remainingAmount)}</small></span>
                        </button>`, 'Долгов нет')}
                    ${dashboardList(data.expiringMemberships.slice(0, 4), item => `
                        <button class="ops-row" onclick="viewStudent('${item.studentId}')">
                            <span class="ops-dot is-warning"></span>
                            <span><strong>${escapeBookingText(item.studentName)}</strong><small>${item.classesRemaining} занятий · ${escapeBookingText(item.groupName)}</small></span>
                        </button>`, 'Продления пока не требуются')}
                </section>
            </div>
        `;
    } catch (error) {
        root.innerHTML = `<div class="ops-empty is-error">${escapeBookingText(error.message)}</div>`;
    }
}

window.renderDashboard = renderDashboard;
window.dashboardGo = dashboardGo;
