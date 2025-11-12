// =====================================================
// АДМИН-ПАНЕЛЬ - ГЛАВНЫЙ ФАЙЛ (после рефакторинга)
// =====================================================
// Все функциональность разнесена по модулям в /modules/
// Этот файл содержит только инициализацию и проверку доступа

// Проверка доступа (реальная проверка роли)
function checkAdminAccess() {
    const token = getAuthToken();
    const userRole = localStorage.getItem('userRole');
    
    if (!token) {
        // Редирект без toast (еще не загружен)
        window.location.href = '/login';
        return false;
    }
    
    // Если это обычный ученик - перенаправляем в профиль
    if (userRole === 'student') {
        window.location.href = '/profile';
        return false;
    }
    
    // Разрешаем доступ для admin, super_admin, sales_manager, teacher
    const allowedRoles = ['admin', 'super_admin', 'sales_manager', 'teacher'];
    if (!allowedRoles.includes(userRole)) {
        window.location.href = '/login';
        return false;
    }
    
    return true;
}

// Проверяем доступ при загрузке
if (!checkAdminAccess()) {
    throw new Error('Access denied');
}

// =====================================================
// ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ
// =====================================================

window.addEventListener('DOMContentLoaded', async () => {
    
    // Инициализация core модулей
    initNavigation();        // Навигация между вкладками
    initTheme();             // Темная/светлая тема
    displayCurrentUser();    // Отображение имени пользователя
    
    // Инициализация доступа к разделам (теперь в sidebar.js)
    // initScheduleAccess();    // Доступ к расписанию (для учителей)
    // initRoomButton();        // Кнопка управления залами
    
    // Инициализация обработчиков модулей
    initBookingFilters();       // Фильтры заявок
    initBookingSearch();        // Поиск заявок
    initBookingCreate();        // Создание заявок
    initBookingConversion();    // Конвертация заявок в учеников
    initStudentSearch();        // Поиск учеников
    initAddPaymentHandler();    // Добавление платежей
    initGroupHandlers();        // Обработчики для групп
    initUserHandlers();         // Обработчики для пользователей
    initRoomHandlers();         // Обработчики для залов
    initMembershipHandlers();   // Обработчики для абонементов
    initScheduleHandlers();     // Обработчики для расписания
    initPaymentHandlers();      // Обработчики для платежей
    initBlogHandlers();         // Обработчики для блога
    
    // ⚡ ОПТИМИЗАЦИЯ: Асинхронные операции выполняем параллельно
    try {
        await Promise.all([
            initUserManagement(),           // Загружает права и применяет видимость
            renderDashboard(),              // Загружает статистику для дашборда
            updatePendingAttendanceBadge()  // Обновляет badge посещаемости
        ]);
    } catch (error) {
        // Fallback - загружаем хотя бы дашборд
        await renderDashboard();
    }
    
    if (typeof startNewBookingsBadgeWatcher === 'function') {
        startNewBookingsBadgeWatcher();
    }
    
    // ℹ️ Остальные вкладки (Заявки, Ученики, Группы и т.д.) 
    // загружаются автоматически при клике через loadSectionData()
    
    // Простой обработчик для кнопки гамбургера на мобильных
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarClose = document.getElementById('sidebarClose');
    const sidebar = document.getElementById('adminSidebar');
    
    const setSidebarState = (collapsed) => {
        if (!sidebar) {
            return;
        }
        sidebar.dataset.collapsed = collapsed ? 'true' : 'false';
        sidebar.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
        if (sidebarToggle) {
            sidebarToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        }
    };
    
    const isSidebarCollapsed = () => {
        if (!sidebar) {
            return true;
        }
        return sidebar.dataset.collapsed === 'true';
    };
    
    const toggleSidebar = () => {
        setSidebarState(!isSidebarCollapsed());
        console.log('📱 Sidebar toggled, collapsed:', isSidebarCollapsed());
    };
    
    const closeSidebar = () => {
        setSidebarState(true);
        console.log('📱 Sidebar closed, collapsed:', isSidebarCollapsed());
    };
    
    setSidebarState(false);
    
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', (event) => {
            event.preventDefault();
            toggleSidebar();
        });
    }
    
    if (sidebarClose) {
        sidebarClose.addEventListener('click', (event) => {
            event.preventDefault();
            closeSidebar();
        });
    }
});

