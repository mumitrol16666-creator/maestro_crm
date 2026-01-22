const mongoose = require('mongoose');

const rolePermissionsSchema = new mongoose.Schema({
    role: {
        type: String,
        required: true,
        enum: ['student', 'sales_manager', 'teacher', 'admin', 'super_admin'],
        unique: true
    },

    // Функциональные права
    permissions: {
        // Заявки
        manageBookings: { type: Boolean, default: false },
        deleteBookings: { type: Boolean, default: false },

        // Ученики
        manageStudents: { type: Boolean, default: false },
        viewStudents: { type: Boolean, default: false },
        deleteStudents: { type: Boolean, default: false },

        // Группы
        manageGroups: { type: Boolean, default: false },
        viewGroups: { type: Boolean, default: false },
        deleteGroups: { type: Boolean, default: false },

        // Абонементы
        manageMemberships: { type: Boolean, default: false },
        deleteMemberships: { type: Boolean, default: false },

        // Преподаватели
        createTeachers: { type: Boolean, default: false },
        editTeachers: { type: Boolean, default: false },
        deleteTeachers: { type: Boolean, default: false },

        // Менеджеры
        deleteManagers: { type: Boolean, default: false },

        // Администраторы
        manageAdmins: { type: Boolean, default: false },

        // Посещаемость
        markAttendance: { type: Boolean, default: false },

        // Практики
        managePractices: { type: Boolean, default: false },
        deletePractices: { type: Boolean, default: false },

        // Направления
        manageDirections: { type: Boolean, default: false },
        deleteDirections: { type: Boolean, default: false },

        // Залы
        manageRooms: { type: Boolean, default: false },
        deleteRooms: { type: Boolean, default: false },

        // Системные настройки
        systemSettings: { type: Boolean, default: false }
    },

    // Видимость разделов в админке
    visibility: {
        dashboard: { type: Boolean, default: true },
        bookings: { type: Boolean, default: false },
        students: { type: Boolean, default: false },
        groups: { type: Boolean, default: false },
        memberships: { type: Boolean, default: false },
        practices: { type: Boolean, default: false },
        schedule: { type: Boolean, default: false },
        directions: { type: Boolean, default: false },
        users: { type: Boolean, default: false },
        roles: { type: Boolean, default: false },
        blog: { type: Boolean, default: false },
        payments: { type: Boolean, default: false },
        bot: { type: Boolean, default: false }
    }
}, {
    timestamps: true
});

// Статический метод для получения прав по умолчанию для роли
rolePermissionsSchema.statics.getDefaultPermissions = function (role) {
    const defaults = {
        super_admin: {
            permissions: {
                manageBookings: true,
                deleteBookings: true,
                manageStudents: true,
                viewStudents: true,
                deleteStudents: true,
                manageGroups: true,
                viewGroups: true,
                deleteGroups: true,
                manageMemberships: true,
                deleteMemberships: true,
                createTeachers: true,
                editTeachers: true,
                deleteTeachers: true,
                deleteManagers: true,
                manageAdmins: true,
                markAttendance: true,
                managePractices: true,
                deletePractices: true,
                manageDirections: true,
                deleteDirections: true,
                manageRooms: true,
                deleteRooms: true,
                systemSettings: true
            },
            visibility: {
                dashboard: true,
                bookings: true,
                students: true,
                groups: true,
                memberships: true,
                practices: true,
                schedule: true,
                directions: true,
                users: true,
                roles: true,
                blog: true,
                payments: true,
                cashbox: true,
                bot: true
            }
        },
        admin: {
            permissions: {
                manageBookings: true,
                deleteBookings: false,
                manageStudents: true,
                viewStudents: true,
                deleteStudents: false,
                manageGroups: true,
                viewGroups: true,
                deleteGroups: false,
                manageMemberships: true,
                deleteMemberships: false,
                createTeachers: true,
                editTeachers: true,
                deleteTeachers: false,
                deleteManagers: false,
                manageAdmins: false,
                markAttendance: true,
                managePractices: true,
                deletePractices: false,
                manageDirections: false,
                deleteDirections: false,
                manageRooms: true,
                deleteRooms: false,
                systemSettings: false
            },
            visibility: {
                dashboard: true,
                bookings: true,
                students: true,
                groups: true,
                memberships: true,
                practices: true,
                schedule: true,
                directions: false,
                users: true,
                roles: true,
                blog: true,
                payments: true,
                cashbox: true,
                bot: true
            }
        },
        sales_manager: {
            permissions: {
                manageBookings: true,
                deleteBookings: false,
                manageStudents: false,
                viewStudents: true,
                deleteStudents: false,
                manageGroups: false,
                viewGroups: true,
                deleteGroups: false,
                manageMemberships: false,
                deleteMemberships: false,
                createTeachers: false,
                editTeachers: false,
                deleteTeachers: false,
                deleteManagers: false,
                manageAdmins: false,
                markAttendance: false,
                managePractices: false,
                deletePractices: false,
                manageDirections: false,
                manageRooms: false,
                systemSettings: false
            },
            visibility: {
                dashboard: true,
                bookings: true,
                students: true,
                groups: true,
                memberships: false,
                practices: false,
                schedule: false,
                directions: false,
                users: false,
                roles: false,
                blog: false,
                payments: true,
                cashbox: false,
                bot: true
            }
        },
        teacher: {
            permissions: {
                manageBookings: false,
                deleteBookings: false,
                manageStudents: false,
                viewStudents: true,
                deleteStudents: false,
                manageGroups: true,  // ✅ Преподаватель может добавлять учеников в группы
                viewGroups: true,
                deleteGroups: false,
                manageMemberships: false,
                deleteMemberships: false,
                createTeachers: false,
                editTeachers: false,
                deleteTeachers: false,
                deleteManagers: false,
                manageAdmins: false,
                markAttendance: true,  // ✅ Может отмечать посещаемость
                managePractices: true,  // ✅ Может управлять практиками
                deletePractices: false,
                manageDirections: false,
                deleteDirections: false,
                manageRooms: false,
                deleteRooms: false,
                systemSettings: false
            },
            visibility: {
                dashboard: false,
                bookings: false,
                students: true,       // ✅ Видит учеников
                groups: false,
                memberships: false,
                practices: false,
                schedule: true,       // ✅ Видит расписание
                directions: false,
                users: false,
                roles: false,
                blog: false,
                payments: false,
                cashbox: false,
                bot: false
            }
        },
        student: {
            permissions: {
                manageBookings: false,
                deleteBookings: false,
                manageStudents: false,
                viewStudents: false,
                deleteStudents: false,
                manageGroups: false,
                viewGroups: false,
                deleteGroups: false,
                manageMemberships: false,
                deleteMemberships: false,
                createTeachers: false,
                editTeachers: false,
                deleteTeachers: false,
                deleteManagers: false,
                manageAdmins: false,
                markAttendance: false,
                managePractices: false,
                deletePractices: false,
                manageDirections: false,
                deleteDirections: false,
                manageRooms: false,
                deleteRooms: false,
                systemSettings: false
            },
            visibility: {
                dashboard: false,
                bookings: false,
                students: false,
                groups: false,
                memberships: false,
                practices: false,
                schedule: false,
                directions: false,
                users: false,
                roles: false,
                blog: false,
                payments: false,
                cashbox: false,
                bot: false
            }
        }
    };

    return defaults[role] || defaults.student;
};

module.exports = mongoose.model('RolePermissions', rolePermissionsSchema);

