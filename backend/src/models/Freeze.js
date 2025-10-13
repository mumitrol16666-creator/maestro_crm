const mongoose = require('mongoose');

const freezeSchema = new mongoose.Schema({
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
    },
    
    membership: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Membership',
        required: true
    },
    
    type: {
        type: String,
        enum: [
            'regular',        // Обычная бесплатная заморозка
            'period',         // Менструация (женщины)
            'business_trip',  // Командировка (только админ)
            'sick',          // Болезнь (только админ)
            'other'          // Другая причина (только админ)
        ],
        required: true
    },
    
    // Заморозка по ЗАНЯТИЯМ (не датам!)
    frozenClasses: {
        type: Number,
        required: true,
        min: 1
    },
    
    classesUsed: {
        type: Number,
        default: 0
    },
    
    // Даты (для справки и автоматического применения)
    startDate: {
        type: Date,
        required: true
    },
    
    endDate: {
        type: Date,
        required: true
    },
    
    // Статус
    status: {
        type: String,
        enum: ['pending', 'active', 'completed', 'rejected', 'cancelled'],
        default: 'pending'
    },
    
    // Причина (для командировки/болезни/другое)
    reason: {
        type: String
    },
    
    // Кто создал (если админ создал за ученика)
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student'
    },
    
    // Кто одобрил/отклонил
    processedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student'
    },
    
    processedAt: {
        type: Date
    },
    
    rejectionReason: {
        type: String
    }
}, {
    timestamps: true
});

// Метод для одобрения заморозки
freezeSchema.methods.approve = async function(adminId) {
    if (this.status !== 'pending') {
        throw new Error('Заморозка уже обработана');
    }
    
    this.status = 'active';
    this.processedBy = adminId;
    this.processedAt = new Date();
    
    await this.save();
};

// Метод для отклонения заморозки
freezeSchema.methods.reject = async function(adminId, reason) {
    if (this.status !== 'pending') {
        throw new Error('Заморозка уже обработана');
    }
    
    this.status = 'rejected';
    this.processedBy = adminId;
    this.processedAt = new Date();
    this.rejectionReason = reason;
    
    await this.save();
};

// Метод для использования одного занятия из заморозки
freezeSchema.methods.useClass = async function() {
    if (this.status !== 'active') {
        throw new Error('Заморозка не активна');
    }
    
    if (this.classesUsed >= this.frozenClasses) {
        throw new Error('Все замороженные занятия использованы');
    }
    
    this.classesUsed += 1;
    
    // Если все занятия использованы, завершить заморозку
    if (this.classesUsed >= this.frozenClasses) {
        this.status = 'completed';
    }
    
    await this.save();
};

module.exports = mongoose.model('Freeze', freezeSchema);

