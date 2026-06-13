// =====================================================
// THEME MODULE - Управление темой (светлая/темная)
// =====================================================

function initTheme() {
    const savedTheme = localStorage.getItem('adminTheme') || 'dark';
    const html = document.documentElement;
    const themeToggle = document.getElementById('themeToggle');
    const themeText = themeToggle?.querySelector('.theme-text');
    const sunIcon = themeToggle?.querySelector('.theme-icon-sun');
    const moonIcon = themeToggle?.querySelector('.theme-icon-moon');
    
    function applyTheme(theme) {
        if (theme === 'light') {
            html.setAttribute('data-theme', 'light');
            if (themeText) themeText.textContent = 'ТЕМНАЯ';
            if (sunIcon) sunIcon.style.display = 'none';
            if (moonIcon) moonIcon.style.display = 'block';
        } else {
            html.removeAttribute('data-theme');
            if (themeText) themeText.textContent = 'СВЕТЛАЯ';
            if (sunIcon) sunIcon.style.display = 'block';
            if (moonIcon) moonIcon.style.display = 'none';
        }
        localStorage.setItem('adminTheme', theme);
    }
    
    // Применить сохраненную тему
    applyTheme(savedTheme);
    
    // Обработчик переключения
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const currentTheme = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
            applyTheme(currentTheme);
        });
    }
}

