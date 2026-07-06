const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { provisionCrmTeacher, syncPasswordToLearningPlatform } = require('../services/userLink');
const { ensureTeacherScheduleColors, nextTeacherScheduleColor } = require('../services/scheduleAppearance');

const teacherPhotoDirectory = path.join(__dirname, '../../uploads/teacher-photos');
fs.mkdirSync(teacherPhotoDirectory, { recursive: true });
const teacherPhotoUpload = multer({
    storage: multer.diskStorage({
        destination: teacherPhotoDirectory,
        filename: (req, file, cb) => {
            const extension = {
                'image/jpeg': '.jpg',
                'image/png': '.png',
                'image/gif': '.gif',
                'image/webp': '.webp',
            }[file.mimetype] || '';
            cb(null, `teacher-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${extension}`);
        },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
        cb(allowed.has(file.mimetype) ? null : new Error('Поддерживаются только JPEG, PNG, GIF и WEBP'), allowed.has(file.mimetype));
    },
});

function normalizeColor(value, fallback = null) {
    return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toUpperCase() : fallback;
}

function formatUserRouteFio(person, fallback = '') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function normalizeWeeklyHours(value) {
    const hours = Number(value);
    return Number.isFinite(hours) ? Math.min(80, Math.max(1, Math.round(hours))) : 40;
}

function normalizeSalaryRate(value) {
    const rate = Number(value);
    return Number.isInteger(rate) && rate >= 0 ? rate : null;
}

function applySalaryRates(data, values) {
    const fields = ['salaryIndividual', 'salaryGroup', 'salaryOther'];
    for (const field of fields) {
        if (values[field] === undefined) continue;
        const normalized = normalizeSalaryRate(values[field]);
        if (normalized === null) return false;
        data[field] = normalized;
    }
    return true;
}

// Вспомогательная функция для безопасного удаления связанных сущностей "в роли ученика",
// если пользователь когда-либо был добавлен в группу, получал абонемент и т.д.
async function cleanupUserRelatedRecords(userId) {
    await prisma.classAttendee.deleteMany({ where: { studentId: userId } });
    await prisma.freeze.deleteMany({ where: { studentId: userId } });
    
    const memberships = await prisma.membership.findMany({ where: { studentId: userId }, select: { id: true } });
    const membershipIds = memberships.map(m => m.id);
    if (membershipIds.length > 0) {
        await prisma.payment.updateMany({ where: { membershipId: { in: membershipIds } }, data: { membershipId: null } });
    }
    
    await prisma.student.update({ where: { id: userId }, data: { activeMembershipId: null } });
    await prisma.membership.deleteMany({ where: { studentId: userId } });
    
    const payments = await prisma.payment.findMany({ where: { studentId: userId }, select: { id: true } });
    const paymentIds = payments.map(p => p.id);
    if (paymentIds.length > 0) {
        await prisma.cashTransaction.deleteMany({ where: { relatedPaymentId: { in: paymentIds } } });
        await prisma.payment.updateMany({ where: { id: { in: paymentIds } }, data: { relatedPaymentId: null } });
        await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    }
    
    await prisma.booking.updateMany({ where: { convertedToStudentId: userId }, data: { convertedToStudentId: null } });
    await prisma.studentGroup.deleteMany({ where: { studentId: userId } });
}

// ============================
// Role-specific endpoints (MUST be before /:id routes)
// ============================

// POST /api/users/teachers
router.post('/teachers', authenticate, requireAdmin, async (req, res) => {
    try {
        const {
            name, lastName, middleName, phone, password, gender, directions, bio, photo,
            scheduleColor, weeklyHours,
            salaryIndividual, salaryGroup, salaryOther,
        } = req.body;
        if (!name || !lastName || !phone || !password) return res.status(400).json({ success: false, error: 'Все поля обязательны' });

        const existing = await prisma.student.findUnique({ where: { phone } });
        if (existing) return res.status(400).json({ success: false, error: 'Пользователь с таким телефоном уже существует' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const assignedScheduleColor = normalizeColor(scheduleColor, await nextTeacherScheduleColor(phone));
        const salaryRates = {};
        if (!applySalaryRates(salaryRates, { salaryIndividual, salaryGroup, salaryOther })) {
            return res.status(400).json({ success: false, error: 'Ставки зарплаты должны быть целыми неотрицательными числами' });
        }
        const user = await prisma.student.create({
            data: {
                name, lastName, middleName: middleName || null, phone, phoneDigits: phone.replace(/\D/g, ''),
                password: hashedPassword, role: 'teacher',
                gender: gender === 'female' ? 'female' : 'male',
                teacherDirections: directions || [],
                teacherBio: bio || '',
                teacherPhoto: photo || '',
                teacherScheduleColor: assignedScheduleColor,
                teacherWeeklyHours: normalizeWeeklyHours(weeklyHours),
                ...salaryRates
            }
        });

        let platform = null;
        try {
            const provision = await provisionCrmTeacher(user.id, { password });
            if (provision.success) {
                platform = provision.data;
            } else {
                console.warn(`[users] Teacher LP provision failed for ${user.id}:`, provision.error);
            }
        } catch (provisionError) {
            console.error('[users] Teacher LP provision error:', provisionError);
        }

        console.log(`✅ Создан преподаватель: ${name} ${lastName}`);
        res.status(201).json({
            success: true,
            teacher: { ...user, _id: user.id, password: undefined },
            generatedPassword: password,
            platform,
        });
    } catch (error) {
        console.error('Create teacher error:', error);
        res.status(500).json({ success: false, error: 'Ошибка создания преподавателя' });
    }
});

// POST /api/users/teachers/:id/provision-platform — создать/привязать аккаунт в Learning Platform
router.post('/teachers/:id/provision-platform', authenticate, requireAdmin, async (req, res) => {
    try {
        const result = await provisionCrmTeacher(req.params.id, {
            password: req.body?.password,
            force: Boolean(req.body?.force),
        });
        if (!result.success) {
            const status = result.status === 'conflict' ? 409 : 400;
            return res.status(status).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('Provision teacher platform error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка создания аккаунта в платформе' });
    }
});

// POST /api/users/teachers/provision-all — массово создать аккаунты для всех преподавателей без связи
router.post('/teachers/provision-all', authenticate, requireAdmin, async (req, res) => {
    try {
        const teachers = await prisma.student.findMany({
            where: {
                role: 'teacher',
                status: 'active',
                OR: [
                    { appUserId: null },
                    { externalLinkStatus: { not: 'linked' } },
                ],
            },
            select: { id: true, name: true, lastName: true, middleName: true },
        });

        const results = [];
        for (const teacher of teachers) {
            const result = await provisionCrmTeacher(teacher.id);
            results.push({
                crmTeacherId: teacher.id,
                name: formatUserRouteFio(teacher),
                success: result.success,
                error: result.error,
                data: result.data,
            });
        }

        const linked = results.filter((item) => item.success).length;
        return res.json({
            success: true,
            data: {
                total: teachers.length,
                linked,
                failed: teachers.length - linked,
                results,
            },
        });
    } catch (error) {
        console.error('Provision all teachers error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка массового создания аккаунтов' });
    }
});

// PATCH /api/users/teachers/:id
router.patch('/teachers/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const {
            name, lastName, middleName, directions, bio, photo, displayOrder,
            scheduleColor, weeklyHours,
            salaryIndividual, salaryGroup, salaryOther,
        } = req.body;
        const data = {};
        if (name !== undefined) data.name = name;
        if (lastName !== undefined) data.lastName = lastName;
        if (middleName !== undefined) data.middleName = middleName || null;
        if (directions !== undefined) data.teacherDirections = directions;
        if (bio !== undefined) data.teacherBio = bio;
        if (photo !== undefined) data.teacherPhoto = photo;
        if (displayOrder !== undefined) data.teacherDisplayOrder = displayOrder;
        if (scheduleColor !== undefined) {
            const normalized = normalizeColor(scheduleColor);
            if (!normalized) return res.status(400).json({ success: false, error: 'Некорректный цвет преподавателя' });
            data.teacherScheduleColor = normalized;
        }
        if (weeklyHours !== undefined) data.teacherWeeklyHours = normalizeWeeklyHours(weeklyHours);
        if (!applySalaryRates(data, { salaryIndividual, salaryGroup, salaryOther })) {
            return res.status(400).json({ success: false, error: 'Ставки зарплаты должны быть целыми неотрицательными числами' });
        }

        const user = await prisma.student.update({ where: { id: req.params.id }, data });
        res.json({ success: true, teacher: { ...user, _id: user.id, password: undefined } });
    } catch (error) {
        console.error('Update teacher error:', error);
        res.status(500).json({ success: false, error: 'Ошибка обновления преподавателя' });
    }
});

