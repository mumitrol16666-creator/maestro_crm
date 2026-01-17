const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student', // Используем 'Student', так как все пользователи (админы, учителя) хранятся там
        required: true
    },
    action: {
        type: String,
        required: true,
        enum: ['create', 'update', 'delete', 'login', 'logout', 'export', 'import']
    },
    entityType: {
        type: String,
        required: true,
        enum: ['User', 'Student', 'Group', 'Booking', 'Membership', 'Payment', 'Expense', 'Role', 'System', 'Direction', 'CashTransaction']
    },
    entityId: {
        type: mongoose.Schema.Types.ObjectId,
        // Ссылка на ID сущности, но без ref, так как тип динамический
    },
    details: {
        type: String,
        // Краткое описание, например "Удаление группы K-pop"
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        // Дополнительные технические данные (старые значения, IP адрес и т.д.)
    },
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    }
}, {
    timestamps: true
});

// Индекс для быстрого поиска логов конкретного пользователя или по типу сущности
activityLogSchema.index({ user: 1, createdAt: -1 });
activityLogSchema.index({ entityType: 1, action: 1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
