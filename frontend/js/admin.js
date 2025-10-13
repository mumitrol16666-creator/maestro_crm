// =====================================================
// АДМИН-ПАНЕЛЬ - ЛОГИКА С BACKEND API
// =====================================================
// API_URL, getAuthToken, getUserRole и другие базовые функции
// теперь в modules/core/api.js

// =====================================================
// ✅ copyToClipboard и customConfirm теперь в modules/core/utils.js

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

// Примечание: showNotification определена в script.js
// Эта локальная версия удалена, чтобы использовать глобальную с поддержкой HTML

// ✅ getUserRole и isSuperAdmin теперь в modules/core/api.js

if (!checkAdminAccess()) {
    // Останавливаем выполнение скрипта
    throw new Error('Access denied');
}

// ==================== NAVIGATION ====================
const sidebarLinks = document.querySelectorAll('.sidebar-link[data-section]');
const sections = document.querySelectorAll('.admin-section');
const pageTitle = document.querySelector('.admin-page-title');

sidebarLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const sectionId = link.dataset.section;
        
        // Обновляем активную ссылку
        sidebarLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        
        // Показываем нужную секцию
        sections.forEach(s => s.classList.add('hidden'));
        document.getElementById(`section-${sectionId}`).classList.remove('hidden');
        
        // Обновляем заголовок
        pageTitle.textContent = link.querySelector('span').textContent;
        
        // Загружаем данные для секции
        loadSectionData(sectionId);
    });
});

// Sidebar Toggle (мобильные)
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebar = document.getElementById('adminSidebar');

if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
    });
}

// Logout
document.getElementById('adminLogout').addEventListener('click', async () => {
    if (await customConfirm('Выйти из админ-панели?')) {
        localStorage.clear();
        window.location.href = 'login.html';
    }
});

// ==================== API REQUESTS ====================
// ✅ fetchBookings, fetchStudents, fetchGroups теперь в modules/core/data.js
// ✅ fetchStats теперь в modules/dashboard/dashboard.js

// ==================== RENDER FUNCTIONS ====================

// Заявки
async function renderBookings(filter = null) {
    const table = document.getElementById('bookingsTable');
    table.innerHTML = '<tr><td colspan="6" style="text-align:center;">Загрузка...</td></tr>';
    
    const bookings = await fetchBookings(filter);
    
    // Обновляем badge новых заявок
    const newBookingsCount = bookings.filter(b => b.status === 'new').length;
    updateNewBookingsBadge(newBookingsCount);
    
    if (bookings.length === 0) {
        table.innerHTML = '<tr><td colspan="6" style="text-align:center; opacity:0.5;">Нет заявок</td></tr>';
        return;
    }
    
    const userRole = getUserRole();
    const isAdmin = ['admin', 'super_admin'].includes(userRole);
    
    // Показать/скрыть колонку "Действия"
    const actionsColumn = document.getElementById('bookingsActionsColumn');
    if (actionsColumn) {
        actionsColumn.style.display = isAdmin ? '' : 'none';
    }
    
    const canEditSource = isSuperAdmin();
    
    table.innerHTML = bookings.map(booking => `
        <tr>
            <td>${booking.name}</td>
            <td>${booking.phone}</td>
            <td>${booking.direction}</td>
            <td>
                ${canEditSource ? `
                    <select class="source-select" data-booking-id="${booking._id}" data-current-source="${booking.source || ''}">
                        <option value="" ${!booking.source ? 'selected' : ''}>Не указан</option>
                        <option value="Телефонный звонок" ${booking.source === 'Телефонный звонок' ? 'selected' : ''}>Телефонный звонок</option>
                        <option value="WhatsApp" ${booking.source === 'WhatsApp' ? 'selected' : ''}>WhatsApp</option>
                        <option value="Instagram Direct" ${booking.source === 'Instagram Direct' ? 'selected' : ''}>Instagram Direct</option>
                        <option value="Личное обращение" ${booking.source === 'Личное обращение' ? 'selected' : ''}>Личное обращение</option>
                        <option value="Сайт" ${booking.source === 'Сайт' ? 'selected' : ''}>Сайт</option>
                        <option value="Рекомендация" ${booking.source === 'Рекомендация' ? 'selected' : ''}>Рекомендация</option>
                        <option value="1fit" ${booking.source === '1fit' ? 'selected' : ''}>1fit</option>
                        <option value="Другое" ${booking.source === 'Другое' ? 'selected' : ''}>Другое</option>
                    </select>
                ` : `${booking.source || '—'}`}
            </td>
            <td>${formatDateTime(booking.createdAt)}</td>
            <td>
                <select class="status-select" data-booking-id="${booking._id}" data-current-status="${booking.status}">
                    <option value="new" ${booking.status === 'new' ? 'selected' : ''}>Новая</option>
                    <option value="processed" ${booking.status === 'processed' ? 'selected' : ''}>Думает</option>
                    <option value="trial" ${booking.status === 'trial' ? 'selected' : ''}>Пробное занятие</option>
                    <option value="rejected" ${booking.status === 'rejected' ? 'selected' : ''}>Отклонено</option>
                </select>
            </td>
            ${isAdmin ? `
            <td class="table-actions">
                    <button class="table-btn danger" onclick="deleteBooking('${booking._id}', '${booking.name}')">Удалить</button>
            </td>
            ` : '<td></td>'}
        </tr>
    `).join('');
    
    // Добавляем обработчики на select'ы статусов
    document.querySelectorAll('.status-select').forEach(select => {
        select.addEventListener('change', async (e) => {
            const bookingId = e.target.dataset.bookingId;
            const currentStatus = e.target.dataset.currentStatus;
            const newStatus = e.target.value;
            
            // Подтверждение изменения
            const confirmMessage = `Изменить статус заявки с "${getStatusText(currentStatus)}" на "${getStatusText(newStatus)}"?`;
            
            if (await customConfirm(confirmMessage, {icon: 'warning'})) {
                // Обновляем атрибут для цвета перед отправкой
                e.target.dataset.currentStatus = newStatus;
                await changeBookingStatusDirect(bookingId, newStatus);
            } else {
                // Вернуть старое значение
                e.target.value = currentStatus;
            }
        });
    });
    
    // Добавляем обработчики на select'ы источников (только для Super Admin)
    document.querySelectorAll('.source-select').forEach(select => {
        select.addEventListener('change', async (e) => {
            const bookingId = e.target.dataset.bookingId;
            const currentSource = e.target.dataset.currentSource;
            const newSource = e.target.value;
            
            // Подтверждение изменения
            const confirmMessage = `Изменить источник заявки на "${newSource || 'Не указан'}"?`;
            
            if (await customConfirm(confirmMessage, {icon: 'warning'})) {
                await changeBookingSource(bookingId, newSource);
            } else {
                // Вернуть старое значение
                e.target.value = currentSource;
            }
        });
    });
}

// Переменная для хранения всех учеников и их статистики
let allStudentsData = [];
let currentStudentFilter = 'all';

// Ученики
async function renderStudents(searchQuery = '') {
    const table = document.getElementById('studentsTable');
    table.innerHTML = '<tr><td colspan="6" style="text-align:center;">Загрузка...</td></tr>';
    
    // ⚡ ОПТИМИЗАЦИЯ: Сначала загружаем учеников
    const allUsers = await fetchStudents(searchQuery);
    
    // ФИЛЬТРУЕМ только учеников (роль = student)
    const students = allUsers.filter(user => user.role === 'student');
    
    if (students.length === 0) {
        table.innerHTML = '<tr><td colspan="6" style="text-align:center; opacity:0.5;">Нет учеников</td></tr>';
        return;
    }
    
    // ⚡ ОПТИМИЗАЦИЯ: Загружаем статистику параллельно с отрисовкой
    // Сначала отображаем учеников без статистики, потом обновляем
    let statsMap = {};
    
    // Показываем учеников сразу (без статистики)
    renderStudentsTable(students, {});
    
    // Загружаем статистику в фоне
    if (students.length > 0) {
        try {
            const studentIds = students.map(s => s._id);
            const response = await fetch(`${API_URL}/students/stats/batch-light`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getAuthToken()}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ studentIds })
            });
            
            if (response.ok) {
                const data = await response.json();
                statsMap = data.stats || {};
                // Обновляем таблицу со статистикой
                renderStudentsTable(students, statsMap);
            }
        } catch (error) {
            console.error('Error fetching batch stats:', error);
        }
        }
    }

// Вспомогательная функция для отрисовки таблицы учеников
function renderStudentsTable(students, statsMap) {
    const table = document.getElementById('studentsTable');
    
    // Присоединить статистику к ученикам
    const studentsWithStats = students.map(student => ({
        ...student,
        stats: statsMap[student._id] || {
            monthMissed: 0
        }
    }));
    
    // Сохранить для фильтрации
    allStudentsData = studentsWithStats;
    
    // Применить фильтр
    const filteredStudents = applyStudentFilter(studentsWithStats, currentStudentFilter);
    
    if (filteredStudents.length === 0) {
        table.innerHTML = '<tr><td colspan="6" style="text-align:center; opacity:0.5;">Нет учеников по данному фильтру</td></tr>';
        return;
    }
    
    table.innerHTML = filteredStudents.map(student => {
        const groupNames = student.groups
            .filter(g => g.status === 'active')
            .map(g => g.groupId?.name || 'Группа')
            .join(', ') || 'Нет групп';
        
        const membership = student.activeMembership;
        const membershipText = membership 
            ? `${membership.classesRemaining} ${getDeclension(membership.classesRemaining, 'занятие', 'занятия', 'занятий')}`
            : 'Нет абонемента';
        
        const membershipClass = getMembershipClass(membership);
        
        // Статистика
        const stats = student.stats || {};
        const monthMissed = stats.monthMissed || 0;
        
        return `
            <tr data-student-id="${student._id}" data-absences="${monthMissed}">
                <td>${student.name}</td>
                <td>${student.phone}</td>
                <td>${groupNames}</td>
                <td><span class="membership-badge ${membershipClass}">${membershipText}</span></td>
                <td><span style="color: ${monthMissed >= 3 ? '#ef4444' : monthMissed >= 1 ? '#f59e0b' : '#64748b'}; font-weight: 600;">${monthMissed}</span></td>
                <td class="table-actions">
                    <button class="table-btn" onclick="viewStudent('${student._id}')">Профиль</button>
                </td>
            </tr>
        `;
    }).join('');
}

// Форматировать дату последнего визита
function formatLastVisit(date) {
    if (!date) return '<span style="color: #ef4444;">Никогда</span>';
    
    const days = getDaysSinceLastVisit(date);
    
    if (days === 0) return '<span style="color: #10b981;">Сегодня</span>';
    if (days === 1) return 'Вчера';
    if (days < 7) return `${days} ${getDeclension(days, 'день', 'дня', 'дней')} назад`;
    if (days < 14) return '<span style="color: #f59e0b;">Неделю назад</span>';
    if (days < 30) return '<span style="color: #ef4444;">' + Math.floor(days / 7) + ' ' + getDeclension(Math.floor(days / 7), 'неделю', 'недели', 'недель') + ' назад</span>';
    return '<span style="color: #ef4444;">Более месяца назад</span>';
}

// Получить количество дней с последнего визита
function getDaysSinceLastVisit(date) {
    if (!date) return 999;
    const lastDate = new Date(date);
    const today = new Date();
    const diffTime = today - lastDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
}

// Применить фильтр учеников
function applyStudentFilter(students, filter) {
    switch(filter) {
        case 'with-absences':
            return students.filter(s => (s.stats?.monthMissed || 0) > 0);
        case 'inactive':
            // Неактивные = без абонемента или истек
            return students.filter(s => {
                const membership = s.activeMembership;
                return !membership || membership.classesRemaining === 0;
            });
        case 'ending-soon':
            // Заканчивается абонемент = осталось 1-2 занятия
            return students.filter(s => {
                const membership = s.activeMembership;
                return membership && membership.classesRemaining > 0 && membership.classesRemaining <= 2;
            });
        case 'all':
        default:
            return students;
    }
}

// Фильтровать учеников
function filterStudents(filter) {
    currentStudentFilter = filter;
    
    // Обновить активную кнопку
    document.querySelectorAll('[data-filter]').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.filter === filter) {
            btn.classList.add('active');
        }
    });
    
    // Применить фильтр
    const table = document.getElementById('studentsTable');
    const filteredStudents = applyStudentFilter(allStudentsData, filter);
    
    if (filteredStudents.length === 0) {
        table.innerHTML = '<tr><td colspan="6" style="text-align:center; opacity:0.5;">Нет учеников по данному фильтру</td></tr>';
        return;
    }
    
    table.innerHTML = filteredStudents.map(student => {
        const groupNames = student.groups
            .filter(g => g.status === 'active')
            .map(g => g.groupId?.name || 'Группа')
            .join(', ') || 'Нет групп';
        
        const membership = student.activeMembership;
        const membershipText = membership 
            ? `${membership.classesRemaining} ${getDeclension(membership.classesRemaining, 'занятие', 'занятия', 'занятий')}`
            : 'Нет абонемента';
        
        const membershipClass = getMembershipClass(membership);
        
        // Статистика
        const stats = student.stats || {};
        const monthMissed = stats.monthMissed || 0;
        
        return `
            <tr data-student-id="${student._id}" data-absences="${monthMissed}">
                <td>${student.name}</td>
                <td>${student.phone}</td>
                <td>${groupNames}</td>
                <td><span class="membership-badge ${membershipClass}">${membershipText}</span></td>
                <td><span style="color: ${monthMissed >= 3 ? '#ef4444' : monthMissed >= 1 ? '#f59e0b' : '#64748b'}; font-weight: 600;">${monthMissed}</span></td>
                <td class="table-actions">
                    <button class="table-btn" onclick="viewStudent('${student._id}')">Профиль</button>
                </td>
            </tr>
        `;
    }).join('');
}

// Группы
async function renderGroups() {
    const grid = document.getElementById('groupsGrid');
    grid.innerHTML = '<p style="text-align:center; opacity:0.5;">Загрузка...</p>';
    
    const groups = await fetchGroups();
    
    if (groups.length === 0) {
        grid.innerHTML = '<p style="text-align:center; opacity:0.5;">Нет групп</p>';
        return;
    }
    
    grid.innerHTML = groups.map(group => `
        <div class="group-card-admin">
            <div class="group-card-header">
                <h4 class="group-card-title">${group.name}</h4>
                <p class="group-card-subtitle">${group.instructor}</p>
            </div>
            <div class="group-card-stats">
                <div class="group-stat-row">
                    <span class="group-stat-label">Расписание:</span>
                    <span>${group.getScheduleText ? group.getScheduleText() : formatSchedule(group.schedule)}</span>
                </div>
                <div class="group-stat-row">
                    <span class="group-stat-label">Учеников:</span>
                    <span>${group.currentStudents}</span>
                </div>
            </div>
            <div class="table-actions">
                <button class="table-btn" onclick="editGroup('${group._id}')">Редактировать</button>
                <button class="table-btn" onclick="viewGroupStudents('${group._id}')">Ученики</button>
                <button class="table-btn" onclick="deleteGroup('${group._id}', '${group.name}')" style="background: #dc3545;">Удалить</button>
            </div>
        </div>
    `).join('');
}

// ==================== ГРУППЫ: CRUD ОПЕРАЦИИ ====================

// Массив для хранения расписаний в форме
let scheduleItems = [];

