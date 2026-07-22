function dashboardMoney(value) {
    return `${new Intl.NumberFormat('ru-RU').format(Number(value) || 0)} ₸`;
}

let dashboardLastData = null;
let dashboardEditingStaffTaskId = null;

const dashboardStaffRoleLabels = {
    sales_manager: 'Менеджер',
    teacher: 'Преподаватель',
    admin: 'Администратор',
    super_admin: 'Управляющий',
};

const dashboardTaskPriorityLabels = {
    low: 'Низкий',
    normal: 'Обычный',
    high: 'Высокий',
    urgent: 'Срочный',
};

function dashboardManualTaskItems() {
    const tasks = dashboardLastData?.manualTasks || {};
    return [...(tasks.mine || []), ...(tasks.delegated || [])];
}

function dashboardFindManualTask(id) {
    return dashboardManualTaskItems().find(task => String(task.id) === String(id));
}

function dashboardTaskDueText(value) {
    if (!value) return 'Без срока';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Без срока';
    return date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function dashboardTaskDueInput(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}

function dashboardTaskIsOverdue(task) {
    return Boolean(task.dueAt && new Date(task.dueAt).getTime() < Date.now());
}

function dashboardRenderManualTask(task, mode) {
    const isMine = mode === 'mine';
    const overdue = dashboardTaskIsOverdue(task);
    const person = isMine ? task.createdBy : task.assignee;
    const personPrefix = isMine ? 'Поставил' : 'Исполнитель';
    return `
        <article class="manual-task-card priority-${escapeBookingText(task.priority)} ${overdue ? 'is-overdue' : ''}">
            <div class="manual-task-card-main">
                <div class="manual-task-title-row">
                    <span class="manual-task-priority" title="${escapeBookingText(dashboardTaskPriorityLabels[task.priority] || 'Обычный приоритет')}"></span>
                    <strong>${escapeBookingText(task.title)}</strong>
                    ${overdue ? '<span class="manual-task-overdue">Просрочено</span>' : ''}
                    ${task.status === 'in_progress' ? '<span class="manual-task-progress">В работе</span>' : ''}
                </div>
                ${task.description ? `<p>${escapeBookingText(task.description)}</p>` : ''}
                <div class="manual-task-meta">
                    <span>${escapeBookingText(dashboardTaskDueText(task.dueAt))}</span>
                    <span>${personPrefix}: ${escapeBookingText(person?.name || 'не указан')}</span>
                    ${!isMine && task.assignee?.role === 'teacher' ? '<span class="is-app">Уведомление в приложении</span>' : ''}
                </div>
            </div>
            <div class="manual-task-actions">
                ${task.status === 'open' ? `<button type="button" onclick="dashboardSetStaffTaskStatus('${task.id}', 'in_progress')">В работу</button>` : ''}
                <button type="button" class="is-complete" onclick="dashboardSetStaffTaskStatus('${task.id}', 'completed')" title="Завершить задачу">Готово</button>
                <button type="button" class="is-icon" onclick="dashboardOpenStaffTask('${task.id}')" title="Редактировать" aria-label="Редактировать задачу">✎</button>
                ${!isMine ? `<button type="button" class="is-icon is-delete" onclick="dashboardDeleteStaffTask('${task.id}')" title="Удалить" aria-label="Удалить задачу">×</button>` : ''}
            </div>
        </article>
    `;
}

function dashboardManualTaskList(items, mode) {
    if (!items.length) {
        return `<div class="manual-task-empty">${mode === 'mine' ? 'У вас нет назначенных задач' : 'Нет открытых задач для команды'}</div>`;
    }
    return `<div class="manual-task-list">${items.map(task => dashboardRenderManualTask(task, mode)).join('')}</div>`;
}

function dashboardManualTaskDialog(data) {
    const assignees = data?.manualTasks?.assignees || [];
    return `
        <dialog class="manual-task-dialog" id="dashboardStaffTaskDialog" onclick="if(event.target===this)dashboardCloseStaffTask()">
            <form class="manual-task-form" onsubmit="dashboardSaveStaffTask(event)">
                <div class="manual-task-form-head">
                    <div>
                        <p class="ops-eyebrow">Задача сотруднику</p>
                        <h3 id="dashboardStaffTaskDialogTitle">Новая задача</h3>
                    </div>
                    <button type="button" class="manual-task-close" onclick="dashboardCloseStaffTask()" aria-label="Закрыть">×</button>
                </div>
                <label class="manual-task-field">Что нужно сделать
                    <input class="admin-input" id="dashboardTaskTitle" maxlength="160" required placeholder="Например, подтвердить расписание на август">
                </label>
                <label class="manual-task-field">Исполнитель
                    <select class="admin-select" id="dashboardTaskAssignee" required>
                        <option value="">Выберите сотрудника</option>
                        ${assignees.map(person => `<option value="${escapeBookingText(person.id)}">${escapeBookingText(person.name)} · ${escapeBookingText(dashboardStaffRoleLabels[person.role] || person.role)}</option>`).join('')}
                    </select>
                </label>
                <div class="manual-task-form-grid">
                    <label class="manual-task-field">Срок
                        <input class="admin-input" id="dashboardTaskDueAt" type="datetime-local">
                    </label>
                    <label class="manual-task-field">Приоритет
                        <select class="admin-select" id="dashboardTaskPriority">
                            <option value="normal">Обычный</option>
                            <option value="high">Высокий</option>
                            <option value="urgent">Срочный</option>
                            <option value="low">Низкий</option>
                        </select>
                    </label>
                </div>
                <label class="manual-task-field">Подробности
                    <textarea class="admin-input" id="dashboardTaskDescription" maxlength="2000" rows="4" placeholder="Контекст, контакты или ожидаемый результат"></textarea>
                </label>
                <div class="manual-task-form-actions">
                    <button type="button" onclick="dashboardCloseStaffTask()">Отмена</button>
                    <button type="submit" class="is-primary" id="dashboardTaskSubmit">Поставить задачу</button>
                </div>
            </form>
        </dialog>
    `;
}

function dashboardManualTaskBoard(data) {
    const tasks = data?.manualTasks || {};
    const mine = tasks.mine || [];
    const delegated = tasks.delegated || [];
    return `
        <section class="ops-command manual-task-board">
            <div class="ops-command-head">
                <div>
                    <p class="ops-eyebrow">Задачи команды</p>
                    <h3>Ручные поручения</h3>
                    <p>Назначайте дела администраторам, преподавателям и другим сотрудникам.</p>
                </div>
                <button type="button" class="manual-task-create" onclick="dashboardOpenStaffTask()">+ Поставить задачу</button>
            </div>
            <div class="manual-task-columns">
                <div>
                    <div class="manual-task-column-head"><span>Мне</span><strong>${mine.length}</strong></div>
                    ${dashboardManualTaskList(mine, 'mine')}
                </div>
                <div>
                    <div class="manual-task-column-head"><span>Поставлено команде</span><strong>${delegated.length}</strong></div>
                    ${dashboardManualTaskList(delegated, 'delegated')}
                </div>
            </div>
        </section>
        ${dashboardManualTaskDialog(data)}
    `;
}

function dashboardOpenStaffTask(id = null) {
    const dialog = document.getElementById('dashboardStaffTaskDialog');
    if (!dialog) return;
    const task = id ? dashboardFindManualTask(id) : null;
    dashboardEditingStaffTaskId = task?.id || null;
    document.getElementById('dashboardStaffTaskDialogTitle').textContent = task ? 'Редактировать задачу' : 'Новая задача';
    document.getElementById('dashboardTaskSubmit').textContent = task ? 'Сохранить' : 'Поставить задачу';
    document.getElementById('dashboardTaskTitle').value = task?.title || '';
    document.getElementById('dashboardTaskAssignee').value = task?.assignee?.id || '';
    document.getElementById('dashboardTaskDueAt').value = dashboardTaskDueInput(task?.dueAt);
    document.getElementById('dashboardTaskPriority').value = task?.priority || 'normal';
    document.getElementById('dashboardTaskDescription').value = task?.description || '';
    dialog.showModal();
    window.setTimeout(() => document.getElementById('dashboardTaskTitle')?.focus(), 50);
}

function dashboardCloseStaffTask() {
    document.getElementById('dashboardStaffTaskDialog')?.close();
    dashboardEditingStaffTaskId = null;
}

async function dashboardSaveStaffTask(event) {
    event.preventDefault();
    const submit = document.getElementById('dashboardTaskSubmit');
    const dueValue = document.getElementById('dashboardTaskDueAt').value;
    const body = {
        title: document.getElementById('dashboardTaskTitle').value.trim(),
        assigneeId: document.getElementById('dashboardTaskAssignee').value,
        dueAt: dueValue ? new Date(dueValue).toISOString() : null,
        priority: document.getElementById('dashboardTaskPriority').value,
        description: document.getElementById('dashboardTaskDescription').value.trim(),
    };
    const taskId = dashboardEditingStaffTaskId;
    submit.disabled = true;
    submit.textContent = 'Сохраняем...';
    try {
        const response = await fetch(`${API_URL}/admin/staff-tasks${taskId ? `/${taskId}` : ''}`, {
            method: taskId ? 'PATCH' : 'POST',
            headers: {
                Authorization: `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Не удалось сохранить задачу');
        dashboardCloseStaffTask();
        toast.success(taskId ? 'Задача обновлена' : 'Задача поставлена');
        await renderDashboard();
    } catch (error) {
        toast.error(error.message);
        submit.disabled = false;
        submit.textContent = taskId ? 'Сохранить' : 'Поставить задачу';
    }
}

async function dashboardSetStaffTaskStatus(id, status) {
    try {
        const response = await fetch(`${API_URL}/admin/staff-tasks/${id}`, {
            method: 'PATCH',
            headers: {
                Authorization: `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ status }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Не удалось обновить задачу');
        toast.success(status === 'completed' ? 'Задача завершена' : 'Задача взята в работу');
        await renderDashboard();
    } catch (error) {
        toast.error(error.message);
    }
}

async function dashboardDeleteStaffTask(id) {
    const task = dashboardFindManualTask(id);
    if (!task || !window.confirm(`Удалить задачу «${task.title}»?`)) return;
    try {
        const response = await fetch(`${API_URL}/admin/staff-tasks/${id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Не удалось удалить задачу');
        toast.success('Задача удалена');
        await renderDashboard();
    } catch (error) {
        toast.error(error.message);
    }
}

function dashboardDate(value, time) {
    const date = new Date(value);
    return `${date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}${time ? ` · ${time}` : ''}`;
}

function dashboardPersonName(person, fallback = '') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function dashboardGo(section) {
    document.querySelector(`.sidebar-link[data-section="${section}"]`)?.click();
}

function dashboardOpen(section, callback) {
    dashboardGo(section);
    if (typeof callback === 'function') {
        window.setTimeout(callback, 180);
    }
}

function dashboardCount(value) {
    return Number(value) || 0;
}

function dashboardRelativeTime(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    const diffMinutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
    if (diffMinutes < 60) return `${diffMinutes || 1} мин назад`;
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} ч назад`;
    return `${Math.round(diffHours / 24)} дн назад`;
}

function dashboardPhone(value) {
    return String(value || '').trim() || 'без телефона';
}

function dashboardPulseStrip(data) {
    const counts = data?.counts || {};
    const items = [
        {
            tone: 'accent',
            value: counts.newBookings,
            label: 'Новые заявки',
            note: 'назначить контакт',
            section: 'bookings',
        },
        {
            tone: 'warning',
            value: counts.pendingReview,
            label: 'Отчёты',
            note: 'подтвердить уроки',
            section: 'lesson-review',
        },
        {
            tone: 'danger',
            value: counts.notFilled,
            label: 'Без результата',
            note: 'закрыть занятия',
            section: 'schedule',
        },
        {
            tone: 'danger',
            value: counts.debtMemberships,
            label: 'Долги',
            note: 'разобрать оплаты',
            section: 'membership-actions',
        },
        {
            tone: 'warning',
            value: counts.expiringMemberships,
            label: 'Продления',
            note: 'пополнить баланс',
            section: 'membership-actions',
        },
    ];
    const active = items.filter(item => dashboardCount(item.value) > 0);

    if (!active.length) {
        return `
            <section class="ops-live-strip is-clear">
                <div>
                    <p class="ops-eyebrow">Сегодня</p>
                    <h3>Сейчас всё спокойно</h3>
                    <span>Новых заявок, долгов и незавершённых дел нет.</span>
                </div>
                <button type="button" onclick="renderDashboard()">Обновить</button>
            </section>
        `;
    }

    return `
        <section class="ops-live-strip">
            <div>
                <p class="ops-eyebrow">Требует внимания</p>
                <h3>Что важно сделать</h3>
                <span>Главные задачи школы на сегодня.</span>
            </div>
            <div class="ops-live-items">
                ${active.map(item => `
                    <button type="button" class="ops-live-card is-${item.tone}" onclick="dashboardGo('${item.section}')">
                        <strong>${dashboardCount(item.value)}</strong>
                        <span>${escapeBookingText(item.label)}</span>
                        <small>${escapeBookingText(item.note)}</small>
                    </button>
                `).join('')}
            </div>
        </section>
    `;
}

function dashboardTaskRow(task, index) {
    return `
        <button type="button" class="ops-task ${task.tone ? `is-${task.tone}` : ''}" onclick="${task.action}">
            <span class="ops-task-rank">${index + 1}</span>
            <span class="ops-task-main">
                <strong>${escapeBookingText(task.title)}</strong>
                <small>${escapeBookingText(task.reason)}</small>
            </span>
            <span class="ops-task-action">${escapeBookingText(task.next)}</span>
        </button>
    `;
}

function dashboardBuildTasks(data) {
    const counts = data.counts || {};
    const tasks = [];
    const staleLesson = data.notFilled?.[0];
    const pendingLesson = data.pendingReview?.[0];
    const oldestBooking = data.newBookings?.[0];
    const largestDebt = data.debtMemberships?.[0];
    const expiring = data.expiringMemberships?.[0];
    const nextClass = data.todayClasses?.[0];

    if (dashboardCount(counts.notFilled) > 0) {
        tasks.push({
            tone: 'danger',
            title: `Добавить итоги ${dashboardCount(counts.notFilled)} уроков`,
            reason: staleLesson
                ? `${staleLesson.startTime || ''} · ${staleLesson.teacherName || 'без преподавателя'} · деньги и посещаемость ещё не зафиксированы`
                : 'Прошедшие уроки без отчёта могут исказить списания и зарплату.',
            next: 'Открыть урок',
            action: staleLesson
                ? `dashboardOpen('schedule', () => openLessonReviewItem('${staleLesson.id}'))`
                : "dashboardGo('schedule')",
        });
    }

    if (dashboardCount(counts.pendingReview) > 0) {
        tasks.push({
            tone: 'warning',
            title: `Проверить итоги ${dashboardCount(counts.pendingReview)} уроков`,
            reason: pendingLesson
                ? `${dashboardDate(pendingLesson.date, pendingLesson.startTime)} · ${pendingLesson.teacherName || 'без преподавателя'}`
                : 'После подтверждения урок попадает в финансы и зарплату.',
            next: 'Открыть список',
            action: pendingLesson
                ? `dashboardOpen('lesson-review', () => openLessonReviewItem('${pendingLesson.id}'))`
                : "dashboardGo('lesson-review')",
        });
    }

    if (dashboardCount(counts.newBookings) > 0) {
        tasks.push({
            tone: 'accent',
            title: `Ответить на ${dashboardCount(counts.newBookings)} новых заявок`,
            reason: oldestBooking
                ? `${dashboardPersonName(oldestBooking, 'Новая заявка')} · ${oldestBooking.direction || 'направление не указано'} · ${dashboardRelativeTime(oldestBooking.createdAt)}`
                : 'Чем быстрее назначен первый контакт, тем меньше потерь в воронке.',
            next: 'Открыть заявки',
            action: "dashboardGo('bookings')",
        });
    }

    if (dashboardCount(counts.debtMemberships) > 0) {
        tasks.push({
            tone: 'danger',
            title: `Разобрать ${dashboardCount(counts.debtMemberships)} учеников с долгом`,
            reason: largestDebt
                ? `${largestDebt.studentName || 'Ученик'} · баланс ${dashboardMoney(largestDebt.remainingAmount)}`
                : 'Отрицательный баланс лучше закрывать до следующего занятия.',
            next: 'Открыть оплату',
            action: largestDebt
                ? `dashboardOpen('membership-actions', () => viewStudent('${largestDebt.studentId}'))`
                : "dashboardGo('membership-actions')",
        });
    }

    if (dashboardCount(counts.expiringMemberships) > 0) {
        tasks.push({
            tone: 'warning',
            title: `Напомнить о продлении ${dashboardCount(counts.expiringMemberships)} ученикам`,
            reason: expiring
                ? `${expiring.studentName || 'Ученик'} · ${expiring.estimatedLessonsRemaining ?? expiring.classesRemaining ?? 1} ур. по балансу · ${expiring.planName || 'тариф'}`
                : 'Пополнение до нуля помогает сохранить расписание ученика.',
            next: 'Открыть список',
            action: "dashboardGo('membership-actions')",
        });
    }

    if (dashboardCount(counts.todayClasses) > 0) {
        tasks.push({
            tone: 'neutral',
            title: `Проверить ${dashboardCount(counts.todayClasses)} уроков на сегодня`,
            reason: nextClass
                ? `${nextClass.startTime} · ${nextClass.title} · ${nextClass.roomName || 'кабинет не указан'}`
                : 'Перед началом дня проверьте кабинеты, преподавателей и статусы.',
            next: 'Расписание',
            action: "dashboardGo('schedule')",
        });
    }

    return tasks.slice(0, 5);
}

function dashboardTaskBoard(data) {
    const tasks = dashboardBuildTasks(data);
    const generatedAt = data.generatedAt ? new Date(data.generatedAt) : null;
    const generatedText = generatedAt && !Number.isNaN(generatedAt.getTime())
        ? generatedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        : '';

    if (!tasks.length) {
        return `
            <section class="ops-command is-clear">
                <div>
                    <p class="ops-eyebrow">Задачи на сегодня</p>
                    <h3>Всё под контролем</h3>
                    <p>Можно спокойно заниматься расписанием, учениками и новыми обращениями.</p>
                </div>
                <button type="button" class="ops-command-refresh" onclick="renderDashboard()">Обновить</button>
            </section>
        `;
    }

    return `
        <section class="ops-command">
            <div class="ops-command-head">
                <div>
                    <p class="ops-eyebrow">Задачи на сегодня</p>
                    <h3>Что сделать сначала</h3>
                    <p>Здесь собраны дела, которые важнее всего закрыть сегодня.</p>
                </div>
                <span>${generatedText ? `обновлено ${generatedText}` : 'на сейчас'}</span>
            </div>
            <div class="ops-task-list">
                ${tasks.map(dashboardTaskRow).join('')}
            </div>
        </section>
    `;
}

const dashboardIcons = {
    calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`,
    shield: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="m9 11 2 2 4-4"></path></svg>`,
    inbox: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>`,
    wallet: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"></rect><line x1="12" y1="10" x2="12" y2="14"></line><line x1="10" y1="12" x2="14" y2="12"></line></svg>`,
    star: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.886L4.2 9l5.888 1.914L12 17l1.912-5.886L19.8 9l-5.888-1.914z"></path></svg>`
};

function dashboardList(items, renderItem, emptyText, inline = false, iconKey = null) {
    if (!items?.length) {
        const iconHtml = iconKey && dashboardIcons[iconKey] ? dashboardIcons[iconKey] : '';
        if (inline) {
            return `<div class="ops-empty-inline">${iconHtml}<span>${emptyText}</span></div>`;
        }
        return `<div class="ops-empty">${iconHtml}<span>${emptyText}</span></div>`;
    }
    return `<div class="ops-list">${items.map(renderItem).join('')}</div>`;
}

function dashboardExportDailyReport(data = dashboardLastData) {
    if (!data) {
        alert('Сначала загрузите дневные итоги');
        return;
    }
    if (typeof XLSX === 'undefined') {
        alert('Не удалось подготовить файл отчёта');
        return;
    }

    const wb = XLSX.utils.book_new();
    const generatedAt = data.generatedAt ? new Date(data.generatedAt) : new Date();
    const reportDate = generatedAt.toLocaleDateString('ru-RU');
    const counts = data.counts || {};

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['Дневной отчет Maestro'],
        ['Дата', reportDate],
        ['Сформирован', generatedAt.toLocaleString('ru-RU')],
        [],
        ['Показатель', 'Количество'],
        ['Новые заявки', counts.newBookings || 0],
        ['Уроки сегодня', counts.todayClasses || 0],
        ['Отчеты на подтверждении', counts.pendingReview || 0],
        ['Не заполнено уроков', counts.notFilled || 0],
        ['Низкий баланс', counts.expiringMemberships || 0],
        ['Отрицательный баланс', counts.debtMemberships || 0],
    ]), 'Сводка');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((data.todayClasses || []).map(item => ({
        Время: item.startTime || '',
        Урок: item.title || '',
        Ученик_или_группа: item.audienceName || '',
        Преподаватель: item.teacherName || '',
        Кабинет: item.roomName || '',
    }))), 'Расписание');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((data.newBookings || []).map(item => ({
        Клиент: dashboardPersonName(item, 'Новая заявка'),
        Телефон: item.phone || '',
        Направление: item.direction || '',
        Источник: item.source || '',
        Создана: item.createdAt ? new Date(item.createdAt).toLocaleString('ru-RU') : '',
    }))), 'Заявки');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
        ...(data.pendingReview || []).map(item => ({
            Тип: 'На подтверждении',
            Урок: item.title || '',
            Дата: item.date ? new Date(item.date).toLocaleDateString('ru-RU') : '',
            Время: item.startTime || '',
            Преподаватель: item.teacherName || '',
        })),
        ...(data.notFilled || []).map(item => ({
            Тип: 'Не заполнено',
            Урок: item.title || '',
            Дата: item.date ? new Date(item.date).toLocaleDateString('ru-RU') : '',
            Время: item.startTime || '',
            Преподаватель: item.teacherName || '',
        })),
    ]), 'Контроль уроков');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
        ...(data.debtMemberships || []).map(item => ({
            Тип: 'Долг',
            Ученик: item.studentName || '',
            Баланс: Number(item.remainingAmount || 0),
            Тариф: item.planName || '',
        })),
        ...(data.expiringMemberships || []).map(item => ({
            Тип: 'Низкий баланс',
            Ученик: item.studentName || '',
            Баланс: Number(item.remainingAmount || 0),
            Тариф: item.planName || '',
        })),
    ]), 'Финансы');

    XLSX.writeFile(wb, `daily-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

async function renderDashboard() {
    const root = document.getElementById('operationsDashboard');
    if (!root) return;
    root.innerHTML = '<div class="ops-loading">Загружаем состояние школы...</div>';

    try {
        const response = await fetch(`${API_URL}/admin/operations`, {
            headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Ошибка загрузки');
        const data = result.data;
        dashboardLastData = data;
        if (typeof window.applyOperationalIndicators === 'function') {
            window.applyOperationalIndicators(data);
        }

        root.innerHTML = `
            <div class="ops-hero">
                <div>
                    <p class="ops-eyebrow">Главное за сегодня</p>
                    <h2>Добрый день, ${escapeBookingText(getUserName() || 'администратор')}</h2>
                    <p>Здесь собраны главные задачи школы и то, что требует вашего внимания.</p>
                </div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;">
                    <button class="ops-refresh" onclick="dashboardExportDailyReport()">Скачать отчёт</button>
                    <button class="ops-refresh" onclick="renderDashboard()">Обновить</button>
                </div>
            </div>

            ${dashboardPulseStrip(data)}

            ${dashboardManualTaskBoard(data)}

            ${dashboardTaskBoard(data)}

            <div class="ops-priority-grid">
                <button class="ops-metric is-accent" onclick="dashboardGo('bookings')"><span>${data.counts.newBookings}</span><strong>Новых заявок</strong><small>Ответить и назначить урок</small></button>
                <button class="ops-metric is-warning" onclick="dashboardGo('lesson-review')"><span>${data.counts.pendingReview}</span><strong>Нужно проверить</strong><small>Итоги уроков преподавателей</small></button>
                <button class="ops-metric is-danger" onclick="dashboardGo('schedule')"><span>${data.counts.notFilled}</span><strong>Нет итога</strong><small>Прошедшие уроки без итога</small></button>
                <button class="ops-metric" onclick="dashboardGo('schedule')"><span>${data.counts.todayClasses}</span><strong>Уроков сегодня</strong><small>Текущее расписание школы</small></button>
                <button class="ops-metric" onclick="dashboardGo('membership-actions')"><span>${data.counts.expiringMemberships}</span><strong>Скоро продление</strong><small>Пора напомнить об оплате</small></button>
                <button class="ops-metric is-danger" onclick="dashboardGo('membership-actions')"><span>${data.counts.debtMemberships}</span><strong>Есть задолженность</strong><small>Нужно закрыть оплату</small></button>
            </div>

            <div class="ops-columns">
                <section class="ops-panel">
                    <div class="ops-panel-head"><div><p>Сегодня</p><h3>Расписание</h3></div><button onclick="dashboardGo('schedule')">Открыть</button></div>
                    ${dashboardList(data.todayClasses, item => `
                        <button class="ops-row" onclick="dashboardGo('schedule')">
                            <span class="ops-time">${escapeBookingText(item.startTime)}</span>
                            <span><strong>${escapeBookingText(item.title)}</strong><small>${escapeBookingText(item.audienceName)} · ${escapeBookingText(item.teacherName || 'Без преподавателя')}${item.roomName ? ` · ${escapeBookingText(item.roomName)}` : ''}</small></span>
                        </button>`, 'На сегодня уроков нет', false, 'calendar')}
                </section>

                <section class="ops-panel">
                    <div class="ops-panel-head"><div><p>Уроки</p><h3>Требует внимания</h3></div><button onclick="dashboardGo('lesson-review')">Открыть список</button></div>
                    ${dashboardList([...data.pendingReview.map(x => ({ ...x, kind: 'review' })), ...data.notFilled.map(x => ({ ...x, kind: 'empty' }))].slice(0, 8), item => `
                        <button class="ops-row" onclick="openLessonReviewItem('${item.id}')">
                            <span class="ops-dot ${item.kind === 'empty' ? 'is-danger' : 'is-warning'}"></span>
                            <span><strong>${escapeBookingText(item.title)}</strong><small>${dashboardDate(item.date, item.startTime)} · ${escapeBookingText(item.teacherName || 'Без преподавателя')}</small></span>
                        </button>`, 'Нет просроченных задач', false, 'shield')}
                </section>

                <section class="ops-panel">
                    <div class="ops-panel-head"><div><p>Обращения <span class="ops-live-dot"></span></p><h3>Новые заявки</h3></div><button onclick="dashboardGo('bookings')">Открыть список</button></div>
                    ${dashboardList(data.newBookings, item => `
                        <button class="ops-row" onclick="dashboardGo('bookings')">
                            <span class="ops-avatar">${escapeBookingText((item.name || '?').slice(0, 1))}</span>
                            <span>
                                <strong>${escapeBookingText(dashboardPersonName(item, 'Новая заявка'))}</strong>
                                <small>${escapeBookingText(item.direction || 'Направление не указано')}</small>
                                <span class="ops-row-meta">
                                    <span>${escapeBookingText(item.source || 'Источник не указан')}</span>
                                    <span>${escapeBookingText(dashboardPhone(item.phone))}</span>
                                    <span>${escapeBookingText(dashboardRelativeTime(item.createdAt))}</span>
                                </span>
                            </span>
                        </button>`, 'Новых заявок нет', false, 'inbox')}
                </section>

                <section class="ops-panel">
                    <div class="ops-panel-head"><div><p>Финансы</p><h3>Долги и продления</h3></div><button onclick="dashboardGo('membership-actions')">Открыть список</button></div>
                    
                    <div class="ops-panel-subheader">Нужно закрыть оплату</div>
                    ${dashboardList(data.debtMemberships.slice(0, 4), item => `
                        <button class="ops-row" onclick="viewStudent('${item.studentId}')">
                            <span class="ops-dot is-danger"></span>
                            <span><strong>${escapeBookingText(item.studentName)}</strong><small>Баланс: ${dashboardMoney(item.remainingAmount)}</small></span>
                        </button>`, 'Долгов нет', true, 'wallet')}

                    <div class="ops-panel-subheader">Скоро продление</div>
                    ${dashboardList(data.expiringMemberships.slice(0, 4), item => `
                        <button class="ops-row" onclick="viewStudent('${item.studentId}')">
                            <span class="ops-dot is-warning"></span>
                            <span><strong>${escapeBookingText(item.studentName)}</strong><small>${escapeBookingText(item.planName || 'Абонемент')} · баланс ${dashboardMoney(item.remainingAmount)}</small></span>
                        </button>`, 'Продления пока не требуются', true, 'star')}
                </section>
            </div>
        `;
    } catch (error) {
        root.innerHTML = `<div class="ops-empty is-error">${escapeBookingText(error.message)}</div>`;
    }
}

window.renderDashboard = renderDashboard;
window.dashboardGo = dashboardGo;
window.dashboardOpen = dashboardOpen;
window.dashboardExportDailyReport = dashboardExportDailyReport;
window.dashboardOpenStaffTask = dashboardOpenStaffTask;
window.dashboardCloseStaffTask = dashboardCloseStaffTask;
window.dashboardSaveStaffTask = dashboardSaveStaffTask;
window.dashboardSetStaffTaskStatus = dashboardSetStaffTaskStatus;
window.dashboardDeleteStaffTask = dashboardDeleteStaffTask;
