// =====================================================
// UTILS MODULE - Вспомогательные функции
// =====================================================

function getIcon(name, size = 24) {
    // Простая реализация иконок
    const icons = {
        'success': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
        'check': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
        'warning': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`
    };
    return icons[name] || '';
}


// Универсальная функция копирования (работает на HTTP и HTTPS)
async function copyToClipboard(text) {
    // Попытка 1: Современный API (работает только на HTTPS/localhost)
    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
        }
    }

    // Попытка 2: Старый метод через textarea (работает везде)
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.top = '0';
        textarea.style.left = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();

        const successful = document.execCommand('copy');
        document.body.removeChild(textarea);

        return successful;
    } catch (e) {
        return false;
    }
}

// Кастомный confirm dialog (с поддержкой светлой/темной темы)
function customConfirm(message, options = {}) {
    return new Promise((resolve) => {
        const confirmDiv = document.createElement('div');

        // Определяем текущую тему
        const isLightTheme = document.documentElement.getAttribute('data-theme') === 'light';
        const overlayBg = isLightTheme ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.9)';

        confirmDiv.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: ${overlayBg};
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100050;
        `;

        const icon = options.icon || 'warning';
        const iconSvg = typeof getIcon !== 'undefined' ? getIcon(icon, 28) : '';

        confirmDiv.innerHTML = `
            <div style="
            background: var(--admin-card);
            border: 1px solid var(--admin-border);
            border-radius: 22px;
                padding: 40px;
                text-align: center;
                max-width: 500px;
                min-width: 400px;
            box-shadow: 0 24px 70px var(--admin-shadow);
            ">
                <div style="display: flex; align-items: flex-start; gap: 20px; margin-bottom: 30px;">
                    <div style="color: var(--pink); flex-shrink: 0;">
                        ${iconSvg}
                    </div>
                    <p style="color: var(--admin-text); font-size: 1.05rem; line-height: 1.6; letter-spacing: 0.03em; text-align: left; margin: 0; flex: 1;">
                        ${message.replace(/\n/g, '<br>')}
                    </p>
                </div>
                <div style="display: flex; gap: 15px; justify-content: center;">
                    <button id="confirmYes" style="
                        padding: 12px 30px;
                        background: var(--pink);
                        color: #ffffff;
                    border: none;
                    border-radius: 11px;
                        cursor: pointer;
                        letter-spacing: 0.1em;
                        font-size: 0.9rem;
                        transition: all 0.3s ease;
                    ">${options.yesText || 'ДА'}</button>
                    <button id="confirmNo" style="
                        padding: 12px 30px;
                        background: transparent;
                        color: var(--admin-text);
                    border: 1px solid var(--admin-border);
                    border-radius: 11px;
                        cursor: pointer;
                        letter-spacing: 0.1em;
                        font-size: 0.9rem;
                        transition: all 0.3s ease;
                    ">${options.noText || 'НЕТ'}</button>
                </div>
            </div>
        `;

        document.body.appendChild(confirmDiv);

        document.getElementById('confirmYes').addEventListener('click', () => {
            document.body.removeChild(confirmDiv);
            resolve(true);
        });

        document.getElementById('confirmNo').addEventListener('click', () => {
            document.body.removeChild(confirmDiv);
            resolve(false);
        });
    });
}

window.customConfirm = customConfirm;

// Склонение существительных (1 занятие, 2 занятия, 5 занятий)
function getDeclension(number, one, two, five) {
    let n = Math.abs(number);
    n %= 100;
    if (n >= 5 && n <= 20) return five;
    n %= 10;
    if (n === 1) return one;
    if (n >= 2 && n <= 4) return two;
    return five;
}

function getStudentAge(dateValue) {
    if (!dateValue) return null;
    const birthDate = new Date(dateValue);
    if (Number.isNaN(birthDate.getTime())) return null;

    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    const hasBirthdayPassed = monthDiff > 0 || (monthDiff === 0 && today.getDate() >= birthDate.getDate());
    if (!hasBirthdayPassed) age -= 1;

    if (age < 0 || age > 120) return null;
    return age;
}

