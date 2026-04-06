// =====================================================
// SECTIONS MODULE - Управление загрузкой разделов
// =====================================================

// Кэш загруженных разделов для оптимизации
const loadedSections = new Set(['bookings']); // Заявки уже загружены при инициализации

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
            case 'roles':
                await loadRolesData();
                break;
            case 'activity-logs':
                if (typeof renderActivityLogs === 'function') {
                    await renderActivityLogs();
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


