// =====================================================
// ПРОФИЛЬ - ЛОГИКА
// =====================================================

// API URL
const API_URL = typeof API_BASE_URL !== 'undefined' ? `${API_BASE_URL}/api` : 'http://localhost:5001/api';

// =====================================================
// ИКОНКИ SVG (локальная копия на случай, если script.js не загружен)
// =====================================================

if (typeof getIcon === 'undefined') {
    window.getIcon = function(type, size = 20) {
        const icons = {
            freeze: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2v20M2 12h20M6.34 6.34l11.32 11.32M17.66 6.34L6.34 17.66"/>
            </svg>`,
            phone: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>`,
            warning: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>`,
            error: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>`,
            success: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M9 12l2 2 4-4"/>
            </svg>`,
            diamond: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>`,
            tool: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
            </svg>`,
            party: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5.8 11.3L2 22l10.7-3.79"/>
                <path d="M4 3h.01"/>
                <path d="M22 8h.01"/>
                <path d="M15 2h.01"/>
                <path d="M22 20h.01"/>
                <path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12v0c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/>
                <path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11v0c-.11.7-.72 1.22-1.43 1.22H17"/>
                <path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98v0C9.52 4.9 9 5.52 9 6.23V7"/>
                <path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/>
            </svg>`
        };
        
        return icons[type] || '';
    };
}

if (typeof notificationWithIcon === 'undefined') {
    window.notificationWithIcon = function(icon, message) {
        return `
            <div style="display: flex; align-items: flex-start; gap: 15px; text-align: left;">
                <div style="flex-shrink: 0; margin-top: 3px; color: var(--pink);">
                    ${getIcon(icon, 24)}
                </div>
                <div style="flex: 1; line-height: 1.6;">
                    ${message}
                </div>
            </div>
        `;
    };
}

const PROFILE_THEME_STORAGE_KEYS = ['profileTheme', 'adminTheme'];

function applyProfileTheme(theme) {
    const html = document.documentElement;
    const themeToggle = document.getElementById('profileThemeToggle');
    const themeText = themeToggle?.querySelector('.theme-text');
    const sunIcon = themeToggle?.querySelector('.theme-icon-sun');
    const moonIcon = themeToggle?.querySelector('.theme-icon-moon');
    const logoImg = document.querySelector('.profile-logo img');

    if (theme === 'light') {
        html.setAttribute('data-theme', 'light');
        if (themeText) themeText.textContent = 'ТЁМНАЯ';
        if (sunIcon) sunIcon.style.display = 'none';
        if (moonIcon) moonIcon.style.display = 'block';
        if (logoImg) logoImg.src = '/assets/images/logo-dark.PNG';
    } else {
        html.removeAttribute('data-theme');
        if (themeText) themeText.textContent = 'СВЕТЛАЯ';
        if (sunIcon) sunIcon.style.display = 'block';
        if (moonIcon) moonIcon.style.display = 'none';
        if (logoImg) logoImg.src = '/assets/images/logo-splash.PNG';
    }

    PROFILE_THEME_STORAGE_KEYS.forEach(key => {
        try {
            localStorage.setItem(key, theme);
        } catch (error) {
        }
    });
}

function initProfileTheme() {
    let savedTheme = 'dark';

    try {
        savedTheme = localStorage.getItem('profileTheme') ||
            localStorage.getItem('adminTheme') ||
            'dark';
    } catch (error) {
    }

    applyProfileTheme(savedTheme);

    const themeToggle = document.getElementById('profileThemeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const isLight = document.documentElement.getAttribute('data-theme') === 'light';
            const nextTheme = isLight ? 'dark' : 'light';
            applyProfileTheme(nextTheme);
        });
    }
}

initProfileTheme();

// Получить токен
function getAuthToken() {
    let token = localStorage.getItem('token');
    if (!token) {
        // Попытка миграции старого ключа
        token = localStorage.getItem('authToken');
        if (token) {
            localStorage.setItem('token', token);
            localStorage.removeItem('authToken');
        }
    }
    return token;
}

// Проверка авторизации
function checkAuth() {
    const token = getAuthToken();
    if (!token) {
        window.location.href = '/login';
        return;
    }
    
    // ✅ Если пользователь - администратор/преподаватель, редиректим в админку
    const userRole = localStorage.getItem('userRole');
    
    // 🔍 ОТЛАДКА
    console.log('🔍 checkAuth() called in profile.js:', { 
        token: !!token, 
        userRole,
        currentPath: window.location.pathname 
    });
    
    const allowedRoles = ['admin', 'super_admin', 'sales_manager', 'teacher'];
    if (allowedRoles.includes(userRole)) {
        console.log('✅ Redirecting admin/teacher to /admin from profile.js');
        // Используем window.location.replace для предотвращения возврата назад
        window.location.replace('/admin');
        return;
    }
}

