// =====================================================
// SCHEDULE MODULE - Календарь и занятия
// =====================================================

let calendar = null;
let allGroups = [];
let allRooms = [];
const selectedRoomIds = new Set();
let currentClassForAttendance = null;
let currentAttendanceData = {};
let currentBillingClassId = null;
let billingPreviewTimer = null;

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
        windowResize: function (arg) {
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
        displayEventEnd: true,
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
        datesSet: function () {
            if (typeof refreshRoomOccupancy === 'function') {
                refreshRoomOccupancy();
            }
        },
        eventDidMount: function (info) {
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
        eventContent: function (arg) {
            const bgColor = arg.event.backgroundColor || '#eb4d77';
            const view = arg.view.type; // dayGridMonth, timeGridWeek, timeGridDay

            const now = new Date();
            const eventEnd = arg.event.end ? new Date(arg.event.end) : new Date(arg.event.start);
            const isPractice = arg.event.extendedProps.isPractice;

            const isPast = eventEnd < now;
            const hasGroup = arg.event.extendedProps.groupId;
            const isIndividualWithStudent = arg.event.extendedProps.classType === 'individual' && arg.event.extendedProps.individualStudentName;
            const eligibleStudentsCount = (arg.event.extendedProps.eligibleStudentsCount ?? arg.event.extendedProps.groupStudentsCount) || 0;
            const attendees = arg.event.extendedProps.attendees || [];

            const attendedCount = attendees.filter(a => a.attended === true).length;
            const noOneAttended = arg.event.extendedProps.noOneAttended === true;
            // ✅ Считаем «отмеченным» только если хотя бы один ученик присутствовал
            // Если все attended: false — значит преподаватель снял отметки, занятие снова «не отмечено»
            const hasConfirmedAttendance = attendedCount > 0;
            // ✅ Практики не требуют отметки посещаемости
            // ✅ Не показываем баджик если отмечено "никто не пришел"
            // Не требуем посещаемости для перенесенных занятий
            // ✅ Для групповых — нужна группа и ученики; для индивидуальных — нужен ученик
            const needsAttendanceGroup = hasGroup && eligibleStudentsCount > 0;
            const needsAttendance = !isPractice && isPast && (needsAttendanceGroup || isIndividualWithStudent) && !hasConfirmedAttendance && !noOneAttended && !['cancelled', 'completed', 'pending_admin_review'].includes(arg.event.extendedProps.status);

            const status = arg.event.extendedProps.status;
            let statusBadge = '';
            if (status === 'pending_admin_review') {
                statusBadge = `<span style="display: inline-block; font-size: 0.75em; color: #1a1a1a; background: #ffc107; padding: 2px 6px; border-radius: 4px; margin-bottom: 4px; font-weight: 600;">⏳ На подтверждении</span>`;
            } else if (status === 'not_filled') {
                statusBadge = `<span style="display: inline-block; font-size: 0.75em; color: #fff; background: #dc3545; padding: 2px 6px; border-radius: 4px; margin-bottom: 4px; font-weight: 600;">❌ Не заполнено</span>`;
            } else if (needsAttendance) {
                statusBadge = `<span style="display: inline-block; font-size: 0.75em; color: #fff; background: #dc3545; padding: 2px 6px; border-radius: 4px; margin-bottom: 4px; box-shadow: 0 2px 4px rgba(220,53,69,0.3); font-weight: 600;">⚠️ Не отмечено</span>`;
            }

            const badge = statusBadge;

            const teacherName = arg.event.extendedProps.teacherName || '';
            const teacherLine = teacherName && teacherName !== 'Не назначен'
                ? `<small style="display: block; margin-top: 2px; opacity: 0.9; font-size: 0.85em;">${teacherName}</small>`
                : '';

            // Для недельного и дневного вида - показываем время в eventContent
            const timeDisplay = (view === 'timeGridWeek' || view === 'timeGridDay')
                ? '' // Время уже показывается FullCalendar автоматически
                : `<small style="display: block; margin-top: 2px; opacity: 0.8;">${arg.timeText}</small>`;

            const isCancelled = arg.event.extendedProps.status === 'cancelled';
            const opacity = isCancelled ? '0.5' : '1';
            const textDecoration = isCancelled ? 'line-through' : 'none';
            const postponeTag = isCancelled ? `<span style="display: block; font-size: 0.75em; color: #fff; background: rgba(0,0,0,0.3); padding: 1px 4px; border-radius: 3px; margin-top: 3px; width: fit-content;">Перенесено</span>` : '';

            return {
                html: `<div style="
                    background-color: ${bgColor};
                    opacity: ${opacity};
                    text-decoration: ${textDecoration};
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
                         ${postponeTag}
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

        if (selectedRoomIds.size > 0) {
            url += `&roomIds=${Array.from(selectedRoomIds).join(',')}`;
        }

        // Загрузка занятий

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (response.status === 401) {
            console.error('❌ 401: Сессия истекла');
            toast.warning('Сессия истекла. Пожалуйста, войдите заново.');
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

            const finalColor = cls.backgroundColor || cls.room?.color || '#eb4d77';

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
            // Для индивидуальных — показываем имя ученика
            if (cls.classType === 'individual' && cls.individualStudent) {
                displayTitle = `Инд: ${cls.individualStudent.name} ${cls.individualStudent.lastName || ''}`.trim();
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
                    noOneAttended: cls.noOneAttended || false,
                    topic: cls.topic,
                    lessonGoals: cls.lessonGoals,
                    lessonSummary: cls.lessonSummary,
                    homeworkDraft: cls.homeworkDraft,
                    nextLessonFocus: cls.nextLessonFocus,
                    materials: cls.materials,
                    teacherComment: cls.teacherComment,
                    individualStudentName: cls.individualStudent ? `${cls.individualStudent.name} ${cls.individualStudent.lastName || ''}`.trim() : null,
                    classType: cls.classType || 'group'
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
            toast.warning('Сессия истекла. Пожалуйста, войдите заново.');
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
        topic: info.event.extendedProps.topic,
        lessonGoals: info.event.extendedProps.lessonGoals,
        lessonSummary: info.event.extendedProps.lessonSummary,
        homeworkDraft: info.event.extendedProps.homeworkDraft,
        nextLessonFocus: info.event.extendedProps.nextLessonFocus,
        materials: info.event.extendedProps.materials,
        teacherComment: info.event.extendedProps.teacherComment,
        noOneAttended: info.event.extendedProps.noOneAttended,
        notes: info.event.extendedProps.notes,
        attendees: info.event.extendedProps.attendees || [],
        roomName: info.event.extendedProps.roomName,
        roomId: info.event.extendedProps.roomId,
        isPractice: info.event.extendedProps.isPractice,
        practiceGroups: info.event.extendedProps.practiceGroups || [],
        individualStudentName: info.event.extendedProps.individualStudentName || null,
        classType: info.event.extendedProps.classType || 'group'
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
        
        if (select) {
            select.disabled = !(typeof isAdmin === 'function' && isAdmin());
        }
    } catch (error) {
    }
}

// Открыть модалку посещаемости
async function hydrateClassDataFromServer(classData) {
    if (!classData?.id) return classData;

    try {
        const response = await fetch(`${API_URL}/classes/${classData.id}`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` },
        });
        if (!response.ok) return classData;

        const payload = await response.json();
        const fresh = payload.class || payload;
        const teacher = fresh.teacher || null;

        return {
            ...classData,
            ...fresh,
            id: fresh.id || fresh._id || classData.id,
            _id: fresh._id || fresh.id || classData.id,
            teacherId: fresh.teacherId || teacher?._id || teacher?.id || classData.teacherId,
            teacherName: teacher
                ? `${teacher.name || ''} ${teacher.lastName || ''}`.trim()
                : classData.teacherName,
            roomName: fresh.room?.name || classData.roomName,
            attendees: fresh.attendees || classData.attendees || [],
            classType: fresh.classType || classData.classType,
            groupId: fresh.groupId ?? classData.groupId,
            individualStudentId: fresh.individualStudentId ?? classData.individualStudentId,
        };
    } catch (error) {
        console.error('hydrateClassDataFromServer error:', error);
        return classData;
    }
}

