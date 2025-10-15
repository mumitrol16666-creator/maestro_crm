const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    // Кто платит
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true,
        index: true
    },
    
    // Кто принял платеж (менеджер)
    manager: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',  // User with role 'sales_manager'
        required: true,
        index: true
    },
    
    // Сумма платежа (в тенге)
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    
    // Дата ФАКТИЧЕСКОГО платежа
    paymentDate: {
        type: Date,
        required: true,
        index: true,
        default: Date.now
    },
    
    // Тип платежа
    type: {
        type: String,
        required: true,
        enum: [
            'trial_advance',        // Аванс за пробное (2000₸)
            'trial_full',           // Полная оплата пробного
            'membership_advance',   // Аванс за абонемент (3000₸)
            'membership_balance',   // Доплата за абонемент (19000₸)
            'membership_full',      // Полная оплата абонемента
            'single_class',         // Разовое занятие
            'individual_class'      // Индивидуальное занятие
        ],
        index: true
    },
    
    // Связь с авансом (для доплат)
    relatedPayment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Payment',
        default: null
    },
    
    // Связь с абонементом
    membership: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Membership',
        default: null
    },
    
    // Связь с заявкой (если есть)
    booking: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking',
        default: null
    },
    
    // Связь с занятием (для индивидуальных/разовых)
    relatedClass: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Class',
        default: null
    },
    
    // Статус платежа
    status: {
        type: String,
        required: true,
        enum: [
            'pending',                  // Ожидает доплаты (аванс)
            'completed',                // Полностью оплачено
            'converted_to_membership',  // Пробный→Абонемент
            'refunded',                 // Возврат
            'cancelled'                 // Отменен
        ],
        default: 'completed',
        index: true
    },
    
    // Для расчета зарплаты
    commissionStatus: {
        type: String,
        required: true,
        enum: [
            'pending',              // Не учтено в зарплате
            'included_in_month',    // Учтено в зарплате (месяц)
            'recalculated'          // Пересчитано (доплата)
        ],
        default: 'pending',
        index: true
    },
    
    // В каком месяце учли в зарплате ('2024-09')
    includedInSalaryMonth: {
        type: String,
        default: null,
        index: true
    },
    
    // Преподаватель (для индивидуальных занятий)
    teacher: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',  // User with role 'teacher'
        default: null
    },
    
    // Комментарий/примечание
    notes: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

// Индексы для быстрого поиска
paymentSchema.index({ paymentDate: 1, manager: 1 });
paymentSchema.index({ paymentDate: 1, teacher: 1 });
paymentSchema.index({ student: 1, paymentDate: -1 });
paymentSchema.index({ membership: 1 });

// Виртуальное поле для месяца (для группировки)
paymentSchema.virtual('month').get(function() {
    const date = new Date(this.paymentDate);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
});

// Метод для получения текста типа платежа
paymentSchema.methods.getTypeText = function() {
    const types = {
        'trial_advance': 'Аванс за пробное',
        'trial_full': 'Пробное занятие',
        'membership_advance': 'Аванс за абонемент',
        'membership_balance': 'Доплата за абонемент',
        'membership_full': 'Абонемент (полная оплата)',
        'single_class': 'Разовое занятие',
        'individual_class': 'Индивидуальное занятие'
    };
    return types[this.type] || this.type;
};

// Метод для получения текста статуса
paymentSchema.methods.getStatusText = function() {
    const statuses = {
        'pending': 'Ожидает доплаты',
        'completed': 'Оплачено',
        'converted_to_membership': 'Конвертировано в абонемент',
        'refunded': 'Возврат',
        'cancelled': 'Отменено'
    };
    return statuses[this.status] || this.status;
};

module.exports = mongoose.model('Payment', paymentSchema);
