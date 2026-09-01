// Конфигурация API URL
// Автоматически определяет правильный URL для API

window.API_BASE_URL = (() => {
    // Если запускаем локально на компьютере
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        // Локальный nginx проксирует /api в изолированный QA backend.
        // Same-origin не даёт браузеру случайно уйти на другой локальный порт.
        return '';
    }
    
    // Если на продакшн сервере - используем тот же протокол (http или https)
    // Nginx проксирует /api на backend:5000
    return `${window.location.protocol}//${window.location.hostname}`;
})();

const API_BASE_URL = window.API_BASE_URL;




