// =====================================================
// BOOKINGS MODULE - Управление заявками
// =====================================================

// Текущий фильтр заявок
let currentBookingFilter = null;
let currentBookingPage = 1;
let currentBookingSearch = '';

// Отобразить заявки
async function renderBookings(filter = null, search = '', page = 1) {
    const table = document.getElementById('bookingsTable');
    table.innerHTML = '<tr><td colspan="7" style="text-align:center;">Загрузка...</td></tr>';
    
    // Показать прогресс-бар
    if (window.showLoading) {
        window.showLoading();
    }
    
    currentBookingFilter = filter;
    currentBookingSearch = search;
    currentBookingPage = page;
    
    try {
        const data = await fetchBookings(filter, search, page, 20);
        const bookings = data.bookings || [];
    
    // ⚡ Badge обновляется ТОЛЬКО из дашборда (там правильная статистика)
    // НЕ обновляем здесь, чтобы избежать неточностей из-за пагинации
    
    if (bookings.length === 0) {
        table.innerHTML = '<tr><td colspan="7" style="text-align:center; opacity:0.5;">Нет заявок</td></tr>';
        renderBookingsPagination(0, page, 0);
        return;
    }
    
    const userRole = getUserRole();
    const isAdmin = ['admin', 'super_admin'].includes(userRole);
    
    // Показать/скрыть колонку "Действия"
    const actionsColumn = document.getElementById('bookingsActionsColumn');
    if (actionsColumn) {
        actionsColumn.style.display = isAdmin ? '' : 'none';
    }
    
    const canEditSource = isSuperAdmin();
    
    table.innerHTML = bookings.map(booking => `
        <tr data-booking-id="${booking._id}">
            <td>${booking.name} ${booking.lastName || ''}</td>
            <td>${booking.phone}</td>
            <td>${booking.direction}</td>
            <td>
                ${canEditSource ? `
                    <select class="source-select" data-booking-id="${booking._id}" data-current-source="${booking.source || ''}">
                        <option value="" ${!booking.source ? 'selected' : ''}>Не указан</option>
                        <option value="Телефонный звонок" ${booking.source === 'Телефонный звонок' ? 'selected' : ''}>Телефонный звонок</option>
                        <option value="WhatsApp" ${booking.source === 'WhatsApp' ? 'selected' : ''}>WhatsApp</option>
                        <option value="Instagram Direct" ${booking.source === 'Instagram Direct' ? 'selected' : ''}>Instagram Direct</option>
                        <option value="Личное обращение" ${booking.source === 'Личное обращение' ? 'selected' : ''}>Личное обращение</option>
                        <option value="Сайт" ${booking.source === 'Сайт' ? 'selected' : ''}>Сайт</option>
                        <option value="Рекомендация" ${booking.source === 'Рекомендация' ? 'selected' : ''}>Рекомендация</option>
                        <option value="1fit" ${booking.source === '1fit' ? 'selected' : ''}>1fit</option>
                        <option value="Другое" ${booking.source === 'Другое' ? 'selected' : ''}>Другое</option>
                    </select>
                ` : `${booking.source || '—'}`}
            </td>
            <td class="date-cell">${formatDateTime(booking.createdAt)}</td>
            <td class="status-cell status-${booking.status}">
                <select class="status-select" data-booking-id="${booking._id}" data-current-status="${booking.status}">
                    <option value="new" ${booking.status === 'new' ? 'selected' : ''}>Новая</option>
                    <option value="processed" ${booking.status === 'processed' ? 'selected' : ''}>Думает</option>
                    <option value="sold" ${booking.status === 'sold' ? 'selected' : ''}>Продано</option>
                    <option value="rejected" ${booking.status === 'rejected' ? 'selected' : ''}>Отклонено</option>
                </select>
            </td>
            ${isAdmin ? `
            <td class="table-actions">
                    <button class="table-btn danger" onclick="deleteBooking('${booking._id}', '${booking.name} ${booking.lastName || ''}')">Удалить</button>
            </td>
            ` : '<td></td>'}
        </tr>
    `).join('');
    
    // Добавляем обработчики на select'ы статусов
    document.querySelectorAll('.status-select').forEach(select => {
        select.addEventListener('change', async (e) => {
            const bookingId = e.target.dataset.bookingId;
            const currentStatus = e.target.dataset.currentStatus;
            const newStatus = e.target.value;
            
            // Для статусов "trial" и "sold" сразу открываем модалку без подтверждения
            if (newStatus === 'trial' || newStatus === 'sold') {
                e.target.dataset.currentStatus = newStatus;
                await changeBookingStatusDirect(bookingId, newStatus);
                return;
            }
            
            // Подтверждение изменения для остальных статусов
            const confirmMessage = `Изменить статус заявки с "${getStatusText(currentStatus)}" на "${getStatusText(newStatus)}"?`;
            
            if (await customConfirm(confirmMessage, {icon: 'warning'})) {
                // Обновляем атрибут для цвета перед отправкой
                e.target.dataset.currentStatus = newStatus;
                await changeBookingStatusDirect(bookingId, newStatus);
            } else {
                // Вернуть старое значение
                e.target.value = currentStatus;
            }
        });
    });
    
    // Добавляем обработчики на select'ы источников (только для Super Admin)
    document.querySelectorAll('.source-select').forEach(select => {
        select.addEventListener('change', async (e) => {
            const bookingId = e.target.dataset.bookingId;
            const currentSource = e.target.dataset.currentSource;
            const newSource = e.target.value;
            
            // Подтверждение изменения
            const confirmMessage = `Изменить источник заявки на "${newSource || 'Не указан'}"?`;
            
            if (await customConfirm(confirmMessage, {icon: 'warning'})) {
                await changeBookingSource(bookingId, newSource);
            } else {
                // Вернуть старое значение
                e.target.value = currentSource;
            }
        });
    });
    
    // ⚡ Рендерим пагинацию
    renderBookingsPagination(data.total, page, data.pages);
    
    } catch (error) {
        table.innerHTML = '<tr><td colspan="7" style="text-align:center; color:red;">Ошибка загрузки заявок</td></tr>';
        
        // Скрыть прогресс-бар при ошибке
        if (window.hideLoading) {
            window.hideLoading();
        }
    }
    
    // Скрыть прогресс-бар после завершения
    if (window.hideLoading) {
        window.hideLoading();
    }
}