// Загрузка данных пользователя
async function loadUserData() {
    try {
        const token = getAuthToken();
        const userId = localStorage.getItem('userId');
        
        if (!userId) {
            throw new Error('User ID not found');
        }
        
        // Загрузить данные ученика из API
        const response = await fetch(`${API_URL}/students/${userId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const { student } = await response.json();
        
        if (!student) {
            throw new Error('Student data not found');
        }

        // Обновляем в навигации
        const navUserName = document.getElementById('userName');
        if (navUserName) {
            navUserName.textContent = student.name;
        }

        // Обновляем в профиле
        document.getElementById('userName').textContent = student.name;
        document.getElementById('profileName').textContent = student.name;
        document.getElementById('profilePhone').textContent = student.phone;
        document.getElementById('profileEmail').textContent = student.email || '-';
        
        // Отображение пола
        const genderText = student.gender === 'male' ? 'Мужской' : student.gender === 'female' ? 'Женский' : '-';
        document.getElementById('profileGender').textContent = genderText;
        
        // Проверяем, принята ли оферта (только для учеников)
        if (student.role === 'student' && !student.offerAccepted) {
            // Показываем обязательное окно с офертой
            showMandatoryOffer();
        }
        
    } catch (error) {
        // Fallback на localStorage
        const userName = localStorage.getItem('userName') || 'Пользователь';
        const userPhone = localStorage.getItem('userPhone') || '+7 (700) 000-00-00';
        
        document.getElementById('userName').textContent = userName;
        document.getElementById('profileName').textContent = userName;
        document.getElementById('profilePhone').textContent = userPhone;
        document.getElementById('profileEmail').textContent = '-';
        document.getElementById('profileGender').textContent = '-';
    }
}

// Выход
function logout() {
    // Создаем кастомное окно подтверждения
    const confirmDiv = document.createElement('div');
    confirmDiv.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--profile-overlay);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10001;
    `;
    
    confirmDiv.innerHTML = `
        <div style="
            background: var(--profile-modal-bg);
            border: 2px solid var(--profile-modal-border);
            padding: 40px;
            text-align: center;
            max-width: 400px;
            color: var(--profile-text-primary);
            box-shadow: 0 30px 60px var(--profile-card-shadow);
        ">
            <p style="color: var(--profile-text-primary); font-size: 1.1rem; margin-bottom: 30px; letter-spacing: 0.05em;">
                Вы действительно хотите выйти?
            </p>
            <div style="display: flex; gap: 20px; justify-content: center;">
                <button id="confirmYes" style="
                    padding: 12px 30px;
                    background: var(--pink);
                    color: #ffffff;
                    border: none;
                    cursor: pointer;
                    letter-spacing: 0.1em;
                    transition: all 0.3s ease;
                ">ДА</button>
                <button id="confirmNo" style="
                    padding: 12px 30px;
                    background: transparent;
                    color: var(--profile-text-primary);
                    border: 2px solid var(--profile-input-border);
                    cursor: pointer;
                    letter-spacing: 0.1em;
                    transition: all 0.3s ease;
                ">НЕТ</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(confirmDiv);
    
    document.getElementById('confirmYes').addEventListener('click', () => {
        localStorage.removeItem('isLoggedIn');
        localStorage.removeItem('userName');
        localStorage.removeItem('userPhone');
        localStorage.removeItem('userEmail');
        localStorage.removeItem('token');
        localStorage.removeItem('userId');
        
        document.body.removeChild(confirmDiv);
        showNotification('Вы вышли из системы');
        
        setTimeout(() => {
            window.location.href = '/login';
        }, 500);
    });
    
    document.getElementById('confirmNo').addEventListener('click', () => {
        document.body.removeChild(confirmDiv);
    });
}

// =====================================================
// ЗАМОРОЗКИ
// =====================================================

let currentMembershipId = null;
let userGender = null;

// Загрузить данные абонемента
async function loadMembershipData() {
    try {
        const token = getAuthToken();
        const userId = localStorage.getItem('userId');
        
        if (!userId) {
            return;
        }
        
        
        // Загрузить данные ученика
        const studentRes = await fetch(`${API_URL}/students/${userId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const studentData = await studentRes.json();
        
        const student = studentData.student;
        
        if (!student) {
            return;
        }
        
        userGender = student.gender;
        
        // Загрузить данные абонемента
        const membershipRes = await fetch(`${API_URL}/memberships/student/${userId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const membershipData = await membershipRes.json();
        
        const memberships = membershipData.memberships;
        
        if (!memberships) {
        }
        
        // Найти активный абонемент
        const activeMembership = memberships?.find(m => m.status === 'active');
        
        const membershipInfoEl = document.getElementById('membershipInfo');
        const membershipStatusEl = document.querySelector('.membership-status');
        
        if (activeMembership) {
            currentMembershipId = activeMembership._id;
            
            // ЛОГИКА ОТОБРАЖЕНИЯ ЗАМОРОЗОК ДЛЯ ТЕКУЩЕГО ЦИКЛА
            // 1 цикл = 8 занятий, заморозок: 1 (муж) или 2 (жен)
            const classesUsed = activeMembership.classesUsed || 0;
            const freezesPerCycle = userGender === 'female' ? 2 : 1;
            
            // Определяем текущий цикл (какой по счету из 8 занятий)
            const currentCycleNumber = Math.floor(classesUsed / 8);
            const freezesUsedInPreviousCycles = currentCycleNumber * freezesPerCycle;
            
            // Сколько использовано в ТЕКУЩЕМ цикле
            const freezesUsedInCurrentCycle = Math.max(0, (activeMembership.freezesUsed || 0) - freezesUsedInPreviousCycles);
            const freezesLeftInCurrentCycle = freezesPerCycle - Math.min(freezesUsedInCurrentCycle, freezesPerCycle);
            
            // Цвет для количества оставшихся занятий
            let remainingColor = '#eb4d77';
            let remainingWeight = '400';
            if (activeMembership.classesRemaining === 1) {
                remainingColor = '#ef4444';
                remainingWeight = '700';
            } else if (activeMembership.classesRemaining === 2) {
                remainingColor = '#f59e0b';
            }
            
            // Создать HTML для абонемента
            if (membershipInfoEl) {
                membershipInfoEl.innerHTML = `
                    <div class="membership-row">
                        <span class="label">В месяц:</span>
                        <span class="value">${activeMembership.totalClasses} занятий</span>
                    </div>
                    <div class="membership-row">
                        <span class="label">Осталось занятий:</span>
                        <span class="value" style="color: ${remainingColor}; font-weight: ${remainingWeight};">${activeMembership.classesRemaining}</span>
                    </div>
                    <div class="membership-row">
                        <span class="label">Заморозок в текущем цикле:</span>
                        <span class="value">${Math.min(freezesUsedInCurrentCycle, freezesPerCycle)} из ${freezesPerCycle} использовано</span>
                    </div>
                `;
            } else {
            }
            
            if (membershipStatusEl) {
                membershipStatusEl.textContent = 'АКТИВЕН';
                membershipStatusEl.className = 'membership-status active';
            }
            
            const availableFreezesEl = document.getElementById('availableFreezes');
            if (availableFreezesEl) {
                availableFreezesEl.textContent = `${freezesLeftInCurrentCycle} из ${freezesPerCycle}`;
            }
            
            // Показать опцию "Менструация" для женщин
            if (userGender === 'female') {
                const periodOption = document.getElementById('periodOption');
                if (periodOption) periodOption.style.display = 'block';
            }
        } else {
            // Нет активного абонемента
            if (membershipInfoEl) {
                membershipInfoEl.innerHTML = `
                    <div style="padding: 20px; text-align: center; opacity: 0.5;">
                        Нет активного абонемента
                    </div>
                `;
            }
            if (membershipStatusEl) {
                membershipStatusEl.textContent = 'НЕ АКТИВЕН';
                membershipStatusEl.className = 'membership-status inactive';
            }
        }
        
        // Загрузить активные заморозки
        await loadActiveFreezes();
        
        
    } catch (error) {
        
        // Показываем ошибку пользователю
        const membershipInfoEl = document.getElementById('membershipInfo');
        if (membershipInfoEl) {
            membershipInfoEl.innerHTML = `
                <div style="padding: 20px; text-align: center; color: #ef4444;">
                    Ошибка загрузки абонемента
                </div>
            `;
        }
    }
}

// Загрузить и отобразить активные заморозки
async function loadActiveFreezes() {
    try {
        const token = getAuthToken();
        
        const response = await fetch(`${API_URL}/freezes?status=active`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const { freezes } = await response.json();
        
        const container = document.getElementById('activeFreezesContainer');
        const list = document.getElementById('activeFreezesList');
        
        if (!freezes || freezes.length === 0) {
            if (container) container.style.display = 'none';
            return;
        }
        
        const typeNames = {
            'regular': 'Обычная',
            'period': 'Менструация',
            'business_trip': 'Командировка',
            'sick_leave': 'Больничный'
        };
        
        list.innerHTML = freezes.map(freeze => {
            const start = new Date(freeze.startDate).toLocaleDateString('ru');
            const end = new Date(freeze.endDate).toLocaleDateString('ru');
            
            return `
                <div style="
                    padding: 12px;
                    background: rgba(96, 165, 250, 0.1);
                    border-left: 3px solid #60a5fa;
                    border-radius: 6px;
                    margin-bottom: 10px;
                ">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span style="font-weight: 600; font-size: 0.9rem;">❄️ ${typeNames[freeze.type] || freeze.type}</span>
                        <span style="color: #60a5fa; font-size: 0.85rem;">${freeze.frozenClasses} ${freeze.frozenClasses === 1 ? 'занятие' : 'занятия'}</span>
                    </div>
                    <div style="font-size: 0.85rem; opacity: 0.8;">${start} — ${end}</div>
                </div>
            `;
        }).join('');
        
        if (container) container.style.display = 'block';
        
    } catch (error) {
    }
}

// Модальное окно заморозки
const freezeModal = document.getElementById('freezeModal');
const freezeBtn = document.getElementById('freezeBtn');
const closeModal = document.getElementById('closeModal');
const freezeForm = document.getElementById('freezeForm');

// Загрузить предстоящие занятия для заморозки
async function loadClassesForFreeze() {
    try {
        const token = getAuthToken();
        const studentId = localStorage.getItem('userId');
        
        const response = await fetch(`${API_URL}/students/${studentId}/upcoming-classes`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        
        const container = document.getElementById('classesForFreezeList');
        if (!data.classes || data.classes.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; opacity: 0.5;">
                    Нет предстоящих занятий для заморозки
                </div>
            `;
            return;
        }
        
        container.innerHTML = data.classes.map(cls => {
            const date = new Date(cls.date);
            const dayName = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
            const day = date.getDate();
            const monthName = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 
                             'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'][date.getMonth()];
            
            // Используем правильные названия полей из ответа бэкенда
            const groupName = cls.group || cls.title || cls.groupName || 'Группа';
            const time = (cls.startTime && cls.endTime) ? `${cls.startTime} - ${cls.endTime}` : (cls.time || 'Время не указано');
            
            return `
                <label class="freeze-class-item" data-class-id="${cls._id}" data-class-date="${cls.date}">
                    <input type="checkbox" name="freezeClasses" value="${cls._id}" data-date="${cls.date}">
                    <div class="freeze-class-content">
                        <div class="freeze-class-header">
                            <span class="freeze-class-day">${dayName}</span>
                            <span class="freeze-class-date">${day} ${monthName}</span>
                        </div>
                        <div class="freeze-class-info">
                            <div class="freeze-class-name">${groupName}</div>
                            <div class="freeze-class-time">${time}</div>
                        </div>
                    </div>
                </label>
            `;
        }).join('');
        
        // Добавить слушатели для включения/выключения кнопки
        const checkboxes = container.querySelectorAll('input[type="checkbox"]');
        const submitBtn = document.getElementById('submitFreezeBtn');
        
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                const anyChecked = Array.from(checkboxes).some(cb => cb.checked);
                submitBtn.disabled = !anyChecked;
            });
        });
        
    } catch (error) {
        document.getElementById('classesForFreezeList').innerHTML = `
            <div style="text-align: center; padding: 40px; color: #ff5555;">
                Ошибка загрузки занятий
            </div>
        `;
    }
}

