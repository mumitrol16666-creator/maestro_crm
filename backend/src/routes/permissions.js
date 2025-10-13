const express = require('express');
const router = express.Router();
const RolePermissions = require('../models/RolePermissions');
const { authenticate, requireSuperAdmin } = require('../middleware/auth');

// ⚡ КЭШИРОВАНИЕ: Сохраняем права на 5 минут (они редко меняются)
let permissionsCache = null;
let permissionsCacheTime = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 минут

// Получить все права ролей
router.get('/', authenticate, async (req, res) => {
    // Проверяем кэш
    const now = Date.now();
    if (permissionsCache && permissionsCacheTime && (now - permissionsCacheTime < CACHE_DURATION)) {
        return res.json({ success: true, permissions: permissionsCache, cached: true });
    }
    
    try {
        let permissions = await RolePermissions.find();
        
        // Если прав еще нет в базе, создаем дефолтные
        if (permissions.length === 0) {
            const roles = ['super_admin', 'admin', 'sales_manager', 'teacher', 'student'];
            const defaultPermissions = [];
            
            for (const role of roles) {
                const defaults = RolePermissions.getDefaultPermissions(role);
                const perm = await RolePermissions.create({
                    role,
                    ...defaults
                });
                defaultPermissions.push(perm);
            }
            
            permissions = defaultPermissions;
        }
        
        // Сохраняем в кэш
        permissionsCache = permissions;
        permissionsCacheTime = Date.now();
        
        res.json({
            success: true,
            permissions
        });
    } catch (error) {
        console.error('Get permissions error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения прав доступа'
        });
    }
});

// Обновить права для роли (только Super Admin)
router.patch('/:role', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { role } = req.params;
        const { permissions, visibility } = req.body;
        
        // Валидация роли
        const validRoles = ['student', 'sales_manager', 'teacher', 'admin', 'super_admin'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({
                success: false,
                error: 'Недопустимая роль'
            });
        }
        
        // Нельзя изменить права Super Admin
        if (role === 'super_admin') {
            return res.status(403).json({
                success: false,
                error: 'Нельзя изменить права Super Admin'
            });
        }
        
        // Обновляем или создаем права
        let rolePermissions = await RolePermissions.findOne({ role });
        
        if (!rolePermissions) {
            // Создаем новую запись с дефолтными правами
            const defaults = RolePermissions.getDefaultPermissions(role);
            rolePermissions = new RolePermissions({
                role,
                ...defaults
            });
        }
        
        // Обновляем права
        if (permissions) {
            rolePermissions.permissions = {
                ...rolePermissions.permissions,
                ...permissions
            };
        }
        
        // Обновляем видимость
        if (visibility) {
            rolePermissions.visibility = {
                ...rolePermissions.visibility,
                ...visibility
            };
        }
        
        await rolePermissions.save();
        
        // Сбрасываем кэш при изменении прав
        permissionsCache = null;
        permissionsCacheTime = null;
        
        console.log(`✅ Права роли "${role}" обновлены`);
        
        res.json({
            success: true,
            message: `Права роли "${role}" обновлены`,
            permissions: rolePermissions
        });
    } catch (error) {
        console.error('Update permissions error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления прав'
        });
    }
});

// Сбросить права роли к дефолтным (только Super Admin)
router.post('/:role/reset', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { role } = req.params;
        
        const validRoles = ['student', 'sales_manager', 'teacher', 'admin'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({
                success: false,
                error: 'Недопустимая роль'
            });
        }
        
        const defaults = RolePermissions.getDefaultPermissions(role);
        
        let rolePermissions = await RolePermissions.findOne({ role });
        
        if (!rolePermissions) {
            rolePermissions = new RolePermissions({
                role,
                ...defaults
            });
        } else {
            rolePermissions.permissions = defaults.permissions;
            rolePermissions.visibility = defaults.visibility;
        }
        
        await rolePermissions.save();
        
        // Сбрасываем кэш при изменении прав
        permissionsCache = null;
        permissionsCacheTime = null;
        
        console.log(`🔄 Права роли "${role}" сброшены к дефолтным`);
        
        res.json({
            success: true,
            message: `Права роли "${role}" сброшены к дефолтным`,
            permissions: rolePermissions
        });
    } catch (error) {
        console.error('Reset permissions error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сброса прав'
        });
    }
});

module.exports = router;

