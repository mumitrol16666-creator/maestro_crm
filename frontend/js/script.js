// ==================== CUSTOM CURSOR ====================
const cursor = document.querySelector('.cursor');
const cursorFollower = document.querySelector('.cursor-follower');

// Позиции курсора
let mouse = { x: 0, y: 0 };
let cursorPos = { x: 0, y: 0 };
let followerPos = { x: 0, y: 0 };

// Масштабы
let cursorScale = 1;
let followerScale = 1;

// Коэффициенты сглаживания (чем меньше значение, тем плавнее)
const cursorSmoothing = 1;     // Точка мгновенная
const followerSmoothing = 0.12; // Круг плавный

// Отслеживание мыши
document.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
}, { passive: true });

// Функция линейной интерполяции (lerp)
function lerp(start, end, factor) {
    return start + (end - start) * factor;
}

// Анимация курсора
function animateCursor() {
    // Точка следует мгновенно
    cursorPos.x = lerp(cursorPos.x, mouse.x, cursorSmoothing);
    cursorPos.y = lerp(cursorPos.y, mouse.y, cursorSmoothing);
    
    // Круг следует плавно
    followerPos.x = lerp(followerPos.x, mouse.x, followerSmoothing);
    followerPos.y = lerp(followerPos.y, mouse.y, followerSmoothing);
    
    // Применяем трансформации
    cursor.style.transform = `translate3d(${cursorPos.x - 5}px, ${cursorPos.y - 5}px, 0) scale(${cursorScale})`;
    cursorFollower.style.transform = `translate3d(${followerPos.x - 20}px, ${followerPos.y - 20}px, 0) scale(${followerScale})`;
    
    requestAnimationFrame(animateCursor);
}

// Инициализация позиций при загрузке
window.addEventListener('load', () => {
    // Устанавливаем начальные позиции в центре экрана
    mouse.x = window.innerWidth / 2;
    mouse.y = window.innerHeight / 2;
    cursorPos.x = mouse.x;
    cursorPos.y = mouse.y;
    followerPos.x = mouse.x;
    followerPos.y = mouse.y;
    
    // Запускаем анимацию
    animateCursor();
});

// Увеличение курсора при наведении на интерактивные элементы
const interactiveElements = document.querySelectorAll('a, button, .direction-item, .team-member, .price-card');
interactiveElements.forEach(el => {
    el.addEventListener('mouseenter', () => {
        cursorScale = 2;
        followerScale = 1.5;
    });
    
    el.addEventListener('mouseleave', () => {
        cursorScale = 1;
        followerScale = 1;
    });
});

// ==================== LOADER ====================
// Скрыть loader (с fallback на случай ошибки)
function hideLoader() {
    const loader = document.getElementById('loader');
    if (loader) {
        loader.classList.add('hidden');
        console.log('✅ Loader hidden');
    }
}

// Скрыть loader при загрузке страницы
window.addEventListener('load', () => {
    setTimeout(hideLoader, 1000);
});

// FALLBACK 1: Скрыть loader при DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(hideLoader, 1500);
});

// FALLBACK 2: Принудительно скрыть через 3 секунды (агрессивный fallback)
setTimeout(hideLoader, 3000);

// ==================== PROFILE BUTTON ====================
const profileBtn = document.getElementById('profileBtn');

if (profileBtn) {
    profileBtn.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Проверяем, залогинен ли пользователь
        const isLoggedIn = localStorage.getItem('isLoggedIn');
        
        if (isLoggedIn === 'true') {
            // Перенаправляем в профиль
            window.location.href = '/profile';
        } else {
            // Перенаправляем на страницу входа
            window.location.href = '/login';
        }
    });
}

// ==================== MENU TOGGLE ====================
const menuToggle = document.getElementById('menuToggle');
const fullscreenMenu = document.getElementById('fullscreenMenu');
const menuLinks = document.querySelectorAll('.menu-link');