// Рендер пагинации для заявок
function renderBookingsPagination(total, currentPage, totalPages) {
    const container = document.getElementById('bookingsPagination');
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
            
            // Показать прогресс-бар при пагинации
            if (window.showLoading) {
                window.showLoading();
            }
            renderBookings(currentBookingFilter, currentBookingSearch, page);
        });
    });
}

// Изменить источник заявки
async function changeBookingSource(id, newSource) {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/bookings/${id}/source`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ source: newSource })
        });
        
        const data = await response.json();
        
        if (data.success) {
            toast.success(`Источник изменен на "${newSource || 'Не указан'}"`);
            renderBookings(currentBookingFilter);
        } else {
            toast.error(`Ошибка: ${data.error || 'Не удалось изменить источник'}`);
            renderBookings(currentBookingFilter);
        }
    } catch (error) {
        toast.error('Ошибка подключения к серверу');
        renderBookings(currentBookingFilter);
    }
}

// Открыть модалку конвертации заявки
async function openConvertBookingModal(bookingId) {
    try {
        const token = getAuthToken();
        
        // ⚡ МОМЕНТАЛЬНО показываем модалку с загрузкой
        document.getElementById('convertBookingInfo').innerHTML = '<div style="text-align: center; padding: 20px; opacity: 0.5;">Загрузка...</div>';
        document.getElementById('convertGroupId').innerHTML = '<option value="">Загрузка групп...</option>';
        document.getElementById('convertBookingId').value = bookingId;
        document.getElementById('convertBookingModal').classList.add('show');
        
        // ⚡ ПАРАЛЛЕЛЬНО загружаем данные В ФОНЕ
        const [bookingData, groupsData] = await Promise.all([
            fetch(`${API_URL}/bookings/${bookingId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json()),
            fetch(`${API_URL}/groups`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json())
        ]);
        
        const booking = bookingData.booking;
        const allGroups = groupsData.groups || [];
        
        // Заполнить информацию о заявке
        const genderText = booking.gender ? (booking.gender === 'male' ? 'Мужчина' : 'Женщина') : 'Не указан';
        document.getElementById('convertBookingInfo').innerHTML = `
            <strong style="display: block; margin-bottom: 8px;">Заявка:</strong>
            <div style="font-size: 0.95em; opacity: 0.9;">
                <div>Имя: ${booking.name} ${booking.lastName || ''}</div>
                <div>Телефон: ${booking.phone}</div>
                <div>Направление: ${booking.direction}</div>
                <div>Пол: ${genderText}</div>
            </div>
        `;
        
        // Заполнить список групп с расписанием
        const groupSelect = document.getElementById('convertGroupId');
        groupSelect.innerHTML = '<option value="">Выберите группу</option>';
        
        // Используем новую функцию форматирования
        if (window.formatGroupsForSelect) {
            groupSelect.innerHTML += window.formatGroupsForSelect(allGroups);
        } else {
            // Fallback если функция еще не загружена
            allGroups.forEach(group => {
                const option = document.createElement('option');
                option.value = group._id;
                option.textContent = `${group.name} (${group.direction})`;
                groupSelect.appendChild(option);
            });
        }
        
        document.getElementById('convertGender').value = booking.gender || '';
        document.getElementById('convertMembershipType').value = '';
        
    } catch (error) {
        document.getElementById('convertBookingInfo').innerHTML = '<div style="text-align: center; padding: 20px; color: #dc3545;">Ошибка загрузки</div>';
        toast.error('Ошибка при загрузке заявки');
    }
}

