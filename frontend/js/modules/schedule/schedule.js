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
    
    const isMobile = window.innerWidth <= 768;
    
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: isMobile ? 'timeGridDay' : 'dayGridMonth',
        locale: 'ru',
        firstDay: 1,
        headerToolbar: isMobile ? {
            left: 'prev,next',
            center: 'title',
            right: 'timeGridDay,listWeek'
        } : {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay'
        },
        buttonText: {
            today: 'Сегодня',
            month: 'Месяц',
            week: 'Неделя',
            day: 'День',
            list: 'Список'
        },
        windowResize: function(arg) {
            const mobile = window.innerWidth <= 768;
            calendar.setOption('headerToolbar', mobile ? {
                left: 'prev,next',
                center: 'title',
                right: 'timeGridDay,listWeek'
            } : {
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay'
            });
            
            // Если перешли на мобильный и открыт сложный вид - переключаем на дневной
            if (mobile && (calendar.view.type === 'dayGridMonth' || calendar.view.type === 'timeGridWeek')) {
                calendar.changeView('timeGridDay');
            } else if (!mobile && calendar.view.type === 'listWeek') {
                calendar.changeView('timeGridWeek');
            }
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
        height: 'auto', // Убираем жесткую высоту для мобилок,
        
        editable: true,
        droppable: false,
        events: fetchCalendarClasses,
        eventDrop: handleEventDrop,
        eventClick: handleEventClick,
        dateClick: handleDateClick,
        eventDidMount: function(info) {
            const isPractice = info.event.extendedProps.isPractice;
            const teacherName = info.event.extendedProps.teacherName || '';
            
            // Формируем tooltip с преподавателем
            let tooltipText = `${info.event.title}\n${info.event.extendedProps.groupName || ''}`;
            if (teacherName && teacherName !== 'Не назначен') {
                tooltipText += `\nПреподаватель: ${teacherName}`;
            }
            if (isPractice) {
                tooltipText += '\n(Открытая практика)';
            }
            info.el.title = tooltipText;
            
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
            const view = arg.view.type; // dayGridMonth, timeGridWeek, timeGridDay
            
            const now = new Date();
            const eventEnd = arg.event.end ? new Date(arg.event.end) : new Date(arg.event.start);
            const isPractice = arg.event.extendedProps.isPractice;
            
            const isPast = eventEnd < now;
            const hasGroup = arg.event.extendedProps.groupId;
            const eligibleStudentsCount = (arg.event.extendedProps.eligibleStudentsCount ?? arg.event.extendedProps.groupStudentsCount) || 0;
            const attendees = arg.event.extendedProps.attendees || [];
            
            const attendedCount = attendees.filter(a => a.attended === true).length;
            const noOneAttended = arg.event.extendedProps.noOneAttended === true;
            // ✅ Практики не требуют отметки посещаемости
            // ✅ Не показываем баджик если отмечено "никто не пришел"
            const needsAttendance = !isPractice && isPast && hasGroup && eligibleStudentsCount > 0 && attendedCount === 0 && !noOneAttended;
            
            // Обработка прошедших занятий
            
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
                ? `<small style="display: block; margin-top: 2px; opacity: 0.9; font-size: 0.85em;">${teacherName}</small>` 
                : '';
            
            // Для недельного и дневного вида - показываем время в eventContent
            const timeDisplay = (view === 'timeGridWeek' || view === 'timeGridDay') 
                ? '' // Время уже показывается FullCalendar автоматически
                : `<small style="display: block; margin-top: 2px; opacity: 0.8;">${arg.timeText}</small>`;
            
            return {
                html: `<div style="
                    background-color: ${bgColor};
                    padding: ${view === 'dayGridMonth' ? '5px' : '4px 6px'}; 
                    font-size: ${view === 'dayGridMonth' ? '0.75rem' : '0.8rem'}; 
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
                         <b style="display: block; font-size: ${view === 'dayGridMonth' ? '1em' : '0.95em'};">${arg.event.title}</b>
                         ${timeDisplay}
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
        
        // Загрузка занятий
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (response.status === 401) {
            console.error('❌ 401: Сессия истекла');
            toast.warning( 'Сессия истекла. Пожалуйста, войдите заново.');
            localStorage.clear();
            window.location.href = '/login.html';
            return;
        }
        
        if (!response.ok) {
            console.error(`❌ Ошибка загрузки занятий: ${response.status} ${response.statusText}`);
            throw new Error('Failed to fetch classes');
        }
        
        const data = await response.json();
        // Занятия загружены
        
        // Детальное логирование практик
        const practices = data.classes.filter(cls => cls.isPractice);
        if (practices.length > 0) {
            // Практики найдены
            practices.forEach(p => {
                // Практика
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
                // Практика загружена
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
                    eligibleStudentsCount: (cls.eligibleStudentsCount ?? cls.group?.currentStudents) || 0,
                    teacherId: cls.teacher?._id || null,
                    teacherName: cls.teacher ? `${cls.teacher.name} ${cls.teacher.lastName || ''}`.trim() : 'Не назначен',
                    roomId: cls.room?._id || null,
                    roomName: cls.room?.name || 'Не указан',
                    roomColor: cls.room?.color || '#eb4d77',
                    status: cls.status,
                    notes: cls.notes,
                    attendees: cls.attendees,
                    isPractice: cls.isPractice || false,
                    practiceGroups: cls.practiceGroups || [],
                    noOneAttended: cls.noOneAttended || false
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
            window.location.href = '/login.html';
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
    
    currentClassForAttendance = classData;
    
    // Если это практика - открываем practiceModal, иначе attendanceModal
    if (classData.isPractice) {
        await openPracticeModal(classData);
    } else {
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
    
    // Удаление занятия
    
    // ⚡ ОПТИМИСТИЧНОЕ ОБНОВЛЕНИЕ: сначала убираем событие из календаря
    let removedEvent = null;
    if (calendar) {
        const event = calendar.getEventById(classId);
        if (event) {
            // Удаляем событие из календаря визуально
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
            
            // Event removed from UI
        }
    }
    
    try {
        const url = `${API_URL}/classes/${classId}`;
        // Sending DELETE request to server
        
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        // Server response received
        
        if (response.status === 401) {
            toast.warning('Сессия истекла. Пожалуйста, войдите заново.');
            localStorage.clear();
            window.location.href = '/login.html';
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
                // Возвращаем событие в календарь из-за ошибки
                calendar.refetchEvents();
            }
            throw new Error(error.error || 'Failed to delete class');
        }
        
        const data = await response.json();
        // Class successfully deleted from server
        
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
        const response = await fetch(`${API_URL}/students?role=teacher&limit=100`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        const data = await response.json();
        const teachers = data.students || [];
        
        const select = document.getElementById('attendanceTeacher');
        console.log('loadTeachersForAttendance: selectedTeacherId =', selectedTeacherId);
        select.innerHTML = '<option value="">Выберите преподавателя</option>' +
            teachers.map(teacher => {
                if (teacher._id === selectedTeacherId) console.log('Match found for:', teacher.name);
                return `<option value="${teacher._id}" ${String(teacher._id) === String(selectedTeacherId) ? 'selected' : ''}>${teacher.name}</option>`;
            }).join('');
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
                
                <span style="opacity: 0.7;">Преподаватель:</span>
                <span id="classInfoTeacher">${classData.teacherName || 'Не назначен'}</span>
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
        
        // Проверка наличия группы (если индивидуальное занятие - просто загружаем преподов и прерываем)
        if (!classData.groupId) {
            await loadTeachersForAttendance(classData.teacherId);
            
            document.getElementById('attendanceList').innerHTML = `
                <p style="text-align: center; opacity: 0.5; padding: 20px;">
                    Посещаемость доступна только для занятий с группами
                </p>
            `;
            return;
        }
        
        // ⚡ ПАРАЛЛЕЛЬНО загружаем все данные В ФОНЕ
        let selectedTeacherId = classData.teacherId;
        
        // Загрузка данных для посещаемости
        
        const [groupData, studentsData, freezesData] = await Promise.all([
            // Загружаем группу (для преподавателя)
            classData.groupId && !selectedTeacherId 
                ? fetch(`${API_URL}/groups/${classData.groupId}`, {
                    headers: { 'Authorization': `Bearer ${getAuthToken()}` }
                  }).then(r => {
                      // Группа загружена
                      return r.json();
                  }).catch(err => {
                      console.error('❌ Ошибка загрузки группы:', err);
                      return null;
                  })
                : null,
            // Загружаем студентов группы
            fetch(`${API_URL}/groups/${classData.groupId}/students`, {
                headers: { 'Authorization': `Bearer ${getAuthToken()}` }
            }).then(async r => {
                // Студенты группы загружены
                if (!r.ok) {
                    const errorData = await r.json().catch(() => ({}));
                    console.error(`❌ Ошибка ${r.status}:`, errorData);
                    throw new Error(errorData.error || errorData.message || `HTTP ${r.status}`);
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
                // Заморозки загружены
                return r.json();
            }).catch(err => {
                console.error('❌ Ошибка загрузки заморозок:', err);
                return { freezes: [] };
            })
        ]);
        
        // Определяем преподавателя
        if (groupData?.success && groupData.group?.teacher) {
            const t = groupData.group.teacher;
            selectedTeacherId = t._id || t.id || t;
            
            // Если в инфо было "Не назначен", обновляем на реальное имя
            const infoTeacher = document.getElementById('classInfoTeacher');
            if (infoTeacher && t.name) {
                infoTeacher.textContent = `${t.name} ${t.lastName || ''}`.trim();
            }
        }
        
        // Загружаем преподавателей
        await loadTeachersForAttendance(selectedTeacherId);
        
        const students = studentsData.students || [];
        const activeFreezes = freezesData.freezes || [];
        
        function isStudentFrozen(studentId, classDate) {
            return activeFreezes.some(freeze => {
                // ✅ Проверка что freeze.student существует (может быть удален)
                if (!freeze.student || freeze.student._id !== studentId) return false;
                
                const freezeStart = new Date(freeze.startDate);
                const freezeEnd = new Date(freeze.endDate);
                const clsDate = new Date(classDate);
                
                freezeStart.setHours(0, 0, 0, 0);
                freezeEnd.setHours(23, 59, 59, 999);
                clsDate.setHours(12, 0, 0, 0);
                
                return clsDate >= freezeStart && clsDate <= freezeEnd;
            });
        }
        
        // Делаем функцию доступной глобально для markAllPresent
        window.isStudentFrozen = isStudentFrozen;
        
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
            // ✅ attendees.student - это просто ID (строка), НЕ объект!
            // Бэкенд не делает populate для оптимизации
            const attendee = classData.attendees.find(a => {
                if (!a || !a.student) return false;
                // Сравниваем строку с строкой (оба ID)
                const attendeeStudentId = typeof a.student === 'object' ? a.student._id : a.student;
                return attendeeStudentId === student._id.toString();
            });
            const isPresent = attendee ? attendee.attended : false;
            
            const isFrozen = isStudentFrozen(student._id, classData.date);
            
            currentAttendanceData[student._id] = isPresent;
            
            let membershipInfo = '';
            if (student.debtAmount > 0) {
                membershipInfo += `<span style="color: #ef4444; font-weight: 600; font-size: 0.85em; background: rgba(239, 68, 68, 0.1); padding: 2px 6px; border-radius: 4px;">💸 Долг: ${student.debtAmount} ₸</span>`;
            }
            if (student.activeMembership) {
                if (student.activeMembership.type !== 'unlimited' && student.activeMembership.classesRemaining !== undefined) {
                    const isEnding = student.activeMembership.classesRemaining <= 2;
                    const color = isEnding ? '#f59e0b' : '#10b981';
                    const bg = isEnding ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)';
                    membershipInfo += `<span style="color: ${color}; font-size: 0.85em; background: ${bg}; padding: 2px 6px; border-radius: 4px;">🎫 Осталось: ${student.activeMembership.classesRemaining}</span>`;
                } else if (student.activeMembership.type === 'unlimited') {
                    membershipInfo += `<span style="color: #10b981; font-size: 0.85em; background: rgba(16, 185, 129, 0.1); padding: 2px 6px; border-radius: 4px;">♾️ Безлимит</span>`;
                }
            } else {
                 membershipInfo += `<span style="color: #ef4444; font-size: 0.85em; background: rgba(239, 68, 68, 0.1); padding: 2px 6px; border-radius: 4px;">❌ Нет абонемента</span>`;
            }
            
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
                " id="attendance-item-${student._id}">
                    <div class="student-row-link student-row-link--attendance" onclick="viewStudent('${student._id}')" title="Открыть профиль" style="flex: 1;">
                        <div class="student-row-link__info">
                            <div style="font-weight: 600; margin-bottom: 5px; color: var(--admin-text); display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                ${student.name}
                                ${isFrozen ? '<span style="color: #60a5fa; font-size: 0.85em;">❄️ ЗАМОРОЗКА</span>' : ''}
                            </div>
                            <div style="font-size: 0.9rem; opacity: 0.7; color: var(--admin-text); margin-bottom: 6px;">${student.phone || 'Нет номера'}</div>
                            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                                ${membershipInfo}
                            </div>
                        </div>
                        <svg class="student-row-link__chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left: 15px;">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </div>
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                        <span style="font-size: 0.9rem; opacity: 0.8; color: var(--admin-text);">Присутствовал</span>
                        <input type="checkbox" 
                               ${isPresent ? 'checked' : ''}
                               onchange="toggleAttendance('${student._id}')"
                               style="width: 20px; height: 20px; cursor: pointer;">
                    </label>
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА в openAttendanceModal:', error);
        console.error('❌ Error message:', error.message);
        console.error('❌ Error stack:', error.stack);
        
        document.getElementById('attendanceList').innerHTML = `
            <div style="text-align: center; padding: 20px; color: #dc3545;">
                <p style="font-size: 1.2rem; margin-bottom: 10px;">⚠️ Ошибка при загрузке студентов</p>
                <p style="opacity: 0.7; font-size: 0.9rem;">${error.message || 'Неизвестная ошибка'}</p>
                <p style="margin-top: 15px; opacity: 0.6; font-size: 0.85rem;">
                    Попробуйте обновить страницу или обратитесь к администратору
                </p>
            </div>
        `;
        
        toast.error(`Ошибка загрузки: ${error.message || 'Неизвестная ошибка'}`);
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

// ✅ Экспортируем функции в глобальную область для доступа из HTML
window.toggleAttendance = toggleAttendance;

// Отметить всех присутствующими
function markAllPresent() {
    if (!currentClassForAttendance) return;
    
    const classDate = currentClassForAttendance.date;
    let frozenCount = 0;
    
    Object.keys(currentAttendanceData).forEach(studentId => {
        // Проверяем заморозку студента
        const isFrozen = isStudentFrozen(studentId, classDate);
        
        if (isFrozen) {
            frozenCount++;
        }
        
        currentAttendanceData[studentId] = true;
        const checkbox = document.querySelector(`#attendance-item-${studentId} input[type="checkbox"]`);
        const item = document.getElementById(`attendance-item-${studentId}`);
        if (checkbox) checkbox.checked = true;
        if (item) item.style.borderLeftColor = '#28a745';
    });
    
    const totalMarked = Object.keys(currentAttendanceData).length;
    
    // Показываем уведомление
    if (frozenCount > 0) {
        toast.success(`Отмечено: ${totalMarked} студентов (включая ${frozenCount} с заморозкой).`);
    } else {
        toast.success(`Отмечено: ${totalMarked} студентов.`);
    }
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

// ✅ Экспортируем в глобальную область
window.markAllPresent = markAllPresent;
window.markAllAbsent = markAllAbsent;

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
        
        // ✅ ВАЖНО: Сохраняем данные ДО закрытия модалки!
        // closeAttendanceModal() очищает currentAttendanceData = {}
        const savedAttendanceData = { ...currentAttendanceData };
        const savedClassData = { ...currentClassForAttendance };
        
        // ⚡ OPTIMISTIC UI: Закрываем модалку СРАЗУ!
        closeAttendanceModal();
        toast.success('Сохранение...');
        
        // 🔥 СОХРАНЯЕМ В ФОНЕ (не блокируем UI)
        (async () => {
            try {
                // Обновляем преподавателя если изменился
                const oldTeacherId = savedClassData?.teacherId || null;
                if (newTeacherId !== oldTeacherId) {
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
                const promises = Object.entries(savedAttendanceData).map(([studentId, attended]) => {
                    return fetch(`${API_URL}/classes/${classId}/attendance`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${getAuthToken()}`
                        },
                        body: JSON.stringify({ studentId, attended })
                    }).then(async response => {
                        const data = await response.json().catch(() => ({}));
                        
                        if (!response.ok) {
                            console.error(`Ошибка сохранения посещаемости для студента ${studentId}:`, data);
                            throw new Error(`HTTP ${response.status}: ${data.error || data.message || 'Unknown error'}`);
                        }
                        
                        return data;
                    });
                });
                
                await Promise.all(promises);
                
                // ✅ Обновляем календарь с сервера после сохранения посещаемости
                // Кеш на сервере очищается после сохранения, поэтому данные будут актуальными
                if (calendar) {
                    // Небольшая задержка, чтобы сервер успел очистить кеш и сохранить данные в БД
                    setTimeout(() => {
                        calendar.refetchEvents();
                    }, 200);
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

// Отметить что никто не пришел на занятие
async function markNoOneAttended() {
    const classData = currentClassForAttendance;
    
    if (!classData || !classData.id) {
        console.error('❌ markNoOneAttended: classData not found');
        if (typeof toast !== 'undefined') {
            toast.error('Ошибка: занятие не найдено');
        }
        return;
    }
    
    const dateStr = classData.date.toLocaleDateString('ru-RU');
    
    // Показываем диалог подтверждения
    const confirmed = await customConfirm(`Отметить, что никто не пришел на занятие?\n\n${classData.title}\n${dateStr} ${classData.startTime}-${classData.endTime}\n\nПосле этого красный баджик и счетчик неотмеченных занятий уменьшатся.`);
    
    if (!confirmed) {
        return;
    }
    
    try {
        console.log('✅ markNoOneAttended: Подтверждено, отправляем запрос на сервер');
        
        // Показываем уведомление о сохранении
        if (typeof toast !== 'undefined') {
            toast.success('Сохранение...');
        }
        
        // Отправляем запрос на сервер
        const response = await fetch(`${API_URL}/classes/${classData.id}/mark-no-one-attended`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        // Проверяем ответ
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ markNoOneAttended: Server error:', response.status, errorText);
            throw new Error(`HTTP ${response.status}: ${errorText || 'Ошибка сервера'}`);
        }
        
        const data = await response.json().catch(err => {
            console.error('❌ markNoOneAttended: JSON parse error:', err);
            throw new Error('Неверный формат ответа от сервера');
        });
        
        if (!data.success) {
            throw new Error(data.error || data.message || 'Ошибка при отметке');
        }
        
        console.log('✅ markNoOneAttended: Успешно отмечено на сервере', data);
        
        // Показываем уведомление об успехе
        if (typeof toast !== 'undefined' && toast.success) {
            toast.success('Отмечено, что никто не пришел на занятие');
        } else if (typeof showNotification !== 'undefined') {
            showNotification('Отмечено, что никто не пришел на занятие');
        } else {
            console.log('✅ Отмечено, что никто не пришел на занятие');
        }
        
        // Закрываем модалку ПОСЛЕ успешного ответа
        closeAttendanceModal();
        
        // ✅ Обновляем календарь с сервера после отметки
        // Увеличиваем задержку, чтобы сервер успел обновить данные и очистить кэш
        if (calendar && typeof calendar.refetchEvents === 'function') {
            // Первая задержка для обновления календаря
            setTimeout(() => {
                console.log('🔄 markNoOneAttended: Обновляем календарь');
                calendar.refetchEvents();
                
                // ✅ Обновляем badge несколько раз с интервалами, чтобы гарантировать обновление
                // После первого обновления календаря
                setTimeout(() => {
                    console.log('🔄 markNoOneAttended: Обновляем badge (попытка 1)');
                    if (typeof updatePendingAttendanceBadge === 'function') {
                        updatePendingAttendanceBadge();
                    }
                }, 1000);
                
                // Второе обновление badge с большей задержкой
                setTimeout(() => {
                    console.log('🔄 markNoOneAttended: Обновляем badge (попытка 2)');
                    if (typeof updatePendingAttendanceBadge === 'function') {
                        updatePendingAttendanceBadge();
                    }
                }, 2000);
                
                // Третье обновление badge для надежности
                setTimeout(() => {
                    console.log('🔄 markNoOneAttended: Обновляем badge (попытка 3)');
                    if (typeof updatePendingAttendanceBadge === 'function') {
                        updatePendingAttendanceBadge();
                    }
                }, 3000);
            }, 1500);
        } else {
            console.warn('⚠️ Calendar not found or refetchEvents not available');
            // Если календарь не определен, все равно обновляем badge несколько раз
            setTimeout(() => {
                console.log('🔄 markNoOneAttended: Обновляем badge (календарь не найден, попытка 1)');
                if (typeof updatePendingAttendanceBadge === 'function') {
                    updatePendingAttendanceBadge();
                }
            }, 2000);
            
            setTimeout(() => {
                console.log('🔄 markNoOneAttended: Обновляем badge (календарь не найден, попытка 2)');
                if (typeof updatePendingAttendanceBadge === 'function') {
                    updatePendingAttendanceBadge();
                }
            }, 3500);
        }
        
    } catch (error) {
        console.error('❌ Ошибка при отметке "никто не пришел":', error);
        console.error('   Error details:', error.message, error.stack);
        
        if (typeof toast !== 'undefined') {
            toast.error(error.message || 'Ошибка при отметке');
        } else {
            alert('Ошибка: ' + (error.message || 'Ошибка при отметке'));
        }
    }
}

// ✅ Экспортируем функцию в глобальную область для доступа из HTML
window.markNoOneAttended = markNoOneAttended;

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
        const response = await fetch(`${API_URL}/students?role=teacher&limit=100`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (!response.ok) throw new Error('Failed to fetch teachers');
        
        const data = await response.json();
        const teachers = data.students || [];
        
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
    initGenerateScheduleButton();

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
                        groupName: groupName,
                        roomId: roomId,
                        teacherId: teacherId,
                        teacherName: teacherSelect && teacherSelect.selectedIndex >= 0 ? teacherSelect.options[teacherSelect.selectedIndex].text : 'Не назначен',
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
                
                // Удаляем временное событие и обновляем календарь
                if (calendar) {
                    if (tempEventId) {
                        const tempEvent = calendar.getEventById(tempEventId);
                        if (tempEvent) {
                            tempEvent.remove();
                        }
                    }
                    calendar.refetchEvents();
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

// Экспорт функции для использования в admin.js (сразу после определения)
window.initScheduleHandlers = initScheduleHandlers;

// =====================================================
// ГЕНЕРАЦИЯ РАСПИСАНИЯ ИЗ ГРУПП
// =====================================================

// Открыть модалку генерации расписания
window.openGenerateScheduleModal = async function() {
    const modal = document.getElementById('generateScheduleModal');
    if (modal) {
        // Загружаем залы перед открытием
        await loadRoomsForGeneration();

        // Подставляем разумные значения по умолчанию в поля "с" и "по"
        const startInput = document.getElementById('generateScheduleStartDate');
        const endInput = document.getElementById('generateScheduleEndDate');
        if (startInput && endInput) {
            const toYmd = (d) => {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${y}-${m}-${day}`;
            };
            const today = new Date();
            const inTwoWeeks = new Date(today);
            inTwoWeeks.setDate(inTwoWeeks.getDate() + 14);
            if (!startInput.value) startInput.value = toYmd(today);
            if (!endInput.value) endInput.value = toYmd(inTwoWeeks);
        }

        modal.classList.add('show');
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
        // Модалка генерации расписания закрыта
    }
}

// Генерация занятий из расписания групп
window.generateSchedule = async function(period) {
    let loadingToast = null;
    let pollInterval = null;

    const progressContainer = document.getElementById('generationProgress');
    const progressBar = document.getElementById('generationProgressBar');
    const progressText = document.getElementById('generationProgressText');
    const progressTitle = progressContainer ? progressContainer.querySelector('div') : null;

    const hideProgress = () => {
        if (progressContainer) progressContainer.style.display = 'none';
    };

    const setProgress = (pct, label) => {
        if (progressBar) progressBar.style.width = `${Math.max(2, Math.min(100, pct))}%`;
        if (progressText && typeof label === 'string') progressText.textContent = label;
    };

    // toast из core/toast.js возвращает DOM-элемент и не имеет метода .dismiss.
    // Удаляем сами, повторяя анимацию closeToast.
    const dismissToast = (el) => {
        if (!el || !el.classList) return;
        el.classList.add('removing');
        setTimeout(() => {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 300);
    };

    try {
        const roomSelect = document.getElementById('generateScheduleRoom');
        const roomId = roomSelect?.value;

        if (!roomId) {
            toast.error('Пожалуйста, выберите зал');
            return;
        }

        // Готовим payload с учётом кастомного диапазона дат
        const requestBody = { period, roomId };
        let periodText;

        if (period === 'custom') {
            const startInput = document.getElementById('generateScheduleStartDate');
            const endInput = document.getElementById('generateScheduleEndDate');
            const startDate = startInput?.value;
            const endDate = endInput?.value;

            if (!startDate || !endDate) {
                toast.error('Укажите обе даты диапазона');
                return;
            }
            if (new Date(endDate) < new Date(startDate)) {
                toast.error('Дата окончания раньше даты начала');
                return;
            }
            const daysDiff = Math.round(
                (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)
            ) + 1;
            if (daysDiff > 180) {
                toast.error('Максимальный диапазон — 180 дней');
                return;
            }

            requestBody.startDate = startDate;
            requestBody.endDate = endDate;

            const fmt = (d) => new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
            periodText = `период ${fmt(startDate)} — ${fmt(endDate)}`;
        } else {
            periodText = period === 'week' ? 'неделю' : 'месяц';
        }

        window.closeGenerateScheduleModal();

        if (progressContainer) {
            progressContainer.style.display = 'block';
            if (progressTitle) progressTitle.textContent = `Создаю занятия на ${periodText}`;
            setProgress(2, 'Планирование...');
        }

        loadingToast = toast.info(`Создаю занятия на ${periodText}...`, 0);

        const token = getAuthToken();
        if (!token) {
            hideProgress();
            dismissToast(loadingToast);
            toast.error('Необходима авторизация');
            return;
        }

        const startTime = Date.now();

        // 1. Запускаем фоновую задачу на бэке, получаем jobId
        const startResponse = await fetch(`${API_URL}/classes/generate-from-schedule`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!startResponse.ok) {
            const errorData = await startResponse.json().catch(() => ({}));
            hideProgress();
            dismissToast(loadingToast);
            toast.error(errorData.error || 'Ошибка генерации');
            return;
        }

        const startData = await startResponse.json();
        if (!startData.success || !startData.jobId) {
            hideProgress();
            dismissToast(loadingToast);
            toast.error(startData.error || 'Ошибка запуска генерации');
            return;
        }

        const { jobId, total, toCreate, skipped: initialSkipped } = startData;

        // Если создавать нечего — сразу финализируем
        if (!total) {
            setProgress(100, 'Расписаний не найдено');
            dismissToast(loadingToast);
            setTimeout(() => {
                hideProgress();
                toast.info('Нет активных расписаний для генерации занятий');
            }, 800);
            return;
        }

        if (!toCreate) {
            setProgress(100, `Все занятия на ${periodText} уже созданы`);
            dismissToast(loadingToast);
            setTimeout(() => {
                hideProgress();
                toast.info(`Все занятия на ${periodText} уже созданы (${initialSkipped})`);
                if (calendar) calendar.refetchEvents();
            }, 1000);
            return;
        }

        setProgress(5, `Создано 0 из ${toCreate}...`);

        // 2. Опрашиваем прогресс каждые 500 мс
        const finalize = (progress) => {
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            const created = progress?.created ?? 0;
            const skippedCount = progress?.skipped ?? 0;

            setProgress(100, `Завершено! Создано: ${created} занятий`);

            setTimeout(() => {
                hideProgress();
                dismissToast(loadingToast);

                if (progress?.error) {
                    toast.error('Ошибка при генерации: ' + progress.error);
                    return;
                }

                let finalMessage = `Создано: ${created} занятий`;
                if (skippedCount > 0) finalMessage += `\nПропущено (уже существуют): ${skippedCount}`;
                finalMessage += `\nВремя: ${duration}с`;

                toast.success(finalMessage, 5000);

                if (calendar) calendar.refetchEvents();
            }, 800);
        };

        let consecutiveErrors = 0;
        pollInterval = setInterval(async () => {
            try {
                const progressResp = await fetch(
                    `${API_URL}/classes/generation-progress/${jobId}`,
                    { headers: { 'Authorization': `Bearer ${token}` } }
                );
                if (!progressResp.ok) {
                    consecutiveErrors++;
                    if (consecutiveErrors >= 5) {
                        clearInterval(pollInterval);
                        pollInterval = null;
                        hideProgress();
                        dismissToast(loadingToast);
                        toast.error('Потеряна связь с сервером при генерации');
                    }
                    return;
                }
                consecutiveErrors = 0;
                const progress = await progressResp.json();
                if (!progress.success) return;

                const pct = progress.total > 0
                    ? Math.round((progress.processed / progress.total) * 100)
                    : 0;
                const label = progress.toCreate > 0
                    ? `Создано ${progress.created} из ${progress.toCreate}` +
                      (progress.skipped ? ` (пропущено: ${progress.skipped})` : '')
                    : `Пропущено: ${progress.skipped}`;
                setProgress(Math.max(5, Math.min(99, pct)), label);

                // Постепенно обновляем календарь во время генерации
                if (calendar && progress.created > 0 && progress.created % 20 === 0) {
                    calendar.refetchEvents();
                }

                if (progress.done) {
                    clearInterval(pollInterval);
                    pollInterval = null;
                    finalize(progress);
                }
            } catch (err) {
                consecutiveErrors++;
                if (consecutiveErrors >= 5) {
                    clearInterval(pollInterval);
                    pollInterval = null;
                    hideProgress();
                    dismissToast(loadingToast);
                    toast.error('Не удалось получить прогресс генерации');
                }
            }
        }, 500);
    } catch (error) {
        console.error('Generate schedule error:', error);
        if (pollInterval) clearInterval(pollInterval);
        hideProgress();
        dismissToast(loadingToast);
        toast.error('Ошибка при генерации занятий: ' + error.message);
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
        // Кнопка готова
    } else {
        console.warn('⚠️ Кнопка generateFromScheduleBtn не найдена');
    }

    // Кнопка массового удаления — только для super_admin
    const bulkBtn = document.getElementById('bulkDeleteClassesBtn');
    if (bulkBtn) {
        const isSuper = typeof isSuperAdmin === 'function'
            ? isSuperAdmin()
            : (localStorage.getItem('userRole') === 'super_admin');
        if (isSuper) {
            bulkBtn.style.display = 'inline-flex';
            bulkBtn.removeEventListener('click', window.openBulkDeleteClassesModal);
            bulkBtn.addEventListener('click', window.openBulkDeleteClassesModal);
        } else {
            bulkBtn.style.display = 'none';
        }
    }
}

// =====================================================
// МАССОВОЕ УДАЛЕНИЕ ЗАНЯТИЙ (super_admin)
// =====================================================

window.openBulkDeleteClassesModal = async function() {
    const modal = document.getElementById('bulkDeleteClassesModal');
    if (!modal) return;

    // Подтягиваем залы в select
    try {
        const response = await fetch(`${API_URL}/rooms`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        if (response.ok) {
            const data = await response.json();
            const rooms = data.rooms || [];
            const select = document.getElementById('bulkDeleteRoom');
            if (select) {
                select.innerHTML = '<option value="">Все залы</option>' +
                    rooms.map(r => `<option value="${r._id || r.id}">${r.name}</option>`).join('');
            }
        }
    } catch (e) {
        console.error('loadRooms for bulk delete failed:', e);
    }

    // Дефолтные даты — сегодня и +30 дней
    const toYmd = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };
    const today = new Date();
    const plus30 = new Date(today);
    plus30.setDate(plus30.getDate() + 30);
    const startInput = document.getElementById('bulkDeleteStartDate');
    const endInput = document.getElementById('bulkDeleteEndDate');
    if (startInput && !startInput.value) startInput.value = toYmd(today);
    if (endInput && !endInput.value) endInput.value = toYmd(plus30);

    // Сброс подтверждения
    const confirmInput = document.getElementById('bulkDeleteConfirm');
    const actionBtn = document.getElementById('bulkDeleteActionBtn');

    const setActionBtnEnabled = (enabled) => {
        if (!actionBtn) return;
        actionBtn.disabled = !enabled;
        actionBtn.style.opacity = enabled ? '1' : '0.45';
        actionBtn.style.cursor = enabled ? 'pointer' : 'not-allowed';
        actionBtn.style.pointerEvents = enabled ? 'auto' : 'none';
    };

    if (confirmInput) {
        confirmInput.value = '';
        confirmInput.oninput = () => {
            const ok = confirmInput.value.trim().toUpperCase() === 'УДАЛИТЬ';
            setActionBtnEnabled(ok);
        };
    }
    setActionBtnEnabled(false);

    modal.classList.add('show');
};

window.closeBulkDeleteClassesModal = function() {
    const modal = document.getElementById('bulkDeleteClassesModal');
    if (modal) modal.classList.remove('show');
};

window.submitBulkDeleteClasses = async function() {
    const startInput = document.getElementById('bulkDeleteStartDate');
    const endInput = document.getElementById('bulkDeleteEndDate');
    const roomSelect = document.getElementById('bulkDeleteRoom');
    const onlyGeneratedInput = document.getElementById('bulkDeleteOnlyGenerated');
    const confirmInput = document.getElementById('bulkDeleteConfirm');
    const actionBtn = document.getElementById('bulkDeleteActionBtn');

    const startDate = startInput?.value;
    const endDate = endInput?.value;
    const roomId = roomSelect?.value || null;
    const onlyGenerated = !!onlyGeneratedInput?.checked;

    if (!startDate || !endDate) {
        toast.error('Укажите обе даты');
        return;
    }
    if (new Date(endDate) < new Date(startDate)) {
        toast.error('Дата окончания раньше даты начала');
        return;
    }
    if ((confirmInput?.value || '').trim().toUpperCase() !== 'УДАЛИТЬ') {
        toast.error('Введите слово УДАЛИТЬ для подтверждения');
        return;
    }

    const originalText = actionBtn ? actionBtn.textContent : 'УДАЛИТЬ ЗАНЯТИЯ';
    if (actionBtn) {
        actionBtn.disabled = true;
        actionBtn.textContent = 'УДАЛЕНИЕ...';
        actionBtn.style.cursor = 'wait';
        actionBtn.style.pointerEvents = 'none';
        actionBtn.style.opacity = '0.7';
    }

    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/classes/bulk-delete`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ startDate, endDate, roomId, onlyGenerated })
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.success) {
            toast.error(data.error || `Ошибка удаления (${response.status})`);
            return;
        }

        const fmt = (d) => new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const msg = `Удалено занятий: ${data.deleted}\n`
            + `Период: ${fmt(startDate)} — ${fmt(endDate)}`
            + (onlyGenerated ? '\nТолько автосгенерированные' : '\nВсе занятия в диапазоне');

        toast.success(msg, 5000);
        window.closeBulkDeleteClassesModal();
        if (typeof calendar !== 'undefined' && calendar) calendar.refetchEvents();
    } catch (err) {
        console.error('Bulk delete error:', err);
        toast.error('Ошибка удаления: ' + err.message);
    } finally {
        if (actionBtn) {
            actionBtn.textContent = originalText;
            actionBtn.style.cursor = 'pointer';
            actionBtn.style.pointerEvents = 'auto';
            actionBtn.style.opacity = '1';
            actionBtn.disabled = false;
        }
    }
};

// =====================================================
// МОДАЛКА РЕДАКТИРОВАНИЯ ПРАКТИКИ
// =====================================================

let currentPracticeGroups = [];
let currentPracticeId = null;

// Открыть модалку редактирования практики
window.openPracticeModal = async function(classData) {
    try {
        // Открытие модалки практики
        
        const modal = document.getElementById('practiceModal');
        currentPracticeId = classData.id;
        currentPracticeGroups = classData.practiceGroups || [];
        
        // Данные практики загружены
        
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
    
    // Удаление практики
    
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
            // Удаляем практику из календаря визуально
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
            
            // Практика удалена из UI
        }
    }
    
    try {
        // Формирование DELETE запроса
        // API_URL
        // practiceIdToDelete
        // Тип
        // Длина
        
        const url = `${API_URL}/classes/${practiceIdToDelete}`;
        // Итоговый URL
        
        const response = await fetch(url, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        
        // Ответ сервера
        
        if (!response.ok) {
            const error = await response.json();
            console.error('❌ Ошибка удаления практики:', error);
            toast.error(error.error || 'Ошибка удаления');
            // Если ошибка - обновляем календарь для синхронизации
            if (calendar) {
                // Возвращаем практику в календарь из-за ошибки
                calendar.refetchEvents();
            }
            return;
        }
        
        const data = await response.json();
        // Практика успешно удалена на сервере
        
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

// Получить количество занятий, требующих отметки посещаемости
async function updatePendingAttendanceBadge() {
    try {
        const badge = document.getElementById('pendingAttendanceBadge');
        if (!badge) return;

        const response = await fetch(`${API_URL}/classes/pending-attendance/count`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });

        if (!response.ok) return;

        const data = await response.json();
        const count = data.count || 0;

        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    } catch (error) {
        console.error('Update pending attendance badge error:', error);
    }
}

// Экспорт функций
window.updatePendingAttendanceBadge = updatePendingAttendanceBadge;

// Вызываем инициализацию
setTimeout(() => {
    initPracticeForm();
}, 1000);


