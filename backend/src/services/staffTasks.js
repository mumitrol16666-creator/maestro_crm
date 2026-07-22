const STAFF_TASK_STATUSES = new Set(['open', 'in_progress', 'completed', 'cancelled']);
const STAFF_TASK_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const STAFF_ASSIGNEE_ROLES = new Set(['sales_manager', 'teacher', 'admin', 'super_admin']);

function staffPersonName(person, fallback = 'Сотрудник') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function parseOptionalDate(value) {
    if (value === null || value === undefined || value === '') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

function validateStaffTaskInput(input = {}, { partial = false } = {}) {
    const data = {};
    const errors = [];

    if (!partial || Object.prototype.hasOwnProperty.call(input, 'title')) {
        const title = String(input.title || '').trim();
        if (!title) errors.push('Укажите название задачи');
        else if (title.length > 160) errors.push('Название задачи не должно превышать 160 символов');
        else data.title = title;
    }

    if (!partial || Object.prototype.hasOwnProperty.call(input, 'description')) {
        const description = String(input.description || '').trim();
        if (description.length > 2000) errors.push('Описание задачи не должно превышать 2000 символов');
        else data.description = description || null;
    }

    if (!partial || Object.prototype.hasOwnProperty.call(input, 'priority')) {
        const priority = String(input.priority || 'normal');
        if (!STAFF_TASK_PRIORITIES.has(priority)) errors.push('Некорректный приоритет задачи');
        else data.priority = priority;
    }

    if (!partial || Object.prototype.hasOwnProperty.call(input, 'dueAt')) {
        const dueAt = parseOptionalDate(input.dueAt);
        if (dueAt === undefined) errors.push('Некорректный срок задачи');
        else data.dueAt = dueAt;
    }

    if (partial && Object.prototype.hasOwnProperty.call(input, 'status')) {
        const status = String(input.status || '');
        if (!STAFF_TASK_STATUSES.has(status)) errors.push('Некорректный статус задачи');
        else data.status = status;
    }

    return { valid: errors.length === 0, errors, data };
}

function mapStaffTask(task) {
    return {
        id: task.id,
        title: task.title,
        description: task.description || null,
        status: task.status,
        priority: task.priority,
        dueAt: task.dueAt || null,
        completedAt: task.completedAt || null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        assignee: task.assignee ? {
            id: task.assignee.id,
            name: staffPersonName(task.assignee),
            role: task.assignee.role,
            appUserId: task.assignee.appUserId || null,
        } : null,
        createdBy: task.createdBy ? {
            id: task.createdBy.id,
            name: staffPersonName(task.createdBy),
            role: task.createdBy.role,
        } : null,
    };
}

module.exports = {
    STAFF_ASSIGNEE_ROLES,
    STAFF_TASK_PRIORITIES,
    STAFF_TASK_STATUSES,
    mapStaffTask,
    staffPersonName,
    validateStaffTaskInput,
};