// Закрыть модалку конвертации
function closeConvertBookingModal() {
    document.getElementById('convertBookingModal').classList.remove('show');
}

// Изменить статус заявки напрямую (через select)
async function changeBookingStatusDirect(id, newStatus) {
    try {
        const token = getAuthToken();
        
        // Если статус "Пробное занятие" или "Продано" - открываем модалку конвертации
        if (newStatus === 'trial' || newStatus === 'sold') {
            openConvertBookingModal(id);
            return;
        }
        
        // Обычное изменение статуса
        const response = await fetch(`${API_URL}/bookings/${id}/status`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: newStatus })
        });
        
        const data = await response.json();
        
        if (data.success) {
            toast.success(`Статус изменен на "${getStatusText(newStatus)}"`);
            updateBookingRow(id, newStatus);
            renderDashboard();
        } else {
            toast.error(`Ошибка: ${data.error || 'Не удалось изменить статус'}`);
            // При ошибке возвращаем старое значение
            const select = document.querySelector(`[data-booking-id="${id}"]`);
            if (select) {
                select.value = select.dataset.currentStatus;
            }
        }
    } catch (error) {
        toast.error('Ошибка подключения к серверу');
        // При ошибке возвращаем старое значение
        const select = document.querySelector(`[data-booking-id="${id}"]`);
        if (select) {
            select.value = select.dataset.currentStatus;
        }
    }
}

// Обновить только одну строку заявки
function updateBookingRow(bookingId, newStatus) {
    const row = document.querySelector(`tr[data-booking-id="${bookingId}"]`);
    if (!row) return;
    
    // Обновляем статус в select
    const statusSelect = row.querySelector('.status-select');
    if (statusSelect) {
        statusSelect.value = newStatus;
        statusSelect.dataset.currentStatus = newStatus;
    }
    
    // Обновляем цвет статуса
    const statusCell = row.querySelector('.status-cell');
    if (statusCell) {
        statusCell.className = `status-cell status-${newStatus}`;
    }
    
    // Обновляем дату изменения (если есть)
    const dateCell = row.querySelector('.date-cell');
    if (dateCell) {
        dateCell.textContent = new Date().toLocaleDateString('ru-RU');
    }
}

