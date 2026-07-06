// =====================================================
// SCHEDULE MODULE - Календарь и занятия
// =====================================================

let calendar = null;
let allGroups = [];
let allRooms = [];
const selectedRoomIds = new Set();
const scheduleFilters = {
    teacherId: 'all',
    roomId: 'all',
    subject: 'all',
    classType: 'all',
    status: 'all',
};
let scheduleFilterOptionsLoaded = false;
let selectedScheduleClass = null;
let currentClassForAttendance = null;
let currentAttendanceData = {};
let currentAbsenceData = {};
let allStudentsForAttendance = [];
let currentBillingClassId = null;
let billingPreviewTimer = null;

let isGeneratingSchedule = false;
let isClassSubmitting = false;
let isApprovingClass = false;
let isLifecycleSubmitting = false;
let isDeletingClass = false;

const SCHEDULE_GRID_START_MINUTES = 8 * 60 + 15;
const SCHEDULE_GRID_STEP_MINUTES = 45;

function scheduleTimeToMinutes(value) {
    const [hours, minutes] = String(value || '').split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return hours * 60 + minutes;
}

function scheduleMinutesToTime(totalMinutes) {
    const normalized = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
    const hours = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function scheduleDefaultEndTime(startTime) {
    const startMinutes = scheduleTimeToMinutes(startTime);
    if (startMinutes === null) return '';
    return scheduleMinutesToTime(startMinutes + SCHEDULE_GRID_STEP_MINUTES);
}

function isScheduleGridTime(startTime) {
    const startMinutes = scheduleTimeToMinutes(startTime);
    if (startMinutes === null) return false;
    return startMinutes >= SCHEDULE_GRID_START_MINUTES
        && (startMinutes - SCHEDULE_GRID_START_MINUTES) % SCHEDULE_GRID_STEP_MINUTES === 0;
}

function generateIdempotencyKey() {
    return 'key-' + Date.now() + '-' + Math.random().toString(36).substring(2, 15);
}

function getScheduleStatusMeta(status, eventEnd) {
    const isOverdue = ['scheduled', 'started', 'not_filled'].includes(status)
        && eventEnd
        && eventEnd.getTime() < Date.now();

    if (isOverdue || status === 'not_filled') {
        return { key: 'overdue', label: 'Просрочен / не заполнен', short: 'Просрочен' };
    }

    const meta = {
        completed: { key: 'completed', label: 'Урок принят', short: 'Принят' },
        pending_admin_review: { key: 'pending', label: 'Ждет проверки администратора', short: 'Проверить' },
        started: { key: 'started', label: 'Урок начат', short: 'Начат' },
        cancelled: { key: 'cancelled', label: 'Урок отменен', short: 'Отменен' },
        scheduled: { key: 'scheduled', label: 'Запланирован', short: 'План' },
    };

    return meta[status] || meta.scheduled;
}

// Инициализация календаря
function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl || calendar) return;

    const isMobile = window.innerWidth <= 768;

    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'timeGridWeek',
        locale: 'ru',
        firstDay: 1,
        headerToolbar: isMobile ? {
            left: 'prev,next today',
            center: 'title',
            right: 'timeGridWeek,timeGridDay'
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
                left: 'prev,next today',
                center: 'title',
                right: 'timeGridWeek,timeGridDay'
            } : {
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay'
            });
        },
        eventTimeFormat: {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        },
        displayEventEnd: true,
        slotMinTime: '08:15:00',
        slotMaxTime: '22:00:00',
        slotDuration: '00:45:00',
        snapDuration: '00:45:00',
        slotLabelInterval: '00:45:00',
        slotEventOverlap: false,
        eventMaxStack: 4,
        allDaySlot: false,
        nowIndicator: true,
        height: 'auto',

        editable: true,
        droppable: false,
        events: fetchCalendarClasses,
        eventDrop: handleEventDrop,
        eventClick: handleEventClick,
        dateClick: handleDateClick,
        datesSet: function () {
            closeScheduleDetails();
        },
        eventDidMount: function (info) {
            info.el.title = '';
            info.el.setAttribute('aria-label', `${info.event.extendedProps.startTime}–${info.event.extendedProps.endTime}, ${info.event.extendedProps.roomName}`);
            info.el.style.setProperty('--teacher-color', info.event.backgroundColor || '#6B7280');
        },
        eventContent: function (arg) {
            const props = arg.event.extendedProps;
            const status = props.status;
            const statusMeta = getScheduleStatusMeta(status, arg.event.end);
            const statusHtml = `<span class="schedule-card-badge status-${statusMeta.key}" title="${escapeHtml(statusMeta.label)}"><span class="badge-text">${escapeHtml(statusMeta.short)}</span></span>`;

            const roomName = props.roomShortName && props.roomShortName !== 'Без кабинета'
                ? props.roomShortName.replace('Каб. ', '') 
                : '—';

            let titleHtml = '';
            if (props.classType === 'individual' && props.individualStudentName) {
                const parts = props.individualStudentName.split(' ');
                const first = parts[0] || '';
                const last = parts[1] || '';
                const compactName = last ? `${first} ${last.charAt(0)}.` : first;
                titleHtml = `<span class="schedule-event-card__prefix">Инд:</span> <span class="schedule-event-card__name">${escapeHtml(compactName)}</span>`;
            } else if (props.isPractice) {
                const cleanTitle = arg.event.title.replace(/^Практика:\s*/, '').replace(/^Практика\s*/, '');
                titleHtml = `<span class="schedule-event-card__prefix">Практика:</span> <span class="schedule-event-card__name">${escapeHtml(cleanTitle)}</span>`;
            } else {
                titleHtml = `<span class="schedule-event-card__name">${escapeHtml(arg.event.title)}</span>`;
            }

            return {
                html: `
                    <div class="schedule-event-card status-${statusMeta.key} ${status === 'cancelled' ? 'is-cancelled' : ''}">
                        <div class="schedule-event-card__header">
                            <span class="schedule-event-card__time"><span>${props.startTime}</span><span class="time-separator">–</span><span class="time-end">${props.endTime}</span></span>
                            <span class="schedule-event-card__room-badge" title="${escapeHtml(props.roomName || 'Без кабинета')}">${escapeHtml(roomName)}</span>
                        </div>
                        <div class="schedule-event-card__body">
                            <div class="schedule-event-card__title" title="${escapeHtml(arg.event.title)}">${titleHtml}</div>
                        </div>
                        <div class="schedule-event-card__footer">
                            ${statusHtml}
                        </div>
                    </div>
                `
            };
        }
    });

    calendar.render();
}

function populateScheduleFilterOptions(filters = {}) {
    const setOptions = (id, items, placeholder, valueKey = 'id', labelKey = 'name') => {
        const select = document.getElementById(id);
        if (!select) return;
        const current = select.value || 'all';
        select.innerHTML = `<option value="all">${placeholder}</option>` + (items || []).map(item =>
            `<option value="${escapeHtml(String(item[valueKey]))}">${escapeHtml(String(item[labelKey]))}</option>`
        ).join('');
        select.value = Array.from(select.options).some(option => option.value === current) ? current : 'all';
    };
    setOptions('scheduleTeacherFilter', filters.teachers, 'Все преподаватели');
    setOptions('scheduleRoomFilter', filters.rooms, 'Все кабинеты');
    setOptions(
        'scheduleSubjectFilter',
        (filters.subjects || []).map(value => ({ id: value, name: value })),
        'Все предметы'
    );
    scheduleFilterOptionsLoaded = true;
}

function scheduleRoomLabel(name) {
    const text = String(name || '').trim();
    const cabinet = text.match(/(?:кабинет|каб\.?|\/)\s*(\d+)|(\d+)\s*(?:кабинет|каб\.?)/i);
    const number = cabinet?.[1] || cabinet?.[2];
    return number ? `Каб. ${number}` : (text || 'Без кабинета');
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

        const query = new URLSearchParams();
        Object.entries(scheduleFilters).forEach(([key, value]) => {
            if (value && value !== 'all') query.set(key, value);
        });
        if (query.toString()) url += `&${query.toString()}`;

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
        populateScheduleFilterOptions(data.filters || {});
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

            const finalColor = cls.teacherColor || cls.backgroundColor || '#6B7280';

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
                const first = String(cls.individualStudent.name || '').trim();
                const last = String(cls.individualStudent.lastName || '').trim();
                const compactName = last ? `${last} ${first.charAt(0)}.` : first;
                displayTitle = `Инд: ${compactName}`;
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
                    teacherName: formatSchedulePersonName(cls.teacher, 'Не назначен'),
                    roomId: cls.room?._id || null,
                    roomName: cls.room?.name || 'Не указан',
                    roomColor: cls.room?.color || '#eb4d77',
                    roomShortName: scheduleRoomLabel(cls.room?.name),
                    status: cls.status,
                    needsConfirmation: Boolean(cls.needsConfirmation),
                    lessonSubject: cls.lessonSubject || cls.title,
                    lessonType: cls.lessonType || cls.classType || 'group',
                    audience: cls.audience || null,
                    startTime: cls.startTime,
                    endTime: cls.endTime,
                    duration: cls.duration,
                    teacherColor: finalColor,
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
                    individualStudentName: cls.individualStudent ? formatSchedulePersonName(cls.individualStudent) : null,
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
        toast.error('Не удалось перенести занятие');
        info.revert();
    }
}

function classDataFromCalendarEvent(event) {
    return {
        id: event.id,
        title: event.title,
        groupId: event.extendedProps.groupId,
        groupName: event.extendedProps.groupName,
        teacherId: event.extendedProps.teacherId,
        teacherName: event.extendedProps.teacherName,
        date: event.start,
        startTime: event.extendedProps.startTime || event.start.toTimeString().slice(0, 5),
        endTime: event.extendedProps.endTime || (event.end ? event.end.toTimeString().slice(0, 5) : '19:30'),
        status: event.extendedProps.status,
        topic: event.extendedProps.topic,
        lessonGoals: event.extendedProps.lessonGoals,
        lessonSummary: event.extendedProps.lessonSummary,
        homeworkDraft: event.extendedProps.homeworkDraft,
        nextLessonFocus: event.extendedProps.nextLessonFocus,
        materials: event.extendedProps.materials,
        teacherComment: event.extendedProps.teacherComment,
        noOneAttended: event.extendedProps.noOneAttended,
        notes: event.extendedProps.notes,
        attendees: event.extendedProps.attendees || [],
        roomName: event.extendedProps.roomName,
        roomId: event.extendedProps.roomId,
        isPractice: event.extendedProps.isPractice,
        practiceGroups: event.extendedProps.practiceGroups || [],
        individualStudentName: event.extendedProps.individualStudentName || null,
        individualStudentId: event.extendedProps.audience?.type === 'student' ? event.extendedProps.audience.id : null,
        audience: event.extendedProps.audience || null,
        lessonSubject: event.extendedProps.lessonSubject || event.title,
        lessonType: event.extendedProps.lessonType || event.extendedProps.classType || 'group',
        needsConfirmation: event.extendedProps.needsConfirmation,
        classType: event.extendedProps.classType || 'group'
    };
}

