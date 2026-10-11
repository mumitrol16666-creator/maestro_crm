const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireSuperAdmin } = require('../middleware/auth');

let permissionsCache = null;
let permissionsCacheTime = null;
const CACHE_DURATION = 5 * 60 * 1000;

const { getDefaultPermissions, validatePermissionPatch } = require('../services/rolePermissions');

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
        if (!validatePermissionPatch(req.body)) {
            return res.status(400).json({ success: false, error: 'Права и видимость должны содержать только известные поля со значениями true или false' });
        }
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
