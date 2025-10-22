// =====================================================
// PERFORMANCE ROUTES - Маршруты для мониторинга
// =====================================================

const express = require('express');
const router = express.Router();

// Временное хранилище метрик (в продакшене лучше использовать Redis)
let performanceMetrics = [];
let errorLogs = [];

// Сохранить метрики производительности
router.post('/metrics', (req, res) => {
    try {
        const { url, userAgent, metrics, timestamp } = req.body;
        
        // Сохраняем метрики
        performanceMetrics.push({
            url,
            userAgent,
            metrics,
            timestamp,
            receivedAt: new Date().toISOString()
        });

        // Ограничиваем количество сохраненных метрик (последние 1000)
        if (performanceMetrics.length > 1000) {
            performanceMetrics = performanceMetrics.slice(-1000);
        }

        console.log('📊 Performance metrics received:', {
            url,
            totalLoad: metrics.totalLoad,
            domContentLoaded: metrics.domContentLoaded,
            ttfb: metrics.ttfb
        });

        res.json({ success: true, message: 'Metrics saved' });
    } catch (error) {
        console.error('Error saving performance metrics:', error);
        res.status(500).json({ error: 'Failed to save metrics' });
    }
});

// Сохранить ошибки
router.post('/errors', (req, res) => {
    try {
        const { url, userAgent, error, timestamp } = req.body;
        
        // Сохраняем ошибки
        errorLogs.push({
            url,
            userAgent,
            error,
            timestamp,
            receivedAt: new Date().toISOString()
        });

        // Ограничиваем количество сохраненных ошибок (последние 500)
        if (errorLogs.length > 500) {
            errorLogs = errorLogs.slice(-500);
        }

        console.log('❌ Error received:', {
            url,
            message: error.message,
            filename: error.filename
        });

        res.json({ success: true, message: 'Error logged' });
    } catch (error) {
        console.error('Error saving error log:', error);
        res.status(500).json({ error: 'Failed to save error' });
    }
});

// Получить метрики производительности
router.get('/metrics', (req, res) => {
    try {
        res.json({
            success: true,
            metrics: performanceMetrics,
            count: performanceMetrics.length
        });
    } catch (error) {
        console.error('Error getting performance metrics:', error);
        res.status(500).json({ error: 'Failed to get metrics' });
    }
});

// Получить ошибки
router.get('/errors', (req, res) => {
    try {
        res.json({
            success: true,
            errors: errorLogs,
            count: errorLogs.length
        });
    } catch (error) {
        console.error('Error getting error logs:', error);
        res.status(500).json({ error: 'Failed to get errors' });
    }
});

// Получить статистику производительности
router.get('/stats', (req, res) => {
    try {
        if (performanceMetrics.length === 0) {
            return res.json({
                success: true,
                stats: {
                    message: 'No performance data available yet'
                }
            });
        }

        // Вычисляем средние значения
        const avgTotalLoad = performanceMetrics.reduce((sum, m) => sum + (m.metrics.totalLoad || 0), 0) / performanceMetrics.length;
        const avgDomContentLoaded = performanceMetrics.reduce((sum, m) => sum + (m.metrics.domContentLoaded || 0), 0) / performanceMetrics.length;
        const avgTtfb = performanceMetrics.reduce((sum, m) => sum + (m.metrics.ttfb || 0), 0) / performanceMetrics.length;

        res.json({
            success: true,
            stats: {
                totalMetrics: performanceMetrics.length,
                totalErrors: errorLogs.length,
                averageLoadTime: Math.round(avgTotalLoad),
                averageDomContentLoaded: Math.round(avgDomContentLoaded),
                averageTtfb: Math.round(avgTtfb),
                lastUpdated: performanceMetrics[performanceMetrics.length - 1]?.receivedAt
            }
        });
    } catch (error) {
        console.error('Error getting performance stats:', error);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

module.exports = router;
