// =====================================================
// USERS MODULE - Управление пользователями
// =====================================================

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
        
        // Фильтр по роли
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
        
        // Дополнительная фильтрация на клиенте
        if (roleFilter === 'admin') {
            users = users.filter(u => u.role === 'admin' || u.role === 'super_admin');
        } else if (roleFilter === 'all') {
            // В разделе users показываем всех кроме обычных студентов
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
        console.error('Ошибка загрузки пользователей:', error);
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

// Открыть модальное окно редактирования пользователя
async function openUserModal(userId) {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/students/${userId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        
        if (!data.success) {
            showNotification(notificationWithIcon('error', 'Ошибка загрузки данных пользователя'));
            return;
        }
        
        const user = data.student;
        
        // Заполняем форму
        document.getElementById('userId').value = user._id;
        document.getElementById('userName').value = user.name;
        document.getElementById('userPhone').value = user.phone;
        document.getElementById('userEmail').value = user.email || '';
        document.getElementById('userRole').value = user.role;
        
        // Скрываем опцию super_admin если пользователь не super_admin
        const roleSelect = document.getElementById('userRole');
        const superAdminOption = roleSelect.querySelector('option[value="super_admin"]');
        if (superAdminOption) {
            superAdminOption.remove();
        }
        
        // Если текущий пользователь super_admin, добавляем опцию
        if (isSuperAdmin() && user.role === 'super_admin') {
            const option = document.createElement('option');
            option.value = 'super_admin';
            option.textContent = 'Супер Админ';
            option.selected = true;
            roleSelect.appendChild(option);
        }
        
        // Показываем поля для преподавателя
        toggleTeacherFields();
        
        // Загружаем данные преподавателя
        if (user.role === 'teacher' && user.teacherInfo) {
            const dirCheckboxes = document.querySelectorAll('#teacherFields input[name="directions"]');
            dirCheckboxes.forEach(cb => {
                cb.checked = user.teacherInfo.directions?.includes(cb.value) || false;
            });
            
            const bioInput = document.getElementById('userBio');
            const photoInput = document.getElementById('userPhoto');
            if (bioInput) bioInput.value = user.teacherInfo.bio || '';
            if (photoInput) photoInput.value = user.teacherInfo.photo || '';
        }
        
        document.getElementById('userModal').classList.add('show');
        
    } catch (error) {
        console.error('Ошибка:', error);
        showNotification(notificationWithIcon('error', 'Ошибка подключения к серверу'));
    }
}

// Закрыть модальное окно пользователя
function closeUserModal() {
    document.getElementById('userModal').classList.remove('show');
    document.getElementById('userForm').reset();
}

// Переключение полей преподавателя
function toggleTeacherFields() {
    const role = document.getElementById('userRole').value;
    const teacherFields = document.getElementById('teacherFields');
    const teacherBioGroup = document.getElementById('teacherBioGroup');
    const teacherPhotoGroup = document.getElementById('teacherPhotoGroup');
    
    const isTeacher = role === 'teacher';
    teacherFields.style.display = isTeacher ? 'block' : 'none';
    if (teacherBioGroup) teacherBioGroup.style.display = isTeacher ? 'block' : 'none';
    if (teacherPhotoGroup) teacherPhotoGroup.style.display = isTeacher ? 'block' : 'none';
}

// Удалить пользователя
async function deleteUser(userId, userName) {
    if (!isSuperAdmin()) {
        showNotification(notificationWithIcon('warning', 'Доступ запрещен. Требуются права супер-администратора.'));
        return;
    }
    
    const confirmMsg = `Вы уверены, что хотите удалить пользователя "${userName}"?\n\nЭто действие нельзя отменить!`;
    if (!await customConfirm(confirmMsg)) {
        return;
    }
    
    try {
        const token = getAuthToken();
        
        // Получаем данные пользователя
        const response = await fetch(`${API_URL}/students/${userId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const userData = await response.json();
        if (!userData.success) {
            showNotification(notificationWithIcon('warning', 'Ошибка: не удалось получить данные пользователя'));
            return;
        }
        
        const user = userData.student;
        let deleteEndpoint = '';
        
        // Выбираем endpoint в зависимости от роли
        switch(user.role) {
            case 'admin':
                deleteEndpoint = `${API_URL}/users/admins/${userId}`;
                break;
            case 'sales_manager':
                deleteEndpoint = `${API_URL}/users/sales-managers/${userId}`;
                break;
            case 'teacher':
                deleteEndpoint = `${API_URL}/users/teachers/${userId}`;
                break;
            case 'student':
                deleteEndpoint = `${API_URL}/students/${userId}`;
                break;
            default:
                showNotification(notificationWithIcon('warning', 'Неизвестная роль пользователя'));
                return;
        }
        
        const deleteResponse = await fetch(deleteEndpoint, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const deleteData = await deleteResponse.json();
        
        if (deleteData.success) {
            showNotification(notificationWithIcon('warning', `Пользователь "${userName}" удален`));
            renderUsers(currentRoleFilter);
            renderDashboard();
        } else {
            showNotification(notificationWithIcon('error', `Ошибка: ${deleteData.error || 'Не удалось удалить пользователя'}`));
        }
        
    } catch (error) {
        console.error('Ошибка удаления пользователя:', error);
        showNotification(notificationWithIcon('error', 'Ошибка подключения к серверу'));
    }
}

// Генерация случайного пароля
function generatePassword() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let password = '';
    for (let i = 0; i < 8; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

// Сброс пароля пользователя
async function resetUserPassword(userId, userName, userPhone) {
    const confirmMsg = `Сгенерировать новый пароль для "${userName}"?\n\nТелефон: ${userPhone}\n\nНовый пароль будет показан вам для передачи ученику.`;
    
    if (!await customConfirm(confirmMsg)) {
        return;
    }
    
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/users/${userId}/reset-password`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            const password = data.newPassword;
            const copySuccess = await copyToClipboard(password);
            showPasswordModal(userName, userPhone, password, copySuccess);
        } else {
            showNotification(notificationWithIcon('error', `Ошибка: ${data.error || 'Не удалось сбросить пароль'}`));
        }
    } catch (error) {
        console.error('Password reset error:', error);
        showNotification(notificationWithIcon('error', 'Ошибка при сбросе пароля'));
    }
}

// Показать модальное окно с новым паролем
function showPasswordModal(userName, userPhone, password, copySuccess, userType = '') {
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
    
    const title = userType ? `${userType.toUpperCase()} СОЗДАН` : 'НОВЫЙ ПАРОЛЬ СОЗДАН';
    
    modal.innerHTML = `
        <div style="
            background: var(--admin-card);
            border: 2px solid var(--pink);
            padding: 40px;
            max-width: 600px;
            box-shadow: 0 10px 40px var(--admin-shadow);
        ">
            <div style="text-align: center; margin-bottom: 30px;">
                <div style="color: var(--pink); margin-bottom: 15px;">
                    ${getIcon('success', 48)}
                </div>
                <h2 style="color: var(--admin-text); font-size: 1.5rem; letter-spacing: 0.1em; margin: 0;">
                    ${title}
                </h2>
            </div>
            
            <div style="background: rgba(235, 77, 119, 0.1); border: 2px solid var(--pink); border-radius: 8px; padding: 20px; margin-bottom: 25px;">
                <div style="margin-bottom: 15px;">
                    <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Пользователь:</div>
                    <div style="color: var(--admin-text); font-size: 1.1rem; font-weight: 600;">${userName}</div>
                </div>
                
                <div style="margin-bottom: 15px;">
                    <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Телефон:</div>
                    <div style="color: var(--admin-text); font-size: 1.1rem; font-weight: 600;">${userPhone}</div>
                </div>
                
                <div style="border-top: 1px solid rgba(235, 77, 119, 0.3); padding-top: 15px; margin-top: 15px;">
                    <div style="color: var(--pink); font-size: 0.85rem; margin-bottom: 8px; letter-spacing: 0.1em;">НОВЫЙ ПАРОЛЬ:</div>
                    <div style="
                        background: rgba(0, 0, 0, 0.3);
                        padding: 15px;
                        border-radius: 6px;
                        text-align: center;
                        margin-bottom: 10px;
                    ">
                        <code style="
                            color: var(--pink);
                            font-size: 1.4rem;
                            font-weight: 700;
                            letter-spacing: 0.15em;
                            font-family: 'Courier New', monospace;
                        ">${password}</code>
                    </div>
                    ${copySuccess ? `
                        <div style="color: #10b981; font-size: 0.9rem; text-align: center;">
                            ${getIcon('check', 16)} Пароль скопирован в буфер обмена
                        </div>
                    ` : ''}
                </div>
            </div>
            
            <div style="background: rgba(239, 68, 68, 0.1); border-left: 3px solid #ef4444; padding: 15px; margin-bottom: 25px; border-radius: 4px;">
                <div style="color: var(--admin-text); font-weight: 600; margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                    ${getIcon('warning', 20)}
                    <span>ВАЖНО:</span>
                </div>
                <ol style="color: var(--admin-text); margin: 0; padding-left: 20px; line-height: 1.8;">
                    <li>Скопируйте пароль (уже в буфере обмена)</li>
                    <li>Отправьте ученику через WhatsApp или звонок</li>
                    <li>Это окно больше не появится!</li>
                    <li>Ученик может сменить пароль в профиле</li>
                </ol>
            </div>
            
            <div style="display: flex; gap: 15px; justify-center: center;">
                <button id="copyPasswordBtn" style="
                    padding: 12px 30px;
                    background: var(--pink);
                    color: #ffffff;
                    border: none;
                    cursor: pointer;
                    letter-spacing: 0.1em;
                    font-size: 0.9rem;
                    transition: all 0.3s ease;
                ">СКОПИРОВАТЬ ПАРОЛЬ</button>
                <button id="closePasswordModal" style="
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
    
    document.getElementById('copyPasswordBtn').addEventListener('click', async () => {
        const success = await copyToClipboard(password);
        if (success) {
            showNotification(notificationWithIcon('success', 'Пароль скопирован в буфер обмена!'));
        } else {
            showNotification(notificationWithIcon('error', 'Не удалось скопировать. Скопируйте вручную.'));
        }
    });
    
    document.getElementById('closePasswordModal').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

// Открыть модальное окно создания пользователя
function openCreateUserModal(role) {
    const modal = document.getElementById('createUserModal');
    const title = document.getElementById('createUserModalTitle');
    const roleInput = document.getElementById('newUserRole');
    const directionsGroup = document.getElementById('newUserDirectionsGroup');
    const passwordInput = document.getElementById('newUserPassword');
    
    roleInput.value = role;
    passwordInput.value = generatePassword();
    
    const titles = {
        'student': 'СОЗДАТЬ УЧЕНИКА',
        'sales_manager': 'СОЗДАТЬ МЕНЕДЖЕРА ПО ПРОДАЖАМ',
        'teacher': 'СОЗДАТЬ ПРЕПОДАВАТЕЛЯ',
        'admin': 'СОЗДАТЬ АДМИНИСТРАТОРА'
    };
    title.textContent = titles[role] || 'СОЗДАТЬ ПОЛЬЗОВАТЕЛЯ';
    
    const isTeacher = role === 'teacher';
    directionsGroup.style.display = isTeacher ? 'block' : 'none';
    
    const bioGroup = document.getElementById('newUserBioGroup');
    const photoGroup = document.getElementById('newUserPhotoGroup');
    if (bioGroup) bioGroup.style.display = isTeacher ? 'block' : 'none';
    if (photoGroup) photoGroup.style.display = isTeacher ? 'block' : 'none';
    
    // Форматирование телефона
    const phoneInput = document.getElementById('newUserPhone');
    if (phoneInput) {
        // Удаляем старые обработчики если они есть
        const newPhoneInput = phoneInput.cloneNode(true);
        phoneInput.parentNode.replaceChild(newPhoneInput, phoneInput);
        
        newPhoneInput.addEventListener('input', function(e) {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 0) {
                if (value[0] === '8') value = '7' + value.slice(1);
                if (!value.startsWith('7')) value = '7' + value;
            }
            if (value.length > 1) {
                let formatted = '+7 (';
                if (value.length > 1) formatted += value.slice(1, 4);
                if (value.length >= 5) formatted += ') ' + value.slice(4, 7);
                if (value.length >= 8) formatted += '-' + value.slice(7, 9);
                if (value.length >= 10) formatted += '-' + value.slice(9, 11);
                e.target.value = formatted;
            }
        });
    }
    
    modal.classList.add('show');
}

// Закрыть модальное окно создания
function closeCreateUserModal() {
    const modal = document.getElementById('createUserModal');
    const form = document.getElementById('createUserForm');
    modal.classList.remove('show');
    form.reset();
}

// Инициализация обработчиков для users
function initUserHandlers() {
    // Кнопки создания пользователей разных ролей
    const createSalesManagerBtn = document.getElementById('createSalesManagerBtn');
    const createTeacherBtn = document.getElementById('createTeacherBtn');
    const createAdminBtn = document.getElementById('createAdminBtn');
    
    if (createSalesManagerBtn) {
        createSalesManagerBtn.addEventListener('click', () => openCreateUserModal('sales_manager'));
    }
    
    if (createTeacherBtn) {
        createTeacherBtn.addEventListener('click', () => openCreateUserModal('teacher'));
    }
    
    if (createAdminBtn) {
        createAdminBtn.addEventListener('click', () => openCreateUserModal('admin'));
    }
    
    // Фильтры ролей
    document.querySelectorAll('[data-role]').forEach(btn => {
        btn.addEventListener('click', () => {
            const role = btn.dataset.role;
            
            document.querySelectorAll('[data-role]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            currentUserPage = 1;  // Сброс на первую страницу
            renderUsers(role, currentUserSearch, 1);
        });
    });
    
    // Обработчик поиска пользователей
    const userSearch = document.getElementById('userSearch');
    if (userSearch) {
        let searchTimeout;
        userSearch.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                currentUserPage = 1;  // Сброс на первую страницу
                renderUsers(currentRoleFilter, e.target.value, 1);
            }, 300);  // Debounce 300мс
        });
    }
    
    // Обработчик формы изменения пользователя
    const userForm = document.getElementById('userForm');
    if (userForm) {
        userForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const userId = document.getElementById('userId').value;
            const newRole = document.getElementById('userRole').value;
            const name = document.getElementById('userName').value;
            
            try {
                const token = getAuthToken();
                
                if (newRole === 'teacher') {
                    const checkboxes = document.querySelectorAll('#teacherFields input[name="directions"]:checked');
                    const directions = Array.from(checkboxes).map(cb => cb.value);
                    
                    const bioInput = document.getElementById('userBio');
                    const photoInput = document.getElementById('userPhoto');
                    const bio = bioInput?.value.trim() || '';
                    const photo = photoInput?.value.trim() || '';
                    
                    const response = await fetch(`${API_URL}/users/teachers/${userId}`, {
                        method: 'PATCH',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ name, directions, bio, photo })
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        showNotification(notificationWithIcon('success', 'Преподаватель успешно обновлен'));
                        closeUserModal();
                        renderUsers(currentRoleFilter);
                    } else {
                        showNotification(notificationWithIcon('error', `Ошибка: ${data.error || 'Не удалось обновить'}`));
                    }
                } else {
                    const confirmMsg = `Изменить роль пользователя на "${getRoleText(newRole)}"?`;
                    if (!await customConfirm(confirmMsg)) {
                        return;
                    }
                    
                    const response = await fetch(`${API_URL}/users/${userId}/change-role`, {
                        method: 'PATCH',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ role: newRole })
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        showNotification(notificationWithIcon('success', 'Роль успешно изменена'));
                        closeUserModal();
                        renderUsers(currentRoleFilter);
                    } else {
                        showNotification(notificationWithIcon('error', `Ошибка: ${data.error || 'Не удалось изменить роль'}`));
                    }
                }
                
            } catch (error) {
                console.error('Ошибка обновления:', error);
                showNotification(notificationWithIcon('error', 'Ошибка подключения к серверу'));
            }
        });
    }
    
    // Обработчик изменения роли
    const userRoleSelect = document.getElementById('userRole');
    if (userRoleSelect) {
        userRoleSelect.addEventListener('change', toggleTeacherFields);
    }
    
    // Обработчик формы создания пользователя
    const createUserForm = document.getElementById('createUserForm');
    if (createUserForm) {
        createUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const role = document.getElementById('newUserRole').value;
            const name = document.getElementById('newUserName').value;
            const phone = document.getElementById('newUserPhone').value;
            const password = document.getElementById('newUserPassword').value;
            
            let directions = [];
            let bio = '';
            let photo = '';
            
            if (role === 'teacher') {
                const checkboxes = document.querySelectorAll('input[name="newDirections"]:checked');
                directions = Array.from(checkboxes).map(cb => cb.value);
                
                const bioInput = document.getElementById('newUserBio');
                const photoInput = document.getElementById('newUserPhoto');
                if (bioInput) bio = bioInput.value.trim();
                if (photoInput) photo = photoInput.value.trim();
            }
            
            try {
                const token = getAuthToken();
                let endpoint = '';
                let body = { name, phone, password, gender: 'male' };
                
                switch(role) {
                    case 'student':
                        endpoint = `${API_URL}/auth/register`;
                        break;
                    case 'sales_manager':
                        endpoint = `${API_URL}/users/sales-managers`;
                        break;
                    case 'teacher':
                        endpoint = `${API_URL}/users/teachers`;
                        body.directions = directions;
                        body.bio = bio;
                        body.photo = photo;
                        break;
                    case 'admin':
                        endpoint = `${API_URL}/users/admins`;
                        break;
                }
                
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                });
                
                const data = await response.json();
                
                if (data.success) {
                    const generatedPassword = data.generatedPassword || password;
                    const copySuccess = await copyToClipboard(generatedPassword);
                    
                    const userTypeText = {
                        'student': 'Ученик',
                        'sales_manager': 'Менеджер по продажам',
                        'teacher': 'Преподаватель',
                        'admin': 'Администратор'
                    }[role] || 'Пользователь';
                    
                    showPasswordModal(name, phone, generatedPassword, copySuccess, userTypeText);
                    
                    closeCreateUserModal();
                    renderUsers(currentRoleFilter);
                } else {
                    showNotification(notificationWithIcon('error', `Ошибка: ${data.error || 'Не удалось создать пользователя'}`));
                }
            } catch (error) {
                console.error('Ошибка создания пользователя:', error);
                showNotification(notificationWithIcon('error', 'Ошибка подключения к серверу'));
            }
        });
    }
}

console.log('✅ Users модуль загружен');

