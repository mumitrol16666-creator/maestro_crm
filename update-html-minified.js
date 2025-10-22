const fs = require('fs');
const path = require('path');

// Функция для обновления HTML файлов с минифицированными JS
function updateHTMLFiles() {
    const htmlFiles = [
        '/Users/poirtyc/Desktop/sense-of-dance/frontend/public/index.html',
        '/Users/poirtyc/Desktop/sense-of-dance/frontend/public/admin.html',
        '/Users/poirtyc/Desktop/sense-of-dance/frontend/public/profile.html',
        '/Users/poirtyc/Desktop/sense-of-dance/frontend/public/blog.html',
        '/Users/poirtyc/Desktop/sense-of-dance/frontend/public/blog-post.html',
        '/Users/poirtyc/Desktop/sense-of-dance/frontend/public/login.html',
        '/Users/poirtyc/Desktop/sense-of-dance/frontend/public/register.html'
    ];
    
    console.log('🚀 Updating HTML files to use minified JavaScript...');
    
    htmlFiles.forEach(filePath => {
        if (fs.existsSync(filePath)) {
            try {
                let content = fs.readFileSync(filePath, 'utf8');
                let updated = false;
                
                // Заменяем .js на .min.js (но не .min.js на .min.min.js)
                const jsRegex = /src="([^"]*\.js)(\?v=\d+)?"/g;
                content = content.replace(jsRegex, (match, jsPath, version) => {
                    if (!jsPath.includes('.min.js')) {
                        updated = true;
                        const minPath = jsPath.replace('.js', '.min.js');
                        return `src="${minPath}${version || ''}"`;
                    }
                    return match;
                });
                
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
    
    console.log('🎉 HTML files updated successfully!');
}

updateHTMLFiles();
