const mongoose = require('mongoose');

const blogPostSchema = new mongoose.Schema({
    // Заголовок статьи
    title: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    
    // URL slug (для SEO-friendly ссылок)
    slug: {
        type: String,
        required: true,
        unique: true,
        index: true,
        lowercase: true,
        trim: true
    },
    
    // Краткое описание (для превью)
    excerpt: {
        type: String,
        required: true,
        maxlength: 300
    },
    
    // Полный контент статьи (HTML)
    content: {
        type: String,
        required: true
    },
    
    // Категория
    category: {
        type: String,
        required: true,
        enum: ['news', 'tips', 'stories', 'events'],
        index: true
    },
    
    // Изображение (URL или путь)
    image: {
        type: String,
        default: null
    },
    
    // Автор (админ/менеджер)
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
    },
    
    // Статус публикации
    status: {
        type: String,
        enum: ['draft', 'published', 'archived'],
        default: 'draft',
        index: true
    },
    
    // Дата публикации
    publishedAt: {
        type: Date,
        default: null,
        index: true
    },
    
    // SEO поля
    metaDescription: {
        type: String,
        maxlength: 160,
        default: ''
    },
    
    metaKeywords: {
        type: String,
        default: ''
    },
    
    // Просмотры
    views: {
        type: Number,
        default: 0
    },
    
    // Время чтения (в минутах)
    readTime: {
        type: Number,
        default: 5
    }
}, {
    timestamps: true
});

// Индексы
blogPostSchema.index({ status: 1, publishedAt: -1 });
blogPostSchema.index({ category: 1, status: 1, publishedAt: -1 });
blogPostSchema.index({ slug: 1 }, { unique: true });

// Метод для генерации slug из заголовка
blogPostSchema.statics.generateSlug = function(title) {
    const translitMap = {
        'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
        'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
        'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
        'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
        'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
        ' ': '-', ':': '', '—': '-', '–': '-', ',': '', '.': '', '!': '', '?': ''
    };
    
    return title
        .toLowerCase()
        .split('')
        .map(char => translitMap[char] || char)
        .join('')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
};

// Автоматический расчет времени чтения
blogPostSchema.pre('save', function(next) {
    if (this.isModified('content')) {
        const wordsPerMinute = 200;
        const wordCount = this.content.replace(/<[^>]*>/g, '').split(/\s+/).length;
        this.readTime = Math.max(1, Math.ceil(wordCount / wordsPerMinute));
    }
    next();
});

module.exports = mongoose.model('BlogPost', blogPostSchema);

