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

        container.innerHTML = `
            <table class="admin-table" style="width:100%;">
                <thead>
                    <tr>
                        <th>Дата</th>
                        <th>Урок</th>
                        <th>Преподаватель</th>
                        <th>Группа / ученик</th>
                        <th>Тема</th>
                        <th>Статус</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${classes.map(cls => {
                        const attended = (cls.attendees || []).filter(a => a.attended).length;
                        const studentLabel = cls.individualStudent
                            ? `${cls.individualStudent.name} ${cls.individualStudent.lastName || ''}`.trim()
                            : (cls.group?.name || '—');
                        const teacher = cls.teacher
                            ? `${cls.teacher.name} ${cls.teacher.lastName || ''}`.trim()
                            : '—';
                        return `
                            <tr>
                                <td>${formatLessonDate(cls.date, cls.startTime, cls.endTime)}</td>
                                <td><strong>${escapeHtml(cls.title)}</strong>${cls.noOneAttended ? '<br><small style="color:#ef4444">Никто не пришёл</small>' : ''}</td>
                                <td>${escapeHtml(teacher)}</td>
                                <td>${escapeHtml(studentLabel)}${attended ? `<br><small>Пришли: ${attended}</small>` : ''}</td>
                                <td>${cls.topic ? escapeHtml(cls.topic).slice(0, 60) + (cls.topic.length > 60 ? '…' : '') : '<span style="opacity:0.4">—</span>'}</td>
                                <td><span class="status-badge pending">${formatClassStatusLabel(cls.status)}</span></td>
                                <td style="white-space:nowrap;">
                                    <button class="btn-primary" type="button" data-lesson-review-id="${escapeHtml(cls.id)}" style="padding:6px 12px; font-size:0.85rem;">Открыть</button>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
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
            teacherId: cls.teacherId || cls.teacher?.id,
            teacherName: cls.teacher ? `${cls.teacher.name} ${cls.teacher.lastName || ''}`.trim() : '',
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
            roomName: cls.room?.name,
            roomId: cls.roomId,
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
