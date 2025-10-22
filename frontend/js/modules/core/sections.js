// =====================================================
// SECTIONS MODULE - Управление загрузкой разделов
// =====================================================

// Кэш загруженных разделов для оптимизации
const loadedSections = new Set(['dashboard']); // Дашборд уже загружен при инициализации

// Загрузка данных для раздела с кэшированием
async function loadSectionData(sectionId, forceReload = false) {
    // ⚡ ОПТИМИЗАЦИЯ: Если вкладка уже загружена и не требуется принудительное обновление, пропускаем
    if (loadedSections.has(sectionId) && !forceReload) {
        console.log(`⚡ Секция "${sectionId}" уже загружена (используем кэш)`);
        return;
    }
    
    console.log(`📂 Загрузка секции: "${sectionId}"`);
    
    try {
        switch(sectionId) {
            case 'dashboard':
                await renderDashboard();
                break;
        case 'bookings':
            // Загружаем с текущим фильтром
            await renderBookings(currentBookingFilter);
            break;
        case 'students':
            await renderStudents();
            break;
        case 'users':
            // Загружаем пользователей с текущим фильтром
            await renderUsers(currentRoleFilter);
            break;
        case 'groups':
            await renderGroups();
            break;
        case 'schedule':
            // Загружаем залы если еще не загружены
            if (allRooms.length === 0) {
                await loadRooms();
            }
            // Инициализируем календарь при первом открытии
            if (!calendar) {
                initCalendar();
            } else {
                calendar.refetchEvents();
            }
            // Обновляем badge неотмеченных посещаемостей
            updatePendingAttendanceBadge();
            // Инициализируем кнопку управления залами
            if (typeof initRoomButton === 'function') {
                initRoomButton();
            }
            if (typeof initRoomHandlers === 'function') {
                initRoomHandlers();
            }
            // Инициализируем кнопку генерации расписания
            if (typeof initGenerateScheduleButton === 'function') {
                initGenerateScheduleButton();
            }
            break;
        case 'directions':
            await renderDirections();
            break;
        case 'payments':
            await renderPayments();
            break;
        case 'cashbox':
            console.log('🔍 Checking renderCashbox function:', typeof renderCashbox);
            console.log('🔍 Checking window.testCashbox:', typeof window.testCashbox);
            console.log('🔍 All window functions:', Object.keys(window).filter(k => k.includes('cashbox') || k.includes('Cashbox')));
            
            if (typeof renderCashbox === 'function') {
                console.log('✅ renderCashbox found, calling...');
                await renderCashbox();
            } else {
                console.error('❌ renderCashbox is not defined!');
                console.error('❌ window.testCashbox:', typeof window.testCashbox);
                console.error('❌ Cashbox module not loaded properly');
                
                // Попробуем загрузить модуль принудительно
                try {
                    console.log('🔄 Attempting to load cashbox module...');
                    const script = document.createElement('script');
                    script.src = '/js/modules/cashbox/cashbox.js?v=116&t=' + Date.now();
                    script.onload = () => {
                        console.log('✅ Cashbox module loaded, trying renderCashbox...');
                        if (typeof renderCashbox === 'function') {
                            renderCashbox();
                        }
                    };
                    script.onerror = () => {
                        console.error('❌ Failed to load cashbox module');
                    };
                    document.head.appendChild(script);
                } catch (error) {
                    console.error('❌ Error loading cashbox module:', error);
                }
            }
            
            // Устанавливаем текущий месяц для зарплаты (если элемент существует)
            try {
                const salaryMonthEl = document.getElementById('salaryMonth');
                if (salaryMonthEl) {
                    const now = new Date();
                    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                    salaryMonthEl.value = currentMonth;
                }
            } catch (error) {
                console.log('⚠️ Salary month element not found, skipping...');
            }
            break;
        case 'blog':
            await renderBlogPosts();
            break;
        case 'roles':
            await loadRolesData();
            break;
        }
        
        // Помечаем вкладку как загруженную
        loadedSections.add(sectionId);
        console.log(`✅ Секция "${sectionId}" успешно загружена`);
    } catch (error) {
        console.error(`❌ Ошибка загрузки секции "${sectionId}":`, error);
        console.error('Stack:', error.stack);
    }
}

// Функция для принудительного обновления данных вкладки
function refreshCurrentSection() {
    const activeLink = document.querySelector('.sidebar-link.active');
    if (activeLink) {
        const sectionId = activeLink.dataset.section;
        loadedSections.delete(sectionId); // Удаляем из кэша
        loadSectionData(sectionId, true); // Загружаем заново
    }
}

// Функция для сброса кэша определенных вкладок
function invalidateCache(...sectionIds) {
    sectionIds.forEach(id => loadedSections.delete(id));
}