function scheduleTypeLabel(value) {
    return ({
        individual: 'Индивидуальный',
        group: 'Групповой',
        practice: 'Открытая практика',
        trial: 'Пробный урок',
        theory: 'Теоретический урок',
        rent: 'Аренда кабинета',
    })[value] || 'Занятие';
}

function closeScheduleDetails() {
    const popover = document.getElementById('scheduleDetailPopover');
    if (!popover) return;
    popover.classList.remove('is-open');
    popover.setAttribute('aria-hidden', 'true');
    selectedScheduleClass = null;
}

function renderScheduleDetails(classData) {
    const popover = document.getElementById('scheduleDetailPopover');
    if (!popover) return;
    const status = formatClassStatus(classData.status);
    const audience = classData.audience?.name || classData.individualStudentName || classData.groupName || 'Не указано';
    const audienceAgeBadge = classData.audience?.type === 'student' && typeof renderStudentAgeBadge === 'function'
        ? renderStudentAgeBadge(classData.audience.dateOfBirth)
        : '';
    const audienceAction = classData.audience?.type === 'student' && classData.audience.id
        ? `data-schedule-action="student" data-id="${escapeHtml(classData.audience.id)}"`
        : '';
    const teacherAction = classData.teacherId ? `data-schedule-action="teacher" data-id="${escapeHtml(classData.teacherId)}"` : '';
    const roomAction = classData.roomId ? `data-schedule-action="room" data-id="${escapeHtml(classData.roomId)}"` : '';
    const confirmationAction = classData.needsConfirmation ? 'data-schedule-action="confirmation"' : '';
    const canCancel = !['completed', 'cancelled'].includes(classData.status);

    popover.innerHTML = `
        <div class="schedule-detail-head">
            <div>
                <span class="schedule-detail-type">${escapeHtml(scheduleTypeLabel(classData.lessonType))}</span>
                <h3>${escapeHtml(classData.lessonSubject || classData.title)}</h3>
            </div>
            <button type="button" class="schedule-detail-close" data-schedule-action="close" aria-label="Закрыть">×</button>
        </div>
        <div class="schedule-detail-grid">
            <span>Время</span><strong>${escapeHtml(classData.startTime)}–${escapeHtml(classData.endTime)} · ${classData.duration || '—'} мин</strong>
            <span>Кабинет</span><button type="button" ${roomAction}>${escapeHtml(classData.roomName || 'Не указан')}</button>
            <span>Преподаватель</span><button type="button" ${teacherAction}>${escapeHtml(classData.teacherName || 'Не назначен')}</button>
            <span>${classData.audience?.type === 'student' ? 'Ученик' : 'Группа'}</span><button type="button" ${audienceAction}>${escapeHtml(audience)}${audienceAgeBadge}</button>
            <span>Статус</span><button type="button" class="schedule-status-link status-${escapeHtml(classData.status)}" ${confirmationAction}>${escapeHtml(status)}</button>
        </div>
        <div class="schedule-detail-actions">
            <button type="button" class="schedule-action is-primary" data-schedule-action="open">Открыть урок</button>
            ${!['completed', 'cancelled'].includes(classData.status) ? '<button type="button" class="schedule-action" data-schedule-action="conduct">Провести</button>' : ''}
            ${canCancel ? '<button type="button" class="schedule-action is-danger" data-schedule-action="cancel">Отменить</button>' : ''}
            ${classData.needsConfirmation ? '<button type="button" class="schedule-action is-warning" data-schedule-action="confirmation">К подтверждению</button>' : ''}
        </div>
    `;
    popover.querySelectorAll('[data-schedule-action]').forEach(button => {
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            const action = button.dataset.scheduleAction;
            const id = button.dataset.id;
            if (action === 'close') return closeScheduleDetails();
            if (action === 'student') return openScheduleStudent(id);
            if (action === 'teacher') return openScheduleTeacher(id);
            if (action === 'room') return openScheduleForRoom(id);
            if (action === 'confirmation') return openScheduleConfirmation();
            if (action === 'open') return openSelectedScheduleLesson(classData);
            if (action === 'conduct') return conductSelectedScheduleLesson(classData);
            if (action === 'cancel') return cancelSelectedScheduleLesson(classData);
        });
    });
    popover.classList.add('is-open');
    popover.setAttribute('aria-hidden', 'false');
}

// Клик по занятию
async function handleEventClick(info) {
    info.jsEvent?.preventDefault();
    info.jsEvent?.stopPropagation();
    selectedScheduleClass = classDataFromCalendarEvent(info.event);
    renderScheduleDetails(selectedScheduleClass);
}

async function openSelectedScheduleLesson(classData = selectedScheduleClass) {
    if (!classData?.id) {
        toast.error('Не удалось открыть урок. Обновите расписание и попробуйте снова.');
        return;
    }
    const lessonData = { ...classData };
    closeScheduleDetails();
    currentClassForAttendance = lessonData;
    if (lessonData.isPractice) await openPracticeModal(lessonData);
    else await openAttendanceModal(lessonData);
}

async function conductSelectedScheduleLesson(classData = selectedScheduleClass) {
    return openSelectedScheduleLesson(classData);
}

function showPostponeResultToast(data, fallback = 'Урок отменен') {
    const outcomes = Array.isArray(data?.outcomes) ? data.outcomes : [];
    const messages = outcomes
        .map(item => String(item?.message || '').trim())
        .filter(Boolean);

    if (!messages.length) {
        toast.success(data?.message || fallback);
        return;
    }

    const uniqueMessages = [...new Set(messages)];
    const hasNotice = outcomes.some(item => item?.severity === 'info' || item?.severity === 'warning');
    const text = [
        data?.message || fallback,
        ...uniqueMessages.slice(0, 3),
        uniqueMessages.length > 3 ? `Еще ${uniqueMessages.length - 3} учеников обработано.` : null,
    ].filter(Boolean).join('<br>');

    if (hasNotice) toast.warning(text, 8000);
    else toast.success(text, 6500);
}

