const fs = require('fs');
const path = require('path');

// Простая минификация CSS
function minifyCSS(code) {
    return code
        // Удаляем комментарии
        .replace(/\/\*[\s\S]*?\*\//g, '')
        // Удаляем лишние пробелы и переносы строк
        .replace(/\s+/g, ' ')
        // Удаляем пробелы вокруг специальных символов
        .replace(/\s*([{}:;,>+~])\s*/g, '$1')
        // Удаляем пробелы в начале и конце
        .trim();
}

// Функция для минификации всех CSS файлов
async function minifyAllCSS() {
    const frontendPath = './frontend';
    const cssFiles = [];
    
    // Находим все CSS файлы
    function findCSSFiles(dir) {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            
            if (stat.isDirectory()) {
                findCSSFiles(filePath);
            } else if (file.endsWith('.css')) {
                cssFiles.push(filePath);
            }
        });
    }
    
    findCSSFiles(frontendPath);
    
    console.log(`🚀 Found ${cssFiles.length} CSS files to minify`);
    
    let totalOriginalSize = 0;
    let totalMinifiedSize = 0;
    
    for (const filePath of cssFiles) {
        try {
            const originalCode = fs.readFileSync(filePath, 'utf8');
            const minifiedCode = minifyCSS(originalCode);
            
            const originalSize = Buffer.byteLength(originalCode, 'utf8');
            const minifiedSize = Buffer.byteLength(minifiedCode, 'utf8');
            
            totalOriginalSize += originalSize;
            totalMinifiedSize += minifiedSize;
            
            // Создаем минифицированную версию
            const minifiedPath = filePath.replace('.css', '.min.css');
            fs.writeFileSync(minifiedPath, minifiedCode);
            
            const savings = ((originalSize - minifiedSize) / originalSize * 100).toFixed(1);
            console.log(`✅ ${path.basename(filePath)}: ${originalSize} → ${minifiedSize} bytes (${savings}% saved)`);
            
        } catch (error) {
            console.error(`❌ Error minifying ${filePath}:`, error.message);
        }
    }
    
    const totalSavings = ((totalOriginalSize - totalMinifiedSize) / totalOriginalSize * 100).toFixed(1);
    console.log(`\n🎉 CSS Minification complete!`);
    console.log(`📊 Total: ${totalOriginalSize} → ${totalMinifiedSize} bytes`);
    console.log(`💾 Savings: ${totalSavings}% (${(totalOriginalSize - totalMinifiedSize).toLocaleString()} bytes)`);
}

minifyAllCSS().catch(console.error);