function formatScheduleAmount(amount) {
    return `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(amount) || 0))} ₸`;
}

function getScheduleMembershipAverageCharge(membership) {
    if (!membership) return null;
    const totalPrice = Number(membership.totalPrice || 0);
    const totalClasses = Number(membership.totalClasses || 0);
    if (totalPrice <= 0 || totalClasses <= 0) return null;
    const lessonPrice = totalPrice / totalClasses;
    if (!Number.isFinite(lessonPrice) || lessonPrice <= 0) return null;
    return Math.round(lessonPrice);
}

function getScheduleMembershipLabel(membership) {
    if (!membership) return 'Нет активного тарифа';
    return membership.plan?.name || membership.name || membership.type || 'Активный тариф';
}

function buildAttendanceMembershipInfo(student) {
    let membershipInfo = '';

    const balance = Number(student.accountBalance || 0);
    let balanceTone = '#10b981'; // Green
    let balanceBg = 'rgba(16, 185, 129, 0.1)';
    if (balance < 0) {
        balanceTone = '#ef4444'; // Red
        balanceBg = 'rgba(239, 68, 68, 0.1)';
    } else if (balance < 10000) {
        balanceTone = '#f59e0b'; // Orange
        balanceBg = 'rgba(245, 158, 11, 0.1)';
    }

    membershipInfo += `<span style="color: ${balanceTone}; font-weight: 600; font-size: 0.85em; background: ${balanceBg}; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; margin-right: 6px;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg> Баланс: ${formatScheduleAmount(balance)}
    </span>`;

    if (!student.activeMembership) {
        membershipInfo += `<span style="color: #ef4444; font-size: 0.85em; background: rgba(239, 68, 68, 0.1); padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg> Нет активного тарифа
        </span>`;
        return membershipInfo;
    }

    const averageCharge = getScheduleMembershipAverageCharge(student.activeMembership);
    const tariffLabel = getScheduleMembershipLabel(student.activeMembership);

    membershipInfo += `<span style="color: #cbd5e1; font-size: 0.85em; background: rgba(148, 163, 184, 0.1); padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid rgba(148, 163, 184, 0.2);">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
        ${escapeHtml(tariffLabel)}${averageCharge ? ` · ~ ${formatScheduleAmount(averageCharge)}` : ''}
    </span>`;

    return membershipInfo;
}

// Загрузить залы для модалки посещаемости
async function loadRoomsForAttendance(selectedRoomId = null) {
    try {
        const response = await fetch(`${API_URL}/rooms`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });

        const data = await response.json();
        const rooms = data.rooms || [];

        const select = document.getElementById('attendanceRoom');
        if (select) {
            select.innerHTML = '<option value="">Не указан</option>' +
                rooms.map(room =>
                    `<option value="${room._id}" ${String(room._id) === String(selectedRoomId) ? 'selected' : ''}>${room.name}</option>`
                ).join('');
        }
    } catch (error) {
        console.error('loadRoomsForAttendance error:', error);
    }
}
window.loadRoomsForAttendance = loadRoomsForAttendance;

