function getDefaultPermissions(role) {
    const defaults = {
        super_admin: {
            permissions: { canCreateUsers: true, canDeleteUsers: true, canEditRoles: true, canViewLogs: true, canManageBookings: true, canManageStudents: true, canManageGroups: true, canManageSchedule: true, canManagePayments: true, canManageDirections: true },
            visibility: { dashboard: true, bookings: true, students: true, membership_actions: true, shop: true, groups: true, schedule: true, directions: true, users: true, roles: true, activity_logs: true, student_history: true, integration_logs: true, whatsapp_inbox: true }
        },
        admin: {
            permissions: { canCreateUsers: true, canDeleteUsers: false, canEditRoles: false, canViewLogs: true, canManageBookings: true, canManageStudents: true, canManageGroups: true, canManageSchedule: true, canManagePayments: true, canManageDirections: false },
            visibility: { dashboard: true, bookings: true, students: true, membership_actions: true, shop: true, groups: true, schedule: true, users: true, activity_logs: true, student_history: true, integration_logs: true, whatsapp_inbox: true }
        },
        sales_manager: {
            permissions: { canManageBookings: true, canManageStudents: true, canManagePayments: true },
            visibility: { bookings: true, students: true, membership_actions: true, shop: true, groups: true, schedule: true }
        },
        teacher: {
            permissions: { canManageStudents: true, canManageSchedule: true },
            visibility: { students: true, schedule: true }
        },
        staff: {
            permissions: {},
            visibility: {}
        },
        student: {
            permissions: {},
            visibility: {}
        }
    };
    return defaults[role] || defaults.student;
}