if (menuToggle && fullscreenMenu) {
    menuToggle.addEventListener('click', () => {
        menuToggle.classList.toggle('active');
        fullscreenMenu.classList.toggle('active');
        document.body.classList.toggle('menu-open');
    });

    // Закрытие меню при клике на ссылку
    menuLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            const targetId = link.getAttribute('href');
            
            // Если это якорь (#) - плавный скролл
            if (targetId.startsWith('#')) {
                e.preventDefault();
                
                // Закрываем меню
                menuToggle.classList.remove('active');
                fullscreenMenu.classList.remove('active');
                document.body.classList.remove('menu-open');
                
                // Плавная прокрутка к секции
                setTimeout(() => {
                    const targetSection = document.querySelector(targetId);
                    if (targetSection) {
                        targetSection.scrollIntoView({ behavior: 'smooth' });
                    }
                }, 300);
            } else {
                // Если это внешняя ссылка (blog.html) - просто закрываем меню и переходим
                menuToggle.classList.remove('active');
                fullscreenMenu.classList.remove('active');
                document.body.classList.remove('menu-open');
                // Браузер сам перейдёт по ссылке
            }
        });
    });
}

// ==================== SMOOTH SCROLL ====================
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        if (this.getAttribute('href') === '#') return;
        
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// ==================== SCROLL ANIMATIONS ====================
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

// Наблюдаем за элементами для анимации
document.addEventListener('DOMContentLoaded', () => {
    const animatedElements = document.querySelectorAll(
        '.feature-card, .direction-item, .schedule-day-block, .team-member, .price-card'
    );
    
    animatedElements.forEach((el, index) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = `opacity 0.6s ease ${index * 0.1}s, transform 0.6s ease ${index * 0.1}s`;
        observer.observe(el);
    });
});

// ==================== PARALLAX EFFECT ====================
window.addEventListener('scroll', () => {
    const scrolled = window.pageYOffset;
    const heroShape = document.querySelector('.hero-shape');
    
    if (heroShape) {
        heroShape.style.transform = `translate(-50%, -50%) scale(${1 + scrolled * 0.0005})`;
        heroShape.style.opacity = Math.max(0.1 - scrolled * 0.0003, 0);
    }
});

// ==================== TITLE ANIMATION ON SCROLL ====================
const heroTitle = document.querySelector('.hero-title');
if (heroTitle) {
    window.addEventListener('scroll', () => {
        const scrolled = window.pageYOffset;
        if (scrolled < window.innerHeight) {
            heroTitle.style.transform = `translateY(${scrolled * 0.5}px)`;
            heroTitle.style.opacity = 1 - (scrolled / window.innerHeight) * 1.5;
        }
    });
}

// ==================== DIRECTIONS HOVER EFFECT ====================
const directionItems = document.querySelectorAll('.direction-item');
directionItems.forEach(item => {
    const hoverImg = item.querySelector('.direction-hover-img');
    
    item.addEventListener('mouseenter', () => {
        hoverImg.style.opacity = '0.1';
        hoverImg.style.transform = 'translateY(-50%) scale(1.1)';
    });
    
    item.addEventListener('mouseleave', () => {
        hoverImg.style.opacity = '0';
        hoverImg.style.transform = 'translateY(-50%) scale(1)';
    });
});

// ==================== CONTACT FORM ====================
const contactForm = document.getElementById('contactForm');
const contactPhoneInput = document.getElementById('phone');

