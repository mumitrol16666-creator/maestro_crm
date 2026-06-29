// Инициализация Socket.io для обновления данных в реальном времени
document.addEventListener('DOMContentLoaded', () => {
    // Подключаемся к текущему backend. На проде нельзя падать в localhost:
    // HTTPS-страница заблокирует такой socket.io как mixed content.
    const apiUrl = typeof API_URL !== 'undefined'
        ? API_URL
        : `${window.location.origin}/api`;
    const serverUrl = apiUrl.replace(/\/api\/?$/, '');
    
    console.log('🔌 Попытка подключения к Socket.IO:', serverUrl);
    
    // Инициализируем сокет
    const socket = io(serverUrl, {
        withCredentials: true
    });

    socket.on('connect', () => {
        console.log('🟢 Успешно подключено к Socket.IO в реальном времени! ID =', socket.id);
    });

    // Слушаем глобальное событие любого изменения в базе данных
    socket.on('activity_logged', (data) => {
        console.log('⚡ Получено событие об изменении базы данных:', data);
        
        // 1. Журнал Действий
        const activitySection = document.getElementById('section-activity-logs');
        if (activitySection && !activitySection.classList.contains('hidden')) {
            if (typeof window.renderActivityLogs === 'function') {
                console.log('🔄 Тихое обновление таблицы журнала действий...');
                // Сохраняем текущие фильтры
                window.renderActivityLogs(window.currentActivityPage || 1, window.currentActivityActionFilter, window.currentActivityEntityFilter);
            }
        }
        
        // 2. Ученики
        const studentsSection = document.getElementById('section-students');
        // Если открыт раздел учеников, и если событие было как-то связано со студентами или абонементами
        if (studentsSection && !studentsSection.classList.contains('hidden')) {
             if (typeof window.renderStudents === 'function') {
                 console.log('🔄 Ученики обновились!');
                 window.renderStudents(window.currentStudentSearch, window.currentStudentPage, window.currentStudentFilter);
             }
        }
    });

    socket.on('disconnect', () => {
        console.log('🔴 Соединение Socket.IO разорвано.');
    });
});