// Открыть модальное окно
if (freezeBtn) {
    freezeBtn.addEventListener('click', async () => {
        if (!currentMembershipId) {
            showNotification(notificationWithIcon('warning', `
                У вас нет активного абонемента.<br><br>
                Обратитесь к администратору:<br>
                <strong>+7 (700) 095-09-04</strong>
            `));
            return;
        }
        
        freezeModal.classList.add('show');
        await loadClassesForFreeze();
    });
}

// Закрыть модальное окно
function closeFreezeModal() {
    freezeModal.classList.remove('show');
    freezeForm.reset();
}

if (closeModal) {
    closeModal.addEventListener('click', closeFreezeModal);
}

// Закрыть при клике на оверлей
freezeModal?.querySelector('.modal-overlay')?.addEventListener('click', closeFreezeModal);

// Обработка формы заморозки
if (freezeForm) {
    freezeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Получить выбранные занятия
        const selectedCheckboxes = document.querySelectorAll('input[name="freezeClasses"]:checked');
        
        if (selectedCheckboxes.length === 0) {
            showNotification('Выберите хотя бы одно занятие для заморозки');
            return;
        }
        
        const selectedClasses = Array.from(selectedCheckboxes).map(cb => ({
            classId: cb.value,
            date: cb.dataset.date
        }));
        
        // Группируем занятия по датам для создания заморозок
        const freezesToCreate = [];
        
        for (const cls of selectedClasses) {
            const classDate = new Date(cls.date);
            const startDate = new Date(classDate);
            startDate.setHours(0, 0, 0, 0);
            const endDate = new Date(classDate);
            endDate.setHours(23, 59, 59, 999);
            
            freezesToCreate.push({
                startDate: startDate.toISOString().split('T')[0],
                endDate: endDate.toISOString().split('T')[0],
                reason: `Заморозка на ${classDate.toLocaleDateString('ru-RU')}`
            });
        }
        
        try {
            const token = getAuthToken();
            let successCount = 0;
            let errorCount = 0;
            let lastError = null;
            
            // Создаем заморозку для каждого выбранного занятия
            for (const freeze of freezesToCreate) {
                const response = await fetch(`${API_URL}/freezes`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        membershipId: currentMembershipId,
                        type: 'regular',  // Обычная заморозка
                        startDate: freeze.startDate,
                        endDate: freeze.endDate,
                        reason: freeze.reason
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    successCount++;
                } else {
                    errorCount++;
                    lastError = data.error;
                }
            }
            
            if (successCount > 0) {
                const message = notificationWithIcon('freeze', `
                    Заморожено занятий: <strong>${successCount}</strong>
                `);
                showNotification(message);
                closeFreezeModal();
                
                // Обновить данные
                await loadMembershipData();
                await loadActiveFreezes();
                await loadUpcomingClasses();
            }
            
            if (errorCount > 0) {
                // Определяем тип ошибки и показываем правильное сообщение
                let errorMessage = '';
                
                if (lastError && lastError.includes('заморозки использованы')) {
                    errorMessage = notificationWithIcon('freeze', `
                        Все доступные заморозки уже использованы.<br><br>
                        Для дополнительных заморозок обратитесь к администратору:<br>
                        <strong>+7 (700) 095-09-04</strong>
                    `);
                } else if (lastError && lastError.includes('занятий')) {
                    errorMessage = notificationWithIcon('warning', `
                        ${lastError}<br><br>
                        Возможно, занятия еще не созданы в расписании.<br>
                        Обратитесь к администратору:<br>
                        <strong>+7 (700) 095-09-04</strong>
                    `);
                } else {
                    errorMessage = notificationWithIcon('warning', `
                        Не удалось заморозить занятия.<br><br>
                        Пожалуйста, обратитесь к администратору:<br>
                        <strong>+7 (700) 095-09-04</strong>
                    `);
                }
                
                showNotification(errorMessage);
            }
            
        } catch (error) {
            showNotification(notificationWithIcon('error', `
                Ошибка при создании заморозки.<br><br>
                Пожалуйста, обратитесь к администратору:<br>
                <strong>+7 (700) 095-09-04</strong>
            `));
        }
    });
}

