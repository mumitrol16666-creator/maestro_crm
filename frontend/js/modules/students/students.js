// =====================================================
// STUDENTS MODULE - Управление учениками
// =====================================================

// Переменная для хранения всех учеников и их статистики
let allStudentsData = [];
let currentStudentFilter = 'all';
let currentViewingStudentId = null;
let currentStudentPage = 1;
let currentStudentSearch = '';

// Отобразить учеников
async function renderStudents(searchQuery = '', page = 1) {
    const table = document.getElementById('studentsTable');
    table.innerHTML = '<tr><td colspan="6" style="text-align:center;">Загрузка...</td></tr>';
    
    currentStudentSearch = searchQuery;
    currentStudentPage = page;
    
    // ⚡ Загружаем с пагинацией
    const response = await fetch(`${API_URL}/students?role=student&search=${searchQuery}&page=${page}&limit=20`, {
        headers: { 'Authorization': `Bearer ${getAuthToken()}` }
    });
    
    const data = await response.json();
    const students = data.students || [];
    
    if (students.length === 0) {
        table.innerHTML = '<tr><td colspan="6" style="text-align:center; opacity:0.5;">Нет учеников</td></tr>';
        renderStudentsPagination(0, page, 0);
        return;
    }
    
    // ⚡ Показываем учеников сразу
    renderStudentsTable(students, {});
    
    // ⚡ Рендерим пагинацию
    renderStudentsPagination(data.total, page, data.pages);
    
    // Загружаем статистику в фоне
    try {
        const studentIds = students.map(s => s._id);
        const statsResponse = await fetch(`${API_URL}/students/stats/batch-light`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ studentIds })
        });
        
        if (statsResponse.ok) {
            const statsData = await statsResponse.json();
            const statsMap = statsData.stats || {};
            // Обновляем таблицу со статистикой
            renderStudentsTable(students, statsMap);
        }
    } catch (error) {
    }
}

