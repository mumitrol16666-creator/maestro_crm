// =====================================================
// GROUPS MODULE - Управление группами
// =====================================================

// Массив для хранения расписаний в форме
let scheduleItems = [];
let currentGroupForStudents = null;
let groupRooms = []; // Список залов для выбора

// Отобразить группы
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
            <div class="group-card-header" style="border-left: 5px solid ${group.color || '#eb4d77'}; padding-left: 15px;">
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

// Открыть модалку создания группы
function openGroupModal() {
    scheduleItems = [];
    document.getElementById('groupId').value = '';
    document.getElementById('groupForm').reset();
    document.getElementById('groupModalTitle').textContent = 'СОЗДАТЬ ГРУППУ';
    document.getElementById('scheduleList').innerHTML = '';
    document.getElementById('groupColor').value = '#eb4d77'; // Дефолтный цвет
    document.querySelector('#groupForm button[type="submit"]').textContent = 'СОЗДАТЬ';
    
    // Загрузить преподавателей, направления и залы
    loadTeachersForGroup();
    loadRoomsForGroups();
    loadDirectionsForGroup();
    
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
        const response = await fetch(`${API_URL}/users?role=teacher`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        const data = await response.json();
        const teachers = data.users || data.students || [];
        
        const select = document.getElementById('groupTeacher');
        select.innerHTML = '<option value="">Выберите преподавателя</option>';
        
        teachers.forEach(teacher => {
            const option = document.createElement('option');
            option.value = teacher._id;
            option.textContent = teacher.name;
            select.appendChild(option);
        });
    } catch (error) {
    }
}

