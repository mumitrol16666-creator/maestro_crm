const mongoose = require('mongoose');

const cashTransactionSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['income', 'expense'],  // income = доход, expense = расход
        required: [true, 'Тип транзакции обязателен']
    },
    
    amount: {
        type: Number,
        required: [true, 'Сумма обязательна'],
        min: [0, 'Сумма не может быть отрицательной']
    },
    
    category: {
        type: String,
        required: [true, 'Категория обязательна'],
        enum: [
            // Доходы
            'hall_rental',    // Аренда зала
            'water',          // Вода
            'adjustment_income', // Корректировка (доход)
            'other',          // Прочие доходы
            
            // Расходы
            'rent',           // Аренда помещения
            'utilities',      // Коммунальные услуги
            'salary',         // Зарплата
            'equipment',      // Оборудование
            'marketing',      // Маркетинг
            'supplies',       // Расходные материалы
            'advance',        // Аванс
            'adjustment_expense', // Корректировка (расход)
            'other_expense'   // Прочие расходы
        ]
    },
    
    description: {
        type: String,
        required: [true, 'Описание обязательно'],
        trim: true
    },
    
    date: {
        type: Date,
        required: true,
        default: Date.now
    },
    
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
    },
    
    // Связь с платежом (если транзакция из платежа)
    relatedPayment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Payment',
        required: false
    },
    
    notes: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

// Индексы для быстрой выборки
cashTransactionSchema.index({ type: 1, date: -1 });
cashTransactionSchema.index({ category: 1, date: -1 });
cashTransactionSchema.index({ createdBy: 1 });
cashTransactionSchema.index({ date: -1 });
// Индекс для проверки дубликатов (type, amount, category, description, createdBy, createdAt)
cashTransactionSchema.index({ type: 1, amount: 1, category: 1, description: 1, createdBy: 1, createdAt: -1 });

module.exports = mongoose.model('CashTransaction', cashTransactionSchema);