if (contactForm && contactPhoneInput) {
    // Форматирование телефона
    contactPhoneInput.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, '');
        
        if (value.length > 0) {
            if (value[0] === '8') {
                value = '7' + value.substring(1);
            } else if (value[0] !== '7') {
                value = '7' + value;
            }
            
            let formattedValue = '+7';
            
            if (value.length > 1) {
                formattedValue += ' (' + value.substring(1, 4);
            }
            if (value.length >= 4) {
                formattedValue += ') ' + value.substring(4, 7);
            }
            if (value.length >= 7) {
                formattedValue += '-' + value.substring(7, 9);
            }
            if (value.length >= 9) {
                formattedValue += '-' + value.substring(9, 11);
            }
            
            e.target.value = formattedValue;
        }
    });

    // Отправка формы в БД и Telegram
    contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const directionSelect = document.getElementById('direction');
    const directionText = directionSelect.options[directionSelect.selectedIndex].text;
    
    const formData = {
        name: document.getElementById('name').value.trim(),
        lastName: document.getElementById('lastName').value.trim(),
        phone: document.getElementById('phone').value.trim(),
        direction: directionText
    };
    
    try {
        // 1. Сохраняем в базу данных
        const response = await fetch(`${API_BASE_URL}/api/bookings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: formData.name,
                lastName: formData.lastName,
                phone: formData.phone,
                direction: formData.direction,
                source: 'Сайт'
            })
        });
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Ошибка сохранения заявки');
        }
        
        
        // 2. Отправляем в Telegram
        try {
            await sendToTelegram(formData);
        } catch (telegramError) {
            // Не блокируем процесс если Telegram не работает
        }
        
        showNotification('Спасибо! Ваша заявка отправлена. Мы свяжемся с вами в ближайшее время.');
        contactForm.reset();
        
    } catch (error) {
        showNotification('Произошла ошибка. Попробуйте позвонить нам: +7 (700) 095-09-04');
    }
});
}

// ==================== ОТПРАВКА В TELEGRAM ====================
async function sendToTelegram(data) {
    
    // Проверяем наличие конфигурации
    if (!TELEGRAM_CONFIG || !TELEGRAM_CONFIG.BOT_TOKEN || !TELEGRAM_CONFIG.CHAT_ID) {
        throw new Error('Telegram не настроен');
    }
    
    // Проверяем что это не плейсхолдеры
    if (TELEGRAM_CONFIG.BOT_TOKEN === 'ВАШ_ТОКЕН_БОТА' || 
        TELEGRAM_CONFIG.CHAT_ID === 'ВАШ_CHAT_ID') {
        throw new Error('Telegram не настроен');
    }
    
    
    // Получаем название направления
    const directionSelect = document.getElementById('direction');
    const directionText = directionSelect.options[directionSelect.selectedIndex].text;
    
    // Форматируем сообщение
    const message = `
${TELEGRAM_CONFIG.MESSAGE_TEMPLATE.emoji} ${TELEGRAM_CONFIG.MESSAGE_TEMPLATE.title}
${TELEGRAM_CONFIG.MESSAGE_TEMPLATE.separator}

👤 Имя: ${data.name}
📞 Телефон: ${data.phone}
💃 Направление: ${directionText}

📅 Дата: ${new Date().toLocaleString('ru-RU', { 
    timeZone: 'Asia/Almaty',
    dateStyle: 'short',
    timeStyle: 'short'
})}

${TELEGRAM_CONFIG.MESSAGE_TEMPLATE.separator}
    `.trim();
    
    
    const url = `https://api.telegram.org/bot${TELEGRAM_CONFIG.BOT_TOKEN}/sendMessage`;
    
    // Отправляем в Telegram
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            chat_id: TELEGRAM_CONFIG.CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        })
    });
    
    
    const result = await response.json();
    
    if (!response.ok) {
        throw new Error(result.description || 'Ошибка отправки в Telegram');
    }
    
    return result;
}

// ==================== ИКОНКИ SVG ====================
function getIcon(type, size = 20) {
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
        check: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
        </svg>`,
        user: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
        </svg>`,
        calendar: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>`,
        plus: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="16"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
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
}

function notificationWithIcon(icon, message) {
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
}

// ==================== NOTIFICATION ====================
function showNotification(message, options = {}) {
    const notification = document.createElement('div');
    
    // Определяем, находимся ли мы в админке со светлой темой
    const isAdminPage = document.body.classList.contains('admin-body');
    const isLightTheme = document.documentElement.getAttribute('data-theme') === 'light';
    
    // Выбираем правильные цвета в зависимости от темы
    const bgColor = isAdminPage ? 'var(--admin-card)' : 'var(--black)';
    const textColor = isAdminPage ? 'var(--admin-text)' : 'var(--white)';
    const shadow = isAdminPage ? 'var(--admin-shadow)' : 'rgba(0, 0, 0, 0.3)';
    
    notification.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.8);
        background: ${bgColor};
        color: ${textColor};
        padding: 40px 60px;
        border: 2px solid var(--pink);
        z-index: 10000;
        font-size: 0.95rem;
        letter-spacing: 0.05em;
        text-align: center;
        max-width: 600px;
        opacity: 0;
        transition: all 0.3s ease;
        line-height: 1.6;
        white-space: pre-line;
        box-shadow: 0 10px 40px ${shadow};
    `;
    
    // Если сообщение содержит HTML (с иконками), используем innerHTML
    if (message.includes('<svg') || message.includes('<div')) {
        notification.innerHTML = message;
    } else {
        notification.textContent = message;
    }
    
    document.body.appendChild(notification);
    
    // Анимация появления
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translate(-50%, -50%) scale(1)';
    }, 10);
    
    // Определяем длительность показа в зависимости от длины сообщения
    const textLength = notification.textContent.length;
    const displayDuration = textLength > 100 ? 6000 : 4000;
    
    // Удаление через определенное время
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translate(-50%, -50%) scale(0.8)';
        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, 300);
    }, displayDuration);
}

