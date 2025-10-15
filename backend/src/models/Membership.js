const mongoose = require('mongoose');

const membershipSchema = new mongoose.Schema({
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
    },
    
    group: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group',
        required: true
    },
    
    type: {
        type: String,
        enum: ['trial', 'monthly', 'quarterly', 'individual_single', 'individual_package'],
        required: true
    },
    
    // Количество занятий
    totalClasses: {
        type: Number,
        required: true
        // trial: 1, monthly: 8, quarterly: 24
    },
    
    classesRemaining: {
        type: Number,
        required: true
    },
    
    classesUsed: {
        type: Number,
        default: 0
    },
    
    // Даты
    startDate: {
        type: Date,
        required: true
    },
    
    endDate: {
        type: Date,
        required: true
    },
    
    activatedAt: {
        type: Date,
        default: Date.now
    },
    
    // Заморозки
    freezesAvailable: {
        type: Number,
        default: 1 // Будет 2 для женщин при создании
    },
    
    freezesUsed: {
        type: Number,
        default: 0
    },
    
    // История всех операций с абонементом
    transactions: [{
        type: {
            type: String,
            enum: ['deduct', 'add', 'freeze_used', 'initial', 'extension'],
            required: true
        },
        amount: {
            type: Number,
            required: true
        },
        reason: {
            type: String,
            required: true
        },
        date: {
            type: Date,
            default: Date.now
        },
        classId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Class'
        },
        freezeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Freeze'
        },
        addedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Student'
        }
    }],
    
    status: {
        type: String,
        enum: ['active', 'expired', 'frozen'],
        default: 'active'
    },
    
    // Отслеживание продаж для менеджеров
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student'  // Админ/менеджер кто создал абонемент
    },
    
    booking: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking'  // Ссылка на заявку (если создан из заявки)
    },
    
    source: {
        type: String,
        enum: ['booking', 'manual', 'renewal'],
        default: 'manual'
        // booking: создан при конвертации заявки
        // manual: создан вручную админом
        // renewal: продление абонемента
    },
    
    // 💰 ПЛАТЕЖИ (новые поля для системы оплаты)
    totalPrice: {
        type: Number,
        default: 0  // Общая стоимость абонемента (22000₸)
    },
    
    paidAmount: {
        type: Number,
        default: 0  // Сколько уже оплачено (5000₸)
    },
    
    remainingAmount: {
        type: Number,
        default: 0  // Остаток к оплате (17000₸)
    },
    
    // Массив платежей по этому абонементу
    payments: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Payment'
    }],
    
    // Статус оплаты
    paymentStatus: {
        type: String,
        enum: ['not_paid', 'partial', 'paid'],
        default: 'not_paid'
        // not_paid: Не оплачено
        // partial: Частично (есть аванс)
        // paid: Полностью оплачено
    }
}, {
    timestamps: true
});

// Метод для списания занятия
membershipSchema.methods.deductClass = async function(classId, reason = 'Занятие пройдено') {
    if (this.classesRemaining <= 0) {
        throw new Error('Нет доступных занятий');
    }
    
    this.classesRemaining -= 1;
    this.classesUsed += 1;
    
    this.transactions.push({
        type: 'deduct',
        amount: 1,
        reason,
        classId,
        date: new Date()
    });
    
    // Обновить статус если занятия закончились
    if (this.classesRemaining === 0) {
        this.status = 'expired';
    }
    
    await this.save();
};

// Метод для добавления занятий (админ)
membershipSchema.methods.addClasses = async function(amount, reason, adminId) {
    this.classesRemaining += amount;
    this.totalClasses += amount;
    
    this.transactions.push({
        type: 'add',
        amount,
        reason,
        addedBy: adminId,
        date: new Date()
    });
    
    // Активировать если был expired
    if (this.status === 'expired' && this.classesRemaining > 0) {
        this.status = 'active';
    }
    
    await this.save();
};

// Метод для использования заморозки
membershipSchema.methods.useFreezeSlot = async function(freezeId) {
    if (this.freezesUsed >= this.freezesAvailable) {
        throw new Error('Нет доступных заморозок');
    }
    
    this.freezesUsed += 1;
    
    this.transactions.push({
        type: 'freeze_used',
        amount: 1,
        reason: 'Использована заморозка',
        freezeId,
        date: new Date()
    });
    
    await this.save();
};

// Метод для продления (суммирование остатка)
membershipSchema.statics.renew = async function(studentId, newType, newPrice) {
    const classesCount = {
        'trial': 1,
        'monthly': 8,
        '3months': 24
    };
    
    // Находим текущий активный абонемент
    const currentMembership = await this.findOne({
        student: studentId,
        status: 'active'
    });
    
    const remainingClasses = currentMembership ? currentMembership.classesRemaining : 0;
    
    // Деактивируем старый
    if (currentMembership) {
        currentMembership.status = 'expired';
        await currentMembership.save();
    }
    
    // Создаем новый с суммой
    const newMembership = await this.create({
        student: studentId,
        type: newType,
        price: newPrice,
        classesTotal: classesCount[newType],
        classesRemaining: classesCount[newType] + remainingClasses, // СУММИРУЕМ!
        classesUsed: 0,
        startDate: new Date(),
        status: 'active',
        paymentStatus: 'pending'
    });
    
    return newMembership;
};

// ⚡ ИНДЕКСЫ для оптимизации запросов
membershipSchema.index({ student: 1, status: 1 });        // Поиск абонементов студента
membershipSchema.index({ group: 1, status: 1 });          // Поиск по группе
membershipSchema.index({ status: 1, classesRemaining: 1 }); // Истекающие абонементы
membershipSchema.index({ createdAt: -1 });                // Сортировка по дате создания

module.exports = mongoose.model('Membership', membershipSchema);
