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
            sections.forEach(s => {
                s.classList.add('hidden');
                s.style.display = '';
            });
            
            const targetSection = document.getElementById(`section-${sectionId}`);
            if (targetSection) {
                targetSection.classList.remove('hidden');
                targetSection.style.display = '';
            } else {
                console.error(`  ⚠️  Секция не найдена: section-${sectionId}`);
            }
            
            // Обновляем заголовок
            pageTitle.textContent = link.querySelector('span').textContent;
            
            // Загружаем данные для секции
            loadSectionData(sectionId);
        });
    });

    // Logout
    document.getElementById('adminLogout')?.addEventListener('click', async () => {
        if (await customConfirm('Выйти из админ-панели?')) {
            localStorage.clear();
            window.location.href = '/login.html';
        }
    });
}
