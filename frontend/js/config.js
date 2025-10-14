// Конфигурация API URL
// Автоматически определяет правильный URL для API

const API_BASE_URL = (() => {
    // Если запускаем локально на компьютере
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:5000';
    }
    
    // Если на продакшн сервере - используем Nginx (без порта)
    // Nginx проксирует /api на backend:5000
    return `http://${window.location.hostname}`;
})();