// Открыть модалку создания группы
function openGroupModal() {
    scheduleItems = [];
    document.getElementById('groupId').value = '';
    document.getElementById('groupForm').reset();
    document.getElementById('groupModalTitle').textContent = 'СОЗДАТЬ ГРУППУ';
    document.getElementById('scheduleList').innerHTML = '';
    document.querySelector('#groupForm button[type="submit"]').textContent = 'СОЗДАТЬ';
    
    // Загрузить преподавателей
    loadTeachersForGroup();
    
    document.getElementById('groupModal').classList.add('show');
}

// Закрыть модалку группы
function closeGroupModal() {
    document.getElementById('groupModal').classList.remove('show');
    scheduleItems = [];
}

// Загрузить преподавателей для выбора
async function loadTeachersForGroup() {
    try {
        const response = await fetch(`${API_URL}/students?role=teacher`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        const data = await response.json();
        const teachers = data.students || [];
        
        const select = document.getElementById('groupTeacher');
        select.innerHTML = '<option value="">Выберите преподавателя</option>';
        
        teachers.forEach(teacher => {
            const option = document.createElement('option');
            option.value = teacher._id;
            option.textContent = teacher.name;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Ошибка загрузки преподавателей:', error);
    }
}

// Добавить элемент расписания
function addScheduleItem() {
    const item = {
        id: Date.now(),
        dayOfWeek: 1, // Понедельник по умолчанию
        time: '18:00',
        duration: 90,
        isPractice: false  // Обычное занятие или практика
    };
    
    scheduleItems.push(item);
    renderScheduleList();
}

// Удалить элемент расписания
function removeScheduleItem(id) {
    scheduleItems = scheduleItems.filter(item => item.id !== id);
    renderScheduleList();
}

// Обновить элемент расписания
function updateScheduleItem(id, field, value) {
    const item = scheduleItems.find(item => item.id === id);
    if (item) {
        if (field === 'dayOfWeek' || field === 'duration') {
            item[field] = parseInt(value);
        } else if (field === 'isPractice') {
            item[field] = value === 'true' || value === true;
        } else {
            item[field] = value;
        }
    }
}

// Отобразить список расписаний
function renderScheduleList() {
    const container = document.getElementById('scheduleList');
    
    if (scheduleItems.length === 0) {
        container.innerHTML = '<p style="opacity: 0.5; text-align: center;">Расписание не добавлено</p>';
        return;
    }
    
    const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
    
    container.innerHTML = scheduleItems.map(item => `
        <div style="
            margin-bottom: 10px;
            padding: 15px;
            background: var(--bg-secondary);
            border-radius: 8px;
            border-left: 3px solid ${item.isPractice ? '#4d9beb' : '#eb4d77'};
        ">
            <div style="display: grid; grid-template-columns: 2fr 1fr 1fr auto; gap: 10px; margin-bottom: 10px;">
                <select class="admin-input" style="margin: 0;" onchange="updateScheduleItem(${item.id}, 'dayOfWeek', this.value)">
                    ${days.map((day, index) => `
                        <option value="${index + 1}" ${item.dayOfWeek === index + 1 ? 'selected' : ''}>${day}</option>
                    `).join('')}
                </select>
                
                <input type="time" class="admin-input" style="margin: 0;" value="${item.time}" 
                       onchange="updateScheduleItem(${item.id}, 'time', this.value)">
                
                <select class="admin-input" style="margin: 0;" onchange="updateScheduleItem(${item.id}, 'duration', this.value)">
                    <option value="60" ${item.duration === 60 ? 'selected' : ''}>60 мин</option>
                    <option value="90" ${item.duration === 90 ? 'selected' : ''}>90 мин</option>
                    <option value="120" ${item.duration === 120 ? 'selected' : ''}>120 мин</option>
                </select>
                
                <button type="button" class="table-btn" onclick="removeScheduleItem(${item.id})" 
                        style="padding: 8px 12px; margin: 0; background: #dc3545;">
                    ✕
                </button>
            </div>
            
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;">
                <input type="checkbox" ${item.isPractice ? 'checked' : ''} 
                       onchange="updateScheduleItem(${item.id}, 'isPractice', this.checked)"
                       style="cursor: pointer;">
                <span style="font-size: 0.9rem; opacity: 0.8;">Это практика (доступна всем ученикам)</span>
            </label>
        </div>
    `).join('');
}

// Обновить badge новых заявок
// ✅ updateNewBookingsBadge, updatePendingAttendanceBadge, renderDashboard теперь в modules/dashboard/dashboard.js

// ==================== HELPER FUNCTIONS ====================
// ✅ formatDate и formatDateTime теперь в modules/core/utils.js

// ✅ getStatusText, getMembershipClass, getDeclension и formatSchedule теперь в modules/core/utils.js

// ==================== ACTIONS ====================

// Изменить источник заявки (только Super Admin)
async function changeBookingSource(id, newSource) {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/bookings/${id}/source`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ source: newSource })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(`Источник изменен на "${newSource || 'Не указан'}"`);
            // Перезагружаем с текущим фильтром
            renderBookings(currentBookingFilter);
        } else {
            showNotification(notificationWithIcon('error', `Ошибка: ${data.error || 'Не удалось изменить источник'}`));
            // Перезагружаем для отката
            renderBookings(currentBookingFilter);
        }
    } catch (error) {
        console.error('Ошибка изменения источника:', error);
        showNotification(notificationWithIcon('error', 'Ошибка подключения к серверу'));
        // Перезагружаем для отката
        renderBookings(currentBookingFilter);
    }
}

// Изменить статус заявки напрямую (через select)
// Открыть модалку конвертации заявки
async function openConvertBookingModal(bookingId) {
    try {
        const token = getAuthToken();
        
        // Загрузить заявку
        const bookingResponse = await fetch(`${API_URL}/bookings/${bookingId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const data = await bookingResponse.json();
        const booking = data.booking;
        
        // Загрузить все группы
        const groupsResponse = await fetch(`${API_URL}/groups`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const groupsData = await groupsResponse.json();
        const allGroups = groupsData.groups || [];
        
        // Заполнить информацию о заявке
        const genderText = booking.gender ? (booking.gender === 'male' ? 'Мужчина' : 'Женщина') : 'Не указан';
        document.getElementById('convertBookingInfo').innerHTML = `
            <strong style="display: block; margin-bottom: 8px;">Заявка:</strong>
            <div style="font-size: 0.95em; opacity: 0.9;">
                <div>Имя: ${booking.name}</div>
                <div>Телефон: ${booking.phone}</div>
                <div>Направление: ${booking.direction}</div>
                <div>Пол: ${genderText}</div>
            </div>
        `;
        
        // Заполнить список групп
        const groupSelect = document.getElementById('convertGroupId');
        groupSelect.innerHTML = '<option value="">Выберите группу</option>';
        allGroups.forEach(group => {
            const option = document.createElement('option');
            option.value = group._id;
            option.textContent = `${group.name} (${group.direction})`;
            groupSelect.appendChild(option);
        });
        
        document.getElementById('convertBookingId').value = bookingId;
        document.getElementById('convertGender').value = booking.gender || '';
        document.getElementById('convertMembershipType').value = '';
        
        document.getElementById('convertBookingModal').classList.add('show');
    } catch (error) {
        console.error('Error loading booking:', error);
        showNotification(notificationWithIcon('error', 'Ошибка при загрузке заявки'));
    }
}

// Закрыть модалку конвертации
function closeConvertBookingModal() {
    document.getElementById('convertBookingModal').classList.remove('show');
}

// Обработчик формы конвертации
document.getElementById('convertBookingForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const bookingId = document.getElementById('convertBookingId').value;
    const gender = document.getElementById('convertGender').value;
    const groupId = document.getElementById('convertGroupId').value;
    const membershipType = document.getElementById('convertMembershipType').value;
    
    if (!groupId) {
        showNotification(notificationWithIcon('warning', 'Выберите группу для ученика'));
        return;
    }
    
    try {
        const token = getAuthToken();
        const convertResponse = await fetch(`${API_URL}/bookings/${bookingId}/convert`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                gender,
                groupId,
                membershipType
            })
        });
        
        const convertData = await convertResponse.json();
        
        if (convertData.success) {
            const pwd = convertData.generatedPassword || 'changeme123';
            const studentName = convertData.student.name;
            const studentPhone = convertData.student.phone;
            const classesCount = convertData.membership.classesRemaining;
            const membershipType = convertData.membership.type;
            
            // Получаем информацию о группе для расписания
            let groupInfo = null;
            try {
                const groupResponse = await fetch(`${API_URL}/groups/${groupId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const groupData = await groupResponse.json();
                if (groupData.group) {
                    groupInfo = {
                        name: groupData.group.name,
                        schedule: groupData.group.schedule
                    };
                    console.log('📅 Group info loaded:', groupInfo);
                }
            } catch (error) {
                console.error('Ошибка загрузки группы:', error);
            }
            
            // Копируем пароль в буфер
            const copySuccess = await copyToClipboard(pwd);
            
            // Показываем модальное окно
            showStudentCreatedModal(studentName, studentPhone, pwd, classesCount, membershipType, copySuccess, groupInfo);
            
            closeConvertBookingModal();
            renderBookings(currentBookingFilter);
            renderDashboard();
            renderStudents();
    } else {
            showNotification(notificationWithIcon('error', `Ошибка: ${convertData.error || 'Не удалось создать ученика'}`));
        }
    } catch (error) {
        console.error('Convert error:', error);
        showNotification(notificationWithIcon('error', 'Ошибка при конвертации'));
    }
});

async function changeBookingStatusDirect(id, newStatus) {
    try {
        const token = getAuthToken();
        
        // Если статус "Пробное занятие" - открываем модалку конвертации
        if (newStatus === 'trial') {
            openConvertBookingModal(id);
            return;
        }
        
        // Обычное изменение статуса
        const response = await fetch(`${API_URL}/bookings/${id}/status`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: newStatus })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(`Статус изменен на "${getStatusText(newStatus)}"`);
            // Перезагружаем с текущим фильтром
            renderBookings(currentBookingFilter);
            renderDashboard();
    } else {
            showNotification(notificationWithIcon('error', `Ошибка: ${data.error || 'Не удалось изменить статус'}`));
            // Перезагружаем для отката
            renderBookings(currentBookingFilter);
        }
    } catch (error) {
        console.error('Ошибка изменения статуса:', error);
        showNotification(notificationWithIcon('error', 'Ошибка подключения к серверу'));
        // Перезагружаем для отката
        renderBookings(currentBookingFilter);
    }
}

// Просмотр заявки
async function viewBooking(id) {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/bookings/${id}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        const booking = data.booking;
        
        showNotification(notificationWithIcon('warning', `Заявка #${id.slice(-6)}\n\nИмя: ${booking.name}\nТелефон: ${booking.phone}\nНаправление: ${booking.direction}\nСтатус: ${getStatusText(booking.status)}\nДата: ${new Date(booking.createdAt).toLocaleString('ru')}`));
    } catch (error) {
        console.error('Ошибка:', error);
        showNotification(notificationWithIcon('error', 'Ошибка загрузки заявки'));
    }
}

// Переменная для хранения ID текущего просматриваемого ученика
let currentViewingStudentId = null;

// Просмотр ученика
async function viewStudent(id) {
    try {
        currentViewingStudentId = id;
        
        const token = getAuthToken();
        
        // Загрузить данные ученика
        const studentResponse = await fetch(`${API_URL}/students/${id}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const { student } = await studentResponse.json();
        
        // Загрузить статистику
        const statsResponse = await fetch(`${API_URL}/students/${id}/stats`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const { stats } = await statsResponse.json();
        
        // Заполнить модальное окно
        document.getElementById('studentDetailModalTitle').textContent = `${student.name}`;
        
        // Основная информация
        const groups = student.groups
            .filter(g => g.status === 'active')
            .map(g => g.groupId?.name || 'Группа')
            .join(', ') || 'Нет групп';
        
        const membership = student.activeMembership;
        const membershipText = membership 
            ? `${membership.classesRemaining} ${getDeclension(membership.classesRemaining, 'занятие', 'занятия', 'занятий')}`
            : 'Нет абонемента';
        
        const membershipClass = getMembershipClass(membership);
        
        const genderText = student.gender === 'male' ? 'Мужской' : student.gender === 'female' ? 'Женский' : 'Не указан';
        
        document.getElementById('studentBasicInfo').innerHTML = `
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 15px; align-items: center;">
                <strong style="color: rgba(255,255,255,0.7);">Телефон:</strong>
                <span>${student.phone}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Email:</strong>
                <span>${student.email || 'Не указан'}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Пол:</strong>
                <span>${genderText}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Группы:</strong>
                <span>${groups}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Абонемент:</strong>
                <span class="membership-badge ${membershipClass}">${membershipText}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Регистрация:</strong>
                <span>${new Date(student.registeredAt).toLocaleDateString('ru')}</span>
            </div>
        `;
        
        // Статистика посещаемости
        const attendanceRate = stats.attendanceRate || 0;
        const totalClasses = stats.totalClasses || 0;
        const attendedCount = stats.attendedCount || 0;
        const missedCount = stats.missedCount || 0;
        const monthMissed = stats.monthMissed || 0;
        const lastAttendedDate = stats.lastAttendedDate;
        
        let attendanceColor = '#10b981';
        if (attendanceRate < 50) attendanceColor = '#ef4444';
        else if (attendanceRate < 75) attendanceColor = '#f59e0b';
        
        document.getElementById('studentStatsInfo').innerHTML = `
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 15px; align-items: center;">
                <strong style="color: rgba(255,255,255,0.7);">Процент посещаемости:</strong>
                <span style="color: ${attendanceColor}; font-weight: 600; font-size: 1.5em;">${attendanceRate}%</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Всего занятий:</strong>
                <span>${totalClasses}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Посещено:</strong>
                <span style="color: #10b981;">${attendedCount}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Пропущено:</strong>
                <span style="color: #ef4444;">${missedCount}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Пропусков в этом месяце:</strong>
                <span style="color: ${monthMissed > 2 ? '#ef4444' : '#64748b'}; font-weight: 600;">${monthMissed}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Последний визит:</strong>
                <span>${formatLastVisit(lastAttendedDate)}</span>
            </div>
        `;
        
        // История посещений
        const history = stats.recentHistory || [];
        
        if (history.length === 0) {
            document.getElementById('studentAttendanceHistory').innerHTML = `
                <p style="text-align: center; opacity: 0.5; padding: 20px;">Нет истории посещений</p>
            `;
        } else {
            document.getElementById('studentAttendanceHistory').innerHTML = history.map(item => {
                const date = new Date(item.date).toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: 'numeric' });
                const statusColor = item.attended ? '#10b981' : '#ef4444';
                const statusText = item.attended ? 'Присутствовал' : 'Отсутствовал';
                const statusIcon = item.attended 
                    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${statusColor}" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`
                    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${statusColor}" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
                
                return `
                    <div style="padding: 12px; border-left: 3px solid ${statusColor}; background: rgba(255,255,255,0.03); margin-bottom: 10px; border-radius: 4px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <strong style="color: ${statusColor}; display: flex; align-items: center; gap: 6px;">${statusIcon} ${statusText}</strong>
                            <span style="font-size: 0.9em; opacity: 0.7;">${date}</span>
                        </div>
                        <div style="font-size: 0.95em;">
                            <span style="opacity: 0.8;">${item.title}</span>
                        </div>
                        ${item.group ? `<div style="font-size: 0.85em; opacity: 0.6; margin-top: 3px;">Группа: ${item.group}</div>` : ''}
                    </div>
                `;
            }).join('');
        }
        
        // Открыть модальное окно
        document.getElementById('studentDetailModal').classList.add('show');
    } catch (error) {
        console.error('Ошибка:', error);
        showNotification(notificationWithIcon('error', 'Ошибка загрузки информации об ученике'));
    }
}

// Закрыть модальное окно детального просмотра ученика
function closeStudentDetailModal() {
    document.getElementById('studentDetailModal').classList.remove('show');
    currentViewingStudentId = null;
}

// Редактирование ученика
function editStudent(id) {
    // TODO: Сделать модальное окно редактирования в будущем
    viewStudent(id);
}

// Редактирование группы  
// Редактировать группу
async function editGroup(id) {
    try {
        // Загрузить данные группы
        const response = await fetch(`${API_URL}/groups/${id}`);
        const data = await response.json();
        const group = data.group;
        
        if (!group) {
            showNotification(notificationWithIcon('warning', 'Группа не найдена'));
            return;
        }
        
        // Заполнить форму
        document.getElementById('groupId').value = group._id;
        document.getElementById('groupName').value = group.name;
        document.getElementById('groupDirection').value = group.direction;
        document.getElementById('groupIsActive').checked = group.isActive;
        
        // Загрузить преподавателей и выбрать текущего
        await loadTeachersForGroup();
        if (group.teacher) {
            document.getElementById('groupTeacher').value = group.teacher;
        }
        
        // Загрузить расписание
        scheduleItems = (group.schedule || []).map(s => ({
            id: Date.now() + Math.random(),
            dayOfWeek: s.dayOfWeek,
            time: s.time,
            duration: s.duration,
            isPractice: s.isPractice || false
        }));
        renderScheduleList();
        
        // Обновить заголовок и кнопку
        document.getElementById('groupModalTitle').textContent = 'РЕДАКТИРОВАТЬ ГРУППУ';
        document.querySelector('#groupForm button[type="submit"]').textContent = 'СОХРАНИТЬ';
        
        // Открыть модалку
        document.getElementById('groupModal').classList.add('show');
    } catch (error) {
        console.error('Ошибка загрузки группы:', error);
        showNotification(notificationWithIcon('error', 'Ошибка при загрузке данных группы'));
    }
}

// Удалить группу
async function deleteGroup(id, name) {
    if (!await customConfirm(`Удалить группу "${name}"?\n\nУдаление возможно только если в группе нет учеников.`, {icon: 'warning'})) { return; }
    
    try {
        const response = await fetch(`${API_URL}/groups/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        const data = await response.json();
        
        if (!data.success) {
            showNotification(notificationWithIcon('error', data.error || 'Ошибка при удалении группы'));
            return;
        }
        
        showNotification(notificationWithIcon('success', 'Группа успешно удалена'));
        renderGroups();
    } catch (error) {
        console.error('Ошибка удаления группы:', error);
        showNotification(notificationWithIcon('error', 'Ошибка при удалении группы'));
    }
}

// Текущая группа для управления учениками
let currentGroupForStudents = null;

// Просмотр учеников группы
async function viewGroupStudents(id) {
    try {
        currentGroupForStudents = id;
        
        // Загрузить группу
        const groupResponse = await fetch(`${API_URL}/groups/${id}`);
        const groupData = await groupResponse.json();
        const group = groupData.group;
        
        // Обновить заголовок
        document.getElementById('groupStudentsModalTitle').textContent = `УЧЕНИКИ ГРУППЫ: ${group.name}`;
        
        // Загрузить учеников
        await renderGroupStudents(id);
        
        // Открыть модалку
        document.getElementById('groupStudentsModal').classList.add('show');
    } catch (error) {
        console.error('Ошибка:', error);
        showNotification(notificationWithIcon('error', 'Ошибка загрузки учеников группы'));
    }
}

// Отобразить список учеников группы
async function renderGroupStudents(groupId) {
    try {
        const response = await fetch(`${API_URL}/groups/${groupId}/students`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        const data = await response.json();
        const students = data.students || [];
        
        const container = document.getElementById('groupStudentsList');
        
        if (students.length === 0) {
            container.innerHTML = '<p style="text-align: center; opacity: 0.5;">В этой группе пока нет учеников</p>';
            return;
        }
        
        container.innerHTML = students.map(student => `
            <div style="
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 15px;
                background: var(--bg-secondary);
                border-radius: 8px;
                border-left: 3px solid #eb4d77;
            ">
                <div>
                    <div style="font-weight: 600; margin-bottom: 5px;">${student.name}</div>
                    <div style="font-size: 0.9rem; opacity: 0.7;">${student.phone}</div>
                </div>
                <button class="room-action-btn danger" onclick="removeStudentFromGroup('${groupId}', '${student._id}', '${student.name}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
        `).join('');
    } catch (error) {
        console.error('Ошибка загрузки учеников:', error);
    }
}

// Закрыть модалку учеников группы
function closeGroupStudentsModal() {
    document.getElementById('groupStudentsModal').classList.remove('show');
    currentGroupForStudents = null;
}

// Открыть модалку добавления ученика
function openAddStudentToGroupModal() {
    document.getElementById('targetGroupId').value = currentGroupForStudents;
    document.getElementById('addStudentToGroupForm').reset();
    document.getElementById('studentSearchInput').value = '';
    
    // Загрузить учеников
    loadStudentsForGroup();
    
    document.getElementById('addStudentToGroupModal').classList.add('show');
}

// Закрыть модалку добавления ученика
function closeAddStudentToGroupModal() {
    document.getElementById('addStudentToGroupModal').classList.remove('show');
}

// Загрузить учеников для добавления в группу
async function loadStudentsForGroup(searchQuery = '') {
    try {
        let url = `${API_URL}/students?role=student`;
        if (searchQuery) {
            url += `&search=${encodeURIComponent(searchQuery)}`;
        }
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        const data = await response.json();
        const students = data.students || [];
        
        // Фильтруем только студентов
        const onlyStudents = students.filter(s => s.role === 'student');
        
        const select = document.getElementById('studentToAdd');
        
        if (onlyStudents.length === 0) {
            select.innerHTML = '<option value="">Ученики не найдены</option>';
            return;
        }
        
        select.innerHTML = onlyStudents.map(student => `
            <option value="${student._id}">${student.name} - ${student.phone}</option>
        `).join('');
    } catch (error) {
        console.error('Ошибка загрузки учеников:', error);
    }
}

// Удалить ученика из группы
async function removeStudentFromGroup(groupId, studentId, studentName) {
    if (!await customConfirm(`Удалить ${studentName} из группы?`, {icon: 'warning'})) { return; }
    
    try {
        const response = await fetch(`${API_URL}/groups/${groupId}/students/${studentId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        const data = await response.json();
        
        if (!data.success) {
            showNotification(notificationWithIcon('error', data.error || 'Ошибка при удалении ученика'));
            return;
        }
        
        // Обновить список учеников
        await renderGroupStudents(groupId);
        
        // Обновить список групп (для обновления счетчика)
        renderGroups();
    } catch (error) {
        console.error('Ошибка удаления ученика:', error);
        showNotification(notificationWithIcon('error', 'Ошибка при удалении ученика из группы'));
    }
}

// Обработчик поиска учеников
const studentSearchInput = document.getElementById('studentSearchInput');
if (studentSearchInput) {
    let searchTimeout;
    studentSearchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            loadStudentsForGroup(e.target.value);
        }, 300);
    });
}