async function cancelSelectedScheduleLesson(classData = selectedScheduleClass) {
    if (!classData?.id) {
        toast.error('Не удалось отменить урок. Обновите расписание и попробуйте снова.');
        return;
    }
    if (isLifecycleSubmitting) return;

    const lessonId = classData.id;
    const startTime = classData.startTime || '';
    const endTime = classData.endTime || '';

    const confirmed = await customConfirm(
        `Отменить урок ${startTime}–${endTime}?`,
        { icon: 'warning', yesText: 'Отменить урок', noText: 'Назад' }
    );
    if (!confirmed) return;

    isLifecycleSubmitting = true;
    closeScheduleDetails(); // Закрываем модальное окно деталей до отправки запроса

    try {
        const response = await fetch(`${API_URL}/classes/${lessonId}/postpone`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`,
                'X-Idempotency-Key': generateIdempotencyKey()
            }
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Не удалось отменить урок');
        showPostponeResultToast(data, 'Урок отменен');
        calendar?.refetchEvents();
    } catch (error) {
        toast.error(error.message || 'Не удалось отменить урок');
    } finally {
        isLifecycleSubmitting = false;
    }
}

function openScheduleStudent(studentId) {
    closeScheduleDetails();
    if (typeof closeAttendanceModal === 'function') closeAttendanceModal();
    if (typeof openStudentProfileSafe === 'function') {
        openStudentProfileSafe(studentId);
    } else if (typeof viewStudent === 'function') {
        viewStudent(studentId);
    }
}

function openScheduleTeacher(teacherId) {
    closeScheduleDetails();
    if (typeof openUserModal === 'function') openUserModal(teacherId);
}

function openScheduleForRoom(roomId) {
    scheduleFilters.roomId = roomId || 'all';
    const select = document.getElementById('scheduleRoomFilter');
    if (select) select.value = scheduleFilters.roomId;
    if (typeof showSection === 'function') showSection('schedule');
    calendar?.refetchEvents();
    closeScheduleDetails();
}

function openScheduleConfirmation() {
    closeScheduleDetails();
    if (typeof showSection === 'function') showSection('lesson-review');
}

// Клик по дате
function handleDateClick(info) {
    openClassModal(info);
}

// Удалить занятие
async function deleteClass(classId) {
    if (!classId) {
        console.error('❌ deleteClass: classId отсутствует');
        toast.error('Не удалось найти занятие. Обновите расписание.');
        return;
    }

    if (isDeletingClass) return;
    isDeletingClass = true;

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
        toast.error('Не удалось удалить занятие');
        // При ошибке обновляем календарь для синхронизации
        if (calendar) {
            calendar.refetchEvents();
        }
        return false;
    } finally {
        isDeletingClass = false;
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
                const teacherName = formatSchedulePersonName(teacher, 'Преподаватель');
                if (teacher._id === selectedTeacherId) console.log('Match found for:', teacherName);
                return `<option value="${teacher._id}" ${String(teacher._id) === String(selectedTeacherId) ? 'selected' : ''}>${escapeHtml(teacherName)}</option>`;
            }).join('');
        
        if (select) {
            const lessonClosed = ['completed', 'cancelled'].includes(currentClassForAttendance?.status);
            select.disabled = lessonClosed || !(typeof isAdmin === 'function' && isAdmin());
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
        const originalTeacher = fresh.originalTeacher || null;

        return {
            ...classData,
            ...fresh,
            id: fresh.id || fresh._id || classData.id,
            _id: fresh._id || fresh.id || classData.id,
            teacherId: fresh.teacherId || teacher?._id || teacher?.id || classData.teacherId,
            teacherName: teacher
                ? formatSchedulePersonName(teacher, 'Не назначен')
                : classData.teacherName,
            originalTeacherId: fresh.originalTeacherId || originalTeacher?._id || originalTeacher?.id || classData.originalTeacherId,
            originalTeacherName: originalTeacher
                ? formatSchedulePersonName(originalTeacher, 'Не назначен')
                : classData.originalTeacherName,
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

function escapeJsArg(value) {
    return String(value == null ? '' : value)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/</g, '\\x3C');
}

function formatLessonSummaryDate(dateValue) {
    if (!dateValue) return '—';
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('ru-RU');
}

function getLessonStudentName(attendee) {
    const student = attendee?.studentDetails || attendee?.student;
    if (student && typeof student === 'object') {
        return formatSchedulePersonName(student, 'Ученик');
    }
    return 'Ученик';
}

function formatSchedulePersonName(person, fallback = 'Ученик') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function formatSchedulePersonNameWithAge(person, fallback = 'Ученик') {
    const name = escapeHtml(formatSchedulePersonName(person, fallback));
    const ageBadge = typeof renderStudentAgeBadge === 'function'
        ? renderStudentAgeBadge(person?.dateOfBirth)
        : '';
    return `${name}${ageBadge}`;
}

function getScheduleStudentId(student) {
    return student?._id || student?.id || student?.studentId || '';
}

function bindScheduleStudentLinkHandlers() {
    if (document.body.dataset.scheduleStudentLinkBound === 'true') return;
    document.body.dataset.scheduleStudentLinkBound = 'true';
    document.addEventListener('click', event => {
        const link = event.target.closest('[data-schedule-student-id]');
        if (!link) return;
        event.preventDefault();
        event.stopPropagation();
        openScheduleStudent(link.dataset.scheduleStudentId);
    });
}

function setAttendanceFormMode(mode) {
    const isSummary = mode === 'summary';
    const reportSection = document.getElementById('lessonReportSection');
    const teacherSelect = document.getElementById('attendanceTeacher');
    const teacherGroup = teacherSelect?.closest('.form-group');
    const actionsHeader = document.getElementById('attendanceActionsHeader');
    const billingSection = document.getElementById('lessonBillingSection');
    const saveBtn = document.querySelector('#attendanceModal button[onclick="saveAttendance()"]');
    const approveBtn = document.getElementById('approveClassBtn');
    const returnBtn = document.getElementById('returnLessonBtn');
    const reopenBtn = document.getElementById('reopenLessonBtn');
    const deleteBtn = document.querySelector('#attendanceModal .delete-btn');
    const noOneBtn = document.querySelector('#attendanceModal .mark-no-one-btn');
    const postponeBtn = document.querySelector('#attendanceModal button[onclick="postponeClass()"]');

    if (reportSection) reportSection.style.display = isSummary ? 'none' : '';
    if (teacherGroup) teacherGroup.style.display = isSummary ? 'none' : '';
    if (actionsHeader) actionsHeader.style.display = isSummary ? 'none' : 'flex';
    if (billingSection) {
        billingSection.style.display = 'none';
        billingSection.innerHTML = '';
    }
    [saveBtn, approveBtn, returnBtn, reopenBtn, deleteBtn, noOneBtn, postponeBtn].forEach(button => {
        if (button) button.style.display = isSummary ? 'none' : '';
    });
}

function renderCompletedLessonSummary(classData) {
    setAttendanceFormMode('summary');
    const reopenBtn = document.getElementById('reopenLessonBtn');
    if (reopenBtn && typeof isAdmin === 'function' && isAdmin()) {
        reopenBtn.style.display = 'block';
        reopenBtn.disabled = false;
        reopenBtn.textContent = 'ПЕРЕСМОТРЕТЬ ПОДТВЕРЖДЁННЫЙ УРОК';
    }
    document.getElementById('attendanceModalTitle').textContent = 'ПРОВЕДЁННЫЙ УРОК';

    const attendees = (classData.attendees || []).filter(item => item.attended || item.chargeAmount > 0);
    const totalCharge = attendees.reduce((sum, item) => sum + (Number(item.chargeAmount) || 0), 0);
    const teacherName = classData.teacherName || 'Не назначен';
    const reviewedByName = classData.reviewedBy
        ? formatSchedulePersonName(classData.reviewedBy, '')
        : '';
    const lessonDate = formatLessonSummaryDate(classData.date);
    const reviewedAt = classData.reviewedAt ? formatLessonSummaryDate(classData.reviewedAt) : '—';
    const participantRows = attendees.length
        ? attendees.map(attendee => {
            const name = getLessonStudentName(attendee);
            const charge = Number(attendee.chargeAmount) || 0;
            const source = attendee.chargeSource === 'membership'
                ? 'абонемент + баланс'
                : attendee.chargeSource === 'balance_only'
                    ? 'баланс'
                    : attendee.autoDeducted
                        ? 'абонемент'
                        : 'без списания';
            const studentObj = attendee?.studentDetails || attendee?.student;
            const studentId = studentObj?.id || studentObj?._id || attendee?.studentId;
            const studentNameHtml = studentObj && typeof studentObj === 'object'
                ? formatSchedulePersonNameWithAge(studentObj, name)
                : escapeHtml(name);
            const nameHtml = studentId
                ? `<strong style="display:block;color:var(--admin-primary);cursor:pointer;text-decoration:underline;" data-schedule-student-id="${escapeHtml(studentId)}">${studentNameHtml}</strong>`
                : `<strong style="display:block;color:var(--admin-text);">${studentNameHtml}</strong>`;
            return `
                <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
                    <div>
                        ${nameHtml}
                        <span style="font-size:0.86rem;opacity:0.7;">${escapeHtml(source)}</span>
                    </div>
                    <strong style="color:${charge > 0 ? '#86efac' : 'rgba(255,255,255,0.65)'};">${formatScheduleAmount(charge)}</strong>
                </div>
            `;
        }).join('')
        : `<div style="padding:14px 0;opacity:0.72;">${classData.noOneAttended ? 'Никто не пришёл. Списаний нет.' : 'Посещаемость не указана.'}</div>`;

    const reportItems = [
        ['Тема', classData.topic],
        ['Итог', classData.lessonSummary],
        ['Домашнее задание', classData.homeworkDraft],
        ['Фокус следующего урока', classData.nextLessonFocus],
        ['Комментарий преподавателя', classData.teacherComment]
    ].filter(([, value]) => value && String(value).trim());

    const reportHtml = reportItems.length
        ? reportItems.map(([label, value]) => `
            <div style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
                <div style="font-size:0.76rem;letter-spacing:0.12em;text-transform:uppercase;opacity:0.55;margin-bottom:5px;">${label}</div>
                <div style="white-space:pre-wrap;line-height:1.45;">${escapeHtml(value)}</div>
            </div>
        `).join('')
        : '<div style="opacity:0.65;">Отчёт по уроку не заполнен.</div>';

    document.getElementById('classInfo').innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;">
            <div>
                <div style="display:inline-flex;align-items:center;gap:7px;padding:5px 11px;border-radius:999px;background:rgba(34,197,94,0.14);border:1px solid rgba(34,197,94,0.42);color:#86efac;font-weight:800;margin-bottom:10px;">
                    ✓ Проведён
                </div>
                <div style="font-weight:800;font-size:1.05rem;color:var(--admin-text);">${escapeHtml(classData.title || 'Урок')}</div>
                <div style="margin-top:6px;opacity:0.72;">${lessonDate} · ${classData.startTime || '—'}-${classData.endTime || '—'} · ${escapeHtml(classData.roomName || classData.room?.name || 'Зал не указан')}</div>
            </div>
            <div style="text-align:right;">
                <span style="display:block;font-size:0.75rem;letter-spacing:0.12em;text-transform:uppercase;opacity:0.55;">Списано</span>
                <strong style="font-size:1.35rem;color:#86efac;">${formatScheduleAmount(totalCharge)}</strong>
            </div>
        </div>
    `;

    document.getElementById('attendanceList').innerHTML = `
        <div style="display:grid;gap:16px;">
            <section style="padding:18px;border:1px solid rgba(255,255,255,0.10);background:rgba(255,255,255,0.035);border-radius:12px;">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px;">
                    <div><span style="display:block;opacity:0.55;font-size:0.78rem;">Провёл</span><strong>${escapeHtml(teacherName)}</strong></div>
                    <div><span style="display:block;opacity:0.55;font-size:0.78rem;">Участников</span><strong>${attendees.length}</strong></div>
                    <div><span style="display:block;opacity:0.55;font-size:0.78rem;">Подтвердил</span><strong>${escapeHtml(reviewedByName || '—')}</strong></div>
                    <div><span style="display:block;opacity:0.55;font-size:0.78rem;">Дата подтверждения</span><strong>${reviewedAt}</strong></div>
                </div>
                <h3 style="margin:0 0 8px;color:var(--admin-text);">Ученики и списания</h3>
                ${participantRows}
            </section>

            <section style="padding:18px;border:1px solid rgba(255,255,255,0.10);background:rgba(255,255,255,0.035);border-radius:12px;">
                <h3 style="margin:0 0 8px;color:var(--admin-text);">Отчёт урока</h3>
                ${reportHtml}
            </section>
        </div>
    `;
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

    membershipInfo += `<span style="color: #cbd5e1; font-size: 0.85em; background: rgba(148, 163, 184, 0.1); padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid rgba(148, 163, 184, 0.2);">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
        Сумму списания выберите ниже
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
    const isClosed = ['completed', 'cancelled'].includes(classData.status);
    const hasTeacherReplacement = classData.originalTeacherId
        && classData.teacherId
        && String(classData.originalTeacherId) !== String(classData.teacherId);
    const originalTeacherName = classData.originalTeacherName || 'Не указан';
    const actualTeacherName = classData.teacherName || 'Не назначен';
    const statusTone = classData.status === 'completed'
        ? '#10b981'
        : classData.status === 'pending_admin_review'
            ? '#f59e0b'
            : classData.status === 'cancelled'
                ? '#ef4444'
                : '#94a3b8';
    const statusBadge = `<span style="display:inline-flex;align-items:center;width:max-content;padding:4px 10px;border-radius:999px;color:${statusTone};background:${statusTone}1a;border:1px solid ${statusTone}66;font-weight:700;">${formatClassStatus(classData.status)}</span>`;
    const replacementNotice = hasTeacherReplacement
        ? `<div style="grid-column:1 / -1;padding:10px 12px;border-radius:8px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#fbbf24;">
                Замена преподавателя: назначен ${originalTeacherName}, провел ${actualTeacherName}
           </div>`
        : '';
    const closedNotice = isClosed
        ? `<div style="grid-column:1 / -1;padding:10px 12px;border-radius:8px;background:rgba(16,185,129,0.10);border:1px solid rgba(16,185,129,0.28);color:#86efac;">
                Урок закрыт. Дату, время, зал и преподавателя нельзя поменять обычным сохранением.
           </div>`
        : '';
    const disabledAttr = isClosed ? 'disabled' : '';

    if (isUserAdmin) {
        const d = classData.date instanceof Date ? classData.date : new Date(classData.date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const isoDate = `${year}-${month}-${day}`;

        document.getElementById('classInfo').innerHTML = `
            <div style="margin-bottom: 12px;"><strong>${classData.title}</strong></div>
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 12px 15px; font-size: 0.9rem; align-items: center;">
                ${replacementNotice}
                ${closedNotice}
                <span style="opacity: 0.7;">Дата:</span>
                <input type="date" class="admin-input" id="attendanceDate" value="${isoDate}" ${disabledAttr} style="margin: 0; padding: 4px 8px; font-size: 0.9rem; max-width: 180px;">
                
                <span style="opacity: 0.7;">Время:</span>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <input type="time" class="admin-input" id="attendanceStartTime" value="${classData.startTime}" ${disabledAttr} style="margin: 0; padding: 4px 8px; font-size: 0.9rem; width: 90px;">
                    <span>-</span>
                    <input type="time" class="admin-input" id="attendanceEndTime" value="${classData.endTime}" ${disabledAttr} style="margin: 0; padding: 4px 8px; font-size: 0.9rem; width: 90px;">
                </div>
                
                <span style="opacity: 0.7;">Зал:</span>
                <select class="admin-input" id="attendanceRoom" ${disabledAttr} style="margin: 0; padding: 4px 8px; font-size: 0.9rem; max-width: 180px;">
                    <option value="">Загрузка залов...</option>
                </select>
                
                <span style="opacity: 0.7;">Провел:</span>
                <span>${actualTeacherName}</span>

                <span style="opacity: 0.7;">Статус:</span>
                ${statusBadge}
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
                ${statusBadge}
                ${replacementNotice}
                ${closedNotice}
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
            body: JSON.stringify({
                studentId,
                attended,
                attendanceStatus: attended
                    ? 'present'
                    : (currentAbsenceData[studentId] || 'excused_absence')
            }),
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
    setAttendanceFormMode('edit');
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

        if (classData.status === 'completed') {
            document.getElementById('attendanceModal').classList.add('show');
            renderCompletedLessonSummary(classData);
            return;
        }

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
                const rawStudent = studentData.student || studentData.data || studentData;
                if (!rawStudent || typeof rawStudent !== 'object') {
                    throw new Error('Не удалось загрузить данные ученика');
                }
                const student = {
                    ...rawStudent,
                    _id: rawStudent._id || rawStudent.id,
                };
                const studentId = getScheduleStudentId(student);
                if (!studentId) {
                    throw new Error('Не удалось открыть карточку ученика');
                }

                // Проверяем есть ли уже запись посещаемости
                const attendee = classData.attendees.find(a => {
                    const attendeeStudentId = typeof a.student === 'object' ? getScheduleStudentId(a.student) : a.student;
                    return String(attendeeStudentId || '') === String(studentId);
                });
                const isPresent = attendee ? attendee.attended : false;
                currentAttendanceData[studentId] = isPresent;
                allStudentsForAttendance = [student];

                if (!isPresent) {
                    currentAbsenceData[studentId] = getAttendanceAbsenceStatus(attendee);
                }

                const absenceStatus = currentAbsenceData[studentId] || 'excused_absence';
                const isEmergencyFreeze = absenceStatus === 'emergency_freeze';
                const showAbsenceControl = isPresent ? 'none' : 'block';
                const showWhatsappBtn = isPresent ? 'none' : 'inline-flex';

                const membershipInfo = buildAttendanceMembershipInfo(student);
                const attendanceDisabledAttr = ['completed', 'cancelled'].includes(classData.status) ? 'disabled' : '';
                const studentName = formatSchedulePersonNameWithAge(student);
                const studentPhone = student.phone || 'Нет номера';

                document.getElementById('attendanceList').innerHTML = `
                    <div class="attendance-student-card ${isPresent ? 'is-present' : `is-absent ${absenceStatus === 'unexcused_absence' ? 'is-unexcused' : ''} ${isEmergencyFreeze ? 'is-emergency-freeze' : ''}`}"
                        id="attendance-item-${escapeHtml(studentId)}">
                        <div class="student-row-link student-row-link--attendance" data-schedule-student-id="${escapeHtml(studentId)}" title="Открыть профиль" style="flex: 1;">
                            <div class="student-row-link__info">
                                <div style="font-weight: 600; margin-bottom: 5px; color: var(--admin-text); display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                    ${studentName}${isEmergencyFreeze ? ' <span class="attendance-freeze-badge">🧊 Заморозка</span>' : ''}
                                </div>
                                <div style="font-size: 0.9rem; opacity: 0.7; color: var(--admin-text); margin-bottom: 6px;">${escapeHtml(studentPhone)}</div>
                                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                                    ${membershipInfo}
                                </div>
                            </div>
                            <svg class="student-row-link__chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left: 15px;">
                                <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                        </div>
                        <div class="attendance-student-controls">
                            <!-- Кнопка отправки ДЗ в WhatsApp -->
                            <button type="button" class="attendance-homework-btn" id="homework-whatsapp-btn-${escapeHtml(studentId)}"
                                    onclick="sendHomeworkToAbsentStudent('${escapeHtml(studentId)}')"
                                    style="display: ${showWhatsappBtn};">
                                Отправить ДЗ
                            </button>
                            <button type="button" class="attendance-freeze-btn"
                                    onclick="setAttendanceEmergencyFreeze('${escapeHtml(studentId)}')" ${attendanceDisabledAttr}>
                                🧊 Заморозка
                            </button>
                            <!-- Выбор типа отсутствия -->
                            <div id="absence-selector-wrapper-${escapeHtml(studentId)}" style="display: ${showAbsenceControl};">
                                <select class="admin-input attendance-absence-select"
                                        onchange="updateAbsenceStatus('${escapeHtml(studentId)}', this.value)" ${attendanceDisabledAttr}>
                                    <option value="excused_absence" ${absenceStatus === 'excused_absence' ? 'selected' : ''}>Уважительная — без списания</option>
                                    <option value="unexcused_absence" ${absenceStatus === 'unexcused_absence' ? 'selected' : ''}>Прогул — списать занятие</option>
                                    <option value="emergency_freeze" ${absenceStatus === 'emergency_freeze' ? 'selected' : ''}>🧊 Заморозка — не списывать деньги</option>
                                </select>
                            </div>
                            <label class="attendance-present-toggle">
                                <span>Присутствовал</span>
                                <input type="checkbox" 
                                       ${isPresent ? 'checked' : ''}
                                       ${attendanceDisabledAttr}
                                       onchange="toggleAttendance('${escapeHtml(studentId)}')"
                                       style="width: 20px; height: 20px; cursor: pointer;">
                            </label>
                        </div>
                    </div>
                `;
            } catch (err) {
                console.error('Ошибка загрузки индивидуального ученика:', err);
                document.getElementById('attendanceList').innerHTML = `
                    <p style="text-align: center; opacity: 0.5; padding: 20px;">
                        Не удалось загрузить данные ученика
                    </p>
                `;
            }
            return;
        }

        // Для специальных занятий без аудитории посещаемость не заполняется.
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
                    throw new Error(errorData.error || errorData.message || 'Не удалось загрузить список учеников');
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
                infoTeacher.textContent = formatSchedulePersonName(t, 'Не назначен');
            }
        }

        // Загружаем преподавателей
        await loadTeachersForAttendance(selectedTeacherId);

        const students = (studentsData.students || [])
            .filter(student => student && typeof student === 'object' && getScheduleStudentId(student))
            .map(student => ({ ...student, _id: getScheduleStudentId(student) }));
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

        allStudentsForAttendance = students;
        currentAttendanceData = {};

        const attendanceList = document.getElementById('attendanceList');
        attendanceList.innerHTML = students.map(student => {
            const studentId = getScheduleStudentId(student);
            const studentName = formatSchedulePersonNameWithAge(student);
            const studentPhone = student.phone || 'Нет номера';
            // ✅ attendees.student - это просто ID (строка), НЕ объект!
            // Бэкенд не делает populate для оптимизации
            const attendee = classData.attendees.find(a => {
                if (!a || !a.student) return false;
                // Сравниваем строку с строкой (оба ID)
                const attendeeStudentId = typeof a.student === 'object' ? getScheduleStudentId(a.student) : a.student;
                return String(attendeeStudentId || '') === String(studentId);
            });
            const isPresent = attendee ? attendee.attended : false;
            const isFrozen = isStudentFrozen(studentId, classData.date);

            currentAttendanceData[studentId] = isPresent;

            if (!isPresent) {
                currentAbsenceData[studentId] = getAttendanceAbsenceStatus(attendee);
            }

            const absenceStatus = currentAbsenceData[studentId] || 'excused_absence';
            const isEmergencyFreeze = absenceStatus === 'emergency_freeze';
            const showAbsenceControl = isPresent ? 'none' : 'block';
            const showWhatsappBtn = isPresent ? 'none' : 'inline-flex';

            const membershipInfo = buildAttendanceMembershipInfo(student);
            const attendanceDisabledAttr = ['completed', 'cancelled'].includes(classData.status) ? 'disabled' : '';

            return `
                <div class="attendance-student-card ${isFrozen ? 'is-frozen' : isPresent ? 'is-present' : `is-absent ${absenceStatus === 'unexcused_absence' ? 'is-unexcused' : ''} ${isEmergencyFreeze ? 'is-emergency-freeze' : ''}`}"
                    id="attendance-item-${escapeHtml(studentId)}">
                    <div class="student-row-link student-row-link--attendance" data-schedule-student-id="${escapeHtml(studentId)}" title="Открыть профиль" style="flex: 1;">
                        <div class="student-row-link__info">
                            <div style="font-weight: 600; margin-bottom: 5px; color: var(--admin-text); display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                ${studentName}${isEmergencyFreeze ? ' <span class="attendance-freeze-badge">🧊 Заморозка</span>' : ''}
                                ${isFrozen ? '<span style="color: #60a5fa; font-size: 0.85em; display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M12 12l8-8M12 12l-8 8M12 12l8 8M12 12l-8-8M4 12h16"></path></svg> ЗАМОРОЗКА</span>' : ''}
                            </div>
                            <div style="font-size: 0.9rem; opacity: 0.7; color: var(--admin-text); margin-bottom: 6px;">${escapeHtml(studentPhone)}</div>
                            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                                ${membershipInfo}
                            </div>
                            ${attendee?.teacherNote ? `<div style="margin-top:8px; font-size:0.85rem; opacity:0.8;">Заметка преподавателя: ${escapeHtml(attendee.teacherNote)}</div>` : ''}
                        </div>
                        <svg class="student-row-link__chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left: 15px;">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </div>
                    <div class="attendance-student-controls">
                        <!-- Кнопка отправки ДЗ в WhatsApp -->
                        <button type="button" class="attendance-homework-btn" id="homework-whatsapp-btn-${escapeHtml(studentId)}"
                                onclick="sendHomeworkToAbsentStudent('${escapeHtml(studentId)}')"
                                style="display: ${showWhatsappBtn};">
                            Отправить ДЗ
                        </button>
                        <button type="button" class="attendance-freeze-btn"
                                onclick="setAttendanceEmergencyFreeze('${escapeHtml(studentId)}')" ${attendanceDisabledAttr}>
                            🧊 Заморозка
                        </button>
                        <!-- Выбор типа отсутствия -->
                        <div id="absence-selector-wrapper-${escapeHtml(studentId)}" style="display: ${showAbsenceControl};">
                            <select class="admin-input attendance-absence-select"
                                    onchange="updateAbsenceStatus('${escapeHtml(studentId)}', this.value)" ${attendanceDisabledAttr}>
                                <option value="excused_absence" ${absenceStatus === 'excused_absence' ? 'selected' : ''}>Уважительная — без списания</option>
                                <option value="unexcused_absence" ${absenceStatus === 'unexcused_absence' ? 'selected' : ''}>Прогул — списать занятие</option>
                                <option value="emergency_freeze" ${absenceStatus === 'emergency_freeze' ? 'selected' : ''}>🧊 Заморозка — не списывать деньги</option>
                            </select>
                        </div>
                        <label class="attendance-present-toggle">
                            <span>Присутствовал</span>
                            <input type="checkbox" 
                                   ${isPresent ? 'checked' : ''}
                                   ${attendanceDisabledAttr}
                                   onchange="toggleAttendance('${escapeHtml(studentId)}')"
                                   style="width: 20px; height: 20px; cursor: pointer;">
                        </label>
                    </div>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА в openAttendanceModal:', error);
        console.error('❌ Error message:', error.message);
        console.error('❌ Error stack:', error.stack);

        document.getElementById('attendanceList').innerHTML = `
            <div style="text-align: center; padding: 20px; color: #dc3545;">
                <p style="font-size: 1.2rem; margin-bottom: 10px;">Не удалось загрузить учеников</p>
                <p style="opacity: 0.7; font-size: 0.9rem;">Обновите страницу и попробуйте снова.</p>
                <p style="margin-top: 15px; opacity: 0.6; font-size: 0.85rem;">
                    Попробуйте обновить страницу или обратитесь к администратору
                </p>
            </div>
        `;

        toast.error('Не удалось загрузить данные урока');
    }
}

// Закрыть модалку посещаемости
function closeAttendanceModal() {
    document.getElementById('attendanceModal').classList.remove('show');
    setAttendanceFormMode('edit');
    currentClassForAttendance = null;
    currentAttendanceData = {};
    currentAbsenceData = {};
    allStudentsForAttendance = [];
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

function getStudentsToCharge() {
    const chargeIds = [];
    Object.entries(currentAttendanceData).forEach(([studentId, isPresent]) => {
        if (isPresent) {
            chargeIds.push(studentId);
        } else if (currentAbsenceData[studentId] === 'unexcused_absence') {
            chargeIds.push(studentId);
        }
    });
    return chargeIds;
}

function getAttendanceAbsenceStatus(attendee) {
    const status = attendee?.attendanceStatus;
    if (status === 'unexcused_absence' || status === 'emergency_freeze') return status;
    return 'excused_absence';
}

function updateAttendanceFreezeBadge(studentId, show) {
    const item = document.getElementById(`attendance-item-${studentId}`);
    const nameRow = item?.querySelector('.student-row-link__info > div');
    if (!item || !nameRow) return;

    let badge = nameRow.querySelector('.attendance-freeze-badge');
    if (show && !badge) {
        badge = document.createElement('span');
        badge.className = 'attendance-freeze-badge';
        badge.textContent = '🧊 Заморозка';
        nameRow.appendChild(badge);
    } else if (!show && badge) {
        badge.remove();
    }
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

    const chargeStudentIds = getStudentsToCharge();
    if (!chargeStudentIds.length) {
        resetLessonBillingPreview();
        return;
    }

    try {
        await loadLessonBillingOptions(currentClassForAttendance.id, chargeStudentIds, { scroll: false });
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

    const isPresent = currentAttendanceData[studentId];
    if (currentClassForAttendance?.teacherOutcomeHint === 'not_held') {
        currentClassForAttendance.teacherOutcomeHint = 'held';
        currentClassForAttendance.noOneAttended = false;
    }
    const item = document.getElementById(`attendance-item-${studentId}`);
    if (item) {
        item.classList.toggle('is-present', isPresent);
        item.classList.toggle('is-absent', !isPresent);
        item.classList.toggle('is-emergency-freeze', !isPresent && currentAbsenceData[studentId] === 'emergency_freeze');
    }

    const selector = document.getElementById(`absence-selector-wrapper-${studentId}`);
    const whatsappBtn = document.getElementById(`homework-whatsapp-btn-${studentId}`);
    if (selector) selector.style.display = isPresent ? 'none' : 'block';
    if (whatsappBtn) whatsappBtn.style.display = isPresent ? 'none' : 'inline-flex';
    updateAttendanceFreezeBadge(studentId, !isPresent && currentAbsenceData[studentId] === 'emergency_freeze');

    scheduleLessonBillingPreviewRefresh();
}

function updateAbsenceStatus(studentId, val) {
    currentAbsenceData[studentId] = val;
    if (currentClassForAttendance?.teacherOutcomeHint === 'not_held') {
        currentClassForAttendance.teacherOutcomeHint = 'held';
        currentClassForAttendance.noOneAttended = false;
    }
    const item = document.getElementById(`attendance-item-${studentId}`);
    if (item) {
        item.classList.toggle('is-unexcused', val === 'unexcused_absence');
        item.classList.toggle('is-emergency-freeze', val === 'emergency_freeze');
    }
    updateAttendanceFreezeBadge(studentId, val === 'emergency_freeze');
    scheduleLessonBillingPreviewRefresh();
}

function setAttendanceEmergencyFreeze(studentId) {
    currentAttendanceData[studentId] = false;
    currentAbsenceData[studentId] = 'emergency_freeze';
    if (currentClassForAttendance?.teacherOutcomeHint === 'not_held') {
        currentClassForAttendance.teacherOutcomeHint = 'held';
        currentClassForAttendance.noOneAttended = false;
    }

    const item = document.getElementById(`attendance-item-${studentId}`);
    if (item) {
        item.classList.remove('is-present', 'is-unexcused');
        item.classList.add('is-absent', 'is-emergency-freeze');
    }

    const checkbox = document.querySelector(`#attendance-item-${studentId} input[type="checkbox"]`);
    if (checkbox) checkbox.checked = false;

    const selector = document.getElementById(`absence-selector-wrapper-${studentId}`);
    if (selector) selector.style.display = 'block';
    const select = selector?.querySelector('select');
    if (select) select.value = 'emergency_freeze';

    const whatsappBtn = document.getElementById(`homework-whatsapp-btn-${studentId}`);
    if (whatsappBtn) whatsappBtn.style.display = 'inline-flex';
    updateAttendanceFreezeBadge(studentId, true);
    scheduleLessonBillingPreviewRefresh();
}

function getScheduleStudentFirstPhone(student) {
    const primary = String(student?.phone || '').trim();
    const rawPhone = primary && !primary.startsWith('IMPORT_NO_PRIMARY_') && !primary.startsWith('NO_PHONE_')
        ? primary
        : (student?.additionalPhones?.[0]?.phone || '');
    let phone = String(rawPhone).replace(/\D/g, '');
    if (phone.startsWith('8')) {
        phone = `7${phone.substring(1)}`;
    }
    if (phone.length === 10) {
        phone = `7${phone}`;
    }
    return phone;
}

function sendHomeworkToAbsentStudent(studentId) {
    if (!currentClassForAttendance) return;
    const student = allStudentsForAttendance.find(s => (s._id || s.id).toString() === studentId.toString());
    if (!student) {
        toast.error('Ученик не найден');
        return;
    }

    const homework = document.getElementById('lessonHomework')?.value?.trim();
    if (!homework) {
        toast.warning('Заполните поле домашнего задания перед отправкой');
        return;
    }

    const dateStr = new Date(currentClassForAttendance.date).toLocaleDateString('ru-RU');
    const text = `Привет, ${student.name}! Сегодня тебя не было на занятии (${dateStr}). Вот домашнее задание: ${homework}`;
    
    const phone = getScheduleStudentFirstPhone(student);
    if (!phone) {
        toast.error('У ученика не указан номер телефона');
        return;
    }

    const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
}

window.updateAbsenceStatus = updateAbsenceStatus;
window.setAttendanceEmergencyFreeze = setAttendanceEmergencyFreeze;
window.sendHomeworkToAbsentStudent = sendHomeworkToAbsentStudent;

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
        if (['completed', 'cancelled'].includes(currentClassForAttendance.status)) {
            toast.warning('Урок уже закрыт. Обычное редактирование недоступно.');
            return;
        }
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
        const savedAbsenceData = { ...currentAbsenceData };

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
                        body: JSON.stringify({
                            studentId,
                            attended,
                            attendanceStatus: attended
                                ? 'present'
                                : (savedAbsenceData[studentId] || 'excused_absence')
                        })
                    }).then(async response => {
                        const data = await response.json().catch(() => ({}));

                        if (!response.ok) {
                            console.error(`Ошибка сохранения посещаемости для студента ${studentId}:`, data);
                            throw new Error(data.error || data.message || 'Не удалось сохранить посещаемость');
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
                toast.error('Не удалось сохранить посещаемость');
            }
        })();

    } catch (error) {
        console.error('❌ Ошибка saveAttendance:', error);
        toast.error('Не удалось сохранить посещаемость');
    }
}

