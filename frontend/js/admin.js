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
        window.location.href = '/login.html';
        return false;
    }

    // Если это обычный ученик - запрещаем доступ
    if (userRole === 'student') {
        window.location.href = '/login.html';
        return false;
    }

    // Разрешаем доступ для admin, super_admin, sales_manager, teacher
    const allowedRoles = ['admin', 'super_admin', 'sales_manager', 'teacher'];
    if (!allowedRoles.includes(userRole)) {
        window.location.href = '/login.html';
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

const ADMIN_ASSET_VERSION = 'maestro12';

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
            .catch(() => { });

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

let currentUserRefreshInFlight = false;

async function refreshCurrentUserUi(options = {}) {
    if (currentUserRefreshInFlight || typeof refreshCurrentUserSession !== 'function') return null;

    currentUserRefreshInFlight = true;
    try {
        return await refreshCurrentUserSession({ applyUi: true, ...options });
    } catch (error) {
        console.warn('Не удалось обновить текущую роль пользователя:', error.message);
        return null;
    } finally {
        currentUserRefreshInFlight = false;
    }
}

function startCurrentUserSessionWatcher() {
    setInterval(() => {
        refreshCurrentUserUi({ announce: true });
    }, 60000);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            refreshCurrentUserUi({ announce: true });
        }
    });

    window.addEventListener('focus', () => {
        refreshCurrentUserUi({ announce: true });
    });
}

window.addEventListener('DOMContentLoaded', async () => {

    await refreshCurrentUserUi();

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
    initStudentEditForm();      // Форма редактирования ученика
    initAddPaymentHandler();    // Добавление платежей
    initGroupHandlers();        // Обработчики для групп
    initUserHandlers();         // Обработчики для пользователей
    initRoomHandlers();         // Обработчики для залов
    initMembershipHandlers();   // Обработчики для абонементов
    // Обработчики для расписания (проверяем наличие функции, т.к. модуль может загружаться асинхронно)
    if (typeof initScheduleHandlers === 'function') {
        initScheduleHandlers();
    } else if (typeof window.initScheduleHandlers === 'function') {
        window.initScheduleHandlers();
    } else {
        // Если функция еще не загружена, ждем немного и пробуем снова
        setTimeout(() => {
            if (typeof initScheduleHandlers === 'function') {
                initScheduleHandlers();
            } else if (typeof window.initScheduleHandlers === 'function') {
                window.initScheduleHandlers();
            }
        }, 100);
    }


    // ⚡ ОПТИМИЗАЦИЯ: Асинхронные операции выполняем параллельно
    try {
        await Promise.all([
            initUserManagement(),           // Загружает права и применяет видимость
            renderDashboard(),              // Рабочий стол администратора
            updatePendingAttendanceBadge()  // Обновляет badge посещаемости
        ]);
        if (typeof updatePendingReviewBadge === 'function') {
            await updatePendingReviewBadge();
        }
    } catch (error) {
        console.error('Init error:', error);
    }

    if (typeof startNewBookingsBadgeWatcher === 'function') {
        startNewBookingsBadgeWatcher();
    }

    startCurrentUserSessionWatcher();

    // ℹ️ Остальные вкладки (Заявки, Ученики, Группы и т.д.) 
    // загружаются автоматически при клике через loadSectionData()

    // Простой обработчик для кнопки гамбургера на мобильных
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarClose = document.getElementById('sidebarClose');
    const sidebar = document.getElementById('adminSidebar');
    const adminBody = document.body;

    // Используем начальный viewport из критического скрипта, если доступен
    const initialViewport = window.__INITIAL_VIEWPORT__;
    const getViewportWidth = () => Math.min(window.innerWidth, document.documentElement?.clientWidth || window.innerWidth);
    const isDesktop = () => getViewportWidth() > 1100;

    const updateViewportMode = () => {
        if (!adminBody) {
            return;
        }
        const compact = getViewportWidth() <= 1024;
        adminBody.dataset.viewport = compact ? 'compact' : 'wide';
        adminBody.classList.toggle('viewport-compact', compact);
        adminBody.classList.toggle('viewport-wide', !compact);
    };

    // Инициализируем viewport сразу, используя начальное значение если доступно
    if (adminBody) {
        if (initialViewport) {
            // Используем начальный viewport из критического скрипта
            adminBody.dataset.viewport = initialViewport.mode;
            adminBody.classList.toggle('viewport-compact', initialViewport.mode === 'compact');
            adminBody.classList.toggle('viewport-wide', initialViewport.mode === 'wide');
        } else {
            // Fallback: определяем viewport синхронно
            updateViewportMode();
        }
    }
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

    // Обновляем viewport (на случай изменения размера окна)
    updateViewportMode();

    // Устанавливаем начальное состояние sidebar на основе начального viewport
    // На мобильных устройствах сайдбар всегда закрыт по умолчанию
    const initialIsDesktop = initialViewport ? initialViewport.isDesktop : isDesktop();
    const initialSidebarOpen = initialIsDesktop; // На десктопе открыт, на мобильных закрыт

    // Сразу устанавливаем правильное состояние, чтобы избежать мерцания
    if (adminBody && !initialIsDesktop) {
        adminBody.classList.add('sidebar-closed');
        adminBody.classList.remove('sidebar-open');
    }

    setSidebarState(initialSidebarOpen, { force: true });

    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleSidebar();
        });

        // Touch handler for real mobile devices where click on SVG buttons can fail
        sidebarToggle.addEventListener('touchend', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleSidebar();
        }, { passive: false });

        sidebarToggle.setAttribute('aria-controls', 'adminSidebar');
        sidebarToggle.setAttribute('type', 'button');
    }

    if (sidebarClose) {
        const handleClose = (event) => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            closeSidebar();
            sidebarToggle?.focus();
        };

        // Обработчик для клика (мышь и touch после touchend)
        sidebarClose.addEventListener('click', handleClose, true);

        // Обработчик для touch событий (для лучшей совместимости на мобильных)
        sidebarClose.addEventListener('touchend', (event) => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            handleClose(event);
        }, { passive: false });

        sidebarClose.setAttribute('type', 'button');
        sidebarClose.setAttribute('aria-label', 'Закрыть меню');
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
