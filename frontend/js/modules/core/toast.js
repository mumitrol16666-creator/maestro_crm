// ==================== TOAST NOTIFICATIONS ====================

let toastContainer = null;

// Инициализация контейнера для toast
function initToastContainer() {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
    }
    return toastContainer;
}

// Иконки для toast
function getToastIcon(type) {
    const icons = {
        success: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M20 6L9 17l-5-5"/>
        </svg>`,
        error: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>`,
        warning: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>`,
        info: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>`,
        party: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
        </svg>`
    };
    return icons[type] || icons.info;
}

// Показать toast уведомление
function showToast(message, type = 'info', duration = 3000) {
    const container = initToastContainer();
    
    // Создаем toast элемент
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    toast.innerHTML = `
        <div class="toast-icon">${getToastIcon(type)}</div>
        <div class="toast-content">${message}</div>
        <div class="toast-close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
        </div>
        <div class="toast-progress"></div>
    `;
    
    // Добавляем в контейнер
    container.appendChild(toast);
    
    // Автоматическое закрытие
    let autoCloseTimer;
    if (duration > 0) {
        autoCloseTimer = setTimeout(() => {
            closeToast(toast);
        }, duration);
    }
    
    // Закрытие по клику на крестик
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (autoCloseTimer) clearTimeout(autoCloseTimer);
        closeToast(toast);
    });
    
    // Закрытие по клику на сам toast
    toast.addEventListener('click', () => {
        if (autoCloseTimer) clearTimeout(autoCloseTimer);
        closeToast(toast);
    });
    
    return toast;
}

// Закрыть toast
function closeToast(toast) {
    toast.classList.add('removing');
    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, 300);
}

// Утилиты для разных типов toast
window.showToast = showToast;

window.toast = {
    success: (message, duration) => showToast(message, 'success', duration),
    error: (message, duration) => showToast(message, 'error', duration),
    warning: (message, duration) => showToast(message, 'warning', duration),
    info: (message, duration) => showToast(message, 'info', duration),
    party: (message, duration) => showToast(message, 'party', duration)
};

// Экспорт для использования в модулях
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { showToast, toast };
}

