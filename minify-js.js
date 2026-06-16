const fs = require('fs');
const path = require('path');

// Простая минификация JavaScript
function minifyJS(code) {
    return code
        // Удаляем комментарии (// и /* */)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        // Удаляем лишние пробелы и переносы строк
        .replace(/\s+/g, ' ')
        .replace(/\s*([{}();,=])\s*/g, '$1')
        .replace(/;\s*}/g, '}')
        .replace(/{\s*/g, '{')
        .replace(/\s*}/g, '}')
        // Удаляем пробелы в начале и конце
        .trim();
}

// Функция для минификации всех JS файлов
async function minifyAllJS() {
    const frontendPath = './frontend';
    const jsFiles = [];
    
    // Находим все JS файлы
    function findJSFiles(dir) {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            
            if (stat.isDirectory()) {
                findJSFiles(filePath);
            } else if (file.endsWith('.js') && !file.includes('.min.')) {
                jsFiles.push(filePath);
            }
        });
    }
    
    findJSFiles(frontendPath);
    
    console.log(`🚀 Found ${jsFiles.length} JavaScript files to minify`);
    
    let totalOriginalSize = 0;
    let totalMinifiedSize = 0;
    
    for (const filePath of jsFiles) {
        try {
            const originalCode = fs.readFileSync(filePath, 'utf8');
            const minifiedCode = minifyJS(originalCode);
            
            const originalSize = Buffer.byteLength(originalCode, 'utf8');
            const minifiedSize = Buffer.byteLength(minifiedCode, 'utf8');
            
            totalOriginalSize += originalSize;
            totalMinifiedSize += minifiedSize;
            
            // Создаем минифицированную версию
            const minifiedPath = filePath.replace('.js', '.min.js');
            fs.writeFileSync(minifiedPath, minifiedCode);
            
            const savings = ((originalSize - minifiedSize) / originalSize * 100).toFixed(1);
            console.log(`✅ ${path.basename(filePath)}: ${originalSize} → ${minifiedSize} bytes (${savings}% saved)`);
            
        } catch (error) {
            console.error(`❌ Error minifying ${filePath}:`, error.message);
        }
    }
    
    const totalSavings = ((totalOriginalSize - totalMinifiedSize) / totalOriginalSize * 100).toFixed(1);
    console.log(`\n🎉 Minification complete!`);
    console.log(`📊 Total: ${totalOriginalSize} → ${totalMinifiedSize} bytes`);
    console.log(`💾 Savings: ${totalSavings}% (${(totalOriginalSize - totalMinifiedSize).toLocaleString()} bytes)`);
}

minifyAllJS().catch(console.error);
