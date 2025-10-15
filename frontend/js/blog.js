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

// ==================== FILTER FUNCTIONALITY ====================
const filterButtons = document.querySelectorAll('.filter-btn');
const blogCards = document.querySelectorAll('.blog-card');

filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const category = btn.dataset.category;
        
        // Update active button
        filterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Filter cards
        blogCards.forEach((card, index) => {
            const cardCategory = card.dataset.category;
            
            if (category === 'all' || cardCategory === category) {
                card.style.display = 'block';
                card.style.animation = 'none';
                setTimeout(() => {
                    card.style.animation = `fadeInUp 0.6s ease-out backwards ${index * 0.1}s`;
                }, 10);
            } else {
                card.style.display = 'none';
            }
        });
    });
});

// ==================== BLOG POST MODAL ====================
function openBlogPost(event, card) {
    event.preventDefault();
    
    const title = card.dataset.title;
    const date = card.dataset.date;
    const category = card.dataset.cat;
    const content = card.dataset.content;
    
    // Заполняем модальное окно
    document.getElementById('modalCategory').textContent = category;
    document.getElementById('modalDate').textContent = date;
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = content;
    
    // Показываем модальное окно
    document.getElementById('blogModal').classList.add('show');
    document.body.style.overflow = 'hidden';
}

function closeBlogPost() {
    document.getElementById('blogModal').classList.remove('show');
    document.body.style.overflow = 'auto';
}

// Закрытие по ESC
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeBlogPost();
    }
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

