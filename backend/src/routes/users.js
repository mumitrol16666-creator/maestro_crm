const express = require('express');
const router = express.Router();
const Student = require('../models/Student');
const { authenticate, requireSuperAdmin, requireAdmin } = require('../middleware/auth');
const { cacheUtils } = require('../config/redis');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ==================== ЗАГРУЗКА ФОТО ПРЕПОДАВАТЕЛЕЙ ====================

// Настройка multer для загрузки фото преподавателей
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '../../../frontend/assets/images/teachers');

        // Создать папку если не существует
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }

        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'teacher-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Только изображения (JPEG, PNG, GIF, WEBP)'));
        }
    }
});

// @route   POST /api/users/upload-teacher-photo
// @desc    Загрузить фото преподавателя
// @access  Admin
router.post('/upload-teacher-photo', authenticate, requireAdmin, upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Файл не загружен'
            });
        }

        const photoUrl = `/assets/images/teachers/${req.file.filename}`;

        res.json({
            success: true,
            photoUrl
        });
    } catch (error) {
        console.error('Upload teacher photo error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при загрузке фото'
        });
    }
});

// ==================== УПРАВЛЕНИЕ РОЛЯМИ ====================

// Изменить роль пользователя (только Super Admin)
router.patch('/:id/change-role', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { role } = req.body;
        const userId = req.params.id;

        // Нельзя изменить свою роль
        if (userId === req.user._id.toString()) {
            return res.status(400).json({
                success: false,
                error: 'Нельзя изменить свою собственную роль'
            });
        }

        // Валидация роли
        const validRoles = ['student', 'sales_manager', 'teacher', 'admin', 'super_admin'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({
                success: false,
                error: 'Недопустимая роль'
            });
        }

        // Нельзя назначить другого super_admin
        if (role === 'super_admin') {
            return res.status(400).json({
                success: false,
                error: 'Нельзя назначить другого супер-администратора'
            });
        }

        const user = await Student.findById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }

        const oldRole = user.role;
        user.role = role;

        // Если назначаем преподавателем, инициализируем teacherInfo
        if (role === 'teacher' && !user.teacherInfo) {
            user.teacherInfo = {
                directions: [],
                assignedGroups: [],
                bio: '',
                photo: ''
            };
        }

        await user.save();

        // TODO: Отправить Telegram уведомление
        console.log(`🔄 Роль изменена: ${user.name} (${oldRole} → ${role})`);

        res.json({
            success: true,
            message: `Роль изменена с "${oldRole}" на "${role}"`,
            user: {
                id: user._id,
                name: user.name,
                phone: user.phone,
                role: user.role
            }
        });

    } catch (error) {
        console.error('Ошибка изменения роли:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера при изменении роли'
        });
    }
});

// ==================== АДМИНЫ ====================

// Получить список всех админов (только Super Admin)
router.get('/admins', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const admins = await Student.find({
            role: { $in: ['admin', 'super_admin'] },
            status: 'active'
        }).select('-password');

        res.json({
            success: true,
            count: admins.length,
            admins
        });

    } catch (error) {
        console.error('Ошибка получения списка админов:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера'
        });
    }
});

// Создать нового админа (только Super Admin)
router.post('/admins', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { name, lastName, phone, email, password } = req.body;

        // Валидация
        if (!name || !lastName || !phone) {
            return res.status(400).json({
                success: false,
                error: 'Имя, фамилия и телефон обязательны'
            });
        }

        // Проверка существования
        const existingUser = await Student.findOne({ phone });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'Пользователь с таким телефоном уже существует'
            });
        }

        // Генерация пароля если не указан
        const finalPassword = password || Math.random().toString(36).slice(-8);

        const admin = await Student.create({
            name,
            lastName,
            phone,
            email,
            password: finalPassword,
            role: 'admin',
            gender: req.body.gender || 'male' // Добавляем обязательное поле
        });

        // TODO: Отправить Telegram уведомление
        console.log(`🔑 Создан новый администратор: ${name} (${phone})`);

        // Инвалидировать кэш
        await cacheUtils.delPattern('students:*');

        res.status(201).json({
            success: true,
            message: 'Администратор создан',
            admin: {
                id: admin._id,
                name: admin.name,
                phone: admin.phone,
                email: admin.email,
                role: admin.role
            },
            generatedPassword: password ? undefined : finalPassword
        });

    } catch (error) {
        console.error('Ошибка создания админа:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера при создании администратора'
        });
    }
});

