// =====================================================
// THEME MODULE - Управление темой (светлая/темная)
// =====================================================

function initTheme() {
    const html = document.documentElement;
    const themeToggle = document.getElementById('themeToggle');
    const themeText = themeToggle?.querySelector('.theme-text');
    const sunIcon = themeToggle?.querySelector('.theme-icon-sun');
    const moonIcon = themeToggle?.querySelector('.theme-icon-moon');
    
    const validThemes = new Set(['dark', 'light']);
    const storedTheme = localStorage.getItem('adminTheme');
    const preferredTheme = window.matchMedia?.('(prefers-color-scheme: light)')?.matches ? 'light' : 'dark';
    const initialTheme = validThemes.has(storedTheme) ? storedTheme : preferredTheme;

    function applyTheme(theme, persist = true) {
        const nextTheme = validThemes.has(theme) ? theme : 'dark';
        const isLight = nextTheme === 'light';
        html.setAttribute('data-theme', nextTheme);
        html.style.colorScheme = nextTheme;
        if (themeText) themeText.textContent = isLight ? 'ТЕМНАЯ' : 'СВЕТЛАЯ';
        if (themeToggle) {
            themeToggle.setAttribute('aria-pressed', String(isLight));
            themeToggle.setAttribute('aria-label', `Переключить ${isLight ? 'темную' : 'светлую'} тему`);
            themeToggle.title = `Переключить ${isLight ? 'темную' : 'светлую'} тему`;
            themeToggle.dataset.theme = nextTheme;
        }
        if (sunIcon) sunIcon.style.display = isLight ? 'none' : 'block';
        if (moonIcon) moonIcon.style.display = isLight ? 'block' : 'none';
        if (persist) localStorage.setItem('adminTheme', nextTheme);
        window.dispatchEvent(new CustomEvent('adminthemechange', { detail: { theme: nextTheme } }));
    }
    
    // Применить сохраненную тему
    applyTheme(initialTheme);
    
    // Обработчик переключения
    if (themeToggle && themeToggle.dataset.bound !== 'true') {
        themeToggle.dataset.bound = 'true';
        themeToggle.addEventListener('click', () => {
            const currentTheme = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
            applyTheme(currentTheme);
        });
    }

    window.setAdminTheme = applyTheme;
}
