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

const ADMIN_ASSET_VERSION = '65';

async function ensureFreshAssets() {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    try {
        const stored = localStorage.getItem('adminAssetVersion');
        const needsRefresh = stored !== ADMIN_ASSET_VERSION;

        if (!needsRefresh) {
            sessionStorage.removeItem('adminAssetReloaded');
            return;
        }

        localStorage.setItem('adminAssetVersion', ADMIN_ASSET_VERSION);

        const markReloaded = () => {
            if (!sessionStorage.getItem('adminAssetReloaded')) {
                sessionStorage.setItem('adminAssetReloaded', 'true');
                setTimeout(() => window.location.reload(), 300);
            }
        };

        const sendClearMessage = worker => {
            try {
                worker.postMessage({ type: 'CLEAR_CACHE', reason: 'admin-assets', version: ADMIN_ASSET_VERSION });
            } catch (error) {
                console.warn('SW message failed', error);
            }
        };

        if (navigator.serviceWorker.controller) {
            sendClearMessage(navigator.serviceWorker.controller);
        }

        navigator.serviceWorker.ready
            .then(registration => {
                if (registration?.active) {
                    sendClearMessage(registration.active);
                }
            })
            .catch(() => {});

        try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map(async reg => {
                try {
                    await reg.unregister();
                    await reg.update();
                } catch (error) {
                    console.warn('Unable to unregister SW', error);
                }
            }));
        } catch (error) {
            console.warn('Failed to list SW registrations', error);
        }

        markReloaded();
    } catch (error) {
        console.warn('Unable to ensure fresh assets', error);
    }
}

ensureFreshAssets();

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
    const adminBody = document.body;
    const getViewportWidth = () => Math.min(window.innerWidth, document.documentElement?.clientWidth || window.innerWidth);
    const isDesktop = () => getViewportWidth() > 1100;
    const updateViewportMode = () => {
        if (!adminBody) {
            return;
        }
        const compact = getViewportWidth() <= 960;
        adminBody.classList.toggle('viewport-compact', compact);
        adminBody.classList.toggle('viewport-wide', !compact);
    };
    let sidebarState = null;
    
    const updateSidebarForViewport = (isOpen) => {
        if (!sidebar) {
            return;
        }
        const isMobile = !isDesktop();
        adminBody?.classList.toggle('sidebar-open', isOpen);
        adminBody?.classList.toggle('sidebar-closed', !isOpen);
        sidebar.classList.toggle('open', isOpen && isMobile);
        sidebar.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        sidebarToggle?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    };
    
    const setSidebarState = (shouldOpen, { force = false } = {}) => {
        const desiredState = Boolean(shouldOpen);
        if (!force && sidebarState === desiredState) {
            // Обновляем только responsive классы (например при resize)
            updateSidebarForViewport(desiredState);
            return;
        }
        sidebarState = desiredState;
        updateSidebarForViewport(desiredState);
    };
    
    const toggleSidebar = () => {
        setSidebarState(!(sidebarState ?? false));
    };
    
    const closeSidebar = () => {
        setSidebarState(false);
    };
    
    updateViewportMode();
    setSidebarState(isDesktop());
    
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleSidebar();
        });
        sidebarToggle.setAttribute('aria-controls', 'adminSidebar');
        sidebarToggle.setAttribute('type', 'button');
    }
    
    if (sidebarClose) {
        sidebarClose.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            closeSidebar();
            sidebarToggle?.focus();
        }, true);
        sidebarClose.setAttribute('type', 'button');
    }
    
    setTimeout(() => {
        document.addEventListener('click', (event) => {
            if (sidebarClose && (event.target === sidebarClose || sidebarClose.contains(event.target))) {
                return;
            }
            if (sidebarToggle && (event.target === sidebarToggle || sidebarToggle.contains(event.target))) {
                return;
            }
            
            if (!isDesktop() && (sidebarState ?? false) && sidebar && !sidebar.contains(event.target)) {
                closeSidebar();
            }
        });
    }, 100);
    
    window.addEventListener('resize', () => {
        const desktop = isDesktop();
        const currentState = sidebarState ?? desktop;
        setSidebarState(currentState, { force: true });
        updateViewportMode();
    });
});

