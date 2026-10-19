// План 1.11: экзамен сектора в CRM.
// Экзамен готовит администратор платформы обучения; здесь видна очередь ожидающих,
// плашка в «Подтверждении уроков» и назначение в свободное время расписания.

let sectorExamQueue = null;
let sectorExamQueueLoadedAt = 0;

function sectorExamEscape(value) {
    const node = document.createElement('div');
    node.textContent = value ?? '';
    return node.innerHTML;
}

function sectorExamDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Asia/Aqtobe' }).format(date);
}

async function loadPendingSectorExams(force = false) {
    if (!force && sectorExamQueue && Date.now() - sectorExamQueueLoadedAt < 30000) return sectorExamQueue;
    try {
        const response = await fetch(`${API_URL}/sector-exams/pending`, {
            headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) throw new Error(payload.error || 'Не удалось получить экзамены');
        sectorExamQueue = { available: payload.available !== false, exams: payload.exams || [], error: payload.error || null };
    } catch (error) {
        sectorExamQueue = { available: false, exams: [], error: error.message };
    }
    sectorExamQueueLoadedAt = Date.now();
    return sectorExamQueue;
}

/** Плашка «требуется назначить экзаменационный урок» в разделе подтверждения уроков. */
async function renderSectorExamBanner(force = false) {
    const root = document.getElementById('sectorExamBanner');
    if (!root) return;
    if (typeof isAdmin === 'function' && !isAdmin()) {
        root.hidden = true;
        return;
    }
    const queue = await loadPendingSectorExams(force);
    if (!queue.available) {
        root.hidden = false;
        root.className = 'sector-exam-banner is-muted';
        root.innerHTML = `<p>Не удалось проверить экзамены секторов: ${sectorExamEscape(queue.error || 'платформа обучения не ответила')}.</p>`;
        return;
    }
    if (!queue.exams.length) {
        root.hidden = true;
        root.innerHTML = '';
        return;
    }
    root.hidden = false;
    root.className = 'sector-exam-banner';
    root.innerHTML = `
        <div class="sector-exam-banner__head">
            <strong>🎓 Требуется назначить экзаменационный урок · ${queue.exams.length}</strong>
            <button type="button" class="btn-primary" onclick="goToScheduleForSectorExam()">Назначить в расписании</button>
        </div>
        <p class="sector-exam-banner__hint">Экзамен — бесплатный дополнительный урок. Откройте расписание, нажмите на свободное время и выберите «Назначить экзамен».</p>
        <ul class="sector-exam-banner__list">
            ${queue.exams.map(exam => `
                <li data-testid="sector-exam-pending">
                    <span class="sector-exam-banner__student">${sectorExamEscape(exam.studentName)}</span>
                    <span>${sectorExamEscape(exam.title)}</span>
                    <span class="sector-exam-banner__meta">${exam.itemsCount} пунктов${exam.sentForScheduleAt ? ` · ждёт с ${sectorExamEscape(sectorExamDate(exam.sentForScheduleAt))}` : ''}</span>
                </li>
            `).join('')}
        </ul>
    `;
}

function goToScheduleForSectorExam() {
    if (typeof window.showSection === 'function') window.showSection('schedule');
    toast.info('Нажмите на свободное время в расписании и выберите «Назначить экзамен»', 6000);
}

/** В окне нового урока: подсказка, что есть экзамены к назначению. */
async function updateClassModalSectorExamOffer() {
    const offer = document.getElementById('classSectorExamOffer');
    if (!offer) return;
    const editing = Boolean(document.getElementById('classId')?.value);
    if (editing || (typeof isAdmin === 'function' && !isAdmin())) {
        offer.hidden = true;
        return;
    }
    const queue = await loadPendingSectorExams();
    offer.hidden = !queue.available || !queue.exams.length;
    const text = document.getElementById('classSectorExamOfferText');
    if (text && queue.exams.length) text.textContent = `Ждут назначения экзамены: ${queue.exams.length}`;
}

async function fillSectorExamSelect(select, url, placeholder, mapOption) {
    const response = await fetch(`${API_URL}${url}`, { headers: { Authorization: `Bearer ${getAuthToken()}` } });
    const payload = await response.json().catch(() => ({}));
    const rows = payload.students || payload.rooms || payload.data || [];
    select.innerHTML = `<option value="">${placeholder}</option>` + rows.map(mapOption).join('');
}

let sectorExamTargetLesson = null;

function sectorExamDateKey(value) {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(String(value))) return String(value).slice(0, 10);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

/**
 * Окно назначения. Без аргументов — новый урок экзамена в свободное время из окна урока.
 * С { lesson } — добавить экзамены в уже назначенный урок экзамена (время, кабинет и преподаватель его).
 */
async function openSectorExamModal(options = {}) {
    const modal = document.getElementById('sectorExamModal');
    const error = document.getElementById('sectorExamError');
    if (!modal) return;
    error.hidden = true;
    const queue = await loadPendingSectorExams(true);
    if (!queue.available || !queue.exams.length) {
        toast.error(queue.available ? 'Нет экзаменов, ожидающих назначения' : (queue.error || 'Платформа обучения не ответила'));
        return;
    }
    sectorExamTargetLesson = options.lesson || null;
    const choices = document.getElementById('sectorExamChoices');
    choices.innerHTML = queue.exams.map((exam, index) => `
        <label class="sector-exam-choice__item">
            <input type="checkbox" name="sectorExamChoice" value="${sectorExamEscape(exam.examId)}"
                data-teacher="${sectorExamEscape(exam.suggestedTeacherId || '')}" ${index === 0 && queue.exams.length === 1 ? 'checked' : ''}>
            <span><strong>${sectorExamEscape(exam.studentName)}</strong>
                <small>${sectorExamEscape(exam.title)} · ${exam.itemsCount} пунктов</small></span>
        </label>`).join('');

    const target = document.getElementById('sectorExamTarget');
    const slotFields = document.getElementById('sectorExamSlotFields');
    const submit = document.getElementById('sectorExamSubmit');
    if (sectorExamTargetLesson) {
        const lesson = sectorExamTargetLesson;
        target.hidden = false;
        target.textContent = `В урок «${lesson.title || 'Экзамен'}»: ${sectorExamDate(lesson.start || lesson.date)}, ${lesson.startTime || ''}–${lesson.endTime || ''}`;
        slotFields.hidden = true;
        submit.textContent = 'ДОБАВИТЬ В УРОК';
    } else {
        target.hidden = true;
        slotFields.hidden = false;
        submit.textContent = 'НАЗНАЧИТЬ ЭКЗАМЕН';
        document.getElementById('sectorExamDate').value = document.getElementById('classDate')?.value || '';
        const start = document.getElementById('classStartTime')?.value || '18:00';
        document.getElementById('sectorExamStart').value = start;
        const [hours, minutes] = start.split(':').map(Number);
        const end = new Date(2000, 0, 1, hours, minutes + 60);
        document.getElementById('sectorExamEnd').value = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;

        const teacherSelect = document.getElementById('sectorExamTeacher');
        const roomSelect = document.getElementById('sectorExamRoom');
        await Promise.all([
            fillSectorExamSelect(teacherSelect, '/students?role=teacher&limit=100', 'Выберите преподавателя', teacher => (
                `<option value="${sectorExamEscape(teacher._id || teacher.id)}">${sectorExamEscape(typeof formatSchedulePersonName === 'function' ? formatSchedulePersonName(teacher, 'Преподаватель') : [teacher.lastName, teacher.name].filter(Boolean).join(' '))}</option>`
            )),
            fillSectorExamSelect(roomSelect, '/rooms', 'Выберите кабинет', room => (
                `<option value="${sectorExamEscape(room._id || room.id)}">${sectorExamEscape(room.name)}</option>`
            )),
        ]).catch(() => toast.error('Не удалось загрузить преподавателей или кабинеты'));
        const classRoom = document.getElementById('classRoom')?.value;
        if (classRoom) roomSelect.value = classRoom;
        // Предлагаем закреплённого преподавателя первого отмеченного ученика, пока админ не выбрал сам.
        let teacherTouched = false;
        teacherSelect.onchange = () => { teacherTouched = true; };
        const applySuggestedTeacher = () => {
            if (teacherTouched) return;
            const first = choices.querySelector('input[name="sectorExamChoice"]:checked');
            const suggested = first?.dataset.teacher;
            if (suggested && teacherSelect.querySelector(`option[value="${CSS.escape(suggested)}"]`)) teacherSelect.value = suggested;
        };
        choices.onchange = applySuggestedTeacher;
        applySuggestedTeacher();
        if (typeof closeClassModal === 'function') closeClassModal();
    }
    modal.classList.add('show');
    choices.querySelector('input')?.focus();
}

function closeSectorExamModal() {
    document.getElementById('sectorExamModal')?.classList.remove('show');
    sectorExamTargetLesson = null;
}

async function submitSectorExamSchedule(event) {
    event.preventDefault();
    const submit = document.getElementById('sectorExamSubmit');
    const error = document.getElementById('sectorExamError');
    const examIds = [...document.querySelectorAll('#sectorExamChoices input[name="sectorExamChoice"]:checked')].map(input => input.value);
    error.hidden = true;
    if (!examIds.length) {
        error.textContent = 'Отметьте хотя бы один экзамен';
        error.hidden = false;
        return;
    }
    const lesson = sectorExamTargetLesson;
    const body = lesson
        ? { examIds, classId: lesson.id || lesson._id }
        : {
            examIds,
            date: document.getElementById('sectorExamDate').value,
            startTime: document.getElementById('sectorExamStart').value,
            endTime: document.getElementById('sectorExamEnd').value,
            teacherId: document.getElementById('sectorExamTeacher').value,
            roomId: document.getElementById('sectorExamRoom').value,
        };
    submit.disabled = true;
    try {
        const response = await fetch(`${API_URL}/sector-exams/book`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) throw new Error(payload.error || 'Не удалось назначить экзамен');
        closeSectorExamModal();
        const what = payload.booked > 1 ? `Экзамены (${payload.booked}) назначены одним уроком` : 'Экзамен назначен';
        if (payload.platformConfirmed === false) {
            toast.warning(`${what}, но платформа обучения пока не подтвердила. Повтор — в журнале интеграций.`, 7000);
        } else {
            toast.success(`${what}. Ученики, родители и преподаватель получат уведомление; сообщения WhatsApp — в «WhatsApp-напоминаниях».`, 6000);
        }
        sectorExamQueue = null;
        // Приглашения в WhatsApp собираются при следующем открытии очереди.
        if (typeof whatsappReminderData !== 'undefined') whatsappReminderData = null;
        if (typeof calendar !== 'undefined' && calendar) calendar.refetchEvents();
        renderSectorExamBanner(true);
    } catch (reason) {
        error.textContent = reason.message;
        error.hidden = false;
    } finally {
        submit.disabled = false;
    }
}

window.renderSectorExamBanner = renderSectorExamBanner;
window.openSectorExamModal = openSectorExamModal;
window.closeSectorExamModal = closeSectorExamModal;
window.submitSectorExamSchedule = submitSectorExamSchedule;
window.goToScheduleForSectorExam = goToScheduleForSectorExam;
window.updateClassModalSectorExamOffer = updateClassModalSectorExamOffer;