// DELETE /api/users/teachers/:id
router.delete('/teachers/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const teacherId = req.params.id;
        
        const teacher = await prisma.student.findUnique({ where: { id: teacherId } });
        if (!teacher) return res.status(404).json({ success: false, error: 'Преподаватель не найден' });
        
        await cleanupUserRelatedRecords(teacherId);

        // Проверяем, есть ли привязанные АКТИВНЫЕ группы
        const activeGroupsCount = await prisma.group.count({ where: { teacherId, isActive: true } });
        if (activeGroupsCount > 0) {
            return res.status(400).json({ success: false, error: `Невозможно удалить преподавателя. Сначала отвяжите его от ${activeGroupsCount} активной(ых) групп(ы).` });
        }

        // Отвязываем от неактивных групп (удаленных), чтобы избежать ошибки внешнего ключа
        await prisma.group.updateMany({
            where: { teacherId, isActive: false },
            data: { teacherId: null }
        });

        // Отвязываем от занятий, чтобы не блокировать удаление (если они были)
        await prisma.class.updateMany({
            where: { teacherId },
            data: { teacherId: null }
        });

        await prisma.student.delete({ where: { id: teacherId } });
        res.json({ success: true, message: `Преподаватель "${teacher.name} ${teacher.lastName || ''}" удален` });
    } catch (error) {
        console.error('Delete teacher error:', error);
        if (error.code === 'P2003') {
            return res.status(400).json({ success: false, error: 'Невозможно удалить преподавателя: есть связанные зарплаты или другие финансовые записи.' });
        }
        res.status(500).json({ success: false, error: 'Ошибка удаления преподавателя' });
    }
});