// =====================================================
// ЗАГРУЗКА ДАННЫХ ГРУПП
// =====================================================

async function loadUserGroups() {
    try {
        const token = getAuthToken();
        const userId = localStorage.getItem('userId');
        
        if (!userId) return;
        
        const response = await fetch(`${API_URL}/students/${userId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const { student } = await response.json();
        
        if (!student || !student.groups) return;
        
        const groupsList = document.getElementById('groupsList');
        if (!groupsList) return;
        
        const activeGroups = student.groups.filter(g => g.status === 'active');
        
        if (activeGroups.length === 0) {
            groupsList.innerHTML = '<p style="text-align: center; opacity: 0.5; padding: 40px;">У вас пока нет групп</p>';
            return;
        }
        
        // Если группы уже populate (объекты), используем их. Иначе загружаем.
        const groupsData = [];
        
        for (const g of activeGroups) {
            try {
                // Проверяем, является ли groupId объектом (уже populate)
                if (typeof g.groupId === 'object' && g.groupId !== null && g.groupId._id) {
                    groupsData.push(g.groupId);
                } else if (typeof g.groupId === 'string') {
                    // Загружаем группу
                    const res = await fetch(`${API_URL}/groups/${g.groupId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const data = await res.json();
                    if (data.group) {
                        groupsData.push(data.group);
                    }
                }
            } catch (error) {
            }
        }
        
        groupsList.innerHTML = groupsData.filter(g => g).map(group => {
            const scheduleText = group.schedule?.map(s => {
                const days = ['', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС']; // Индекс 0 пустой, 1=ПН, 7=ВС
                const dayName = days[s.dayOfWeek] || s.dayOfWeek;
                const time = s.time || 'время уточняется';
                return `${dayName} ${time}`;
            }).join(', ') || 'Расписание уточняется';
            
            return `
                <div class="group-card">
                    <div class="group-header">
                        <h3 class="group-name">${group.name}</h3>
                    </div>
                    <div class="group-info">
                        <div class="group-info-item">
                            <svg class="icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                <line x1="16" y1="2" x2="16" y2="6"></line>
                                <line x1="8" y1="2" x2="8" y2="6"></line>
                                <line x1="3" y1="10" x2="21" y2="10"></line>
                            </svg>
                            <span>${scheduleText}</span>
                        </div>
                        <div class="group-info-item">
                            <svg class="icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                <circle cx="9" cy="7" r="4"></circle>
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                            <span>${group.currentStudents || 0} учеников</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (error) {
    }
}

// =====================================================
// ЗАГРУЗКА БЛИЖАЙШИХ ЗАНЯТИЙ
// =====================================================

async function loadUpcomingClasses() {
    try {
        const token = getAuthToken();
        const userId = localStorage.getItem('userId');
        
        if (!userId) return;
        
        // Загрузить группы ученика
        const studentRes = await fetch(`${API_URL}/students/${userId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const { student } = await studentRes.json();
        
        if (!student || !student.groups) return;
        
        const activeGroups = student.groups.filter(g => g.status === 'active');
        
        if (activeGroups.length === 0) {
            const classList = document.querySelector('.classes-list');
            if (classList) {
                classList.innerHTML = '<p style="text-align: center; opacity: 0.5; padding: 40px;">Нет активных групп</p>';
            }
            return;
        }
        
        // Загрузить реальные занятия из базы данных через специальный endpoint для студентов
        const classesRes = await fetch(
            `${API_URL}/students/${userId}/upcoming-classes`,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const { classes } = await classesRes.json();
        
        if (!classes || classes.length === 0) {
            const classList = document.querySelector('.classes-list');
            if (classList) {
                classList.innerHTML = '<p style="text-align: center; opacity: 0.5; padding: 40px;">Нет ближайших занятий</p>';
            }
            return;
        }
        
        // Берем первые 3 занятия (уже отфильтрованы и отсортированы на бэкенде)
        const upcomingClasses = classes
            .slice(0, 3)
            .map(cls => ({
                group: cls.group,
                date: new Date(cls.date),
                startTime: cls.startTime,
                endTime: cls.endTime
            }));
        
        const classList = document.querySelector('.classes-list');
        if (!classList) return;
        
        if (upcomingClasses.length === 0) {
            classList.innerHTML = '<p style="text-align: center; opacity: 0.5; padding: 40px;">Нет ближайших занятий</p>';
            return;
        }
        
        const dayNames = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
        const monthNames = ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК'];
        
        classList.innerHTML = upcomingClasses.map(cls => {
            // Убедимся что дата валидна
            if (!cls.date || !(cls.date instanceof Date) || isNaN(cls.date)) {
                return '';
            }
            
            const dayName = dayNames[cls.date.getDay()] || '';
            const dayNum = cls.date.getDate();
            const monthIndex = cls.date.getMonth();
            const monthName = monthNames[monthIndex] || 'ОКТ';
            
            return `
                <div class="class-item">
                    <div class="class-date">
                        <span class="day">${dayName}</span>
                        <span class="date-num">${dayNum} ${monthName}</span>
                    </div>
                    <div class="class-details">
                        <h4>${cls.group}</h4>
                        <p>${cls.startTime} - ${cls.endTime}</p>
                    </div>
                </div>
            `;
        }).filter(html => html).join('');
        
    } catch (error) {
        const classList = document.querySelector('.classes-list');
        if (classList) {
            classList.innerHTML = '<p style="text-align: center; opacity: 0.5; padding: 40px;">Ошибка загрузки</p>';
        }
    }
}

// =====================================================
// ЗАГРУЗКА ПРАКТИК
// =====================================================

async function loadUpcomingPractices() {
    try {
        const token = getAuthToken();
        const userId = localStorage.getItem('userId');
        
        if (!userId) return;
        
        const response = await fetch(`${API_URL}/students/${userId}/upcoming-practices`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const { practices } = await response.json();
        
        const container = document.getElementById('practicesList');
        if (!container) return;
        
        if (!practices || practices.length === 0) {
            container.innerHTML = '<div style="padding: 40px; text-align: center; opacity: 0.5;">Нет запланированных практик</div>';
            return;
        }
        
        const dayNames = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
        const monthNames = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
        
        const practicesHtml = practices.map(practice => {
            const date = new Date(practice.date);
            const dayName = dayNames[date.getDay()] || 'День';
            const day = date.getDate();
            const month = monthNames[date.getMonth()] || 'месяца';
            const startTime = practice.startTime || '00:00';
            const endTime = practice.endTime || '00:00';
            
            // Используем только название группы (без преподавателя)
            const practiceName = practice.group || 'Практика';
            
            return `
                <div class="practice-item">
                    <div class="practice-info">
                        <h4>${practiceName}</h4>
                        <p>${dayName}, ${day} ${month} • ${startTime}-${endTime}</p>
                        ${practice.room ? `<p class="practice-details">Зал: ${practice.room}</p>` : ''}
                    </div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = practicesHtml;
        
    } catch (error) {
        const container = document.getElementById('practicesList');
        if (container) {
            container.innerHTML = '<div style="padding: 40px; text-align: center; opacity: 0.5;">Ошибка загрузки практик</div>';
        }
    }
}

// =====================================================
// ЗАГРУЗКА ИСТОРИИ ПОСЕЩЕНИЙ
// =====================================================

async function loadAttendanceHistory() {
    try {
        const token = getAuthToken();
        const userId = localStorage.getItem('userId');
        
        if (!userId) return;
        
        const response = await fetch(`${API_URL}/students/${userId}/attendance-history`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const { history } = await response.json();
        
        const container = document.getElementById('attendanceHistory');
        if (!container) return;
        
        // Сохранить заголовок
        const header = container.querySelector('.attendance-row.header');
        
        if (!history || history.length === 0) {
            container.innerHTML = '';
            if (header) container.appendChild(header);
            container.innerHTML += '<div style="padding: 40px; text-align: center; opacity: 0.5;">Нет истории посещений</div>';
            return;
        }
        
        const monthNames = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
        
        const rows = history.map(item => {
            const date = new Date(item.date);
            const day = date.getDate();
            const month = monthNames[date.getMonth()] || 'окт';
            const time = item.startTime || '00:00';
            const dateStr = `${day} ${month.charAt(0).toUpperCase() + month.slice(1)} ${time}`;
            
            let statusHtml = '';
            let statusClass = '';
            
            if (item.status === 'attended') {
                statusClass = 'attended';
                statusHtml = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    Посетил
                `;
            } else if (item.status === 'frozen') {
                statusClass = 'frozen';
                statusHtml = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="6" y="4" width="4" height="16"></rect>
                        <rect x="14" y="4" width="4" height="16"></rect>
                    </svg>
                    Заморожено
                `;
            } else {
                statusClass = 'missed';
                statusHtml = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                    Пропустил
                `;
            }
            
            return `
                <div class="attendance-row">
                    <span>${dateStr}</span>
                    <span>${item.group}</span>
                    <span class="status ${statusClass}">
                        ${statusHtml}
                    </span>
                </div>
            `;
        }).join('');
        
        container.innerHTML = '';
        if (header) container.appendChild(header);
        container.innerHTML += rows;
        
    } catch (error) {
    }
}

// Редактирование профиля
const editBtn = document.querySelector('.edit-btn');
if (editBtn) {
    editBtn.addEventListener('click', () => {
        showNotification(notificationWithIcon('tool', `
            Функция редактирования в разработке.<br><br>
            Для изменения данных обратитесь к администратору:<br>
            <strong>+7 (700) 095-09-04</strong>
        `));
    });
}

// Продление абонемента
const renewBtn = document.querySelector('.action-btn:not(.primary)');
if (renewBtn) {
    renewBtn.addEventListener('click', () => {
        showNotification(notificationWithIcon('diamond', `
            Для продления абонемента обратитесь к администратору:<br>
            <strong>+7 (700) 095-09-04</strong>
        `));
    });
}

// Запись на практику - ОТКЛЮЧЕНО
// const practiceButtons = document.querySelectorAll('.practice-btn');
// practiceButtons.forEach(btn => {
//     btn.addEventListener('click', function() {
//         const practiceItem = this.closest('.practice-item');
//         const practiceName = practiceItem.querySelector('h4').textContent;
//         
//         if (this.classList.contains('cancel')) {
//             // Отмена записи
//             if (confirm(`Отменить запись на "${practiceName}"?`)) {
//                 practiceItem.classList.remove('enrolled');
//                 this.classList.remove('cancel');
//                 this.textContent = 'ЗАПИСАТЬСЯ';
//                 
//                 if (typeof showNotification !== 'undefined') {
//                     showNotification('Запись отменена');
//                 }
//             }
//         } else {
//             // Запись на практику
//             practiceItem.classList.add('enrolled');
//             this.classList.add('cancel');
//             this.textContent = 'ОТМЕНИТЬ';
//             
//             if (typeof showNotification !== 'undefined') {
//                 showNotification(`Вы записались на "${practiceName}"! 🎉`);
//             }
//         }
//     });
// });

// Кнопка выхода
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
}

// =====================================================
// ПУБЛИЧНАЯ ОФЕРТА
// =====================================================

// Показать обязательное окно с офертой (при первом входе)
function showMandatoryOffer() {
    const offerModal = document.getElementById('offerModal');
    const offerForm = document.getElementById('offerAcceptanceForm');
    const closeBtn = document.getElementById('closeOfferModal');
    const offerOverlay = document.getElementById('offerOverlay');
    
    // Показываем форму согласия
    if (offerForm) offerForm.style.display = 'block';
    
    // Скрываем кнопку закрытия (нельзя закрыть без согласия)
    if (closeBtn) closeBtn.style.display = 'none';
    
    // Блокируем закрытие по клику на overlay
    if (offerOverlay) {
        offerOverlay.onclick = null;
    }
    
    // Показываем модальное окно
    offerModal.classList.add('show');
    
}

// Показать оферту для ознакомления (кнопка в меню)
function showOfferForReview() {
    const offerModal = document.getElementById('offerModal');
    const offerForm = document.getElementById('offerAcceptanceForm');
    const closeBtn = document.getElementById('closeOfferModal');
    const offerOverlay = document.getElementById('offerOverlay');
    
    // Скрываем форму согласия
    if (offerForm) offerForm.style.display = 'none';
    
    // Показываем кнопку закрытия
    if (closeBtn) closeBtn.style.display = 'block';
    
    // Разрешаем закрытие по клику на overlay
    if (offerOverlay) {
        offerOverlay.onclick = () => {
            offerModal.classList.remove('show');
        };
    }
    
    // Показываем модальное окно
    offerModal.classList.add('show');
}

// Кнопка публичной оферты (просмотр)
const offerBtn = document.getElementById('offerBtn');
if (offerBtn) {
    offerBtn.addEventListener('click', showOfferForReview);
}

// Закрытие оферты
const closeOfferModal = document.getElementById('closeOfferModal');
if (closeOfferModal) {
    closeOfferModal.addEventListener('click', () => {
        document.getElementById('offerModal').classList.remove('show');
    });
}

// Чекбокс согласия
const offerCheckbox = document.getElementById('offerCheckbox');
const acceptOfferBtn = document.getElementById('acceptOfferBtn');

if (offerCheckbox && acceptOfferBtn) {
    offerCheckbox.addEventListener('change', () => {
        if (offerCheckbox.checked) {
            acceptOfferBtn.disabled = false;
            acceptOfferBtn.style.cursor = 'pointer';
            acceptOfferBtn.style.opacity = '1';
        } else {
            acceptOfferBtn.disabled = true;
            acceptOfferBtn.style.cursor = 'not-allowed';
            acceptOfferBtn.style.opacity = '0.5';
        }
    });
}

// Кнопка принятия оферты
if (acceptOfferBtn) {
    acceptOfferBtn.addEventListener('click', async () => {
        const userId = localStorage.getItem('userId');
        const token = getAuthToken();
        
        if (!userId) return;
        
        try {
            const response = await fetch(`${API_URL}/students/${userId}/accept-offer`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Закрываем модальное окно
                document.getElementById('offerModal').classList.remove('show');
                
                // Показываем уведомление
                showNotification(notificationWithIcon('success', 'Спасибо! Согласие с офертой сохранено.'));
                
            } else {
                showNotification(notificationWithIcon('error', `Ошибка: ${data.error}`));
            }
        } catch (error) {
            showNotification(notificationWithIcon('error', 'Ошибка при сохранении согласия'));
        }
    });
}

// =====================================================
// ИНДИКАТОРЫ ЗАГРУЗКИ
// =====================================================

function showLoadingStates() {
    // Создаем простой скелетон загрузки
    const skeleton = `
        <div class="loading-skeleton" style="
            background: linear-gradient(90deg, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.05) 75%);
            background-size: 200% 100%;
            animation: loading 1.5s ease-in-out infinite;
            border-radius: 8px;
            height: 80px;
            margin-bottom: 15px;
        "></div>
    `;
    
    // Добавляем скелетоны в контейнеры
    const groupsList = document.getElementById('groupsList');
    const classList = document.querySelector('.classes-list');
    const practicesList = document.querySelector('.practices-list');
    const attendanceList = document.getElementById('attendanceList');
    
    if (groupsList) groupsList.innerHTML = skeleton.repeat(2);
    if (classList) classList.innerHTML = skeleton.repeat(3);
    if (practicesList) practicesList.innerHTML = skeleton.repeat(2);
    if (attendanceList) attendanceList.innerHTML = skeleton.repeat(4);
    
    // Добавляем CSS анимацию если еще нет
    if (!document.getElementById('loading-animation-style')) {
        const style = document.createElement('style');
        style.id = 'loading-animation-style';
        style.textContent = `
            @keyframes loading {
                0% { background-position: 200% 0; }
                100% { background-position: -200% 0; }
            }
        `;
        document.head.appendChild(style);
    }
}

function hideLoadingStates() {
    // Скелетоны автоматически заменятся реальными данными
    // Ничего делать не нужно, просто для симметрии с showLoadingStates
}

// Инициализация при загрузке страницы
window.addEventListener('DOMContentLoaded', async () => {
    checkAuth();
    
    // Показываем индикаторы загрузки
    showLoadingStates();
    
    try {
        // ОПТИМИЗАЦИЯ: Загружаем все данные параллельно вместо последовательно
        // Это сокращает время загрузки в 5-6 раз!
        await Promise.all([
            loadUserData(),
            loadMembershipData(),
            loadUserGroups(),
            loadUpcomingClasses(),
            loadUpcomingPractices(),
            loadAttendanceHistory()
        ]);
        
    } catch (error) {
        showNotification(notificationWithIcon('error', 'Ошибка загрузки данных. Попробуйте обновить страницу.'));
    } finally {
        hideLoadingStates();
        initScrollAnimations();
    }
});

// ==================== SCROLL ANIMATIONS ====================
function initScrollAnimations() {
    const observerOptions = {
        threshold: 0.15,
        rootMargin: '0px 0px -100px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('fade-in-up');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // Элементы для анимации
    const animatedElements = document.querySelectorAll(
        '.profile-section, .group-card, .class-item, .practice-item, .membership-card, .profile-card'
    );
    
    animatedElements.forEach((el, index) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = `opacity 0.6s ease ${index * 0.1}s, transform 0.6s ease ${index * 0.1}s`;
        observer.observe(el);
    });
}

// =====================================================
// ДЕМО ДАННЫЕ (Для тестирования без backend)
// =====================================================

// В будущем эти данные будут приходить с API
const demoData = {
    user: {
        name: 'Демо Пользователь',
        phone: '+7 (700) 095-09-04',
        email: 'demo@senseofdance.kz'
    },
    groups: [
        {
            name: 'K-POP ПРОДВИНУТЫЕ',
            level: 'Advanced',
            schedule: [
                { day: 'Вторник', time: '19:00' },
                { day: 'Пятница', time: '19:00' }
            ],
            instructor: 'ИМЯ ФАМИЛИЯ',
            studentsCount: 12,
            maxStudents: 15
        },
        {
            name: 'BACHATA LADY STYLE',
            level: 'Intermediate',
            schedule: [
                { day: 'Среда', time: '20:00' },
                { day: 'Суббота', time: '18:00' }
            ],
            instructor: 'Айдарбек Ибраев',
            studentsCount: 8,
            maxStudents: 12
        }
    ],
    membership: {
        type: 'МЕСЯЦ',
        price: 22000,
        status: 'active',
        endDate: '2025-11-15',
        daysLeft: 38,
        freezeCredits: 2,
        freezeUsed: 0
    },
    upcomingClasses: [
        {
            day: 'ВТ',
            date: '9 ОКТ',
            group: 'K-pop Продвинутые',
            time: '19:00 - 20:30'
        },
        {
            day: 'СР',
            date: '10 ОКТ',
            group: 'Bachata Lady Style',
            time: '20:00 - 21:30'
        },
        {
            day: 'ПТ',
            date: '12 ОКТ',
            group: 'K-pop Продвинутые',
            time: '19:00 - 20:30'
        }
    ],
    practices: [
        {
            name: 'Общая практика All Styles',
            date: 'Суббота, 13 октября',
            time: '15:00-17:00',
            description: 'Для всех направлений',
            enrolled: false
        },
        {
            name: 'Практика K-pop',
            date: 'Воскресенье, 14 октября',
            time: '16:00-18:00',
            description: 'K-pop, K-pop Choreo',
            enrolled: true
        }
    ],
    attendance: [
        {
            date: '5 Окт 19:00',
            group: 'K-pop Продвинутые',
            status: 'attended'
        },
        {
            date: '3 Окт 20:00',
            group: 'Bachata Lady Style',
            status: 'attended'
        },
        {
            date: '2 Окт 19:00',
            group: 'K-pop Продвинутые',
            status: 'frozen'
        },
        {
            date: '30 Сен 20:00',
            group: 'Bachata Lady Style',
            status: 'attended'
        }
    ]
};

// Функция для загрузки демо данных (можно вызвать для теста)
function loadDemoData() {
    // В будущем здесь будет fetch к API
    // const response = await fetch('/api/profile');
    // const data = await response.json();
}

// =====================================================
// API ИНТЕГРАЦИЯ (Заготовка для будущего)
// =====================================================
// API_URL и getAuthToken уже объявлены в начале файла

// Заготовка для загрузки профиля с API
async function fetchProfile() {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/profile`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error('Ошибка загрузки профиля');
        }
        
        const data = await response.json();
        return data;
    } catch (error) {
        return null;
    }
}

// Заготовка для заморозки занятия
async function freezeClass(data) {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/memberships/freeze`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            throw new Error('Ошибка заморозки занятия');
        }
        
        const result = await response.json();
        return result;
    } catch (error) {
        return null;
    }
}

// Заготовка для записи на практику
async function enrollPractice(practiceId) {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/practices/${practiceId}/attend`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error('Ошибка записи на практику');
        }
        
        const result = await response.json();
        return result;
    } catch (error) {
        return null;
    }
}

// =====================================================
// РЕДАКТИРОВАНИЕ EMAIL
// =====================================================

// Включить редактирование email
function enableEmailEdit() {
    const emailSpan = document.getElementById('profileEmail');
    const currentEmail = emailSpan.textContent.trim();
    const editBtn = document.getElementById('editEmailBtn');
    
    // Создаем input вместо span
    const emailContainer = emailSpan.parentElement;
    emailContainer.innerHTML = `
        <input type="email" 
               id="emailInput" 
               value="${currentEmail === '-' ? '' : currentEmail}" 
               placeholder="Введите email"
               style="flex: 1; padding: 8px 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(235, 77, 212, 0.3); border-radius: 4px; color: var(--text-primary); font-size: 0.9rem;">
        <button onclick="saveEmail()" style="padding: 6px 12px; font-size: 0.8rem; background: var(--pink); border: none; color: #000; border-radius: 4px; cursor: pointer; font-weight: 600;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle;">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Сохранить
        </button>
        <button onclick="cancelEmailEdit('${currentEmail}')" style="padding: 6px 12px; font-size: 0.8rem; background: transparent; border: 1px solid rgba(255, 255, 255, 0.2); color: rgba(255, 255, 255, 0.6); border-radius: 4px; cursor: pointer;">
            Отмена
        </button>
    `;
    
    // Фокус на input
    document.getElementById('emailInput').focus();
}

// Отменить редактирование email
function cancelEmailEdit(originalEmail) {
    const emailContainer = document.getElementById('emailInput').parentElement;
    emailContainer.innerHTML = `
        <span class="info-value" id="profileEmail" style="flex: 1;">${originalEmail}</span>
        <button class="email-edit-btn" id="editEmailBtn" onclick="enableEmailEdit()" style="padding: 6px 12px; font-size: 0.8rem; background: transparent; border: 1px solid rgba(235, 77, 212, 0.3); color: var(--pink); border-radius: 4px; cursor: pointer; transition: all 0.3s;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle;">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Изменить
        </button>
    `;
}

// Сохранить email
async function saveEmail() {
    const emailInput = document.getElementById('emailInput');
    const newEmail = emailInput.value.trim();
    
    // Валидация email
    if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        showNotification(notificationWithIcon('warning', 'Введите корректный email адрес'));
        return;
    }
    
    try {
        const token = getAuthToken();
        const userId = localStorage.getItem('userId');
        
        const response = await fetch(`${API_URL}/students/${userId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email: newEmail })
        });
        
        const data = await response.json();
        
        if (!data.success) {
            showNotification(notificationWithIcon('error', data.error || 'Ошибка сохранения email'));
            return;
        }
        
        // Обновляем отображение
        const emailContainer = emailInput.parentElement;
        const displayEmail = newEmail || '-';
        emailContainer.innerHTML = `
            <span class="info-value" id="profileEmail" style="flex: 1;">${displayEmail}</span>
            <button class="email-edit-btn" id="editEmailBtn" onclick="enableEmailEdit()" style="padding: 6px 12px; font-size: 0.8rem; background: transparent; border: 1px solid rgba(235, 77, 212, 0.3); color: var(--pink); border-radius: 4px; cursor: pointer; transition: all 0.3s;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle;">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                Изменить
            </button>
        `;
        
        showNotification(notificationWithIcon('success', 'Email успешно обновлен'));
        
    } catch (error) {
        showNotification(notificationWithIcon('error', 'Ошибка подключения к серверу'));
    }
}