// Удалить админа (только Super Admin)
router.delete('/admins/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const adminId = req.params.id;

        // Нельзя удалить себя
        if (adminId === req.user._id.toString()) {
            return res.status(400).json({
                success: false,
                error: 'Нельзя удалить свою собственную учетную запись'
            });
        }

        const admin = await Student.findById(adminId);

        if (!admin) {
            return res.status(404).json({
                success: false,
                error: 'Администратор не найден'
            });
        }

        if (!['admin', 'super_admin'].includes(admin.role)) {
            return res.status(400).json({
                success: false,
                error: 'Это не администратор'
            });
        }

        // Нельзя удалить super_admin
        if (admin.role === 'super_admin') {
            return res.status(400).json({
                success: false,
                error: 'Нельзя удалить супер-администратора'
            });
        }

        await Student.findByIdAndDelete(adminId);

        // TODO: Отправить Telegram уведомление
        console.log(`⚠️ Удален администратор: ${admin.name} (${admin.phone})`);

        res.json({
            success: true,
            message: 'Администратор удален'
        });

    } catch (error) {
        console.error('Ошибка удаления админа:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера при удалении администратора'
        });
    }
});

// Понизить админа до student (только Super Admin)
router.patch('/admins/:id/demote', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const adminId = req.params.id;

        // Нельзя понизить себя
        if (adminId === req.user._id.toString()) {
            return res.status(400).json({
                success: false,
                error: 'Нельзя понизить свою собственную роль'
            });
        }

        const admin = await Student.findById(adminId);

        if (!admin) {
            return res.status(404).json({
                success: false,
                error: 'Администратор не найден'
            });
        }

        if (admin.role !== 'admin') {
            return res.status(400).json({
                success: false,
                error: 'Пользователь не является администратором'
            });
        }

        admin.role = 'student';
        await admin.save();

        // TODO: Отправить Telegram уведомление
        console.log(`🔄 Администратор понижен: ${admin.name} (admin → student)`);

        res.json({
            success: true,
            message: 'Администратор понижен до student',
            user: {
                id: admin._id,
                name: admin.name,
                role: admin.role
            }
        });

    } catch (error) {
        console.error('Ошибка понижения админа:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера'
        });
    }
});

// ==================== МЕНЕДЖЕРЫ ПО ПРОДАЖАМ ====================

// Получить список менеджеров (Admin и Super Admin)
router.get('/sales-managers', authenticate, requireAdmin, async (req, res) => {
    try {
        const managers = await Student.find({
            role: 'sales_manager',
            status: 'active'
        }).select('-password');

        res.json({
            success: true,
            count: managers.length,
            managers
        });

    } catch (error) {
        console.error('Ошибка получения списка менеджеров:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера'
        });
    }
});

// Создать менеджера (Admin и Super Admin)
router.post('/sales-managers', authenticate, requireAdmin, async (req, res) => {
    try {
        const { name, lastName, phone, email, password } = req.body;

        if (!name || !lastName || !phone) {
            return res.status(400).json({
                success: false,
                error: 'Имя, фамилия и телефон обязательны'
            });
        }

        const existingUser = await Student.findOne({ phone });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'Пользователь с таким телефоном уже существует'
            });
        }

        const finalPassword = password || Math.random().toString(36).slice(-8);

        const manager = await Student.create({
            name,
            lastName,
            phone,
            email,
            password: finalPassword,
            role: 'sales_manager',
            gender: req.body.gender || 'male' // Добавляем обязательное поле
        });

        // TODO: Отправить Telegram уведомление
        console.log(`💼 Добавлен менеджер по продажам: ${name} (${phone})`);

        // Инвалидировать кэш
        await cacheUtils.delPattern('students:*');

        res.status(201).json({
            success: true,
            message: 'Менеджер по продажам создан',
            manager: {
                id: manager._id,
                name: manager.name,
                phone: manager.phone,
                email: manager.email,
                role: manager.role
            },
            generatedPassword: password ? undefined : finalPassword
        });

    } catch (error) {
        console.error('Ошибка создания менеджера:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера при создании менеджера'
        });
    }
});

