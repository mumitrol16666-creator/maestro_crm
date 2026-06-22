// =====================================================
// API MODULE - Базовые функции для работы с API
// =====================================================
// Этот файл подключается ПЕРЕД admin.js

// API URL
const API_URL = (typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'http://localhost:5001') + '/api';

// Единая защита всех изменяющих запросов от двойного клика.
// Одинаковый запрос, пока первый ещё выполняется, получает копию того же ответа,
// а сервер дополнительно видит стабильный ключ идемпотентности.
const nativeFetch = window.fetch.bind(window);
const mutationRequestsInFlight = new Map();

function createIdempotencyKey() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mutationRequestSignature(input, options, method) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const body = typeof options?.body === 'string'
        ? options.body
        : (options?.body instanceof URLSearchParams ? options.body.toString() : '[binary-or-empty]');
    return `${method}:${url}:${body}`;
}

window.fetch = function protectedFetch(input, options = {}) {
    const method = String(options.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const url = typeof input === 'string' ? input : input?.url || '';
    const isApiRequest = url.startsWith(API_URL) || url.startsWith('/api/');

    if (!isMutation || !isApiRequest) {
        return nativeFetch(input, options);
    }

    const signature = mutationRequestSignature(input, options, method);
    const existing = mutationRequestsInFlight.get(signature);
    if (existing) {
        console.warn(`Повторный ${method}-запрос заблокирован: ${url}`);
        return existing.then(response => response.clone());
    }

    const headers = new Headers(options.headers || (typeof input !== 'string' ? input.headers : undefined) || {});
    if (!headers.has('X-Idempotency-Key')) {
        headers.set('X-Idempotency-Key', createIdempotencyKey());
    }

    const requestOptions = { ...options, method, headers };
    const pending = nativeFetch(input, requestOptions);
    mutationRequestsInFlight.set(signature, pending);

    const cleanup = () => {
        // Небольшое окно защищает от второго клика сразу после быстрого ответа сервера.
        setTimeout(() => {
            if (mutationRequestsInFlight.get(signature) === pending) {
                mutationRequestsInFlight.delete(signature);
            }
        }, 1200);
    };
    pending.then(cleanup, cleanup);

    return pending.then(response => response.clone());
};

// Мгновенно блокируем submit-кнопку, чтобы пользователь видел, что нажатие принято.
document.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    if (form.dataset.submitLocked === '1') {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
    }

    const button = event.submitter || form.querySelector('button[type="submit"], input[type="submit"]');
    form.dataset.submitLocked = '1';
    if (button) {
        button.dataset.originalText = button.textContent || button.value || '';
        button.disabled = true;
        if (button.tagName === 'BUTTON') button.textContent = 'Сохраняем...';
    }

    setTimeout(() => {
        delete form.dataset.submitLocked;
        if (button) {
            button.disabled = false;
            if (button.tagName === 'BUTTON' && button.dataset.originalText) {
                button.textContent = button.dataset.originalText;
            }
        }
    }, 2000);
}, true);

// Получить токен авторизации
function getAuthToken() {
    // ✅ МИГРАЦИЯ: Переносим токен из старого ключа в новый
    const oldToken = localStorage.getItem('authToken');
    if (oldToken && !localStorage.getItem('token')) {
        localStorage.setItem('token', oldToken);
        localStorage.removeItem('authToken');
    }
    
    return localStorage.getItem('token');
}

// Получить роль пользователя
function getUserRole() {
    return localStorage.getItem('userRole');
}

// Получить ID пользователя
function getUserId() {
    return localStorage.getItem('userId');
}

// Получить имя пользователя
function getUserName() {
    return localStorage.getItem('userName');
}

// Проверка является ли пользователь super_admin
function isSuperAdmin() {
    return getUserRole() === 'super_admin';
}

// Проверка является ли пользователь admin или super_admin
function isAdmin() {
    const role = getUserRole();
    return role === 'admin' || role === 'super_admin';
}

