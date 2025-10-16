// =====================================================
// SECTIONS MODULE - Управление загрузкой разделов
// =====================================================

// Кэш загруженных разделов для оптимизации
const loadedSections = new Set(['dashboard']); // Дашборд уже загружен при инициализации

// Загрузка данных для раздела с кэшированием
async function loadSectionData(sectionId, forceReload = false) {
    // ⚡ ОПТИМИЗАЦИЯ: Если вкладка уже загружена и не требуется принудительное обновление, пропускаем
    if (loadedSections.has(sectionId) && !forceReload) {
        console.log(`⚡ Секция "${sectionId}" уже загружена (используем кэш)`);
        return;
    }
    
    console.log(`📂 Загрузка секции: "${sectionId}"`);
    
    try {
        switch(sectionId) {
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
            break;
        case 'directions':
            await renderDirections();
            break;
        case 'payments':
            await renderPayments();
            break;
        case 'cashbox':
            await renderCashbox();
            // Загрузить список менеджеров для расчета ЗП
            await loadManagers();
            // Установить текущий месяц по умолчанию
            const now = new Date();
            const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            document.getElementById('salaryMonth').value = currentMonth;
            break;
        case 'blog':
            await renderBlogPosts();
            break;
        case 'roles':
            await loadRolesData();
            break;
        }
        
        // Помечаем вкладку как загруженную
        loadedSections.add(sectionId);
        console.log(`✅ Секция "${sectionId}" успешно загружена`);
    } catch (error) {
        console.error(`❌ Ошибка загрузки секции "${sectionId}":`, error);
        console.error('Stack:', error.stack);
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