// ==================== MENU LINKS HOVER EFFECT ====================
menuLinks.forEach(link => {
    link.addEventListener('mouseenter', function() {
        this.style.transform = 'translateX(20px)';
    });
    
    link.addEventListener('mouseleave', function() {
        this.style.transform = 'translateX(0)';
    });
});

// ==================== MAGNETIC EFFECT FOR SUBMIT BUTTON ====================
const submitButtons = document.querySelectorAll('.submit-btn');

submitButtons.forEach(button => {
    button.addEventListener('mousemove', (e) => {
        const rect = button.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        
        button.style.transform = `translate(${x * 0.1}px, ${y * 0.1}px)`;
    });
    
    button.addEventListener('mouseleave', () => {
        button.style.transform = 'translate(0, 0)';
    });
});

// ==================== TEXT REVEAL ON SCROLL ====================
const revealText = (entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
            observer.unobserve(entry.target);
        }
    });
};

const textObserver = new IntersectionObserver(revealText, {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
});

document.querySelectorAll('.section-title, .section-title-big').forEach(title => {
    title.style.opacity = '0';
    title.style.transform = 'translateY(50px)';
    title.style.transition = 'opacity 0.8s ease, transform 0.8s ease';
    textObserver.observe(title);
});

// ==================== PRICING CARDS TILT EFFECT ====================
const priceCards = document.querySelectorAll('.price-card');

priceCards.forEach(card => {
    card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        
        const rotateX = (y - centerY) / 10;
        const rotateY = (centerX - x) / 10;
        
        card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-10px)`;
    });
    
    card.addEventListener('mouseleave', () => {
        card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) translateY(0)';
    });
});

// ==================== SCROLL PROGRESS INDICATOR ====================
const createScrollIndicator = () => {
    const indicator = document.createElement('div');
    indicator.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 0%;
        height: 2px;
        background: linear-gradient(90deg, var(--pink), var(--pink-light));
        z-index: 9999;
        transition: width 0.1s ease;
    `;
    document.body.appendChild(indicator);
    
    window.addEventListener('scroll', () => {
        const windowHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        const scrolled = (window.pageYOffset / windowHeight) * 100;
        indicator.style.width = scrolled + '%';
    });
};

createScrollIndicator();

// ==================== TEAM MEMBERS STAGGER ANIMATION ====================
const teamMembers = document.querySelectorAll('.team-member');
teamMembers.forEach((member, index) => {
    member.style.animationDelay = `${index * 0.1}s`;
});

// ==================== SCHEDULE DAY HIGHLIGHT ====================
const highlightCurrentDay = () => {
    const days = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
    const today = new Date().getDay();
    const currentDay = days[today];
    
    const dayBlocks = document.querySelectorAll('.schedule-day-block');
    dayBlocks.forEach(block => {
        const dayTitle = block.querySelector('.day-title');
        if (dayTitle && dayTitle.textContent === currentDay) {
            block.style.borderLeftColor = 'var(--pink-light)';
            block.style.borderLeftWidth = '5px';
            dayTitle.style.color = 'var(--pink-light)';
        }
    });
};