// Обработчик формы добавления ученика в группу
const addStudentToGroupForm = document.getElementById('addStudentToGroupForm');
if (addStudentToGroupForm) {
    addStudentToGroupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const groupId = document.getElementById('targetGroupId').value;
        const studentId = document.getElementById('studentToAdd').value;
        
        if (!studentId) {
            showNotification(notificationWithIcon('warning', 'Выберите ученика'));
            return;
        }
        
        try {
            const response = await fetch(`${API_URL}/groups/${groupId}/students/${studentId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getAuthToken()}`
                }
            });
            
            const data = await response.json();
            
            if (!data.success) {
                showNotification(notificationWithIcon('error', data.error || 'Ошибка при добавлении ученика'));
                return;
            }
            
            showNotification(notificationWithIcon('success', 'Ученик успешно добавлен в группу'));
            closeAddStudentToGroupModal();
            
            // Обновить список учеников
            await renderGroupStudents(groupId);
            
            // Обновить список групп (для обновления счетчика)
            renderGroups();
        } catch (error) {
            console.error('Ошибка добавления ученика:', error);
            showNotification(notificationWithIcon('error', 'Ошибка при добавлении ученика в группу'));
        }
    });
}

// ==================== FILTERS ====================

// Текущий фильтр заявок
let currentBookingFilter = null;

// Фильтры для заявок
const bookingFilters = document.querySelectorAll('#section-bookings .filter-btn');
bookingFilters.forEach(btn => {
    btn.addEventListener('click', () => {
        bookingFilters.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        currentBookingFilter = btn.dataset.filter === 'all' ? null : btn.dataset.filter;
        renderBookings(currentBookingFilter);
    });
});

// Поиск учеников
const studentSearch = document.getElementById('studentSearch');
if (studentSearch) {
    studentSearch.addEventListener('input', (e) => {
        renderStudents(e.target.value);
    });
}

// ==================== CREATE BUTTONS ====================

// Открыть модальное окно создания заявки
document.getElementById('createBookingBtn').addEventListener('click', () => {
    const modal = document.getElementById('createBookingModal');
    modal.classList.add('show');
});

// Закрыть модальное окно
function closeCreateBookingModal() {
    const modal = document.getElementById('createBookingModal');
    modal.classList.remove('show');
    document.getElementById('createBookingForm').reset();
}

// Закрыть при клике на overlay
document.querySelector('#createBookingModal .modal-overlay')?.addEventListener('click', closeCreateBookingModal);

// Форматирование телефона в модальном окне
const bookingPhoneInput = document.getElementById('bookingPhone');
if (bookingPhoneInput) {
    bookingPhoneInput.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, '');
        
        if (value.length > 0) {
            if (value[0] === '8') {
                value = '7' + value.substring(1);
            } else if (value[0] !== '7') {
                value = '7' + value;
            }
            
            let formattedValue = '+7';
            
            if (value.length > 1) {
                formattedValue += ' (' + value.substring(1, 4);
            }
            if (value.length >= 4) {
                formattedValue += ') ' + value.substring(4, 7);
            }
            if (value.length >= 7) {
                formattedValue += '-' + value.substring(7, 9);
            }
            if (value.length >= 9) {
                formattedValue += '-' + value.substring(9, 11);
            }
            
            e.target.value = formattedValue;
        }
    });
}

// Создание заявки через API
document.getElementById('createBookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('bookingName').value;
    const phone = document.getElementById('bookingPhone').value;
    const direction = document.getElementById('bookingDirection').value;
    const source = document.getElementById('bookingSource').value;
    
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/bookings/create-admin`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, phone, direction, source })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Заявка успешно создана! 🎉');
            closeCreateBookingModal();
            renderBookings(); // Обновляем таблицу
            renderDashboard(); // Обновляем дашборд
    } else {
            showNotification(notificationWithIcon('error', `Ошибка: ${data.error || 'Не удалось создать заявку'}`));
        }
    } catch (error) {
        console.error('Ошибка создания заявки:', error);
        showNotification(notificationWithIcon('error', 'Ошибка подключения к серверу'));
    }
});

// Кнопки добавления ученика и создания группы
const addStudentBtn = document.getElementById('addStudentBtn');
const createGroupBtn = document.getElementById('createGroupBtn');

// Скрыть кнопку добавления ученика (используем конвертацию заявок)
if (addStudentBtn) addStudentBtn.style.display = 'none';

// Показать кнопку создания группы и добавить обработчик
if (createGroupBtn) {
    createGroupBtn.style.display = 'flex';
    createGroupBtn.addEventListener('click', openGroupModal);
}

// Обработчик формы группы
const groupForm = document.getElementById('groupForm');
if (groupForm) {
    groupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const groupId = document.getElementById('groupId').value;
        const isEdit = !!groupId;
        
        // Собрать данные формы
        const groupData = {
            name: document.getElementById('groupName').value,
            direction: document.getElementById('groupDirection').value,
            teacher: document.getElementById('groupTeacher').value,
            isActive: document.getElementById('groupIsActive').checked,
            schedule: scheduleItems.map(item => ({
                dayOfWeek: item.dayOfWeek,
                time: item.time,
                duration: item.duration,
                isPractice: item.isPractice || false
            }))
        };
        
        // Получить имя преподавателя для поля instructor
        const teacherSelect = document.getElementById('groupTeacher');
        const selectedOption = teacherSelect.options[teacherSelect.selectedIndex];
        groupData.instructor = selectedOption.text;
        
        try {
            const url = isEdit ? `${API_URL}/groups/${groupId}` : `${API_URL}/groups`;
            const method = isEdit ? 'PATCH' : 'POST';
            
            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getAuthToken()}`
                },
                body: JSON.stringify(groupData)
            });
            
            const data = await response.json();
            
            if (!data.success) {
                showNotification(notificationWithIcon('error', data.error || 'Ошибка при сохранении группы'));
                return;
            }
            
            showNotification(notificationWithIcon('warning', isEdit ? 'Группа успешно обновлена' : 'Группа успешно создана'));
            closeGroupModal();
            renderGroups();
        } catch (error) {
            console.error('Ошибка:', error);
            showNotification(notificationWithIcon('error', 'Ошибка при сохранении группы'));
        }
    });
}

// ==================== LOAD SECTION DATA ====================

// ⚡ Кэш загруженных вкладок для оптимизации
const loadedSections = new Set(['dashboard']); // Дашборд уже загружен при инициализации

async function loadSectionData(sectionId, forceReload = false) {
    // ⚡ ОПТИМИЗАЦИЯ: Если вкладка уже загружена и не требуется принудительное обновление, пропускаем
    if (loadedSections.has(sectionId) && !forceReload) {
        console.log(`ℹ️ ${sectionId} уже загружена (используется кэш)`);
        return;
    }
    
    console.log(`🔄 Загружаем ${sectionId}...`);
    
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
        case 'roles':
            await loadRolesData();
            break;
    }
    
    // Помечаем вкладку как загруженную
    loadedSections.add(sectionId);
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
    console.log(`🗑️ Кэш сброшен для: ${sectionIds.join(', ')}`);
}

// ==================== INITIALIZATION ====================

// Загружаем данные при старте
// ==================== THEME TOGGLE ====================
// ✅ initTheme теперь в modules/core/theme.js

// ==================== УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ ====================

let currentRoleFilter = 'all';

