// =====================================================
// SIDEBAR MODULE - Управление видимостью sidebar
// =====================================================

// Применить видимость разделов sidebar на основе прав роли
async function applySidebarVisibility() {
    try {
        const userRole = getUserRole();
        const token = getAuthToken();
        
        // Загружаем права для текущей роли
        const response = await fetch(`${API_URL}/permissions`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        
        if (!data.success) {
            console.warn('⚠️ Не удалось загрузить права, используем дефолтную логику');
            initUserManagementFallback();
            return;
        }
        
        // Находим права для текущей роли
        const currentRolePermissions = data.permissions.find(p => p.role === userRole);
        
        if (!currentRolePermissions) {
            console.warn('⚠️ Права для роли не найдены, используем дефолтную логику');
            initUserManagementFallback();
            return;
        }
        
        // Применяем видимость разделов
        const sectionLinks = {
            dashboard: document.querySelector('.sidebar-link[data-section="dashboard"]'),
            bookings: document.querySelector('.sidebar-link[data-section="bookings"]'),
            students: document.querySelector('.sidebar-link[data-section="students"]'),
            groups: document.querySelector('.sidebar-link[data-section="groups"]'),
            memberships: document.querySelector('.sidebar-link[data-section="memberships"]'),
            practices: document.querySelector('.sidebar-link[data-section="practices"]'),
            schedule: document.querySelector('.sidebar-link[data-section="schedule"]'),
            directions: document.getElementById('directionsLink'),
            users: document.getElementById('usersLink'),
            roles: document.getElementById('rolesLink')
        };
        
        Object.keys(sectionLinks).forEach(section => {
            const link = sectionLinks[section];
            if (link) {
                const isVisible = currentRolePermissions.visibility[section];
                link.style.display = isVisible ? 'flex' : 'none';
            }
        });
        
        // Показываем кнопку создания админа только для super_admin
        const createAdminBtn = document.getElementById('createAdminBtn');
        if (createAdminBtn && userRole === 'super_admin') {
            createAdminBtn.style.display = 'inline-flex';
        }
        
        // Обновляем badge посещаемости после применения прав
        setTimeout(() => updatePendingAttendanceBadge(), 500);
        
    } catch (error) {
        console.error('Ошибка применения прав:', error);
        initUserManagementFallback();
    }
}

// Дефолтная логика видимости (fallback)
function initUserManagementFallback() {
    const usersLink = document.getElementById('usersLink');
    const directionsLink = document.getElementById('directionsLink');
    const paymentsLink = document.querySelector('.sidebar-link[data-section="payments"]');
    const createAdminBtn = document.getElementById('createAdminBtn');
    const userRole = getUserRole();
    
    // Показываем вкладку "Пользователи" только для admin и super_admin
    if (usersLink && ['admin', 'super_admin'].includes(userRole)) {
        usersLink.style.display = 'flex';
    }
    
    // Показываем вкладку "Направления" только для super_admin
    if (directionsLink && userRole === 'super_admin') {
        directionsLink.style.display = 'flex';
    }
    
    // Показываем вкладку "Управление ролями" только для admin и super_admin
    const rolesLink = document.getElementById('rolesLink');
    if (rolesLink && ['admin', 'super_admin'].includes(userRole)) {
        rolesLink.style.display = 'flex';
    }
    
    // Скрываем "Оплаты" для менеджера по продажам
    if (paymentsLink && userRole === 'sales_manager') {
        paymentsLink.style.display = 'none';
    }
    
    // Показываем кнопку создания админа только для super_admin
    if (createAdminBtn && userRole === 'super_admin') {
        createAdminBtn.style.display = 'inline-flex';
    }
    
    // Обновляем badge посещаемости
    setTimeout(() => updatePendingAttendanceBadge(), 500);
}

// Алиас для обратной совместимости
function initUserManagement() {
    applySidebarVisibility();
}

// Отобразить текущего пользователя
function displayCurrentUser() {
    const userName = localStorage.getItem('userName');
    const userRole = localStorage.getItem('userRole');
    
    // Обновляем имя пользователя справа
    const userNameElement = document.getElementById('currentUserName');
    if (userNameElement) {
        userNameElement.textContent = userName || 'Пользователь';
    }
    
    // Обновляем роль под именем (розовым)
    const userRoleElement = document.getElementById('currentUserRole');
    if (userRoleElement) {
        userRoleElement.textContent = getRoleText(userRole);
    }
}

console.log('✅ Sidebar модуль загружен');

