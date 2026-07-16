// =====================================================
// NAVIGATION MODULE - Управление навигацией
// =====================================================

// Инициализация навигации по вкладкам
function initNavigation() {
    const sidebarLinks = document.querySelectorAll('.sidebar-link[data-section]');
    const sections = document.querySelectorAll('.admin-section');
    const pageTitle = document.querySelector('.admin-page-title');

    const activateSection = (sectionId, updateHash = true) => {
        const link = document.querySelector(`.sidebar-link[data-section="${sectionId}"]`);
        const targetSection = document.getElementById(`section-${sectionId}`);
        if (!link || !targetSection) return false;

        sidebarLinks.forEach(item => item.classList.remove('active'));
        link.classList.add('active');
        sections.forEach(section => {
            section.classList.add('hidden');
            section.style.display = '';
        });
        targetSection.classList.remove('hidden');
        targetSection.style.display = '';
        if (pageTitle) pageTitle.textContent = link.querySelector('span')?.textContent || 'Расписание';
        if (updateHash) history.replaceState(null, '', `#${sectionId}`);
        loadSectionData(sectionId);
        window.dispatchEvent(new CustomEvent('admin:section-shown', {
            detail: { sectionId, section: targetSection }
        }));
        return true;
    };

    sidebarLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            activateSection(link.dataset.section);
        });
    });

    const requestedSection = window.location.hash.replace('#', '') || 'schedule';
    if (!activateSection(requestedSection, false)) activateSection('schedule', false);
    window.showSection = (sectionId) => activateSection(sectionId);

    // Logout
    document.getElementById('adminLogout')?.addEventListener('click', async () => {
        if (await customConfirm('Выйти из админ-панели?')) {
            localStorage.clear();
            window.location.href = '/login.html';
        }
    });
}