// Получить список всех пользователей
async function renderUsers(roleFilter = 'all') {
    const table = document.getElementById('usersTable');
    if (!table) return;
    
    currentRoleFilter = roleFilter;
    
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/students`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        
        if (!data.success) {
            table.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red;">Ошибка загрузки</td></tr>';
            return;
        }
        
        let users = data.students || [];
        
        // Фильтрация по роли
        if (roleFilter !== 'all') {
            if (roleFilter === 'admin') {
                // Для фильтра "Админы" показываем admin И super_admin
                users = users.filter(u => u.role === 'admin' || u.role === 'super_admin');
            } else {
                users = users.filter(u => u.role === roleFilter);
            }
        }
        
        if (users.length === 0) {
            table.innerHTML = '<tr><td colspan="6" style="text-align:center; opacity:0.5;">Нет пользователей</td></tr>';
            return;
        }
        
        const currentUserId = localStorage.getItem('userId');
        
        table.innerHTML = users.map(user => {
            // Проверяем можно ли удалить пользователя
            const canDelete = isSuperAdmin() && 
                              user._id !== currentUserId && 
                              user.role !== 'super_admin';
            
            return `
                <tr>
                    <td>${user.name}</td>
                    <td>${user.phone}</td>
                    <td><span class="role-badge role-${user.role}">${getRoleText(user.role)}</span></td>
                    <td>${user.email || '—'}</td>
                    <td>${formatDate(user.registeredAt)}</td>
                    <td class="table-actions">
                        <button class="table-btn" onclick="resetUserPassword('${user._id}', '${user.name}', '${user.phone}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; vertical-align: middle; margin-right: 4px;">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                            </svg>
                            Пароль
                        </button>
                        <button class="table-btn" onclick="openUserModal('${user._id}')">Роль</button>
                        ${canDelete ? `<button class="table-btn danger" onclick="deleteUser('${user._id}', '${user.name}')">Удалить</button>` : ''}
                    </td>
                </tr>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Ошибка загрузки пользователей:', error);
        table.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red;">Ошибка подключения</td></tr>';
    }
}

// Получить текст роли
// ✅ getRoleText теперь в modules/core/utils.js

// Открыть модальное окно редактирования пользователя
async function openUserModal(userId) {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/students/${userId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        
        if (!data.success) {
            showNotification(notificationWithIcon('error', 'Ошибка загрузки данных пользователя'));
            return;
        }
        
        const user = data.student;
        
        // Заполняем форму
        document.getElementById('userId').value = user._id;
        document.getElementById('userName').value = user.name;
        document.getElementById('userPhone').value = user.phone;
        document.getElementById('userEmail').value = user.email || '';
        document.getElementById('userRole').value = user.role;
        
        // Скрываем опцию super_admin если пользователь не super_admin
        const roleSelect = document.getElementById('userRole');
        const superAdminOption = roleSelect.querySelector('option[value="super_admin"]');
        if (superAdminOption) {
            superAdminOption.remove();
        }
        
        // Если текущий пользователь super_admin, добавляем опцию
        if (isSuperAdmin() && user.role === 'super_admin') {
            const option = document.createElement('option');
            option.value = 'super_admin';
            option.textContent = 'Супер Админ';
            option.selected = true;
            roleSelect.appendChild(option);
        }
        
        // Показываем поля для преподавателя
        toggleTeacherFields();
        
        // Загружаем данные преподавателя (направления, био, фото)
        if (user.role === 'teacher' && user.teacherInfo) {
            // Отмечаем направления
            const dirCheckboxes = document.querySelectorAll('#teacherFields input[name="directions"]');
            dirCheckboxes.forEach(cb => {
                cb.checked = user.teacherInfo.directions?.includes(cb.value) || false;
            });
            
            // Загружаем биографию и фото
            const bioInput = document.getElementById('userBio');
            const photoInput = document.getElementById('userPhoto');
            if (bioInput) bioInput.value = user.teacherInfo.bio || '';
            if (photoInput) photoInput.value = user.teacherInfo.photo || '';
        }
        
        // Показываем модальное окно
        document.getElementById('userModal').classList.add('show');
        
    } catch (error) {
        console.error('Ошибка:', error);
        showNotification(notificationWithIcon('error', 'Ошибка подключения к серверу'));
    }
}

// Закрыть модальное окно пользователя
function closeUserModal() {
    document.getElementById('userModal').classList.remove('show');
    document.getElementById('userForm').reset();
}

// Переключение полей преподавателя
function toggleTeacherFields() {
    const role = document.getElementById('userRole').value;
    const teacherFields = document.getElementById('teacherFields');
    const teacherBioGroup = document.getElementById('teacherBioGroup');
    const teacherPhotoGroup = document.getElementById('teacherPhotoGroup');
    
    const isTeacher = role === 'teacher';
    teacherFields.style.display = isTeacher ? 'block' : 'none';
    if (teacherBioGroup) teacherBioGroup.style.display = isTeacher ? 'block' : 'none';
    if (teacherPhotoGroup) teacherPhotoGroup.style.display = isTeacher ? 'block' : 'none';
}

