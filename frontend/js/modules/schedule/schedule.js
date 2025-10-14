// =====================================================
// SCHEDULE MODULE - Календарь и занятия
// =====================================================

let calendar = null;
let allGroups = [];
let allRooms = [];
let currentRoomFilter = 'all';
let currentClassForAttendance = null;
let currentAttendanceData = {};

// Инициализация календаря
function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl || calendar) return;
    
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'ru',
        firstDay: 1,
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
        eventTimeFormat: {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        },
        slotMinTime: '08:00:00',
        slotMaxTime: '24:00:00',
        slotDuration: '00:30:00',
        allDaySlot: false,
        nowIndicator: true,
        
        editable: true,
        droppable: false,
        events: fetchCalendarClasses,
        eventDrop: handleEventDrop,
        eventClick: handleEventClick,
        dateClick: handleDateClick,
        eventDidMount: function(info) {
            info.el.title = `${info.event.title}\n${info.event.extendedProps.groupName || ''}`;
            
            const bgColor = info.event.backgroundColor || '#eb4d77';
            info.el.style.backgroundColor = bgColor;
            info.el.style.borderColor = bgColor;
        },
        eventContent: function(arg) {
            const bgColor = arg.event.backgroundColor || '#eb4d77';
            
            const now = new Date();
            const eventEnd = arg.event.end ? new Date(arg.event.end) : new Date(arg.event.start);
            
            const isPast = eventEnd < now;
            const hasGroup = arg.event.extendedProps.groupId;
            const groupStudentsCount = arg.event.extendedProps.groupStudentsCount || 0;
            const attendees = arg.event.extendedProps.attendees || [];
            
            const attendedCount = attendees.filter(a => a.attended === true).length;
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
        
        let url = `${API_URL}/classes?start=${info.startStr}&end=${info.endStr}`;
        
        if (userRole === 'teacher') {
            url += `&teacherId=${userId}`;
        }
        
        if (currentRoomFilter !== 'all') {
            url += `&roomId=${currentRoomFilter}`;
        }
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (response.status === 401) {
            showNotification(notificationWithIcon('warning', 'Сессия истекла. Пожалуйста, войдите заново.'));
            localStorage.clear();
            window.location.href = 'login.html';
            return;
        }
        
        if (!response.ok) throw new Error('Failed to fetch classes');
        
        const data = await response.json();
        
        const events = data.classes.map(cls => {
            const dateObj = new Date(cls.date);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;
            
            const finalColor = cls.room?.color || cls.backgroundColor || '#eb4d77';
            
            return {
                id: cls._id,
                title: cls.title,
                start: `${dateStr}T${cls.startTime}:00`,
                end: `${dateStr}T${cls.endTime}:00`,
                backgroundColor: finalColor,
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

// Обработка drag & drop
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
        info.revert();
    }
}

// Клик по занятию
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
    await openAttendanceModal(classData);
}

// Клик по дате
function handleDateClick(info) {
    openClassModal(info);
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
        
        if (calendar) {
            calendar.refetchEvents();
        }
    } catch (error) {
        console.error('Delete class error:', error);
        showNotification(notificationWithIcon('error', 'Ошибка при удалении: ' + error.message));
    }
}

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
        
        // Определяем преподавателя для выбора
        let selectedTeacherId = classData.teacherId;
        
        // Если у занятия есть группа, но нет преподавателя, берем преподавателя из группы
        if (classData.groupId && !selectedTeacherId) {
            try {
                const groupResponse = await fetch(`${API_URL}/groups/${classData.groupId}`, {
                    headers: { 'Authorization': `Bearer ${getAuthToken()}` }
                });
                const groupData = await groupResponse.json();
                if (groupData.success && groupData.group && groupData.group.teacher) {
                    selectedTeacherId = groupData.group.teacher;
                    console.log('👨‍🏫 Преподаватель взят из группы:', selectedTeacherId);
                }
            } catch (error) {
                console.error('Ошибка загрузки группы:', error);
            }
        }
        
        await loadTeachersForAttendance(selectedTeacherId);
        
        if (!classData.groupId) {
            document.getElementById('attendanceList').innerHTML = `
                <p style="text-align: center; opacity: 0.5; padding: 20px;">
                    Посещаемость доступна только для занятий с группами
                </p>
            `;
            document.getElementById('attendanceModal').classList.add('show');
            return;
        }
        
        const response = await fetch(`${API_URL}/groups/${classData.groupId}/students`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        const data = await response.json();
        const students = data.students || [];
        
        const freezesResponse = await fetch(`${API_URL}/freezes?status=active`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        const freezesData = await freezesResponse.json();
        const activeFreezes = freezesData.freezes || [];
        
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
        
        currentAttendanceData = {};
        
        const attendanceList = document.getElementById('attendanceList');
        attendanceList.innerHTML = students.map(student => {
            const attendee = classData.attendees.find(a => a.student._id === student._id || a.student === student._id);
            const isPresent = attendee ? attendee.attended : false;
            
            const isFrozen = isStudentFrozen(student._id, classData.date);
            
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
        
        const newTeacherId = document.getElementById('attendanceTeacher').value;
        
        // Проверяем что преподаватель выбран
        if (!newTeacherId) {
            showNotification(notificationWithIcon('warning', 'Выберите преподавателя'));
            return;
        }
        
        if (newTeacherId !== currentClassForAttendance.teacherId) {
            await fetch(`${API_URL}/classes/${classId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getAuthToken()}`
                },
                body: JSON.stringify({ teacherId: newTeacherId })
            });
        }
        
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
        
        if (calendar) {
            calendar.refetchEvents();
        }
        
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

// Открыть модалку создания занятия
async function openClassModal(dateInfo = null) {
    const modal = document.getElementById('classModal');
    const title = document.getElementById('classModalTitle');
    const form = document.getElementById('classForm');
    const userRole = localStorage.getItem('userRole');
    
    form.reset();
    document.getElementById('classId').value = '';
    title.textContent = 'СОЗДАТЬ ЗАНЯТИЕ';
    
    if (dateInfo) {
        if (typeof dateInfo === 'object' && dateInfo.date) {
            const clickedDate = dateInfo.date;
            
            const dateStr = clickedDate.toISOString().split('T')[0];
            document.getElementById('classDate').value = dateStr;
            
            const hours = clickedDate.getHours();
            const minutes = clickedDate.getMinutes();
            
            const startTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
            document.getElementById('classStartTime').value = startTime;
            
            const endHours = hours + 1;
            const endTime = `${String(endHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
            document.getElementById('classEndTime').value = endTime;
        } else if (typeof dateInfo === 'string') {
            document.getElementById('classDate').value = dateInfo;
            document.getElementById('classStartTime').value = '18:00';
            document.getElementById('classEndTime').value = '19:00';
        }
    } else {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('classDate').value = today;
        document.getElementById('classStartTime').value = '18:00';
        document.getElementById('classEndTime').value = '19:00';
    }
    
    await loadGroupsForClass();
    await loadRoomsForClass();
    
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

// Загрузить группы для формы
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
        
        const specialOptions = `
            <optgroup label="Специальные">
                <option value="special_rent">Аренда зала</option>
                <option value="special_individual">Индивидуальное занятие</option>
            </optgroup>
        `;
        
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

// Загрузить преподавателей для формы
async function loadTeachersForClass() {
    try {
        const response = await fetch(`${API_URL}/students`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (!response.ok) throw new Error('Failed to fetch teachers');
        
        const data = await response.json();
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

// Загрузить залы
async function loadRooms() {
    try {
        const response = await fetch(`${API_URL}/rooms`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        const data = await response.json();
        allRooms = data.rooms || [];
        
        renderRoomFilters();
    } catch (error) {
        console.error('Load rooms error:', error);
    }
}

// Загрузить залы для формы
async function loadRoomsForClass() {
    try {
        const response = await fetch(`${API_URL}/rooms`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        const data = await response.json();
        const rooms = data.rooms || [];
        
        const select = document.getElementById('classRoom');
        select.innerHTML = '<option value="">Не указан</option>' + 
            rooms.map(room => 
                `<option value="${room._id}">${room.name}</option>`
            ).join('');
    } catch (error) {
        console.error('Load rooms error:', error);
    }
}

// Отобразить фильтры залов
function renderRoomFilters() {
    const container = document.getElementById('roomFilters');
    if (!container) return;
    
    container.innerHTML = `
        <button class="filter-btn active" onclick="filterByRoom('all')">Все залы</button>
        ${allRooms.map(room => 
            `<button class="filter-btn" onclick="filterByRoom('${room._id}')" style="border-color: ${room.color};">
                ${room.name}
            </button>`
        ).join('')}
    `;
}

// Фильтр по залу
function filterByRoom(roomId) {
    currentRoomFilter = roomId;
    
    document.querySelectorAll('#roomFilters .filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    if (calendar) {
        calendar.refetchEvents();
    }
}

// Инициализация доступа к расписанию
function initScheduleAccess() {
    const userRole = localStorage.getItem('userRole');
    const scheduleTab = document.querySelector('[data-section="schedule"]');
    
    if (scheduleTab) {
        if (['teacher', 'admin', 'super_admin'].includes(userRole)) {
            scheduleTab.style.display = 'flex';
        } else {
            scheduleTab.style.display = 'none';
        }
    }
}

// Инициализация обработчиков для schedule
function initScheduleHandlers() {
    // Toggle recurring fields
    const isRecurringCheckbox = document.getElementById('classIsRecurring');
    if (isRecurringCheckbox) {
        isRecurringCheckbox.addEventListener('change', function(e) {
            const recurringFields = document.getElementById('recurringFields');
            recurringFields.style.display = e.target.checked ? 'block' : 'none';
            
            if (e.target.checked) {
                const endDate = new Date();
                endDate.setMonth(endDate.getMonth() + 3);
                document.getElementById('classRecurringEndDate').value = endDate.toISOString().split('T')[0];
            }
        });
    }
    
    // Обработчик формы создания занятия
    const classForm = document.getElementById('classForm');
    if (classForm) {
        classForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            console.log('📝 Обработка формы создания занятия...');
            
            const groupId = document.getElementById('classGroup').value;
            const roomId = document.getElementById('classRoom').value;
            const date = document.getElementById('classDate').value;
            const startTime = document.getElementById('classStartTime').value;
            const endTime = document.getElementById('classEndTime').value;
            const notes = document.getElementById('classNotes')?.value || '';
            const isRecurring = document.getElementById('classIsRecurring')?.checked || false;
            
            console.log('📝 Данные формы:', { groupId, roomId, date, startTime, endTime, isRecurring });
            
            // Преподаватель (только для админов)
            const teacherSelect = document.getElementById('classTeacher');
            const teacherId = teacherSelect?.value || null;
            
            if (!groupId || !date || !startTime || !endTime) {
                showNotification(notificationWithIcon('warning', 'Заполните все обязательные поля'));
                return;
            }
            
            try {
                const token = getAuthToken();
                
                // Формируем тело запроса
                const body = {
                    groupId,
                    roomId: roomId && roomId !== '' ? roomId : null,
                    date,
                    startTime,
                    endTime,
                    notes,
                    isRecurring
                };
                
                // Добавляем teacherId если указан (для админов)
                if (teacherId && teacherId !== '') {
                    body.teacherId = teacherId;
                }
                
                // Если повторяющееся - добавляем правило
                if (isRecurring) {
                    const endDate = document.getElementById('classRecurringEndDate')?.value;
                    const daysCheckboxes = document.querySelectorAll('input[name="daysOfWeek"]:checked');
                    const daysOfWeek = Array.from(daysCheckboxes).map(cb => parseInt(cb.value));
                    
                    body.recurringRule = {
                        frequency: 'weekly',
                        daysOfWeek,
                        endDate
                    };
                }
                
                console.log('📤 Отправка запроса на создание занятия...', body);
                
                const response = await fetch(`${API_URL}/classes`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                });
                
                console.log('📥 Ответ от сервера:', response.status);
                
                const data = await response.json();
                console.log('📥 Данные ответа:', data);
                
                if (data.success) {
                    const message = isRecurring 
                        ? `Создано ${data.classes?.length || 1} занятий` 
                        : 'Занятие успешно создано';
                    
                    console.log('✅ Занятие создано успешно');
                    showNotification(notificationWithIcon('success', message));
                    closeClassModal();
                    
                    // Обновляем календарь
                    if (calendar) {
                        console.log('🔄 Обновление календаря...');
                        calendar.refetchEvents();
                    }
                    
                    // Обновляем badge посещаемости
                    updatePendingAttendanceBadge();
                } else {
                    console.error('❌ Ошибка создания:', data.error);
                    showNotification(notificationWithIcon('error', `Ошибка: ${data.error || 'Не удалось создать занятие'}`));
                }
            } catch (error) {
                console.error('Create class error:', error);
                showNotification(notificationWithIcon('error', 'Ошибка при создании занятия'));
            }
        });
    }
}

console.log('✅ Schedule модуль загружен');

