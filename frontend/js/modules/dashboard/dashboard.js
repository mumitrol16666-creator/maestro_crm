// =====================================================
// DASHBOARD MODULE - Дашборд со статистикой
// =====================================================

const NEW_BOOKINGS_VISIBLE_INTERVAL = 15000;   // 15 секунд при активной вкладке
const NEW_BOOKINGS_HIDDEN_INTERVAL = 60000;    // 60 секунд при неактивной вкладке

let newBookingsBadgeTimer = null;
let newBookingsBadgeRequestInFlight = false;

// Загрузить статистику с сервера
async function fetchStats() {
    try {
        const token = getAuthToken();

        if (!token) {
            console.error('❌ Токен авторизации отсутствует в localStorage');
            return {};
        }

        // Загрузка статистики
        const response = await fetch(`${API_URL}/admin/stats`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            // Пытаемся получить детальную информацию об ошибке
            let errorMessage = `${response.status} ${response.statusText}`;
            try {
                const errorData = await response.json();
                if (errorData.error) {
                    errorMessage = errorData.error;
                }
            } catch (e) {
                // Игнорируем ошибку парсинга
            }

            console.error(`❌ Ошибка загрузки статистики: ${errorMessage}`);

            if (response.status === 401) {
                // Обработка истекшего токена - api.js уже обработает это, но на случай прямого fetch
                if (window.location.pathname !== '/login') {
                    // Показываем уведомление, если toast доступен
                    if (typeof window.toast !== 'undefined' && window.toast.warning) {
                        window.toast.warning('Сессия истекла. Пожалуйста, войдите заново.', 4000);
                    } else if (typeof toast !== 'undefined' && toast.warning) {
                        toast.warning('Сессия истекла. Пожалуйста, войдите заново.', 4000);
                    }

                    // Очищаем данные и редиректим
                    localStorage.clear();
                    setTimeout(() => {
                        window.location.href = '/login';
                    }, 1500);
                }
            }

            return {};
        }

        const data = await response.json();
        // Статистика получена
        return data.stats || {};
    } catch (error) {
        console.error('❌ Ошибка fetchStats:', error);
        return {};
    }
}

// Обновить badge новых заявок
function updateNewBookingsBadge(count) {
    const badge = document.getElementById('newBookingsBadge');
    if (badge) {
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'block';
        } else {
            badge.style.display = 'none';
        }
    }
}

// Получить актуальное количество новых заявок из API
async function fetchNewBookingsCount() {
    if (newBookingsBadgeRequestInFlight) {
        return;
    }

    const userRole = getUserRole();
    if (!userRole || userRole === 'teacher') {
        return;
    }

    newBookingsBadgeRequestInFlight = true;
    try {
        const data = await fetchBookings('new', '', 1, 1);
        const count = typeof data.total === 'number'
            ? data.total
            : (typeof data.count === 'number'
                ? data.count
                : (Array.isArray(data.bookings) ? data.bookings.length : 0));
        updateNewBookingsBadge(count);
    } catch (error) {
        console.warn('⚠️ Не удалось обновить количество новых заявок:', error);
    } finally {
        newBookingsBadgeRequestInFlight = false;
    }
}

function scheduleNextNewBookingsUpdate() {
    const delay = document.hidden ? NEW_BOOKINGS_HIDDEN_INTERVAL : NEW_BOOKINGS_VISIBLE_INTERVAL;
    newBookingsBadgeTimer = setTimeout(async () => {
        await fetchNewBookingsCount();
        scheduleNextNewBookingsUpdate();
    }, delay);
}

function startNewBookingsBadgeWatcher() {
    const userRole = getUserRole();
    if (!userRole || userRole === 'teacher') {
        return;
    }

    stopNewBookingsBadgeWatcher();
    fetchNewBookingsCount();
    scheduleNextNewBookingsUpdate();
}

function stopNewBookingsBadgeWatcher() {
    if (newBookingsBadgeTimer) {
        clearTimeout(newBookingsBadgeTimer);
        newBookingsBadgeTimer = null;
    }
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && newBookingsBadgeTimer !== null) {
        fetchNewBookingsCount();
    }
});