// POST /api/users/admins
router.post('/admins', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { name, lastName, middleName, phone, password, gender } = req.body;
        if (!name || !lastName || !phone || !password) return res.status(400).json({ success: false, error: 'Все поля обязательны' });

        const existing = await prisma.student.findUnique({ where: { phone } });
        if (existing) return res.status(400).json({ success: false, error: 'Пользователь с таким телефоном уже существует' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.student.create({
            data: {
                name, lastName, middleName: middleName || null, phone, phoneDigits: phone.replace(/\D/g, ''),
                password: hashedPassword, role: 'admin',
                gender: gender === 'female' ? 'female' : 'male'
            }
        });

        console.log(`✅ Создан администратор: ${name} ${lastName}`);
        res.status(201).json({ success: true, admin: { ...user, _id: user.id, password: undefined }, generatedPassword: password });
    } catch (error) {
        console.error('Create admin error:', error);
        res.status(500).json({ success: false, error: 'Ошибка создания администратора' });
    }
});

// DELETE /api/users/admins/:id
router.delete('/admins/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const u = await prisma.student.findUnique({ where: { id: req.params.id } });
        if (!u) return res.status(404).json({ success: false, error: 'Администратор не найден' });

        await cleanupUserRelatedRecords(req.params.id);
        await prisma.student.delete({ where: { id: req.params.id } });
        res.json({ success: true, message: `Администратор "${u.name} ${u.lastName || ''}" удален` });
    } catch (error) {
        console.error('Delete admin error:', error);
        if (error.code === 'P2003') {
            return res.status(400).json({ success: false, error: 'Ошибка: к администратору привязаны системные বা финансовые записи.' });
        }
        res.status(500).json({ success: false, error: 'Ошибка удаления' });
    }
});

// POST /api/users/sales-managers
router.post('/sales-managers', authenticate, requireAdmin, async (req, res) => {
    try {
        const { name, lastName, middleName, phone, password, gender } = req.body;
        if (!name || !lastName || !phone || !password) return res.status(400).json({ success: false, error: 'Все поля обязательны' });

        const existing = await prisma.student.findUnique({ where: { phone } });
        if (existing) return res.status(400).json({ success: false, error: 'Пользователь с таким телефоном уже существует' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.student.create({
            data: {
                name, lastName, middleName: middleName || null, phone, phoneDigits: phone.replace(/\D/g, ''),
                password: hashedPassword, role: 'sales_manager',
                gender: gender === 'female' ? 'female' : 'male'
            }
        });

        console.log(`✅ Создан менеджер: ${name} ${lastName}`);
        res.status(201).json({ success: true, manager: { ...user, _id: user.id, password: undefined }, generatedPassword: password });
    } catch (error) {
        console.error('Create sales manager error:', error);
        res.status(500).json({ success: false, error: 'Ошибка создания менеджера' });
    }
});

// DELETE /api/users/sales-managers/:id
router.delete('/sales-managers/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const u = await prisma.student.findUnique({ where: { id: req.params.id } });
        if (!u) return res.status(404).json({ success: false, error: 'Менеджер не найден' });

        await cleanupUserRelatedRecords(req.params.id);
        await prisma.student.delete({ where: { id: req.params.id } });
        res.json({ success: true, message: `Менеджер "${u.name} ${u.lastName || ''}" удален` });
    } catch (error) {
        console.error('Delete sales manager error:', error);
        if (error.code === 'P2003') {
            return res.status(400).json({ success: false, error: 'Ошибка: к менеджеру привязаны системные или финансовые записи.' });
        }
        res.status(500).json({ success: false, error: 'Ошибка удаления' });
    }
});

