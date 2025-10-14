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
        showNotification(notificationWithIcon('warning', 'Доступ запрещен. Требуется авторизация.'));
        window.location.href = 'login.html';
        return false;
    }
    
    // Если это обычный ученик - перенаправляем в профиль
    if (userRole === 'student') {
        showNotification(notificationWithIcon('warning', 'Это личный кабинет администратора. Перенаправляем в ваш профиль.'));
        window.location.href = 'profile.html';
        return false;
    }
    
    // Разрешаем доступ для admin, super_admin, sales_manager, teacher
    const allowedRoles = ['admin', 'super_admin', 'sales_manager', 'teacher'];
    if (!allowedRoles.includes(userRole)) {
        showNotification(notificationWithIcon('warning', 'Доступ запрещен. Требуются права администратора.'));
        window.location.href = 'login.html';
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
    console.log('🚀 Инициализация админ-панели...');
    
    // Инициализация core модулей
    initNavigation();        // Навигация между вкладками
    initTheme();             // Темная/светлая тема
    displayCurrentUser();    // Отображение имени пользователя
    
    // Инициализация доступа к разделам
    initScheduleAccess();    // Доступ к расписанию (для учителей)
    initRoomButton();        // Кнопка управления залами
    
    // Инициализация обработчиков модулей
    initBookingFilters();       // Фильтры заявок
    initBookingCreate();        // Создание заявок
    initBookingConversion();    // Конвертация заявок в учеников
    initStudentSearch();        // Поиск учеников
    initGroupHandlers();        // Обработчики для групп
    initUserHandlers();         // Обработчики для пользователей
    initRoomHandlers();         // Обработчики для залов
    initMembershipHandlers();   // Обработчики для абонементов
    initScheduleHandlers();     // Обработчики для расписания
    
    // ⚡ ОПТИМИЗАЦИЯ: Асинхронные операции выполняем параллельно
    try {
        await Promise.all([
            initUserManagement(),           // Загружает права и применяет видимость
            renderDashboard(),              // Загружает статистику для дашборда
            updatePendingAttendanceBadge()  // Обновляет badge посещаемости
        ]);
        
        console.log('✅ Админ-панель успешно загружена');
    } catch (error) {
        console.error('❌ Ошибка загрузки админ-панели:', error);
        // Fallback - загружаем хотя бы дашборд
    renderDashboard();
    }
    
    // ℹ️ Остальные вкладки (Заявки, Ученики, Группы и т.д.) 
    // загружаются автоматически при клике через loadSectionData()
});

console.log('✅ Admin.js загружен');