highlightCurrentDay();

// ==================== STATS COUNTER ANIMATION ====================
const animateCounter = (element, target) => {
    let current = 0;
    const increment = target / 50;
    const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
            element.textContent = target + '+';
            clearInterval(timer);
        } else {
            element.textContent = Math.floor(current) + '+';
        }
    }, 30);
};

const statsObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const statNumber = entry.target.querySelector('.stat-number');
            if (statNumber && !statNumber.classList.contains('counted')) {
                const target = parseInt(statNumber.textContent);
                statNumber.classList.add('counted');
                animateCounter(statNumber, target);
            }
            statsObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.5 });

document.querySelectorAll('.stat-item').forEach(stat => {
    statsObserver.observe(stat);
});

// ==================== FEATURE CARDS SEQUENTIAL REVEAL ====================
const featureCards = document.querySelectorAll('.feature-card');
const featureObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
            setTimeout(() => {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }, index * 150);
            featureObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.2 });

featureCards.forEach(card => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(30px)';
    card.style.transition = 'all 0.6s ease';
    featureObserver.observe(card);
});

// ==================== PREVENT RIGHT CLICK ON IMAGES (optional) ====================
// Uncomment if you want to protect images
// document.querySelectorAll('img').forEach(img => {
//     img.addEventListener('contextmenu', e => e.preventDefault());
// });

// ==================== CONSOLE MESSAGE ====================
console.log('%c SENSE OF DANCE ', 'background: #ff0080; color: #ffffff; font-size: 20px; font-weight: bold; padding: 10px;');
console.log('%c Website created with ❤️ ', 'background: #0a0a0a; color: #ffffff; font-size: 14px; padding: 5px;');

