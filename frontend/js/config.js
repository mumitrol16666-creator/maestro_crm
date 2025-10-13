// Конфигурация API URL
// Автоматически определяет правильный URL для API

const API_BASE_URL = (() => {
    // Если запускаем локально на компьютере
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:5001';
    }
    
    // Если открываем с внешнего устройства (телефон в той же сети)
    // Используем тот же IP адрес что и у frontend
    return `http://${window.location.hostname}:5001`;
})();

console.log('🔌 API URL:', API_BASE_URL);




