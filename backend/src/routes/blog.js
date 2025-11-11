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

// @route   GET /api/blog/slug/:slug
// @desc    Получить одну статью по slug (публичный доступ)
// @access  Public
router.get('/slug/:slug', async (req, res) => {
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

// @route   GET /api/blog/:id
// @desc    Получить одну статью по ID (для админки)
// @access  Admin
router.get('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const post = await BlogPost.findById(req.params.id)
            .populate('author', 'name lastName');
        
        if (!post) {
            return res.status(404).json({
                success: false,
                error: 'Статья не найдена'
            });
        }
        
        res.json({
            success: true,
            post
        });
    } catch (error) {
        console.error('Get blog post by ID error:', error);
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
        
        const trimmedTitle = (title || '').trim();
        const trimmedExcerpt = (excerpt || '').trim();
        const trimmedContent = (content || '').trim();
        const trimmedCategory = (category || '').trim();
        const trimmedMetaDescription = (metaDescription || trimmedExcerpt).trim().slice(0, 160);
        const trimmedMetaKeywords = (metaKeywords || '').trim();
        const normalizedStatus = status && ['draft', 'published', 'archived'].includes(status) ? status : 'draft';
        
        if (!trimmedTitle || !trimmedExcerpt || !trimmedContent || !trimmedCategory) {
            return res.status(400).json({
                success: false,
                error: 'Заполните заголовок, описание, контент и категорию'
            });
        }
        
        if (trimmedExcerpt.length > 300) {
            return res.status(400).json({
                success: false,
                error: 'Описание должно быть не длиннее 300 символов'
            });
        }
        
        // Генерируем slug
        let slug = BlogPost.generateSlug(trimmedTitle);
        
        // Проверяем уникальность slug
        const existingPost = await BlogPost.findOne({ slug });
        if (existingPost) {
            slug = `${slug}-${Date.now()}`;
        }
        
        // Путь к изображению (если загружено)
        const imagePath = req.file ? `/assets/images/blog/${req.file.filename}` : null;
        
        const post = await BlogPost.create({
            title: trimmedTitle,
            slug,
            excerpt: trimmedExcerpt,
            content: trimmedContent,
            category: trimmedCategory,
            image: imagePath,
            author: req.user._id,
            status: normalizedStatus,
            publishedAt: normalizedStatus === 'published' ? new Date() : null,
            metaDescription: trimmedMetaDescription,
            metaKeywords: trimmedMetaKeywords
        });
        
        console.log(`📝 Создана статья: ${trimmedTitle} (${slug})`);
        
        res.status(201).json({
            success: true,
            post
        });
    } catch (error) {
        console.error('Create blog post error:', error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({
                success: false,
                error: Object.values(error.errors).map(err => err.message).join('; ')
            });
        }
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                error: 'Статья с таким названием уже существует'
            });
        }
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
        
        const originalTitle = post.title;
        const { title, excerpt, content, category, metaDescription, metaKeywords, status } = req.body;
        
        if (title !== undefined) {
            const trimmedTitle = title.trim();
            if (!trimmedTitle) {
                return res.status(400).json({ success: false, error: 'Заголовок не может быть пустым' });
            }
            post.title = trimmedTitle;
        }
        
        if (excerpt !== undefined) {
            const trimmedExcerpt = excerpt.trim();
            if (!trimmedExcerpt) {
                return res.status(400).json({ success: false, error: 'Описание не может быть пустым' });
            }
            if (trimmedExcerpt.length > 300) {
                return res.status(400).json({ success: false, error: 'Описание должно быть не длиннее 300 символов' });
            }
            post.excerpt = trimmedExcerpt;
        }
        
        if (content !== undefined) {
            const trimmedContent = content.trim();
            if (!trimmedContent) {
                return res.status(400).json({ success: false, error: 'Контент не может быть пустым' });
            }
            post.content = trimmedContent;
        }
        
        if (category !== undefined) {
            post.category = category.trim();
        }
        
        if (metaDescription !== undefined) {
            post.metaDescription = metaDescription.trim().slice(0, 160);
        }
        
        if (metaKeywords !== undefined) {
            post.metaKeywords = metaKeywords.trim();
        }
        
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
        
        if (title !== undefined && title.trim() !== originalTitle) {
            const proposedSlug = BlogPost.generateSlug(title.trim());
            const slugExists = await BlogPost.findOne({ slug: proposedSlug, _id: { $ne: post._id } });
            post.slug = slugExists ? `${proposedSlug}-${Date.now()}` : proposedSlug;
        }
        
        if (status) {
            if (!['draft', 'published', 'archived'].includes(status)) {
                return res.status(400).json({ success: false, error: 'Некорректный статус' });
            }
            if (status === 'published' && post.status !== 'published') {
                post.publishedAt = new Date();
            }
            post.status = status;
        }
        
        await post.save();
        
        console.log(`✏️ Обновлена статья: ${post.title}`);
        
        res.json({
            success: true,
            post
        });
    } catch (error) {
        console.error('Update blog post error:', error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({
                success: false,
                error: Object.values(error.errors).map(err => err.message).join('; ')
            });
        }
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                error: 'Статья с таким названием уже существует'
            });
        }
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

