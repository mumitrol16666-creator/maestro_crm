const mongoose = require('mongoose');

const classSchema = new mongoose.Schema({
    group: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group',
        required: false  // Необязательное для специальных занятий (Аренда, Индивидуальное)
    },
    teacher: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
    },
    room: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Room',
        required: false  // Может быть не указан
    },
    title: {
        type: String,
        required: true
    },
    date: {
        type: Date,
        required: true
    },
    startTime: {
        type: String,
        required: true  // "18:00"
    },
    endTime: {
        type: String,
        required: true  // "19:30"
    },
    duration: {
        type: Number,
        default: 90  // минуты
    },
    status: {
        type: String,
        enum: ['scheduled', 'completed', 'cancelled'],
        default: 'scheduled'
    },
    isRecurring: {
        type: Boolean,
        default: false
    },
    recurringRule: {
        frequency: {
            type: String,
            enum: ['daily', 'weekly', 'monthly', 'none'],
            default: 'none'
        },
        daysOfWeek: [Number],  // 0 = Воскресенье, 1 = Понедельник, ... 6 = Суббота
        endDate: Date
    },
    attendees: [{
        student: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Student'
        },
        attended: {
            type: Boolean,
            default: false
        },
        markedAt: Date,
        autoDeducted: {
            type: Boolean,
            default: false
        }
    }],
    notes: {
        type: String,
        default: ''
    },
    backgroundColor: {
        type: String,
        default: '#eb4d77'  // Pink
    },
    isPractice: {
        type: Boolean,
        default: false  // Это практика или обычное занятие
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student'
    }
}, {
    timestamps: true
});

// Индексы для быстрого поиска
classSchema.index({ teacher: 1, date: 1 });
classSchema.index({ group: 1, date: 1 });
classSchema.index({ date: 1, status: 1 });

module.exports = mongoose.model('Class', classSchema);