// Просмотр заявки
async function viewBooking(id) {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/bookings/${id}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        const booking = data.booking;
        
        toast.info(`Заявка #${id.slice(-6)}\n\nИмя: ${booking.name} ${booking.lastName || ''}\nТелефон: ${booking.phone}\nНаправление: ${booking.direction}\nСтатус: ${getStatusText(booking.status)}\nДата: ${new Date(booking.createdAt).toLocaleString('ru')}`);
    } catch (error) {
        toast.error('Ошибка загрузки заявки');
    }
}

// Удалить заявку
async function deleteBooking(bookingId, bookingName) {
    // Проверка прав
    const userRole = getUserRole();
    if (!['admin', 'super_admin'].includes(userRole)) {
        toast.warning('Доступ запрещен. Требуются права администратора.');
        return;
    }
    
    // Подтверждение
    const confirmMsg = `Удалить заявку от "${bookingName}"?\n\nЭто действие нельзя отменить!`;
    if (!await customConfirm(confirmMsg)) {
        return;
    }
    
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/bookings/${bookingId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            toast.success(`Заявка удалена`);
            
            // ⚡ ОПТИМИЗАЦИЯ: Удаляем строку из DOM вместо полной перезагрузки
            const row = document.querySelector(`tr[data-booking-id="${bookingId}"]`);
            if (row) {
                // Анимация удаления
                row.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                row.style.opacity = '0';
                row.style.transform = 'translateX(-20px)';
                
                setTimeout(() => {
                    row.remove();
                    
                    // Проверяем если таблица пустая
                    const table = document.getElementById('bookingsTable');
                    if (table && table.children.length === 0) {
                        table.innerHTML = '<tr><td colspan="7" style="text-align: center; opacity: 0.5; padding: 40px;">Нет заявок</td></tr>';
                    }
                }, 300);
            }
            
            // Обновляем дашборд (счетчики)
            renderDashboard();
        } else {
            toast.error(`Ошибка: ${data.error || 'Не удалось удалить заявку'}`);
        }
        
    } catch (error) {
        toast.error('Ошибка подключения к серверу');
    }
}

// Закрыть модальное окно создания заявки
function closeCreateBookingModal() {
    const modal = document.getElementById('createBookingModal');
    modal.classList.remove('show');
    document.getElementById('createBookingForm').reset();
}

// Инициализация фильтров заявок
function initBookingFilters() {
    const bookingFilters = document.querySelectorAll('#section-bookings .filter-btn');
    bookingFilters.forEach(btn => {
        btn.addEventListener('click', () => {
            bookingFilters.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            currentBookingFilter = btn.dataset.filter === 'all' ? null : btn.dataset.filter;
            currentBookingPage = 1;  // Сброс на первую страницу
            
            // Показать прогресс-бар при фильтрации
            if (window.showLoading) {
                window.showLoading();
            }
            renderBookings(currentBookingFilter, currentBookingSearch, 1);
        });
    });
}

// Инициализация поиска заявок
function initBookingSearch() {
    const bookingSearch = document.getElementById('bookingSearch');
    if (bookingSearch) {
        let searchTimeout;
        bookingSearch.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                currentBookingPage = 1;  // Сброс на первую страницу
                // Показать прогресс-бар при поиске
                if (window.showLoading) {
                    window.showLoading();
                }
                renderBookings(currentBookingFilter, e.target.value, 1);
            }, 300);  // Debounce 300мс
        });
    }
}

