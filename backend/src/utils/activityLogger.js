const ActivityLog = require('../models/ActivityLog');

/**
 * Логгирование действий пользователя
 * @param {string} userId - ID пользователя
 * @param {string} action - Тип действия (create, update, delete, etc)
 * @param {string} entityType - Тип сущности (Student, Group, etc)
 * @param {string} entityId - ID сущности (опционально)
 * @param {string} details - Человекочитаемое описание
 * @param {Object} metadata - Дополнительные данные (опционально)
 */
const logAction = async (userId, action, entityType, entityId, details, metadata = {}) => {
    try {
        await ActivityLog.create({
            user: userId,
            action,
            entityType,
            entityId,
            details,
            metadata
        });
    } catch (error) {
        console.error('❌ Ошибка записи лога активности:', error);
        // Не выбрасываем ошибку дальше, чтобы не блокировать основную операцию
    }
};

module.exports = { logAction };
