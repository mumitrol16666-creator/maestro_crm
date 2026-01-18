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

    // Статус follow-up
    followUpStatus: {
        type: String,
        enum: ['pending', 'sent', 'none'], // pending - ждем, sent - отправили, none - не нужно
        default: 'none'
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

    // Логика follow-up
    if (role === 'user') {
        // Если клиент ответил, follow-up не нужен (или сбрасываем ожидание)
        this.followUpStatus = 'none';
    } else if (role === 'assistant') {
        // Если бот ответил, начинаем ждать реакции клиента
        // (но только если диалог не завершен/закрыт)
        if (this.status === 'active' || this.status === 'qualified') {
            this.followUpStatus = 'pending';
        } else {
            this.followUpStatus = 'none';
        }
    }

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

    // Берём имя из контекста или из поля name диалога
    let firstName = this.context.name || this.name || 'Клиент WhatsApp';
    let lastName = this.context.lastName || '-';

    // Если имя содержит пробел (Имя Фамилия), разбиваем
    if (firstName && firstName.trim().includes(' ') && lastName === '-') {
        const parts = firstName.trim().split(/\s+/);
        firstName = parts[0];
        if (parts.length > 1) {
            lastName = parts.slice(1).join(' ');
        }
    }

    // Форматируем номер телефона
    let formattedPhone = this.phoneNumber;
    if (formattedPhone) {
        // Убираем все кроме цифр
        const digits = formattedPhone.replace(/\D/g, '');
        // Если начинается с 8 — заменяем на 7
        if (digits.length === 11 && digits.startsWith('8')) {
            formattedPhone = '+7' + digits.slice(1);
        } else if (digits.length === 11 && digits.startsWith('7')) {
            formattedPhone = '+' + digits;
        } else if (digits.length === 10) {
            formattedPhone = '+7' + digits;
        } else {
            formattedPhone = '+' + digits;
        }
    }

    const booking = await Booking.create({
        name: firstName,
        lastName: lastName,
        phone: formattedPhone,
        direction: this.context.direction || 'Не указано',
        source: 'WhatsApp',
        group: groupId,
        status: 'trial', // Пробное занятие
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
