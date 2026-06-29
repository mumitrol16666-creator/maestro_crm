// =====================================================
// SECTIONS MODULE - Управление загрузкой разделов
// =====================================================

// Кэш загруженных разделов для оптимизации
const loadedSections = new Set();

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
                if (typeof renderDashboard === 'function') await renderDashboard();
                break;
            case 'bookings':
                // Загружаем с текущим фильтром
                await renderBookings(currentBookingFilter);
                break;
            case 'students':
                await renderStudents();
                break;
            case 'membership-actions':
                if (typeof renderMembershipActions === 'function') await renderMembershipActions();
                break;
            case 'whatsapp-reminders':
                if (typeof renderWhatsappReminders === 'function') await renderWhatsappReminders();
                break;
            case 'users':
                // Загружаем пользователей с текущим фильтром
                await renderUsers(currentRoleFilter);
                break;
            case 'groups':
                await renderGroups();
                break;
            case 'lesson-review':
                if (typeof renderLessonReviewQueue === 'function') {
                    await renderLessonReviewQueue();
                }
                if (typeof updatePendingReviewBadge === 'function') {
                    updatePendingReviewBadge();
                }
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
            case 'activity-logs':
                if (typeof initActivityLogs === 'function') {
                    initActivityLogs();
                }
                break;
            case 'student-history':
                if (typeof initStudentHistoryLogs === 'function') {
                    initStudentHistoryLogs();
                }
                break;
            case 'analytics':
                if (typeof renderAnalytics === 'function') {
                    renderAnalytics();
                }
                break;
            case 'cashbox':
                if (typeof renderCashbox === 'function') {
                    await renderCashbox();
                }
                break;
            case 'salary':
                if (typeof initSalaryModule === 'function') {
                    initSalaryModule();
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
