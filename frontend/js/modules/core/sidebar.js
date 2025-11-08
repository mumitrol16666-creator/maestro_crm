// =====================================================
// SIDEBAR MODULE - Управление видимостью sidebar
// =====================================================

// Применить видимость разделов sidebar на основе прав роли
async function applySidebarVisibility() {
    try {
        const userRole = getUserRole();
        const token = getAuthToken();
        
        // ⚡ СНАЧАЛА показываем дефолтную видимость (мгновенно!)
        initUserManagementFallback();
        
        // ПОТОМ загружаем точные права из API В ФОНЕ
        const response = await fetch(`${API_URL}/permissions`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        
        if (!data.success) {
            return;
        }
        
        // Находим права для текущей роли
        const currentRolePermissions = data.permissions.find(p => p.role === userRole);
        
        if (!currentRolePermissions) {
            console.warn(`⚠️ Права для роли "${userRole}" не найдены в API`);
            return;
        }
        
        // Права загружены
        
        // Применяем точную видимость разделов из API
        const sectionLinks = {
            dashboard: document.querySelector('.sidebar-link[data-section="dashboard"]'),
            bookings: document.querySelector('.sidebar-link[data-section="bookings"]'),
            students: document.querySelector('.sidebar-link[data-section="students"]'),
            groups: document.querySelector('.sidebar-link[data-section="groups"]'),
            memberships: document.querySelector('.sidebar-link[data-section="memberships"]'),
            practices: document.querySelector('.sidebar-link[data-section="practices"]'),
            schedule: document.querySelector('.sidebar-link[data-section="schedule"]'),
            payments: document.querySelector('.sidebar-link[data-section="payments"]'),
            cashbox: document.querySelector('.sidebar-link[data-section="cashbox"]'),
            blog: document.querySelector('.sidebar-link[data-section="blog"]'),
            directions: document.getElementById('directionsLink'),
            users: document.getElementById('usersLink'),
            roles: document.getElementById('rolesLink')
        };
        
        const teacherAllowedSections = new Set(['students', 'schedule']);
        
        Object.keys(sectionLinks).forEach(section => {
            const link = sectionLinks[section];
            if (link) {
                const isVisible = userRole === 'teacher'
                    ? teacherAllowedSections.has(section)
                    : currentRolePermissions.visibility?.[section];
                // Видимость определена
                link.style.display = isVisible ? 'flex' : 'none';
            }
        });
        
        
    } catch (error) {
        console.error('❌ Ошибка загрузки прав из API:', error);
    }
}

// Дефолтная логика видимости (fallback)
function initUserManagementFallback() {
    const userRole = getUserRole();
    
    // Для преподавателя - показываем только разрешенные разделы
    if (userRole === 'teacher') {
        console.log('📌 FALLBACK для teacher: показываем только разрешенные разделы');
        const allowedSections = new Set(['students', 'schedule']);
        document.querySelectorAll('.sidebar-link[data-section]').forEach(link => {
            const section = link.getAttribute('data-section');
            link.style.display = allowedSections.has(section) ? 'flex' : 'none';
        });
    }
    
    const usersLink = document.getElementById('usersLink');
    const directionsLink = document.getElementById('directionsLink');
    const paymentsLink = document.querySelector('.sidebar-link[data-section="payments"]');
    const createAdminBtn = document.getElementById('createAdminBtn');
    
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
    
    // Скрываем "Платежи" и "Касса" для менеджера по продажам и преподавателя
    if (paymentsLink && ['sales_manager', 'teacher'].includes(userRole)) {
        paymentsLink.style.display = 'none';
    }
    
    const cashboxLink = document.querySelector('.sidebar-link[data-section="cashbox"]');
    if (cashboxLink) {
        if (['admin', 'super_admin'].includes(userRole)) {
            cashboxLink.style.display = 'flex';
        } else {
            cashboxLink.style.display = 'none';
        }
    }
    
    
    // Блог доступен для админов
    const blogLink = document.querySelector('.sidebar-link[data-section="blog"]');
    if (blogLink) {
        if (['admin', 'super_admin'].includes(userRole)) {
            blogLink.style.display = 'flex';
        } else {
            blogLink.style.display = 'none';
        }
    }
    
    // Показываем кнопку создания админа только для super_admin
    if (createAdminBtn && userRole === 'super_admin') {
        createAdminBtn.style.display = 'inline-flex';
    }
    
    // Обновляем badge посещаемости (для всех, кроме студентов)
    if (userRole !== 'student') {
        setTimeout(() => updatePendingAttendanceBadge(), 500);
    }
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