// Обновить badge неотмеченных посещаемостей
async function updatePendingAttendanceBadge() {
    try {
        const userRole = getUserRole();

        // Обновляем badge только для ролей с доступом к посещаемости
        if (!['teacher', 'admin', 'super_admin'].includes(userRole)) {
            return;
        }

        // ✅ Добавляем timestamp к URL для предотвращения кэширования
        const timestamp = new Date().getTime();
        const response = await fetch(`${API_URL}/classes/pending-attendance/count?t=${timestamp}`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            },
            // ✅ Добавляем заголовки для предотвращения кэширования
            cache: 'no-cache'
        });

        if (!response.ok) {
            console.warn('⚠️ updatePendingAttendanceBadge: Response not ok', response.status);
            return;
        }

        const data = await response.json();
        const count = data.count || 0;

        console.log('🔢 updatePendingAttendanceBadge: Новое количество неотмеченных занятий:', count);

        const badge = document.getElementById('pendingAttendanceBadge');
        if (badge) {
            if (count > 0) {
                badge.textContent = count;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
            console.log('✅ Badge обновлен:', count > 0 ? count : 'скрыт');
        } else {
            console.warn('⚠️ Badge element not found');
        }
    } catch (error) {
        console.error('❌ Ошибка обновления badge:', error);
    }
}

// Адаптировать UI дашборда под роль (без данных, мгновенно!)
function adaptDashboardForRole(userRole) {
    // UI адаптирован

    if (userRole === 'teacher') {
        // Для преподавателя
        document.querySelector('.stat-card:nth-child(1)').style.display = '';
        document.querySelector('.stat-card:nth-child(2)').style.display = 'none';
        document.querySelector('.stat-card:nth-child(3)').style.display = '';
        document.querySelector('.stat-card:nth-child(4)').style.display = '';

        const debtCard = document.querySelector('.stat-card:nth-child(5)');
        if (debtCard) debtCard.style.display = 'none';

        // Меняем названия карточек
        document.querySelector('.stat-card:nth-child(3) .stat-label').textContent = 'Активных абонементов';
        document.querySelector('.stat-card:nth-child(4) .stat-label').textContent = 'Посещений в этом месяце';

        // Скрываем блок "Недавние заявки"
        const recentBookingsCard = document.getElementById('recentBookingsCard');
        if (recentBookingsCard) recentBookingsCard.style.display = 'none';

    } else if (userRole === 'sales_manager') {
        // Для менеджера
        document.querySelector('.stat-card:nth-child(1)').style.display = 'none';
        document.querySelector('.stat-card:nth-child(2)').style.display = 'none';
        document.querySelector('.stat-card:nth-child(3) .stat-label').textContent = 'Продано абонементов за месяц';

    } else {
        // Для админов - показываем всё
        document.querySelector('.stat-card:nth-child(1)').style.display = '';
        document.querySelector('.stat-card:nth-child(2)').style.display = '';
        document.querySelector('.stat-card:nth-child(3)').style.display = '';
        document.querySelector('.stat-card:nth-child(4)').style.display = '';

        const debtCard = document.querySelector('.stat-card:nth-child(5)');
        if (debtCard) debtCard.style.display = '';

        const recentBookingsCard = document.getElementById('recentBookingsCard');
        if (recentBookingsCard) recentBookingsCard.style.display = '';

        // Устанавливаем правильные названия
        document.querySelector('.stat-card:nth-child(3) .stat-label').textContent = 'Активных абонементов';
        document.querySelector('.stat-card:nth-child(4) .stat-label').textContent = 'Новые заявки';
    }
}

