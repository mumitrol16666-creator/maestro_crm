// =====================================================
// GROUPS MODULE - Управление группами
// =====================================================

// Массив для хранения расписаний в форме
let scheduleItems = [];
let currentGroupForStudents = null;
let groupRooms = []; // Список залов для выбора
let groupInstrumentItems = [];
let groupParticipantItems = [];
let selectedGroupParticipantIds = new Set();
const DEFAULT_GROUP_LESSON_DURATION = 60;

const musicInstrumentPresets = [
    'Электрогитара', 'Акустическая гитара', 'Бас-гитара', 'Вокал',
    'Ударные', 'Клавишные', 'Скрипка', 'Укулеле', 'Другое'
];

function escapeGroupHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
}

function escapeGroupJsArg(value) {
    return String(value == null ? '' : value)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/</g, '\\x3C');
}

function formatGroupStudentName(student) {
    return [student?.lastName, student?.name, student?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || 'Ученик';
}

function renderGroupStudentNameWithAge(student) {
    const ageBadge = typeof renderStudentAgeBadge === 'function' ? renderStudentAgeBadge(student?.dateOfBirth) : '';
    return `${escapeGroupHtml(formatGroupStudentName(student))}${ageBadge}`;
}

function formatGroupStudentOption(student) {
    const age = typeof formatStudentAgeLabel === 'function' ? formatStudentAgeLabel(student?.dateOfBirth) : '';
    return `${formatGroupStudentName(student)}${age ? ` · ${age}` : ''}`;
}

function renderGroupInstruments() {
    const container = document.getElementById('groupInstrumentsList');
    if (!container) return;
    container.innerHTML = groupInstrumentItems.length ? groupInstrumentItems.map((item) => `
        <div class="group-instrument-row">
            <select class="admin-input" onchange="updateGroupInstrument(${item.id}, 'name', this.value)">
                ${musicInstrumentPresets.map(name => `<option value="${name}" ${item.name === name ? 'selected' : ''}>${name}</option>`).join('')}
            </select>
            <input class="admin-input" type="number" min="1" max="30" value="${item.quantity}" onchange="updateGroupInstrument(${item.id}, 'quantity', this.value)" title="Количество">
            <button type="button" class="table-btn danger" onclick="removeGroupInstrument(${item.id})">Удалить</button>
        </div>
    `).join('') : '<p style="opacity:.55;text-align:center;padding:8px;">Инструменты пока не указаны</p>';
}

function addGroupInstrument() {
    groupInstrumentItems.push({ id: Date.now() + Math.random(), name: 'Электрогитара', quantity: 1 });
    renderGroupInstruments();
    renderGroupFormSafety();
}

function removeGroupInstrument(id) {
    groupInstrumentItems = groupInstrumentItems.filter(item => item.id !== id);
    renderGroupInstruments();
    renderGroupFormSafety();
}

function updateGroupInstrument(id, field, value) {
    const item = groupInstrumentItems.find(entry => entry.id === id);
    if (!item) return;
    item[field] = field === 'quantity' ? Math.max(1, parseInt(value, 10) || 1) : value;
    renderGroupFormSafety();
}

function renderGroupParticipants(search = '') {
    const container = document.getElementById('groupParticipantsList');
    if (!container) return;
    const term = search.trim().toLowerCase();
    const visible = groupParticipantItems.filter(item =>
        !term || `${item.name} ${item.lastName || ''} ${item.phone || ''}`.toLowerCase().includes(term)
    );
    container.innerHTML = visible.length ? visible.map(student => `
        <label class="group-participant-option">
            <input type="checkbox" value="${escapeGroupHtml(student._id)}" ${selectedGroupParticipantIds.has(student._id) ? 'checked' : ''}
                onchange="toggleGroupParticipant('${escapeGroupJsArg(student._id)}', this.checked)">
            <span><strong>${renderGroupStudentNameWithAge(student)}</strong><small>${escapeGroupHtml(student.phone || '')}</small></span>
        </label>
    `).join('') : '<p style="opacity:.55;text-align:center;padding:10px;">Ученики не найдены</p>';
}

function toggleGroupParticipant(id, checked) {
    if (checked) selectedGroupParticipantIds.add(id);
    else selectedGroupParticipantIds.delete(id);
    renderGroupFormSafety();
}

async function loadGroupParticipants(selectedIds = []) {
    selectedGroupParticipantIds = new Set(selectedIds);
    try {
        const response = await fetch(`${API_URL}/students?role=student&status=active&limit=500`, {
            headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        const data = await response.json();
        groupParticipantItems = data.students || [];
    } catch (error) {
        groupParticipantItems = [];
    }
    renderGroupParticipants(document.getElementById('groupParticipantSearch')?.value || '');
    renderGroupFormSafety();
}

function getGroupScheduleItems(group) {
    return Array.isArray(group?.schedule) ? group.schedule : [];
}

function getGroupStudentCount(group) {
    const direct = Number(group?.currentStudents ?? group?.studentsCount);
    if (Number.isFinite(direct)) return direct;
    if (Array.isArray(group?.students)) return group.students.length;
    return 0;
}

function getGroupTeacherName(group) {
    if (group?.instructor) return group.instructor;
    return group?.teacher ? formatGroupStudentName(group.teacher) : '';
}

function getGroupRoomId(item) {
    return item?.roomId || item?.room?.id || item?.room?._id || item?.room || '';
}

function getGroupScheduleSlotKey(item) {
    return `${item?.dayOfWeek || ''}-${item?.time || ''}-${getGroupRoomId(item) || 'no-room'}`;
}

function getGroupSafetyItems(group) {
    const schedule = getGroupScheduleItems(group);
    const studentCount = getGroupStudentCount(group);
    const instruments = Array.isArray(group?.instruments) ? group.instruments : [];
    const teacherName = getGroupTeacherName(group);
    const items = [];

    if (group?.isActive === false) {
        items.push({ level: 'info', title: 'Группа выключена', detail: 'Она не должна попадать в активное расписание и продажи' });
    }

    if (!teacherName || teacherName === 'Не назначен' || teacherName === 'Ученик') {
        items.push({ level: 'danger', title: 'Нет педагога', detail: 'Занятия попадут в расписание без ответственного преподавателя' });
    }

    if (!schedule.length) {
        items.push({ level: 'danger', title: 'Нет расписания', detail: 'Группу нельзя стабильно продавать и вести без слотов' });
    }

    const noRoomCount = schedule.filter(item => !getGroupRoomId(item)).length;
    if (noRoomCount > 0) {
        items.push({ level: 'warning', title: `${noRoomCount} без зала`, detail: 'Админ может случайно поставить две группы в один кабинет' });
    }

    const shortOrLongCount = schedule.filter(item => {
        const duration = Number(item?.duration || 0);
        return duration < 30 || duration > 180;
    }).length;
    if (shortOrLongCount > 0) {
        items.push({ level: 'warning', title: 'Проверьте длительность', detail: 'Обычный урок редко короче 30 или длиннее 180 минут' });
    }

    const seenSlots = new Set();
    const duplicateSlots = schedule.filter(item => {
        const key = getGroupScheduleSlotKey(item);
        if (!key || key === '--no-room') return false;
        if (seenSlots.has(key)) return true;
        seenSlots.add(key);
        return false;
    }).length;
    if (duplicateSlots > 0) {
        items.push({ level: 'warning', title: 'Дубли расписания', detail: 'Есть одинаковые день, время и зал' });
    }

    if (studentCount === 0) {
        items.push({ level: 'warning', title: 'Нет учеников', detail: 'Проверьте, не забыли ли добавить участников' });
    } else if (studentCount > 12) {
        items.push({ level: 'warning', title: `${studentCount} учеников`, detail: 'Большой состав: проверьте зал, инструменты и качество занятия' });
    }

    if (!instruments.length) {
        items.push({ level: 'info', title: 'Состав не указан', detail: 'Инструменты помогают понять, готов ли кабинет к уроку' });
    }

    return items;
}

function renderGroupSafety(items, options = {}) {
    if (!items.length) {
        return options.showOk
            ? '<div class="group-safety is-ok"><strong>Группа готова</strong><span>Критичных предупреждений нет</span></div>'
            : '';
    }

    const limit = options.limit || 4;
    const visible = items.slice(0, limit);
    const hiddenCount = items.length - visible.length;
    return `
        <div class="group-safety">
            ${visible.map(item => `
                <div class="group-safety-item is-${item.level}">
                    <strong>${escapeGroupHtml(item.title)}</strong>
                    <span>${escapeGroupHtml(item.detail)}</span>
                </div>
            `).join('')}
            ${hiddenCount > 0 ? `<div class="group-safety-more">Ещё ${hiddenCount}</div>` : ''}
        </div>
    `;
}

function getCurrentGroupDraft() {
    const teacherSelect = document.getElementById('groupTeacher');
    const selectedTeacher = teacherSelect?.options?.[teacherSelect.selectedIndex]?.text || '';
    return {
        name: document.getElementById('groupName')?.value || '',
        instructor: document.getElementById('groupTeacher')?.value ? selectedTeacher : '',
        teacherId: document.getElementById('groupTeacher')?.value || '',
        isActive: document.getElementById('groupIsActive')?.checked !== false,
        schedule: scheduleItems,
        currentStudents: selectedGroupParticipantIds.size,
        instruments: groupInstrumentItems,
    };
}

function renderGroupFormSafety() {
    const panel = document.getElementById('groupFormSafety');
    if (!panel) return;
    const draft = getCurrentGroupDraft();
    const items = getGroupSafetyItems(draft);
    panel.style.display = '';
    panel.innerHTML = `
        <div class="group-safety-panel-head">
            <strong>Перед сохранением</strong>
            <span>${items.length ? `${items.length} ${getDeclension(items.length, 'проверка', 'проверки', 'проверок')}` : 'Всё заполнено'}</span>
        </div>
        ${renderGroupSafety(items, { showOk: true, limit: 5 })}
    `;
}

// Отобразить группы
async function renderGroups() {
    const grid = document.getElementById('groupsGrid');
    grid.innerHTML = '<p style="text-align:center; opacity:0.5;">Загрузка...</p>';
    
    const groups = await fetchGroups();
    
    if (groups.length === 0) {
        grid.innerHTML = '<p style="text-align:center; opacity:0.5;">Нет групп</p>';
        return;
    }
    
    grid.innerHTML = groups.map(group => {
        const safetyItems = getGroupSafetyItems(group);
        return `
        <div class="group-card-admin">
            <div class="group-card-header" style="border-left: 5px solid ${group.color || '#eb4d77'}; padding-left: 15px;">
                <h4 class="group-card-title">${escapeGroupHtml(group.name)}</h4>
                <p class="group-card-subtitle">${escapeGroupHtml(getGroupTeacherName(group) || 'Педагог не назначен')}</p>
            </div>
            <div class="group-card-stats">
                <div class="group-stat-row">
                    <span class="group-stat-label">Расписание:</span>
                    <span>${escapeGroupHtml(group.getScheduleText ? group.getScheduleText() : formatSchedule(group.schedule))}</span>
                </div>
                <div class="group-stat-row">
                    <span class="group-stat-label">Учеников:</span>
                    <span>${getGroupStudentCount(group)}</span>
                </div>
                <div class="group-instrument-chips">
                    ${(group.instruments || []).map(item => `<span class="group-instrument-chip">${escapeGroupHtml(item.name)} · ${escapeGroupHtml(item.quantity)}</span>`).join('') || '<span style="opacity:.55;">Состав не указан</span>'}
                </div>
            </div>
            ${renderGroupSafety(safetyItems, { showOk: true, limit: 3 })}
            <div class="table-actions">
                <button class="table-btn" onclick="editGroup('${escapeGroupJsArg(group._id)}')">Редактировать</button>
                <button class="table-btn" onclick="viewGroupStudents('${escapeGroupJsArg(group._id)}')">Ученики</button>
                <button class="table-btn" onclick="deleteGroup('${escapeGroupJsArg(group._id)}', '${escapeGroupJsArg(group.name)}')" style="background: #dc3545;">Удалить</button>
            </div>
        </div>
    `;
    }).join('');
}

// Открыть модалку создания группы
function openGroupModal() {
    scheduleItems = [];
    groupInstrumentItems = [];
    selectedGroupParticipantIds = new Set();
    document.getElementById('groupId').value = '';
    document.getElementById('groupForm').reset();
    document.getElementById('groupModalTitle').textContent = 'СОЗДАТЬ ГРУППУ';
    document.getElementById('scheduleList').innerHTML = '';
    document.getElementById('groupColor').value = '#eb4d77'; // Дефолтный цвет
    document.querySelector('#groupForm button[type="submit"]').textContent = 'СОЗДАТЬ';
    
    renderGroupInstruments();
    renderGroupFormSafety();
    loadGroupParticipants();
    // Загрузить преподавателей и залы
    loadTeachersForGroup();
    loadRoomsForGroups();
    
    document.getElementById('groupModal').classList.add('show');
}
window.openGroupModal = openGroupModal;

// Закрыть модалку группы
function closeGroupModal() {
    document.getElementById('groupModal').classList.remove('show');
    scheduleItems = [];
    groupInstrumentItems = [];
    selectedGroupParticipantIds = new Set();
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
            option.textContent = formatGroupStudentName(teacher);
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

// Добавить элемент расписания
function addScheduleItem() {
    const item = {
        id: Date.now(),
        dayOfWeek: 1, // Понедельник по умолчанию
        time: '18:00',
        duration: DEFAULT_GROUP_LESSON_DURATION,
        room: null,
        isPractice: false
    };
    
    scheduleItems.push(item);
    renderScheduleList();
    renderGroupFormSafety();
}

// Удалить элемент расписания
function removeScheduleItem(id) {
    scheduleItems = scheduleItems.filter(item => item.id !== id);
    renderScheduleList();
    renderGroupFormSafety();
}

// Обновить элемент расписания
function updateScheduleItem(id, field, value) {
    const item = scheduleItems.find(item => item.id === id);
    if (item) {
        if (field === 'dayOfWeek' || field === 'duration') {
            item[field] = parseInt(value);
        } else {
            item[field] = value;
        }
        renderGroupFormSafety();
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
            border-left: 3px solid #eb4d77;
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
                
                <input type="number" class="admin-input" style="margin: 0;" placeholder="Длительность (мин)" 
                       value="${item.duration || DEFAULT_GROUP_LESSON_DURATION}" min="1"
                       onchange="updateScheduleItem(${item.id}, 'duration', this.value)">
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
            loadRoomsForGroups()      // Загружаем залы параллельно
        ]);
        
        const group = groupData.group;
        
        if (!group) {
            toast.warning( 'Группа не найдена');
            document.getElementById('groupModal').classList.remove('show');
            return;
        }
        
        // Заполняем форму
        document.getElementById('groupName').value = group.name;
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
        groupInstrumentItems = (group.instruments || []).map(item => ({
            id: Date.now() + Math.random(),
            name: item.name,
            quantity: item.quantity || 1,
        }));
        renderGroupInstruments();
        await loadGroupParticipants((group.students || []).map(item => item.student?.id || item.studentId || item.id || item._id).filter(Boolean));
        renderGroupFormSafety();
        
        // Обновляем заголовок
        document.getElementById('groupModalTitle').textContent = 'РЕДАКТИРОВАТЬ ГРУППУ';
    } catch (error) {
        toast.error('Ошибка при загрузке данных группы');
    }
}

// Удалить группу
async function deleteGroup(id, name) {
    let details = 'Удаление возможно только если в группе нет учеников.';
    try {
        const response = await fetch(`${API_URL}/groups/${id}`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        const data = await response.json();
        const group = data.group;
        if (group) {
            const studentCount = getGroupStudentCount(group);
            const scheduleCount = getGroupScheduleItems(group).length;
            details = `Сейчас в группе: ${studentCount} ${getDeclension(studentCount, 'ученик', 'ученика', 'учеников')}, ${scheduleCount} ${getDeclension(scheduleCount, 'слот расписания', 'слота расписания', 'слотов расписания')}.\n\nСначала убедитесь, что ученики переведены, а регулярные занятия больше не нужны.`;
        }
    } catch (error) {
        details = 'Не удалось быстро проверить состав группы. Удаление всё равно может быть отклонено сервером.';
    }

    if (!await customConfirm(`Удалить группу "${name}"?\n\n${details}`, { icon: 'warning', yesText: 'Удалить', noText: 'Отмена' })) { 
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
                <div class="student-row-link" onclick="viewStudent('${escapeGroupJsArg(student._id)}')" title="Открыть профиль">
                    <div class="student-row-link__info">
                        <div style="font-weight: 600; margin-bottom: 5px;">${renderGroupStudentNameWithAge(student)}</div>
                        <div style="font-size: 0.9rem; opacity: 0.7;">${escapeGroupHtml(student.phone || '')}</div>
                    </div>
                    <svg class="student-row-link__chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </div>
                <button class="room-action-btn danger" onclick="removeStudentFromGroup('${escapeGroupJsArg(groupId)}', '${escapeGroupJsArg(student._id)}', '${escapeGroupJsArg(formatGroupStudentName(student))}')">
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
            <option value="${student._id}">${escapeGroupHtml(formatGroupStudentOption(student))} - ${escapeGroupHtml(student.phone || '')}</option>
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
    document.getElementById('groupParticipantSearch')?.addEventListener('input', (event) => renderGroupParticipants(event.target.value));
    ['groupName', 'groupTeacher', 'groupIsActive', 'groupColor'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener(id === 'groupName' ? 'input' : 'change', renderGroupFormSafety);
    });
    
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
            const teacherId = document.getElementById('groupTeacher').value;
            const isActive = document.getElementById('groupIsActive').checked;
            const color = document.getElementById('groupColor').value;
            
            if (!name || !teacherId) {
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
                    isPractice: false
                };
            });
            
            try {
                const token = getAuthToken();
                const url = groupId ? `${API_URL}/groups/${groupId}` : `${API_URL}/groups`;
                const method = groupId ? 'PUT' : 'POST';
                
                const body = { 
                    name, 
                    instructor,  // Имя преподавателя для отображения
                    schedule, 
                    isActive,
                    color,
                    instruments: groupInstrumentItems.map(item => ({ name: item.name, quantity: item.quantity })),
                    studentIds: [...selectedGroupParticipantIds],
                };
                
                // Добавляем teacherId если выбран
                if (teacherId) {
                    body.teacherId = teacherId;
                }
                
                let response = await fetch(url, {
                    method: method,
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                });
                
                let data = await response.json();
                
                if (!data.success && response.status === 409) {
                    const conflictText = data.conflicts?.map((item) => item.message).join('\n') || '';
                    const confirmed = await customConfirm(
                        `${data.error}\n\n${conflictText}\n\nИгнорировать конфликты и сохранить расписание группы?`,
                        { icon: 'warning', yesText: 'Игнорировать', noText: 'Отмена' }
                    );
                    if (confirmed) {
                        body.ignoreConflicts = true;
                        response = await fetch(url, {
                            method: method,
                            headers: {
                                'Authorization': `Bearer ${token}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(body)
                        });
                        data = await response.json();
                    }
                }
                
                if (data.success) {
                    toast.success(`${groupId ? 'Группа успешно обновлена' : 'Группа успешно создана'}. Регулярные занятия добавлены в календарь.`);
                    closeGroupModal();
                    renderGroups();
                } else {
                    const conflicts = data.conflicts?.map((item) => item.message).join('\n');
                    toast.error(conflicts ? `${data.error}:\n${conflicts}` : `Ошибка: ${data.error || 'Не удалось сохранить группу'}`);
                }
            } catch (error) {
                toast.error('Ошибка подключения к серверу');
            }
        });
    }
}

// Экспорт для admin.js
window.initGroupHandlers = initGroupHandlers;
window.addGroupInstrument = addGroupInstrument;
window.removeGroupInstrument = removeGroupInstrument;
window.updateGroupInstrument = updateGroupInstrument;
window.toggleGroupParticipant = toggleGroupParticipant;
