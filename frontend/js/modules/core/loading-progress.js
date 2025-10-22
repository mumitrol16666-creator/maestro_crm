// =====================================================
// LOADING PROGRESS BAR - Тонкая полоска загрузки
// =====================================================

class LoadingProgress {
    constructor() {
        this.progressBar = document.getElementById('loadingProgress');
        this.isActive = false;
        this.timeoutId = null;
        
        if (!this.progressBar) {
            console.warn('Loading progress bar element not found');
            return;
        }
    }
    
    // Показать прогресс-бар
    show() {
        if (!this.progressBar || this.isActive) return;
        
        this.isActive = true;
        this.progressBar.classList.remove('complete');
        this.progressBar.classList.add('active');
        
        // Автоматически скрыть через 3 секунды если не вызван hide()
        this.timeoutId = setTimeout(() => {
            this.hide();
        }, 3000);
    }
    
    // Скрыть прогресс-бар
    hide() {
        if (!this.progressBar || !this.isActive) return;
        
        this.isActive = false;
        this.progressBar.classList.remove('active');
        this.progressBar.classList.add('complete');
        
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        
        // Удалить элемент через анимацию
        setTimeout(() => {
            this.progressBar.classList.remove('complete');
        }, 500);
    }
    
    // Показать прогресс-бар на время выполнения функции
    async wrap(fn) {
        this.show();
        try {
            const result = await fn();
            this.hide();
            return result;
        } catch (error) {
            this.hide();
            throw error;
        }
    }
}

// Создаем глобальный экземпляр
window.loadingProgress = new LoadingProgress();

// Утилиты для удобного использования
window.showLoading = () => window.loadingProgress.show();
window.hideLoading = () => window.loadingProgress.hide();
window.wrapLoading = (fn) => window.loadingProgress.wrap(fn);
