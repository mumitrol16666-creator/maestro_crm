const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    // Кто платит
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true,
        index: true
    },
    
    // 📝 Информация о студенте на момент платежа (для истории, если студент удален)
    studentName: {
        type: String,
        required: false  // Будет заполняться автоматически
    },
    
    studentPhone: {
        type: String,
        required: false  // Будет заполняться автоматически
    },
    
    // Кто принял платеж (менеджер)
    manager: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',  // User with role 'sales_manager'
        required: true,
        index: true
    },
    
    // 📝 Информация о менеджере на момент платежа
    managerName: {
        type: String,
        required: false  // Будет заполняться автоматически
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
            'recalculated',         // Пересчитано (доплата)
            'excluded'              // НЕ учитывается (продление абонемента)
        ],
        default: 'pending',
        index: true
    },
    
    // 💰 ВАЖНО: Это первый абонемент ученика у данного менеджера?
    // Менеджер получает комиссию ТОЛЬКО от первого абонемента
    isFirstMembershipForManager: {
        type: Boolean,
        default: false,
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
    },
    
    // 🔴 ОТСЛЕЖИВАНИЕ ПРОСРОЧКИ
    dueDate: {
        type: Date,
        default: null,  // Крайний срок оплаты (для авансов и "оплатит позже")
        index: true
    },
    
    maxClassesBeforePayment: {
        type: Number,
        default: null  // До какого занятия нужно оплатить (напр. 4 из 8)
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

// 🔴 Метод проверки просрочки
paymentSchema.methods.isOverdue = function(membership = null) {
    // Если платеж завершен - не просрочен
    if (this.status === 'completed' || this.status === 'refunded' || this.status === 'cancelled') {
        return false;
    }
    
    const now = new Date();
    let isOverdue = false;
    
    // Проверка по дате (если указан dueDate)
    if (this.dueDate && now > this.dueDate) {
        isOverdue = true;
    }
    
    // Проверка по использованным занятиям (если есть абонемент и лимит)
    if (membership && this.maxClassesBeforePayment) {
        const classesUsed = membership.classesUsed || 0;
        if (classesUsed >= this.maxClassesBeforePayment) {
            isOverdue = true;
        }
    }
    
    return isOverdue;
};

// Метод получения количества дней просрочки
paymentSchema.methods.getOverdueDays = function() {
    if (!this.dueDate || this.status === 'completed') return 0;
    
    const now = new Date();
    const diffTime = now - this.dueDate;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays > 0 ? diffDays : 0;
};

// 🔄 PRE-SAVE HOOK: Автоматически сохраняем имена студента и менеджера
paymentSchema.pre('save', async function(next) {
    // Только для новых платежей или если имена не заполнены
    if (this.isNew || !this.studentName || !this.managerName) {
        try {
            const Student = mongoose.model('Student');
            
            // Получаем студента
            if (this.student && !this.studentName) {
                const student = await Student.findById(this.student).select('name lastName phone').lean();
                if (student) {
                    this.studentName = `${student.name} ${student.lastName || ''}`.trim();
                    this.studentPhone = student.phone;
                }
            }
            
            // Получаем менеджера
            if (this.manager && !this.managerName) {
                const manager = await Student.findById(this.manager).select('name lastName').lean();
                if (manager) {
                    this.managerName = `${manager.name} ${manager.lastName || ''}`.trim();
                }
            }
        } catch (error) {
            console.error('Error in Payment pre-save hook:', error);
            // Не блокируем сохранение, если не удалось получить имена
        }
    }
    next();
});

module.exports = mongoose.model('Payment', paymentSchema);
