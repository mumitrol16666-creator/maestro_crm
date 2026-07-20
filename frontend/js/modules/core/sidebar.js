// =====================================================
// SIDEBAR MODULE - Управление видимостью sidebar
// =====================================================

const SIDEBAR_NAV_GROUPS = [
    { title: 'Работа', sections: ['dashboard', 'schedule', 'lesson-review'] },
    { title: 'Школа', sections: ['bookings', 'students', 'groups', 'whatsapp-reminders'] },
    { title: 'Финансы', sections: ['membership-actions', 'cashbox', 'shop', 'salary'] },
    { title: 'Управление', sections: ['analytics', 'users', 'directions', 'student-history', 'activity-logs'] },
];

function syncSidebarGroupVisibility() {
    document.querySelectorAll('.sidebar-nav-group').forEach(group => {
        const hasVisibleLinks = Array.from(group.querySelectorAll('.sidebar-link[data-section]'))
            .some(link => link.style.display !== 'none');
        group.style.display = hasVisibleLinks ? '' : 'none';
    });
}

function organizeSidebarNavigation() {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav || nav.dataset.grouped === 'true') return;

    const bySection = new Map();
    Array.from(nav.querySelectorAll('.sidebar-link[data-section]')).forEach(link => {
        const section = link.dataset.section;
        if (bySection.has(section)) {
            link.remove();
            return;
        }
        bySection.set(section, link);
    });

    const directionLabel = bySection.get('directions')?.querySelector('span');
    if (directionLabel) directionLabel.textContent = 'Направления и тарифы';
    const activityLabel = bySection.get('activity-logs')?.querySelector('span');
    if (activityLabel) activityLabel.textContent = 'Журнал действий';

    nav.replaceChildren();
    SIDEBAR_NAV_GROUPS.forEach(groupMeta => {
        const group = document.createElement('section');
        group.className = 'sidebar-nav-group';
        group.innerHTML = `<h3 class="sidebar-nav-label">${groupMeta.title}</h3>`;
        groupMeta.sections.forEach(section => {
            const link = bySection.get(section);
            if (link) {
                group.appendChild(link);
                bySection.delete(section);
            }
        });
        if (group.querySelector('.sidebar-link')) nav.appendChild(group);
    });

    if (bySection.size) {
        const group = document.createElement('section');
        group.className = 'sidebar-nav-group';
        group.innerHTML = '<h3 class="sidebar-nav-label">Дополнительно</h3>';
        bySection.forEach(link => group.appendChild(link));
        nav.appendChild(group);
    }

    nav.dataset.grouped = 'true';
    syncSidebarGroupVisibility();
}

organizeSidebarNavigation();

// Применить видимость разделов sidebar на основе прав роли
async function applySidebarVisibility() {
    try {
        const userRole = getUserRole();
        const token = getAuthToken();

        // ⚡ СНАЧАЛА показываем дефолтную видимость (мгновенно!)
        initUserManagementFallback();
        syncSidebarGroupVisibility();

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
            shop: document.querySelector('.sidebar-link[data-section="shop"]'),
            whatsapp_reminders: document.querySelector('.sidebar-link[data-section="whatsapp-reminders"]'),
            groups: document.querySelector('.sidebar-link[data-section="groups"]'),
            memberships: document.querySelector('.sidebar-link[data-section="memberships"]'),
            schedule: document.querySelector('.sidebar-link[data-section="schedule"]'),
            lesson_review: document.getElementById('lessonReviewLink'),
            cashbox: document.querySelector('.sidebar-link[data-section="cashbox"]'),
            salary: document.getElementById('salaryLink'),
            blog: document.querySelector('.sidebar-link[data-section="blog"]'),
            activity_logs: document.querySelector('.sidebar-link[data-section="activity-logs"]'),
            student_history: document.querySelector('.sidebar-link[data-section="student-history"]'),
            bot: document.querySelector('.sidebar-link[data-section="bot"]'), // ✅ Добавлено для управления видимостью через API
            directions: document.getElementById('directionsLink'),
            users: document.getElementById('usersLink'),
            analytics: document.getElementById('analyticsLink')
        };

        const teacherAllowedSections = new Set(['students', 'schedule']);

        // Дефолтные значения для админов (если поле отсутствует в API)
        const adminDefaultVisibility = {
            users: true,
            activity_logs: true,
            student_history: true,
            analytics: true,
            lesson_review: true,
            cashbox: true,
            salary: true,
            membership_actions: true,
            shop: true,
            whatsapp_reminders: true
        };

        // Разделы, которые ДОЛЖНЫ быть видны для определенных ролей, игнорируя API (Anti-Lockout)
        const forcedVisibility = {
            'sales_manager': ['membership_actions', 'shop'],
            'admin': ['users', 'activity_logs', 'student_history', 'analytics', 'lesson_review', 'cashbox', 'salary', 'membership_actions', 'shop', 'whatsapp_reminders'],
            'super_admin': ['users', 'activity_logs', 'student_history', 'analytics', 'lesson_review', 'cashbox', 'salary', 'membership_actions', 'shop', 'whatsapp_reminders']
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
        syncSidebarGroupVisibility();

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

    // Показываем вкладку "Тарифы" только для super_admin
    if (directionsLink && userRole === 'super_admin') {
        directionsLink.style.display = 'flex';
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

    const studentHistoryLink = document.querySelector('.sidebar-link[data-section="student-history"]');
    if (studentHistoryLink) {
        if (['admin', 'super_admin'].includes(userRole)) {
            studentHistoryLink.style.display = 'flex';
        } else {
            studentHistoryLink.style.display = 'none';
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

    const whatsappRemindersLink = document.querySelector('.sidebar-link[data-section="whatsapp-reminders"]');
    if (whatsappRemindersLink) {
        whatsappRemindersLink.style.display = ['admin', 'super_admin'].includes(userRole) ? 'flex' : 'none';
    }

    const shopLink = document.getElementById('shopLink');
    if (shopLink) {
        shopLink.style.display = ['sales_manager', 'admin', 'super_admin'].includes(userRole) ? 'flex' : 'none';
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
    syncSidebarGroupVisibility();
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

    const sidebarName = document.getElementById('sidebarCurrentUserName');
    const sidebarRole = document.getElementById('sidebarCurrentUserRole');
    const sidebarAvatar = document.getElementById('sidebarCurrentUserAvatar');
    const visibleName = userName || 'Пользователь';
    if (sidebarName) sidebarName.textContent = visibleName;
    if (sidebarRole) sidebarRole.textContent = getRoleText(userRole);
    if (sidebarAvatar) sidebarAvatar.textContent = visibleName.trim().charAt(0).toUpperCase() || 'М';
}
