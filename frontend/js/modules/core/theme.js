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
    const logo = document.querySelector('.sidebar-logo');
    
    function applyTheme(theme) {
        if (theme === 'light') {
            html.setAttribute('data-theme', 'light');
            if (themeText) themeText.textContent = 'ТЕМНАЯ';
            if (sunIcon) sunIcon.style.display = 'none';
            if (moonIcon) moonIcon.style.display = 'block';
            if (logo) logo.src = '../assets/images/logo-dark.PNG';
        } else {
            html.removeAttribute('data-theme');
            if (themeText) themeText.textContent = 'СВЕТЛАЯ';
            if (sunIcon) sunIcon.style.display = 'block';
            if (moonIcon) moonIcon.style.display = 'none';
            if (logo) logo.src = '../assets/images/logo-splash.PNG';
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


