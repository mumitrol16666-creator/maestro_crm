const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const studentSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Имя обязательно'],
        trim: true
    },
    
    phone: {
        type: String,
        required: [true, 'Телефон обязателен'],
        unique: true,
        trim: true
    },
    
    // ⚡ Только цифры телефона для быстрого поиска
    phoneDigits: {
        type: String,
        index: true
    },
    
    email: {
        type: String,
        trim: true,
        lowercase: true,
        sparse: true // Позволяет null, но делает unique для не-null значений
    },
    
    password: {
        type: String,
        required: [true, 'Пароль обязателен'],
        minlength: 6,
        select: false // Не возвращать по умолчанию при запросах
    },
    
    dateOfBirth: {
        type: Date
    },
    
    gender: {
        type: String,
        enum: ['male', 'female'],
        required: function() {
            // Пол обязателен только для учеников (для расчета заморозок)
            return this.role === 'student';
        }
    },
    
    // Группы ученика (максимум 2)
    groups: [{
        groupId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Group'
        },
        joinedAt: {
            type: Date,
            default: Date.now
        },
        status: {
            type: String,
            enum: ['active', 'frozen', 'left'],
            default: 'active'
        }
    }],
    
    // Текущий активный абонемент
    activeMembership: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Membership'
    },
    
    role: {
        type: String,
        enum: ['student', 'sales_manager', 'teacher', 'admin', 'super_admin'],
        default: 'student'
    },
    
    // Информация для преподавателей
    teacherInfo: {
        directions: [String],  // Направления которые ведет
        assignedGroups: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Group'
        }],
        bio: String,
        photo: String
    },
    
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },
    
    notes: {
        type: String
    },
    
    registeredAt: {
        type: Date,
        default: Date.now
    },
    
    // Согласие с публичной офертой
    offerAccepted: {
        type: Boolean,
        default: false
    },
    
    offerAcceptedAt: {
        type: Date
    }
}, {
    timestamps: true
});

// Автоматическое заполнение phoneDigits перед сохранением
studentSchema.pre('save', function(next) {
    if (this.isModified('phone')) {
        // Извлекаем только цифры из телефона
        this.phoneDigits = this.phone.replace(/\D/g, '');
    }
    next();
});

// Хеширование пароля перед сохранением
studentSchema.pre('save', async function(next) {
    if (!this.isModified('password')) {
        return next();
    }
    
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Метод для проверки пароля
studentSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Метод для получения данных без пароля
studentSchema.methods.toJSON = function() {
    const obj = this.toObject();
    delete obj.password;
    return obj;
};

// Виртуальное поле для количества групп
studentSchema.virtual('groupsCount').get(function() {
    return this.groups.filter(g => g.status === 'active').length;
});

// ⚡ ИНДЕКСЫ для оптимизации запросов
studentSchema.index({ phone: 1 }, { unique: true });  // Логин (уникальный)
studentSchema.index({ phoneDigits: 1 });              // Поиск по цифрам телефона
studentSchema.index({ role: 1, status: 1 });          // Фильтрация по роли и статусу
studentSchema.index({ 'groups.groupId': 1 });         // Поиск учеников группы
studentSchema.index({ registeredAt: -1 });            // Сортировка по дате регистрации
studentSchema.index({ activeMembership: 1 });         // Поиск по абонементу

module.exports = mongoose.model('Student', studentSchema);



