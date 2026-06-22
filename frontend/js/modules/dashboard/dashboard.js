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

const dashboardIcons = {
    calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`,
    shield: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="m9 11 2 2 4-4"></path></svg>`,
    inbox: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>`,
    wallet: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"></rect><line x1="12" y1="10" x2="12" y2="14"></line><line x1="10" y1="12" x2="14" y2="12"></line></svg>`,
    star: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.886L4.2 9l5.888 1.914L12 17l1.912-5.886L19.8 9l-5.888-1.914z"></path></svg>`
};

function dashboardList(items, renderItem, emptyText, inline = false, iconKey = null) {
    if (!items?.length) {
        const iconHtml = iconKey && dashboardIcons[iconKey] ? dashboardIcons[iconKey] : '';
        if (inline) {
            return `<div class="ops-empty-inline">${iconHtml}<span>${emptyText}</span></div>`;
        }
        return `<div class="ops-empty">${iconHtml}<span>${emptyText}</span></div>`;
    }
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
                <button class="ops-metric" onclick="dashboardGo('membership-actions')"><span>${data.counts.expiringMemberships}</span><strong>Остался 1 урок</strong><small>Баланс от 0 до 4 000 ₸</small></button>
                <button class="ops-metric is-danger" onclick="dashboardGo('membership-actions')"><span>${data.counts.debtMemberships}</span><strong>Отрицательный баланс</strong><small>Ученики с долгом на балансе</small></button>
            </div>

            <div class="ops-columns">
                <section class="ops-panel">
                    <div class="ops-panel-head"><div><p>Сегодня</p><h3>Расписание</h3></div><button onclick="dashboardGo('schedule')">Открыть</button></div>
                    ${dashboardList(data.todayClasses, item => `
                        <button class="ops-row" onclick="dashboardGo('schedule')">
                            <span class="ops-time">${escapeBookingText(item.startTime)}</span>
                            <span><strong>${escapeBookingText(item.title)}</strong><small>${escapeBookingText(item.audienceName)} · ${escapeBookingText(item.teacherName || 'Без преподавателя')}${item.roomName ? ` · ${escapeBookingText(item.roomName)}` : ''}</small></span>
                        </button>`, 'На сегодня уроков нет', false, 'calendar')}
                </section>

                <section class="ops-panel">
                    <div class="ops-panel-head"><div><p>Контроль</p><h3>Требует внимания</h3></div><button onclick="dashboardGo('lesson-review')">К очереди</button></div>
                    ${dashboardList([...data.pendingReview.map(x => ({ ...x, kind: 'review' })), ...data.notFilled.map(x => ({ ...x, kind: 'empty' }))].slice(0, 8), item => `
                        <button class="ops-row" onclick="dashboardGo('${item.kind === 'review' ? 'lesson-review' : 'schedule'}')">
                            <span class="ops-dot ${item.kind === 'empty' ? 'is-danger' : 'is-warning'}"></span>
                            <span><strong>${escapeBookingText(item.title)}</strong><small>${dashboardDate(item.date, item.startTime)} · ${escapeBookingText(item.teacherName || 'Без преподавателя')}</small></span>
                        </button>`, 'Нет просроченных задач', false, 'shield')}
                </section>

                <section class="ops-panel">
                    <div class="ops-panel-head"><div><p>Продажи</p><h3>Новые заявки</h3></div><button onclick="dashboardGo('bookings')">Все заявки</button></div>
                    ${dashboardList(data.newBookings, item => `
                        <button class="ops-row" onclick="dashboardGo('bookings')">
                            <span class="ops-avatar">${escapeBookingText((item.name || '?').slice(0, 1))}</span>
                            <span><strong>${escapeBookingText(`${item.name} ${item.lastName || ''}`)}</strong><small>${escapeBookingText(item.direction)} · ${escapeBookingText(item.source)}</small></span>
                        </button>`, 'Новых заявок нет', false, 'inbox')}
                </section>

                <section class="ops-panel">
                    <div class="ops-panel-head"><div><p>Финансы</p><h3>Долги и продления</h3></div><button onclick="dashboardGo('membership-actions')">Открыть очередь</button></div>
                    
                    <div class="ops-panel-subheader">Ученики с долгом</div>
                    ${dashboardList(data.debtMemberships.slice(0, 4), item => `
                        <button class="ops-row" onclick="viewStudent('${item.studentId}')">
                            <span class="ops-dot is-danger"></span>
                            <span><strong>${escapeBookingText(item.studentName)}</strong><small>Баланс: ${dashboardMoney(item.remainingAmount)}</small></span>
                        </button>`, 'Долгов нет', true, 'wallet')}

                    <div class="ops-panel-subheader">Низкий баланс</div>
                    ${dashboardList(data.expiringMemberships.slice(0, 4), item => `
                        <button class="ops-row" onclick="viewStudent('${item.studentId}')">
                            <span class="ops-dot is-warning"></span>
                            <span><strong>${escapeBookingText(item.studentName)}</strong><small>Остался 1 урок · баланс ${dashboardMoney(item.remainingAmount)}</small></span>
                        </button>`, 'Продления пока не требуются', true, 'star')}
                </section>
            </div>
        `;
    } catch (error) {
        root.innerHTML = `<div class="ops-empty is-error">${escapeBookingText(error.message)}</div>`;
    }
}

window.renderDashboard = renderDashboard;
window.dashboardGo = dashboardGo;
