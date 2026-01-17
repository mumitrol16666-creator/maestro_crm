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
            cashbox: document.querySelector('.sidebar-link[data-section="cashbox"]'),
            blog: document.querySelector('.sidebar-link[data-section="blog"]'),
            directions: document.getElementById('directionsLink'),
            users: document.getElementById('usersLink'),
            roles: document.getElementById('rolesLink')
        };

        const teacherAllowedSections = new Set(['students', 'schedule']);

        // Дефолтные значения для админов (если поле отсутствует в API)
        const adminDefaultVisibility = {
            blog: true,
            cashbox: true,
            users: true,
            roles: true
        };

        Object.keys(sectionLinks).forEach(section => {
            const link = sectionLinks[section];
            if (link) {
                let isVisible;
                if (userRole === 'teacher') {
                    isVisible = teacherAllowedSections.has(section);
                } else {
                    // ✅ Для админов приоритет дефолтным значениям для критичных разделов (blog, cashbox, users, roles)
                    // Это гарантирует, что даже если в БД случайно установлено false, админы всегда будут видеть эти разделы
                    const isCriticalAdminSection = ['admin', 'super_admin'].includes(userRole) &&
                        ['blog', 'cashbox', 'users', 'roles'].includes(section);

                    if (isCriticalAdminSection && adminDefaultVisibility[section] === true) {
                        // Для критичных разделов всегда показываем админам, игнорируя API если там false
                        isVisible = true;
                    } else {
                        // Используем значение из API, если есть, иначе дефолтное для админов
                        const apiValue = currentRolePermissions.visibility?.[section];
                        if (apiValue !== undefined) {
                            isVisible = apiValue;
                        } else if (['admin', 'super_admin'].includes(userRole) && adminDefaultVisibility[section] !== undefined) {
                            isVisible = adminDefaultVisibility[section];
                        } else {
                            isVisible = false;
                        }
                    }
                }
                link.style.display = isVisible ? 'flex' : 'none';
            }
        });

        if (userRole === 'teacher') {
            setTeacherDefaultView();
        }


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
        setTeacherDefaultView();
    }

    const usersLink = document.getElementById('usersLink');
    const directionsLink = document.getElementById('directionsLink');
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
        const isBlogVisible = ['admin', 'super_admin'].includes(userRole);
        blogLink.style.display = isBlogVisible ? 'flex' : 'none';
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

function setTeacherDefaultView() {
    const dashboardSection = document.getElementById('section-dashboard');
    if (dashboardSection) {
        dashboardSection.classList.add('hidden');
        dashboardSection.style.display = 'none';
    }

    const activeLink = document.querySelector('.sidebar-link.active');
    if (activeLink && activeLink.dataset.section === 'dashboard') {
        activeLink.classList.remove('active');
    }

    const targetLink = document.querySelector('.sidebar-link[data-section="students"]') ||
        document.querySelector('.sidebar-link[data-section="schedule"]');

    if (!targetLink || targetLink.classList.contains('active')) {
        return;
    }

    setTimeout(() => {
        targetLink.click();
    }, 0);
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


