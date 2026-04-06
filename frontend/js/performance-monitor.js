// =====================================================
// PERFORMANCE MONITOR - Мониторинг производительности
// =====================================================

class PerformanceMonitor {
    constructor() {
        this.metrics = {};
        this.init();
    }

    init() {
        // Отслеживаем время загрузки страницы
        window.addEventListener('load', () => {
            this.measurePageLoad();
            this.measureResourceTiming();
        });

        // Отслеживаем ошибки
        window.addEventListener('error', (event) => {
            this.trackError(event);
        });

        // Отслеживаем необработанные промисы
        window.addEventListener('unhandledrejection', (event) => {
            this.trackPromiseRejection(event);
        });
    }

    measurePageLoad() {
        const navigation = performance.getEntriesByType('navigation')[0];
        
        this.metrics = {
            // Время загрузки DOM
            domContentLoaded: navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart,
            
            // Время полной загрузки страницы
            pageLoad: navigation.loadEventEnd - navigation.loadEventStart,
            
            // Время до первого байта
            ttfb: navigation.responseStart - navigation.requestStart,
            
            // Время до интерактивности
            interactive: navigation.domInteractive - navigation.navigationStart,
            
            // Общее время загрузки
            totalLoad: navigation.loadEventEnd - navigation.navigationStart
        };

        // Performance metrics collected
        this.sendMetrics();
    }

    measureResourceTiming() {
        const resources = performance.getEntriesByType('resource');
        const resourceMetrics = {
            totalResources: resources.length,
            totalSize: 0,
            loadTimes: []
        };

        resources.forEach(resource => {
            resourceMetrics.totalSize += resource.transferSize || 0;
            resourceMetrics.loadTimes.push({
                name: resource.name,
                duration: resource.duration,
                size: resource.transferSize || 0
            });
        });

        // Resource metrics collected
        this.metrics.resources = resourceMetrics;
    }

    trackError(event) {
        const errorData = {
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            timestamp: new Date().toISOString()
        };

        console.error('❌ JavaScript Error:', errorData);
        this.sendError(errorData);
    }

    trackPromiseRejection(event) {
        const rejectionData = {
            reason: event.reason?.toString() || 'Unknown',
            timestamp: new Date().toISOString()
        };

        console.error('❌ Unhandled Promise Rejection:', rejectionData);
        this.sendError(rejectionData);
    }

    sendMetrics() {
        // Отправляем метрики на сервер (если нужно)
        if (typeof fetch !== 'undefined') {
            const baseUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') 
                ? 'http://localhost:5001' : '';
            fetch(`${baseUrl}/api/performance/metrics`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    url: window.location.href,
                    userAgent: navigator.userAgent,
                    metrics: this.metrics,
                    timestamp: new Date().toISOString()
                })
            }).catch(err => console.log('Performance metrics not sent:', err));
        }
    }

    sendError(errorData) {
        // Отправляем ошибки на сервер (если нужно)
        if (typeof fetch !== 'undefined') {
            const baseUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') 
                ? 'http://localhost:5001' : '';
            fetch(`${baseUrl}/api/performance/errors`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    url: window.location.href,
                    userAgent: navigator.userAgent,
                    error: errorData,
                    timestamp: new Date().toISOString()
                })
            }).catch(err => console.log('Error not sent:', err));
        }
    }

    // Метод для измерения времени выполнения функций
    measureFunction(name, fn) {
        const start = performance.now();
        const result = fn();
        const end = performance.now();
        
        console.log(`⏱️ ${name} took ${(end - start).toFixed(2)}ms`);
        return result;
    }

    // Метод для измерения времени API запросов
    measureApiCall(url, fetchPromise) {
        const start = performance.now();
        
        return fetchPromise.then(response => {
            const end = performance.now();
            console.log(`🌐 API ${url} took ${(end - start).toFixed(2)}ms`);
            return response;
        });
    }
}

// Инициализируем мониторинг
const performanceMonitor = new PerformanceMonitor();

// Экспортируем для использования в других модулях
window.performanceMonitor = performanceMonitor;

// Performance Monitor initialized