// POST /api/users/upload-teacher-photo
router.post('/upload-teacher-photo', authenticate, requireAdmin, (req, res) => {
    teacherPhotoUpload.single('photo')(req, res, error => {
        if (error) {
            return res.status(400).json({ success: false, error: error.message || 'Не удалось загрузить фото' });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'Выберите файл изображения' });
        }
        return res.json({
            success: true,
            photoUrl: `/api/uploads/teacher-photos/${req.file.filename}`,
        });
    });
});

// ============================
// Generic endpoints (after role-specific)
// ============================

// GET /api/users
router.get('/', authenticate, requireAdmin, async (req, res) => {
    try {
        await ensureTeacherScheduleColors();
        const { role, search, page = 1, limit = 50 } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const where = { role: { not: 'student' } };

        if (role) where.role = role;
        if (search && search.trim()) {
            const term = search.trim();
            where.OR = [
                { name: { contains: term, mode: 'insensitive' } },
                { lastName: { contains: term, mode: 'insensitive' } },
                { middleName: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term } }
            ];
        }

        const [users, total] = await Promise.all([
            prisma.student.findMany({
                where,
                select: {
                    id: true,
                    name: true,
                    lastName: true,
                    middleName: true,
                    phone: true,
                    email: true,
                    role: true,
                    status: true,
                    createdAt: true,
                    teacherDirections: true,
                    teacherScheduleColor: true,
                    teacherWeeklyHours: true,
                    appUserId: true,
                    externalLinkStatus: true,
                },
                orderBy: { createdAt: 'desc' },
                skip: (pageNum - 1) * limitNum, take: limitNum
            }),
            prisma.student.count({ where })
        ]);

        res.json({ success: true, users: users.map(u => ({ ...u, _id: u.id })), total, page: pageNum, pages: Math.ceil(total / limitNum) });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения пользователей' });
    }
});

// POST /api/users
router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const {
            name, lastName, middleName, phone, password, role, email, teacherDirections,
            teacherScheduleColor, teacherWeeklyHours,
        } = req.body;
        if (!name || !lastName || !phone || !password || !role) return res.status(400).json({ success: false, error: 'Все поля обязательны' });

        const existing = await prisma.student.findUnique({ where: { phone } });
        if (existing) return res.status(400).json({ success: false, error: 'Пользователь с таким телефоном уже существует' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const assignedTeacherColor = role === 'teacher'
            ? normalizeColor(teacherScheduleColor, await nextTeacherScheduleColor(phone))
            : null;
        const user = await prisma.student.create({
            data: {
                name,
                lastName,
                middleName: middleName || null,
                phone,
                phoneDigits: phone.replace(/\D/g, ''),
                password: hashedPassword,
                role,
                email: email || null,
                teacherDirections: teacherDirections || [],
                ...(role === 'teacher' ? {
                    teacherScheduleColor: assignedTeacherColor,
                    teacherWeeklyHours: normalizeWeeklyHours(teacherWeeklyHours),
                } : {}),
            }
        });

        res.status(201).json({ success: true, user: { ...user, _id: user.id, password: undefined } });
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ success: false, error: 'Ошибка создания пользователя' });
    }
});