// Удалить менеджера (Admin и Super Admin)
router.delete('/sales-managers/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const managerId = req.params.id;

        const manager = await Student.findById(managerId);

        if (!manager) {
            return res.status(404).json({
                success: false,
                error: 'Менеджер не найден'
            });
        }

        if (manager.role !== 'sales_manager') {
            return res.status(400).json({
                success: false,
                error: 'Это не менеджер по продажам'
            });
        }

        await Student.findByIdAndDelete(managerId);

        console.log(`⚠️ Удален менеджер: ${manager.name} (${manager.phone})`);

        res.json({
            success: true,
            message: 'Менеджер удален'
        });

    } catch (error) {
        console.error('Ошибка удаления менеджера:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера при удалении менеджера'
        });
    }
});

// ==================== ПРЕПОДАВАТЕЛИ ====================

// Получить список преподавателей (Admin и Super Admin)
router.get('/teachers', authenticate, requireAdmin, async (req, res) => {
    try {
        const teachers = await Student.find({
            role: 'teacher',
            status: 'active'
        }).select('-password').populate('teacherInfo.assignedGroups', 'name direction');

        res.json({
            success: true,
            count: teachers.length,
            teachers
        });

    } catch (error) {
        console.error('Ошибка получения списка преподавателей:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера'
        });
    }
});

// Создать преподавателя (Admin и Super Admin)
router.post('/teachers', authenticate, requireAdmin, async (req, res) => {
    try {
        const { name, lastName, phone, email, password, directions, bio, photo } = req.body;

        if (!name || !lastName || !phone) {
            return res.status(400).json({
                success: false,
                error: 'Имя, фамилия и телефон обязательны'
            });
        }

        const existingUser = await Student.findOne({ phone });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'Пользователь с таким телефоном уже существует'
            });
        }

        const finalPassword = password || Math.random().toString(36).slice(-8);

        const teacher = await Student.create({
            name,
            lastName,
            phone,
            email,
            password: finalPassword,
            role: 'teacher',
            gender: req.body.gender || 'male', // Добавляем обязательное поле
            teacherInfo: {
                directions: directions || [],
                assignedGroups: [],
                bio: bio || '',
                photo: photo || ''
            }
        });

        // TODO: Отправить Telegram уведомление
        console.log(`👨‍🏫 Добавлен преподаватель: ${name} - ${directions?.join(', ') || 'нет направлений'}`);

        // Инвалидировать кэш
        await cacheUtils.invalidatePattern('students:*');

        res.status(201).json({
            success: true,
            message: 'Преподаватель создан',
            teacher: {
                id: teacher._id,
                name: teacher.name,
                phone: teacher.phone,
                email: teacher.email,
                role: teacher.role,
                teacherInfo: teacher.teacherInfo
            },
            generatedPassword: password ? undefined : finalPassword
        });

    } catch (error) {
        console.error('Ошибка создания преподавателя:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера при создании преподавателя'
        });
    }
});

// Редактировать преподавателя (Admin и Super Admin)
router.patch('/teachers/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const teacherId = req.params.id;
        const { name, lastName, phone, email, directions, bio, photo, displayOrder } = req.body;

        const teacher = await Student.findById(teacherId);

        if (!teacher) {
            return res.status(404).json({
                success: false,
                error: 'Преподаватель не найден'
            });
        }

        if (teacher.role !== 'teacher') {
            return res.status(400).json({
                success: false,
                error: 'Это не преподаватель'
            });
        }

        // Обновляем поля
        if (name) teacher.name = name;
        if (lastName !== undefined) teacher.lastName = lastName;
        if (phone) teacher.phone = phone;
        if (email !== undefined) teacher.email = email;

        if (directions) teacher.teacherInfo.directions = directions;
        if (bio !== undefined) teacher.teacherInfo.bio = bio;
        if (photo !== undefined) teacher.teacherInfo.photo = photo;
        if (displayOrder !== undefined) teacher.teacherInfo.displayOrder = displayOrder;

        await teacher.save();

        res.json({
            success: true,
            message: 'Преподаватель обновлен',
            teacher: {
                id: teacher._id,
                name: teacher.name,
                phone: teacher.phone,
                email: teacher.email,
                teacherInfo: teacher.teacherInfo
            }
        });

    } catch (error) {
        console.error('Ошибка обновления преподавателя:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера при обновлении преподавателя'
        });
    }
});