// Обработка формы изменения пользователя
document.getElementById('userForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const userId = document.getElementById('userId').value;
    const newRole = document.getElementById('userRole').value;
    const name = document.getElementById('userName').value;
    
    try {
        const token = getAuthToken();
        
        // Если это преподаватель - обновляем через teachers endpoint
        if (newRole === 'teacher') {
            const checkboxes = document.querySelectorAll('#teacherFields input[name="directions"]:checked');
            const directions = Array.from(checkboxes).map(cb => cb.value);
            
            const bioInput = document.getElementById('userBio');
            const photoInput = document.getElementById('userPhoto');
            const bio = bioInput?.value.trim() || '';
            const photo = photoInput?.value.trim() || '';
            
            const response = await fetch(`${API_URL}/users/teachers/${userId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    name,
                    directions, 
                    bio, 
                    photo 
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                showNotification(notificationWithIcon('success', 'Преподаватель успешно обновлен'));
                closeUserModal();
                renderUsers(currentRoleFilter);
            } else {
                showNotification(notificationWithIcon('error', `Ошибка: ${data.error || 'Не удалось обновить'}`));
            }
        } else {
            // Для других ролей - только меняем роль
            const confirmMsg = `Изменить роль пользователя на "${getRoleText(newRole)}"?`; if (!await customConfirm(confirmMsg)) {
                return;
            }
            
            const response = await fetch(`${API_URL}/users/${userId}/change-role`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ role: newRole })
            });
            
            const data = await response.json();
            
            if (data.success) {
                showNotification(notificationWithIcon('success', 'Роль успешно изменена'));
                closeUserModal();
                renderUsers(currentRoleFilter);
            } else {
                showNotification(notificationWithIcon('error', `Ошибка: ${data.error || 'Не удалось изменить роль'}`));
            }
        }
        
    } catch (error) {
        console.error('Ошибка обновления:', error);
        showNotification(notificationWithIcon('error', 'Ошибка подключения к серверу'));
    }
});

// Обработчик изменения роли в select
document.getElementById('userRole')?.addEventListener('change', toggleTeacherFields);

// Удалить заявку (Admin и Super Admin)
async function deleteBooking(bookingId, bookingName) {
    // Проверка прав
    const userRole = getUserRole();
    if (!['admin', 'super_admin'].includes(userRole)) {
        showNotification(notificationWithIcon('warning', 'Доступ запрещен. Требуются права администратора.'));
        return;
    }
    
    // Подтверждение
    const confirmMsg = `Удалить заявку от "${bookingName}"?\n\nЭто действие нельзя отменить!`; if (!await customConfirm(confirmMsg)) {
        return;
    }
    
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/bookings/${bookingId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(notificationWithIcon('warning', `Заявка удалена`));
            renderBookings(currentBookingFilter);
            renderDashboard(); // Обновляем статистику
        } else {
            showNotification(notificationWithIcon('error', `Ошибка: ${data.error || 'Не удалось удалить заявку'}`));
        }
        
    } catch (error) {
        console.error('Ошибка удаления заявки:', error);
        showNotification(notificationWithIcon('error', 'Ошибка подключения к серверу'));
    }
}

// Удалить пользователя (только Super Admin)
async function deleteUser(userId, userName) {
    // Проверка прав
    if (!isSuperAdmin()) {
        showNotification(notificationWithIcon('warning', 'Доступ запрещен. Требуются права супер-администратора.'));
        return;
    }
    
    // Подтверждение
    const confirmMsg = `Вы уверены, что хотите удалить пользователя "${userName}"?\n\nЭто действие нельзя отменить!`; if (!await customConfirm(confirmMsg)) {
        return;
    }
    
    try {
        const token = getAuthToken();
        
        // Пытаемся определить роль пользователя для правильного endpoint
        const response = await fetch(`${API_URL}/students/${userId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const userData = await response.json();
        if (!userData.success) {
            showNotification(notificationWithIcon('warning', 'Ошибка: не удалось получить данные пользователя'));
            return;
        }
        
        const user = userData.student;
        let deleteEndpoint = '';
        
        // Выбираем правильный endpoint в зависимости от роли
        switch(user.role) {
            case 'admin':
                deleteEndpoint = `${API_URL}/users/admins/${userId}`;
                break;
            case 'sales_manager':
                deleteEndpoint = `${API_URL}/users/sales-managers/${userId}`;
                break;
            case 'teacher':
                deleteEndpoint = `${API_URL}/users/teachers/${userId}`;
                break;
            case 'student':
                deleteEndpoint = `${API_URL}/students/${userId}`;
                break;
            default:
                showNotification(notificationWithIcon('warning', 'Неизвестная роль пользователя'));
                return;
        }
        
        const deleteResponse = await fetch(deleteEndpoint, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const deleteData = await deleteResponse.json();
        
        if (deleteData.success) {
            showNotification(notificationWithIcon('warning', `Пользователь "${userName}" удален`));
            renderUsers(currentRoleFilter);
            renderDashboard(); // Обновляем статистику
        } else {
            showNotification(notificationWithIcon('error', `Ошибка: ${deleteData.error || 'Не удалось удалить пользователя'}`));
        }
        
    } catch (error) {
        console.error('Ошибка удаления пользователя:', error);
        showNotification(notificationWithIcon('error', 'Ошибка подключения к серверу'));
    }
}

// Фильтры ролей
document.querySelectorAll('[data-role]').forEach(btn => {
    btn.addEventListener('click', () => {
        const role = btn.dataset.role;
        
        // Активная кнопка
        document.querySelectorAll('[data-role]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Загружаем с фильтром
        renderUsers(role);
    });
});

// Генерация случайного пароля
function generatePassword() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let password = '';
    for (let i = 0; i < 8; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

// Сброс пароля пользователя
async function resetUserPassword(userId, userName, userPhone) {
    const confirmMsg = `Сгенерировать новый пароль для "${userName}"?\n\nТелефон: ${userPhone}\n\nНовый пароль будет показан вам для передачи ученику.`;
    
    if (!await customConfirm(confirmMsg)) {
        return;
    }
    
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/users/${userId}/reset-password`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            const password = data.newPassword;
            
            // Копируем пароль в буфер обмена
            const copySuccess = await copyToClipboard(password);
            
            // Показываем модальное окно с паролем
            showPasswordModal(userName, userPhone, password, copySuccess);
            
        } else {
            showNotification(notificationWithIcon('error', `Ошибка: ${data.error || 'Не удалось сбросить пароль'}`));
        }
    } catch (error) {
        console.error('Password reset error:', error);
        showNotification(notificationWithIcon('error', 'Ошибка при сбросе пароля'));
    }
}

// Показать модальное окно при создании ученика из заявки
function showStudentCreatedModal(studentName, studentPhone, password, classesCount, membershipType, copySuccess, groupInfo = null) {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10002;
    `;
    
    // Тип абонемента для отображения
    const membershipTypeText = {
        'trial': 'Пробный',
        'monthly': 'Месячный',
        'quarterly': 'Квартальный'
    }[membershipType] || membershipType;
    
    // Форматируем расписание группы
    let scheduleText = '';
    let nextClassText = '';
    
    if (groupInfo && groupInfo.schedule && groupInfo.schedule.length > 0) {
        // В модели Group: dayOfWeek - Number (1-7), time - String
        const dayNames = [
            '', // 0 - не используется
            'Понедельник', // 1
            'Вторник',     // 2
            'Среда',       // 3
            'Четверг',     // 4
            'Пятница',     // 5
            'Суббота',     // 6
            'Воскресенье'  // 7
        ];
        
        const dayNamesShort = ['', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
        
        // Формируем текст расписания
        scheduleText = groupInfo.schedule.map(s => 
            `${dayNames[s.dayOfWeek]} ${s.time}`
        ).join('\n');
        
        // Находим ближайшее занятие
        const now = new Date();
        const currentDay = now.getDay(); // 0=Вс, 1=Пн, ..., 6=Сб
        
        // Преобразуем dayOfWeek из формата Group (1-7) в JS format (0-6)
        // Group: 1=Пн, 2=Вт, ..., 7=Вс
        // JS:    0=Вс, 1=Пн, ..., 6=Сб
        const convertDay = (groupDay) => {
            return groupDay === 7 ? 0 : groupDay; // 7 → 0 (воскресенье), остальные как есть
        };
        
        let nextClass = null;
        let minDaysAway = 8;
        
        groupInfo.schedule.forEach(s => {
            const schedDay = convertDay(s.dayOfWeek);
            let daysAway = (schedDay - currentDay + 7) % 7;
            if (daysAway === 0) daysAway = 7; // Если сегодня, считаем следующую неделю
            
            if (daysAway < minDaysAway) {
                minDaysAway = daysAway;
                nextClass = {
                    day: dayNames[s.dayOfWeek],
                    dayShort: dayNamesShort[s.dayOfWeek],
                    time: s.time,
                    daysAway
                };
            }
        });
        
        if (nextClass) {
            const nextDate = new Date(now);
            nextDate.setDate(now.getDate() + nextClass.daysAway);
            const dateStr = nextDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
            
            nextClassText = `📅 Ближайшее занятие:\n${nextClass.day}, ${dateStr} в ${nextClass.time}`;
        }
    }
    
    // Формируем готовое сообщение для WhatsApp
    const whatsappMessage = `🎉 Добро пожаловать в SENSE OF DANCE!

👤 Ваш аккаунт создан:
━━━━━━━━━━━━━━━━━
📱 Логин: ${studentPhone}
🔑 Пароль: ${password}

💎 Ваш абонемент:
━━━━━━━━━━━━━━━━━
Тип: ${membershipTypeText}
Занятий: ${classesCount}${groupInfo ? `
Группа: ${groupInfo.name}` : ''}${nextClassText ? `

${nextClassText}` : ''}${scheduleText ? `

📋 Расписание группы:
${scheduleText}` : ''}

🌐 Личный кабинет:
http://192.168.100.30:8000/frontend/public/profile.html

📞 Контакты:
+7 (700) 095-09-04

Ждём вас на занятиях! 💃`;
    
    // Кодируем сообщение для URL
    const encodedMessage = encodeURIComponent(whatsappMessage);
    // Убираем +7 и форматирование из телефона для WhatsApp
    const whatsappPhone = studentPhone.replace(/\D/g, '');
    const whatsappUrl = `https://wa.me/${whatsappPhone}?text=${encodedMessage}`;
    
    modal.innerHTML = `
        <div style="
            background: var(--admin-card);
            border: 2px solid var(--pink);
            padding: 40px;
            max-width: 700px;
            box-shadow: 0 10px 40px var(--admin-shadow);
        ">
            <div style="text-align: center; margin-bottom: 30px;">
                <div style="color: var(--pink); margin-bottom: 15px;">
                    ${getIcon('success', 48)}
                </div>
                <h2 style="color: var(--admin-text); font-size: 1.5rem; letter-spacing: 0.1em; margin: 0;">
                    УЧЕНИК УСПЕШНО СОЗДАН
                </h2>
            </div>
            
            <div style="background: rgba(235, 77, 119, 0.1); border: 2px solid var(--pink); border-radius: 8px; padding: 20px; margin-bottom: 25px;">
                <div style="margin-bottom: 15px;">
                    <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Ученик:</div>
                    <div style="color: var(--admin-text); font-size: 1.1rem; font-weight: 600;">${studentName}</div>
                </div>
                
                <div style="margin-bottom: 15px;">
                    <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Телефон:</div>
                    <div style="color: var(--admin-text); font-size: 1.1rem; font-weight: 600;">${studentPhone}</div>
                </div>
                
                <div style="margin-bottom: 15px;">
                    <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Абонемент:</div>
                    <div style="color: var(--admin-text); font-size: 1.1rem; font-weight: 600;">${membershipTypeText} — ${classesCount} занятий</div>
                </div>
                
                ${groupInfo ? `
                <div style="margin-bottom: 15px;">
                    <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Группа:</div>
                    <div style="color: var(--admin-text); font-size: 1.1rem; font-weight: 600;">${groupInfo.name}</div>
                </div>
                ` : ''}
                
                ${nextClassText ? `
                <div style="background: rgba(16, 185, 129, 0.2); padding: 12px; border-radius: 6px; margin-top: 15px;">
                    <div style="color: #10b981; font-size: 0.95rem; font-weight: 600; white-space: pre-line;">${nextClassText}</div>
                </div>
                ` : ''}
                
                <div style="border-top: 1px solid rgba(235, 77, 119, 0.3); padding-top: 15px; margin-top: 15px;">
                    <div style="color: var(--pink); font-size: 0.85rem; margin-bottom: 8px; letter-spacing: 0.1em;">ДАННЫЕ ДЛЯ ВХОДА:</div>
                    <div style="
                        background: rgba(0, 0, 0, 0.3);
                        padding: 15px;
                        border-radius: 6px;
                        margin-bottom: 10px;
                    ">
                        <div style="color: var(--admin-text); margin-bottom: 8px;">
                            <span style="opacity: 0.7;">Логин:</span>
                            <code style="color: var(--pink); font-size: 1.1rem; margin-left: 10px; font-family: 'Courier New', monospace;">${studentPhone}</code>
                        </div>
                        <div style="color: var(--admin-text);">
                            <span style="opacity: 0.7;">Пароль:</span>
                            <code style="color: var(--pink); font-size: 1.3rem; font-weight: 700; margin-left: 10px; font-family: 'Courier New', monospace;">${password}</code>
                        </div>
                    </div>
                    ${copySuccess ? `
                        <div style="color: #10b981; font-size: 0.9rem; text-align: center;">
                            ${getIcon('check', 16)} Пароль скопирован в буфер обмена
                        </div>
                    ` : ''}
                </div>
            </div>
            
            <div style="background: rgba(16, 185, 129, 0.1); border-left: 3px solid #10b981; padding: 15px; margin-bottom: 25px; border-radius: 4px;">
                <div style="color: var(--admin-text); font-weight: 600; margin-bottom: 10px;">
                    📱 Готовое сообщение для ученика:
                </div>
                <div id="whatsappMessagePreview" style="
                    color: var(--admin-text);
                    background: rgba(0, 0, 0, 0.2);
                    padding: 15px;
                    border-radius: 6px;
                    font-size: 0.9rem;
                    line-height: 1.6;
                    white-space: pre-line;
                    max-height: 200px;
                    overflow-y: auto;
                ">${whatsappMessage}</div>
            </div>
            
            <div style="display: flex; gap: 15px; justify-content: center; flex-wrap: wrap;">
                <button id="sendWhatsAppBtn" style="
                    padding: 12px 30px;
                    background: #25D366;
                    color: #ffffff;
                    border: none;
                    cursor: pointer;
                    letter-spacing: 0.1em;
                    font-size: 0.9rem;
                    transition: all 0.3s ease;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                ">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                    </svg>
                    ОТПРАВИТЬ В WHATSAPP
                </button>
                <button id="copyMessageBtn" style="
                    padding: 12px 30px;
                    background: var(--pink);
                    color: #ffffff;
                    border: none;
                    cursor: pointer;
                    letter-spacing: 0.1em;
                    font-size: 0.9rem;
                    transition: all 0.3s ease;
                ">СКОПИРОВАТЬ СООБЩЕНИЕ</button>
                <button id="closeStudentModal" style="
                    padding: 12px 30px;
                    background: transparent;
                    color: var(--admin-text);
                    border: 2px solid var(--admin-border);
                    cursor: pointer;
                    letter-spacing: 0.1em;
                    font-size: 0.9rem;
                    transition: all 0.3s ease;
                ">ЗАКРЫТЬ</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Кнопка WhatsApp
    document.getElementById('sendWhatsAppBtn').addEventListener('click', () => {
        window.open(whatsappUrl, '_blank');
        showNotification(notificationWithIcon('success', 'WhatsApp открыт! Отправьте сообщение ученику.'));
    });
    
    // Кнопка копирования сообщения
    document.getElementById('copyMessageBtn').addEventListener('click', async () => {
        const success = await copyToClipboard(whatsappMessage);
        if (success) {
            showNotification(notificationWithIcon('success', 'Сообщение скопировано! Отправьте ученику.'));
        } else {
            showNotification(notificationWithIcon('error', 'Не удалось скопировать. Скопируйте вручную из окна.'));
        }
    });
    
    // Кнопка закрытия
    document.getElementById('closeStudentModal').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    // Закрытие по клику на overlay
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

// Показать модальное окно с новым паролем
function showPasswordModal(userName, userPhone, password, copySuccess, userType = '') {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10002;
    `;
    
    const title = userType ? `${userType.toUpperCase()} СОЗДАН` : 'НОВЫЙ ПАРОЛЬ СОЗДАН';
    
    modal.innerHTML = `
        <div style="
            background: var(--admin-card);
            border: 2px solid var(--pink);
            padding: 40px;
            max-width: 600px;
            box-shadow: 0 10px 40px var(--admin-shadow);
        ">
            <div style="text-align: center; margin-bottom: 30px;">
                <div style="color: var(--pink); margin-bottom: 15px;">
                    ${getIcon('success', 48)}
                </div>
                <h2 style="color: var(--admin-text); font-size: 1.5rem; letter-spacing: 0.1em; margin: 0;">
                    ${title}
                </h2>
            </div>
            
            <div style="background: rgba(235, 77, 119, 0.1); border: 2px solid var(--pink); border-radius: 8px; padding: 20px; margin-bottom: 25px;">
                <div style="margin-bottom: 15px;">
                    <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Пользователь:</div>
                    <div style="color: var(--admin-text); font-size: 1.1rem; font-weight: 600;">${userName}</div>
                </div>
                
                <div style="margin-bottom: 15px;">
                    <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Телефон:</div>
                    <div style="color: var(--admin-text); font-size: 1.1rem; font-weight: 600;">${userPhone}</div>
                </div>
                
                <div style="border-top: 1px solid rgba(235, 77, 119, 0.3); padding-top: 15px; margin-top: 15px;">
                    <div style="color: var(--pink); font-size: 0.85rem; margin-bottom: 8px; letter-spacing: 0.1em;">НОВЫЙ ПАРОЛЬ:</div>
                    <div style="
                        background: rgba(0, 0, 0, 0.3);
                        padding: 15px;
                        border-radius: 6px;
                        text-align: center;
                        margin-bottom: 10px;
                    ">
                        <code style="
                            color: var(--pink);
                            font-size: 1.4rem;
                            font-weight: 700;
                            letter-spacing: 0.15em;
                            font-family: 'Courier New', monospace;
                        ">${password}</code>
                    </div>
                    ${copySuccess ? `
                        <div style="color: #10b981; font-size: 0.9rem; text-align: center;">
                            ${getIcon('check', 16)} Пароль скопирован в буфер обмена
                        </div>
                    ` : ''}
                </div>
            </div>
            
            <div style="background: rgba(239, 68, 68, 0.1); border-left: 3px solid #ef4444; padding: 15px; margin-bottom: 25px; border-radius: 4px;">
                <div style="color: var(--admin-text); font-weight: 600; margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                    ${getIcon('warning', 20)}
                    <span>ВАЖНО:</span>
                </div>
                <ol style="color: var(--admin-text); margin: 0; padding-left: 20px; line-height: 1.8;">
                    <li>Скопируйте пароль (уже в буфере обмена)</li>
                    <li>Отправьте ученику через WhatsApp или звонок</li>
                    <li>Это окно больше не появится!</li>
                    <li>Ученик может сменить пароль в профиле</li>
                </ol>
            </div>
            
            <div style="display: flex; gap: 15px; justify-content: center;">
                <button id="copyPasswordBtn" style="
                    padding: 12px 30px;
                    background: var(--pink);
                    color: #ffffff;
                    border: none;
                    cursor: pointer;
                    letter-spacing: 0.1em;
                    font-size: 0.9rem;
                    transition: all 0.3s ease;
                ">СКОПИРОВАТЬ ПАРОЛЬ</button>
                <button id="closePasswordModal" style="
                    padding: 12px 30px;
                    background: transparent;
                    color: var(--admin-text);
                    border: 2px solid var(--admin-border);
                    cursor: pointer;
                    letter-spacing: 0.1em;
                    font-size: 0.9rem;
                    transition: all 0.3s ease;
                ">ЗАКРЫТЬ</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Кнопка копирования
    document.getElementById('copyPasswordBtn').addEventListener('click', async () => {
        const success = await copyToClipboard(password);
        if (success) {
            showNotification(notificationWithIcon('success', 'Пароль скопирован в буфер обмена!'));
        } else {
            showNotification(notificationWithIcon('error', 'Не удалось скопировать. Скопируйте вручную.'));
        }
    });
    
    // Кнопка закрытия
    document.getElementById('closePasswordModal').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    // Закрытие по клику на overlay
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

// Открыть модальное окно создания пользователя
function openCreateUserModal(role) {
    const modal = document.getElementById('createUserModal');
    const title = document.getElementById('createUserModalTitle');
    const roleInput = document.getElementById('newUserRole');
    const directionsGroup = document.getElementById('newUserDirectionsGroup');
    const passwordInput = document.getElementById('newUserPassword');
    
    // Устанавливаем роль
    roleInput.value = role;
    
    // Генерируем пароль
    passwordInput.value = generatePassword();
    
    // Меняем заголовок
    const titles = {
        'student': 'СОЗДАТЬ УЧЕНИКА',
        'sales_manager': 'СОЗДАТЬ МЕНЕДЖЕРА ПО ПРОДАЖАМ',
        'teacher': 'СОЗДАТЬ ПРЕПОДАВАТЕЛЯ',
        'admin': 'СОЗДАТЬ АДМИНИСТРАТОРА'
    };
    title.textContent = titles[role] || 'СОЗДАТЬ ПОЛЬЗОВАТЕЛЯ';
    
    // Показываем поля для преподавателя
    const isTeacher = role === 'teacher';
    directionsGroup.style.display = isTeacher ? 'block' : 'none';
    
    const bioGroup = document.getElementById('newUserBioGroup');
    const photoGroup = document.getElementById('newUserPhotoGroup');
    if (bioGroup) bioGroup.style.display = isTeacher ? 'block' : 'none';
    if (photoGroup) photoGroup.style.display = isTeacher ? 'block' : 'none';
    
    // Форматирование телефона
    const phoneInput = document.getElementById('newUserPhone');
    phoneInput.addEventListener('input', function(e) {
        let value = e.target.value.replace(/\D/g, '');
        if (value.length > 0) {
            if (value[0] === '8') value = '7' + value.slice(1);
            if (!value.startsWith('7')) value = '7' + value;
        }
        if (value.length > 1) {
            let formatted = '+7 (';
            if (value.length > 1) formatted += value.slice(1, 4);
            if (value.length >= 5) formatted += ') ' + value.slice(4, 7);
            if (value.length >= 8) formatted += '-' + value.slice(7, 9);
            if (value.length >= 10) formatted += '-' + value.slice(9, 11);
            e.target.value = formatted;
        }
    });
    
    // Показываем модальное окно
    modal.classList.add('show');
}

// Закрыть модальное окно создания
function closeCreateUserModal() {
    const modal = document.getElementById('createUserModal');
    const form = document.getElementById('createUserForm');
    modal.classList.remove('show');
    form.reset();
}

// Обработка формы создания пользователя
document.getElementById('createUserForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const role = document.getElementById('newUserRole').value;
    const name = document.getElementById('newUserName').value;
    const phone = document.getElementById('newUserPhone').value;
    const password = document.getElementById('newUserPassword').value;
    
    // Получаем направления и дополнительные данные если это преподаватель
    let directions = [];
    let bio = '';
    let photo = '';
    
    if (role === 'teacher') {
        const checkboxes = document.querySelectorAll('input[name="newDirections"]:checked');
        directions = Array.from(checkboxes).map(cb => cb.value);
        
        const bioInput = document.getElementById('newUserBio');
        const photoInput = document.getElementById('newUserPhoto');
        if (bioInput) bio = bioInput.value.trim();
        if (photoInput) photo = photoInput.value.trim();
    }
    
    try {
        const token = getAuthToken();
        let endpoint = '';
        let body = { 
            name, 
            phone, 
            password,
            gender: 'male' // По умолчанию, т.к. это обязательное поле в модели Student
        };
        
        // Выбираем endpoint в зависимости от роли
        switch(role) {
            case 'student':
                // Используем обычную регистрацию
                endpoint = `${API_URL}/auth/register`;
                break;
            case 'sales_manager':
                endpoint = `${API_URL}/users/sales-managers`;
                break;
            case 'teacher':
                endpoint = `${API_URL}/users/teachers`;
                body.directions = directions;
                body.bio = bio;
                body.photo = photo;
                break;
            case 'admin':
                endpoint = `${API_URL}/users/admins`;
                break;
        }
        
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Показываем модальное окно с паролем
            const generatedPassword = data.generatedPassword || password;
            
            // Копируем пароль в буфер
            const copySuccess = await copyToClipboard(generatedPassword);
            
            // Определяем тип пользователя для заголовка
            const userTypeText = {
                'student': 'Ученик',
                'sales_manager': 'Менеджер по продажам',
                'teacher': 'Преподаватель',
                'admin': 'Администратор'
            }[role] || 'Пользователь';
            
            showPasswordModal(name, phone, generatedPassword, copySuccess, userTypeText);
            
            closeCreateUserModal();
            renderUsers(currentRoleFilter);
            renderDashboard(); // Обновляем статистику
        } else {
            showNotification(notificationWithIcon('error', `Ошибка: ${data.error || 'Не удалось создать пользователя'}`));
        }
        
    } catch (error) {
        console.error('Ошибка создания пользователя:', error);
        showNotification(notificationWithIcon('error', 'Ошибка подключения к серверу'));
    }
});

// Кнопки создания пользователей
document.getElementById('createStudentUserBtn')?.addEventListener('click', () => {
    openCreateUserModal('student');
});

document.getElementById('createSalesManagerBtn')?.addEventListener('click', () => {
    openCreateUserModal('sales_manager');
});

document.getElementById('createTeacherBtn')?.addEventListener('click', () => {
    openCreateUserModal('teacher');
});

document.getElementById('createAdminBtn')?.addEventListener('click', () => {
    openCreateUserModal('admin');
});

// Применить видимость разделов на основе прав из базы
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
    
    console.log('User role:', userRole);
    console.log('createAdminBtn exists:', !!createAdminBtn);
    
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
        console.log('✅ Кнопка "Добавить администратора" показана');
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

// ========================================
// УПРАВЛЕНИЕ НАПРАВЛЕНИЯМИ
// ========================================
// ✅ Весь раздел Directions перенесен в modules/directions/directions.js

// ========================================
// УПРАВЛЕНИЕ ПРАВАМИ РОЛЕЙ
// ========================================
// ✅ Весь раздел Permissions перенесен в modules/permissions/permissions.js

// ========================================
// УПРАВЛЕНИЕ ЗАЛАМИ (УПРОЩЕННОЕ)
// ========================================

// Открыть модальное окно управления залами
async function openManageRoomsModal() {
    // Загружаем залы если нужно
    if (allRooms.length === 0) {
        await loadRooms();
    }
    
    // Рендерим список
    renderRoomsListInModal();
    
    const modal = document.getElementById('manageRoomsModal');
    modal.classList.add('show');
}

// Закрыть модальное окно управления залами
function closeManageRoomsModal() {
    const modal = document.getElementById('manageRoomsModal');
    modal.classList.remove('show');
}

// Открыть модальное окно формы создания/редактирования зала
function openRoomFormModal() {
    const modal = document.getElementById('roomFormModal');
    const form = document.getElementById('roomForm');
    const title = document.getElementById('roomFormModalTitle');
    
    form.reset();
    document.getElementById('roomId').value = '';
    title.textContent = 'СОЗДАТЬ ЗАЛ';
    document.getElementById('roomColor').value = '#eb4d77';
    
    modal.classList.add('show');
}

// Закрыть модальное окно формы зала
function closeRoomFormModal() {
    const modal = document.getElementById('roomFormModal');
    modal.classList.remove('show');
}

// Редактировать зал
async function editRoom(id) {
    try {
        // Ищем зал в уже загруженных
        let room = allRooms.find(r => r._id === id);
        
        // Если нет - загружаем заново
        if (!room) {
            await loadRooms();
            room = allRooms.find(r => r._id === id);
        }
        
        if (!room) {
            showNotification(notificationWithIcon('warning', 'Зал не найден'));
            return;
        }
        
        document.getElementById('roomId').value = room._id;
        document.getElementById('roomName').value = room.name;
        document.getElementById('roomColor').value = room.color || '#eb4d77';
        
        document.getElementById('roomFormModalTitle').textContent = 'РЕДАКТИРОВАТЬ ЗАЛ';
        document.getElementById('roomFormModal').classList.add('show');
    } catch (error) {
        console.error('Edit room error:', error);
        showNotification(notificationWithIcon('error', 'Ошибка при загрузке данных зала'));
    }
}

// Удалить зал
async function deleteRoom(id, name) {
    if (!await customConfirm(`Удалить зал "${name}"?`, {icon: 'warning'})) { return; }
    
    try {
        const response = await fetch(`${API_URL}/rooms/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        const data = await response.json();
        
        if (!data.success) {
            showNotification(notificationWithIcon('error', data.error || 'Ошибка при удалении зала'));
            return;
        }
        
        showNotification(notificationWithIcon('success', 'Зал успешно удален'));
        
        // Обновляем список залов
        await loadRooms();
        
        // Обновляем список в модалке
        renderRoomsListInModal();
        
        // Перезагружаем события календаря
        if (calendar) {
            calendar.refetchEvents();
        }
    } catch (error) {
        console.error('Delete room error:', error);
        showNotification(notificationWithIcon('error', 'Ошибка при удалении зала'));
    }
}

// Рендерим список залов в модалке управления
function renderRoomsListInModal() {
    const container = document.getElementById('roomsListInModal');
    if (!container) return;
    
    if (allRooms.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; opacity: 0.5;">Залы не созданы</div>';
        return;
    }
    
    container.innerHTML = allRooms.map(room => `
        <div style="
            display: flex; 
            align-items: center; 
            gap: 10px; 
            padding: 12px; 
            border-radius: 5px;
        " class="info-box" style="margin-bottom: 10px;">
            <div style="width: 24px; height: 24px; background: ${room.color}; border-radius: 4px;"></div>
            <span style="font-size: 1rem; flex: 1;">${room.name}</span>
            <button 
                onclick="editRoom('${room._id}')" 
                class="room-action-btn"
                title="Редактировать"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
            <button 
                onclick="deleteRoom('${room._id}', '${room.name}')" 
                class="room-action-btn danger"
                title="Удалить"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
            </button>
        </div>
    `).join('');
}

// Обработчик формы зала
document.getElementById('roomForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const id = document.getElementById('roomId').value;
    const name = document.getElementById('roomName').value.trim();
    const color = document.getElementById('roomColor').value;
    
    if (!name) {
        showNotification(notificationWithIcon('warning', 'Заполните название зала'));
        return;
    }
    
    try {
        const url = id 
            ? `${API_URL}/rooms/${id}`
            : `${API_URL}/rooms`;
        
        const method = id ? 'PATCH' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({ 
                name, 
                color
            })
        });
        
        const data = await response.json();
        
        if (!data.success) {
            showNotification(notificationWithIcon('error', data.error || 'Ошибка при сохранении зала'));
            return;
        }
        
        showNotification(notificationWithIcon('warning', id ? 'Зал успешно обновлен' : 'Зал успешно создан'));
        closeRoomFormModal();
        
        // Обновляем список залов в календаре
        await loadRooms();
        
        // Обновляем список в модалке управления
        renderRoomsListInModal();
        
        // Перезагружаем события календаря
        if (calendar) {
            calendar.refetchEvents();
        }
    } catch (error) {
        console.error('Save room error:', error);
        showNotification(notificationWithIcon('error', 'Ошибка при сохранении зала'));
    }
});

// Кнопка управления залами
document.getElementById('manageRoomsBtn')?.addEventListener('click', openManageRoomsModal);

// Показать кнопку управления залами для админов
function initRoomButton() {
    const userRole = localStorage.getItem('userRole');
    const manageRoomsBtn = document.getElementById('manageRoomsBtn');
    
    if (manageRoomsBtn) {
        // Кнопка доступна только для admin и super_admin
        if (['admin', 'super_admin'].includes(userRole)) {
            manageRoomsBtn.style.display = 'flex';
        } else {
            manageRoomsBtn.style.display = 'none';
        }
    }
}

// =====================================================
//  CALENDAR & SCHEDULE MANAGEMENT
// =====================================================

let calendar = null;
let allGroups = [];
let allRooms = [];
let currentRoomFilter = 'all';

// Инициализация календаря
function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl || calendar) return;
    
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'ru',
        firstDay: 1, // Понедельник
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay'
        },
        buttonText: {
            today: 'Сегодня',
            month: 'Месяц',
            week: 'Неделя',
            day: 'День'
        },
        // Формат времени для событий
        eventTimeFormat: {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        },
        // Настройки для timeGrid (Неделя/День)
        slotMinTime: '08:00:00',  // Начало дня в календаре
        slotMaxTime: '24:00:00',  // Конец дня в календаре (до полуночи)
        slotDuration: '00:30:00', // Шаг времени (30 минут)
        allDaySlot: false,        // Убираем слот "весь день"
        nowIndicator: true,       // Показываем текущее время
        
        editable: true,
        droppable: false,
        events: fetchCalendarClasses,
        eventDrop: handleEventDrop,
        eventClick: handleEventClick,
        dateClick: handleDateClick,
        eventDidMount: function(info) {
            // Добавляем tooltip
            info.el.title = `${info.event.title}\n${info.event.extendedProps.groupName || ''}`;
            
            // Применяем цвет зала к элементу
            const bgColor = info.event.backgroundColor || '#eb4d77';
            info.el.style.backgroundColor = bgColor;
            info.el.style.borderColor = bgColor;
        },
        eventContent: function(arg) {
            // Кастомное отображение с переносом текста
            // Берем цвет из backgroundColor события
            const bgColor = arg.event.backgroundColor || '#eb4d77';
            
            // Проверяем нужна ли отметка посещаемости (с учетом времени)
            const now = new Date();
            const eventEnd = arg.event.end ? new Date(arg.event.end) : new Date(arg.event.start);
            
            const isPast = eventEnd < now; // Занятие прошло если время окончания меньше текущего
            const hasGroup = arg.event.extendedProps.groupId;
            const groupStudentsCount = arg.event.extendedProps.groupStudentsCount || 0;
            const attendees = arg.event.extendedProps.attendees || [];
            
            // Считаем ТОЛЬКО учеников с attended: true
            const attendedCount = attendees.filter(a => a.attended === true).length;
            
            // Занятие требует отметки если:
            // 1. Время окончания в прошлом
            // 2. Есть группа
            // 3. В группе есть ученики
            // 4. НИ ОДИН ученик не отмечен как присутствовавший (attended: true)
            const needsAttendance = isPast && hasGroup && groupStudentsCount > 0 && attendedCount === 0;
            
            const badge = needsAttendance 
                ? `<span style="
                    position: absolute;
                    top: 2px;
                    right: 2px;
                    width: 8px;
                    height: 8px;
                    background: #dc3545;
                    border-radius: 50%;
                    border: 1px solid white;
                    box-shadow: 0 0 4px rgba(220, 53, 69, 0.8);
                  "></span>` 
                : '';
            
            return {
                html: `<div style="
                    background-color: ${bgColor};
                    padding: 5px; 
                    font-size: 0.75rem; 
                    line-height: 1.3;
                    overflow: hidden;
                    word-wrap: break-word;
                    word-break: break-word;
                    white-space: normal;
                    border-radius: 3px;
                    width: 100%;
                    height: 100%;
                    position: relative;
                ">
                         ${badge}
                         <b style="display: block;">${arg.event.title}</b>
                         <small style="display: block; margin-top: 2px; opacity: 0.8;">${arg.timeText}</small>
                       </div>`
            };
        }
    });
    
    calendar.render();
    console.log('📅 Календарь инициализирован');
}