function formatStudentAgeLabel(dateValue) {
    const age = getStudentAge(dateValue);
    if (age === null) return '';
    return `${age} ${getDeclension(age, 'год', 'года', 'лет')}`;
}

function renderStudentAgeBadge(dateValue, className = 'student-age-badge') {
    const label = formatStudentAgeLabel(dateValue);
    return label ? `<span class="${className}">${label}</span>` : '';
}

window.getStudentAge = getStudentAge;
window.formatStudentAgeLabel = formatStudentAgeLabel;
window.renderStudentAgeBadge = renderStudentAgeBadge;

// Форматирование расписания группы
function formatSchedule(schedule) {
    if (!schedule || schedule.length === 0) return 'Нет расписания';
    const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    return schedule.map(s => {
        const timeStr = `${days[s.dayOfWeek - 1]} ${s.time}`;
        return s.isPractice ? `${timeStr} 🔵 Практика` : timeStr;
    }).join(', ');
}

// Форматирование даты
function formatDate(date) {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('ru-RU');
}

// Форматирование даты и времени
function formatDateTime(date) {
    if (!date) return '-';
    return new Date(date).toLocaleString('ru-RU');
}

// Получить класс для badge абонемента (цветовая индикация)
function getMembershipClass(membership) {
    if (!membership || !membership.classesRemaining) {
        return 'none'; // Серый для отсутствия абонемента
    }

    const remaining = Number(membership.classesRemaining);

    if (remaining === 0) {
        return 'expired'; // Красный для 0 занятий
    } else if (remaining === 1) {
        return 'critical'; // Красный для 1 занятия
    } else if (remaining === 2) {
        return 'expiring'; // Желтый для 2 занятий
    }
    return 'active';
}

// Получить текст статуса заявки
function getStatusText(status) {
    const statuses = {
        'new': 'Новая',
        'processed': 'Думает',
        'trial': 'Пробное',
        'sold': 'Продано',
        'rejected': 'Отклонено'
    };
    return statuses[status] || status;
}

// Получить текст роли пользователя
function getRoleText(role) {
    const roles = {
        'student': 'Ученик',
        'sales_manager': 'Менеджер',
        'teacher': 'Преподаватель',
        'admin': 'Админ',
        'super_admin': 'Супер Админ'
    };
    return roles[role] || role;
}

// Получить короткое название роли
function getRoleNameShort(role) {
    const names = {
        super_admin: 'Супер',
        admin: 'Админ',
        sales_manager: 'Менеджер',
        teacher: 'Препод',
        student: 'Ученик'
    };
    return names[role] || role;
}

// Способы оплаты — единый источник для всех форм
const PAYMENT_METHODS = [
    { value: 'kaspi',     label: 'Каспи' },
    { value: 'cash',      label: 'Наличные' },
    { value: 'kaspi_pay', label: 'КаспиПей' },
    { value: 'freedom',   label: 'Фридом' },
    { value: 'halyk',     label: 'Халык Банк' }
];
const LEGACY_PAYMENT_METHOD_LABELS = {
    pay: 'Pay',
    kaspi_transfer: 'Перевод Kaspi Меру',
    halyk_transfer: 'Перевод Halyk Меру',
    freedom_transfer: 'Перевод Freedom Меру'
};

function getPaymentMethodLabel(method) {
    if (!method) return '';
    const found = PAYMENT_METHODS.find(m => m.value === method);
    return found ? found.label : (LEGACY_PAYMENT_METHOD_LABELS[method] || method);
}

function renderPaymentMethodOptions(selected = '') {
    const empty = `<option value="">Выберите счет</option>`;
    return empty + PAYMENT_METHODS
        .map(m => `<option value="${m.value}" ${selected === m.value ? 'selected' : ''}>${m.label}</option>`)
        .join('');
}

window.PAYMENT_METHODS = PAYMENT_METHODS;
window.getPaymentMethodLabel = getPaymentMethodLabel;
window.renderPaymentMethodOptions = renderPaymentMethodOptions;