// Удалить преподавателя (только Super Admin)
router.delete('/teachers/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const teacherId = req.params.id;

        const teacher = await Student.findById(teacherId);

        if (!teacher) {
            return res.status(404).json({
                success: false,
                error: 'Преподаватель не найден'
            });
        }

        if (teacher.role !== 'teacher') {
            return res.status(400).json({
                success: false,
                error: 'Это не преподаватель'
            });
        }

        await Student.findByIdAndDelete(teacherId);

        console.log(`⚠️ Удален преподаватель: ${teacher.name} (${teacher.phone})`);

        res.json({
            success: true,
            message: 'Преподаватель удален'
        });

    } catch (error) {
        console.error('Ошибка удаления преподавателя:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера при удалении преподавателя'
        });
    }
});

// Назначить группу преподавателю (Admin и Super Admin)
router.post('/teachers/:id/assign-group', authenticate, requireAdmin, async (req, res) => {
    try {
        const teacherId = req.params.id;
        const { groupId } = req.body;

        if (!groupId) {
            return res.status(400).json({
                success: false,
                error: 'ID группы обязателен'
            });
        }

        const teacher = await Student.findById(teacherId);

        if (!teacher || teacher.role !== 'teacher') {
            return res.status(404).json({
                success: false,
                error: 'Преподаватель не найден'
            });
        }

        // Проверяем, не назначена ли уже эта группа
        if (teacher.teacherInfo.assignedGroups.includes(groupId)) {
            return res.status(400).json({
                success: false,
                error: 'Группа уже назначена этому преподавателю'
            });
        }

        teacher.teacherInfo.assignedGroups.push(groupId);
        await teacher.save();

        res.json({
            success: true,
            message: 'Группа назначена преподавателю',
            assignedGroups: teacher.teacherInfo.assignedGroups
        });

    } catch (error) {
        console.error('Ошибка назначения группы:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера'
        });
    }
});

// Убрать группу у преподавателя (Admin и Super Admin)
router.delete('/teachers/:id/remove-group/:groupId', authenticate, requireAdmin, async (req, res) => {
    try {
        const teacherId = req.params.id;
        const groupId = req.params.groupId;

        const teacher = await Student.findById(teacherId);

        if (!teacher || teacher.role !== 'teacher') {
            return res.status(404).json({
                success: false,
                error: 'Преподаватель не найден'
            });
        }

        teacher.teacherInfo.assignedGroups = teacher.teacherInfo.assignedGroups.filter(
            g => g.toString() !== groupId
        );

        await teacher.save();

        res.json({
            success: true,
            message: 'Группа убрана у преподавателя',
            assignedGroups: teacher.teacherInfo.assignedGroups
        });

    } catch (error) {
        console.error('Ошибка удаления группы:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера'
        });
    }
});

// ==================== СБРОС ПАРОЛЯ ====================

// Сбросить пароль пользователя (Admin/Super Admin)
router.post('/:id/reset-password', authenticate, requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;

        // Нельзя сбросить свой пароль через этот метод
        if (userId === req.user._id.toString()) {
            return res.status(400).json({
                success: false,
                error: 'Используйте функцию смены пароля в профиле'
            });
        }

        const user = await Student.findById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }

        // Генерируем новый пароль
        const newPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4).toUpperCase();

        // Присваиваем новый пароль (модель сама хэширует через pre-save hook)
        user.password = newPassword;
        await user.save();

        console.log(`🔐 Админ ${req.user.name} сбросил пароль для ${user.name}`);

        res.json({
            success: true,
            message: 'Пароль успешно сброшен',
            newPassword,
            user: {
                id: user._id,
                name: user.name,
                phone: user.phone
            }
        });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при сбросе пароля'
        });
    }
});

module.exports = router;