function refreshAttendanceModalHeader(classData) {
    const isUserAdmin = typeof isAdmin === 'function' && isAdmin();

    if (isUserAdmin) {
        const d = classData.date instanceof Date ? classData.date : new Date(classData.date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const isoDate = `${year}-${month}-${day}`;

        document.getElementById('classInfo').innerHTML = `
            <div style="margin-bottom: 12px;"><strong>${classData.title}</strong></div>
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 12px 15px; font-size: 0.9rem; align-items: center;">
                <span style="opacity: 0.7;">Дата:</span>
                <input type="date" class="admin-input" id="attendanceDate" value="${isoDate}" style="margin: 0; padding: 4px 8px; font-size: 0.9rem; max-width: 180px;">
                
                <span style="opacity: 0.7;">Время:</span>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <input type="time" class="admin-input" id="attendanceStartTime" value="${classData.startTime}" style="margin: 0; padding: 4px 8px; font-size: 0.9rem; width: 90px;">
                    <span>-</span>
                    <input type="time" class="admin-input" id="attendanceEndTime" value="${classData.endTime}" style="margin: 0; padding: 4px 8px; font-size: 0.9rem; width: 90px;">
                </div>
                
                <span style="opacity: 0.7;">Зал:</span>
                <select class="admin-input" id="attendanceRoom" style="margin: 0; padding: 4px 8px; font-size: 0.9rem; max-width: 180px;">
                    <option value="">Загрузка залов...</option>
                </select>
                
                <span style="opacity: 0.7;">Статус:</span>
                <span>${formatClassStatus(classData.status)}</span>
            </div>
        `;

        // Загружаем список залов и выбираем текущий
        const currentRoomId = classData.roomId || classData.room?.id || classData.room?._id || '';
        loadRoomsForAttendance(currentRoomId);
    } else {
        const dateStr = classData.date instanceof Date
            ? classData.date.toLocaleDateString('ru-RU')
            : new Date(classData.date).toLocaleDateString('ru-RU');

        document.getElementById('classInfo').innerHTML = `
            <div style="margin-bottom: 8px;"><strong>${classData.title}</strong></div>
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 10px 15px; font-size: 0.9rem;">
                <span style="opacity: 0.7;">Дата:</span>
                <span>${dateStr}</span>
                <span style="opacity: 0.7;">Время:</span>
                <span>${classData.startTime} - ${classData.endTime}</span>
                <span style="opacity: 0.7;">Зал:</span>
                <span>${classData.roomName || classData.room?.name || 'Не указан'}</span>
                <span style="opacity: 0.7;">Преподаватель:</span>
                <span id="classInfoTeacher">${classData.teacherName || 'Не назначен'}</span>
                <span style="opacity: 0.7;">Статус:</span>
                <span>${formatClassStatus(classData.status)}</span>
            </div>
        `;
    }
}

async function persistAttendanceForClass(classId, savedClassData) {
    const newTeacherId = document.getElementById('attendanceTeacher')?.value;
    if (!newTeacherId) {
        throw new Error('Выберите преподавателя');
    }

    const oldTeacherId = savedClassData?.teacherId || null;
    if (newTeacherId !== oldTeacherId) {
        const teacherResponse = await fetch(`${API_URL}/classes/${classId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`,
            },
            body: JSON.stringify({ teacherId: newTeacherId }),
        });
        const teacherData = await teacherResponse.json().catch(() => ({}));
        if (!teacherResponse.ok) {
            throw new Error(teacherData.error || 'Не удалось обновить преподавателя');
        }
    }

    const attendanceEntries = Object.entries(currentAttendanceData);
    if (!attendanceEntries.length) {
        throw new Error('Список учеников пуст — нечего сохранять');
    }

    await Promise.all(attendanceEntries.map(([studentId, attended]) =>
        fetch(`${API_URL}/classes/${classId}/attendance`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`,
            },
            body: JSON.stringify({ studentId, attended }),
        }).then(async (response) => {
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || `Ошибка сохранения посещаемости (${response.status})`);
            }
            return data;
        }),
    ));
}

async function openAttendanceModal(classData) {
    currentBillingClassId = null;
    if (billingPreviewTimer) {
        clearTimeout(billingPreviewTimer);
        billingPreviewTimer = null;
    }
    const billingSection = document.getElementById('lessonBillingSection');
    if (billingSection) {
        billingSection.style.display = 'none';
        billingSection.innerHTML = '';
    }
    const approveButton = document.getElementById('approveClassBtn');
    if (approveButton) approveButton.textContent = 'ПОДТВЕРДИТЬ УРОК';
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

        classData = await hydrateClassDataFromServer(classData);
        currentClassForAttendance = classData;

        refreshAttendanceModalHeader(classData);
        renderLessonReportFields(classData);
        updateAttendanceActionButtons(classData);

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

        const deleteBtn = document.querySelector('#attendanceModal .delete-btn');
        if (deleteBtn) {
            deleteBtn.style.display = (typeof isAdmin === 'function' && isAdmin()) ? 'block' : 'none';
        }

        // Для индивидуальных занятий — загружаем ученика и показываем его в посещаемости
        if (!classData.groupId && classData.classType === 'individual') {
            await loadTeachersForAttendance(classData.teacherId);

            // Загружаем информацию о занятии с сервера (чтобы получить individualStudentId)
            try {
                const classResponse = await fetch(`${API_URL}/classes/${classData.id}`, {
                    headers: { 'Authorization': `Bearer ${getAuthToken()}` }
                });

                if (!classResponse.ok) throw new Error('Не удалось загрузить занятие');
                const classInfo = await classResponse.json();
                const freshClass = classInfo.class || classInfo;
                classData = {
                    ...classData,
                    ...freshClass,
                    attendees: freshClass.attendees || classData.attendees || [],
                };
                currentClassForAttendance = classData;
                renderLessonReportFields(classData);
                updateAttendanceActionButtons(classData);

                const individualStudentId = freshClass.individualStudentId || classInfo.individualStudentId;

                if (!individualStudentId) {
                    document.getElementById('attendanceList').innerHTML = `
                        <p style="text-align: center; opacity: 0.5; padding: 20px;">
                            Ученик не указан для этого индивидуального занятия
                        </p>
                    `;
                    return;
                }

                // Загружаем данные ученика
                const studentResponse = await fetch(`${API_URL}/students/${individualStudentId}`, {
                    headers: { 'Authorization': `Bearer ${getAuthToken()}` }
                });
                if (!studentResponse.ok) throw new Error('Не удалось загрузить ученика');
                const studentData = await studentResponse.json();
                const student = studentData.student || studentData;
                student._id = student._id || student.id;

                // Проверяем есть ли уже запись посещаемости
                const attendee = classData.attendees.find(a => {
                    const attendeeStudentId = typeof a.student === 'object' ? a.student._id : a.student;
                    return attendeeStudentId === student._id.toString();
                });
                const isPresent = attendee ? attendee.attended : false;
                currentAttendanceData[student._id] = isPresent;

                const membershipInfo = buildAttendanceMembershipInfo(student);

                document.getElementById('attendanceList').innerHTML = `
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 15px;
                        background: var(--admin-card);
                        color: var(--admin-text);
                        border-radius: 8px;
                        border-left: 3px solid ${isPresent ? '#28a745' : '#6c757d'};
                    " id="attendance-item-${student._id}">
                        <div class="student-row-link student-row-link--attendance" onclick="viewStudent('${student._id}')" title="Открыть профиль" style="flex: 1;">
                            <div class="student-row-link__info">
                                <div style="font-weight: 600; margin-bottom: 5px; color: var(--admin-text); display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                    ${student.name} ${student.lastName || ''}
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
            } catch (err) {
                console.error('Ошибка загрузки индивидуального ученика:', err);
                document.getElementById('attendanceList').innerHTML = `
                    <p style="text-align: center; opacity: 0.5; padding: 20px;">
                        Ошибка загрузки данных ученика
                    </p>
                `;
            }
            return;
        }

        // Если нет группы и не индивидуальное — просто заглушка
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
            const attendanceStatusLabels = {
                unmarked: 'Не отмечен',
                present: 'Присутствовал',
                late: 'Опоздал',
                excused_absence: 'Отсутствовал по уважительной причине',
                unexcused_absence: 'Отсутствовал без причины'
            };
            const attendanceStatus = attendee?.attendanceStatus || (isPresent ? 'present' : 'unmarked');
            const attendanceStatusLabel = attendanceStatusLabels[attendanceStatus] || attendanceStatus;

            const isFrozen = isStudentFrozen(student._id, classData.date);

            currentAttendanceData[student._id] = isPresent;

            const membershipInfo = buildAttendanceMembershipInfo(student);

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
                                ${isFrozen ? '<span style="color: #60a5fa; font-size: 0.85em; display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M12 12l8-8M12 12l-8 8M12 12l8 8M12 12l-8-8M4 12h16"></path></svg> ЗАМОРОЗКА</span>' : ''}
                            </div>
                            <div style="font-size: 0.9rem; opacity: 0.7; color: var(--admin-text); margin-bottom: 6px;">${student.phone || 'Нет номера'}</div>
                            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                                ${membershipInfo}
                                <span style="font-size:0.8rem; padding:2px 6px; border-radius:4px; background:rgba(255,255,255,0.08);">
                                    ${attendanceStatusLabel}
                                </span>
                            </div>
                            ${attendee?.teacherNote ? `<div style="margin-top:8px; font-size:0.85rem; opacity:0.8;">Заметка преподавателя: ${escapeHtml(attendee.teacherNote)}</div>` : ''}
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
    currentBillingClassId = null;
    if (billingPreviewTimer) {
        clearTimeout(billingPreviewTimer);
        billingPreviewTimer = null;
    }
    const billingSection = document.getElementById('lessonBillingSection');
    if (billingSection) {
        billingSection.style.display = 'none';
        billingSection.innerHTML = '';
    }
}

