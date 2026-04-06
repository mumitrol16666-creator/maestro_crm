// Конфигурация API URL
// Автоматически определяет правильный URL для API

const API_BASE_URL = (() => {
    // Если запускаем локально на компьютере
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:5001';
    }
    
    // Если на продакшн сервере - используем тот же протокол (http или https)
    // Nginx проксирует /api на backend:5000
    return `${window.location.protocol}//${window.location.hostname}`;
})();





