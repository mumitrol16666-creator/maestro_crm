#!/usr/bin/env node

/**
 * Удаленная проверка состояния API сервера
 * Использование: node check-server-remote.js [server_url]
 * Пример: node check-server-remote.js http://149.33.0.114:5000
 */

const https = require('https');
const http = require('http');

const SERVER_URL = process.argv[2] || 'http://149.33.0.114:5000';

console.log('\n🔍 ========================================');
console.log('   УДАЛЕННАЯ ДИАГНОСТИКА API СЕРВЕРА');
console.log('========================================\n');
console.log('Сервер:', SERVER_URL);
console.log('');

// Функция для HTTP запросов
function makeRequest(url) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;
        
        const req = client.request(url, { method: 'GET' }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: JSON.parse(data)
                    });
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: data
                    });
                }
            });
        });
        
        req.on('error', reject);
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
        req.end();
    });
}

async function checkServer() {
    try {
        // 1. Проверка базового health check
        console.log('1️⃣  Проверка базового health check...');
        try {
            const health = await makeRequest(`${SERVER_URL}/api/health`);
            if (health.status === 200) {
                console.log('   ✅ Сервер отвечает');
                console.log('   📊 Uptime:', Math.floor(health.body.uptime), 'секунд');
            } else {
                console.log('   ⚠️  Сервер отвечает, но статус:', health.status);
            }
        } catch (error) {
            console.log('   ❌ Сервер недоступен:', error.message);
            console.log('\n💡 Возможные причины:');
            console.log('   - Сервер не запущен');
            console.log('   - Неправильный URL');
            console.log('   - Проблемы с сетью\n');
            process.exit(1);
        }
        
        // 2. Проверка диагностического endpoint
        console.log('\n2️⃣  Проверка конфигурации сервера...');
        try {
            const diagnostic = await makeRequest(`${SERVER_URL}/api/health/diagnostic`);
            if (diagnostic.status === 200) {
                console.log('   ✅ Диагностика доступна');
                const env = diagnostic.body.environment;
                console.log('   📋 Переменные окружения:');
                console.log('      NODE_ENV:', env.NODE_ENV);
                console.log('      PORT:', env.PORT);
                console.log('      JWT_SECRET:', env.JWT_SECRET);
                console.log('      MONGODB_URI:', env.MONGODB_URI);
                
                if (diagnostic.body.issues && diagnostic.body.issues.length > 0) {
                    console.log('\n   ❌ Обнаружены проблемы:');
                    diagnostic.body.issues.forEach(issue => {
                        console.log('      -', issue);
                    });
                } else {
                    console.log('   ✅ Критичные переменные установлены');
                }
            } else {
                console.log('   ⚠️  Диагностика недоступна (статус:', diagnostic.status + ')');
                console.log('   💡 Возможно, изменения еще не задеплоены на сервер');
            }
        } catch (error) {
            console.log('   ⚠️  Диагностика недоступна:', error.message);
            console.log('   💡 Возможно, endpoint /api/health/diagnostic еще не задеплоен');
        }
        
        // 3. Проверка endpoint с аутентификацией (должен вернуть 401)
        console.log('\n3️⃣  Проверка аутентификации...');
        try {
            const authTest = await makeRequest(`${SERVER_URL}/api/permissions`);
            if (authTest.status === 401) {
                console.log('   ✅ Middleware аутентификации работает (ожидаемый 401 без токена)');
                if (authTest.body && authTest.body.error) {
                    console.log('   📝 Сообщение:', authTest.body.error);
                }
            } else if (authTest.status === 500) {
                console.log('   ❌ Ошибка сервера (500)');
                if (authTest.body && authTest.body.error) {
                    console.log('   📝 Сообщение:', authTest.body.error);
                    if (authTest.body.error.includes('JWT_SECRET')) {
                        console.log('\n   🔴 КРИТИЧЕСКАЯ ПРОБЛЕМА: JWT_SECRET не установлен!');
                        console.log('   💡 Решение: проверьте .env файл на сервере');
                    }
                }
            } else {
                console.log('   ⚠️  Неожиданный статус:', authTest.status);
            }
        } catch (error) {
            console.log('   ❌ Ошибка при проверке:', error.message);
        }
        
        // Итоговые рекомендации
        console.log('\n📊 ========================================');
        console.log('   РЕКОМЕНДАЦИИ');
        console.log('========================================\n');
        
        console.log('Если все проверки прошли, но ошибки 401 остаются:');
        console.log('1. Проверьте, что токен в localStorage браузера валиден');
        console.log('2. Попробуйте выйти и войти заново');
        console.log('3. Проверьте логи сервера: pm2 logs sense-of-dance-backend');
        console.log('4. Убедитесь, что изменения задеплоены на сервер\n');
        
    } catch (error) {
        console.error('❌ Критическая ошибка:', error.message);
        process.exit(1);
    }
}

checkServer();

