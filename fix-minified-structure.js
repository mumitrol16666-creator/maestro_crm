const fs = require('fs');
const path = require('path');

// Функция для перемещения минифицированных файлов в правильные папки
function fixMinifiedStructure() {
    const frontendPath = './frontend';
    
    // Маппинг файлов: откуда → куда
    const fileMappings = [
        {
            from: 'js/blog-post.min.js',
            to: 'public/blog-post.min.js'
        },
        {
            from: 'js/profile.min.js', 
            to: 'public/profile.min.js'
        },
        {
            from: 'js/admin.min.js',
            to: 'public/admin.min.js'
        },
        {
            from: 'js/blog.min.js',
            to: 'public/blog.min.js'
        }
    ];
    
    console.log('🚀 Fixing minified file structure...');
    
    fileMappings.forEach(mapping => {
        const fromPath = path.join(frontendPath, mapping.from);
        const toPath = path.join(frontendPath, mapping.to);
        
        try {
            if (fs.existsSync(fromPath)) {
                // Создаем папку назначения если не существует
                const toDir = path.dirname(toPath);
                if (!fs.existsSync(toDir)) {
                    fs.mkdirSync(toDir, { recursive: true });
                }
                
                // Перемещаем файл
                fs.renameSync(fromPath, toPath);
                console.log(`✅ Moved: ${mapping.from} → ${mapping.to}`);
            } else {
                console.log(`⚠️  File not found: ${mapping.from}`);
            }
        } catch (error) {
            console.error(`❌ Error moving ${mapping.from}:`, error.message);
        }
    });
    
    console.log('🎉 Minified file structure fixed!');
}

fixMinifiedStructure();
