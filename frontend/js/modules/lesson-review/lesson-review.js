// Очередь уроков на подтверждение (только админ)

function formatClassStatusLabel(status) {
    const labels = {
        scheduled: 'Запланирован',
        started: 'Начат',
        pending_admin_review: 'На подтверждении',
        completed: 'Подтверждён',
        cancelled: 'Отменён',
        not_filled: 'Не заполнен'
    };
    return labels[status] || status;
}

function formatLessonDate(dateStr, startTime, endTime) {
    const d = new Date(dateStr);
    return `${d.toLocaleDateString('ru-RU')} ${startTime}–${endTime}`;
}

function formatLessonReviewPerson(person, fallback = '') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function getLessonReviewId(cls) {
    return cls?.id || cls?._id || '';
}

function getLessonReviewAttendees(cls) {
    return Array.isArray(cls?.attendees) ? cls.attendees : [];
}

function getLessonReviewParticipantLabel(cls) {
    return cls?.individualStudent
        ? formatLessonReviewPerson(cls.individualStudent, 'Индивидуальный ученик')
        : (cls?.group?.name || cls?.groupName || 'Группа/ученик не указан');
}

function getLessonReviewTeacherName(cls) {
    return cls?.teacher
        ? formatLessonReviewPerson(cls.teacher, '')
        : (cls?.teacherName || cls?.instructor || '');
}

function hasLessonReviewText(value) {
    return String(value || '').trim().length >= 3;
}

function getLessonReviewStats(cls) {
    const attendees = getLessonReviewAttendees(cls);
    const present = attendees.filter(item => item.attended).length;
    const absent = attendees.filter(item => item.attended === false).length;
    const charged = attendees.filter(item => Number(item.chargeAmount || 0) > 0 || item.attendanceStatus === 'unexcused_absence').length;
    const unresolved = attendees.filter(item => item.attended === false && !item.attendanceStatus && !item.absenceStatus).length;

    return {
        total: attendees.length,
        present,
        absent,
        charged,
        unresolved
    };
}

function getLessonReviewChecks(cls) {
    const checks = [];
    const stats = getLessonReviewStats(cls);
    const teacherName = getLessonReviewTeacherName(cls);
    const hasParticipant = Boolean(
        cls?.individualStudent
        || cls?.group
        || cls?.groupId
        || cls?.individualStudentId
        || cls?.classType === 'trial',
    );
    const hasRoom = Boolean(cls?.room || cls?.roomId || cls?.roomName);

    if (!teacherName || teacherName === '—') {
        checks.push({ level: 'danger', title: 'Нет педагога', detail: 'После подтверждения зарплата может не попасть нужному преподавателю' });
    }

    if (!hasParticipant) {
        checks.push({ level: 'danger', title: 'Нет ученика/группы', detail: 'Нельзя безопасно списать занятие без привязки к клиенту' });
    }

    if (!stats.total && !cls?.noOneAttended) {
        checks.push({ level: 'danger', title: 'Нет посещаемости', detail: 'Сначала откройте урок и отметьте присутствующих' });
    }

    if (stats.unresolved > 0) {
        checks.push({ level: 'danger', title: `${stats.unresolved} без причины`, detail: 'Для отсутствующих выберите: уважительно, прогул или заморозка' });
    }

    if (cls?.noOneAttended || (stats.total > 0 && stats.present === 0)) {
        checks.push({ level: 'warning', title: 'Никто не пришёл', detail: 'Проверьте, не нужно ли вернуть преподавателю или поставить заморозку' });
    }

    if (stats.charged > 0) {
        checks.push({ level: 'warning', title: `${stats.charged} списаний`, detail: 'Подтверждение изменит баланс/абонемент учеников' });
    }

    if (!hasLessonReviewText(cls?.topic)) {
        checks.push({ level: 'warning', title: 'Нет темы', detail: 'Родителю и истории обучения будет сложно понять, что прошли' });
    }

    if (!hasLessonReviewText(cls?.lessonSummary) && !hasLessonReviewText(cls?.teacherComment)) {
        checks.push({ level: 'warning', title: 'Нет итога урока', detail: 'Попросите преподавателя дописать результат перед закрытием' });
    }

    if (!hasRoom) {
        checks.push({ level: 'info', title: 'Зал не указан', detail: 'Не критично для списаний, но ухудшает разбор конфликтов расписания' });
    }

    if (cls?.classType === 'trial' && !cls?.trialReport) {
        checks.push({ level: 'danger', title: 'Нет анкеты пробного', detail: 'Без анкеты нельзя собрать AI-анализ и нормальную историю пробного' });
    }

    return checks;
}