// Загрузка занятий из API
async function fetchCalendarClasses(info, successCallback, failureCallback) {
    try {
        const userRole = localStorage.getItem('userRole');
        const userId = localStorage.getItem('userId');
        
        // Формируем параметры запроса
        let url = `${API_URL}/classes?start=${info.startStr}&end=${info.endStr}`;
        
        // Если преподаватель - загружаем только его занятия
        if (userRole === 'teacher') {
            url += `&teacherId=${userId}`;
        }
        
        // Фильтр по залу
        if (currentRoomFilter !== 'all') {
            url += `&roomId=${currentRoomFilter}`;
        }
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        // Проверка на невалидный токен
        if (response.status === 401) {
            showNotification(notificationWithIcon('warning', 'Сессия истекла. Пожалуйста, войдите заново.'));
            localStorage.clear();
            window.location.href = 'login.html';
            return;
        }
        
        if (!response.ok) throw new Error('Failed to fetch classes');
        
        const data = await response.json();
        
        // Преобразуем в формат FullCalendar
        const events = data.classes.map(cls => {
            // Получаем дату в формате YYYY-MM-DD
            const dateObj = new Date(cls.date);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;
            
            const finalColor = cls.room?.color || cls.backgroundColor || '#eb4d77';
            
            return {
                id: cls._id,
                title: cls.title,  // Убрали счетчик участников
                start: `${dateStr}T${cls.startTime}:00`,  // Добавляем секунды
                end: `${dateStr}T${cls.endTime}:00`,      // Добавляем секунды
                backgroundColor: finalColor,  // Цвет зала или дефолтный
                extendedProps: {
                    groupId: cls.group?._id || null,
                    groupName: cls.group?.name || 'Специальное',
                    groupStudentsCount: cls.group?.currentStudents || 0,
                    teacherId: cls.teacher?._id || null,
                    teacherName: cls.teacher?.name || 'Не назначен',
                    roomId: cls.room?._id || null,
                    roomName: cls.room?.name || 'Не указан',
                    roomColor: cls.room?.color || '#eb4d77',
                    status: cls.status,
                    notes: cls.notes,
                    attendees: cls.attendees
                }
            };
        });
        
        successCallback(events);
    } catch (error) {
        console.error('Fetch classes error:', error);
        failureCallback(error);
    }
}

