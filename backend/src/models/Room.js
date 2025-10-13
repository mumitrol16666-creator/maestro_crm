const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Название зала обязательно'],
        trim: true,
        unique: true
    },
    
    // Цвет для календаря
    color: {
        type: String,
        default: '#eb4d77'  // Розовый по умолчанию
    },
    
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Индексы
roomSchema.index({ isActive: 1 });

module.exports = mongoose.model('Room', roomSchema);