function getLessonReviewPriority(checks) {
    if (checks.some(item => item.level === 'danger')) return 'danger';
    if (checks.some(item => item.level === 'warning')) return 'warning';
    return 'ok';
}

function getLessonReviewPriorityWeight(priority) {
    return priority === 'danger' ? 3 : (priority === 'warning' ? 2 : 1);
}

function renderLessonReviewChecks(checks, options = {}) {
    if (!checks.length) {
        return options.showOk
            ? '<div class="lesson-review-checks is-ok"><span>Готово к подтверждению</span></div>'
            : '';
    }

    const limit = options.limit || 3;
    const visible = checks.slice(0, limit);
    const hiddenCount = checks.length - visible.length;
    return `
        <div class="lesson-review-checks">
            ${visible.map(item => `
                <span class="lesson-review-check is-${item.level}" title="${escapeHtml(item.detail)}">
                    ${escapeHtml(item.title)}
                </span>
            `).join('')}
            ${hiddenCount > 0 ? `<span class="lesson-review-check is-more">+${hiddenCount}</span>` : ''}
        </div>
    `;
}

function renderLessonReviewSummary(classes) {
    const totals = classes.reduce((acc, cls) => {
        const checks = getLessonReviewChecks(cls);
        const priority = getLessonReviewPriority(checks);
        acc[priority] = (acc[priority] || 0) + 1;
        acc.total += 1;
        acc.attendees += getLessonReviewStats(cls).total;
        return acc;
    }, { total: 0, danger: 0, warning: 0, ok: 0, attendees: 0 });

    return `
        <div class="lesson-review-command">
            <div>
                <p>Очередь подтверждения</p>
                <h3>Сначала закрывайте красные уроки</h3>
                <span>Проверяйте посещаемость, списания и отчёт до подтверждения.</span>
            </div>
            <div class="lesson-review-command-stats">
                <strong>${totals.total}</strong><span>в очереди</span>
                <strong>${totals.danger}</strong><span>красных</span>
                <strong>${totals.attendees}</strong><span>отметок</span>
            </div>
        </div>
    `;
}