// PUT /api/users/:id
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const {
            name, lastName, middleName, phone, role, email, status, teacherDirections, password,
            scheduleColor, weeklyHours,
            salaryIndividual, salaryGroup, salaryOther,
        } = req.body;
        const currentUser = role !== undefined
            ? await prisma.student.findUnique({ where: { id: req.params.id }, select: { role: true } })
            : null;
        if (role !== undefined) {
            const validRoles = ['admin', 'super_admin', 'sales_manager', 'teacher', 'student'];
            if (!validRoles.includes(role)) {
                return res.status(400).json({ success: false, error: 'Неверная роль' });
            }
            if (!currentUser) {
                return res.status(404).json({ success: false, error: 'Пользователь не найден' });
            }
            if (role !== currentUser.role && req.user.role !== 'super_admin') {
                return res.status(403).json({ success: false, error: 'Изменять роли может только супер-администратор' });
            }
        }
        const data = {};
        if (name !== undefined) data.name = name;
        if (lastName !== undefined) data.lastName = lastName;
        if (middleName !== undefined) data.middleName = middleName || null;
        if (phone !== undefined) { data.phone = phone; data.phoneDigits = phone.replace(/\D/g, ''); }
        if (role !== undefined) data.role = role;
        if (email !== undefined) data.email = email || null;
        if (status !== undefined) data.status = status;
        if (teacherDirections !== undefined) data.teacherDirections = teacherDirections;
        if (scheduleColor !== undefined) {
            const normalized = normalizeColor(scheduleColor);
            if (!normalized) return res.status(400).json({ success: false, error: 'Некорректный цвет преподавателя' });
            data.teacherScheduleColor = normalized;
        }
        if (weeklyHours !== undefined) data.teacherWeeklyHours = normalizeWeeklyHours(weeklyHours);
        if (!applySalaryRates(data, { salaryIndividual, salaryGroup, salaryOther })) {
            return res.status(400).json({ success: false, error: 'Ставки зарплаты должны быть целыми неотрицательными числами' });
        }
        if (password) data.password = await bcrypt.hash(password, 10);

        const user = await prisma.student.update({ where: { id: req.params.id }, data });
        res.json({ success: true, user: { ...user, _id: user.id, password: undefined } });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ success: false, error: 'Ошибка обновления' });
    }
});

// PATCH /api/users/:id/change-role
router.patch('/:id/change-role', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { role } = req.body;
        const validRoles = ['admin', 'super_admin', 'sales_manager', 'teacher', 'student'];
        if (!validRoles.includes(role)) return res.status(400).json({ success: false, error: 'Неверная роль' });

        const user = await prisma.student.update({ where: { id: req.params.id }, data: { role } });
        res.json({ success: true, user: { ...user, _id: user.id, password: undefined } });
    } catch (error) {
        console.error('Change role error:', error);
        res.status(500).json({ success: false, error: 'Ошибка изменения роли' });
    }
});

// POST /api/users/:id/reset-password
router.post('/:id/reset-password', authenticate, requireAdmin, async (req, res) => {
    try {
        const targetUser = await prisma.student.findUnique({
            where: { id: req.params.id },
            select: { id: true, role: true, appUserId: true, externalLinkStatus: true }
        });
        if (!targetUser) {
            return res.status(404).json({ success: false, error: 'Пользователь не найден' });
        }
        if (req.user.role !== 'super_admin' && ['admin', 'super_admin'].includes(targetUser.role)) {
            return res.status(403).json({
                success: false,
                error: 'Сброс пароля администратора доступен только супер-администратору'
            });
        }

        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let newPassword = '';
        for (let i = 0; i < 8; i++) newPassword += chars.charAt(Math.floor(Math.random() * chars.length));

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const student = await prisma.student.update({ where: { id: req.params.id }, data: { password: hashedPassword } });

        // Если ученик привязан к Learning Platform, отправляем туда новый пароль
        if (student.appUserId && student.externalLinkStatus === 'linked') {
            await syncPasswordToLearningPlatform(student.id, student.role, newPassword);
        }

        res.json({ success: true, newPassword });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ success: false, error: 'Ошибка сброса пароля' });
    }
});

// DELETE /api/users/:id
router.delete('/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const u = await prisma.student.findUnique({ where: { id: req.params.id } });
        if (!u) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

        await cleanupUserRelatedRecords(req.params.id);
        await prisma.student.delete({ where: { id: req.params.id } });
        res.json({ success: true, message: `Пользователь "${u.name} ${u.lastName || ''}" удален` });
    } catch (error) {
        console.error('Delete user error:', error);
        if (error.code === 'P2003') {
            return res.status(400).json({ success: false, error: 'Ошибка: у пользователя есть системные записи, препятствующие удалению.' });
        }
        res.status(500).json({ success: false, error: 'Ошибка удаления' });
    }
});

module.exports = router;
