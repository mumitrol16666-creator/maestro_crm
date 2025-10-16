// =====================================================
// DASHBOARD MODULE - Дашборд со статистикой
// =====================================================

// Загрузить статистику с сервера
async function fetchStats() {
    try {
        const token = getAuthToken();
        console.log('📊 Загрузка статистики для дашборда...');
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
        console.log('✅ Статистика загружена:', data.stats);
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

// Отрисовать дашборд
async function renderDashboard() {
    try {
        console.log('🎨 Рендеринг дашборда...');
        const stats = await fetchStats();
        const userRole = getUserRole();
        console.log(`👤 Роль пользователя: ${userRole}`);
        
        // Для менеджера по продажам - другие карточки
        if (userRole === 'sales_manager') {
        // Скрываем "Всего учеников" и "Доход за месяц"
        document.querySelector('.stat-card:nth-child(1)').style.display = 'none';
        document.querySelector('.stat-card:nth-child(2)').style.display = 'none';
        
        // Меняем текст "Активных абонементов" на "Продано абонементов за месяц"
        document.querySelector('.stat-card:nth-child(3) .stat-label').textContent = 'Продано абонементов за месяц';
        document.querySelector('.stat-card:nth-child(3) .stat-value').textContent = stats.enrolledThisMonth || 0;
        document.querySelector('.stat-card:nth-child(4) .stat-value').textContent = stats.newBookings || 0;
    } else if (userRole === 'teacher') {
        // Для преподавателя - упрощенный дашборд
        document.querySelector('.stat-card:nth-child(1)').style.display = ''; // Всего учеников
        document.querySelector('.stat-card:nth-child(2)').style.display = 'none'; // Скрываем доход
        document.querySelector('.stat-card:nth-child(3)').style.display = ''; // Активные абонементы
        document.querySelector('.stat-card:nth-child(4)').style.display = 'none'; // Скрываем заявки
        
        // Скрываем карточку долгов
        const debtCard = document.querySelector('.stat-card:nth-child(5)');
        if (debtCard) debtCard.style.display = 'none';
        
        // Возвращаем оригинальный текст
        document.querySelector('.stat-card:nth-child(3) .stat-label').textContent = 'Активных абонементов';
        
        // Заполняем данные
        document.querySelector('.stat-card:nth-child(1) .stat-value').textContent = stats.totalStudents || 0;
        document.querySelector('.stat-card:nth-child(3) .stat-value').textContent = stats.activeMemberships || 0;
    } else {
        // Для админов - все карточки
        document.querySelector('.stat-card:nth-child(1)').style.display = '';
        document.querySelector('.stat-card:nth-child(2)').style.display = '';
        document.querySelector('.stat-card:nth-child(3)').style.display = '';
        document.querySelector('.stat-card:nth-child(4)').style.display = '';
        const debtCard = document.querySelector('.stat-card:nth-child(5)');
        if (debtCard) debtCard.style.display = '';
        
        // Возвращаем оригинальный текст для админов
        document.querySelector('.stat-card:nth-child(3) .stat-label').textContent = 'Активных абонементов';
        
        document.querySelector('.stat-card:nth-child(1) .stat-value').textContent = stats.totalStudents || 0;
        document.querySelector('.stat-card:nth-child(2) .stat-value').textContent = 
            (stats.monthlyRevenue || 0).toLocaleString() + '₸';
        document.querySelector('.stat-card:nth-child(3) .stat-value').textContent = stats.activeMemberships || 0;
        document.querySelector('.stat-card:nth-child(4) .stat-value').textContent = stats.newBookings || 0;
        
        // 🔴 ДОЛГИ (5-я карточка)
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
    
    // Обновляем дополнительные строки (убираем демо-данные)
    const studentsChange = document.getElementById('studentsChange');
    const revenueChange = document.getElementById('revenueChange');
    const membershipsChange = document.getElementById('membershipsChange');
    const bookingsChange = document.getElementById('bookingsChange');
    
    if (studentsChange) studentsChange.textContent = '';
    if (revenueChange) revenueChange.textContent = '';
    if (membershipsChange) membershipsChange.textContent = '';
    if (bookingsChange) {
        const newBookings = stats.newBookings || 0;
        bookingsChange.textContent = newBookings > 0 ? 'Требуют обработки' : '';
        bookingsChange.className = newBookings > 0 ? 'stat-change neutral' : 'stat-change';
    }
    
    // Обновляем badge новых заявок (только для ролей с доступом к заявкам)
    if (userRole !== 'teacher') {
        updateNewBookingsBadge(stats.newBookings || 0);
    }
    
    // Обновляем последние заявки (скрываем для teacher)
    const bookingsSection = document.querySelector('.bookings-list')?.closest('.admin-section');
    if (bookingsSection) {
        bookingsSection.style.display = userRole === 'teacher' ? 'none' : '';
    }
    
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
        
        console.log('✅ Дашборд отрисован успешно');
        
        // 🔍 Проверяем состояние секции dashboard
        setTimeout(() => {
            const section = document.getElementById('section-dashboard');
            if (section) {
                const styles = window.getComputedStyle(section);
                const hasHiddenClass = section.classList.contains('hidden');
                const displayStyle = styles.display;
                const visibilityStyle = styles.visibility;
                const opacityStyle = styles.opacity;
                
                console.log('🔍 Проверка dashboard через 1 секунду:');
                console.log(`  Класс hidden: ${hasHiddenClass ? '❌ ДА' : '✅ НЕТ'}`);
                console.log(`  CSS display: ${displayStyle}`);
                console.log(`  CSS visibility: ${visibilityStyle}`);
                console.log(`  CSS opacity: ${opacityStyle}`);
                console.log(`  Виден на экране: ${displayStyle !== 'none' && visibilityStyle !== 'hidden' && opacityStyle !== '0' ? '✅ ДА' : '❌ НЕТ'}`);
            }
        }, 1000);
    } catch (error) {
        console.error('❌ Ошибка рендеринга дашборда:', error);
        console.error('Stack:', error.stack);
    }
}


