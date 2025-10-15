// ==================== CUSTOM CURSOR ====================
const cursor = document.querySelector('.cursor');
const cursorFollower = document.querySelector('.cursor-follower');

let cursorX = 0;
let cursorY = 0;
let followerX = 0;
let followerY = 0;

document.addEventListener('mousemove', (e) => {
    cursorX = e.clientX;
    cursorY = e.clientY;
});

function animateCursor() {
    // Main cursor - instant
    cursor.style.transform = `translate(${cursorX - 5}px, ${cursorY - 5}px)`;
    
    // Follower - smooth delay
    followerX += (cursorX - followerX) * 0.1;
    followerY += (cursorY - followerY) * 0.1;
    cursorFollower.style.transform = `translate(${followerX - 20}px, ${followerY - 20}px)`;
    
    requestAnimationFrame(animateCursor);
}

animateCursor();

// Hover effect on links/buttons
const hoverElements = document.querySelectorAll('a, button, .blog-card');
hoverElements.forEach(el => {
    el.addEventListener('mouseenter', () => {
        cursor.style.transform = `translate(${cursorX - 5}px, ${cursorY - 5}px) scale(2)`;
        cursorFollower.style.transform = `translate(${followerX - 20}px, ${followerY - 20}px) scale(1.5)`;
    });
    
    el.addEventListener('mouseleave', () => {
        cursor.style.transform = `translate(${cursorX - 5}px, ${cursorY - 5}px) scale(1)`;
        cursorFollower.style.transform = `translate(${followerX - 20}px, ${followerY - 20}px) scale(1)`;
    });
});

// ==================== LOAD BLOG POSTS FROM API ====================
const API_URL = window.API_URL || 'http://localhost:5000/api';
let allBlogPosts = [];
let currentCategory = 'all';

async function loadBlogPosts() {
    try {
        const response = await fetch(`${API_URL}/blog?status=published&limit=100`);
        const data = await response.json();
        
        if (data.success && data.posts) {
            allBlogPosts = data.posts;
            renderBlogGrid(allBlogPosts);
        } else {
            // Если API не доступен, показываем сообщение
            document.getElementById('blogGrid').innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 80px 20px;">
                    <p style="opacity: 0.5;">Статьи скоро появятся...</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Load blog posts error:', error);
        // Показываем сообщение об ошибке
        document.getElementById('blogGrid').innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 80px 20px;">
                <p style="opacity: 0.5;">Ошибка загрузки статей</p>
            </div>
        `;
    }
}

function renderBlogGrid(posts) {
    const grid = document.getElementById('blogGrid');
    
    if (!posts || posts.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 80px 20px;">
                <p style="opacity: 0.5;">Статей пока нет</p>
            </div>
        `;
        return;
    }
    
    const categoryNames = {
        'news': 'НОВОСТИ',
        'tips': 'СОВЕТЫ',
        'stories': 'ИСТОРИИ',
        'events': 'МЕРОПРИЯТИЯ'
    };
    
    grid.innerHTML = posts.map((post, index) => `
        <article class="blog-card ${index === 0 ? 'featured' : ''}" data-category="${post.category}">
            <div class="blog-card-image" ${post.image ? `style="background-image: url('${post.image}'); background-size: cover; background-position: center;"` : ''}>
                <div class="blog-card-overlay"></div>
                <div class="blog-category">${categoryNames[post.category] || post.category.toUpperCase()}</div>
                <div class="blog-number">${String(index + 1).padStart(2, '0')}</div>
            </div>
            <div class="blog-card-content">
                <div class="blog-date">${new Date(post.publishedAt).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
                <h3 class="blog-title">${post.title}</h3>
                <p class="blog-excerpt">${post.excerpt}</p>
                <a href="blog/${post.slug}.html" class="blog-read-more">
                    <span>ЧИТАТЬ</span>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                </a>
            </div>
        </article>
    `).join('');
    
    // Переинициализируем hover эффекты для новых карточек
    const newCards = document.querySelectorAll('.blog-card');
    newCards.forEach(card => {
        card.addEventListener('mouseenter', () => {
            cursor.style.transform = `translate(${cursorX - 5}px, ${cursorY - 5}px) scale(2)`;
            cursorFollower.style.transform = `translate(${followerX - 20}px, ${followerY - 20}px) scale(1.5)`;
        });
        
        card.addEventListener('mouseleave', () => {
            cursor.style.transform = `translate(${cursorX - 5}px, ${cursorY - 5}px) scale(1)`;
            cursorFollower.style.transform = `translate(${followerX - 20}px, ${followerY - 20}px) scale(1)`;
        });
    });
}

// Загрузить статьи при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    loadBlogPosts();
});

// ==================== FILTER FUNCTIONALITY ====================
const filterButtons = document.querySelectorAll('.filter-btn');

function filterByCategory(category) {
    currentCategory = category;
    
    // Обновить активную кнопку
    filterButtons.forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    // Фильтровать статьи
    let filtered = allBlogPosts;
    if (category !== 'all') {
        filtered = allBlogPosts.filter(post => post.category === category);
    }
    
    renderBlogGrid(filtered);
}

filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const category = btn.dataset.category;
        filterByCategory(category);
    });
});

// ==================== NEWSLETTER FORM ====================
const newsletterForm = document.getElementById('newsletterForm');

if (newsletterForm) {
    newsletterForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = e.target.querySelector('input[type="email"]').value;
        
        // Здесь можно добавить отправку на backend
        alert(`Спасибо за подписку! Мы отправим новости на ${email}`);
        e.target.reset();
    });
}

// ==================== SCROLL ANIMATIONS ====================
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, observerOptions);

// Observe elements with fade-in effect
document.querySelectorAll('.blog-card').forEach(card => {
    observer.observe(card);
});

// ==================== SMOOTH SCROLL ====================
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
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

console.log('✨ SENSE OF DANCE BLOG');
console.log('Blog page loaded successfully');