// Обработка drag & drop (перенос занятия)
async function handleEventDrop(info) {
    try {
        const classId = info.event.id;
        const newDate = info.event.start.toISOString().split('T')[0];
        const startTime = info.event.start.toTimeString().slice(0, 5);
        const endTime = info.event.end ? info.event.end.toTimeString().slice(0, 5) : '19:30';
        
        const response = await fetch(`${API_URL}/classes/${classId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                date: newDate,
                startTime,
                endTime
            })
        });
        
        // Проверка на невалидный токен
        if (response.status === 401) {
            showNotification(notificationWithIcon('warning', 'Сессия истекла. Пожалуйста, войдите заново.'));
            localStorage.clear();
            window.location.href = 'login.html';
            return;
        }
        
        if (!response.ok) throw new Error('Failed to update class');
        
        console.log('✅ Занятие перенесено');
    } catch (error) {
        console.error('Drop error:', error);
        showNotification(notificationWithIcon('error', 'Ошибка при переносе занятия'));
        info.revert(); // Возвращаем обратно
    }
}

// Клик по занятию (редактирование/посещаемость)
// Текущее занятие для посещаемости
let currentClassForAttendance = null;
let currentAttendanceData = {};

// Обработка клика на занятие - открыть модалку посещаемости
async function handleEventClick(info) {
    const classData = {
        id: info.event.id,
        title: info.event.title,
        groupId: info.event.extendedProps.groupId,
        groupName: info.event.extendedProps.groupName,
        teacherId: info.event.extendedProps.teacherId,
        teacherName: info.event.extendedProps.teacherName,
        date: info.event.start,
        startTime: info.event.start.toTimeString().slice(0, 5),
        endTime: info.event.end ? info.event.end.toTimeString().slice(0, 5) : '19:30',
        status: info.event.extendedProps.status,
        notes: info.event.extendedProps.notes,
        attendees: info.event.extendedProps.attendees || [],
        roomName: info.event.extendedProps.roomName
    };
    
    currentClassForAttendance = classData;
    
    // Открыть модалку посещаемости
    await openAttendanceModal(classData);
}

// Удалить занятие
async function deleteClass(classId) {
    try {
        const response = await fetch(`${API_URL}/classes/${classId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        // Проверка на невалидный токен
        if (response.status === 401) {
            showNotification(notificationWithIcon('warning', 'Сессия истекла. Пожалуйста, войдите заново.'));
            localStorage.clear();
            window.location.href = 'login.html';
            return;
        }
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete class');
        }
        
        showNotification(notificationWithIcon('success', 'Занятие удалено'));
        
        // Обновляем календарь
        if (calendar) {
            calendar.refetchEvents();
        }
    } catch (error) {
        console.error('Delete class error:', error);
        showNotification(notificationWithIcon('error', 'Ошибка при удалении: ' + error.message));
    }
}

// ==================== ПОСЕЩАЕМОСТЬ ====================

// Загрузить преподавателей для модалки посещаемости
async function loadTeachersForAttendance(selectedTeacherId = null) {
    try {
        const response = await fetch(`${API_URL}/students?role=teacher`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        const data = await response.json();
        const teachers = data.students || [];
        
        const select = document.getElementById('attendanceTeacher');
        select.innerHTML = '<option value="">Выберите преподавателя</option>' +
            teachers.map(teacher => 
                `<option value="${teacher._id}" ${teacher._id === selectedTeacherId ? 'selected' : ''}>${teacher.name}</option>`
            ).join('');
    } catch (error) {
        console.error('Error loading teachers:', error);
    }
}

// Открыть модалку посещаемости
async function openAttendanceModal(classData) {
    try {
        // Обновить заголовок и информацию
        document.getElementById('attendanceModalTitle').textContent = 'ПОСЕЩАЕМОСТЬ';
        
        const dateStr = classData.date.toLocaleDateString('ru-RU');
        document.getElementById('classInfo').innerHTML = `
            <div style="margin-bottom: 8px;"><strong>${classData.title}</strong></div>
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 10px 15px; font-size: 0.9rem;">
                <span style="opacity: 0.7;">Дата:</span>
                <span>${dateStr}</span>
                
                <span style="opacity: 0.7;">Время:</span>
                <span>${classData.startTime} - ${classData.endTime}</span>
                
                <span style="opacity: 0.7;">Зал:</span>
                <span>${classData.roomName || 'Не указан'}</span>
            </div>
        `;
        
        // Загрузить список преподавателей и установить текущего
        await loadTeachersForAttendance(classData.teacherId);
        
        // Если это специальное занятие без группы
        if (!classData.groupId) {
            document.getElementById('attendanceList').innerHTML = `
                <p style="text-align: center; opacity: 0.5; padding: 20px;">
                    Посещаемость доступна только для занятий с группами
                </p>
            `;
            document.getElementById('attendanceModal').classList.add('show');
            return;
        }
        
        // Загрузить учеников группы
        const response = await fetch(`${API_URL}/groups/${classData.groupId}/students`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        const data = await response.json();
        const students = data.students || [];
        
        // Загрузить активные заморозки для даты занятия
        const freezesResponse = await fetch(`${API_URL}/freezes?status=active`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        const freezesData = await freezesResponse.json();
        const activeFreezes = freezesData.freezes || [];
        
        // Функция проверки, замороженное ли занятие для ученика
        function isStudentFrozen(studentId, classDate) {
            return activeFreezes.some(freeze => {
                if (freeze.student._id !== studentId) return false;
                
                const freezeStart = new Date(freeze.startDate);
                const freezeEnd = new Date(freeze.endDate);
                const clsDate = new Date(classDate);
                
                freezeStart.setHours(0, 0, 0, 0);
                freezeEnd.setHours(23, 59, 59, 999);
                clsDate.setHours(12, 0, 0, 0);
                
                return clsDate >= freezeStart && clsDate <= freezeEnd;
            });
        }
        
        if (students.length === 0) {
            document.getElementById('attendanceList').innerHTML = `
                <p style="text-align: center; opacity: 0.5; padding: 20px;">
                    В этой группе пока нет учеников
                </p>
            `;
            document.getElementById('attendanceModal').classList.add('show');
            return;
        }
        
        // Создать объект для хранения отметок
        currentAttendanceData = {};
        
        // Отобразить список учеников с чекбоксами
        const attendanceList = document.getElementById('attendanceList');
        attendanceList.innerHTML = students.map(student => {
            // Проверить был ли уже отмечен
            const attendee = classData.attendees.find(a => a.student._id === student._id || a.student === student._id);
            const isPresent = attendee ? attendee.attended : false;
            
            // Проверить есть ли заморозка
            const isFrozen = isStudentFrozen(student._id, classData.date);
            
            // Сохранить начальное состояние
            currentAttendanceData[student._id] = isPresent;
            
            return `
                <div style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 15px;
                    background: var(--bg-secondary);
                    border-radius: 8px;
                    border-left: 3px solid ${isFrozen ? '#60a5fa' : isPresent ? '#28a745' : '#6c757d'};
                    ${isFrozen ? 'opacity: 0.7;' : ''}
                " id="attendance-item-${student._id}">
                    <div style="flex: 1;">
                        <div style="font-weight: 600; margin-bottom: 5px;">
                            ${student.name}
                            ${isFrozen ? '<span style="color: #60a5fa; margin-left: 8px; font-size: 0.85em;">❄️ ЗАМОРОЗКА</span>' : ''}
                        </div>
                        <div style="font-size: 0.9rem; opacity: 0.7;">${student.phone}</div>
                    </div>
                    <label style="display: flex; align-items: center; gap: 10px; cursor: ${isFrozen ? 'not-allowed' : 'pointer'};">
                        <span style="font-size: 0.9rem; opacity: 0.8;">Присутствовал</span>
                        <input type="checkbox" 
                               ${isPresent ? 'checked' : ''}
                               ${isFrozen ? 'disabled' : ''}
                               onchange="toggleAttendance('${student._id}')"
                               style="width: 20px; height: 20px; cursor: ${isFrozen ? 'not-allowed' : 'pointer'};">
                    </label>
                </div>
            `;
        }).join('');
        
        // Открыть модалку
        document.getElementById('attendanceModal').classList.add('show');
    } catch (error) {
        console.error('Ошибка загрузки посещаемости:', error);
        showNotification(notificationWithIcon('error', 'Ошибка при загрузке данных занятия'));
    }
}

// Закрыть модалку посещаемости
function closeAttendanceModal() {
    document.getElementById('attendanceModal').classList.remove('show');
    currentClassForAttendance = null;
    currentAttendanceData = {};
}

// Переключить отметку посещаемости
function toggleAttendance(studentId) {
    currentAttendanceData[studentId] = !currentAttendanceData[studentId];
    
    // Обновить визуал
    const item = document.getElementById(`attendance-item-${studentId}`);
    if (item) {
        item.style.borderLeftColor = currentAttendanceData[studentId] ? '#28a745' : '#6c757d';
    }
}

// Отметить всех присутствующими
function markAllPresent() {
    Object.keys(currentAttendanceData).forEach(studentId => {
        currentAttendanceData[studentId] = true;
        const checkbox = document.querySelector(`#attendance-item-${studentId} input[type="checkbox"]`);
        const item = document.getElementById(`attendance-item-${studentId}`);
        if (checkbox) checkbox.checked = true;
        if (item) item.style.borderLeftColor = '#28a745';
    });
}

// Снять отметки со всех
function markAllAbsent() {
    Object.keys(currentAttendanceData).forEach(studentId => {
        currentAttendanceData[studentId] = false;
        const checkbox = document.querySelector(`#attendance-item-${studentId} input[type="checkbox"]`);
        const item = document.getElementById(`attendance-item-${studentId}`);
        if (checkbox) checkbox.checked = false;
        if (item) item.style.borderLeftColor = '#6c757d';
    });
}

// Сохранить посещаемость
async function saveAttendance() {
    try {
        const classId = currentClassForAttendance.id;
        
        // Проверить изменился ли преподаватель
        const newTeacherId = document.getElementById('attendanceTeacher').value;
        if (newTeacherId && newTeacherId !== currentClassForAttendance.teacherId) {
            // Обновить преподавателя занятия
            await fetch(`${API_URL}/classes/${classId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getAuthToken()}`
                },
                body: JSON.stringify({ teacherId: newTeacherId })
            });
        }
        
        // Отправить отметки для каждого ученика
        const promises = Object.entries(currentAttendanceData).map(([studentId, attended]) => {
            return fetch(`${API_URL}/classes/${classId}/attendance`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getAuthToken()}`
                },
                body: JSON.stringify({ studentId, attended })
            });
        });
        
        await Promise.all(promises);
        
        showNotification(notificationWithIcon('success', 'Посещаемость сохранена'));
        closeAttendanceModal();
        
        // Обновить календарь
        if (calendar) {
            calendar.refetchEvents();
        }
        
        // Обновить badge неотмеченных посещаемостей
        updatePendingAttendanceBadge();
    } catch (error) {
        console.error('Ошибка сохранения посещаемости:', error);
        showNotification(notificationWithIcon('error', 'Ошибка при сохранении посещаемости'));
    }
}

// Удалить занятие из модалки посещаемости
async function deleteClassFromAttendance() {
    const classData = currentClassForAttendance;
    const dateStr = classData.date.toLocaleDateString('ru-RU');
    
    if (await customConfirm(`Удалить занятие?\n\n${classData.title}\n${dateStr} ${classData.startTime}-${classData.endTime}`)) {
        closeAttendanceModal();
        deleteClass(classData.id);
    }
}

// Клик по дате (создание нового занятия)
function handleDateClick(info) {
    openClassModal(info);
}

// Открыть модалку создания занятия
async function openClassModal(dateInfo = null) {
    const modal = document.getElementById('classModal');
    const title = document.getElementById('classModalTitle');
    const form = document.getElementById('classForm');
    const userRole = localStorage.getItem('userRole');
    
    // Сброс формы
    form.reset();
    document.getElementById('classId').value = '';
    title.textContent = 'СОЗДАТЬ ЗАНЯТИЕ';
    
    // Установить выбранную дату и время
    if (dateInfo) {
        // Если передан объект info от FullCalendar
        if (typeof dateInfo === 'object' && dateInfo.date) {
            const clickedDate = dateInfo.date;
            
            // Установить дату
            const dateStr = clickedDate.toISOString().split('T')[0];
            document.getElementById('classDate').value = dateStr;
            
            // Извлечь время клика
            const hours = clickedDate.getHours();
            const minutes = clickedDate.getMinutes();
            
            // Установить время начала
            const startTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
            document.getElementById('classStartTime').value = startTime;
            
            // Установить время окончания (+1 час)
            const endHours = hours + 1;
            const endTime = `${String(endHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
            document.getElementById('classEndTime').value = endTime;
        } 
        // Если передана просто строка с датой (старый формат)
        else if (typeof dateInfo === 'string') {
            document.getElementById('classDate').value = dateInfo;
            // Время по умолчанию
            document.getElementById('classStartTime').value = '18:00';
            document.getElementById('classEndTime').value = '19:00';
        }
    } else {
        // Сегодня
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('classDate').value = today;
        // Время по умолчанию
        document.getElementById('classStartTime').value = '18:00';
        document.getElementById('classEndTime').value = '19:00';
    }
    
    // Загрузить группы для выбора
    await loadGroupsForClass();
    
    // Загрузить залы для выбора
    await loadRoomsForClass();
    
    // Показать выбор преподавателя только для админов
    const teacherGroup = document.getElementById('classTeacherGroup');
    if (teacherGroup) {
        if (userRole === 'admin' || userRole === 'super_admin') {
            teacherGroup.style.display = 'block';
            await loadTeachersForClass();
        } else {
            teacherGroup.style.display = 'none';
        }
    }
    
    modal.classList.add('show');
}

// Закрыть модалку занятия
function closeClassModal() {
    const modal = document.getElementById('classModal');
    modal.classList.remove('show');
}

// Загрузить группы для выбора в форме
async function loadGroupsForClass() {
    try {
        const response = await fetch(`${API_URL}/groups`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (!response.ok) throw new Error('Failed to fetch groups');
        
        const data = await response.json();
        allGroups = data.groups;
        
        const select = document.getElementById('classGroup');
        
        // Специальные опции (захардкоженные)
        const specialOptions = `
            <optgroup label="Специальные">
                <option value="special_rent">Аренда зала</option>
                <option value="special_individual">Индивидуальное занятие</option>
            </optgroup>
        `;
        
        // Обычные группы
        const regularOptions = allGroups.length > 0 
            ? '<optgroup label="Группы">' + 
              allGroups.map(group => 
                  `<option value="${group._id}">${group.name} - ${group.direction}</option>`
              ).join('') + 
              '</optgroup>'
            : '';
        
        select.innerHTML = '<option value="">Выберите группу</option>' + 
                          specialOptions + 
                          regularOptions;
    } catch (error) {
        console.error('Load groups error:', error);
    }
}

// Загрузить преподавателей для выбора (только для админов)
async function loadTeachersForClass() {
    try {
        const response = await fetch(`${API_URL}/students`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (!response.ok) throw new Error('Failed to fetch teachers');
        
        const data = await response.json();
        // Фильтруем только преподавателей
        const teachers = data.students.filter(user => user.role === 'teacher');
        
        const select = document.getElementById('classTeacher');
        select.innerHTML = '<option value="">По умолчанию (из группы)</option>' + 
            teachers.map(teacher => 
                `<option value="${teacher._id}">${teacher.name}</option>`
            ).join('');
    } catch (error) {
        console.error('Load teachers error:', error);
    }
}

// Toggle recurring fields
document.getElementById('classIsRecurring')?.addEventListener('change', function(e) {
    const recurringFields = document.getElementById('recurringFields');
    recurringFields.style.display = e.target.checked ? 'block' : 'none';
    
    // Устанавливаем дату окончания на 3 месяца вперёд по умолчанию
    if (e.target.checked) {
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 3);
        document.getElementById('classRecurringEndDate').value = endDate.toISOString().split('T')[0];
    }
});

// Обработка создания занятия
document.getElementById('classForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const classId = document.getElementById('classId').value;
    const groupId = document.getElementById('classGroup').value;
    const teacherId = document.getElementById('classTeacher')?.value || '';
    const roomId = document.getElementById('classRoom')?.value || '';
    const date = document.getElementById('classDate').value;
    const startTime = document.getElementById('classStartTime').value;
    const endTime = document.getElementById('classEndTime').value;
    const isRecurring = document.getElementById('classIsRecurring').checked;
    const isPractice = document.getElementById('classIsPractice').checked;
    
    // Вычисляем продолжительность автоматически
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);
    const duration = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
    
    if (!groupId || !date || !startTime || !endTime) {
        showNotification(notificationWithIcon('warning', 'Заполните все обязательные поля'));
        return;
    }
    
    if (duration <= 0) {
        showNotification(notificationWithIcon('warning', 'Время окончания должно быть позже времени начала'));
        return;
    }
    
    try {
        let body = {
            groupId,
            date,
            startTime,
            endTime,
            duration,
            isRecurring,
            isPractice
        };
        
        // Если админ выбрал конкретного преподавателя - отправляем
        if (teacherId) {
            body.teacherId = teacherId;
        }
        
        // Если выбран зал - отправляем
        if (roomId) {
            body.roomId = roomId;
        }
        
        // Если повторяющееся - добавляем правила
        if (isRecurring) {
            const daysCheckboxes = document.querySelectorAll('input[name="daysOfWeek"]:checked');
            const daysOfWeek = Array.from(daysCheckboxes).map(cb => parseInt(cb.value));
            const recurringEndDate = document.getElementById('classRecurringEndDate').value;
            
            if (daysOfWeek.length === 0) {
                showNotification(notificationWithIcon('warning', 'Выберите хотя бы один день недели'));
                return;
            }
            
            body.recurringRule = {
                frequency: 'weekly',
                daysOfWeek,
                endDate: recurringEndDate
            };
        }
        
        const url = classId ? `${API_URL}/classes/${classId}` : `${API_URL}/classes`;
        const method = classId ? 'PATCH' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify(body)
        });
        
        // Проверка на невалидный токен
        if (response.status === 401) {
            showNotification(notificationWithIcon('warning', 'Сессия истекла. Пожалуйста, войдите заново.'));
            localStorage.clear();
            window.location.href = 'login.html';
            return;
        }
        
        if (response.status === 409) {
            const error = await response.json();
            showNotification(notificationWithIcon('error', '⚠️ Конфликт:\n' + error.error));
            return;
        }
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save class');
        }
        
        const result = await response.json();
        
        if (isRecurring && result.classes) {
            showNotification(notificationWithIcon('success', `Создано ${result.classes.length} повторяющихся занятий`));
        } else {
            showNotification(notificationWithIcon('warning', classId ? 'Занятие обновлено' : 'Занятие создано'));
        }
        
        closeClassModal();
        
        // Обновляем календарь
        if (calendar) {
            calendar.refetchEvents();
        }
    } catch (error) {
        console.error('Save class error:', error);
        showNotification(notificationWithIcon('error', 'Ошибка: ' + error.message));
    }
});

// Показать/скрыть вкладку расписания в зависимости от роли
function initScheduleAccess() {
    const userRole = localStorage.getItem('userRole');
    const scheduleLink = document.getElementById('scheduleLink');
    
    if (scheduleLink) {
        // Расписание доступно для teacher, admin, super_admin
        if (['teacher', 'admin', 'super_admin'].includes(userRole)) {
            scheduleLink.style.display = 'flex';
        } else {
            scheduleLink.style.display = 'none';
        }
    }
}

// Загрузить залы из API
async function loadRooms() {
    try {
        const response = await fetch(`${API_URL}/rooms?activeOnly=true`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        if (!response.ok) throw new Error('Failed to fetch rooms');
        
        const data = await response.json();
        allRooms = data.rooms;
        
        console.log(`🏢 Загружено залов: ${allRooms.length}`);
        
        // Рендерим фильтры
        renderRoomFilters();
        
        return allRooms;
    } catch (error) {
        console.error('Load rooms error:', error);
        return [];
    }
}

// Рендерим кнопки фильтров по залам
function renderRoomFilters() {
    const container = document.getElementById('roomFilters');
    if (!container) return;
    
    let html = '<button class="filter-btn active" data-room="all" onclick="filterByRoom(\'all\')">Все залы</button>';
    
    allRooms.forEach(room => {
        html += `<button class="filter-btn" data-room="${room._id}" onclick="filterByRoom('${room._id}')" style="border-color: ${room.color};">
                    ${room.name}
                 </button>`;
    });
    
    container.innerHTML = html;
}

// Фильтрация по залу
function filterByRoom(roomId) {
    currentRoomFilter = roomId;
    
    // Обновляем активную кнопку
    document.querySelectorAll('#roomFilters .filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.room === roomId) {
            btn.classList.add('active');
        }
    });
    
    // Перезагружаем события календаря
    if (calendar) {
        calendar.refetchEvents();
    }
}

