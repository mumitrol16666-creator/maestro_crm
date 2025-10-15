const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const BlogPost = require('../models/BlogPost');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Настройка multer для загрузки изображений
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '../../../frontend/assets/images/blog');
        
        // Создать папку если не существует
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'blog-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Только изображения (JPEG, PNG, GIF, WEBP)'));
        }
    }
});

// @route   GET /api/blog
// @desc    Получить список статей
// @access  Public
router.get('/', async (req, res) => {
    try {
        const { category, status = 'published', page = 1, limit = 10 } = req.query;
        
        const filter = { status };
        if (category && category !== 'all') {
            filter.category = category;
        }
        
        const skip = (page - 1) * limit;
        
        const [posts, total] = await Promise.all([
            BlogPost.find(filter)
                .populate('author', 'name lastName')
                .select('-content')  // Не грузим полный контент в список
                .sort({ publishedAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            BlogPost.countDocuments(filter)
        ]);
        
        res.json({
            success: true,
            posts,
            total,
            pages: Math.ceil(total / limit),
            currentPage: parseInt(page)
        });
    } catch (error) {
        console.error('Get blog posts error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении статей'
        });
    }
});

// @route   GET /api/blog/:slug
// @desc    Получить одну статью по slug
// @access  Public
router.get('/:slug', async (req, res) => {
    try {
        const post = await BlogPost.findOne({ 
            slug: req.params.slug,
            status: 'published'
        }).populate('author', 'name lastName');
        
        if (!post) {
            return res.status(404).json({
                success: false,
                error: 'Статья не найдена'
            });
        }
        
        // Увеличить счетчик просмотров
        post.views += 1;
        await post.save();
        
        res.json({
            success: true,
            post
        });
    } catch (error) {
        console.error('Get blog post error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении статьи'
        });
    }
});

// @route   POST /api/blog
// @desc    Создать новую статью
// @access  Admin
router.post('/', authenticate, requireAdmin, upload.single('image'), async (req, res) => {
    try {
        const { title, excerpt, content, category, metaDescription, metaKeywords, status } = req.body;
        
        if (!title || !excerpt || !content || !category) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        // Генерируем slug
        let slug = BlogPost.generateSlug(title);
        
        // Проверяем уникальность slug
        const existingPost = await BlogPost.findOne({ slug });
        if (existingPost) {
            slug = slug + '-' + Date.now();
        }
        
        // Путь к изображению (если загружено)
        const imagePath = req.file ? `/assets/images/blog/${req.file.filename}` : null;
        
        const post = await BlogPost.create({
            title,
            slug,
            excerpt,
            content,
            category,
            image: imagePath,
            author: req.user._id,
            status: status || 'draft',
            publishedAt: status === 'published' ? new Date() : null,
            metaDescription: metaDescription || excerpt.substring(0, 160),
            metaKeywords: metaKeywords || ''
        });
        
        console.log(`📝 Создана статья: ${title} (${slug})`);
        
        res.status(201).json({
            success: true,
            post
        });
    } catch (error) {
        console.error('Create blog post error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при создании статьи'
        });
    }
});

// @route   PATCH /api/blog/:id
// @desc    Обновить статью
// @access  Admin
router.patch('/:id', authenticate, requireAdmin, upload.single('image'), async (req, res) => {
    try {
        const post = await BlogPost.findById(req.params.id);
        
        if (!post) {
            return res.status(404).json({
                success: false,
                error: 'Статья не найдена'
            });
        }
        
        const { title, excerpt, content, category, metaDescription, metaKeywords, status } = req.body;
        
        // Обновляем поля
        if (title) post.title = title;
        if (excerpt) post.excerpt = excerpt;
        if (content) post.content = content;
        if (category) post.category = category;
        if (metaDescription) post.metaDescription = metaDescription;
        if (metaKeywords) post.metaKeywords = metaKeywords;
        
        // Если загружено новое изображение
        if (req.file) {
            // Удалить старое изображение (если есть)
            if (post.image) {
                const oldImagePath = path.join(__dirname, '../../../frontend', post.image);
                if (fs.existsSync(oldImagePath)) {
                    fs.unlinkSync(oldImagePath);
                }
            }
            post.image = `/assets/images/blog/${req.file.filename}`;
        }
        
        // Обновить slug если изменился заголовок
        if (title && title !== post.title) {
            const newSlug = BlogPost.generateSlug(title);
            const slugExists = await BlogPost.findOne({ slug: newSlug, _id: { $ne: post._id } });
            if (!slugExists) {
                post.slug = newSlug;
            }
        }
        
        // Если публикуем впервые
        if (status === 'published' && post.status !== 'published') {
            post.publishedAt = new Date();
        }
        if (status) post.status = status;
        
        await post.save();
        
        console.log(`✏️ Обновлена статья: ${post.title}`);
        
        res.json({
            success: true,
            post
        });
    } catch (error) {
        console.error('Update blog post error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при обновлении статьи'
        });
    }
});

// @route   DELETE /api/blog/:id
// @desc    Удалить статью
// @access  Admin
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const post = await BlogPost.findById(req.params.id);
        
        if (!post) {
            return res.status(404).json({
                success: false,
                error: 'Статья не найдена'
            });
        }
        
        // Удалить изображение
        if (post.image) {
            const imagePath = path.join(__dirname, '../../../frontend', post.image);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
        }
        
        await BlogPost.findByIdAndDelete(req.params.id);
        
        console.log(`⚠️ Удалена статья: ${post.title}`);
        
        res.json({
            success: true,
            message: 'Статья удалена'
        });
    } catch (error) {
        console.error('Delete blog post error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при удалении статьи'
        });
    }
});

// @route   POST /api/blog/upload-image
// @desc    Загрузить изображение для статьи
// @access  Admin
router.post('/upload-image', authenticate, requireAdmin, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Файл не загружен'
            });
        }
        
        const imagePath = `/assets/images/blog/${req.file.filename}`;
        
        res.json({
            success: true,
            imagePath,
            filename: req.file.filename
        });
    } catch (error) {
        console.error('Upload image error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при загрузке изображения'
        });
    }
});

module.exports = router;