// Удалить занятие из модалки посещаемости
async function deleteClassFromAttendance() {
    const classData = currentClassForAttendance;

    if (!classData || !classData.id) {
        toast.error('Занятие не найдено. Обновите расписание.');
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
            toast.error('Занятие не найдено. Обновите расписание.');
        }
        return;
    }
    if (['completed', 'cancelled'].includes(classData.status)) {
        toast.warning('Урок уже закрыт.');
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
            throw new Error(errorText || 'Не удалось сохранить отметку');
        }

        const data = await response.json().catch(err => {
            console.error('❌ markNoOneAttended: JSON parse error:', err);
            throw new Error('Не удалось сохранить отметку');
        });

        if (!data.success) {
            throw new Error(data.error || data.message || 'Не удалось сохранить отметку');
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
            toast.error(error.message || 'Не удалось сохранить отметку');
        } else {
            alert(error.message || 'Не удалось сохранить отметку');
        }
    }
}

// ✅ Экспортируем функцию в глобальную область для доступа из HTML
window.markNoOneAttended = markNoOneAttended;

// Отметить, что занятие перенесено
async function postponeClass() {
    const classData = currentClassForAttendance;

    if (!classData || !classData.id) {
        toast.error('Занятие не найдено. Обновите расписание.');
        return;
    }
    if (['completed', 'cancelled'].includes(classData.status)) {
        toast.warning('Урок уже закрыт.');
        return;
    }
    if (isLifecycleSubmitting) return;

    const dateStr = classData.date.toLocaleDateString('ru-RU');

    if (await customConfirm(`Отметить занятие как перенесенное?\n\n${classData.title}\n${dateStr} ${classData.startTime}-${classData.endTime}\n\nСписанные абонементы будут возвращены, а занятие останется в календаре как перенесенное.`)) {
        isLifecycleSubmitting = true;
        
        const returnBtn = document.getElementById('returnLessonBtn');
        const reopenBtn = document.getElementById('reopenLessonBtn');
        const postponeBtn = document.querySelector('#attendanceModal button[onclick="postponeClass()"]');
        if (returnBtn) returnBtn.disabled = true;
        if (reopenBtn) reopenBtn.disabled = true;
        if (postponeBtn) postponeBtn.disabled = true;

        // Закрываем модальное окно ДО отправки запроса
        closeAttendanceModal();

        try {
            const response = await fetch(`${API_URL}/classes/${classData.id}/postpone`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getAuthToken()}`,
                    'X-Idempotency-Key': generateIdempotencyKey()
                }
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Не удалось перенести занятие');
            }

            showPostponeResultToast(data, 'Занятие перенесено');

            if (calendar) {
                setTimeout(() => {
                    calendar.refetchEvents();
                }, 100);
            }
            updatePendingAttendanceBadge();
        } catch (error) {
            console.error('❌ postponeClass error:', error);
            toast.error(error.message);
        } finally {
            isLifecycleSubmitting = false;
            if (returnBtn) returnBtn.disabled = false;
            if (reopenBtn) reopenBtn.disabled = false;
            if (postponeBtn) postponeBtn.disabled = false;
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
    const classEndInput = document.getElementById('classEndTime');
    if (classEndInput) classEndInput.dataset.manuallyEdited = '';
    document.getElementById('classId').value = '';
    title.textContent = 'СОЗДАТЬ ЗАНЯТИЕ';
    clearSelectedStudent();
    updateClassLessonTypeUI();

    if (dateInfo) {
        if (typeof dateInfo === 'object' && dateInfo.date) {
            const clickedDate = dateInfo.date;

            const dateStr = clickedDate.toISOString().split('T')[0];
            document.getElementById('classDate').value = dateStr;

            const hours = clickedDate.getHours();
            const minutes = clickedDate.getMinutes();

            const startTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
            document.getElementById('classStartTime').value = startTime;

            document.getElementById('classEndTime').value = scheduleDefaultEndTime(startTime);
        } else if (typeof dateInfo === 'string') {
            document.getElementById('classDate').value = dateInfo;
            document.getElementById('classStartTime').value = '18:00';
            document.getElementById('classEndTime').value = scheduleDefaultEndTime('18:00');
        }
    } else {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('classDate').value = today;
        document.getElementById('classStartTime').value = '18:00';
        document.getElementById('classEndTime').value = scheduleDefaultEndTime('18:00');
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
    updateClassLessonTypeUI();
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

function getClassLessonType() {
    return document.getElementById('classLessonType')?.value || 'trial';
}

function updateClassLessonTypeUI() {
    const lessonType = getClassLessonType();
    const groupWrapper = document.getElementById('classGroupWrapper');
    const studentGroup = document.getElementById('classStudentGroup');
    const studentLabel = document.getElementById('classStudentLabel');
    const studentSearch = document.getElementById('classStudentSearch');
    const groupSelect = document.getElementById('classGroup');

    if (groupWrapper) groupWrapper.style.display = lessonType === 'group' ? 'block' : 'none';
    if (studentGroup) studentGroup.style.display = lessonType === 'group' ? 'none' : 'block';

    if (studentLabel) {
        studentLabel.textContent = lessonType === 'trial' ? 'УЧЕНИК ИЛИ ЗАЯВКА' : 'УЧЕНИК';
    }
    if (studentSearch) {
        studentSearch.placeholder = lessonType === 'trial'
            ? 'ФИО/телефон ученика или заявки...'
            : 'ФИО/телефон ученика...';
    }
    if (groupSelect) {
        groupSelect.required = lessonType === 'group';
        if (lessonType !== 'group') groupSelect.value = '';
    }
    if (lessonType === 'group') {
        clearSelectedStudent();
    }
}
window.updateClassLessonTypeUI = updateClassLessonTypeUI;

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
                `<option value="${teacher._id}">${escapeHtml(formatSchedulePersonName(teacher, 'Преподаватель'))}</option>`
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
        `<button class="filter-btn" data-room="${escapeHtml(room._id)}" onclick="filterByRoom('${escapeJsArg(room._id)}')" style="border-color: ${escapeHtml(room.color || '')};">
                ${escapeHtml(room.name)}
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
    scheduleFilters.roomId = roomId || 'all';
    selectedRoomIds.clear();
    if (roomId && roomId !== 'all') selectedRoomIds.add(roomId);
    const select = document.getElementById('scheduleRoomFilter');
    if (select) select.value = scheduleFilters.roomId;

    if (calendar) {
        calendar.refetchEvents();
    }
}

function bindScheduleFilters() {
    const bindings = {
        scheduleTeacherFilter: 'teacherId',
        scheduleRoomFilter: 'roomId',
        scheduleSubjectFilter: 'subject',
        scheduleTypeFilter: 'classType',
        scheduleStatusFilter: 'status',
    };

    Object.entries(bindings).forEach(([elementId, stateKey]) => {
        const element = document.getElementById(elementId);
        if (!element || element.dataset.bound === 'true') return;
        element.dataset.bound = 'true';
        element.addEventListener('change', () => {
            scheduleFilters[stateKey] = element.value || 'all';
            if (stateKey === 'roomId') {
                selectedRoomIds.clear();
                if (element.value && element.value !== 'all') selectedRoomIds.add(element.value);
            }
            closeScheduleDetails();
            calendar?.refetchEvents();
        });
    });

    const reset = document.getElementById('scheduleResetFilters');
    if (reset && reset.dataset.bound !== 'true') {
        reset.dataset.bound = 'true';
        reset.addEventListener('click', () => {
            Object.keys(scheduleFilters).forEach(key => { scheduleFilters[key] = 'all'; });
            selectedRoomIds.clear();
            Object.keys(bindings).forEach(id => {
                const element = document.getElementById(id);
                if (element) element.value = 'all';
            });
            closeScheduleDetails();
            calendar?.refetchEvents();
        });
    }

    if (document.body.dataset.scheduleDetailBound !== 'true') {
        document.body.dataset.scheduleDetailBound = 'true';
        document.addEventListener('click', (event) => {
            const popover = document.getElementById('scheduleDetailPopover');
            if (!popover?.classList.contains('is-open')) return;
            if (popover.contains(event.target) || event.target.closest('.fc-event')) return;
            closeScheduleDetails();
        });
    }
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

        if (!response.ok) throw new Error('Не удалось загрузить данные');

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
                    <small style="opacity:0.65;">${room.classesCount} занятий · ${hours} ч из ${Math.round((room.availableMinutes / 60) * 10) / 10} ч · ${room.workingStart}–${room.workingEnd}</small>
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
    bindScheduleFilters();

    const classLessonTypeSelect = document.getElementById('classLessonType');
    if (classLessonTypeSelect && !classLessonTypeSelect.dataset.bound) {
        classLessonTypeSelect.addEventListener('change', updateClassLessonTypeUI);
        classLessonTypeSelect.dataset.bound = 'true';
    }

    const classCreateGroupBtn = document.getElementById('classCreateGroupBtn');
    if (classCreateGroupBtn && !classCreateGroupBtn.dataset.bound) {
        classCreateGroupBtn.addEventListener('click', async () => {
            const nameInput = document.getElementById('classQuickGroupName');
            const name = nameInput?.value?.trim();
            if (!name) {
                toast.warning('Введите название новой группы');
                nameInput?.focus();
                return;
            }

            classCreateGroupBtn.disabled = true;
            classCreateGroupBtn.textContent = 'Создаем...';
            try {
                const teacherSelect = document.getElementById('classTeacher');
                const teacherId = teacherSelect?.value || null;
                const teacherName = teacherSelect && teacherSelect.selectedIndex >= 0
                    ? teacherSelect.options[teacherSelect.selectedIndex].text
                    : '';
                const body = {
                    name,
                    instructor: teacherId ? teacherName : '',
                    teacherId: teacherId || null,
                    schedule: [],
                    studentIds: []
                };

                const response = await fetch(`${API_URL}/groups`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${getAuthToken()}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                });
                const data = await response.json();
                if (!response.ok || !data.success) {
                    throw new Error(data.error || 'Не удалось создать группу');
                }

                await loadGroupsForClass();
                const group = data.group;
                const groupId = group?._id || group?.id;
                const groupSelect = document.getElementById('classGroup');
                if (groupSelect && groupId) groupSelect.value = groupId;
                if (nameInput) nameInput.value = '';
                toast.success('Группа создана для разового урока');
            } catch (error) {
                toast.error(error.message || 'Ошибка создания группы');
            } finally {
                classCreateGroupBtn.disabled = false;
                classCreateGroupBtn.textContent = '+ Создать';
            }
        });
        classCreateGroupBtn.dataset.bound = 'true';
    }

    // Поиск ученика или заявки для разового занятия
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
                    const lessonType = getClassLessonType();
                    const students = (data.students || []).filter(item => {
                        return lessonType === 'trial' || !item.isBooking;
                    });

                    if (students.length === 0) {
                        resultsDiv.innerHTML = '<div style="padding: 10px 12px; opacity: 0.5; font-size: 0.85em;">Ничего не найдено</div>';
                    } else {
                        resultsDiv.innerHTML = students.map(s => {
                            const fullName = [s.lastName, s.name, s.middleName].filter(Boolean).join(' ').trim() || s.name || 'Без имени';
                            const badge = s.isBooking ? 'Заявка' : 'Ученик';
                            const rawId = String(s._id || s.id || '');
                            const escapedId = escapeHtml(rawId);
                            const escapedName = escapeHtml(fullName);
                            const jsId = escapeJsArg(rawId);
                            const jsName = escapeJsArg(fullName);
                            const ageBadge = typeof renderStudentAgeBadge === 'function' && !s.isBooking
                                ? renderStudentAgeBadge(s.dateOfBirth)
                                : '';
                            return `
                            <div onclick="selectStudentForClass('${jsId}', '${jsName}')"
                                 style="padding: 10px 12px; cursor: pointer; font-size: 0.9em; border-bottom: 1px solid rgba(255,255,255,0.06); transition: background 0.15s;"
                                 onmouseover="this.style.background='rgba(235,77,119,0.1)'" onmouseout="this.style.background='none'">
                                <div style="font-weight: 600;">${escapedName}${ageBadge}</div>
                                <div style="font-size: 0.8em; opacity: 0.6;">${escapeHtml(s.phone || '')} · ${badge}</div>
                            </div>
                        `;
                        }).join('');
                    }
                    resultsDiv.style.display = 'block';
                } catch (err) {
                    console.error('Student search error:', err);
                }
            }, 300);
        });

        // Скрываем результаты при клике вне. Вешаем один раз, потому что модуль может переинициализироваться.
        if (!document.body.dataset.classStudentSearchOutsideClickBound) {
            document.body.dataset.classStudentSearchOutsideClickBound = '1';
            document.addEventListener('click', function (e) {
                const resultsDiv = document.getElementById('classStudentResults');
                if (resultsDiv && !e.target.closest('#classStudentGroup')) {
                    resultsDiv.style.display = 'none';
                }
            });
        }
    }

    // Обработчик формы создания занятия
    const classForm = document.getElementById('classForm');
    if (classForm) {
        const classStartInput = document.getElementById('classStartTime');
        const classEndInput = document.getElementById('classEndTime');
        if (classStartInput && classEndInput && !classStartInput.dataset.autoEndBound) {
            classStartInput.dataset.autoEndBound = '1';
            classEndInput.dataset.manuallyEdited = '';
            classEndInput.addEventListener('input', () => {
                classEndInput.dataset.manuallyEdited = '1';
            });
            classStartInput.addEventListener('input', () => {
                if (!classEndInput.dataset.manuallyEdited) {
                    classEndInput.value = scheduleDefaultEndTime(classStartInput.value);
                }
            });
        }

        if (classForm.dataset.classSubmitBound) return;
        classForm.dataset.classSubmitBound = '1';

        classForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (isClassSubmitting) return;

            const submitBtn = classForm.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'СОЗДАНИЕ...';
            }
            isClassSubmitting = true;

            const groupId = document.getElementById('classGroup').value;
            const lessonType = getClassLessonType();
            const roomId = document.getElementById('classRoom').value;
            const date = document.getElementById('classDate').value;
            const startTime = document.getElementById('classStartTime').value;
            const endTime = document.getElementById('classEndTime').value;
            const notes = document.getElementById('classNotes')?.value || '';


            // Преподаватель (только для админов)
            const teacherSelect = document.getElementById('classTeacher');
            const teacherId = teacherSelect?.value || null;
            const selectedStudentId = document.getElementById('classStudentId')?.value || '';

            if (!date || !startTime || !endTime) {
                toast.warning('Заполните все обязательные поля');
                isClassSubmitting = false;
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'СОЗДАТЬ';
                }
                return;
            }
            const startMinutes = scheduleTimeToMinutes(startTime);
            const endMinutes = scheduleTimeToMinutes(endTime);
            if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
                toast.warning('Время окончания должно быть позже времени начала');
                isClassSubmitting = false;
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'СОЗДАТЬ';
                }
                return;
            }
            if (!isScheduleGridTime(startTime)) {
                const proceed = await customConfirm(
                    'Начало урока не попадает в сетку 08:15, 09:00, 09:45 и далее с шагом 45 минут. Создать занятие всё равно?',
                    { icon: 'warning' }
                );
                if (!proceed) {
                    isClassSubmitting = false;
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'СОЗДАТЬ';
                    }
                    return;
                }
            }
            if (lessonType === 'group' && !groupId) {
                toast.warning('Выберите группу');
                isClassSubmitting = false;
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'СОЗДАТЬ';
                }
                return;
            }
            if (lessonType !== 'group' && !selectedStudentId) {
                toast.warning(lessonType === 'trial' ? 'Выберите ученика или заявку' : 'Выберите ученика');
                isClassSubmitting = false;
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'СОЗДАТЬ';
                }
                return;
            }

            try {
                const token = getAuthToken();

                // Формируем тело запроса
                const body = {
                    classType: lessonType,
                    groupId: lessonType === 'group' ? groupId : null,
                    roomId: roomId && roomId !== '' ? roomId : null,
                    date,
                    startTime,
                    endTime,
                    notes
                };

                // Добавляем teacherId если указан (для админов)
                if (teacherId && teacherId !== '') {
                    body.teacherId = teacherId;
                }

                if (lessonType === 'individual') {
                    body.individualStudentId = selectedStudentId;
                } else if (lessonType === 'trial') {
                    if (selectedStudentId.startsWith('booking_')) {
                        body.bookingId = selectedStudentId.replace('booking_', '');
                    } else {
                        body.individualStudentId = selectedStudentId;
                    }
                }

                const response = await fetch(`${API_URL}/classes`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        'X-Idempotency-Key': generateIdempotencyKey()
                    },
                    body: JSON.stringify(body)
                });


                const data = await response.json();

                if (data.success) {
                    toast.success('Занятие успешно создано');
                    closeClassModal();

                    if (calendar) {
                        calendar.refetchEvents();
                    }

                    // Обновляем badge В ФОНЕ
                    setTimeout(() => updatePendingAttendanceBadge(), 0);
                } else {
                    toast.error(data.error || 'Не удалось создать занятие');
                }
            } catch (error) {
                toast.error('Не удалось создать занятие');
            } finally {
                isClassSubmitting = false;
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'СОЗДАТЬ';
                }
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
    if (isGeneratingSchedule) return;
    isGeneratingSchedule = true;

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
            isGeneratingSchedule = false;
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
                isGeneratingSchedule = false;
                return;
            }
            if (new Date(endDate) < new Date(startDate)) {
                toast.error('Дата окончания раньше даты начала');
                isGeneratingSchedule = false;
                return;
            }
            const daysDiff = Math.round(
                (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)
            ) + 1;
            if (daysDiff > 180) {
                toast.error('Максимальный диапазон — 180 дней');
                isGeneratingSchedule = false;
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
            isGeneratingSchedule = false;
            return;
        }

        const startTime = Date.now();

        // 1. Запускаем фоновую задачу на бэке, получаем jobId
        const startResponse = await fetch(`${API_URL}/classes/generate-from-schedule`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-Idempotency-Key': generateIdempotencyKey()
            },
            body: JSON.stringify(requestBody)
        });

        if (!startResponse.ok) {
            const errorData = await startResponse.json().catch(() => ({}));
            hideProgress();
            dismissToast(loadingToast);
            toast.error(errorData.error || 'Не удалось подготовить расписание');
            isGeneratingSchedule = false;
            return;
        }

        const startData = await startResponse.json();
        if (!startData.success || !startData.jobId) {
            hideProgress();
            dismissToast(loadingToast);
            toast.error(startData.error || 'Не удалось подготовить расписание');
            isGeneratingSchedule = false;
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
                isGeneratingSchedule = false;
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
                isGeneratingSchedule = false;
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
                isGeneratingSchedule = false;

                if (progress?.error) {
                    toast.error('Не удалось подготовить расписание: ' + progress.error);
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
                        toast.error('Не удалось продолжить подготовку расписания. Обновите страницу.');
                        isGeneratingSchedule = false;
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
                    isGeneratingSchedule = false;
                }
            }
        }, 500);
    } catch (error) {
        console.error('Generate schedule error:', error);
        if (pollInterval) clearInterval(pollInterval);
        hideProgress();
        dismissToast(loadingToast);
        toast.error('Не удалось подготовить расписание: ' + error.message);
        isGeneratingSchedule = false;
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

}



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
            toast.error('Не удалось открыть практику. Обновите расписание.');
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
        toast.error('Не удалось открыть практику');
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
        toast.error('Не удалось найти практику. Обновите расписание.');
        return;
    }

    // ⚡ КРИТИЧЕСКИ ВАЖНО: Сохраняем ID В ЛОКАЛЬНУЮ ПЕРЕМЕННУЮ
    // потому что closePracticeModal() сбросит currentPracticeId в null!
    const practiceIdToDelete = currentPracticeId;

    // Удаление практики

    // Валидация ID (не должен быть "null", "undefined" или пустым)
    if (practiceIdToDelete === 'null' || practiceIdToDelete === 'undefined' || !practiceIdToDelete || practiceIdToDelete.length < 10) {
        console.error('❌ Некорректный ID практики:', practiceIdToDelete);
        toast.error('Не удалось открыть практику. Обновите расписание.');
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
            toast.error(error.error || 'Не удалось удалить практику');
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
            toast.error(data.error || 'Не удалось удалить практику');
            // Обновляем календарь для синхронизации
            if (calendar) {
                calendar.refetchEvents();
            }
        }
    } catch (error) {
        console.error('❌ Delete practice error:', error);
        toast.error('Не удалось удалить практику');
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
                    toast.error(data.error || 'Не удалось обновить практику');
                }
            } catch (error) {
                console.error('Update practice error:', error);
                toast.error('Не удалось обновить практику');
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
        completed: 'Проведён',
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
    const returnBtn = document.getElementById('returnLessonBtn');
    const reopenBtn = document.getElementById('reopenLessonBtn');
    const hintEl = document.getElementById('approveClassHint');
    const saveBtn = document.querySelector('#attendanceModal button[onclick="saveAttendance()"]');
    const noOneBtn = document.querySelector('#attendanceModal .mark-no-one-btn');
    const postponeBtn = document.querySelector('#attendanceModal button[onclick="postponeClass()"]');
    if (!approveBtn) return;

    const closed = ['completed', 'cancelled'].includes(classData.status);
    const canApprove = typeof isAdmin === 'function' && isAdmin()
        && !classData.isPractice
        && !closed
        && classData.status === 'pending_admin_review';

    if (saveBtn) {
        saveBtn.disabled = closed;
        saveBtn.title = closed ? 'Урок уже закрыт' : '';
    }
    if (noOneBtn) {
        noOneBtn.disabled = closed;
        noOneBtn.title = closed ? 'Урок уже закрыт' : '';
    }
    if (postponeBtn) {
        postponeBtn.disabled = closed;
        postponeBtn.title = closed ? 'Урок уже закрыт' : '';
    }

    approveBtn.style.display = canApprove ? 'block' : 'none';
    approveBtn.disabled = !canApprove;
    approveBtn.title = canApprove
        ? 'Подтвердить урок и списать занятия'
        : 'Доступно после отправки отчёта преподавателем';
    if (returnBtn) {
        returnBtn.style.display = canApprove ? 'block' : 'none';
        returnBtn.disabled = !canApprove;
    }
    if (reopenBtn) {
        const canReopen = typeof isAdmin === 'function' && isAdmin() && closed && !classData.isPractice;
        reopenBtn.style.display = canReopen ? 'block' : 'none';
        reopenBtn.disabled = !canReopen;
        reopenBtn.textContent = classData.status === 'cancelled'
            ? 'ВОССТАНОВИТЬ ОТМЕНЁННЫЙ УРОК'
            : 'ПЕРЕСМОТРЕТЬ ПОДТВЕРЖДЁННЫЙ УРОК';
    }

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
    if (isApprovingClass) return;
    isApprovingClass = true;

    const classId = currentClassForAttendance.id;
    const savedClassData = { ...currentClassForAttendance };

    const approveBtn = document.getElementById('approveClassBtn');
    if (approveBtn) approveBtn.disabled = true;

    let freshClass;
    try {
        if (
            currentClassForAttendance.teacherOutcomeHint === 'held'
            && currentClassForAttendance.status === 'pending_admin_review'
        ) {
            await persistAttendanceForClass(classId, savedClassData);
        }
        freshClass = await hydrateClassDataFromServer(savedClassData);
    } catch (error) {
        toast.error(error.message || 'Не удалось сохранить выбранную посещаемость');
        isApprovingClass = false;
        if (approveBtn) approveBtn.disabled = false;
        return;
    }
    currentClassForAttendance = freshClass;
    renderLessonReportFields(freshClass);
    updateAttendanceActionButtons(freshClass);

    if (freshClass.status !== 'pending_admin_review') {
        toast.error('Сначала преподаватель должен отправить отчёт по уроку в приложении');
        isApprovingClass = false;
        if (approveBtn) approveBtn.disabled = false;
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
        isApprovingClass = false;
        if (approveBtn) approveBtn.disabled = false;
        return;
    }

    try {
        if (freshClass.teacherOutcomeHint !== 'not_held') {
            await persistAttendanceForClass(classId, savedClassData);
        }

        const chargeStudentIds = getStudentsToCharge();
        if (
            freshClass.teacherOutcomeHint !== 'not_held' &&
            chargeStudentIds.length &&
            currentBillingClassId !== classId
        ) {
            await loadLessonBillingOptions(classId, chargeStudentIds);
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
        const confirmText = freshClass.teacherOutcomeHint === 'not_held'
            ? 'Подтвердить, что урок не состоялся? Списаний не будет.'
            : `Подтвердить урок и выполнить выбранные списания?\n\nС балансов учеников будет списано: ${chargeTotal.toLocaleString('ru-RU')} ₸. При нехватке средств баланс станет отрицательным.`;
        const confirmed = await customConfirm(confirmText);
        if (!confirmed) return;

        const response = await fetch(`${API_URL}/classes/${classId}/approve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`,
                'X-Idempotency-Key': generateIdempotencyKey()
            },
            body: JSON.stringify({
                deduct: freshClass.teacherOutcomeHint !== 'not_held',
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
        isApprovingClass = false;
        if (approveBtn) approveBtn.disabled = false;
    }
}

async function runLessonLifecycleAction(path, confirmation, successMessage) {
    if (!currentClassForAttendance?.id) return;
    if (isLifecycleSubmitting) return;

    const classId = currentClassForAttendance.id;
    const confirmed = await customConfirm(confirmation, { icon: 'warning' });
    if (!confirmed) return;
    const reason = window.prompt('Причина изменения (для журнала):')?.trim();
    if (!reason) {
        toast.warning('Укажите причину изменения');
        return;
    }

    isLifecycleSubmitting = true;
    const returnBtn = document.getElementById('returnLessonBtn');
    const reopenBtn = document.getElementById('reopenLessonBtn');
    const postponeBtn = document.querySelector('#attendanceModal button[onclick="postponeClass()"]');
    if (returnBtn) returnBtn.disabled = true;
    if (reopenBtn) reopenBtn.disabled = true;
    if (postponeBtn) postponeBtn.disabled = true;

    // Закрываем модальное окно ДО отправки запроса
    closeAttendanceModal();

    try {
        const response = await fetch(`${API_URL}/classes/${classId}/${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`,
                'X-Idempotency-Key': generateIdempotencyKey()
            },
            body: JSON.stringify({ reason })
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Не удалось изменить урок');
        toast.success(successMessage);
        if (calendar) calendar.refetchEvents();
        updatePendingAttendanceBadge();
        updatePendingReviewBadge();
    } catch (error) {
        toast.error(error.message || 'Не удалось изменить урок');
    } finally {
        isLifecycleSubmitting = false;
        if (returnBtn) returnBtn.disabled = false;
        if (reopenBtn) reopenBtn.disabled = false;
        if (postponeBtn) postponeBtn.disabled = false;
    }
}

function returnLessonToTeacher() {
    return runLessonLifecycleAction(
        'return-to-teacher',
        'Вернуть урок преподавателю для исправления? Списаний ещё нет.',
        'Урок возвращён преподавателю'
    );
}

function reopenLesson() {
    const wasCancelled = currentClassForAttendance?.status === 'cancelled';
    return runLessonLifecycleAction(
        'reopen',
        wasCancelled
            ? 'Восстановить отменённый урок в расписании? Связанные списания и экстренные заморозки будут возвращены.'
            : 'Пересмотреть подтверждённый урок? Все выполненные списания будут автоматически возвращены.',
        wasCancelled ? 'Отменённый урок восстановлен' : 'Урок открыт для повторной проверки'
    );
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
        <div class="lesson-billing-panel">
            <div class="lesson-billing-panel__header">
                <div>
                    <p class="lesson-billing-panel__eyebrow">Финальное списание</p>
                    <h3>Проверьте сумму</h3>
                </div>
                <span class="lesson-billing-panel__badge">${students.length} ученик(ов)</span>
            </div>
            <p class="lesson-billing-panel__hint">
                Выберите тариф для расчёта средней цены или укажите сумму вручную. После подтверждения баланс может стать отрицательным.
            </p>
            <div class="lesson-billing-panel__list">
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
    const ageBadge = typeof renderStudentAgeBadge === 'function'
        ? renderStudentAgeBadge(student.dateOfBirth)
        : '';

    return `
        <div class="lesson-billing-row" data-student-id="${student.studentId}">
            <div class="lesson-billing-row__head">
                <strong>${escapeHtml(student.name)}${ageBadge}</strong>
                <span class="${currentDebt > 0 ? 'is-debt' : ''}">Баланс: ${(student.accountBalance || 0).toLocaleString('ru-RU')} ₸</span>
            </div>
            <div class="lesson-billing-row__controls">
                <select class="admin-input lesson-billing-membership">
                    ${options}
                    <option value="" ${student.suggestedMembershipId ? '' : 'selected'}>Без тарифа — сумма вручную</option>
                </select>
                <label class="lesson-billing-amount-wrap">
                    <input class="admin-input lesson-billing-amount" type="number" min="0" step="1" value="${student.suggestedAmount || 0}" style="min-width:0;">
                    <span>₸</span>
                </label>
            </div>
        </div>
    `;
}

function collectLessonBillingDecisions() {
    const billingRows = Array.from(document.querySelectorAll('.lesson-billing-row'));
    return allStudentsForAttendance.map(student => {
        const studentId = student._id || student.id;
        const isPresent = currentAttendanceData[studentId] || false;
        
        let status = 'present';
        if (!isPresent) {
            status = currentAbsenceData[studentId] || 'excused_absence';
        }

        const row = billingRows.find(r => r.dataset.studentId === studentId.toString());
        
        let membershipId = null;
        let amount = 0;

        if (row) {
            membershipId = row.querySelector('.lesson-billing-membership')?.value || null;
            amount = Math.max(0, Math.round(Number(row.querySelector('.lesson-billing-amount')?.value) || 0));
        }

        return {
            studentId: studentId.toString(),
            attendanceStatus: status,
            membershipId,
            amount
        };
    });
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
window.returnLessonToTeacher = returnLessonToTeacher;
window.reopenLesson = reopenLesson;
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
window.closeScheduleDetails = closeScheduleDetails;
window.openSelectedScheduleLesson = openSelectedScheduleLesson;
window.conductSelectedScheduleLesson = conductSelectedScheduleLesson;
window.cancelSelectedScheduleLesson = cancelSelectedScheduleLesson;
window.openScheduleStudent = openScheduleStudent;
window.openScheduleTeacher = openScheduleTeacher;
window.openScheduleForRoom = openScheduleForRoom;
window.openScheduleConfirmation = openScheduleConfirmation;

// Вызываем инициализацию
bindScheduleStudentLinkHandlers();

setTimeout(() => {
    initPracticeForm();
}, 1000);