// Отрисовать дашборд
async function renderDashboard() {
    try {
        // Рендеринг
        const userRole = getUserRole();
        // Роль определена

        // 🔥 СНАЧАЛА адаптируем UI под роль (мгновенно!), ПОТОМ загружаем данные
        adaptDashboardForRole(userRole);

        // Затем загружаем статистику
        const stats = await fetchStats();

        // Заполняем данные в зависимости от роли
        if (userRole === 'sales_manager') {
            // Менеджер видит только продажи
            document.querySelector('.stat-card:nth-child(3) .stat-value').textContent = stats.enrolledThisMonth || 0;
            document.querySelector('.stat-card:nth-child(4) .stat-value').textContent = stats.newBookings || 0;
        } else if (userRole === 'teacher') {
            // Преподаватель видит общую инфу и свои посещения
            document.querySelector('.stat-card:nth-child(1) .stat-value').textContent = stats.totalStudents || 0;
            document.querySelector('.stat-card:nth-child(3) .stat-value').textContent = stats.activeMemberships || 0;
            document.querySelector('.stat-card:nth-child(4) .stat-value').textContent = stats.teacherAttendanceCount || 0;
        } else {
            // Админы видят всё (доход за месяц перенесён в Кассу)
            document.querySelector('.stat-card:nth-child(1) .stat-value').textContent = stats.totalStudents || 0;
            document.querySelector('.stat-card:nth-child(2) .stat-value').textContent = stats.activeMemberships || 0;
            document.querySelector('.stat-card:nth-child(3) .stat-value').textContent = stats.newBookings || 0;

            // 🔴 ДОЛГИ (5-я карточка) - только для админов
            const totalDebtValue = document.getElementById('totalDebtValue');
            const overdueChange = document.getElementById('overdueChange');

            if (totalDebtValue) {
                totalDebtValue.textContent = (stats.totalDebt || 0).toLocaleString() + '₸';
            }

            if (overdueChange) {
                const overdueCount = stats.overdueCount || 0;
                const overdueAmount = stats.overdueAmount || 0;

                if (overdueCount > 0) {
                    overdueChange.textContent = `⚠️ Просрочено: ${overdueAmount.toLocaleString()}₸ (${overdueCount})`;
                    overdueChange.className = 'stat-change negative';
                } else {
                    overdueChange.textContent = 'Нет просрочек';
                    overdueChange.className = 'stat-change positive';
                }
            }
        }

        // Обновляем badge новых заявок (только для не-teacher)
        if (userRole !== 'teacher') {
            updateNewBookingsBadge(stats.newBookings || 0);
        }

        // Обновляем последние заявки (только для не-teacher)
        if (stats.recentBookings && stats.recentBookings.length > 0 && userRole !== 'teacher') {
            const bookingsList = document.querySelector('.bookings-list');
            if (bookingsList) {
                bookingsList.innerHTML = stats.recentBookings.slice(0, 3).map(booking => `
                    <div class="booking-item">
                        <div class="booking-info">
                            <p class="booking-name">${booking.name} ${booking.lastName || ''}</p>
                            <p class="booking-details">${booking.direction} • ${booking.phone}</p>
                        </div>
                        <span class="status-badge ${booking.status}">${getStatusText(booking.status)}</span>
                    </div>
            `).join('');
            }
        }

        // Обновляем статистику направлений
        if (stats.directionStats && stats.directionStats.length > 0) {
            const directionsStats = document.querySelector('.directions-stats');
            const maxStudents = Math.max(...stats.directionStats.map(d => d.totalStudents), 1);

            directionsStats.innerHTML = stats.directionStats.slice(0, 4).map(dir => {
                const percentage = (dir.totalStudents / maxStudents) * 100;
                return `
                <div class="direction-stat-item">
                    <div class="direction-stat-info">
                        <span>${dir._id}</span>
                        <span class="direction-stat-count">${dir.totalStudents} учеников</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${percentage}%"></div>
                    </div>
                </div>
            `;
            }).join('');
        }

        // Дашборд отрисован

        // 🔍 Проверяем состояние секции dashboard
        setTimeout(() => {
            const section = document.getElementById('section-dashboard');
            if (section) {
                const styles = window.getComputedStyle(section);
                const hasHiddenClass = section.classList.contains('hidden');
                const displayStyle = styles.display;
                const visibilityStyle = styles.visibility;
                const opacityStyle = styles.opacity;

                // Проверка завершена

                // Проверка стиля
                if (displayStyle === 'none') {
                    // Скрыт
                }
            }
        }, 1000);
    } catch (error) {
        console.error('❌ Ошибка рендеринга дашборда:', error);
        console.error('Stack:', error.stack);
    }
}

// Экспортируем глобально для использования в других модулях
window.renderDashboard = renderDashboard;
window.startNewBookingsBadgeWatcher = startNewBookingsBadgeWatcher;
window.stopNewBookingsBadgeWatcher = stopNewBookingsBadgeWatcher;
window.fetchNewBookingsCount = fetchNewBookingsCount;
