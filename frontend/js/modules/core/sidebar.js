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
            membership_actions: document.querySelector('.sidebar-link[data-section="membership-actions"]'),
            groups: document.querySelector('.sidebar-link[data-section="groups"]'),
            memberships: document.querySelector('.sidebar-link[data-section="memberships"]'),
            schedule: document.querySelector('.sidebar-link[data-section="schedule"]'),
            lesson_review: document.getElementById('lessonReviewLink'),
            cashbox: document.querySelector('.sidebar-link[data-section="cashbox"]'),
            salary: document.getElementById('salaryLink'),
            blog: document.querySelector('.sidebar-link[data-section="blog"]'),
            activity_logs: document.querySelector('.sidebar-link[data-section="activity-logs"]'),
            bot: document.querySelector('.sidebar-link[data-section="bot"]'), // ✅ Добавлено для управления видимостью через API
            directions: document.getElementById('directionsLink'),
            users: document.getElementById('usersLink'),
            roles: document.getElementById('rolesLink'),
            analytics: document.getElementById('analyticsLink')
        };

        const teacherAllowedSections = new Set(['students', 'schedule']);

        // Дефолтные значения для админов (если поле отсутствует в API)
        const adminDefaultVisibility = {
            users: true,
            roles: true,
            activity_logs: true,
            analytics: true,
            lesson_review: true,
            cashbox: true,
            salary: true,
            membership_actions: true
        };

        // Разделы, которые ДОЛЖНЫ быть видны для определенных ролей, игнорируя API (Anti-Lockout)
        const forcedVisibility = {
            'sales_manager': ['membership_actions'],
            'admin': ['users', 'activity_logs', 'analytics', 'lesson_review', 'cashbox', 'salary', 'membership_actions'],
            'super_admin': ['users', 'activity_logs', 'analytics', 'lesson_review', 'cashbox', 'salary', 'membership_actions']
        };

        Object.keys(sectionLinks).forEach(section => {
            const link = sectionLinks[section];
            if (link) {
                let isVisible;
                if (userRole === 'teacher') {
                    isVisible = teacherAllowedSections.has(section);
                } else {
                    // Проверяем принудительную видимость
                    const roleForcedSections = forcedVisibility[userRole];
                    const isForced = roleForcedSections && roleForcedSections.includes(section);

                    if (isForced) {
                        // ✅ Всегда показываем, если раздел в списке принудительных
                        isVisible = true;
                    } else {
                        // Иначе используем значение из API
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

    // Скрываем вкладку "Управление ролями" для всех пользователей
    const rolesLink = document.getElementById('rolesLink');
    if (rolesLink) {
        rolesLink.style.display = 'none';
        rolesLink.classList.add('hidden-by-policy'); // Маркер для отладки
    }

    // Вкладка "Действия" (Activity Logs)
    const activityLink = document.querySelector('.sidebar-link[data-section="activity-logs"]');
    if (activityLink) {
        if (['admin', 'super_admin'].includes(userRole)) {
            activityLink.style.display = 'flex';
        } else {
            activityLink.style.display = 'none';
        }
    }

    // Вкладка "Аналитика"
    const analyticsLink = document.getElementById('analyticsLink');
    if (analyticsLink) {
        if (['admin', 'super_admin'].includes(userRole)) {
            analyticsLink.style.display = 'flex';
        } else {
            analyticsLink.style.display = 'none';
        }
    }

    const salaryLink = document.getElementById('salaryLink');
    if (salaryLink) {
        salaryLink.style.display = ['admin', 'super_admin'].includes(userRole) ? 'flex' : 'none';
    }


    // Показываем кнопку создания админа только для super_admin
    if (createAdminBtn && userRole === 'super_admin') {
        createAdminBtn.style.display = 'inline-flex';
    }

    // Вкладка «На подтверждении»
    const lessonReviewLink = document.getElementById('lessonReviewLink');
    if (lessonReviewLink) {
        if (['admin', 'super_admin'].includes(userRole)) {
            lessonReviewLink.style.display = 'flex';
        } else {
            lessonReviewLink.style.display = 'none';
        }
    }

    const cashboxLink = document.getElementById('cashboxLink');
    if (cashboxLink) {
        if (['admin', 'super_admin'].includes(userRole)) {
            cashboxLink.style.display = 'flex';
        } else {
            cashboxLink.style.display = 'none';
        }
    }

    // Обновляем badge посещаемости (для всех, кроме студентов)
    if (userRole !== 'student') {
        setTimeout(() => {
            updatePendingAttendanceBadge();
            if (typeof updatePendingReviewBadge === 'function') updatePendingReviewBadge();
        }, 500);
    }
}

// Алиас для обратной совместимости
function initUserManagement() {
    applySidebarVisibility();
}

function setTeacherDefaultView() {
    const activeLink = document.querySelector('.sidebar-link.active');
    if (activeLink) {
        activeLink.classList.remove('active');
    }

    const targetLink = document.querySelector('.sidebar-link[data-section="schedule"]') ||
        document.querySelector('.sidebar-link[data-section="students"]');

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
