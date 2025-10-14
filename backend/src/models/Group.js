const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Название группы обязательно'],
        trim: true
    },
    
    direction: {
        type: String,
        required: [true, 'Направление обязательно'],
        enum: [
            'K-pop',
            'CHOREO',
            'K-pop CHOREO',
            'All styles',
            'JUZZFUNK',
            'Girlish',
            'High heels',
            'Bachata lady style',
            'Bachata lady style 45+',
            'Social bachata'
        ]
    },
    
    level: {
        type: String,
        enum: ['beginner', 'intermediate', 'advanced'],
        default: 'beginner'
    },
    
    instructor: {
        type: String,
        required: [true, 'Преподаватель обязателен'],
        default: 'ИМЯ ФАМИЛИЯ'
    },
    
    // Ссылка на преподавателя (для календаря и прав доступа)
    teacher: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: false  // Необязательное, для обратной совместимости
    },
    
    // Расписание группы (можно несколько занятий в неделю)
    schedule: [{
        dayOfWeek: {
            type: Number, // 1=Понедельник, 7=Воскресенье
            required: true,
            min: 1,
            max: 7
        },
        time: {
            type: String, // "18:00"
            required: true
        },
        duration: {
            type: Number, // Минуты
            default: 90
        },
        isPractice: {
            type: Boolean, // Это практика (доступна всем) или обычное занятие
            default: false
        }
    }],
    
    maxStudents: {
        type: Number,
        default: 15
    },
    
    currentStudents: {
        type: Number,
        default: 0
    },
    
    isActive: {
        type: Boolean,
        default: true
    },
    
    description: {
        type: String
    },
    
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Виртуальное поле для проверки заполненности
groupSchema.virtual('isFull').get(function() {
    return this.currentStudents >= this.maxStudents;
});

// Виртуальное поле для процента заполненности
groupSchema.virtual('fillPercentage').get(function() {
    return Math.round((this.currentStudents / this.maxStudents) * 100);
});

// Метод для получения расписания в читаемом формате
groupSchema.methods.getScheduleText = function() {
    const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    return this.schedule.map(s => `${days[s.dayOfWeek - 1]} ${s.time}`).join(', ');
};

// ⚡ ИНДЕКСЫ для оптимизации запросов
groupSchema.index({ direction: 1, isActive: 1 });  // Фильтрация по направлению
groupSchema.index({ teacher: 1 });                 // Поиск групп преподавателя
groupSchema.index({ isActive: 1 });                // Активные группы

module.exports = mongoose.model('Group', groupSchema);

