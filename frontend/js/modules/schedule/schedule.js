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
            week:'Неделя',
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
            const isPractice = info.event.extendedProps.isPractice;
            info.el.title = `${info.event.title}\n${info.event.extendedProps.groupName || ''}${isPractice ? '\n(Открытая практика)' : ''}`;
            
            const bgColor = info.event.backgroundColor || '#eb4d77';
            info.el.style.backgroundColor = bgColor;
            info.el.style.borderColor = bgColor;
            
            // Добавляем визуальную индикацию для практик
            if (isPractice) {
                info.el.style.borderLeft = '4px solid #4d9beb';
                info.el.style.opacity = '0.85';
            }
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
            
            const teacherName = arg.event.extendedProps.teacherName || '';
            const teacherLine = teacherName && teacherName !== 'Не назначен' 
                ? `<small style="display: block; margin-top: 2px; opacity: 0.9;">${teacherName}</small>` 
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
                         ${teacherLine}
                       </div>`
            };
        }
    });
    
    calendar.render();
}

// Загрузка занятий из API
async function fetchCalendarClasses(info, successCallback, failureCallback) {
    try {
        const userRole = localStorage.getItem('userRole');
        const userId = localStorage.getItem('userId');
        
        let url = `${API_URL}/classes?start=${info.startStr}&end=${info.endStr}`;
        
        // Преподаватель видит ВСЕ занятия (не фильтруем по teacherId)
        // if (userRole === 'teacher') {
        //     url += `&teacherId=${userId}`;
        // }
        
        if (currentRoomFilter !== 'all') {
            url += `&roomId=${currentRoomFilter}`;
        }
        
        console.log(`📅 Запрос занятий (роль: ${userRole}): ${url}`);
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (response.status === 401) {
            console.error('❌ 401: Сессия истекла');
            toast.warning( 'Сессия истекла. Пожалуйста, войдите заново.');
            localStorage.clear();
            window.location.href = '/login';
            return;
        }
        
        if (!response.ok) {
            console.error(`❌ Ошибка загрузки занятий: ${response.status} ${response.statusText}`);
            throw new Error('Failed to fetch classes');
        }
        
        const data = await response.json();
        console.log(`✅ Загружено занятий: ${data.classes?.length || 0}`);
        
        // Детальное логирование практик
        const practices = data.classes.filter(cls => cls.isPractice);
        if (practices.length > 0) {
            console.log(`🔓 Найдено практик: ${practices.length}`);
            practices.forEach(p => {
                console.log(`  - ID: ${p._id} (${typeof p._id}), title: ${p.title}, groups:`, p.practiceGroups);
            });
        }
        
        const events = data.classes.map(cls => {
            const dateObj = new Date(cls.date);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;
            
            const finalColor = cls.room?.color || cls.backgroundColor || '#eb4d77';
            
            // Для практик показываем все группы
            let displayTitle = cls.title;
            if (cls.isPractice && cls.practiceGroups && cls.practiceGroups.length > 0) {
                const groupNames = cls.practiceGroups.map(g => g.name || g).join(', ');
                displayTitle = `Практика: ${groupNames}`;
            } else if (cls.isPractice) {
                displayTitle = `Практика ${cls.title}`;
            }
            
            // Валидация ID и логирование для практик
            if (cls.isPractice) {
                console.log(`🔓 Практика загружена: ID = ${cls._id}, title = ${displayTitle}`);
                if (!cls._id || cls._id === 'null') {
                    console.error('❌ НЕКОРРЕКТНЫЙ ID ПРАКТИКИ:', cls._id);
                }
            }
            
            return {
                id: cls._id,
                title: displayTitle,
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
                    attendees: cls.attendees,
                    isPractice: cls.isPractice || false,
                    practiceGroups: cls.practiceGroups || []
                }
            };
        });
        
        successCallback(events);
    } catch (error) {
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
            toast.warning( 'Сессия истекла. Пожалуйста, войдите заново.');
            localStorage.clear();
            window.location.href = '/login';
            return;
        }
        
        if (!response.ok) throw new Error('Failed to update class');
        
    } catch (error) {
        toast.error('Ошибка при переносе занятия');
        info.revert();
    }
}

// Клик по занятию
async function handleEventClick(info) {
    console.log('🖱️ Клик по занятию:', info.event.id, info.event.title);
    console.log('🔍 info.event:', info.event);
    console.log('🔍 info.event._def:', info.event._def);
    console.log('🔍 info.event.id тип:', typeof info.event.id);
    
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
        roomName: info.event.extendedProps.roomName,
        roomId: info.event.extendedProps.roomId,
        isPractice: info.event.extendedProps.isPractice,
        practiceGroups: info.event.extendedProps.practiceGroups || []
    };
    
    console.log('📋 classData полностью:', classData);
    console.log('📋 classData.id:', classData.id, 'тип:', typeof classData.id);
    
    currentClassForAttendance = classData;
    
    // Если это практика - открываем practiceModal, иначе attendanceModal
    if (classData.isPractice) {
        console.log('🔓 Открытие модалки практики');
        await openPracticeModal(classData);
    } else {
        console.log('📝 Открытие модалки посещаемости');
        await openAttendanceModal(classData);
    }
}

// Клик по дате
function handleDateClick(info) {
    openClassModal(info);
}

// Удалить занятие
async function deleteClass(classId) {
    if (!classId) {
        console.error('❌ deleteClass: classId отсутствует');
        toast.error('Ошибка: ID занятия не найден');
        return;
    }
    
    console.log(`🗑️ Удаление занятия ID: ${classId}`);
    
    // ⚡ ОПТИМИСТИЧНОЕ ОБНОВЛЕНИЕ: сначала убираем событие из календаря
    let removedEvent = null;
    if (calendar) {
        const event = calendar.getEventById(classId);
        if (event) {
            console.log('⚡ Удаляем событие из календаря визуально...');
            removedEvent = {
                id: event.id,
                title: event.title,
                start: event.start,
                end: event.end,
                extendedProps: event.extendedProps,
                backgroundColor: event.backgroundColor
            };
            event.remove(); // Удаляем визуально СРАЗУ
            
            // Форсируем перерисовку календаря
            calendar.render();
            
            console.log('✅ Событие удалено из UI');
        }
    }
    
    try {
        const url = `${API_URL}/classes/${classId}`;
        console.log(`📡 DELETE запрос на сервер: ${url}`);
        
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        console.log(`📥 Ответ сервера: ${response.status} ${response.statusText}`);
        
        if (response.status === 401) {
            toast.warning('Сессия истекла. Пожалуйста, войдите заново.');
            localStorage.clear();
            window.location.href = '/login';
            return;
        }
        
        if (response.status === 404) {
            console.error('❌ Занятие не найдено на сервере (404)');
            toast.error('Занятие не найдено');
            // Обновляем календарь для синхронизации
            if (calendar) calendar.refetchEvents();
            return;
        }
        
        if (!response.ok) {
            const error = await response.json();
            console.error('❌ Ошибка удаления:', error);
            // Если ошибка - возвращаем событие обратно или перезагружаем
            if (calendar && removedEvent) {
                console.log('🔄 Возвращаем событие в календарь из-за ошибки...');
                calendar.refetchEvents();
            }
            throw new Error(error.error || 'Failed to delete class');
        }
        
        const data = await response.json();
        console.log('✅ Занятие успешно удалено на сервере:', data);
        
        toast.success('Занятие удалено');
        
        return true;
    } catch (error) {
        console.error('❌ deleteClass error:', error);
        toast.error('Ошибка при удалении: ' + error.message);
        // При ошибке обновляем календарь для синхронизации
        if (calendar) {
            calendar.refetchEvents();
        }
        return false;
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
    }
}

// Открыть модалку посещаемости
async function openAttendanceModal(classData) {
    try {
        const dateStr = classData.date.toLocaleDateString('ru-RU');
        
        // ⭐ ПРОВЕРКА: Если это практика - показываем список групп
        if (classData.isPractice) {
            document.getElementById('attendanceModalTitle').textContent = 'ПРАКТИКА - ГРУППЫ';
            
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
            
            // Показываем список групп вместо посещаемости
            const practiceGroups = classData.practiceGroups || [];
            if (practiceGroups.length > 0) {
                document.getElementById('attendanceList').innerHTML = `
                    <div style="padding: 20px; background: rgba(77, 155, 235, 0.1); border-left: 3px solid #4d9beb; border-radius: 8px;">
                        <h4 style="margin: 0 0 15px 0; color: #4d9beb;">Группы участвующие в практике:</h4>
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            ${practiceGroups.map(g => `
                                <div style="padding: 10px; background: rgba(255,255,255,0.05); border-radius: 6px;">
                                    ${g.name || g}
                                </div>
                            `).join('')}
                        </div>
                        <p style="margin: 20px 0 0 0; opacity: 0.7; font-size: 0.9rem;">
                            ℹ️ Для практик посещаемость не отмечается. Все ученики указанных групп могут посещать эту практику.
                        </p>
                    </div>
                `;
            } else {
                document.getElementById('attendanceList').innerHTML = `
                    <p style="text-align: center; opacity: 0.5; padding: 20px;">
                        Группы не добавлены к этой практике
                    </p>
                `;
            }
            
            // Скрываем кнопки сохранения для практик
            const saveBtn = document.querySelector('#attendanceModal button[type="submit"]');
            if (saveBtn) saveBtn.style.display = 'none';
            
            const deleteBtn = document.querySelector('#attendanceModal .table-btn.danger');
            if (deleteBtn) deleteBtn.style.display = 'inline-block';
            
            document.getElementById('attendanceModal').classList.add('show');
            return;
        }
        
        // ⚡ ОБЫЧНЫЕ ЗАНЯТИЯ - показываем посещаемость
        document.getElementById('attendanceModalTitle').textContent = 'ПОСЕЩАЕМОСТЬ';
        
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
        
        // Показываем загрузку
        document.getElementById('attendanceList').innerHTML = `
            <p style="text-align: center; opacity: 0.5; padding: 40px;">
                Загрузка студентов...
            </p>
        `;
        
        // ОТКРЫВАЕМ МОДАЛКУ СРАЗУ!
        document.getElementById('attendanceModal').classList.add('show');
        
        // Показываем кнопки для обычных занятий
        const saveBtn = document.querySelector('#attendanceModal button[type="submit"]');
        if (saveBtn) saveBtn.style.display = 'block';
        
        // Проверка наличия группы
        if (!classData.groupId) {
            document.getElementById('attendanceList').innerHTML = `
                <p style="text-align: center; opacity: 0.5; padding: 20px;">
                    Посещаемость доступна только для занятий с группами
                </p>
            `;
            return;
        }
        
        // ⚡ ПАРАЛЛЕЛЬНО загружаем все данные В ФОНЕ
        let selectedTeacherId = classData.teacherId;
        
        console.log(`📋 Загрузка данных для посещаемости (группа: ${classData.groupId})`);
        
        const [groupData, studentsData, freezesData] = await Promise.all([
            // Загружаем группу (для преподавателя)
            classData.groupId && !selectedTeacherId 
                ? fetch(`${API_URL}/groups/${classData.groupId}`, {
                    headers: { 'Authorization': `Bearer ${getAuthToken()}` }
                  }).then(r => {
                      console.log(`✅ Группа загружена:`, r.status);
                      return r.json();
                  }).catch(err => {
                      console.error('❌ Ошибка загрузки группы:', err);
                      return null;
                  })
                : null,
            // Загружаем студентов группы
            fetch(`${API_URL}/groups/${classData.groupId}/students`, {
                headers: { 'Authorization': `Bearer ${getAuthToken()}` }
            }).then(r => {
                console.log(`✅ Студенты группы:`, r.status);
                if (!r.ok) {
                    console.error(`❌ Ошибка ${r.status}: ${r.statusText}`);
                    throw new Error(`HTTP ${r.status}`);
                }
                return r.json();
            }).catch(err => {
                console.error('❌ Ошибка загрузки студентов:', err);
                throw err;
            }),
            // Загружаем активные заморозки
            fetch(`${API_URL}/freezes?status=active`, {
                headers: { 'Authorization': `Bearer ${getAuthToken()}` }
            }).then(r => {
                console.log(`✅ Заморозки:`, r.status);
                return r.json();
            }).catch(err => {
                console.error('❌ Ошибка загрузки заморозок:', err);
                return { freezes: [] };
            })
        ]);
        
        // Определяем преподавателя
        if (groupData?.success && groupData.group?.teacher) {
            selectedTeacherId = groupData.group.teacher;
        }
        
        // Загружаем преподавателей
        await loadTeachersForAttendance(selectedTeacherId);
        
        const students = studentsData.students || [];
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
                    background: var(--admin-card);
                    color: var(--admin-text);
                    border-radius: 8px;
                    border-left: 3px solid ${isFrozen ? '#60a5fa' : isPresent ? '#28a745' : '#6c757d'};
                    ${isFrozen ? 'opacity: 0.7;' : ''}
                " id="attendance-item-${student._id}">
                    <div style="flex: 1;">
                        <div style="font-weight: 600; margin-bottom: 5px; color: var(--admin-text);">
                            ${student.name}
                            ${isFrozen ? '<span style="color: #60a5fa; margin-left: 8px; font-size: 0.85em;">❄️ ЗАМОРОЗКА</span>' : ''}
                        </div>
                        <div style="font-size: 0.9rem; opacity: 0.7; color: var(--admin-text);">${student.phone}</div>
                    </div>
                    <label style="display: flex; align-items: center; gap: 10px; cursor: ${isFrozen ? 'not-allowed' : 'pointer'};">
                        <span style="font-size: 0.9rem; opacity: 0.8; color: var(--admin-text);">Присутствовал</span>
                        <input type="checkbox" 
                               ${isPresent ? 'checked' : ''}
                               ${isFrozen ? 'disabled' : ''}
                               onchange="toggleAttendance('${student._id}')"
                               style="width: 20px; height: 20px; cursor: ${isFrozen ? 'not-allowed' : 'pointer'};">
                    </label>
                </div>
            `;
        }).join('');
        
    } catch (error) {
        document.getElementById('attendanceList').innerHTML = `
            <p style="text-align: center; opacity: 0.5; padding: 20px; color: #dc3545;">
                Ошибка при загрузке данных
            </p>
        `;
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
            toast.warning('Выберите преподавателя');
            return;
        }
        
        // ⚡ OPTIMISTIC UI: Закрываем модалку СРАЗУ!
        closeAttendanceModal();
        toast.success('Сохранение...');
        
        // 🔥 СОХРАНЯЕМ В ФОНЕ (не блокируем UI)
        (async () => {
            try {
                console.log('💾 Начало сохранения посещаемости...');
                
                // Обновляем преподавателя если изменился
                if (newTeacherId !== currentClassForAttendance.teacherId) {
                    console.log('👨‍🏫 Обновление преподавателя...');
                    await fetch(`${API_URL}/classes/${classId}`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${getAuthToken()}`
                        },
                        body: JSON.stringify({ teacherId: newTeacherId })
                    });
                }
                
                // Сохраняем посещаемость
                console.log(`📝 Сохранение посещаемости для ${Object.keys(currentAttendanceData).length} студентов...`);
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
                
                console.log('✅ Посещаемость сохранена');
                
                // Обновляем календарь В ФОНЕ
                if (calendar) {
                    calendar.refetchEvents();
                }
                
                updatePendingAttendanceBadge();
                
            } catch (error) {
                console.error('❌ Ошибка при сохранении посещаемости:', error);
                toast.error('Ошибка при сохранении посещаемости');
            }
        })();
        
    } catch (error) {
        console.error('❌ Ошибка saveAttendance:', error);
        toast.error('Ошибка при сохранении посещаемости');
    }
}

// Удалить занятие из модалки посещаемости
async function deleteClassFromAttendance() {
    const classData = currentClassForAttendance;
    
    if (!classData || !classData.id) {
        toast.error('Ошибка: занятие не найдено');
        return;
    }
    
    const dateStr = classData.date.toLocaleDateString('ru-RU');
    
    if (await customConfirm(`Удалить занятие?\n\n${classData.title}\n${dateStr} ${classData.startTime}-${classData.endTime}`)) {
        // Закрываем модалку
        closeAttendanceModal();
        
        // Даем календарю время перерисоваться после закрытия модалки
        setTimeout(async () => {
            await deleteClass(classData.id);
        }, 50);
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
    
    // СНАЧАЛА открываем модалку (моментально!)
    modal.classList.add('show');
    
    // ПОТОМ загружаем данные в фоне (параллельно)
    const teacherGroup = document.getElementById('classTeacherGroup');
    const loadPromises = [
        loadGroupsForClass(),
        loadRoomsForClass()
    ];
    
    if (teacherGroup && (userRole === 'admin' || userRole === 'super_admin')) {
        teacherGroup.style.display = 'block';
        loadPromises.push(loadTeachersForClass());
    } else if (teacherGroup) {
        teacherGroup.style.display = 'none';
    }
    
    // Загружаем все параллельно
    await Promise.all(loadPromises);
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
              allGroups.map(group => {
                  // Используем форматирование с расписанием
                  const formatted = window.formatGroupWithSchedule ? 
                      window.formatGroupWithSchedule(group) : 
                      `${group.name} - ${group.direction}`;
                  return `<option value="${group._id}">${formatted}</option>`;
              }).join('') + 
              '</optgroup>'
            : '';
        
        select.innerHTML = '<option value="">Выберите группу</option>' + 
                          specialOptions + 
                          regularOptions;
    } catch (error) {
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
            
            
            const groupId = document.getElementById('classGroup').value;
            const roomId = document.getElementById('classRoom').value;
            const date = document.getElementById('classDate').value;
            const startTime = document.getElementById('classStartTime').value;
            const endTime = document.getElementById('classEndTime').value;
            const notes = document.getElementById('classNotes')?.value || '';
            const isRecurring = document.getElementById('classIsRecurring')?.checked || false;
            
            
            // Преподаватель (только для админов)
            const teacherSelect = document.getElementById('classTeacher');
            const teacherId = teacherSelect?.value || null;
            
            if (!groupId || !date || !startTime || !endTime) {
                toast.warning( 'Заполните все обязательные поля');
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
                
            
            // МОМЕНТАЛЬНО закрываем модалку
            closeClassModal();
            
            // 🚀 ОПТИМИСТИЧНЫЙ UI: Добавляем временное событие СРАЗУ (не ждем сервер)
            let tempEventId = null;
            if (calendar && !isRecurring) {
                // Получаем название группы из select
                const groupSelect = document.getElementById('classGroup');
                const groupName = groupSelect.options[groupSelect.selectedIndex]?.text || 'Новое занятие';
                
                // Получаем цвет зала из allRooms (если зал выбран)
                let roomColor = '#eb4d77';  // Дефолтный цвет
                if (roomId && allRooms && allRooms.length > 0) {
                    const selectedRoom = allRooms.find(room => room._id === roomId);
                    if (selectedRoom && selectedRoom.color) {
                        roomColor = selectedRoom.color;
                    }
                }
                
                // Временный ID
                tempEventId = 'temp-' + Date.now();
                
                // Добавляем временное событие с правильным цветом зала
                calendar.addEvent({
                    id: tempEventId,
                    title: groupName,
                    start: `${date}T${startTime}`,
                    end: `${date}T${endTime}`,
                    backgroundColor: roomColor,  // Используем цвет зала!
                    extendedProps: {
                        groupId: groupId,
                        roomId: roomId,
                        notes: notes,
                        isTemp: true  // Пометка что временное
                    }
                });
            }
            
            const response = await fetch(`${API_URL}/classes`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            
            
            const data = await response.json();
            
            if (data.success) {
                const message = isRecurring 
                    ? `Создано ${data.classes?.length || 1} занятий` 
                    : 'Занятие успешно создано';
                
                toast.success(message);
                
                // Удаляем временное событие и добавляем реальное с правильными данными
                if (calendar) {
                    // Удаляем временное
                    if (tempEventId) {
                        const tempEvent = calendar.getEventById(tempEventId);
                        if (tempEvent) {
                            tempEvent.remove();
                        }
                    }
                    
                    if (isRecurring && data.classes) {
                        // Для повторяющихся - добавляем все реальные
                        data.classes.forEach(cls => {
                            calendar.addEvent({
                                id: cls._id,
                                title: cls.title,
                                start: `${cls.date.split('T')[0]}T${cls.startTime}`,
                                end: `${cls.date.split('T')[0]}T${cls.endTime}`,
                                backgroundColor: cls.backgroundColor || '#eb4d77',
                                extendedProps: {
                                    groupId: cls.group,
                                    roomId: cls.room,
                                    teacherId: cls.teacher,
                                    notes: cls.notes,
                                    attendance: cls.attendance
                                }
                            });
                        });
                    } else if (data.class) {
                        // Для одиночного - добавляем реальное
                        const cls = data.class;
                        calendar.addEvent({
                            id: cls._id,
                            title: cls.title,
                            start: `${cls.date.split('T')[0]}T${cls.startTime}`,
                            end: `${cls.date.split('T')[0]}T${cls.endTime}`,
                            backgroundColor: cls.backgroundColor || '#eb4d77',
                            extendedProps: {
                                groupId: cls.group,
                                roomId: cls.room,
                                teacherId: cls.teacher,
                                notes: cls.notes,
                                attendance: cls.attendance
                            }
                        });
                    }
                }
                
                // Обновляем badge В ФОНЕ
                setTimeout(() => updatePendingAttendanceBadge(), 0);
            } else {
                
                // Удаляем временное событие если была ошибка
                if (tempEventId && calendar) {
                    const tempEvent = calendar.getEventById(tempEventId);
                    if (tempEvent) {
                        tempEvent.remove();
                    }
                }
                
                toast.error(`Ошибка: ${data.error || 'Не удалось создать занятие'}`);
            }
        } catch (error) {
                
                // Удаляем временное событие при ошибке сети
                if (tempEventId && calendar) {
                    const tempEvent = calendar.getEventById(tempEventId);
                    if (tempEvent) {
                        tempEvent.remove();
                    }
                }
                
                toast.error('Ошибка при создании занятия');
            }
        });
    }
}

// =====================================================
// ГЕНЕРАЦИЯ РАСПИСАНИЯ ИЗ ГРУПП
// =====================================================

// Открыть модалку генерации расписания
window.openGenerateScheduleModal = async function() {
    const modal = document.getElementById('generateScheduleModal');
    if (modal) {
        // Загружаем залы перед открытием
        await loadRoomsForGeneration();
        modal.classList.add('show');
        console.log('✅ Модалка генерации расписания открыта');
    } else {
        console.error('❌ Модалка generateScheduleModal не найдена');
    }
}

// Загрузить залы для выбора
async function loadRoomsForGeneration() {
    try {
        const response = await fetch(`${API_URL}/rooms`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        if (!response.ok) throw new Error('Failed to fetch rooms');
        
        const data = await response.json();
        const rooms = data.rooms || [];
        
        const select = document.getElementById('generateScheduleRoom');
        if (select) {
            select.innerHTML = '<option value="">Выберите зал</option>' + 
                rooms.map(room => `<option value="${room._id}">${room.name}</option>`).join('');
        }
    } catch (error) {
        console.error('Failed to load rooms:', error);
        toast.error('Не удалось загрузить список залов');
    }
}

// Закрыть модалку генерации расписания
window.closeGenerateScheduleModal = function() {
    const modal = document.getElementById('generateScheduleModal');
    if (modal) {
        modal.classList.remove('show');
        console.log('✅ Модалка генерации расписания закрыта');
    }
}

// Генерация занятий из расписания групп
window.generateSchedule = async function(period) {
    let loadingToast = null;
    
    try {
        // Проверяем выбран ли зал
        const roomSelect = document.getElementById('generateScheduleRoom');
        const roomId = roomSelect?.value;
        
        if (!roomId) {
            toast.error('Пожалуйста, выберите зал');
            return;
        }
        
        // Закрываем модалку
        window.closeGenerateScheduleModal();
        
        // ⏳ Показываем индикатор загрузки с анимацией
        const periodText = period === 'week' ? 'неделю' : 'месяц';
        loadingToast = toast.loading ? 
            toast.loading(`Генерация занятий на ${periodText}...\n\n⏳ Создаем расписание...\n🔍 Проверяем конфликты...\n📅 Это может занять до минуты`) :
            toast.info(`Генерация занятий на ${periodText}...`);
        
        const token = getAuthToken();
        if (!token) {
            toast.dismiss(loadingToast);
            toast.error('Необходима авторизация');
            return;
        }
        
        const startTime = Date.now();
        console.log(`🚀 Начинаем генерацию на ${periodText}...`);
        
        const response = await fetch(`${API_URL}/classes/generate-from-schedule`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ period, roomId })
        });
        
        const data = await response.json();
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`⏱️ Генерация завершена за ${duration}с`);
        
        // ✅ Убираем loading toast
        toast.dismiss(loadingToast);
        
        if (data.success) {
            // Показываем детальную информацию
            let message = data.message;
            const createdCount = data.details?.createdClasses?.length || 0;
            const skippedCount = data.details?.skippedClasses?.length || 0;
            
            if (data.details && data.details.createdClasses && data.details.createdClasses.length > 0) {
                console.log('✅ Созданные занятия:', data.details.createdClasses);
            }
            
            if (data.details && data.details.skippedClasses && data.details.skippedClasses.length > 0) {
                console.log('⚠️ Пропущенные занятия:', data.details.skippedClasses);
            }
            
            // Формируем детальное сообщение
            let detailedMessage = `✅ ${message}\n\n📊 Статистика:\n`;
            detailedMessage += `✓ Создано: ${createdCount} занятий\n`;
            if (skippedCount > 0) {
                detailedMessage += `⚠ Пропущено: ${skippedCount} (конфликты)\n`;
            }
            detailedMessage += `⏱ Время: ${duration}с`;
            
            toast.success(detailedMessage, { duration: 4000 });
            
            // ⚡ ПЕРЕЗАГРУЖАЕМ СТРАНИЦУ для гарантированного отображения
            // refetchEvents() работает ненадежно, перезагрузка - самый надежный способ
            console.log('🔄 Перезагружаем страницу для отображения новых занятий...');
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        } else {
            toast.error(data.error || 'Ошибка при генерации занятий');
        }
    } catch (error) {
        console.error('Generate schedule error:', error);
        // Убираем loading toast если он еще показывается
        if (loadingToast) {
            toast.dismiss(loadingToast);
        }
        toast.error('Ошибка при генерации занятий');
    }
}

// Инициализация кнопки генерации
function initGenerateScheduleButton() {
    const btn = document.getElementById('generateFromScheduleBtn');
    if (btn) {
        // Удаляем старый обработчик если есть
        btn.removeEventListener('click', window.openGenerateScheduleModal);
        // Добавляем новый
        btn.addEventListener('click', window.openGenerateScheduleModal);
        console.log('✅ Кнопка генерации расписания инициализирована');
    } else {
        console.warn('⚠️ Кнопка generateFromScheduleBtn не найдена');
    }
}

// =====================================================
// МОДАЛКА РЕДАКТИРОВАНИЯ ПРАКТИКИ
// =====================================================

let currentPracticeGroups = [];
let currentPracticeId = null;

// Открыть модалку редактирования практики
window.openPracticeModal = async function(classData) {
    try {
        console.log('🔓 Открытие модалки практики, classData:', classData);
        
        const modal = document.getElementById('practiceModal');
        currentPracticeId = classData.id;
        currentPracticeGroups = classData.practiceGroups || [];
        
        console.log('📋 currentPracticeId:', currentPracticeId);
        console.log('📋 currentPracticeGroups:', currentPracticeGroups);
        
        // Валидация ID
        if (!currentPracticeId || currentPracticeId === 'null' || currentPracticeId === 'undefined') {
            console.error('❌ Некорректный ID практики:', currentPracticeId);
            toast.error('Ошибка: некорректный ID практики');
            return;
        }
        
        // Заполняем поля
        document.getElementById('practiceId').value = classData.id;
        document.getElementById('practiceDate').value = classData.date.toISOString().split('T')[0];
        document.getElementById('practiceStartTime').value = classData.startTime;
        document.getElementById('practiceEndTime').value = classData.endTime;
        
        // Отображаем список групп
        renderPracticeGroups();
        
        // ⚡ МОМЕНТАЛЬНО открываем модалку
        modal.classList.add('show');
        
        // ⚡ ПАРАЛЛЕЛЬНО загружаем все данные в фоне
        await Promise.all([
            loadRoomsForPractice(),
            loadTeachersForPractice(),
            loadGroupsForPractice()
        ]);
        
        // Устанавливаем зал и преподавателя после загрузки
        if (classData.roomId) {
            document.getElementById('practiceRoom').value = classData.roomId;
        }
        if (classData.teacherId) {
            document.getElementById('practiceTeacher').value = classData.teacherId;
        }
    } catch (error) {
        console.error('Open practice modal error:', error);
        toast.error('Ошибка открытия модалки практики');
    }
}

// Закрыть модалку практики
window.closePracticeModal = function() {
    const modal = document.getElementById('practiceModal');
    if (modal) {
        modal.classList.remove('show');
    }
    currentPracticeGroups = [];
    currentPracticeId = null;
}

// Загрузить залы для практики
async function loadRoomsForPractice() {
    try {
        const response = await fetch(`${API_URL}/rooms`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        const data = await response.json();
        const rooms = data.rooms || [];
        
        const select = document.getElementById('practiceRoom');
        if (select) {
            select.innerHTML = '<option value="">Не указан</option>' +
                rooms.map(room => `<option value="${room._id}">${room.name}</option>`).join('');
        }
    } catch (error) {
        console.error('Load rooms error:', error);
    }
}

// Загрузить преподавателей для практики
async function loadTeachersForPractice() {
    try {
        const response = await fetch(`${API_URL}/students?role=teacher`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        const data = await response.json();
        const teachers = data.students || [];
        
        const select = document.getElementById('practiceTeacher');
        if (select) {
            select.innerHTML = '<option value="">Выберите преподавателя</option>' +
                teachers.map(t => `<option value="${t._id}">${t.name}</option>`).join('');
        }
    } catch (error) {
        console.error('Load teachers error:', error);
    }
}

// Загрузить группы для добавления
async function loadGroupsForPractice() {
    try {
        const response = await fetch(`${API_URL}/groups`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        const data = await response.json();
        const groups = data.groups || [];
        
        const select = document.getElementById('practiceAddGroup');
        if (select) {
            select.innerHTML = '<option value="">Выберите группу для добавления</option>' +
                groups.map(g => {
                    // Используем форматирование с расписанием
                    const formatted = window.formatGroupWithSchedule ? 
                        window.formatGroupWithSchedule(g) : 
                        `${g.name} - ${g.direction}`;
                    return `<option value="${g._id}">${formatted}</option>`;
                }).join('');
        }
    } catch (error) {
        console.error('Load groups error:', error);
    }
}

// Отобразить список групп практики
function renderPracticeGroups() {
    const container = document.getElementById('practiceGroupsList');
    if (!container) return;
    
    if (currentPracticeGroups.length === 0) {
        container.innerHTML = '<p style="text-align: center; opacity: 0.5; padding: 20px;">Группы не добавлены</p>';
        return;
    }
    
    container.innerHTML = currentPracticeGroups.map((g, index) => `
        <div style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px;
            background: rgba(255,255,255,0.05);
            border-radius: 6px;
            margin-bottom: 8px;
        ">
            <span>${g.name || g}</span>
            <button type="button" class="table-btn danger" onclick="removeGroupFromPractice(${index})" style="padding: 6px 12px;">
                Удалить
            </button>
        </div>
    `).join('');
}

// Добавить группу к практике
window.addGroupToPractice = function() {
    const select = document.getElementById('practiceAddGroup');
    const groupId = select.value;
    
    if (!groupId) {
        toast.warning('Выберите группу');
        return;
    }
    
    const groupName = select.options[select.selectedIndex].text;
    
    // Проверяем что группа еще не добавлена
    const alreadyAdded = currentPracticeGroups.some(g => 
        (g._id && g._id === groupId) || g === groupId
    );
    
    if (alreadyAdded) {
        toast.warning('Эта группа уже добавлена');
        return;
    }
    
    // Добавляем группу
    currentPracticeGroups.push({ _id: groupId, name: groupName });
    renderPracticeGroups();
    select.value = '';
}

// Удалить группу из практики
window.removeGroupFromPractice = function(index) {
    currentPracticeGroups.splice(index, 1);
    renderPracticeGroups();
}

// Удалить практику
window.deletePractice = async function() {
    if (!currentPracticeId) {
        console.error('❌ deletePractice: currentPracticeId отсутствует');
        toast.error('Ошибка: ID практики не найден');
        return;
    }
    
    // ⚡ КРИТИЧЕСКИ ВАЖНО: Сохраняем ID В ЛОКАЛЬНУЮ ПЕРЕМЕННУЮ
    // потому что closePracticeModal() сбросит currentPracticeId в null!
    const practiceIdToDelete = currentPracticeId;
    
    console.log(`🗑️ Удаление практики ID: ${practiceIdToDelete}`);
    
    // Валидация ID (не должен быть "null", "undefined" или пустым)
    if (practiceIdToDelete === 'null' || practiceIdToDelete === 'undefined' || !practiceIdToDelete || practiceIdToDelete.length < 10) {
        console.error('❌ Некорректный ID практики:', practiceIdToDelete);
        toast.error('Ошибка: некорректный ID практики');
        closePracticeModal();
        return;
    }
    
    if (!await customConfirm('Удалить эту практику?\n\nЭто действие нельзя отменить!')) {
        return;
    }
    
    // Закрываем модалку (это сбросит currentPracticeId в null, но у нас есть practiceIdToDelete!)
    closePracticeModal();
    
    // Небольшая задержка для закрытия модалки, затем удаляем из календаря
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // ⚡ ОПТИМИСТИЧНОЕ ОБНОВЛЕНИЕ: убираем событие из календаря
    let removedEvent = null;
    if (calendar) {
        const event = calendar.getEventById(practiceIdToDelete);
        if (event) {
            console.log('⚡ Удаляем практику из календаря визуально...');
            removedEvent = {
                id: event.id,
                title: event.title,
                start: event.start,
                end: event.end,
                extendedProps: event.extendedProps,
                backgroundColor: event.backgroundColor
            };
            event.remove(); // Удаляем визуально СРАЗУ
            
            // Форсируем перерисовку календаря
            calendar.render();
            
            console.log('✅ Практика удалена из UI');
        }
    }
    
    try {
        console.log(`📡 Формирование DELETE запроса:`);
        console.log(`   API_URL: ${API_URL}`);
        console.log(`   practiceIdToDelete: "${practiceIdToDelete}"`);
        console.log(`   Тип: ${typeof practiceIdToDelete}`);
        console.log(`   Длина: ${practiceIdToDelete.length}`);
        
        const url = `${API_URL}/classes/${practiceIdToDelete}`;
        console.log(`   Итоговый URL: ${url}`);
        
        const response = await fetch(url, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        
        console.log(`📥 Ответ сервера: ${response.status} ${response.statusText}`);
        
        if (!response.ok) {
            const error = await response.json();
            console.error('❌ Ошибка удаления практики:', error);
            toast.error(error.error || 'Ошибка удаления');
            // Если ошибка - обновляем календарь для синхронизации
            if (calendar) {
                console.log('🔄 Возвращаем практику в календарь из-за ошибки...');
                calendar.refetchEvents();
            }
            return;
        }
        
        const data = await response.json();
        console.log('✅ Практика успешно удалена на сервере:', data);
        
        if (data.success) {
            toast.success('Практика удалена');
        } else {
            toast.error(data.error || 'Ошибка удаления');
            // Обновляем календарь для синхронизации
            if (calendar) {
                calendar.refetchEvents();
            }
        }
    } catch (error) {
        console.error('❌ Delete practice error:', error);
        toast.error('Ошибка удаления практики');
        // При ошибке обновляем календарь для синхронизации
        if (calendar) {
            calendar.refetchEvents();
        }
    }
}

// Инициализация формы практики
function initPracticeForm() {
    const form = document.getElementById('practiceForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            if (currentPracticeGroups.length === 0) {
                toast.warning('Добавьте хотя бы одну группу');
                return;
            }
            
            const formData = {
                date: document.getElementById('practiceDate').value,
                startTime: document.getElementById('practiceStartTime').value,
                endTime: document.getElementById('practiceEndTime').value,
                roomId: document.getElementById('practiceRoom').value || null,
                teacherId: document.getElementById('practiceTeacher').value || null,
                practiceGroups: currentPracticeGroups.map(g => g._id || g),
                isPractice: true
            };
            
            try {
                const response = await fetch(`${API_URL}/classes/${currentPracticeId}`, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${getAuthToken()}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });
                
                const data = await response.json();
                
                if (data.success) {
                    toast.success('Практика обновлена');
                    closePracticeModal();
                    if (calendar) {
                        calendar.refetchEvents();
                    }
                } else {
                    toast.error(data.error || 'Ошибка обновления');
                }
            } catch (error) {
                console.error('Update practice error:', error);
                toast.error('Ошибка обновления практики');
            }
        });
    }
}

// Вызываем инициализацию
setTimeout(() => {
    initPracticeForm();
}, 1000);


