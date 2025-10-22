// =====================================================
// DASHBOARD MODULE - Дашборд со статистикой
// =====================================================

// Загрузить статистику с сервера
async function fetchStats() {
    try {
        const token = getAuthToken();
        // Загрузка статистики для дашборда
        const response = await fetch(`${API_URL}/admin/stats`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            console.error(`❌ Ошибка загрузки статистики: ${response.status} ${response.statusText}`);
            return {};
        }
        
        const data = await response.json();
        // Статистика загружена
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

// Обновить badge неотмеченных посещаемостей
async function updatePendingAttendanceBadge() {
    try {
        const userRole = getUserRole();
        
        // Обновляем badge только для ролей с доступом к посещаемости
        if (!['teacher', 'admin', 'super_admin'].includes(userRole)) {
            return;
        }
        
        const response = await fetch(`${API_URL}/classes/pending-attendance/count`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        if (!response.ok) {
            return;
        }
        
        const data = await response.json();
        const count = data.count || 0;
        
        const badge = document.getElementById('pendingAttendanceBadge');
        if (badge) {
            if (count > 0) {
                badge.textContent = count;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }
    } catch (error) {
    }
}

// Адаптировать UI дашборда под роль (без данных, мгновенно!)
function adaptDashboardForRole(userRole) {
    // UI адаптирован под роль
    
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
        // Рендеринг дашборда
        const userRole = getUserRole();
        // Роль пользователя определена
        
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
        
        // Дашборд отрисован успешно
        
        // 🔍 Проверяем состояние секции dashboard
        setTimeout(() => {
            const section = document.getElementById('section-dashboard');
            if (section) {
                const styles = window.getComputedStyle(section);
                const hasHiddenClass = section.classList.contains('hidden');
                const displayStyle = styles.display;
                const visibilityStyle = styles.visibility;
                const opacityStyle = styles.opacity;
                
                // Проверка dashboard завершена
                
                // 🔥 КРИТИЧЕСКАЯ ПРОБЛЕМА: display: none!
                if (displayStyle === 'none') {
                    console.error('🔥 ПРОБЛЕМА: dashboard имеет display: none!');
                    console.error('   Но НЕ должен иметь, т.к. нет класса hidden');
                    console.error('   Возможно, проблема была в inline style - теперь navigation.js очищает его');
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
