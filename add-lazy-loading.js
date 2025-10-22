const fs = require('fs');
const path = require('path');

// Функция для добавления lazy loading к изображениям
function addLazyLoading() {
    const htmlFiles = [
        './frontend/public/index.html',
        './frontend/public/admin.html',
        './frontend/public/profile.html',
        './frontend/public/blog.html',
        './frontend/public/blog-post.html',
        './frontend/public/login.html',
        './frontend/public/register.html'
    ];
    
    console.log('🚀 Adding lazy loading to images...');
    
    htmlFiles.forEach(filePath => {
        if (fs.existsSync(filePath)) {
            try {
                let content = fs.readFileSync(filePath, 'utf8');
                let updated = false;
                
                // Добавляем loading="lazy" к img тегам (кроме критических)
                content = content.replace(
                    /<img([^>]*?)(src="[^"]*logo[^"]*")([^>]*?)>/gi,
                    (match, before, src, after) => {
                        // Логотипы загружаем сразу (критические)
                        if (src.includes('logo')) {
                            return match; // Не добавляем lazy к логотипам
                        }
                        updated = true;
                        return `<img${before}${src}${after} loading="lazy">`;
                    }
                );
                
                // Добавляем loading="lazy" к остальным изображениям
                content = content.replace(
                    /<img((?:(?!loading=)[^>])*?)>/gi,
                    (match, attrs) => {
                        if (attrs.includes('loading=')) {
                            return match; // Уже есть loading
                        }
                        updated = true;
                        return `<img${attrs} loading="lazy">`;
                    }
                );
                
                if (updated) {
                    fs.writeFileSync(filePath, content);
                    console.log(`✅ Updated: ${path.basename(filePath)}`);
                } else {
                    console.log(`⏭️  No changes needed: ${path.basename(filePath)}`);
                }
                
            } catch (error) {
                console.error(`❌ Error updating ${filePath}:`, error.message);
            }
        } else {
            console.log(`⚠️  File not found: ${filePath}`);
        }
    });
    
    console.log('🎉 Lazy loading added successfully!');
}

addLazyLoading();
