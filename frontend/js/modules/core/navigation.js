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
            
            console.log(`🔀 Переключение на секцию: "${sectionId}"`);
            
            // Обновляем активную ссылку
            sidebarLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            // Показываем нужную секцию
            sections.forEach(s => {
                s.classList.add('hidden');
                // 🔥 КРИТИЧНО: Убираем inline style.display, чтобы работал класс hidden
                s.style.display = '';
                console.log(`  ❌ Скрыта секция: ${s.id}`);
            });
            
            const targetSection = document.getElementById(`section-${sectionId}`);
            if (targetSection) {
                targetSection.classList.remove('hidden');
                // 🔥 КРИТИЧНО: Убираем inline style.display, чтобы секция показалась
                targetSection.style.display = '';
                console.log(`  ✅ Показана секция: section-${sectionId}`);
            } else {
                console.error(`  ⚠️  Секция не найдена: section-${sectionId}`);
            }
            
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
            window.location.href = '/login';
        }
    });
    
    // 🔍 DEBUG: Наблюдатель за dashboard секцией
    const dashboardSection = document.getElementById('section-dashboard');
    if (dashboardSection) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const hasHidden = dashboardSection.classList.contains('hidden');
                    console.log(`🔍 Dashboard visibility changed: ${hasHidden ? '❌ СКРЫТ' : '✅ ВИДЕН'}`);
                    if (hasHidden) {
                        console.trace('Stack trace кто скрыл dashboard:');
                    }
                }
            });
        });
        
        observer.observe(dashboardSection, {
            attributes: true,
            attributeFilter: ['class']
        });
        
        // Dashboard observer установлен
    }
}