// Рендер пагинации для учеников
function renderStudentsPagination(total, currentPage, totalPages) {
    const container = document.getElementById('studentsPagination');
    if (!container) return;
    
    if (!totalPages || totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    
    const buttons = [];
    
    // Кнопка "Назад"
    if (currentPage > 1) {
        buttons.push(`<button class="pagination-btn" data-page="${currentPage - 1}">‹ Назад</button>`);
    }
    
    // Номера страниц
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
            const active = i === currentPage ? 'active' : '';
            buttons.push(`<button class="pagination-btn ${active}" data-page="${i}">${i}</button>`);
        } else if (i === currentPage - 3 || i === currentPage + 3) {
            buttons.push(`<span style="padding: 5px 10px; opacity: 0.5;">...</span>`);
        }
    }
    
    // Кнопка "Вперед"
    if (currentPage < totalPages) {
        buttons.push(`<button class="pagination-btn" data-page="${currentPage + 1}">Вперед ›</button>`);
    }
    
    container.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; justify-content: center; padding: 20px 0; flex-wrap: wrap;">
            ${buttons.join('')}
            <span style="margin-left: 15px; opacity: 0.7; font-size: 0.9rem;">
                Всего: ${total} | Страница ${currentPage} из ${totalPages}
            </span>
        </div>
    `;
    
    // Добавляем обработчики событий
    container.querySelectorAll('.pagination-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const page = parseInt(btn.dataset.page);
            renderStudents(currentStudentSearch, page);
        });
    });
}

// Вспомогательная функция для отрисовки таблицы учеников
function renderStudentsTable(students, statsMap) {
    const table = document.getElementById('studentsTable');
    
    // Присоединить статистику к ученикам
    const studentsWithStats = students.map(student => ({
        ...student,
        stats: statsMap[student._id] || {
            monthMissed: 0
        }
    }));
    
    // Сохранить для фильтрации
    allStudentsData = studentsWithStats;
    
    // Применить фильтр
    const filteredStudents = applyStudentFilter(studentsWithStats, currentStudentFilter);
    
    if (filteredStudents.length === 0) {
        table.innerHTML = '<tr><td colspan="6" style="text-align:center; opacity:0.5;">Нет учеников по данному фильтру</td></tr>';
        return;
    }
    
    table.innerHTML = filteredStudents.map(student => {
        const groupNames = student.groups
            .filter(g => g.status === 'active')
            .map(g => g.groupId?.name || 'Группа')
            .join(', ') || 'Нет групп';
        
        const membership = student.activeMembership;
        const membershipText = membership 
            ? `${membership.classesRemaining} ${getDeclension(membership.classesRemaining, 'занятие', 'занятия', 'занятий')}`
            : 'Нет абонемента';
        
        const membershipClass = getMembershipClass(membership);
        
        // Статистика
        const stats = student.stats || {};
        const monthMissed = stats.monthMissed || 0;
        
        return `
            <tr data-student-id="${student._id}" data-absences="${monthMissed}">
                <td>${student.name} ${student.lastName || ''}</td>
                <td>${student.phone}</td>
                <td>${groupNames}</td>
                <td><span class="membership-badge ${membershipClass}">${membershipText}</span></td>
                <td><span style="color: ${monthMissed >= 3 ? '#ef4444' : monthMissed >= 1 ? '#f59e0b' : '#64748b'}; font-weight: 600;">${monthMissed}</span></td>
                <td class="table-actions">
                    <button class="table-btn" onclick="viewStudent('${student._id}')">Профиль</button>
                </td>
            </tr>
        `;
    }).join('');
}

// Форматировать дату последнего визита
function formatLastVisit(date) {
    if (!date) return '<span style="color: #ef4444;">Никогда</span>';
    
    const days = getDaysSinceLastVisit(date);
    
    if (days === 0) return '<span style="color: #10b981;">Сегодня</span>';
    if (days === 1) return 'Вчера';
    if (days < 7) return `${days} ${getDeclension(days, 'день', 'дня', 'дней')} назад`;
    if (days < 14) return '<span style="color: #f59e0b;">Неделю назад</span>';
    if (days < 30) return '<span style="color: #ef4444;">' + Math.floor(days / 7) + ' ' + getDeclension(Math.floor(days / 7), 'неделю', 'недели', 'недель') + ' назад</span>';
    return '<span style="color: #ef4444;">Более месяца назад</span>';
}

// Получить количество дней с последнего визита
function getDaysSinceLastVisit(date) {
    if (!date) return 999;
    const lastDate = new Date(date);
    const today = new Date();
    const diffTime = today - lastDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
}

// Применить фильтр учеников
function applyStudentFilter(students, filter) {
    switch(filter) {
        case 'with-absences':
            return students.filter(s => (s.stats?.monthMissed || 0) > 0);
        case 'inactive':
            // Неактивные = без абонемента или истек
            return students.filter(s => {
                const membership = s.activeMembership;
                return !membership || membership.classesRemaining === 0;
            });
        case 'ending-soon':
            // Заканчивается абонемент = осталось 1-2 занятия
            return students.filter(s => {
                const membership = s.activeMembership;
                return membership && membership.classesRemaining > 0 && membership.classesRemaining <= 2;
            });
        case 'all':
        default:
            return students;
    }
}

// Фильтровать учеников
function filterStudents(filter) {
    currentStudentFilter = filter;
    
    // Обновить активную кнопку
    document.querySelectorAll('[data-filter]').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.filter === filter) {
            btn.classList.add('active');
        }
    });
    
    // Применить фильтр
    const table = document.getElementById('studentsTable');
    const filteredStudents = applyStudentFilter(allStudentsData, filter);
    
    if (filteredStudents.length === 0) {
        table.innerHTML = '<tr><td colspan="6" style="text-align:center; opacity:0.5;">Нет учеников по данному фильтру</td></tr>';
        return;
    }
    
    table.innerHTML = filteredStudents.map(student => {
        const groupNames = student.groups
            .filter(g => g.status === 'active')
            .map(g => g.groupId?.name || 'Группа')
            .join(', ') || 'Нет групп';
        
        const membership = student.activeMembership;
        const membershipText = membership 
            ? `${membership.classesRemaining} ${getDeclension(membership.classesRemaining, 'занятие', 'занятия', 'занятий')}`
            : 'Нет абонемента';
        
        const membershipClass = getMembershipClass(membership);
        
        // Статистика
        const stats = student.stats || {};
        const monthMissed = stats.monthMissed || 0;
        
        return `
            <tr data-student-id="${student._id}" data-absences="${monthMissed}">
                <td>${student.name} ${student.lastName || ''}</td>
                <td>${student.phone}</td>
                <td>${groupNames}</td>
                <td><span class="membership-badge ${membershipClass}">${membershipText}</span></td>
                <td><span style="color: ${monthMissed >= 3 ? '#ef4444' : monthMissed >= 1 ? '#f59e0b' : '#64748b'}; font-weight: 600;">${monthMissed}</span></td>
                <td class="table-actions">
                    <button class="table-btn" onclick="viewStudent('${student._id}')">Профиль</button>
                </td>
            </tr>
        `;
    }).join('');
}

// Просмотр ученика
async function viewStudent(id) {
    try {
        currentViewingStudentId = id;
        const token = getAuthToken();
        
        // ⚡ МОМЕНТАЛЬНО показываем модалку с загрузкой
        document.getElementById('studentDetailModalTitle').textContent = 'Загрузка...';
        document.getElementById('studentBasicInfo').innerHTML = '<p style="text-align: center; padding: 30px; opacity: 0.5;">Загрузка данных...</p>';
        document.getElementById('studentStatsInfo').innerHTML = '<p style="text-align: center; padding: 30px; opacity: 0.5;">Загрузка статистики...</p>';
        document.getElementById('studentAttendanceHistory').innerHTML = '<p style="text-align: center; padding: 20px; opacity: 0.5;">Загрузка истории...</p>';
        
        // ОТКРЫВАЕМ МОДАЛКУ СРАЗУ!
        document.getElementById('studentDetailModal').classList.add('show');
        
        // ⚡ ПАРАЛЛЕЛЬНО загружаем ВСЕ данные В ФОНЕ (включая абонемент и платежи!)
        const [studentData, statsData, membershipData, paymentsData] = await Promise.all([
            fetch(`${API_URL}/students/${id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json()),
            fetch(`${API_URL}/students/${id}/stats`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json()),
            fetch(`${API_URL}/memberships/student/${id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json()),
            fetch(`${API_URL}/payments/student/${id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json()).catch(() => ({ success: false, payments: [] }))
        ]);
        
        const student = studentData.student;
        const stats = statsData.stats;
        
        // Обновляем заголовок
        document.getElementById('studentDetailModalTitle').textContent = student.name;
        
        // Основная информация
        const groups = student.groups
            .filter(g => g.status === 'active')
            .map(g => g.groupId?.name || 'Группа')
            .join(', ') || 'Нет групп';
        
        const membership = student.activeMembership;
        const membershipText = membership 
            ? `${membership.classesRemaining} ${getDeclension(membership.classesRemaining, 'занятие', 'занятия', 'занятий')}`
            : 'Нет абонемента';
        
        const membershipClass = getMembershipClass(membership);
        const genderText = student.gender === 'male' ? 'Мужской' : student.gender === 'female' ? 'Женский' : 'Не указан';
        
        document.getElementById('studentBasicInfo').innerHTML = `
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 15px; align-items: center;">
                <strong style="color: rgba(255,255,255,0.7);">Телефон:</strong>
                <span>${student.phone}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Email:</strong>
                <span>${student.email || 'Не указан'}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Пол:</strong>
                <span>${genderText}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Группы:</strong>
                <span>${groups}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Абонемент:</strong>
                <span class="membership-badge ${membershipClass}">${membershipText}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Регистрация:</strong>
                <span>${new Date(student.registeredAt).toLocaleDateString('ru')}</span>
            </div>
        `;
        
        // Статистика посещаемости
        const attendanceRate = stats.attendanceRate || 0;
        const totalClasses = stats.totalClasses || 0;
        const attendedCount = stats.attendedCount || 0;
        const missedCount = stats.missedCount || 0;
        const monthMissed = stats.monthMissed || 0;
        const lastAttendedDate = stats.lastAttendedDate;
        
        let attendanceColor = '#10b981';
        if (attendanceRate < 50) attendanceColor = '#ef4444';
        else if (attendanceRate < 75) attendanceColor = '#f59e0b';
        
        document.getElementById('studentStatsInfo').innerHTML = `
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 15px; align-items: center;">
                <strong style="color: rgba(255,255,255,0.7);">Процент посещаемости:</strong>
                <span style="color: ${attendanceColor}; font-weight: 600; font-size: 1.5em;">${attendanceRate}%</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Всего занятий:</strong>
                <span>${totalClasses}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Посещено:</strong>
                <span style="color: #10b981;">${attendedCount}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Пропущено:</strong>
                <span style="color: #ef4444;">${missedCount}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Пропусков в этом месяце:</strong>
                <span style="color: ${monthMissed > 2 ? '#ef4444' : '#64748b'}; font-weight: 600;">${monthMissed}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Последний визит:</strong>
                <span>${formatLastVisit(lastAttendedDate)}</span>
            </div>
        `;
        
        // История посещений
        const history = stats.recentHistory || [];
        
        if (history.length === 0) {
            document.getElementById('studentAttendanceHistory').innerHTML = `
                <p style="text-align: center; opacity: 0.5; padding: 20px;">Нет истории посещений</p>
            `;
        } else {
            document.getElementById('studentAttendanceHistory').innerHTML = history.map(item => {
                const date = new Date(item.date).toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: 'numeric' });
                const statusColor = item.attended ? '#10b981' : '#ef4444';
                const statusText = item.attended ? 'Присутствовал' : 'Отсутствовал';
                const statusIcon = item.attended 
                    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${statusColor}" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`
                    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${statusColor}" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
                
                return `
                    <div style="padding: 12px; border-left: 3px solid ${statusColor}; background: rgba(255,255,255,0.03); margin-bottom: 10px; border-radius: 4px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <strong style="color: ${statusColor}; display: flex; align-items: center; gap: 6px;">${statusIcon} ${statusText}</strong>
                            <span style="font-size: 0.9em; opacity: 0.7;">${date}</span>
                        </div>
                        <div style="font-size: 0.95em;">
                            <span style="opacity: 0.8;">${item.title}</span>
                        </div>
                        ${item.group ? `<div style="font-size: 0.85em; opacity: 0.6; margin-top: 3px;">Группа: ${item.group}</div>` : ''}
                    </div>
                `;
            }).join('');
        }
        
        // Обработать данные абонемента (уже загружены в Promise.all!)
        if (membershipData.success && membershipData.memberships && membershipData.memberships.length > 0) {
            const activeMembership = membershipData.memberships.find(m => m.status === 'active');
            
            if (activeMembership) {
                const typeNames = {
                    'trial': 'Пробный',
                    'monthly': 'Месячный',
                    'quarterly': 'Квартальный'
                };
                
                const startDate = new Date(activeMembership.startDate || activeMembership.createdAt).toLocaleDateString('ru');
                const classesUsed = activeMembership.classesUsed || 0;
                const freezesPerCycle = student.gender === 'female' ? 2 : 1;
                const currentCycleNumber = Math.floor(classesUsed / 8);
                const freezesUsedInPreviousCycles = currentCycleNumber * freezesPerCycle;
                const freezesUsedInCurrentCycle = Math.max(0, (activeMembership.freezesUsed || 0) - freezesUsedInPreviousCycles);
                const freezesText = `${Math.min(freezesUsedInCurrentCycle, freezesPerCycle)}/${freezesPerCycle}`;
                
                const userRole = getUserRole();
                const canAddClasses = userRole === 'super_admin' || userRole === 'admin';
                const classesRemaining = Number(activeMembership.classesRemaining);
                const classesColor = classesRemaining === 1 ? '#ef4444' : '#eb4d77';
                
                document.getElementById('studentMembershipInfo').innerHTML = `
                    <div style="display: grid; grid-template-columns: auto 1fr; gap: 15px; align-items: center;">
                        <strong style="color: rgba(255,255,255,0.7);">Тип:</strong>
                        <span>${typeNames[activeMembership.type]}</span>
                        
                        <strong style="color: rgba(255,255,255,0.7);">Занятий осталось:</strong>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="color: ${classesColor}; font-weight: ${classesRemaining === 1 ? '700' : '600'}; font-size: 1.3em;">${classesRemaining}</span>
                            ${canAddClasses ? `
                                <button 
                                    onclick="openAddClassesModal('${id}', '${activeMembership._id}')" 
                                    class="icon-btn"
                                    title="Добавить занятия"
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                        <line x1="12" y1="5" x2="12" y2="19"></line>
                                        <line x1="5" y1="12" x2="19" y2="12"></line>
                                    </svg>
                                </button>
                            ` : ''}
                        </div>
                        
                        <strong style="color: rgba(255,255,255,0.7);">Использовано:</strong>
                        <span>${activeMembership.classesUsed} из ${activeMembership.totalClasses}</span>
                        
                        <strong style="color: rgba(255,255,255,0.7);">Заморозок использовано:</strong>
                        <span>${freezesText}</span>
                        
                        <strong style="color: rgba(255,255,255,0.7);">Активирован:</strong>
                        <span>${startDate}</span>
                        
                        <strong style="color: rgba(255,255,255,0.7);">Статус:</strong>
                        <span style="color: #10b981;">${activeMembership.status === 'active' ? 'Активен' : 'Неактивен'}</span>
                    </div>
                `;
            } else {
                document.getElementById('studentMembershipInfo').innerHTML = `
                    <p style="text-align: center; opacity: 0.5; padding: 20px;">Нет активного абонемента</p>
                `;
            }
        } else {
            document.getElementById('studentMembershipInfo').innerHTML = `
                <p style="text-align: center; opacity: 0.5; padding: 20px;">Нет абонемента</p>
            `;
        }
        
        // 💰 Рендерим платежи студента
        if (paymentsData.success && paymentsData.payments && paymentsData.payments.length > 0) {
            const payments = paymentsData.payments;
            const summary = paymentsData.summary || {};
            
            const paymentsHTML = payments.slice(0, 5).map(payment => {
                const date = new Date(payment.paymentDate).toLocaleDateString('ru', { day: '2-digit', month: 'short' });
                const statusClass = payment.status === 'completed' ? 'status-completed' : 
                                   payment.status === 'pending' ? 'status-pending' : '';
                
                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        <div>
                            <div style="font-size: 0.9em; opacity: 0.7;">${date}</div>
                            <div style="font-size: 0.85em; margin-top: 3px;">${getPaymentTypeText(payment.type)}</div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-weight: 600; font-size: 1.1em;">${formatAmount(payment.amount)}</div>
                            <div style="font-size: 0.75em; margin-top: 3px;">
                                <span class="payment-status-badge ${statusClass}" style="padding: 2px 8px; font-size: 0.7em;">
                                    ${getPaymentStatusText(payment.status)}
                                </span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
            
            document.getElementById('studentPaymentsInfo').innerHTML = `
                ${paymentsHTML}
                <div style="margin-top: 15px; padding-top: 15px; border-top: 2px solid rgba(235,77,119,0.3); display: grid; grid-template-columns: auto 1fr; gap: 10px;">
                    <strong style="color: rgba(255,255,255,0.7);">Всего оплачено:</strong>
                    <span style="font-weight: 600; color: #10b981;">${formatAmount(summary.totalPaid || 0)}</span>
                    
                    ${summary.totalRemaining > 0 ? `
                        <strong style="color: rgba(255,255,255,0.7);">К оплате:</strong>
                        <span style="font-weight: 600; color: #f59e0b;">${formatAmount(summary.totalRemaining)}</span>
                    ` : ''}
                </div>
                ${payments.length > 5 ? `<p style="text-align: center; opacity: 0.5; margin-top: 10px; font-size: 0.85em;">Показаны последние 5 платежей</p>` : ''}
            `;
        } else {
            document.getElementById('studentPaymentsInfo').innerHTML = `
                <p style="text-align: center; opacity: 0.5; padding: 20px;">Нет платежей</p>
            `;
        }
    } catch (error) {
        toast.error('Ошибка загрузки информации об ученике');
    }
}