// ==================== INITIALIZATION ====================
// ==================== LOAD DIRECTIONS FROM API ====================
async function loadDirections() {
    const directionsList = document.getElementById('directionsList');
    if (!directionsList) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/directions/public`);
        const data = await response.json();
        
        if (data.success && data.directions.length > 0) {
            directionsList.innerHTML = data.directions.map((dir, index) => {
                const imageStyle = dir.image ? `style="background-image: url('${dir.image}');"` : '';
                const pricing = dir.pricing || { trial: 2000, month: 22000, threeMonths: 55000 };
                
                return `
                    <div class="direction-item">
                        <div class="direction-number">${String(index + 1).padStart(2, '0')}</div>
                        <div class="direction-content">
                            <h3 class="direction-name">${dir.name.toUpperCase()}</h3>
                            <p class="direction-desc">${dir.description}</p>
                            <div class="direction-pricing">
                                <span class="price-item">ПРОБНОЕ ${pricing.trial}₸</span>
                                <span class="price-divider">•</span>
                                <span class="price-item">МЕСЯЦ ${pricing.month}₸</span>
                                <span class="price-divider">•</span>
                                <span class="price-item">ТРИ МЕСЯЦА ${pricing.threeMonths}₸</span>
                            </div>
                            <div class="direction-info">
                                <span>От ${dir.minAge} лет</span>
                                <span>•</span>
                                <span>${dir.level}</span>
                            </div>
                        </div>
                        <div class="direction-hover-img" ${imageStyle}></div>
                    </div>
                `;
            }).join('');
            
        }
    } catch (error) {
        // Если API недоступен, показываем сообщение
        directionsList.innerHTML = `
            <div style="text-align: center; padding: 40px; opacity: 0.7; grid-column: 1/-1;">
                Направления временно недоступны. Пожалуйста, свяжитесь с нами по телефону.
            </div>
        `;
    }
}

// ==================== LOAD TEACHERS FROM API ====================
async function loadTeachers() {
    const teamGrid = document.getElementById('teamGrid');
    if (!teamGrid) return;

    // Очистка кэша для Safari iOS
    if (navigator.userAgent.indexOf('Safari') !== -1 && navigator.userAgent.indexOf('Chrome') === -1) {
        if ('caches' in window) {
            try {
                const cacheNames = await caches.keys();
                await Promise.all(cacheNames.map(name => caches.delete(name)));
                console.log('📱 Safari iOS: Cache cleared');
            } catch (error) {
                console.log('📱 Safari iOS: Cache clear failed', error);
            }
        }
        
        // Принудительная очистка кэша изображений Safari
        if ('serviceWorker' in navigator) {
            try {
                const registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations.map(registration => registration.unregister()));
                console.log('📱 Safari iOS: Service Workers cleared');
            } catch (error) {
                console.log('📱 Safari iOS: Service Worker clear failed', error);
            }
        }
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/students/teachers/public`);
        const data = await response.json();
        
        if (data.success && data.teachers.length > 0) {
            const teachersHTML = data.teachers.map(teacher => {
                const directions = teacher.teacherInfo?.directions || [];
                const bio = teacher.teacherInfo?.bio || 'Профессиональный преподаватель танцев';
                const photo = teacher.teacherInfo?.photo || '';
                
                // Отладочная информация для мобильных устройств
                // if (photo) {
                //     console.log(`📱 Loading teacher photo: ${photo}`);
                // }
                
                // Создаем абсолютный URL для HTTPS с кэш-бастером для Safari iOS
                const fullPhotoUrl = photo ? (photo.startsWith('http') ? photo : `${window.location.origin}${photo}`) + `?t=${Date.now()}` : '';
                
                
                return `
                    <div class="team-member">
                        <div class="member-photo" ${fullPhotoUrl ? `style="background-image: url('${fullPhotoUrl}')"` : ''}>
                            <div class="photo-overlay"></div>
                        </div>
                        <div class="member-info">
                            <h3 class="member-name">${teacher.name.toUpperCase()}</h3>
                            <p class="member-role">${directions.join(' • ') || 'Преподаватель'}</p>
                            <p class="member-bio">${bio}</p>
                        </div>
                    </div>
                `;
            }).join('');
            
            // Вставляем HTML
            teamGrid.innerHTML = teachersHTML;
            
            // Принудительная проверка DOM для Safari iOS
            if (navigator.userAgent.indexOf('Safari') !== -1 && navigator.userAgent.indexOf('Chrome') === -1) {
                setTimeout(() => {
                    const images = teamGrid.querySelectorAll('img');
                    console.log(`📱 Safari iOS: Found ${images.length} images in DOM`);
                    
                    images.forEach((img, index) => {
                        console.log(`📱 Image ${index + 1}:`, {
                            src: img.src,
                            complete: img.complete,
                            naturalWidth: img.naturalWidth,
                            naturalHeight: img.naturalHeight,
                            offsetWidth: img.offsetWidth,
                            offsetHeight: img.offsetHeight
                        });
                        
                        // Принудительное обновление для Safari iOS
                        if (img.complete && img.naturalWidth === 0) {
                            console.log(`📱 Safari iOS: Image ${index + 1} failed, retrying...`);
                            const originalSrc = img.src;
                            img.src = '';
                            setTimeout(() => {
                                img.src = originalSrc;
                            }, 100);
                        }
                    });
                }, 1000);
            }
            
        } else {
            // Если преподавателей нет, показываем сообщение
            teamGrid.innerHTML = `
                <div style="text-align: center; padding: 40px; opacity: 0.7; grid-column: 1/-1;">
                    Информация о преподавателях скоро появится
                </div>
            `;
        }
    } catch (error) {
        console.error('❌ Error loading teachers:', error);
        teamGrid.innerHTML = `
            <div style="text-align: center; padding: 40px; opacity: 0.7; grid-column: 1/-1;">
                Информация о команде временно недоступна
            </div>
        `;
    }
}

