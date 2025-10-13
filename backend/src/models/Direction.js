const mongoose = require('mongoose');

const directionSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Название направления обязательно'],
        unique: true,
        trim: true
    },
    description: {
        type: String,
        required: [true, 'Описание обязательно'],
        trim: true
    },
    minAge: {
        type: Number,
        required: [true, 'Минимальный возраст обязателен'],
        min: 0
    },
    level: {
        type: String,
        required: [true, 'Уровень подготовки обязателен'],
        trim: true
    },
    image: {
        type: String,
        default: ''
    },
    pricing: {
        trial: {
            type: Number,
            default: 2000
        },
        month: {
            type: Number,
            default: 22000
        },
        threeMonths: {
            type: Number,
            default: 55000
        }
    },
    isActive: {
        type: Boolean,
        default: true
    },
    order: {
        type: Number,
        default: 0
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Direction', directionSchema);



