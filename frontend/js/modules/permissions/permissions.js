// =====================================================
// PERMISSIONS MODULE - Управление правами ролей
// =====================================================

let rolePermissions = {};

// Названия функций на русском
const permissionLabels = {
    manageBookings: 'Управление заявками',
    deleteBookings: '[DELETE] Удаление заявок',
    manageStudents: 'Управление учениками',
    viewStudents: 'Просмотр учеников',
    deleteStudents: '[DELETE] Удаление учеников',
    manageGroups: 'Управление группами',
    viewGroups: 'Просмотр групп',
    deleteGroups: '[DELETE] Удаление групп',
    manageMemberships: 'Управление абонементами',
    deleteMemberships: '[DELETE] Удаление абонементов',
    createTeachers: 'Создание преподавателей',
    editTeachers: 'Редактирование преподавателей',
    deleteTeachers: '[DELETE] Удаление преподавателей',
    deleteManagers: '[DELETE] Удаление менеджеров',
    manageAdmins: 'Управление администраторами',
    markAttendance: 'Отметка посещаемости',
    managePractices: 'Управление практиками',
    deletePractices: '[DELETE] Удаление практик',
    manageDirections: 'Управление направлениями',
    deleteDirections: '[DELETE] Удаление направлений',
    manageRooms: 'Управление залами',
    deleteRooms: '[DELETE] Удаление залов',
    systemSettings: 'Системные настройки'
};

const visibilityLabels = {
    dashboard: 'Дашборд',
    bookings: 'Заявки',
    students: 'Ученики',
    groups: 'Группы',
    memberships: 'Абонементы',
    practices: 'Практики',
    schedule: 'Расписание',
    directions: 'Направления',
    users: 'Пользователи',
    roles: 'Управление ролями'
};

// Загрузка прав ролей
async function loadRolesData() {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/permissions`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        
        if (!data.success) {
            toast.error('Ошибка загрузки прав доступа');
            return;
        }
        
        // Преобразуем массив в объект для удобного доступа
        rolePermissions = {};
        data.permissions.forEach(perm => {
            rolePermissions[perm.role] = perm;
        });
        
        // Рендерим таблицы
        renderPermissionsTable();
        renderVisibilityTable();
        
    } catch (error) {
        toast.error('Ошибка подключения к серверу');
    }
}

// Отрисовка таблицы функциональных прав
function renderPermissionsTable() {
    const table = document.getElementById('permissionsTable');
    if (!table) return;
    
    const roles = ['super_admin', 'admin', 'sales_manager', 'teacher'];
    const permissions = Object.keys(permissionLabels);
    
    let html = `
        <thead>
            <tr>
                <th class="feature-column">Функция</th>
                ${roles.map(role => `<th class="role-column">${getRoleNameShort(role)}</th>`).join('')}
            </tr>
        </thead>
        <tbody>
    `;
    
    permissions.forEach(permission => {
        const isDeletePermission = permission.startsWith('delete');
        html += `<tr class="${isDeletePermission ? 'delete-permission' : ''}">
            <td class="feature-name">${permissionLabels[permission]}</td>`;
        
        roles.forEach(role => {
            const isEnabled = rolePermissions[role]?.permissions[permission] || false;
            const isLocked = role === 'super_admin';
            
            html += `<td class="access-cell ${isLocked ? 'locked' : 'clickable'}" 
                         onclick="${isLocked ? '' : `togglePermission('${role}', 'permissions', '${permission}')`}">
                <span class="perm-status ${isEnabled ? 'enabled' : 'disabled'} ${isLocked ? 'locked' : ''}">
                    ${isEnabled ? 'ON' : 'OFF'}
                </span>
            </td>`;
        });
        
        html += `</tr>`;
    });
    
    html += `</tbody>`;
    table.innerHTML = html;
}

// Отрисовка таблицы видимости разделов
function renderVisibilityTable() {
    const table = document.getElementById('visibilityTable');
    if (!table) return;
    
    const roles = ['super_admin', 'admin', 'sales_manager', 'teacher'];
    const sections = Object.keys(visibilityLabels);
    
    let html = `
        <thead>
            <tr>
                <th class="feature-column">Раздел</th>
                ${roles.map(role => `<th class="role-column">${getRoleNameShort(role)}</th>`).join('')}
            </tr>
        </thead>
        <tbody>
    `;
    
    sections.forEach(section => {
        html += `<tr>
            <td class="feature-name">${visibilityLabels[section]}</td>`;
        
        roles.forEach(role => {
            const isEnabled = rolePermissions[role]?.visibility[section] || false;
            const isLocked = role === 'super_admin';
            
            html += `<td class="access-cell ${isLocked ? 'locked' : 'clickable'}" 
                         onclick="${isLocked ? '' : `togglePermission('${role}', 'visibility', '${section}')`}">
                <span class="perm-status ${isEnabled ? 'enabled' : 'disabled'} ${isLocked ? 'locked' : ''}">
                    ${isEnabled ? 'ON' : 'OFF'}
                </span>
            </td>`;
        });
        
        html += `</tr>`;
    });
    
    html += `</tbody>`;
    table.innerHTML = html;
}

// Переключить право
async function togglePermission(role, type, key) {
    if (role === 'super_admin') {
        toast.warning('Нельзя изменить права Super Admin');
        return;
    }
    
    // Инвертируем значение
    const currentValue = rolePermissions[role][type][key];
    const newValue = !currentValue;
    
    // Обновляем локально
    rolePermissions[role][type][key] = newValue;
    
    // Сохраняем на сервер
    try {
        const token = getAuthToken();
        const updateData = {};
        updateData[type] = { [key]: newValue };
        
        const response = await fetch(`${API_URL}/permissions/${role}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updateData)
        });
        
        const data = await response.json();
        
        if (!data.success) {
            // Откатываем изменение
            rolePermissions[role][type][key] = currentValue;
            toast.error( data.error || 'Ошибка сохранения');
            renderPermissionsTable();
            renderVisibilityTable();
            return;
        }
        
        // Обновляем отображение
        if (type === 'permissions') {
            renderPermissionsTable();
        } else {
            renderVisibilityTable();
        }
        
        toast.success( `Право ${newValue ? 'включено' : 'выключено'}`));
        
    } catch (error) {
        // Откатываем изменение
        rolePermissions[role][type][key] = currentValue;
        toast.error('Ошибка подключения к серверу');
        renderPermissionsTable();
        renderVisibilityTable();
    }
}

// Сбросить права к дефолтным
async function resetPermissionsToDefault() {
    const confirmed = await customConfirm(
        'Сбросить все права всех ролей (кроме Super Admin) к дефолтным значениям?',
        { icon: 'warning' }
    );
    
    if (!confirmed) return;
    
    try {
        const token = getAuthToken();
        const roles = ['admin', 'sales_manager', 'teacher', 'student'];
        
        for (const role of roles) {
            await fetch(`${API_URL}/permissions/${role}/reset`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
        }
        
        toast.success( 'Права сброшены к дефолтным');
        
        // Перезагружаем права
        await loadRolesData();
        
    } catch (error) {
        toast.error('Ошибка подключения к серверу');
    }
}