// Загрузка расписания из backend
async function loadSchedule() {
    const scheduleGrid = document.getElementById('scheduleGrid');
    if (!scheduleGrid) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/groups/schedule/weekly`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success && data.schedule) {
            const dayNames = {
                1: 'ПН',
                2: 'ВТ',
                3: 'СР',
                4: 'ЧТ',
                5: 'ПТ',
                6: 'СБ',
                7: 'ВС'
            };
            
            let html = '';
            
            for (let day = 1; day <= 7; day++) {
                const classes = data.schedule[day] || [];
                
                // Группируем практики по времени и первому слову
                const groupedClasses = [];
                const processedIndices = new Set();
                
                for (let i = 0; i < classes.length; i++) {
                    if (processedIndices.has(i)) continue;
                    
                    const cls = classes[i];
                    
                    // Если это НЕ практика, добавляем как есть
                    if (!cls.isPractice) {
                        groupedClasses.push(cls);
                        processedIndices.add(i);
                        continue;
                    }
                    
                    // Для практик: проверяем есть ли еще практики в это же время с тем же началом
                    const firstWord = (cls.groupName || '').split(' ')[0];
                    const sameTimePractices = [cls];
                    
                    for (let j = i + 1; j < classes.length; j++) {
                        if (processedIndices.has(j)) continue;
                        
                        const otherCls = classes[j];
                        if (otherCls.isPractice && 
                            otherCls.time === cls.time && 
                            (otherCls.groupName || '').startsWith(firstWord)) {
                            sameTimePractices.push(otherCls);
                            processedIndices.add(j);
                        }
                    }
                    
                    // Создаем объединенную практику
                    if (sameTimePractices.length > 1) {
                        groupedClasses.push({
                            time: cls.time,
                            isPractice: true,
                            groupName: `${firstWord}: ${sameTimePractices.map(p => (p.groupName || '').replace(firstWord, '').trim()).filter(n => n).join(', ')}`
                        });
                    } else {
                        groupedClasses.push(cls);
                    }
                    
                    processedIndices.add(i);
                }
                
                html += `
                    <div class="schedule-day-block">
                        <div class="day-title">${dayNames[day]}</div>
                        <div class="day-classes">
                            ${groupedClasses.length > 0 ? groupedClasses.map(cls => `
                                <div class="class-time-block${cls.isPractice ? ' practice-class' : ''}">
                                    <span class="time">${cls.time}</span>
                                    <span class="class">${cls.isPractice ? `Практика ${cls.groupName || ''}` : (cls.groupName || 'Занятие')}</span>
                                </div>
                            `).join('') : '<div class="no-classes">Нет занятий</div>'}
                        </div>
                    </div>
                `;
            }
            
            scheduleGrid.innerHTML = html;
        } else {
            scheduleGrid.innerHTML = '<div style="text-align: center; padding: 40px; opacity: 0.7;">Расписание временно недоступно</div>';
        }
    } catch (error) {
        console.error('Load schedule error:', error);
        if (scheduleGrid) {
            scheduleGrid.innerHTML = '<div style="text-align: center; padding: 40px; opacity: 0.7;">Ошибка загрузки расписания</div>';
        }
    }
}

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    try {
        // Загружаем направления и преподавателей
        loadDirections().catch(err => console.error('loadDirections failed:', err));
        loadTeachers().catch(err => console.error('loadTeachers failed:', err));
        loadSchedule().catch(err => console.error('loadSchedule failed:', err));
        
        // Добавляем класс loaded к body после загрузки
        setTimeout(() => {
            document.body.classList.add('loaded');
        }, 100);
    } catch (error) {
        console.error('DOMContentLoaded error:', error);
    }
});

// ==================== PERFORMANCE OPTIMIZATION ====================
// Debounce функция для оптимизации событий
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Оптимизация scroll событий
const optimizedScroll = debounce(() => {
    // Здесь можно добавить дополнительные функции при скролле
}, 10);

window.addEventListener('scroll', optimizedScroll);

// ==================== ACCESSIBILITY ====================
// Поддержка навигации с клавиатуры
document.addEventListener('keydown', (e) => {
    // ESC закрывает меню
    if (e.key === 'Escape' && fullscreenMenu && menuToggle && fullscreenMenu.classList.contains('active')) {
        menuToggle.click();
    }
});

// Добавляем focus стили для клавиатурной навигации
document.querySelectorAll('a, button, input, select').forEach(element => {
    element.addEventListener('focus', () => {
        element.style.outline = '2px solid var(--pink)';
        element.style.outlineOffset = '4px';
    });
    
    element.addEventListener('blur', () => {
        element.style.outline = 'none';
    });
});
