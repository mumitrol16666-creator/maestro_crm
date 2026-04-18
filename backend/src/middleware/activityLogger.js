const { prisma } = require('../config/db');

const activityLogger = async (req, res, next) => {
    // We only log mutating requests
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        return next();
    }

    // Исключаем POST-запросы, которые на самом деле ничего не меняют (поиск, статистика, авторизация)
    const ignoredPaths = ['/batch-light', '/search', '/login', '/check', '/stats'];
    if (req.method === 'POST' && ignoredPaths.some(p => req.originalUrl.includes(p))) {
        return next();
    }

    // Capture the original response end methods to know when request completes
    const originalJson = res.json;
    
    // We will intercept response to see if it was successful
    res.json = function (body) {
        res.locals.body = body;
        return originalJson.call(this, body);
    };

    res.on('finish', async () => {
        // Only log if request was successful (2xx)
        if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
                // Must have a user to log action
                const userId = req.user?.id;
                if (!userId) return;

                // Determine entityType and action from URL
                // req.originalUrl is usually like /api/bookings/123/status
                const parts = req.originalUrl.split('?')[0].split('/').filter(Boolean); // ["api", "bookings", "123", "status"]
                
                if (parts[0] === 'api') parts.shift(); // Remove 'api'
                
                const entityType = parts[0] || 'system';
                
                let action = req.method;
                let entityId = null;
                let details = '';

                if (req.method === 'POST') {
                    action = 'create';
                    if (parts.length > 2) {
                         // e.g. /api/students/:id/add-to-group
                         entityId = parts[1];
                         action = parts[2] || 'custom_action';
                    }
                } else if (req.method === 'PUT' || req.method === 'PATCH') {
                    action = 'update';
                    entityId = parts.length > 1 ? parts[parts.length - 1] : null;
                    if (parts.length > 2 && parts[parts.length - 1].length < 10) {
                        entityId = parts[parts.length - 2];
                        action = parts[parts.length - 1];
                    }
                } else if (req.method === 'DELETE') {
                    action = 'delete';
                    entityId = parts.length > 1 ? parts[parts.length - 1] : null;
                }

                // Make system actions for generic ones
                const methodMap = {
                    'POST': 'create',
                    'PUT': 'update',
                    'PATCH': 'update',
                    'DELETE': 'delete'
                };

                let actionName = methodMap[req.method] || req.method.toLowerCase();

                const bodyData = res.locals.body || {};
                const reqBody = req.body || {};
                
                let metadata = {
                    path: req.originalUrl,
                    method: req.method,
                    query: req.query,
                    body: { ...reqBody }
                };
                
                // Скрываем пароли
                if (metadata.body && metadata.body.password) {
                     metadata.body.password = '***';
                }

                // Пытаемся сформировать читаемое описание (details)
                let readableDetails = '';

                // Если это ответ об успешном удалении
                if (req.method === 'DELETE') {
                    readableDetails = `Удаление записи ID: ${entityId || 'Неизвестно'}`;
                    if (bodyData.message) readableDetails += ` (${bodyData.message})`;
                } 
                // Если это создание или обновление
                else {
                    // Ищем поля, похожие на названия
                    const nameFields = ['name', 'lastName', 'title', 'phone', 'direction', 'status', 'role'];
                    const detailsArr = [];
                    
                    // Берем полезные данные сначала из ответа (созданный/обновленный объект), затем из запроса
                    const sourceData = (bodyData.student || bodyData.user || bodyData.group || bodyData.payment || bodyData.booking || reqBody);
                    
                    for (const field of nameFields) {
                        if (sourceData[field]) {
                            detailsArr.push(`${field}: ${sourceData[field]}`);
                        }
                    }
                    
                    if (detailsArr.length > 0) {
                         readableDetails = detailsArr.join(', ');
                    } else {
                         readableDetails = 'Обновлены системные данные';
                    }
                }

                const newLog = await prisma.activityLog.create({
                    data: {
                        userId,
                        action: actionName,
                        entityType,
                        entityId,
                        details: readableDetails.substring(0, 500),
                        metadata
                    }
                });

                // Транслируем событие всем подключенным клиентам!
                const io = req.app.get('io');
                if (io) {
                    // Можно передавать весь объект newLog, если нужно
                    io.emit('activity_logged', { 
                        action: actionName, 
                        entityType, 
                        entityId, 
                        userId 
                    });
                }
            } catch (err) {
                console.error('Error logging activity:', err);
            }
        }
    });

    next();
};

module.exports = { activityLogger };