// Базовая функция для API запросов с автоматической обработкой ошибок
async function apiRequest(url, options = {}) {
    const token = getAuthToken();
    
    if (!token) {
        console.error('❌ Токен авторизации отсутствует. Перенаправление на страницу входа.');
        localStorage.clear();
        window.location.href = '/login.html';
        throw new Error('Токен отсутствует');
    }
    
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    };
    
    const finalOptions = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...options.headers
        }
    };
    
    const response = await fetch(`${API_URL}${url}`, finalOptions);
    
    // Проверка на невалидный токен
    if (response.status === 401) {
        // Пытаемся получить детальную информацию об ошибке
        let errorDetails = 'Сессия истекла';
        let isExpired = false;
        
        try {
            const errorData = await response.json();
            if (errorData.error) {
                errorDetails = errorData.error;
                
                // Проверяем, истек ли токен
                if (errorDetails.includes('истек') || errorDetails.includes('expired') || errorDetails.includes('Недействительный токен')) {
                    isExpired = true;
                    console.warn('⏰ Токен авторизации истек. Требуется повторный вход.');
                } else {
                    console.error('❌ Ошибка аутентификации:', errorDetails);
                }
                
                // Специальная обработка для ошибок конфигурации сервера
                if (errorData.error.includes('JWT_SECRET') || errorData.error.includes('конфигурации')) {
                    console.error('🔴 КРИТИЧЕСКАЯ ОШИБКА СЕРВЕРА:');
                    console.error('   JWT_SECRET не установлен на сервере!');
                    console.error('   Обратитесь к администратору сервера.');
                    alert('Ошибка конфигурации сервера. Обратитесь к администратору.');
                }
            }
        } catch (e) {
            // Игнорируем ошибку парсинга
        }
        
        // Предотвращаем множественные редиректы
        if (window.location.pathname === '/login.html') {
            return response; // Уже на странице логина
        }
        
        console.warn('⚠️  Сессия истекла или токен недействителен. Очистка данных и перенаправление...');
        
        // Очищаем все данные авторизации
        localStorage.removeItem('token');
        localStorage.removeItem('authToken');
        localStorage.removeItem('isLoggedIn');
        localStorage.removeItem('userId');
        localStorage.removeItem('userName');
        localStorage.removeItem('userRole');
        localStorage.removeItem('userPhone');
        
        // Показываем понятное уведомление пользователю
        const message = isExpired 
            ? 'Ваша сессия истекла. Пожалуйста, войдите в систему заново.'
            : 'Требуется авторизация. Пожалуйста, войдите в систему.';
        
        // Показываем toast уведомление, если доступно
        if (typeof window.toast !== 'undefined' && window.toast.warning) {
            window.toast.warning(message, 4000);
        } else if (typeof toast !== 'undefined' && toast.warning) {
            toast.warning(message, 4000);
        } else {
            // Fallback на alert, если toast недоступен
            alert(message);
        }
        
        // Перенаправляем на страницу входа с небольшой задержкой, чтобы пользователь успел увидеть сообщение
        setTimeout(() => {
            window.location.href = '/login.html';
        }, 1500);
        
        throw new Error(errorDetails);
    }
    
    return response;
}

// GET запрос
async function apiGet(url) {
    const response = await apiRequest(url, { method: 'GET' });
    return response.json();
}

// POST запрос
async function apiPost(url, data) {
    const response = await apiRequest(url, {
        method: 'POST',
        body: JSON.stringify(data)
    });
    return response.json();
}

// PATCH запрос
async function apiPatch(url, data) {
    const response = await apiRequest(url, {
        method: 'PATCH',
        body: JSON.stringify(data)
    });
    return response.json();
}

// DELETE запрос
async function apiDelete(url) {
    const response = await apiRequest(url, { method: 'DELETE' });
    return response.json();
}