// Загрузить залы для выбора в форме
async function loadRoomsForClass() {
    if (allRooms.length === 0) {
        await loadRooms();
    }
    
    const select = document.getElementById('classRoom');
    if (!select) return;
    
    select.innerHTML = '<option value="">Не указан</option>' + 
        allRooms.map(room => 
            `<option value="${room._id}" style="color: ${room.color};">${room.name}</option>`
        ).join('');
}

// Примечание: Автоматическое списание занятий теперь выполняется на сервере
// через cron job каждые 30 минут (см. backend/src/server.js)

window.addEventListener('DOMContentLoaded', async () => {
    // Инициализация темы
    initTheme();
    
    // Отображаем информацию о текущем пользователе
    displayCurrentUser();
    
    // Инициализация доступа к расписанию (быстрая, синхронная)
    initScheduleAccess();
    
    // Инициализация кнопки создания зала (быстрая, синхронная)
    initRoomButton();
    
    // ⚡ ОПТИМИЗАЦИЯ: Все асинхронные операции выполняем параллельно
    try {
        await Promise.all([
            initUserManagement(),               // Загружает права и применяет видимость
            renderDashboard(),                  // Загружает статистику для дашборда
            updatePendingAttendanceBadge()      // Обновляет бейдж посещаемости
        ]);
    } catch (error) {
        console.error('❌ Ошибка загрузки админ-панели:', error);
        // Fallback - загружаем хотя бы дашборд
    renderDashboard();
    }
    
    // ℹ️ Остальные вкладки (Заявки, Ученики, Группы и т.д.) 
    // загружаются автоматически при клике через loadSectionData()
});

// ========== УПРАВЛЕНИЕ АБОНЕМЕНТАМИ ==========

let currentMembershipStudentId = null;
let currentMembershipStudent = null;

// Открыть модалку создания абонемента
async function openMembershipModal() {
    if (!currentViewingStudentId) {
        showNotification(notificationWithIcon('warning', 'Ошибка: ученик не выбран'));
        return;
    }
    
    try {
        const token = getAuthToken();
        
        // Загрузить данные ученика
        const studentResponse = await fetch(`${API_URL}/students/${currentViewingStudentId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const { student } = await studentResponse.json();
        
        // Проверить есть ли у ученика группы
        const activeGroups = student.groups?.filter(g => g.status === 'active') || [];
        
        if (activeGroups.length === 0) {
            showNotification(notificationWithIcon('warning', 'ОШИБКА\n\nУченик не прикреплён ни к одной группе!\n\nСначала добавьте ученика в группу во вкладке "Группы".'));
            return;
        }
        
        currentMembershipStudentId = student._id;
        currentMembershipStudent = student;
        
        // Загрузить все группы
        const groupsResponse = await fetch(`${API_URL}/groups`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const groupsData = await groupsResponse.json();
        const allGroups = groupsData.groups || [];
        
        // Информация об ученике с текущими группами
        const genderText = student.gender === 'male' ? 'Мужчина' : 'Женщина';
        const groupNames = activeGroups.map(g => g.groupId?.name || 'Группа').join(', ');
        
        document.getElementById('membershipStudentInfo').innerHTML = `
            <div style="font-size: 0.9em;">
                <strong>${student.name}</strong><br>
                Телефон: ${student.phone}<br>
                Пол: ${genderText}<br>
                <span style="color: #eb4d77;">Группы: ${groupNames}</span>
            </div>
        `;
        
        // Заполнить выпадающий список групп
        const groupSelect = document.getElementById('membershipGroupId');
        groupSelect.innerHTML = '<option value="">Выберите группу</option>';
        
        // Сначала показать группы ученика
        activeGroups.forEach(g => {
            if (g.groupId) {
                const option = document.createElement('option');
                option.value = g.groupId._id;
                option.textContent = `${g.groupId.name} (текущая группа ученика)`;
                option.selected = true; // Выбрать первую группу по умолчанию
                groupSelect.appendChild(option);
            }
        });
        
        // Потом показать остальные группы (на случай если хотят назначить на другую)
        allGroups.forEach(group => {
            const isStudentGroup = activeGroups.some(g => g.groupId?._id === group._id);
            if (!isStudentGroup) {
                const option = document.createElement('option');
                option.value = group._id;
                option.textContent = group.name;
                groupSelect.appendChild(option);
            }
        });
        
        document.getElementById('membershipStudentId').value = student._id;
        document.getElementById('membershipType').value = '';
        document.getElementById('membershipPreview').textContent = 'Выберите тип абонемента';
        
        document.getElementById('membershipModal').classList.add('show');
    } catch (error) {
        console.error('Error loading student:', error);
        showNotification(notificationWithIcon('error', 'Ошибка при загрузке данных ученика'));
    }
}

// Закрыть модалку
function closeMembershipModal() {
    document.getElementById('membershipModal').classList.remove('show');
}

// ========== ДОБАВЛЕНИЕ ЗАНЯТИЙ К АБОНЕМЕНТУ ==========

function openAddClassesModal(studentId, membershipId) {
    document.getElementById('addClassesStudentId').value = studentId;
    document.getElementById('addClassesMembershipId').value = membershipId;
    document.getElementById('addClassesAmount').value = '';
    document.getElementById('addClassesReason').value = '';
    document.getElementById('addClassesModal').classList.add('show');
}

function closeAddClassesModal() {
    document.getElementById('addClassesModal').classList.remove('show');
}

// Обработка формы добавления занятий
document.getElementById('addClassesForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const membershipId = document.getElementById('addClassesMembershipId').value;
    const amount = parseInt(document.getElementById('addClassesAmount').value);
    const reason = document.getElementById('addClassesReason').value;
    
    if (!amount || amount <= 0) {
        showNotification(notificationWithIcon('warning', 'Укажите количество занятий'));
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/memberships/${membershipId}/add-classes`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ amount, reason })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(notificationWithIcon('success', `Добавлено ${amount} занятий к абонементу!`));
            closeAddClassesModal();
            
            // Обновить данные ученика
            const studentId = document.getElementById('addClassesStudentId').value;
            if (currentViewingStudentId === studentId) {
                viewStudent(studentId);
            }
            
            // Обновить таблицу
            renderStudents();
        } else {
            showNotification(notificationWithIcon('error', `Ошибка: ${data.error || 'Не удалось добавить занятия'}`));
        }
    } catch (error) {
        console.error('Add classes error:', error);
        showNotification(notificationWithIcon('error', 'Ошибка при добавлении занятий'));
    }
});

// Preview при выборе типа
document.getElementById('membershipType')?.addEventListener('change', (e) => {
    const type = e.target.value;
    const preview = document.getElementById('membershipPreview');
    
    if (!type) {
        preview.textContent = 'Выберите тип абонемента';
        return;
    }
    
    const gender = currentMembershipStudent?.gender;
    const freezes = gender === 'female' ? 2 : 1;
    
    let text = '';
    switch(type) {
        case 'trial':
            text = `Пробный абонемент: 1 занятие<br>Заморозок: 0`;
            break;
        case 'monthly':
            text = `Месячный абонемент: 8 занятий (30 дней)<br>Заморозок: ${freezes}`;
            break;
        case 'quarterly':
            text = `Квартальный абонемент: 24 занятия (90 дней)<br>Заморозок: ${freezes}`;
            break;
    }
    
    preview.innerHTML = text;
});

// Создание абонемента
document.getElementById('membershipForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const studentId = document.getElementById('membershipStudentId').value;
    const groupId = document.getElementById('membershipGroupId').value;
    const type = document.getElementById('membershipType').value;
    
    if (!groupId) {
        showNotification(notificationWithIcon('warning', 'Выберите группу для абонемента'));
        return;
    }
    
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/memberships`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                studentId,
                groupId,
                type
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            const typeNames = {
                'trial': 'Пробный',
                'monthly': 'Месячный',
                'quarterly': 'Квартальный'
            };
            
            showNotification(notificationWithIcon('success', `Абонемент создан!\n\nТип: ${typeNames[type]}\nЗанятий: ${data.membership.classesRemaining}`));
            
            closeMembershipModal();
            
            // Обновить просмотр ученика если он открыт
            if (currentViewingStudentId) {
                // Принудительно перезагружаем данные студента
                await viewStudent(currentViewingStudentId);
            }
            
            // Обновить список студентов
            await renderStudents();
        } else {
            showNotification(notificationWithIcon('error', `Ошибка: ${data.error || 'Не удалось создать абонемент'}`));
        }
    } catch (error) {
        console.error('Create membership error:', error);
        showNotification(notificationWithIcon('error', 'Ошибка при создании абонемента'));
    }
});

// Загрузить информацию об абонементе в модалке просмотра ученика
async function loadStudentMembership(studentId, student = null) {
    try {
        const token = getAuthToken();
        
        // Если студент не передан, загружаем
        if (!student) {
            const studentResponse = await fetch(`${API_URL}/students/${studentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const studentData = await studentResponse.json();
            student = studentData.student;
        }
        
        const response = await fetch(`${API_URL}/memberships/student/${studentId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        
        if (data.success && data.memberships && data.memberships.length > 0) {
            // Найти активный абонемент
            const activeMembership = data.memberships.find(m => m.status === 'active');
            
            if (activeMembership) {
                const typeNames = {
                    'trial': 'Пробный',
                    'monthly': 'Месячный',
                    'quarterly': 'Квартальный'
                };
                
                const startDate = new Date(activeMembership.startDate || activeMembership.createdAt).toLocaleDateString('ru');
                
                // ЛОГИКА ОТОБРАЖЕНИЯ ЗАМОРОЗОК ДЛЯ ТЕКУЩЕГО ЦИКЛА
                // 1 цикл = 8 занятий, заморозок: 1 (муж) или 2 (жен)
                const classesUsed = activeMembership.classesUsed || 0;
                const freezesPerCycle = student.gender === 'female' ? 2 : 1;
                
                // Определяем текущий цикл (какой по счету из 8 занятий)
                const currentCycleNumber = Math.floor(classesUsed / 8);
                const freezesUsedInPreviousCycles = currentCycleNumber * freezesPerCycle;
                
                // Сколько использовано в ТЕКУЩЕМ цикле
                const freezesUsedInCurrentCycle = Math.max(0, (activeMembership.freezesUsed || 0) - freezesUsedInPreviousCycles);
                
                // Показываем заморозки только для текущего цикла
                const freezesText = `${Math.min(freezesUsedInCurrentCycle, freezesPerCycle)}/${freezesPerCycle}`;
                
                const userRole = localStorage.getItem('userRole');
                const canAddClasses = userRole === 'super_admin' || userRole === 'admin';
                
                // Красный цвет если остается 1 занятие
                const classesRemaining = Number(activeMembership.classesRemaining);
                const classesColor = classesRemaining === 1 ? '#ef4444' : '#eb4d77';
                console.log('🎨 Classes remaining:', classesRemaining, 'Color:', classesColor);
                
                document.getElementById('studentMembershipInfo').innerHTML = `
                    <div style="display: grid; grid-template-columns: auto 1fr; gap: 15px; align-items: center;">
                        <strong style="color: rgba(255,255,255,0.7);">Тип:</strong>
                        <span>${typeNames[activeMembership.type]}</span>
                        
                        <strong style="color: rgba(255,255,255,0.7);">Занятий осталось:</strong>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="color: ${classesColor}; font-weight: ${classesRemaining === 1 ? '700' : '600'}; font-size: 1.3em;">${classesRemaining}</span>
                            ${canAddClasses ? `
                                <button 
                                    onclick="openAddClassesModal('${studentId}', '${activeMembership._id}')" 
                                    class="icon-btn"
                                    title="Добавить занятия"
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                        <line x1="12" y1="5" x2="12" y2="19"></line>
                                        <line x1="5" y1="12" x2="19" y2="12"></line>
                                    </svg>
                                </button>
                            ` : ''}
                        </div>
                        
                        <strong style="color: rgba(255,255,255,0.7);">Использовано:</strong>
                        <span>${activeMembership.classesUsed} из ${activeMembership.totalClasses}</span>
                        
                        <strong style="color: rgba(255,255,255,0.7);">Заморозок использовано:</strong>
                        <span>${freezesText}</span>
                        
                        <strong style="color: rgba(255,255,255,0.7);">Активирован:</strong>
                        <span>${startDate}</span>
                        
                        <strong style="color: rgba(255,255,255,0.7);">Статус:</strong>
                        <span style="color: #10b981;">Активен</span>
                    </div>
                `;
            } else {
                document.getElementById('studentMembershipInfo').innerHTML = `
                    <div style="text-align: center; padding: 20px; opacity: 0.7;">
                        Нет активного абонемента
                    </div>
                `;
            }
        } else {
            document.getElementById('studentMembershipInfo').innerHTML = `
                <div style="text-align: center; padding: 20px; opacity: 0.7;">
                    Нет активного абонемента
                </div>
            `;
        }
    } catch (error) {
        console.error('Load membership error:', error);
        document.getElementById('studentMembershipInfo').innerHTML = `
            <div style="text-align: center; padding: 20px; color: #ef4444;">
                Ошибка загрузки абонемента
            </div>
        `;
    }
}

// Обновить функцию viewStudent чтобы загружать абонемент
const originalViewStudent = viewStudent;
viewStudent = async function(id) {
        const token = getAuthToken();
    
    // Загружаем данные студента
    const studentResponse = await fetch(`${API_URL}/students/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const { student } = await studentResponse.json();
    
    await originalViewStudent(id);
    await loadStudentMembership(id, student); // Передаем данные студента
};

// =====================================================
// ЗАМОРОЗКИ - ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =====================================================
// Примечание: Вкладка "Заморозки" удалена из интерфейса,
// но механика заморозок работает в профиле ученика и посещаемости
