const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireSuperAdmin } = require('../middleware/auth');

let permissionsCache = null;
let permissionsCacheTime = null;
const CACHE_DURATION = 5 * 60 * 1000;

function getDefaultPermissions(role) {
    const defaults = {
        super_admin: {
            permissions: { canCreateUsers: true, canDeleteUsers: true, canEditRoles: true, canViewLogs: true, canManageBookings: true, canManageStudents: true, canManageGroups: true, canManageSchedule: true, canManagePayments: true, canManageDirections: true },
            visibility: { dashboard: true, bookings: true, students: true, membership_actions: true, shop: true, groups: true, schedule: true, directions: true, users: true, roles: true, activity_logs: true, student_history: true, integration_logs: true }
        },
        admin: {
            permissions: { canCreateUsers: true, canDeleteUsers: false, canEditRoles: false, canViewLogs: true, canManageBookings: true, canManageStudents: true, canManageGroups: true, canManageSchedule: true, canManagePayments: true, canManageDirections: false },
            visibility: { dashboard: true, bookings: true, students: true, membership_actions: true, shop: true, groups: true, schedule: true, users: true, activity_logs: true, student_history: true, integration_logs: true }
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

// GET /api/permissions
router.get('/', authenticate, async (req, res) => {
    const now = Date.now();
    if (permissionsCache && permissionsCacheTime && (now - permissionsCacheTime < CACHE_DURATION)) {
        return res.json({ success: true, permissions: permissionsCache, cached: true });
    }

    try {
        let permissions = await prisma.rolePermissions.findMany();
        const roles = ['super_admin', 'admin', 'sales_manager', 'staff', 'teacher', 'student'];
        const configuredRoles = new Set(permissions.map((item) => item.role));

        if (configuredRoles.size < roles.length) {
            for (const role of roles.filter((item) => !configuredRoles.has(item))) {
                const defaults = getDefaultPermissions(role);
                await prisma.rolePermissions.upsert({
                    where: { role },
                    update: {},
                    create: { role, permissions: defaults.permissions, visibility: defaults.visibility }
                });
            }
            permissions = await prisma.rolePermissions.findMany();
        }

        permissionsCache = permissions;
        permissionsCacheTime = Date.now();

        res.json({ success: true, permissions });
    } catch (error) {
        console.error('Get permissions error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения прав доступа' });
    }
});

// PATCH /api/permissions/:role
router.patch('/:role', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { role } = req.params;
        const { permissions, visibility } = req.body;

        const validRoles = ['student', 'sales_manager', 'staff', 'teacher', 'admin', 'super_admin'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ success: false, error: 'Недопустимая роль' });
        }
        if (role === 'super_admin') {
            return res.status(403).json({ success: false, error: 'Нельзя изменить права Super Admin' });
        }

        let existing = await prisma.rolePermissions.findUnique({ where: { role } });
        const defaults = getDefaultPermissions(role);

        const updatedData = {};
        if (permissions) updatedData.permissions = { ...(existing?.permissions || defaults.permissions), ...permissions };
        if (visibility) updatedData.visibility = { ...(existing?.visibility || defaults.visibility), ...visibility };

        const result = await prisma.rolePermissions.upsert({
            where: { role },
            update: updatedData,
            create: { role, permissions: updatedData.permissions || defaults.permissions, visibility: updatedData.visibility || defaults.visibility }
        });

        permissionsCache = null;
        permissionsCacheTime = null;

        res.json({ success: true, message: `Права роли "${role}" обновлены`, permissions: result });
    } catch (error) {
        console.error('Update permissions error:', error);
        res.status(500).json({ success: false, error: 'Ошибка обновления прав' });
    }
});

// POST /api/permissions/:role/reset
router.post('/:role/reset', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { role } = req.params;
        const validRoles = ['student', 'sales_manager', 'staff', 'teacher', 'admin'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ success: false, error: 'Недопустимая роль' });
        }

        const defaults = getDefaultPermissions(role);
        const result = await prisma.rolePermissions.upsert({
            where: { role },
            update: { permissions: defaults.permissions, visibility: defaults.visibility },
            create: { role, permissions: defaults.permissions, visibility: defaults.visibility }
        });

        permissionsCache = null;
        permissionsCacheTime = null;

        res.json({ success: true, message: `Права роли "${role}" сброшены`, permissions: result });
    } catch (error) {
        console.error('Reset permissions error:', error);
        res.status(500).json({ success: false, error: 'Ошибка сброса прав' });
    }
});

module.exports = router;
