const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Функция для оптимизации изображений
async function optimizeImages() {
    const frontendPath = './frontend';
    const imageFiles = [];
    
    // Находим все изображения
    function findImageFiles(dir) {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            
            if (stat.isDirectory()) {
                findImageFiles(filePath);
            } else if (/\.(jpg|jpeg|png|PNG|JPG|JPEG)$/i.test(file)) {
                imageFiles.push(filePath);
            }
        });
    }
    
    findImageFiles(frontendPath);
    
    console.log(`🚀 Found ${imageFiles.length} images to optimize`);
    
    let totalOriginalSize = 0;
    let totalOptimizedSize = 0;
    
    for (const filePath of imageFiles) {
        try {
            const originalSize = fs.statSync(filePath).size;
            totalOriginalSize += originalSize;
            
            const ext = path.extname(filePath).toLowerCase();
            const optimizedPath = filePath.replace(ext, '.webp');
            
            // Создаем WebP версию
            let command;
            if (ext === '.png' || ext === '.PNG') {
                command = `cwebp -q 80 "${filePath}" -o "${optimizedPath}"`;
            } else {
                command = `cwebp -q 85 "${filePath}" -o "${optimizedPath}"`;
            }
            
            try {
                execSync(command, { stdio: 'pipe' });
                
                if (fs.existsSync(optimizedPath)) {
                    const optimizedSize = fs.statSync(optimizedPath).size;
                    totalOptimizedSize += optimizedSize;
                    
                    const savings = ((originalSize - optimizedSize) / originalSize * 100).toFixed(1);
                    console.log(`✅ ${path.basename(filePath)}: ${originalSize} → ${optimizedSize} bytes (${savings}% saved)`);
                } else {
                    console.log(`⚠️  Failed to create WebP for ${path.basename(filePath)}`);
                }
            } catch (error) {
                console.log(`⚠️  cwebp not available, skipping ${path.basename(filePath)}`);
            }
            
        } catch (error) {
            console.error(`❌ Error optimizing ${filePath}:`, error.message);
        }
    }
    
    if (totalOptimizedSize > 0) {
        const totalSavings = ((totalOriginalSize - totalOptimizedSize) / totalOriginalSize * 100).toFixed(1);
        console.log(`\n🎉 Image optimization complete!`);
        console.log(`📊 Total: ${totalOriginalSize} → ${totalOptimizedSize} bytes`);
        console.log(`💾 Savings: ${totalSavings}% (${(totalOriginalSize - totalOptimizedSize).toLocaleString()} bytes)`);
    } else {
        console.log(`\n⚠️  WebP optimization requires cwebp tool. Install with: apt-get install webp`);
    }
}

optimizeImages().catch(console.error);