function getSelectedAttendanceStudentIds() {
    return Object.entries(currentAttendanceData)
        .filter(([, attended]) => attended)
        .map(([studentId]) => studentId);
}

function resetLessonBillingPreview() {
    currentBillingClassId = null;
    const billingSection = document.getElementById('lessonBillingSection');
    if (billingSection) {
        billingSection.style.display = 'none';
        billingSection.innerHTML = '';
    }
    const approveButton = document.getElementById('approveClassBtn');
    if (approveButton) approveButton.textContent = 'ПОДТВЕРДИТЬ УРОК';
}

function scheduleLessonBillingPreviewRefresh() {
    if (billingPreviewTimer) clearTimeout(billingPreviewTimer);
    billingPreviewTimer = setTimeout(() => {
        billingPreviewTimer = null;
        refreshLessonBillingPreview();
    }, 180);
}

async function refreshLessonBillingPreview() {
    if (!currentClassForAttendance?.id) return;

    const presentStudentIds = getSelectedAttendanceStudentIds();
    if (
        !presentStudentIds.length ||
        currentClassForAttendance.noOneAttended ||
        currentClassForAttendance.teacherOutcomeHint === 'not_held'
    ) {
        resetLessonBillingPreview();
        return;
    }

    try {
        await loadLessonBillingOptions(currentClassForAttendance.id, presentStudentIds, { scroll: false });
        currentBillingClassId = currentClassForAttendance.id;
        const approveButton = document.getElementById('approveClassBtn');
        if (approveButton) approveButton.textContent = 'ПОДТВЕРДИТЬ СПИСАНИЯ';
    } catch (error) {
        console.error('refreshLessonBillingPreview error:', error);
        resetLessonBillingPreview();
    }
}

