// =====================================================
// API MODULE - Базовые функции для работы с API
// =====================================================
// Этот файл подключается ПЕРЕД admin.js

// API URL
const API_URL = (typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'http://localhost:5001') + '/api';

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
        localStorage.clear();
        window.location.href = 'login.html';
        throw new Error('Сессия истекла');
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

console.log('✅ API модуль загружен');

