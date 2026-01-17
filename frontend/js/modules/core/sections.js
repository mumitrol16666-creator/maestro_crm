// =====================================================
// SECTIONS MODULE - Управление загрузкой разделов
// =====================================================

// Кэш загруженных разделов для оптимизации
const loadedSections = new Set(['dashboard']); // Дашборд уже загружен при инициализации

// Загрузка данных для раздела с кэшированием
async function loadSectionData(sectionId, forceReload = false) {
    // ⚡ ОПТИМИЗАЦИЯ: Если вкладка уже загружена и не требуется принудительное обновление, пропускаем
    if (loadedSections.has(sectionId) && !forceReload) {
        return;
    }

    // Показать прогресс-бар загрузки
    if (window.showLoading) {
        window.showLoading();
    }

    // Загрузка

    try {
        switch (sectionId) {
            case 'dashboard':
                await renderDashboard();
                break;
            case 'bookings':
                // Загружаем с текущим фильтром
                await renderBookings(currentBookingFilter);
                break;
            case 'students':
                await renderStudents();
                break;
            case 'users':
                // Загружаем пользователей с текущим фильтром
                await renderUsers(currentRoleFilter);
                break;
            case 'groups':
                await renderGroups();
                break;
            case 'schedule':
                // Загружаем залы если еще не загружены
                if (allRooms.length === 0) {
                    await loadRooms();
                }
                // Инициализируем календарь при первом открытии
                if (!calendar) {
                    initCalendar();
                } else {
                    calendar.refetchEvents();
                }
                // Обновляем badge неотмеченных посещаемостей
                updatePendingAttendanceBadge();
                // Инициализируем кнопку управления залами
                if (typeof initRoomButton === 'function') {
                    initRoomButton();
                }
                if (typeof initRoomHandlers === 'function') {
                    initRoomHandlers();
                }
                // Инициализируем кнопку генерации расписания
                if (typeof initGenerateScheduleButton === 'function') {
                    initGenerateScheduleButton();
                }
                break;
            case 'directions':
                await renderDirections();
                break;
            case 'cashbox':
                if (typeof renderCashbox === 'function') {
                    await renderCashbox();
                } else {
                    // Проверяем есть ли уже загруженный модуль
                    const existingScript = document.querySelector('script[src*="cashbox.js"]');
                    if (existingScript) {
                        // Ждем немного и пробуем снова
                        setTimeout(() => {
                            if (typeof renderCashbox === 'function') {
                                renderCashbox();
                            }
                        }, 1000);
                    }
                }

                // Устанавливаем текущий месяц для зарплаты (если элемент существует)
                try {
                    const salaryMonthEl = document.getElementById('salaryMonth');
                    if (salaryMonthEl) {
                        const now = new Date();
                        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                        salaryMonthEl.value = currentMonth;
                    }
                } catch (error) {
                    console.log('⚠️ Salary month element not found, skipping...');
                }
                break;
            case 'blog':
                await renderBlogPosts();
                break;
            case 'roles':
                await loadRolesData();
                break;
            case 'activity-logs':
                if (typeof renderActivityLogs === 'function') {
                    await renderActivityLogs();
                } else {
                    console.warn('Activity logs module not loaded yet');
                }
                break;
        }

        // Помечаем вкладку как загруженную
        loadedSections.add(sectionId);
        // Загружена

        // Скрыть прогресс-бар после успешной загрузки
        if (window.hideLoading) {
            window.hideLoading();
        }
    } catch (error) {
        console.error(`❌ Ошибка загрузки секции "${sectionId}":`, error);
        console.error('Stack:', error.stack);

        // Скрыть прогресс-бар при ошибке
        if (window.hideLoading) {
            window.hideLoading();
        }
    }
}

// Функция для принудительного обновления данных вкладки
function refreshCurrentSection() {
    const activeLink = document.querySelector('.sidebar-link.active');
    if (activeLink) {
        const sectionId = activeLink.dataset.section;
        loadedSections.delete(sectionId); // Удаляем из кэша
        loadSectionData(sectionId, true); // Загружаем заново
    }
}

// Функция для сброса кэша определенных вкладок
function invalidateCache(...sectionIds) {
    sectionIds.forEach(id => loadedSections.delete(id));
}


