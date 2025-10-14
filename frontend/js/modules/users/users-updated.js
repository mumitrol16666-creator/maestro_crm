// =====================================================
// USERS MODULE - Управление пользователями  
// =====================================================

// Текущий фильтр
let currentRoleFilter = 'all';
let currentUserPage = 1;
let currentUserSearch = '';

// Отобразить пользователей
async function renderUsers(roleFilter = 'all', search = '', page = 1) {
    const table = document.getElementById('usersTable');
    if (!table) return;
    
    table.innerHTML = '<tr><td colspan="6" style="text-align:center;">Загрузка...</td></tr>';
    
    currentRoleFilter = roleFilter;
    currentUserSearch = search;
    currentUserPage = page;
    
    try {
        const token = getAuthToken();
        let url = `${API_URL}/students?page=${page}&limit=20&search=${encodeURIComponent(search)}`;
        
        // Фильтр по роли (исключаем обычных студентов)
        if (roleFilter !== 'all') {
            url += `&role=${roleFilter}`;
        }
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        
        if (!data.success) {
            table.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red;">Ошибка загрузки</td></tr>';
            renderUsersPagination(0, page, 0);
            return;
        }
        
        let users = data.students || [];
        
        // Фильтрация на клиенте (для админов/супер-админов/всех)
        if (roleFilter === 'admin') {
            users = users.filter(u => u.role === 'admin' || u.role === 'super_admin');
        } else if (roleFilter === 'all') {
            // Показываем всех кроме обычных студентов
            users = users.filter(u => u.role !== 'student');
        }
        
        if (users.length === 0) {
            table.innerHTML = '<tr><td colspan="6" style="text-align:center; opacity:0.5;">Нет пользователей</td></tr>';
            renderUsersPagination(data.total, page, data.pages);
            return;
        }
        
        const currentUserId = localStorage.getItem('userId');
        
        table.innerHTML = users.map(user => {
            const canDelete = isSuperAdmin() && 
                              user._id !== currentUserId && 
                              user.role !== 'super_admin';
            
            return `
                <tr>
                    <td>${user.name}</td>
                    <td>${user.phone}</td>
                    <td><span class="role-badge role-${user.role}">${getRoleText(user.role)}</span></td>
                    <td>${user.email || '—'}</td>
                    <td>${formatDate(user.registeredAt)}</td>
                    <td class="table-actions">
                        <button class="table-btn" onclick="resetUserPassword('${user._id}', '${user.name}', '${user.phone}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; vertical-align: middle; margin-right: 4px;">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                            </svg>
                            Пароль
                        </button>
                        <button class="table-btn" onclick="openUserModal('${user._id}')">Роль</button>
                        ${canDelete ? `<button class="table-btn danger" onclick="deleteUser('${user._id}', '${user.name}')">Удалить</button>` : ''}
                    </td>
                </tr>
            `;
        }).join('');
        
        // Рендерим пагинацию
        renderUsersPagination(data.total, page, data.pages);
        
    } catch (error) {
        console.error('Ошибка:', error);
        table.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red;">Ошибка подключения</td></tr>';
    }
}

// Рендер пагинации для пользователей
function renderUsersPagination(total, currentPage, totalPages) {
    const container = document.getElementById('usersPagination');
    if (!container) return;
    
    if (!totalPages || totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    
    const buttons = [];
    
    // Кнопка "Назад"
    if (currentPage > 1) {
        buttons.push(`<button class="pagination-btn" onclick="renderUsers('${currentRoleFilter}', '${currentUserSearch}', ${currentPage - 1})">‹ Назад</button>`);
    }
    
    // Номера страниц
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
            const active = i === currentPage ? 'active' : '';
            buttons.push(`<button class="pagination-btn ${active}" onclick="renderUsers('${currentRoleFilter}', '${currentUserSearch}', ${i})">${i}</button>`);
        } else if (i === currentPage - 3 || i === currentPage + 3) {
            buttons.push(`<span style="padding: 5px 10px; opacity: 0.5;">...</span>`);
        }
    }
    
    // Кнопка "Вперед"
    if (currentPage < totalPages) {
        buttons.push(`<button class="pagination-btn" onclick="renderUsers('${currentRoleFilter}', '${currentUserSearch}', ${currentPage + 1})">Вперед ›</button>`);
    }
    
    container.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; justify-content: center; padding: 20px 0; flex-wrap: wrap;">
            ${buttons.join('')}
            <span style="margin-left: 15px; opacity: 0.7; font-size: 0.9rem;">
                Всего: ${total} | Страница ${currentPage} из ${totalPages}
            </span>
        </div>
    `;
}