// These switches restrict existing route grants; they never grant a new role.
// An omitted legacy switch preserves the existing route policy.
const PERMISSION_KEYS = Object.keys(getDefaultPermissions('super_admin').permissions);
const VISIBILITY_KEYS = ['dashboard', 'bookings', 'students', 'membership_actions', 'memberships', 'shop', 'groups', 'schedule', 'directions', 'users', 'roles', 'activity_logs', 'student_history', 'integration_logs', 'whatsapp_inbox', 'whatsapp_reminders', 'analytics', 'lesson_review', 'cashbox', 'salary', 'blog', 'bot'];
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function validatePermissionPatch(body) {
    if (!isPlainObject(body) || !Object.keys(body).length || Object.keys(body).some(key => !['permissions', 'visibility'].includes(key))) return false;
    return Object.entries(body).every(([field, values]) => isPlainObject(values) && Object.entries(values).every(([key, value]) => (field === 'permissions' ? PERMISSION_KEYS : VISIBILITY_KEYS).includes(key) && typeof value === 'boolean'));
}
function effectivePermissions(role, stored) {
    const defaults = getDefaultPermissions(role).permissions;
    return Object.fromEntries(PERMISSION_KEYS.map(key => [key,
        role === 'super_admin' ? true
            : stored === undefined ? (defaults[key] ?? true)
            : !isPlainObject(stored) ? false
            : Object.hasOwn(stored, key) ? stored[key] === true
            : (defaults[key] ?? true),
    ]));
}
function requiredPermissions(req, targetRole) {
    // originalUrl is stable both before router mounting (idempotency) and inside it.
    // Split before decoding so an encoded slash inside an ID cannot become a route.
    const parts = String(req.originalUrl || req.url || req.path || '').split('?')[0].toLowerCase().split('/');
    if (parts[1] !== 'api') return [];
    const resource = parts[2], action = parts[4];
    const write = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    const needs = new Set();
    const add = (...keys) => keys.forEach(key => needs.add(key));
    if (['activity-logs', 'integration-logs'].includes(resource)) add('canViewLogs');
    if (!write) return [...needs];
    if (resource === 'integration-logs' && action === 'retry') add('canManageStudents', 'canManageSchedule', 'canManagePayments', 'canCreateUsers');
    if (resource === 'permissions') add('canEditRoles');
    if (resource === 'users') {
        if (parts.includes('provision-platform') || parts.includes('provision-all')) add('canCreateUsers');
        if (targetRole === 'student' || req.body?.role === 'student') add('canManageStudents');
        if (['salaryIndividual', 'salaryGroup', 'salaryOther', 'monthlySalary', 'salesCommissionPercent', 'payrollEnabled', 'employmentStartDate'].some(key => Object.hasOwn(req.body || {}, key))) add('canManagePayments');
        if (req.method === 'DELETE') add('canDeleteUsers');
        if (req.method === 'POST' && (!parts[3] || ['teachers', 'admins', 'sales-managers', 'staff'].includes(parts[3]) && !parts[4])) add('canCreateUsers');
        if (action === 'change-role') add('canEditRoles');
    }
    if (resource === 'directions') add('canManageDirections');
    if (resource === 'rooms') add('canManageSchedule');
    if (['payments', 'memberships', 'cashbox', 'salary', 'commission-config', 'shop'].includes(resource)) add('canManagePayments');
    if (resource === 'classes') {
        add('canManageSchedule');
        if (['approve', 'reopen', 'postpone', 'mark-no-one-attended'].includes(action) || ['PATCH', 'DELETE'].includes(req.method)) add('canManagePayments');
    }
    if (resource === 'groups') {
        add('canManageGroups');
        if (action === 'students') add('canManageStudents');
        else add('canManageSchedule');
    }
    if (resource === 'students' && !(parts[3] === 'stats' && action === 'batch-light')) {
        add('canManageStudents');
        if (req.method === 'POST' && (!parts[3] || ['provision-platform', 'provision-all'].includes(action) || parts[3] === 'provision-all')) add('canCreateUsers');
        if (['schedule', 'pause', 'resume', 'finish-education', 'restore'].includes(action)) add('canManageSchedule');
        if (req.method === 'DELETE') add('canManageSchedule', 'canManagePayments');
        if (req.body?.groupId) add('canManageGroups');
        if (Object.hasOwn(req.body || {}, 'assignedTeacherId')) add('canManageSchedule');
        if (action === 'add-to-group') add('canManageGroups', 'canManageSchedule');
        if (['balance-adjustment', 'finish-education'].includes(action)) add('canManagePayments');
    }
    if (resource === 'enrollments') {
        add('canManageStudents');
        if (req.method === 'PUT' || ['payment-intents', 'activate', 'complete'].includes(action)) add('canManagePayments');
        if (action === 'activate') add('canManageSchedule');
        if (action === 'access') add('canCreateUsers');
    }
    if (resource === 'families') add('canManageStudents');
    if (resource === 'freezes') add('canManageStudents', 'canManageSchedule');
    if (resource === 'bookings' && parts[3]) {
        add('canManageBookings');
        if (action === 'convert') add('canManageStudents', 'canManageSchedule', 'canCreateUsers');
        if (action === 'trial-details' || parts[3] === 'create-admin' || req.method === 'DELETE') add('canManagePayments', 'canManageSchedule');
        if (['online-schedule', 'status', 'data-quality'].includes(action)) add('canManageSchedule');
    }
    if (resource === 'admin' && parts[3] === 'membership-actions') add('canManageStudents', 'canManagePayments');
    return [...needs];
}
function permissionTargetUserId(req) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return null;
    const parts = String(req.originalUrl || req.url || '').split('?')[0].split('/');
    if (parts[1]?.toLowerCase() !== 'api' || parts[2]?.toLowerCase() !== 'users') return null;
    const kind = parts[3]?.toLowerCase();
    const id = ['teachers', 'admins', 'sales-managers', 'staff'].includes(kind) ? parts[4] : parts[3];
    if (!id || ['provision-all', 'upload-teacher-photo'].includes(id.toLowerCase())) return null;
    try { return decodeURIComponent(id); } catch { return null; }
}
module.exports = { permissionTargetUserId, getDefaultPermissions, effectivePermissions, requiredPermissions, validatePermissionPatch };
