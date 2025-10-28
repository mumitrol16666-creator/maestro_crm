const mongoose = require('mongoose');

const salarySchema = new mongoose.Schema({
    teacher: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
    },
    teacherName: {
        type: String,
        required: true
    },
    period: {
        start: {
            type: Date,
            required: true
        },
        end: {
            type: Date,
            required: true
        }
    },
    // Статистика по занятиям (изменили с groups на classes)
    classes: [{
        classId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Class'
        },
        className: String,
        classDate: Date,
        groupName: String,
        // Статистика по ученикам на занятии
        students: [{
            studentId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Student'
            },
            studentName: String,
            // Абонемент ученика
            membership: {
                membershipId: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'Membership'
                },
                totalClasses: Number, // Общее количество занятий в абонементе
                price: Number, // Стоимость абонемента
                pricePerClass: Number // Стоимость одного занятия (price / totalClasses)
            },
            // Посещения
            attendedClasses: Number, // Количество посещенных занятий
            totalEarnings: Number // Общий заработок с этого ученика (attendedClasses * pricePerClass)
        }],
        // Итого по занятию
        totalAttendedClasses: Number,
        totalEarnings: Number
    }],
    // Общая статистика
    totalClasses: Number,
    totalStudents: Number,
    totalAttendedClasses: Number,
    totalEarnings: Number, // Общий доход от всех учеников
    teacherPercentage: {
        type: Number,
        default: 35 // Процент преподавателя (35%)
    },
    teacherSalary: Number, // Зарплата преподавателя (totalEarnings * teacherPercentage / 100)
    // Статус
    status: {
        type: String,
        enum: ['calculated', 'paid', 'cancelled'],
        default: 'calculated'
    },
    // Даты
    calculatedAt: {
        type: Date,
        default: Date.now
    },
    paidAt: Date,
    // Комментарии
    notes: String
}, {
    timestamps: true
});

// Индексы для оптимизации
salarySchema.index({ teacher: 1, period: 1 });
salarySchema.index({ status: 1 });
salarySchema.index({ calculatedAt: -1 });

module.exports = mongoose.model('Salary', salarySchema);
