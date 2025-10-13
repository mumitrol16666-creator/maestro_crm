// =====================================================
// NAVIGATION MODULE - Управление навигацией
// =====================================================

// Инициализация навигации по вкладкам
function initNavigation() {
    const sidebarLinks = document.querySelectorAll('.sidebar-link[data-section]');
    const sections = document.querySelectorAll('.admin-section');
    const pageTitle = document.querySelector('.admin-page-title');

    sidebarLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const sectionId = link.dataset.section;
            
            // Обновляем активную ссылку
            sidebarLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            // Показываем нужную секцию
            sections.forEach(s => s.classList.add('hidden'));
            document.getElementById(`section-${sectionId}`).classList.remove('hidden');
            
            // Обновляем заголовок
            pageTitle.textContent = link.querySelector('span').textContent;
            
            // Загружаем данные для секции
            loadSectionData(sectionId);
        });
    });

    // Sidebar Toggle (мобильные)
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('adminSidebar');

    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
    }

    // Logout
    document.getElementById('adminLogout')?.addEventListener('click', async () => {
        if (await customConfirm('Выйти из админ-панели?')) {
            localStorage.clear();
            window.location.href = 'login.html';
        }
    });
}

console.log('✅ Navigation модуль загружен');