// Загрузить залы для расписания групп
async function loadRoomsForGroups() {
    try {
        const response = await fetch(`${API_URL}/rooms`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        if (!response.ok) throw new Error('Failed to fetch rooms');
        
        const data = await response.json();
        groupRooms = data.rooms || [];
    } catch (error) {
        console.error('Failed to load rooms:', error);
        groupRooms = [];
    }
}

// Загрузить направления для групп
async function loadDirectionsForGroup(selectedValue = null) {
    try {
        const response = await fetch(`${API_URL}/directions`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        if (!response.ok) throw new Error('Failed to fetch directions');
        
        const data = await response.json();
        const directions = data.directions || [];
        
        const select = document.getElementById('groupDirection');
        select.innerHTML = '<option value="">Выберите направление</option>';
        
        directions.forEach(direction => {
            const option = document.createElement('option');
            option.value = direction.name; // Группы привязываются по имени направления
            option.textContent = direction.name;
            if (selectedValue && direction.name === selectedValue) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Failed to load directions:', error);
    }
}

// Добавить элемент расписания
function addScheduleItem() {
    const item = {
        id: Date.now(),
        dayOfWeek: 1, // Понедельник по умолчанию
        time: '18:00',
        duration: 90,
        room: null,
        isPractice: false
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
            <!-- Первый ряд: День, Время, Длительность -->
            <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 10px; margin-bottom: 10px;">
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
            </div>
            
            <!-- Второй ряд: Зал и кнопка удаления -->
            <div style="display: grid; grid-template-columns: 1fr auto; gap: 10px; margin-bottom: 10px;">
                <select class="admin-input" style="margin: 0;" onchange="updateScheduleItem(${item.id}, 'room', this.value)">
                    <option value="">Зал не выбран</option>
                    ${groupRooms.map(room => {
                        const roomId = room.id || room._id;
                        return `<option value="${roomId}" ${item.room === roomId ? 'selected' : ''}>${room.name}</option>`;
                    }).join('')}
                </select>
                
                <button type="button" class="table-btn" onclick="removeScheduleItem(${item.id})" 
                        style="padding: 8px 16px; margin: 0; background: #dc3545; white-space: nowrap;">
                    Удалить
                </button>
            </div>
            
            <!-- Чекбокс практики -->
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;">
                <input type="checkbox" ${item.isPractice ? 'checked' : ''} 
                       onchange="updateScheduleItem(${item.id}, 'isPractice', this.checked)"
                       style="cursor: pointer;">
                <span style="font-size: 0.9rem; opacity: 0.8;">Это практика (доступна всем ученикам)</span>
            </label>
        </div>
    `).join('');
}

// Редактировать группу
async function editGroup(id) {
    try {
        // ⚡ МОМЕНТАЛЬНО открываем модалку с базовыми данными
        document.getElementById('groupId').value = id;
        document.getElementById('groupModalTitle').textContent = 'ЗАГРУЗКА...';
        document.querySelector('#groupForm button[type="submit"]').textContent = 'СОХРАНИТЬ';
        
        // ОТКРЫВАЕМ МОДАЛКУ СРАЗУ!
        document.getElementById('groupModal').classList.add('show');
        
        // ⚡ ПАРАЛЛЕЛЬНО загружаем данные В ФОНЕ
        const [groupData] = await Promise.all([
            fetch(`${API_URL}/groups/${id}`, {
                headers: {
                    'Authorization': `Bearer ${getAuthToken()}`
                }
            }).then(r => r.json()),
            loadTeachersForGroup(),  // Загружаем преподавателей параллельно
            loadRoomsForGroups(),     // Загружаем залы параллельно
            loadDirectionsForGroup()  // Загружаем направления
        ]);
        
        const group = groupData.group;
        
        if (!group) {
            toast.warning( 'Группа не найдена');
            document.getElementById('groupModal').classList.remove('show');
            return;
        }
        
        // Заполняем форму
        document.getElementById('groupName').value = group.name;
        document.getElementById('groupDirection').value = group.direction;
        document.getElementById('groupIsActive').checked = group.isActive;
        document.getElementById('groupColor').value = group.color || '#eb4d77';
        
        const teacherId = group.teacherId || (group.teacher && (group.teacher._id || group.teacher.id));
        if (teacherId) {
            document.getElementById('groupTeacher').value = teacherId;
        }
        
        // Загружаем расписание
        scheduleItems = (group.schedule || []).map(s => ({
            id: Date.now() + Math.random(),
            dayOfWeek: s.dayOfWeek,
            time: s.time,
            duration: s.duration,
            room: s.room?.id || s.room?._id || (typeof s.room === 'string' ? s.room : null),
            isPractice: s.isPractice || false
        }));
        renderScheduleList();
        
        // Обновляем заголовок
        document.getElementById('groupModalTitle').textContent = 'РЕДАКТИРОВАТЬ ГРУППУ';
    } catch (error) {
        toast.error('Ошибка при загрузке данных группы');
    }
}

// Удалить группу
async function deleteGroup(id, name) {
    if (!await customConfirm(`Удалить группу "${name}"?\n\nУдаление возможно только если в группе нет учеников.`, {icon: 'warning'})) { 
        return; 
    }
    
    try {
        const response = await fetch(`${API_URL}/groups/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        const data = await response.json();
        
        if (!data.success) {
            toast.error( data.error || 'Ошибка при удалении группы');
            return;
        }
        
        toast.success( 'Группа успешно удалена');
        renderGroups();
    } catch (error) {
        toast.error('Ошибка при удалении группы');
    }
}

// Просмотр учеников группы
async function viewGroupStudents(id) {
    try {
        currentGroupForStudents = id;
        
        // ⚡ МОМЕНТАЛЬНО открываем модалку
        document.getElementById('groupStudentsModalTitle').textContent = 'ЗАГРУЗКА...';
        document.getElementById('groupStudentsList').innerHTML = '<p style="text-align: center; padding: 30px; opacity: 0.5;">Загрузка учеников...</p>';
        
        // ОТКРЫВАЕМ МОДАЛКУ СРАЗУ!
        document.getElementById('groupStudentsModal').classList.add('show');
        
        // ⚡ ПАРАЛЛЕЛЬНО загружаем данные В ФОНЕ
        const [groupData] = await Promise.all([
            fetch(`${API_URL}/groups/${id}`, {
                headers: { 'Authorization': `Bearer ${getAuthToken()}` }
            }).then(r => r.json()),
            renderGroupStudents(id)  // Загружаем учеников параллельно
        ]);
        
        const group = groupData.group;
        
        // Обновляем заголовок с именем группы
        document.getElementById('groupStudentsModalTitle').textContent = `УЧЕНИКИ ГРУППЫ: ${group.name}`;
    } catch (error) {
        toast.error('Ошибка загрузки учеников группы');
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
                <div class="student-row-link" onclick="viewStudent('${student._id}')" title="Открыть профиль">
                    <div class="student-row-link__info">
                        <div style="font-weight: 600; margin-bottom: 5px;">${student.name}</div>
                        <div style="font-size: 0.9rem; opacity: 0.7;">${student.phone}</div>
                    </div>
                    <svg class="student-row-link__chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
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
        
        const select = document.getElementById('studentToAdd');
        
        if (students.length === 0) {
            select.innerHTML = '<option value="">Ученики не найдены</option>';
            return;
        }
        
        select.innerHTML = students.map(student => `
            <option value="${student._id}">${student.name} - ${student.phone}</option>
        `).join('');
    } catch (error) {
    }
}

// Удалить ученика из группы
async function removeStudentFromGroup(groupId, studentId, studentName) {
    if (!await customConfirm(`Удалить ${studentName} из группы?`, {icon: 'warning'})) { 
        return; 
    }
    
    try {
        const response = await fetch(`${API_URL}/groups/${groupId}/students/${studentId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        const data = await response.json();
        
        if (!data.success) {
            toast.error( data.error || 'Ошибка при удалении ученика');
            return;
        }
        
        // Обновить список учеников
        await renderGroupStudents(groupId);
        
        // Обновить список групп (для обновления счетчика)
        renderGroups();
    } catch (error) {
        toast.error('Ошибка при удалении ученика из группы');
    }
}

// Инициализация обработчиков для групп
function initGroupHandlers() {
    // Кнопка создания группы
    const createGroupBtn = document.getElementById('createGroupBtn');
    if (createGroupBtn) {
        createGroupBtn.style.display = 'flex';
        createGroupBtn.addEventListener('click', openGroupModal);
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
                toast.warning( 'Выберите ученика');
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
                    toast.error( data.error || 'Ошибка при добавлении ученика');
                    return;
                }
                
                toast.success( 'Ученик успешно добавлен в группу');
                closeAddStudentToGroupModal();
                
                // Обновить список учеников
                await renderGroupStudents(groupId);
                
                // Обновить список групп (для обновления счетчика)
                renderGroups();
            } catch (error) {
                toast.error('Ошибка при добавлении ученика в группу');
            }
        });
    }
    
    // Обработчик формы группы
    const groupForm = document.getElementById('groupForm');
    if (groupForm) {
        groupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const groupId = document.getElementById('groupId').value;
            const name = document.getElementById('groupName').value;
            const direction = document.getElementById('groupDirection').value;
            const teacherId = document.getElementById('groupTeacher').value;
            const isActive = document.getElementById('groupIsActive').checked;
            const color = document.getElementById('groupColor').value;
            
            if (!name || !direction) {
                toast.warning( 'Заполните все обязательные поля');
                return;
            }
            
            if (scheduleItems.length === 0) {
                toast.warning( 'Добавьте хотя бы один элемент расписания');
                return;
            }
            
            // Получаем имя преподавателя для поля instructor
            let instructor ='Не назначен';
            if (teacherId) {
                const teacherSelect = document.getElementById('groupTeacher');
                const selectedOption = teacherSelect.options[teacherSelect.selectedIndex];
                instructor = selectedOption.text || 'Не назначен';
            }
            
            // Преобразуем scheduleItems в формат для отправки
            const schedule = scheduleItems.map(item => {
                const rId = (item.roomId && typeof item.roomId === 'object') ? (item.roomId.id || item.roomId._id) : item.roomId;
                const finalRoomId = rId || (item.room && typeof item.room === 'object' ? (item.room.id || item.room._id) : item.room);

                return {
                    dayOfWeek: item.dayOfWeek,
                    time: item.time,
                    duration: item.duration,
                    roomId: finalRoomId || null,
                    isPractice: item.isPractice
                };
            });
            
            try {
                const token = getAuthToken();
                const url = groupId ? `${API_URL}/groups/${groupId}` : `${API_URL}/groups`;
                const method = groupId ? 'PUT' : 'POST';
                
                const body = { 
                    name, 
                    direction, 
                    instructor,  // Имя преподавателя для отображения
                    schedule, 
                    isActive,
                    color
                };
                
                // Добавляем teacherId если выбран
                if (teacherId) {
                    body.teacherId = teacherId;
                }
                
                const response = await fetch(url, {
                    method: method,
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                });
                
                const data = await response.json();
                
                if (data.success) {
                    toast.success( groupId ? 'Группа успешно обновлена' : 'Группа успешно создана');
                    closeGroupModal();
                    renderGroups();
                } else {
                    toast.error(`Ошибка: ${data.error || 'Не удалось сохранить группу'}`);
                }
            } catch (error) {
                toast.error('Ошибка подключения к серверу');
            }
        });
    }
}

// Экспорт для admin.js
window.initGroupHandlers = initGroupHandlers;