// Инициализация обработчика создания заявки
function initBookingCreate() {
    // Открыть модальное окно создания заявки
    const createBtn = document.getElementById('createBookingBtn');
    if (createBtn) {
        createBtn.addEventListener('click', () => {
            const modal = document.getElementById('createBookingModal');
            modal.classList.add('show');
        });
    }
    
    // Закрыть при клике на overlay
    const overlay = document.querySelector('#createBookingModal .modal-overlay');
    if (overlay) {
        overlay.addEventListener('click', closeCreateBookingModal);
    }
    
    // Форматирование телефона в модальном окне
    const bookingPhoneInput = document.getElementById('bookingPhone');
    if (bookingPhoneInput) {
        bookingPhoneInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            
            if (value.length > 0) {
                if (value[0] === '8') {
                    value = '7' + value.substring(1);
                } else if (value[0] !== '7') {
                    value = '7' + value;
                }
                
                let formattedValue = '+7';
                
                if (value.length > 1) {
                    formattedValue += ' (' + value.substring(1, 4);
                }
                if (value.length >= 4) {
                    formattedValue += ') ' + value.substring(4, 7);
                }
                if (value.length >= 7) {
                    formattedValue += '-' + value.substring(7, 9);
                }
                if (value.length >= 9) {
                    formattedValue += '-' + value.substring(9, 11);
                }
                
                e.target.value = formattedValue;
            }
        });
    }
    
    // Создание заявки через API
    const createForm = document.getElementById('createBookingForm');
    if (createForm) {
        createForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const name = document.getElementById('bookingName').value;
            const lastName = document.getElementById('bookingLastName').value;
            const phone = document.getElementById('bookingPhone').value;
            const direction = document.getElementById('bookingDirection').value;
            const source = document.getElementById('bookingSource').value;
            
            try {
                const token = getAuthToken();
                
                // ⚡ МОМЕНТАЛЬНО закрываем модалку
                closeCreateBookingModal();
                
                const response = await fetch(`${API_URL}/bookings/create-admin`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ name, lastName, phone, direction, source })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    // ✨ Toast уведомление
                    toast.party('Заявка успешно создана!');
                    
                    // ⚡ OPTIMISTIC UI: Добавляем новую строку В НАЧАЛО таблицы БЕЗ перерисовки
                    const table = document.getElementById('bookingsTable');
                    const booking = data.booking;
                    const userRole = getUserRole();
                    const isAdmin = ['admin', 'super_admin'].includes(userRole);
                    const canEditSource = isSuperAdmin();
                    
                    const newRow = document.createElement('tr');
                    newRow.innerHTML = `
                        <td>${booking.name} ${booking.lastName || ''}</td>
                        <td>${booking.phone}</td>
                        <td>${booking.direction}</td>
                        <td>
                            ${canEditSource ? `
                                <select class="source-select" data-booking-id="${booking._id}" data-current-source="${booking.source || ''}">
                                    <option value="" ${!booking.source ? 'selected' : ''}>Не указан</option>
                                    <option value="Телефонный звонок" ${booking.source === 'Телефонный звонок' ? 'selected' : ''}>Телефонный звонок</option>
                                    <option value="WhatsApp" ${booking.source === 'WhatsApp' ? 'selected' : ''}>WhatsApp</option>
                                    <option value="Instagram Direct" ${booking.source === 'Instagram Direct' ? 'selected' : ''}>Instagram Direct</option>
                                    <option value="Личное обращение" ${booking.source === 'Личное обращение' ? 'selected' : ''}>Личное обращение</option>
                                    <option value="Сайт" ${booking.source === 'Сайт' ? 'selected' : ''}>Сайт</option>
                                    <option value="Рекомендация" ${booking.source === 'Рекомендация' ? 'selected' : ''}>Рекомендация</option>
                                    <option value="1fit" ${booking.source === '1fit' ? 'selected' : ''}>1fit</option>
                                    <option value="Другое" ${booking.source === 'Другое' ? 'selected' : ''}>Другое</option>
                                </select>
                            ` : `${booking.source || '—'}`}
                        </td>
                        <td>${formatDateTime(booking.createdAt)}</td>
                        <td>
                            <select class="status-select" data-booking-id="${booking._id}" data-current-status="${booking.status}">
                                <option value="new" ${booking.status === 'new' ? 'selected' : ''}>Новая</option>
                                <option value="processed" ${booking.status === 'processed' ? 'selected' : ''}>Думает</option>
                                <option value="sold" ${booking.status === 'sold' ? 'selected' : ''}>Продано</option>
                                <option value="rejected" ${booking.status === 'rejected' ? 'selected' : ''}>Отклонено</option>
                            </select>
                        </td>
                        ${isAdmin ? `
                        <td class="table-actions">
                                <button class="table-btn danger" onclick="deleteBooking('${booking._id}', '${booking.name} ${booking.lastName || ''}')">Удалить</button>
                        </td>
                        ` : '<td></td>'}
                    `;
                    
                    // Добавляем в начало таблицы
                    table.insertBefore(newRow, table.firstChild);
                    
                    // Добавляем обработчики для новой строки
                    const statusSelect = newRow.querySelector('.status-select');
                    if (statusSelect) {
                        statusSelect.addEventListener('change', async (e) => {
                            const bookingId = e.target.dataset.bookingId;
                            const currentStatus = e.target.dataset.currentStatus;
                            const newStatus = e.target.value;
                            
                            // Для статусов "trial" и "sold" сразу открываем модалку без подтверждения
                            if (newStatus === 'trial' || newStatus === 'sold') {
                                e.target.dataset.currentStatus = newStatus;
                                await changeBookingStatusDirect(bookingId, newStatus);
                                return;
                            }
                            
                            const confirmMessage = `Изменить статус заявки с "${getStatusText(currentStatus)}" на "${getStatusText(newStatus)}"?`;
                            
                            if (await customConfirm(confirmMessage, {icon: 'warning'})) {
                                e.target.dataset.currentStatus = newStatus;
                                await changeBookingStatusDirect(bookingId, newStatus);
                            } else {
                                e.target.value = currentStatus;
                            }
                        });
                    }
                    
                    const sourceSelect = newRow.querySelector('.source-select');
                    if (sourceSelect) {
                        sourceSelect.addEventListener('change', async (e) => {
                            const bookingId = e.target.dataset.bookingId;
                            const currentSource = e.target.dataset.currentSource;
                            const newSource = e.target.value;
                            
                            const confirmMessage = `Изменить источник с "${currentSource || 'Не указан'}" на "${newSource || 'Не указан'}"?`;
                            
                            if (await customConfirm(confirmMessage, {icon: 'warning'})) {
                                e.target.dataset.currentSource = newSource;
                                await changeBookingSource(bookingId, newSource);
                            } else {
                                e.target.value = currentSource;
                            }
                        });
                    }
                    
                    // Обновляем badge и дашборд в фоне (из API, не из DOM)
                    setTimeout(() => {
                        renderDashboard();  // Это обновит badge правильным значением из API
                    }, 0);
                } else {
                    toast.error(`Ошибка: ${data.error || 'Не удалось создать заявку'}`);
                }
            } catch (error) {
                toast.error('Ошибка подключения к серверу');
            }
        });
    }
}