// Переключить отметку посещаемости
function toggleAttendance(studentId) {
    currentAttendanceData[studentId] = !currentAttendanceData[studentId];

    const item = document.getElementById(`attendance-item-${studentId}`);
    if (item) {
        item.style.borderLeftColor = currentAttendanceData[studentId] ? '#28a745' : '#6c757d';
    }
    scheduleLessonBillingPreviewRefresh();
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
    scheduleLessonBillingPreviewRefresh();
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
    resetLessonBillingPreview();
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

        const isUserAdmin = typeof isAdmin === 'function' && isAdmin();
        let patchData = {};

        if (isUserAdmin) {
            const newDate = document.getElementById('attendanceDate')?.value;
            const newStartTime = document.getElementById('attendanceStartTime')?.value;
            const newEndTime = document.getElementById('attendanceEndTime')?.value;
            const newRoomId = document.getElementById('attendanceRoom')?.value;

            if (newStartTime && newEndTime) {
                const [sh, sm] = newStartTime.split(':').map(Number);
                const [eh, em] = newEndTime.split(':').map(Number);
                const computedDuration = (eh * 60 + em) - (sh * 60 + sm);
                if (computedDuration <= 0) {
                    toast.warning('Время окончания должно быть позже времени начала');
                    return;
                }
                if (computedDuration > 0 && computedDuration !== currentClassForAttendance.duration) {
                    patchData.duration = computedDuration;
                }
            }

            if (newDate) {
                const d = currentClassForAttendance.date instanceof Date ? currentClassForAttendance.date : new Date(currentClassForAttendance.date);
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                const oldDateStr = `${year}-${month}-${day}`;
                if (newDate !== oldDateStr) {
                    patchData.date = newDate;
                }
            }

            if (newStartTime && newStartTime !== currentClassForAttendance.startTime) {
                patchData.startTime = newStartTime;
            }
            if (newEndTime && newEndTime !== currentClassForAttendance.endTime) {
                patchData.endTime = newEndTime;
            }
            const oldRoomId = currentClassForAttendance.roomId || currentClassForAttendance.room?.id || currentClassForAttendance.room?._id || '';
            if (newRoomId !== undefined && newRoomId !== oldRoomId) {
                patchData.roomId = newRoomId || null;
            }
        }

        if (newTeacherId && newTeacherId !== (currentClassForAttendance.teacherId || null)) {
            patchData.teacherId = newTeacherId;
        }

        // ✅ ВАЖНО: Сохраняем данные ДО закрытия модалки!
        // closeAttendanceModal() очищает currentAttendanceData = {}
        const savedAttendanceData = { ...currentAttendanceData };

        // ⚡ OPTIMISTIC UI: Закрываем модалку СРАЗУ!
        closeAttendanceModal();
        toast.success('Сохранение...');

        // 🔥 СОХРАНЯЕМ В ФОНЕ (не блокируем UI)
        (async () => {
            try {
                // Обновляем данные занятия если изменились
                if (Object.keys(patchData).length > 0) {
                    const patchResponse = await fetch(`${API_URL}/classes/${classId}`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${getAuthToken()}`
                        },
                        body: JSON.stringify(patchData)
                    });
                    if (!patchResponse.ok) {
                        const errData = await patchResponse.json().catch(() => ({}));
                        throw new Error(errData.error || 'Не удалось обновить занятие');
                    }
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
                updatePendingReviewBadge();

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
                updatePendingReviewBadge();
                    }
                }, 1000);

                // Второе обновление badge с большей задержкой
                setTimeout(() => {
                    console.log('🔄 markNoOneAttended: Обновляем badge (попытка 2)');
                    if (typeof updatePendingAttendanceBadge === 'function') {
                        updatePendingAttendanceBadge();
                updatePendingReviewBadge();
                    }
                }, 2000);

                // Третье обновление badge для надежности
                setTimeout(() => {
                    console.log('🔄 markNoOneAttended: Обновляем badge (попытка 3)');
                    if (typeof updatePendingAttendanceBadge === 'function') {
                        updatePendingAttendanceBadge();
                updatePendingReviewBadge();
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
                updatePendingReviewBadge();
                }
            }, 2000);

            setTimeout(() => {
                console.log('🔄 markNoOneAttended: Обновляем badge (календарь не найден, попытка 2)');
                if (typeof updatePendingAttendanceBadge === 'function') {
                    updatePendingAttendanceBadge();
                updatePendingReviewBadge();
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

// Отметить, что занятие перенесено
async function postponeClass() {
    const classData = currentClassForAttendance;

    if (!classData || !classData.id) {
        toast.error('Ошибка: занятие не найдено');
        return;
    }

    const dateStr = classData.date.toLocaleDateString('ru-RU');

    if (await customConfirm(`Отметить занятие как перенесенное?\n\n${classData.title}\n${dateStr} ${classData.startTime}-${classData.endTime}\n\nСписанные абонементы будут возвращены, а занятие останется в календаре как перенесенное.`)) {
        closeAttendanceModal();

        try {
            const response = await fetch(`${API_URL}/classes/${classData.id}/postpone`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getAuthToken()}`
                }
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Ошибка при переносе занятия');
            }

            toast.success('Занятие успешно перенесено');

            if (calendar) {
                setTimeout(() => {
                    calendar.refetchEvents();
                }, 100);
            }
            updatePendingAttendanceBadge();
        } catch (error) {
            console.error('❌ postponeClass error:', error);
            toast.error(error.message);
        }
    }
}

window.postponeClass = postponeClass;

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

// Выбрать ученика для индивидуального занятия
function selectStudentForClass(studentId, studentName) {
    document.getElementById('classStudentId').value = studentId;
    document.getElementById('classStudentSearch').style.display = 'none';
    document.getElementById('classStudentResults').style.display = 'none';

    const selectedDiv = document.getElementById('classStudentSelected');
    document.getElementById('classStudentSelectedName').textContent = studentName.trim();
    selectedDiv.style.display = 'flex';
}
window.selectStudentForClass = selectStudentForClass;

// Очистить выбранного ученика
function clearSelectedStudent() {
    document.getElementById('classStudentId').value = '';
    const searchInput = document.getElementById('classStudentSearch');
    if (searchInput) {
        searchInput.value = '';
        searchInput.style.display = 'block';
    }
    const selectedDiv = document.getElementById('classStudentSelected');
    if (selectedDiv) selectedDiv.style.display = 'none';
    const resultsDiv = document.getElementById('classStudentResults');
    if (resultsDiv) resultsDiv.style.display = 'none';
}
window.clearSelectedStudent = clearSelectedStudent;

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

// Отобразить фильтры залов (мультивыбор)
function renderRoomFilters() {
    const container = document.getElementById('roomFilters');
    if (!container) return;

    container.innerHTML = `
        <button class="filter-btn active" data-room="all" onclick="filterByRoom('all')">Все залы</button>
        ${allRooms.map(room =>
        `<button class="filter-btn" data-room="${room._id}" onclick="filterByRoom('${room._id}')" style="border-color: ${room.color};">
                ${room.name}
            </button>`
    ).join('')}
        <span style="opacity:0.55; font-size:0.85rem; align-self:center; margin-left:4px;">можно выбрать несколько</span>
    `;
}

function updateRoomFilterButtons() {
    document.querySelectorAll('#roomFilters .filter-btn').forEach(btn => {
        const room = btn.dataset.room;
        if (room === 'all') {
            btn.classList.toggle('active', selectedRoomIds.size === 0);
        } else {
            btn.classList.toggle('active', selectedRoomIds.has(room));
        }
    });
}

// Фильтр по залам (toggle)
function filterByRoom(roomId) {
    if (roomId === 'all') {
        selectedRoomIds.clear();
    } else if (selectedRoomIds.has(roomId)) {
        selectedRoomIds.delete(roomId);
    } else {
        selectedRoomIds.add(roomId);
    }

    updateRoomFilterButtons();

    if (calendar) {
        calendar.refetchEvents();
    }
    refreshRoomOccupancy();
}

function formatOccupancyDate(d) {
    const dd = d instanceof Date ? d : new Date(d);
    const y = dd.getFullYear();
    const m = String(dd.getMonth() + 1).padStart(2, '0');
    const day = String(dd.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function occupancyEsc(text) {
    return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Панель загрузки кабинетов за выбранный день
async function refreshRoomOccupancy() {
    const panel = document.getElementById('roomOccupancyPanel');
    const cards = document.getElementById('roomOccupancyCards');
    if (!panel || !cards || !calendar) return;

    const date = formatOccupancyDate(calendar.getDate());
    const label = document.getElementById('occupancyDateLabel');
    if (label) {
        label.textContent = new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', {
            weekday: 'short',
            day: 'numeric',
            month: 'long'
        });
    }

    const roomIdsParam = selectedRoomIds.size > 0
        ? Array.from(selectedRoomIds).join(',')
        : 'all';

    cards.innerHTML = '<p style="opacity:0.5; margin:0;">Загрузка...</p>';
    panel.style.display = 'block';

    try {
        const response = await fetch(`${API_URL}/rooms/occupancy?date=${date}&roomIds=${roomIdsParam}`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });

        if (!response.ok) throw new Error('Ошибка загрузки');

        const data = await response.json();
        const rooms = data.rooms || [];

        if (!rooms.length) {
            cards.innerHTML = '<p style="opacity:0.5; margin:0;">Нет данных по кабинетам</p>';
            return;
        }

        cards.innerHTML = rooms.map(room => {
            const conflicts = room.conflicts?.length
                ? `<div style="color:#ef4444; font-size:0.8rem; margin-top:6px;">⚠ ${room.conflicts.length} пересечений по времени</div>`
                : '';
            const hours = Math.round((room.bookedMinutes / 60) * 10) / 10;
            return `
                <div style="border-left:4px solid ${room.color}; padding:12px 14px; background:rgba(255,255,255,0.04); border-radius:8px; min-width:200px; flex:1;">
                    <div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">
                        <strong>${occupancyEsc(room.name)}</strong>
                        <span style="font-weight:600; color:${room.color};">${room.utilizationPercent}%</span>
                    </div>
                    <div style="height:6px; background:rgba(255,255,255,0.12); border-radius:3px; margin:10px 0 8px;">
                        <div style="width:${room.utilizationPercent}%; height:100%; background:${room.color}; border-radius:3px;"></div>
                    </div>
                    <small style="opacity:0.65;">${room.classesCount} занятий · ${hours} ч из 13 ч</small>
                    ${conflicts}
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Room occupancy error:', error);
        cards.innerHTML = '<p style="color:#ef4444; margin:0;">Не удалось загрузить загрузку кабинетов</p>';
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
        isRecurringCheckbox.addEventListener('change', function (e) {
            const recurringFields = document.getElementById('recurringFields');
            recurringFields.style.display = e.target.checked ? 'block' : 'none';

            if (e.target.checked) {
                const endDate = new Date();
                endDate.setMonth(endDate.getMonth() + 3);
                document.getElementById('classRecurringEndDate').value = endDate.toISOString().split('T')[0];
            }
        });
    }

    // Показать/скрыть выбор ученика для индивидуальных занятий
    const classGroupSelect = document.getElementById('classGroup');
    if (classGroupSelect) {
        classGroupSelect.addEventListener('change', function () {
            const studentGroup = document.getElementById('classStudentGroup');
            if (studentGroup) {
                if (this.value === 'special_individual') {
                    studentGroup.style.display = 'block';
                } else {
                    studentGroup.style.display = 'none';
                    clearSelectedStudent();
                }
            }
        });
    }

    // Поиск ученика для индивидуального занятия
    let studentSearchTimeout = null;
    const studentSearchInput = document.getElementById('classStudentSearch');
    if (studentSearchInput) {
        studentSearchInput.addEventListener('input', function () {
            clearTimeout(studentSearchTimeout);
            const query = this.value.trim();
            const resultsDiv = document.getElementById('classStudentResults');

            if (query.length < 2) {
                resultsDiv.style.display = 'none';
                return;
            }

            studentSearchTimeout = setTimeout(async () => {
                try {
                    const response = await fetch(`${API_URL}/students?search=${encodeURIComponent(query)}&limit=10`, {
                        headers: { 'Authorization': `Bearer ${getAuthToken()}` }
                    });
                    const data = await response.json();
                    const students = data.students || [];

                    if (students.length === 0) {
                        resultsDiv.innerHTML = '<div style="padding: 10px 12px; opacity: 0.5; font-size: 0.85em;">Ученик не найден</div>';
                    } else {
                        resultsDiv.innerHTML = students.map(s => `
                            <div onclick="selectStudentForClass('${s._id}', '${(s.name || '').replace(/'/g, "\\'")} ${(s.lastName || '').replace(/'/g, "\\'")}')" 
                                 style="padding: 10px 12px; cursor: pointer; font-size: 0.9em; border-bottom: 1px solid rgba(255,255,255,0.06); transition: background 0.15s;"
                                 onmouseover="this.style.background='rgba(235,77,119,0.1)'" onmouseout="this.style.background='none'">
                                <div style="font-weight: 600;">${s.name} ${s.lastName || ''}</div>
                                <div style="font-size: 0.8em; opacity: 0.6;">${s.phone || ''}</div>
                            </div>
                        `).join('');
                    }
                    resultsDiv.style.display = 'block';
                } catch (err) {
                    console.error('Student search error:', err);
                }
            }, 300);
        });

        // Скрываем результаты при клике вне
        document.addEventListener('click', function (e) {
            const resultsDiv = document.getElementById('classStudentResults');
            if (resultsDiv && !e.target.closest('#classStudentGroup')) {
                resultsDiv.style.display = 'none';
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
                toast.warning('Заполните все обязательные поля');
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

                // Добавляем individualStudentId для индивидуальных занятий
                if (groupId === 'special_individual') {
                    const studentId = document.getElementById('classStudentId')?.value;
                    if (studentId) {
                        body.individualStudentId = studentId;
                    }
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
window.openGenerateScheduleModal = async function () {
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
window.closeGenerateScheduleModal = function () {
    const modal = document.getElementById('generateScheduleModal');
    if (modal) {
        modal.classList.remove('show');
        // Модалка генерации расписания закрыта
    }
}

// Генерация занятий из расписания групп
window.generateSchedule = async function (period) {
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

window.openBulkDeleteClassesModal = async function () {
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

window.closeBulkDeleteClassesModal = function () {
    const modal = document.getElementById('bulkDeleteClassesModal');
    if (modal) modal.classList.remove('show');
};

window.submitBulkDeleteClasses = async function () {
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
window.openPracticeModal = async function (classData) {
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
window.closePracticeModal = function () {
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
window.addGroupToPractice = function () {
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
window.removeGroupFromPractice = function (index) {
    currentPracticeGroups.splice(index, 1);
    renderPracticeGroups();
}

// Удалить практику
window.deletePractice = async function () {
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

// Формат статуса урока для UI
function formatClassStatus(status) {
    const labels = {
        scheduled: 'Запланирован',
        started: 'Начат',
        pending_admin_review: 'На подтверждении',
        completed: 'Подтверждён',
        cancelled: 'Отменён / перенесён',
        not_filled: 'Не заполнен'
    };
    return labels[status] || status || '—';
}

function renderLessonReportFields(classData) {
    const section = document.getElementById('lessonReportSection');
    const fields = {
        lessonTopic: classData.topic || '',
        lessonGoals: classData.lessonGoals || '',
        lessonSummary: classData.lessonSummary || '',
        lessonHomework: classData.homeworkDraft || '',
        lessonNextFocus: classData.nextLessonFocus || '',
        lessonMaterials: Array.isArray(classData.materials)
            ? classData.materials.map(item => item.url || item.title || '').filter(Boolean).join('\n')
            : '',
        lessonTeacherComment: classData.teacherComment || ''
    };

    if (!section || classData.isPractice) {
        if (section) section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    const closed = ['completed', 'cancelled'].includes(classData.status);
    for (const [id, value] of Object.entries(fields)) {
        const input = document.getElementById(id);
        if (input) {
            input.value = value;
            input.disabled = closed;
        }
    }
}

function updateAttendanceActionButtons(classData) {
    const approveBtn = document.getElementById('approveClassBtn');
    const hintEl = document.getElementById('approveClassHint');
    if (!approveBtn) return;

    const canApprove = typeof isAdmin === 'function' && isAdmin()
        && !classData.isPractice
        && classData.status === 'pending_admin_review';

    approveBtn.style.display = canApprove ? 'block' : 'none';
    approveBtn.disabled = !canApprove;
    approveBtn.title = canApprove
        ? 'Подтвердить урок и списать занятия'
        : 'Доступно после отправки отчёта преподавателем';

    if (hintEl) {
        if (canApprove) {
            hintEl.style.display = 'none';
            hintEl.textContent = '';
        } else if (typeof isAdmin === 'function' && isAdmin() && !classData.isPractice) {
            hintEl.style.display = 'block';
            hintEl.textContent = classData.status === 'pending_admin_review'
                ? ''
                : 'Подтверждение станет доступно, когда преподаватель отправит отчёт по уроку из приложения.';
        } else {
            hintEl.style.display = 'none';
            hintEl.textContent = '';
        }
    }
}

async function submitLessonReview() {
    if (!currentClassForAttendance?.id) return;

    const topic = document.getElementById('lessonTopic')?.value?.trim() || '';
    const homeworkDraft = document.getElementById('lessonHomework')?.value?.trim() || '';

    try {
        const response = await fetch(`${API_URL}/classes/${currentClassForAttendance.id}/submit-review`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({ topic, homeworkDraft, teacherOutcomeHint: 'held' })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Ошибка отправки');

        toast.success('Урок отправлен на подтверждение админу');
        closeAttendanceModal();
        if (calendar) calendar.refetchEvents();
        updatePendingReviewBadge();
    } catch (error) {
        console.error('submitLessonReview error:', error);
        toast.error(error.message || 'Не удалось отправить на подтверждение');
    }
}

async function approveClass() {
    if (!currentClassForAttendance?.id) return;

    const classId = currentClassForAttendance.id;
    const savedClassData = { ...currentClassForAttendance };

    let freshClass = await hydrateClassDataFromServer(savedClassData);
    currentClassForAttendance = freshClass;
    renderLessonReportFields(freshClass);
    updateAttendanceActionButtons(freshClass);

    if (freshClass.status !== 'pending_admin_review') {
        toast.error('Сначала преподаватель должен отправить отчёт по уроку в приложении');
        return;
    }

    const topic = document.getElementById('lessonTopic')?.value?.trim();
    const lessonGoals = document.getElementById('lessonGoals')?.value?.trim();
    const lessonSummary = document.getElementById('lessonSummary')?.value?.trim();
    const homeworkDraft = document.getElementById('lessonHomework')?.value?.trim();
    const nextLessonFocus = document.getElementById('lessonNextFocus')?.value?.trim();
    const teacherComment = document.getElementById('lessonTeacherComment')?.value?.trim();
    const materials = (document.getElementById('lessonMaterials')?.value || '')
        .split('\n').map(url => url.trim()).filter(Boolean)
        .map(url => ({ type: 'link', url, title: url }));

    const effectiveTopic = topic || freshClass.topic || '';
    const effectiveSummary = lessonSummary || freshClass.lessonSummary || '';
    if (!isSuperAdmin() && freshClass.teacherOutcomeHint !== 'not_held' && (!effectiveTopic.trim() || !effectiveSummary.trim())) {
        toast.error('Для подтверждения нужны тема и итог урока от преподавателя');
        return;
    }

    const approveBtn = document.getElementById('approveClassBtn');
    if (approveBtn) approveBtn.disabled = true;

    try {
        if (!freshClass.noOneAttended && freshClass.teacherOutcomeHint !== 'not_held') {
            await persistAttendanceForClass(classId, savedClassData);
        }

        const presentStudentIds = getSelectedAttendanceStudentIds();
        if (
            !freshClass.noOneAttended &&
            freshClass.teacherOutcomeHint !== 'not_held' &&
            presentStudentIds.length &&
            currentBillingClassId !== classId
        ) {
            await loadLessonBillingOptions(classId, presentStudentIds);
            currentBillingClassId = classId;
            if (approveBtn) {
                approveBtn.textContent = 'ПОДТВЕРДИТЬ СПИСАНИЯ';
                approveBtn.disabled = false;
            }
            toast.info('Проверьте абонемент и стоимость для каждого ученика');
            return;
        }

        const billingDecisions = collectLessonBillingDecisions();
        const chargeTotal = billingDecisions.reduce((sum, item) => sum + item.amount, 0);
        const confirmed = await customConfirm(
            `Подтвердить урок и выполнить выбранные списания?\n\nС балансов учеников будет списано: ${chargeTotal.toLocaleString('ru-RU')} ₸. При нехватке средств баланс станет отрицательным.`
        );
        if (!confirmed) return;

        const response = await fetch(`${API_URL}/classes/${classId}/approve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({
                deduct: true,
                topic: effectiveTopic || undefined,
                lessonGoals: lessonGoals || freshClass.lessonGoals || undefined,
                lessonSummary: effectiveSummary || undefined,
                homeworkDraft: homeworkDraft || freshClass.homeworkDraft || undefined,
                nextLessonFocus: nextLessonFocus || freshClass.nextLessonFocus || undefined,
                materials,
                teacherComment: teacherComment || freshClass.teacherComment || undefined,
                billingDecisions
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Ошибка подтверждения');

        const deducted = (data.deductions || []).filter(d => d.deducted).length;
        const debtCreated = (data.deductions || []).filter(d => d.debtCreated).length;
        const message = [
            'Урок подтверждён',
            deducted ? `абонементов списано: ${deducted}` : '',
            debtCreated ? `долгов создано: ${debtCreated}` : ''
        ].filter(Boolean).join('. ');
        toast.success(message);
        closeAttendanceModal();
        if (calendar) calendar.refetchEvents();
        updatePendingAttendanceBadge();
        updatePendingReviewBadge();
    } catch (error) {
        console.error('approveClass error:', error);
        toast.error(error.message || 'Не удалось подтвердить урок');
    } finally {
        if (approveBtn) approveBtn.disabled = false;
    }
}

async function loadLessonBillingOptions(classId, studentIds = [], options = {}) {
    const section = document.getElementById('lessonBillingSection');
    if (!section) return;

    const uniqueStudentIds = Array.from(new Set(studentIds.filter(Boolean)));
    const params = uniqueStudentIds.length
        ? `?studentIds=${encodeURIComponent(uniqueStudentIds.join(','))}`
        : '';

    const response = await fetch(`${API_URL}/classes/${classId}/billing-options${params}`, {
        headers: { 'Authorization': `Bearer ${getAuthToken()}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось подготовить списания');

    const students = data.students || [];
    section.style.display = 'block';
    section.innerHTML = `
        <div style="padding:16px; border:1px solid rgba(245,158,11,0.35); border-radius:12px; background:rgba(245,158,11,0.08);">
            <div style="font-weight:700; margin-bottom:5px;">ПРОВЕРЬТЕ СПИСАНИЯ ПЕРЕД ПОДТВЕРЖДЕНИЕМ</div>
            <div style="font-size:0.86rem; opacity:0.75; margin-bottom:14px;">
                Тариф нужен только для подстановки средней стоимости урока. Списание всегда идёт с общего денежного баланса ученика.
            </div>
            <div style="display:grid; gap:12px;">
                ${students.length ? students.map(renderLessonBillingStudent).join('') : '<div style="opacity:0.7;">Нет присутствовавших учеников — списаний не будет.</div>'}
            </div>
        </div>
    `;
    bindLessonBillingAmountSync(section);
    if (options.scroll !== false) {
        section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function bindLessonBillingAmountSync(section) {
    section.querySelectorAll('.lesson-billing-membership').forEach(select => {
        select.addEventListener('change', () => {
            const selected = select.selectedOptions?.[0];
            const price = Number(selected?.dataset?.price || 0);
            const amountInput = select.closest('.lesson-billing-row')?.querySelector('.lesson-billing-amount');
            if (amountInput && price > 0) {
                amountInput.value = price;
            }
        });
    });
}

function renderLessonBillingStudent(student) {
    const options = (student.memberships || []).map(membership => `
        <option value="${membership.id}" data-price="${membership.lessonPrice}" ${membership.id === student.suggestedMembershipId ? 'selected' : ''}>
            ${escapeHtml(membership.name)} · ${escapeHtml(membership.groupName)} · ~ ${formatScheduleAmount(membership.lessonPrice)}
        </option>
    `).join('');
    const currentDebt = Math.max(0, -(student.accountBalance || 0));

    return `
        <div class="lesson-billing-row" data-student-id="${student.studentId}" style="padding:12px; border-radius:10px; background:var(--admin-card); border:1px solid rgba(255,255,255,0.08);">
            <div style="display:flex; justify-content:space-between; gap:10px; margin-bottom:9px;">
                <strong>${escapeHtml(student.name)}</strong>
                <span style="font-size:0.82rem; color:${currentDebt > 0 ? '#ef4444' : 'inherit'};">Текущий баланс: ${(student.accountBalance || 0).toLocaleString('ru-RU')} ₸</span>
            </div>
            <div style="display:grid; grid-template-columns:minmax(0,1fr) 150px; gap:10px;">
                <select class="admin-input lesson-billing-membership">
                    ${options}
                    <option value="" ${student.suggestedMembershipId ? '' : 'selected'}>Не использовать тариф для автосписания</option>
                </select>
                <label style="display:flex; align-items:center; gap:6px;">
                    <input class="admin-input lesson-billing-amount" type="number" min="0" step="100" value="${student.suggestedAmount || 0}" style="min-width:0;">
                    <span>₸</span>
                </label>
            </div>
        </div>
    `;
}

function collectLessonBillingDecisions() {
    return Array.from(document.querySelectorAll('.lesson-billing-row')).map(row => ({
        studentId: row.dataset.studentId,
        membershipId: row.querySelector('.lesson-billing-membership')?.value || null,
        amount: Math.max(0, Math.round(Number(row.querySelector('.lesson-billing-amount')?.value) || 0))
    }));
}

async function updatePendingReviewBadge() {
    try {
        const badge = document.getElementById('pendingReviewBadge');
        const sidebarBadge = document.getElementById('lessonReviewSidebarBadge');

        if (typeof isAdmin !== 'function' || !isAdmin()) {
            if (badge) badge.style.display = 'none';
            if (sidebarBadge) sidebarBadge.style.display = 'none';
            return;
        }

        const response = await fetch(`${API_URL}/classes/pending-review/count`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });

        if (!response.ok) return;

        const data = await response.json();
        const count = data.count || 0;

        [badge, sidebarBadge].forEach(el => {
            if (!el) return;
            if (count > 0) {
                el.textContent = count;
                el.style.display = 'flex';
            } else {
                el.style.display = 'none';
            }
        });
    } catch (error) {
        console.error('Update pending review badge error:', error);
    }
}

window.submitLessonReview = submitLessonReview;
window.approveClass = approveClass;
window.updatePendingReviewBadge = updatePendingReviewBadge;
window.formatClassStatus = formatClassStatus;

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
window.openAttendanceModal = openAttendanceModal;
window.refreshRoomOccupancy = refreshRoomOccupancy;
window.filterByRoom = filterByRoom;

// Вызываем инициализацию
setTimeout(() => {
    initPracticeForm();
}, 1000);