async function renderLessonReviewQueue() {
    const container = document.getElementById('lessonReviewList');
    if (!container) return;

    container.innerHTML = `<p style="text-align:center; opacity:0.6; padding:40px;">Загрузка...</p>`;

    try {
        const response = await fetch(`${API_URL}/classes/pending-review`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });

        if (!response.ok) throw new Error('Ошибка загрузки очереди');

        const data = await response.json();
        const classes = data.classes || [];

        if (!classes.length) {
            container.innerHTML = `<p style="text-align:center; opacity:0.5; padding:40px;">Нет уроков на подтверждении</p>`;
            return;
        }

        const sortedClasses = [...classes].sort((a, b) => {
            const priorityDiff = getLessonReviewPriorityWeight(getLessonReviewPriority(getLessonReviewChecks(b)))
                - getLessonReviewPriorityWeight(getLessonReviewPriority(getLessonReviewChecks(a)));
            if (priorityDiff !== 0) return priorityDiff;
            return new Date(a.date) - new Date(b.date);
        });

        container.innerHTML = `
            ${renderLessonReviewSummary(sortedClasses)}
            <div class="lesson-review-list">
                ${sortedClasses.map(cls => {
                    const checks = getLessonReviewChecks(cls);
                    const priority = getLessonReviewPriority(checks);
                    const stats = getLessonReviewStats(cls);
                    const studentLabel = getLessonReviewParticipantLabel(cls);
                    const teacher = getLessonReviewTeacherName(cls) || '—';
                    const topic = cls.topic ? escapeHtml(cls.topic).slice(0, 80) + (cls.topic.length > 80 ? '...' : '') : 'Тема не указана';
                    const classId = getLessonReviewId(cls);
                    return `
                        <article class="lesson-review-card is-${priority}">
                            <div class="lesson-review-card-main">
                                <div class="lesson-review-card-head">
                                    <span>${formatLessonDate(cls.date, cls.startTime, cls.endTime)}</span>
                                    <span class="status-badge pending">${formatClassStatusLabel(cls.status)}</span>
                                </div>
                                <h3>${escapeHtml(cls.title || 'Урок')}</h3>
                                <p>${topic}</p>
                                ${renderLessonReviewChecks(checks, { showOk: true })}
                            </div>
                            <div class="lesson-review-meta">
                                <div><span>Педагог</span><strong>${escapeHtml(teacher)}</strong></div>
                                <div><span>Группа / ученик</span><strong>${escapeHtml(studentLabel)}</strong></div>
                                <div><span>Посещаемость</span><strong>${stats.present}/${stats.total || 0}</strong></div>
                                <div><span>Списания</span><strong>${stats.charged}</strong></div>
                            </div>
                            <button class="btn-primary" type="button" data-lesson-review-id="${escapeHtml(classId)}">Открыть проверку</button>
                        </article>
                    `;
                }).join('')}
            </div>
        `;
        container.querySelectorAll('[data-lesson-review-id]').forEach(button => {
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                openLessonReviewItem(button.dataset.lessonReviewId);
            });
        });
    } catch (error) {
        console.error('renderLessonReviewQueue error:', error);
        container.innerHTML = `<p style="color:#ef4444; padding:20px;">${escapeHtml(error.message)}</p>`;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function openLessonReviewItem(classId) {
    try {
        const response = await fetch(`${API_URL}/classes/${classId}`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        if (!response.ok) throw new Error('Не удалось загрузить урок');

        const data = await response.json();
        const cls = data.class || data;

        const classData = {
            id: cls.id || cls._id,
            title: cls.title,
            groupId: cls.groupId,
            groupName: cls.group?.name,
            teacherId: cls.teacherId || cls.teacher?.id || cls.teacher?._id,
            teacherName: getLessonReviewTeacherName(cls),
            date: new Date(cls.date),
            startTime: cls.startTime,
            endTime: cls.endTime,
            status: cls.status,
            topic: cls.topic,
            lessonGoals: cls.lessonGoals,
            lessonSummary: cls.lessonSummary,
            homeworkDraft: cls.homeworkDraft,
            nextLessonFocus: cls.nextLessonFocus,
            materials: cls.materials,
            teacherComment: cls.teacherComment,
            noOneAttended: cls.noOneAttended,
            attendees: cls.attendees || [],
            roomName: cls.room?.name || cls.roomName,
            roomId: cls.roomId || cls.room?.id || cls.room?._id,
            classType: cls.classType,
            isPractice: cls.isPractice
        };

        if (typeof openAttendanceModal === 'function') {
            await openAttendanceModal(classData);
        } else {
            toast.error('Модуль расписания не загружен');
        }
    } catch (error) {
        console.error('openLessonReviewItem error:', error);
        toast.error(error.message);
    }
}

window.renderLessonReviewQueue = renderLessonReviewQueue;
window.openLessonReviewItem = openLessonReviewItem;