// Инициализация обработчика формы конвертации
function initBookingConversion() {
    // 💰 Обработчик для radio buttons оплаты (конвертация)
    const convertPaymentRadios = document.querySelectorAll('input[name="convertPaymentType"]');
    const convertAdvanceGroup = document.getElementById('convertAdvanceGroup');
    const convertAdvanceDueDateGroup = document.getElementById('convertAdvanceDueDateGroup');
    
    if (convertPaymentRadios && convertAdvanceGroup && convertAdvanceDueDateGroup) {
        convertPaymentRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.value === 'advance') {
                    convertAdvanceGroup.style.display = 'block';
                    convertAdvanceDueDateGroup.style.display = 'block';
                } else {
                    convertAdvanceGroup.style.display = 'none';
                    convertAdvanceDueDateGroup.style.display = 'none';
                }
            });
        });
    }
    
    const convertForm = document.getElementById('convertBookingForm');
    if (convertForm) {
        convertForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const bookingId = document.getElementById('convertBookingId').value;
            const gender = document.getElementById('convertGender').value;
            const groupId = document.getElementById('convertGroupId').value;
            const membershipType = document.getElementById('convertMembershipType').value;
            
            // 💰 Получить payment данные
            const totalPrice = parseInt(document.getElementById('convertTotalPrice')?.value) || 0;
            const paymentType = document.querySelector('input[name="convertPaymentType"]:checked')?.value || 'later';
            const advanceAmount = parseInt(document.getElementById('convertAdvanceAmount')?.value) || 0;
            const advanceDueDate = document.getElementById('convertAdvanceDueDate')?.value;
            
            if (!groupId) {
                toast.warning('Выберите группу для ученика');
                return;
            }
            
            try {
                const token = getAuthToken();
                
                // ⚡ МОМЕНТАЛЬНО закрываем модалку конвертации
                closeConvertBookingModal();
                
                // ⚡ СРАЗУ показываем модалку результата с "Создание..."
                showStudentCreatedModal('Создание ученика...', '', 'Загрузка...', 0, membershipType, false, null);
                
                // ⚡ ПАРАЛЛЕЛЬНО выполняем конвертацию и загрузку группы В ФОНЕ
                const [convertData, groupData] = await Promise.all([
                    fetch(`${API_URL}/bookings/${bookingId}/convert`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            gender,
                            groupId,
                            membershipType,
                            // 💰 Добавляем payment поля
                            totalPrice,
                            paymentType,
                            advanceAmount: paymentType === 'advance' ? advanceAmount : undefined,
                            advanceDueDate: paymentType === 'advance' && advanceDueDate ? advanceDueDate : undefined
                        })
                    }).then(r => r.json()),
                    fetch(`${API_URL}/groups/${groupId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }).then(r => r.json()).catch(() => null)
                ]);
                
                if (convertData.success) {
                    const pwd = convertData.generatedPassword || 'changeme123';
                    const studentName = convertData.student.name;
                    const studentPhone = convertData.student.phone;
                    const classesCount = convertData.membership.classesRemaining;
                    const membershipType = convertData.membership.type;
                    
                    // Информация о группе
                    let groupInfo = null;
                    if (groupData && groupData.group) {
                        groupInfo = {
                            name: groupData.group.name,
                            schedule: groupData.group.schedule
                        };
                    }
                    
                    // Копируем пароль в буфер
                    const copySuccess = await copyToClipboard(pwd);
                    
                    // Удаляем ВСЕ существующие модалки с z-index 10002 (могут быть дубликаты)
                    document.querySelectorAll('[style*="z-index: 10002"]').forEach(modal => modal.remove());
                    
                    // Показываем РЕАЛЬНУЮ модалку с данными
                    showStudentCreatedModal(studentName, studentPhone, pwd, classesCount, membershipType, copySuccess, groupInfo);
                    
                    // 🎉 Toast уведомление
                    toast.party('Ученик успешно создан!');
                    
                    // Обновляем статус заявки в списке на "Продано" (не удаляем!)
                    const bookingRow = document.querySelector(`tr[data-booking-id="${bookingId}"]`);
                    if (bookingRow) {
                        // Обновляем статус в select
                        const statusSelect = bookingRow.querySelector('.status-select');
                        if (statusSelect) {
                            statusSelect.value = 'sold';
                            statusSelect.dataset.currentStatus = 'sold';
                        }
                        
                        // Обновляем цвет статуса
                        const statusCell = bookingRow.querySelector('.status-cell');
                        if (statusCell) {
                            statusCell.className = 'status-cell status-sold';
                        }
                    }
                    
                    // Обновляем списки в фоне
                    setTimeout(() => {
                        // Обновляем заявки с сохранением текущих фильтров и поиска
                        // Заявка останется в списке со статусом 'sold' для статистики и отслеживания
                        renderBookings(currentBookingFilter, currentBookingSearch, currentBookingPage);
                        
                        // Обновляем дашборд
                        renderDashboard();
                        
                        // Обновляем список учеников - переключаемся на первую страницу без фильтров для показа нового ученика
                        if (typeof renderStudents === 'function') {
                            renderStudents('', 1, '');
                        } else if (typeof window.renderStudents === 'function') {
                            window.renderStudents('', 1, '');
                        }
                    }, 100);
                } else {
                    // Удаляем ВСЕ loading модалки
                    document.querySelectorAll('[style*="z-index: 10002"]').forEach(modal => modal.remove());
                    toast.error(`Ошибка: ${convertData.error || 'Не удалось создать ученика'}`);
                }
            } catch (error) {
                // Удаляем ВСЕ loading модалки
                document.querySelectorAll('[style*="z-index: 10002"]').forEach(modal => modal.remove());
                toast.error('Ошибка при конвертации');
            }
        });
    }
}



