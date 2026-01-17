const mongoose = require('mongoose');

/**
 * Модель для хранения диалогов с клиентами через WhatsApp
 */
const messageSchema = new mongoose.Schema({
    role: {
        type: String,
        enum: ['user', 'assistant', 'system'],
        required: true
    },
    content: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
}, { _id: false });

const conversationSchema = new mongoose.Schema({
    // Идентификатор чата WhatsApp
    phoneNumber: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true
    },

    // Имя клиента (если узнали)
    name: {
        type: String,
        trim: true
    },

    // Контекст разговора для AI
    context: {
        forWhom: {
            type: String,
            enum: ['self', 'child', null],
            default: null
        },
        age: {
            type: Number,
            min: 3,
            max: 100
        },
        childAge: {
            type: Number,
            min: 3,
            max: 18
        },
        direction: {
            type: String,
            trim: true
        },
        preferredTime: {
            type: String,
            trim: true
        },
        schoolShift: {
            type: String,
            enum: ['first', 'second', null],
            default: null
        },
        // Дополнительные заметки от AI
        notes: {
            type: String
        }
    },

    // История сообщений (храним последние N для контекста)
    messages: {
        type: [messageSchema],
        default: []
    },

    // Максимальное количество сообщений для хранения
    // Старые сообщения будут удаляться автоматически

    // Статус диалога
    status: {
        type: String,
        enum: ['active', 'qualified', 'booked', 'closed', 'spam'],
        default: 'active'
    },

    // Связь с заявкой
    bookingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking'
    },

    // Связь с учеником (если конвертирован)
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student'
    },

    // Метаданные
    lastMessageAt: {
        type: Date,
        default: Date.now
    },

    firstMessageAt: {
        type: Date,
        default: Date.now
    },

    // Количество сообщений
    messageCount: {
        type: Number,
        default: 0
    },

    // Источник (WhatsApp, Telegram и т.д.)
    source: {
        type: String,
        enum: ['whatsapp', 'telegram', 'web'],
        default: 'whatsapp'
    }

}, {
    timestamps: true
});

// Метод для добавления сообщения
conversationSchema.methods.addMessage = async function (role, content, maxMessages = 20) {
    this.messages.push({
        role,
        content,
        timestamp: new Date()
    });

    // Ограничиваем количество сообщений для экономии памяти
    if (this.messages.length > maxMessages) {
        this.messages = this.messages.slice(-maxMessages);
    }

    this.messageCount++;
    this.lastMessageAt = new Date();

    await this.save();
    return this;
};

// Метод для получения контекста для AI (последние N сообщений)
conversationSchema.methods.getContextForAI = function (lastN = 10) {
    const recentMessages = this.messages.slice(-lastN);

    return {
        context: this.context,
        messages: recentMessages.map(m => ({
            role: m.role,
            content: m.content
        }))
    };
};

// Метод для обновления контекста
conversationSchema.methods.updateContext = async function (updates) {
    Object.assign(this.context, updates);
    await this.save();
    return this;
};

// Метод для создания заявки из диалога
conversationSchema.methods.createBooking = async function (groupId = null) {
    const Booking = mongoose.model('Booking');

    const booking = await Booking.create({
        name: this.name || 'Клиент WhatsApp',
        lastName: '',
        phone: this.phoneNumber,
        direction: this.context.direction || 'Не указано',
        source: 'WhatsApp',
        group: groupId,
        status: 'new',
        createdBy: 'telegram', // Используем существующий enum
        notes: `Автоматическая заявка из WhatsApp бота. Возраст: ${this.context.age || this.context.childAge || 'не указан'}`
    });

    this.bookingId = booking._id;
    this.status = 'booked';
    await this.save();

    return booking;
};

// Статический метод для поиска или создания диалога
conversationSchema.statics.findOrCreate = async function (phoneNumber) {
    let conversation = await this.findOne({ phoneNumber });

    if (!conversation) {
        conversation = await this.create({
            phoneNumber,
            firstMessageAt: new Date()
        });
    }

    return conversation;
};

// Индексы для оптимизации
conversationSchema.index({ status: 1, lastMessageAt: -1 });
conversationSchema.index({ bookingId: 1 });
conversationSchema.index({ lastMessageAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
