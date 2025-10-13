const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Имя обязательно'],
        trim: true
    },
    
    phone: {
        type: String,
        required: [true, 'Телефон обязателен'],
        trim: true
    },
    
    direction: {
        type: String,
        required: [true, 'Направление обязательно']
    },
    
    gender: {
        type: String,
        enum: ['male', 'female', null],
        default: null
    },
    
    source: {
        type: String,
        enum: ['Телефонный звонок', 'WhatsApp', 'Instagram Direct', 'Личное обращение', 'Сайт', 'Рекомендация', '1fit', 'Другое'],
        default: 'Сайт' // Источник заявки
    },
    
    status: {
        type: String,
        enum: ['new', 'processed', 'trial', 'rejected'],
        default: 'new'
        // 'new': Новая заявка
        // 'processed': Думает (обработана, но еще не записался)
        // 'trial': Пробное занятие (записался на пробное)
        // 'rejected': Отклонена
    },
    
    notes: {
        type: String
    },
    
    createdBy: {
        type: String,
        enum: ['website', 'admin', 'telegram'],
        default: 'website'
    },
    
    processedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student' // Админ кто обработал
    },
    
    processedAt: {
        type: Date
    },
    
    // Если заявка конвертирована в ученика
    convertedToStudent: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student'
    },
    
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Индекс для быстрого поиска новых заявок
bookingSchema.index({ status: 1, createdAt: -1 });

// Метод для изменения статуса
bookingSchema.methods.updateStatus = async function(newStatus, adminId) {
    this.status = newStatus;
    this.processedBy = adminId;
    this.processedAt = new Date();
    await this.save();
    return this;
};

// Метод для конвертации в ученика
bookingSchema.methods.convertToStudent = async function(password) {
    const Student = mongoose.model('Student');
    
    const student = await Student.create({
        name: this.name,
        phone: this.phone,
        password: password || 'changeme123', // Временный пароль
        role: 'student'
    });
    
    this.convertedToStudent = student._id;
    this.status = 'enrolled';
    this.processedAt = new Date();
    await this.save();
    
    return student;
};

module.exports = mongoose.model('Booking', bookingSchema);