// Закрыть модальное окно детального просмотра ученика
function closeStudentDetailModal() {
    document.getElementById('studentDetailModal').classList.remove('show');
    currentViewingStudentId = null;
}

// Редактирование ученика
function editStudent(id) {
    // TODO: Сделать модальное окно редактирования в будущем
    viewStudent(id);
}

// Показать модальное окно создания ученика
function showStudentCreatedModal(studentName, studentPhone, password, classesCount, membershipType, copySuccess, groupInfo = null) {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10002;
    `;
    
    // Тип абонемента для отображения
    const membershipTypeText = {
        'trial': 'Пробный',
        'monthly': 'Месячный',
        'quarterly': 'Квартальный'
    }[membershipType] || membershipType;
    
    // Форматируем расписание группы
    let scheduleText = '';
    let nextClassText = '';
    
    if (groupInfo && groupInfo.schedule && groupInfo.schedule.length > 0) {
        const dayNames = [
            '', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'
        ];
        const dayNamesShort = ['', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
        
        scheduleText = groupInfo.schedule.map(s => 
            `${dayNames[s.dayOfWeek]} ${s.time}`
        ).join('\n');
        
        // Находим ближайшее занятие
        const now = new Date();
        const currentDay = now.getDay();
        
        const convertDay = (groupDay) => {
            return groupDay === 7 ? 0 : groupDay;
        };
        
        let nextClass = null;
        let minDaysAway = 8;
        
        groupInfo.schedule.forEach(s => {
            const schedDay = convertDay(s.dayOfWeek);
            let daysAway = (schedDay - currentDay + 7) % 7;
            if (daysAway === 0) daysAway = 7;
            
            if (daysAway < minDaysAway) {
                minDaysAway = daysAway;
                nextClass = {
                    day: dayNames[s.dayOfWeek],
                    dayShort: dayNamesShort[s.dayOfWeek],
                    time: s.time,
                    daysAway
                };
            }
        });
        
        if (nextClass) {
            const nextDate = new Date(now);
            nextDate.setDate(now.getDate() + nextClass.daysAway);
            const dateStr = nextDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
            
            nextClassText = `📅 Ближайшее занятие:\n${nextClass.day}, ${dateStr} в ${nextClass.time}`;
        }
    }
    
    // Формируем готовое сообщение для WhatsApp
    const whatsappMessage = `✨ Добро пожаловать в SENSE OF DANCE!

👤 Ваш аккаунт создан:
━━━━━━━━━━━━━━━━━
📱 Логин: ${studentPhone}
🔑 Пароль: ${password}

💎 Ваш абонемент:
━━━━━━━━━━━━━━━━━
Тип: ${membershipTypeText}
Занятий: ${classesCount}${groupInfo ? `
Группа: ${groupInfo.name}` : ''}${nextClassText ? `

${nextClassText}` : ''}${scheduleText ? `

📋 Расписание группы:
${scheduleText}` : ''}

🌐 Личный кабинет:
http://192.168.100.30:8000/frontend/public/profile.html

📞 Контакты:
+7 (700) 095-09-04

Ждём вас на занятиях! 💃`;
    
    const encodedMessage = encodeURIComponent(whatsappMessage);
    const whatsappPhone = studentPhone.replace(/\D/g, '');
    const whatsappUrl = `https://wa.me/${whatsappPhone}?text=${encodedMessage}`;
    
    modal.innerHTML = `
        <div style="
            background: var(--admin-card);
            border: 2px solid var(--pink);
            padding: 30px;
            max-width: 600px;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 10px 40px var(--admin-shadow);
        ">
            <div style="text-align: center; margin-bottom: 30px;">
                <div style="color: var(--pink); margin-bottom: 15px;">
                    ${getIcon('success', 48)}
                </div>
                <h2 style="color: var(--admin-text); font-size: 1.5rem; letter-spacing: 0.1em; margin: 0;">
                    УЧЕНИК УСПЕШНО СОЗДАН
                </h2>
            </div>
            
            <div style="background: rgba(235, 77, 119, 0.1); border: 2px solid var(--pink); border-radius: 8px; padding: 20px; margin-bottom: 25px;">
                <div style="margin-bottom: 15px;">
                    <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Ученик:</div>
                    <div style="color: var(--admin-text); font-size: 1.1rem; font-weight: 600;">${studentName}</div>
                </div>
                
                <div style="margin-bottom: 15px;">
                    <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Телефон:</div>
                    <div style="color: var(--admin-text); font-size: 1.1rem; font-weight: 600;">${studentPhone}</div>
                </div>
                
                <div style="margin-bottom: 15px;">
                    <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Абонемент:</div>
                    <div style="color: var(--admin-text); font-size: 1.1rem; font-weight: 600;">${membershipTypeText} — ${classesCount} занятий</div>
                </div>
                
                ${groupInfo ? `
                <div style="margin-bottom: 15px;">
                    <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Группа:</div>
                    <div style="color: var(--admin-text); font-size: 1.1rem; font-weight: 600;">${groupInfo.name}</div>
                </div>
                ` : ''}
                
                ${nextClassText ? `
                <div style="background: rgba(16, 185, 129, 0.2); padding: 12px; border-radius: 6px; margin-top: 15px;">
                    <div style="color: #10b981; font-size: 0.95rem; font-weight: 600; white-space: pre-line;">${nextClassText}</div>
                </div>
                ` : ''}
                
                <div style="border-top: 1px solid rgba(235, 77, 119, 0.3); padding-top: 15px; margin-top: 15px;">
                    <div style="color: var(--pink); font-size: 0.85rem; margin-bottom: 8px; letter-spacing: 0.1em;">ДАННЫЕ ДЛЯ ВХОДА:</div>
                    <div style="
                        background: rgba(0, 0, 0, 0.3);
                        padding: 15px;
                        border-radius: 6px;
                        margin-bottom: 10px;
                    ">
                        <div style="color: var(--admin-text); margin-bottom: 8px;">
                            <span style="opacity: 0.7;">Логин:</span>
                            <code style="color: var(--pink); font-size: 1.1rem; margin-left: 10px; font-family: 'Courier New', monospace;">${studentPhone}</code>
                        </div>
                        <div style="color: var(--admin-text);">
                            <span style="opacity: 0.7;">Пароль:</span>
                            <code style="color: var(--pink); font-size: 1.3rem; font-weight: 700; margin-left: 10px; font-family: 'Courier New', monospace;">${password}</code>
                        </div>
                    </div>
                    ${copySuccess ? `
                        <div style="color: #10b981; font-size: 0.9rem; text-align: center;">
                            ${getIcon('check', 16)} Пароль скопирован в буфер обмена
                        </div>
                    ` : ''}
                </div>
            </div>
            
            <div style="background: rgba(16, 185, 129, 0.1); border-left: 3px solid #10b981; padding: 15px; margin-bottom: 25px; border-radius: 4px;">
                <div style="color: var(--admin-text); font-weight: 600; margin-bottom: 10px;">
                    📱 Готовое сообщение для ученика:
                </div>
                <div id="whatsappMessagePreview" style="
                    color: var(--admin-text);
                    background: rgba(0, 0, 0, 0.2);
                    padding: 15px;
                    border-radius: 6px;
                    font-size: 0.9rem;
                    line-height: 1.6;
                    white-space: pre-line;
                    max-height: 200px;
                    overflow-y: auto;
                ">${whatsappMessage}</div>
            </div>
            
            <div style="display: flex; gap: 15px; justify-content: center; flex-wrap: wrap;">
                <button id="sendWhatsAppBtn" style="
                    padding: 12px 30px;
                    background: #25D366;
                    color: #ffffff;
                    border: none;
                    cursor: pointer;
                    letter-spacing: 0.1em;
                    font-size: 0.9rem;
                    transition: all 0.3s ease;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                ">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                    </svg>
                    ОТПРАВИТЬ В WHATSAPP
                </button>
                <button id="copyMessageBtn" style="
                    padding: 12px 30px;
                    background: var(--pink);
                    color: #ffffff;
                    border: none;
                    cursor: pointer;
                    letter-spacing: 0.1em;
                    font-size: 0.9rem;
                    transition: all 0.3s ease;
                ">СКОПИРОВАТЬ СООБЩЕНИЕ</button>
                <button id="closeStudentModal" style="
                    padding: 12px 30px;
                    background: transparent;
                    color: var(--admin-text);
                    border: 2px solid var(--admin-border);
                    cursor: pointer;
                    letter-spacing: 0.1em;
                    font-size: 0.9rem;
                    transition: all 0.3s ease;
                ">ЗАКРЫТЬ</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Кнопка WhatsApp
    document.getElementById('sendWhatsAppBtn').addEventListener('click', () => {
        window.open(whatsappUrl, '_blank');
        toast.success('WhatsApp открыт! Отправьте сообщение ученику.');
    });
    
    // Кнопка копирования сообщения
    document.getElementById('copyMessageBtn').addEventListener('click', async () => {
        const success = await copyToClipboard(whatsappMessage);
        if (success) {
            toast.success('Сообщение скопировано! Отправьте ученику.');
        } else {
            toast.error('Не удалось скопировать. Скопируйте вручную из окна.');
        }
    });
    
    // Кнопка закрытия
    document.getElementById('closeStudentModal').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    // Закрытие по клику на overlay
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

// Утилиты для платежей
function getPaymentTypeText(type) {
    const types = {
        'trial_advance': 'Аванс (пробное)',
        'trial_full': 'Пробное занятие',
        'membership_advance': 'Аванс (абонемент)',
        'membership_balance': 'Доплата',
        'membership_full': 'Абонемент',
        'single_class': 'Разовое',
        'individual_class': 'Индивидуальное'
    };
    return types[type] || type;
}

function formatAmount(amount) {
    return new Intl.NumberFormat('ru-RU').format(amount) + ' ₸';
}

function getPaymentStatusText(status) {
    const statuses = {
        'pending': 'Ожидает',
        'completed': 'Оплачено',
        'converted_to_membership': 'В абонемент',
        'refunded': 'Возврат',
        'cancelled': 'Отменено'
    };
    return statuses[status] || status;
}

// Заглушка для openAddPaymentModal
function openAddPaymentModal() {
    toast.info('Функция добавления платежа в разработке');
}

// Инициализация поиска учеников
function initStudentSearch() {
    const studentSearch = document.getElementById('studentSearch');
    if (studentSearch) {
        let searchTimeout;
        studentSearch.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                // Сбрасываем на первую страницу при поиске
                renderStudents(e.target.value, 1);
            }, 300);  // Debounce 300мс
        });
    }
}


