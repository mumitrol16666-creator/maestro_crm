// =====================================================
// USERS MODULE - Управление пользователями
// =====================================================

let currentRoleFilter = 'all';
let currentUserPage = 1;
let currentUserSearch = '';

function formatUserFio(user) {
    return [user?.lastName, user?.name, user?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ');
}

function escapeUserText(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function jsUserArg(value) {
    return escapeUserText(JSON.stringify(String(value || '')));
}

// Отобразить пользователей
async function renderUsers(roleFilter = 'all', search = '', page = 1) {
    const table = document.getElementById('usersTable');
    if (!table) return;

    table.innerHTML = '<tr><td colspan="6" style="text-align:center;">Загрузка...</td></tr>';

    // Показать прогресс-бар
    if (window.showLoading) {
        window.showLoading();
    }

    currentRoleFilter = roleFilter;
    currentUserSearch = search;
    currentUserPage = page;

    try {
        const token = getAuthToken();
        let url = `${API_URL}/users?page=${page}&limit=30&search=${encodeURIComponent(search)}`;

        // Фильтр по роли
        if (roleFilter === 'student') {
            // Для учеников - показываем только учеников
            url += `&role=student`;
        } else if (roleFilter !== 'all') {
            // Для конкретных ролей
            url += `&role=${roleFilter}`;
        } else {
            // Для "Все" - показываем ВСЕХ (включая учеников), так как есть кнопка фильтра "Ученики"
            // url += `&excludeStudents=true`;
        }

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('Error loading users:', response.status, errorData);
            table.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red;">Ошибка загрузки: ' + (errorData.error || `HTTP ${response.status}`) + '</td></tr>';
            renderUsersPagination(0, page, 0);
            if (window.hideLoading) {
                window.hideLoading();
            }
            return;
        }

        const data = await response.json();

        if (!data.success) {
            table.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red;">Ошибка загрузки</td></tr>';
            renderUsersPagination(0, page, 0);
            if (window.hideLoading) {
                window.hideLoading();
            }
            return;
        }

        let users = data.users || data.students || [];

        // Фильтрация теперь происходит на сервере

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

            const isTeacher = user.role === 'teacher';
            const isLinkedToLp = Boolean(user.appUserId && user.externalLinkStatus === 'linked');
            const platformBadge = isTeacher
                ? `<span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:10px;font-size:0.7em;font-weight:600;${isLinkedToLp ? 'background:rgba(16,185,129,0.15);color:#10b981;' : 'background:rgba(245,158,11,0.15);color:#f59e0b;'}">${isLinkedToLp ? 'LP ✓' : 'нет LP'}</span>`
                : '';

            const platformActions = isTeacher
                ? (isLinkedToLp
                    ? `<button class="table-btn" onclick="openTeacherInPlatform(${jsUserArg(user._id)})">Открыть LP</button>`
                    : `<button class="table-btn" onclick="provisionTeacherPlatform(${jsUserArg(user._id)})">Создать в LP</button>`)
                : '';

            const userFio = formatUserFio(user);

            return `
                <tr data-user-id="${escapeUserText(user._id)}">
                    <td>${escapeUserText(userFio)}${platformBadge}</td>
                    <td>${escapeUserText(user.phone)}</td>
                    <td><span class="role-badge role-${escapeUserText(user.role)}">${escapeUserText(getRoleText(user.role))}</span></td>
                    <td>${escapeUserText(user.email || '—')}</td>
                    <td>${formatDate(user.registeredAt)}</td>
                    <td class="table-actions">
                        ${platformActions}
                        <button class="table-btn" onclick="resetUserPassword(${jsUserArg(user._id)}, ${jsUserArg(userFio)}, ${jsUserArg(user.phone)})">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; vertical-align: middle; margin-right: 4px;">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                            </svg>
                            Пароль
                        </button>
                        <button class="table-btn" onclick="openUserModal(${jsUserArg(user._id)})">${isTeacher ? 'Профиль' : 'Роль'}</button>
                        ${canDelete ? `<button class="table-btn danger" onclick="deleteUser(${jsUserArg(user._id)}, ${jsUserArg(userFio)}, ${jsUserArg(user.role)})">Удалить</button>` : ''}
                    </td>
                </tr>
            `;
        }).join('');

        // Рендерим пагинацию
        renderUsersPagination(data.total, page, data.pages);

    } catch (error) {
        table.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red;">Ошибка подключения</td></tr>';

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
            renderUsers(currentRoleFilter, currentUserSearch, page);
        });
    });
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
            toast.error('Ошибка загрузки данных пользователя');
            return;
        }

        const user = data.student;

        // Заполняем форму
        document.getElementById('userId').value = user._id;
        document.getElementById('userName').value = user.name;
        document.getElementById('userLastName').value = user.lastName || '';
        document.getElementById('userMiddleName').value = user.middleName || '';
        document.getElementById('userPhone').value = user.phone;
        document.getElementById('userEmail').value = user.email || '';
        document.getElementById('userRole').value = user.role;
        document.getElementById('userRole').setAttribute('data-original-role', user.role);

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
        if (user.role === 'teacher') {
            const teacherInfo = user.teacherInfo || {
                directions: user.teacherDirections,
                bio: user.teacherBio,
                photo: user.teacherPhoto,
                displayOrder: user.teacherDisplayOrder,
                scheduleColor: user.teacherScheduleColor,
                weeklyHours: user.teacherWeeklyHours,
                salaryIndividual: user.salaryIndividual,
                salaryGroup: user.salaryGroup,
                salaryOther: user.salaryOther,
            };
            const dirCheckboxes = document.querySelectorAll('#teacherFields input[name="directions"]');
            dirCheckboxes.forEach(cb => {
                cb.checked = teacherInfo.directions?.includes(cb.value) || false;
            });

            const bioInput = document.getElementById('userBio');
            const photoInput = document.getElementById('userPhoto');
            const photoPreview = document.getElementById('teacherPhotoPreview');
            const displayOrderInput = document.getElementById('teacherDisplayOrder');
            const scheduleColorInput = document.getElementById('teacherScheduleColor');
            const weeklyHoursInput = document.getElementById('teacherWeeklyHours');
            const salaryIndividualInput = document.getElementById('teacherSalaryIndividual');
            const salaryGroupInput = document.getElementById('teacherSalaryGroup');
            const salaryOtherInput = document.getElementById('teacherSalaryOther');

            if (bioInput) bioInput.value = teacherInfo.bio || '';
            if (photoInput) photoInput.value = teacherInfo.photo || '';
            if (displayOrderInput) displayOrderInput.value = teacherInfo.displayOrder || 0;
            if (scheduleColorInput) scheduleColorInput.value = teacherInfo.scheduleColor || '#C58A45';
            if (weeklyHoursInput) weeklyHoursInput.value = teacherInfo.weeklyHours || 40;
            if (salaryIndividualInput) salaryIndividualInput.value = teacherInfo.salaryIndividual || 0;
            if (salaryGroupInput) salaryGroupInput.value = teacherInfo.salaryGroup || 0;
            if (salaryOtherInput) salaryOtherInput.value = teacherInfo.salaryOther || 0;

            // Показываем текущее фото если есть
            if (photoPreview && teacherInfo.photo) {
                photoPreview.innerHTML = `
                    <img src="${teacherInfo.photo}"
                         style="max-width: 200px; max-height: 200px; border-radius: 8px; 
                                border: 2px solid rgba(255,255,255,0.2);" 
                         alt="Текущее фото">
                    <p style="margin-top: 10px; opacity: 0.7; font-size: 0.85rem;">Текущее фото</p>
                `;
            }
        }

        document.getElementById('userModal').classList.add('show');

    } catch (error) {
        toast.error('Ошибка подключения к серверу');
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
    const teacherOrderGroup = document.getElementById('teacherOrderGroup');
    const teacherScheduleColorGroup = document.getElementById('teacherScheduleColorGroup');
    const teacherWeeklyHoursGroup = document.getElementById('teacherWeeklyHoursGroup');
    const teacherSalaryGroup = document.querySelector('.teacher-salary-group');

    const isTeacher = role === 'teacher';
    teacherFields.style.display = isTeacher ? 'block' : 'none';
    if (teacherBioGroup) teacherBioGroup.style.display = isTeacher ? 'block' : 'none';
    if (teacherPhotoGroup) teacherPhotoGroup.style.display = isTeacher ? 'block' : 'none';
    if (teacherOrderGroup) teacherOrderGroup.style.display = isTeacher ? 'block' : 'none';
    if (teacherScheduleColorGroup) teacherScheduleColorGroup.style.display = isTeacher ? 'block' : 'none';
    if (teacherWeeklyHoursGroup) teacherWeeklyHoursGroup.style.display = isTeacher ? 'block' : 'none';
    if (teacherSalaryGroup) teacherSalaryGroup.style.display = isTeacher ? 'block' : 'none';
}

// Удалить пользователя (с оптимистичным UI)
async function deleteUser(userId, userName, userRole) {
    if (!isSuperAdmin()) {
        toast.warning('Доступ запрещен. Требуются права супер-администратора.');
        return;
    }

    const confirmMsg = `Вы уверены, что хотите удалить пользователя "${userName}"?\n\nЭто действие нельзя отменить!`;
    if (!await customConfirm(confirmMsg)) {
        return;
    }

    // 🎯 ОПТИМИСТИЧНОЕ УДАЛЕНИЕ - сразу убираем строку из таблицы
    const table = document.getElementById('usersTable');
    if (!table) return;

    // Находим строку пользователя
    const rows = Array.from(table.querySelectorAll('tr'));
    const userRow = rows.find(row => row.dataset.userId === String(userId));

    // Сохраняем HTML строки на случай отката
    const rowHTML = userRow ? userRow.outerHTML : null;
    const rowIndex = userRow ? Array.from(table.children).indexOf(userRow) : -1;

    // Удаляем строку из DOM с анимацией
    if (userRow) {
        userRow.style.opacity = '0.5';
        userRow.style.transition = 'opacity 0.3s ease';
        setTimeout(() => {
            userRow.remove();
            if (table.children.length === 0) {
                table.innerHTML = '<tr><td colspan="6" style="text-align:center; opacity:0.5;">Нет пользователей</td></tr>';
            }
        }, 300);
    }


    try {
        const token = getAuthToken();

        // Определяем endpoint напрямую по переданной роли
        let deleteEndpoint = "";

        console.log(`🔍 DEBUG: userRole = "${userRole}", type = ${typeof userRole}`);
        switch (userRole) {
            case "admin":
                deleteEndpoint = `${API_URL}/users/admins/${userId}`;
                break;
            case "sales_manager":
                deleteEndpoint = `${API_URL}/users/sales-managers/${userId}`;
                break;
            case "teacher":
                deleteEndpoint = `${API_URL}/users/teachers/${userId}`;
                break;
            case "student":
                deleteEndpoint = `${API_URL}/students/${userId}`;
                break;
            default:
                toast.warning("Неизвестная роль пользователя");
                restoreRow();
                return;
        }

        console.log(`🗑️ Удаление: ${userName} (${userRole}) -> ${deleteEndpoint}`);


        const deleteResponse = await fetch(deleteEndpoint, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        console.log(`📡 Ответ: ${deleteResponse.status}`);

        if (!deleteResponse.ok) {
            const errorData = await deleteResponse.json().catch(() => ({}));
            toast.error(`Ошибка удаления: ${errorData.error || 'Не удалось удалить'}`);

            restoreRow();
            return;
        }

        const deleteData = await deleteResponse.json();

        if (deleteData.success) {
            console.log("✅ Результат удаления:", deleteData);
            toast.success(`Пользователь "${userName}" удален`);

            // Обновляем другие списки в фоне
            if (userRole === 'student' && typeof window.renderStudents === 'function') {
                setTimeout(() => {
                    console.log("🔄 Обновление списка учеников...");
                    window.renderStudents(
                        window.currentStudentSearch || '',
                        window.currentStudentPage || 1,
                        window.currentStudentFilter || 'all'
                    ).catch(console.error);
                }, 100);
            }

            if (typeof renderDashboard === 'function') {
                setTimeout(() => renderDashboard().catch(console.error), 100);
            }
        } else {
            toast.error(`Ошибка: ${deleteData.error || 'Не удалось удалить'}`);
            restoreRow();
        }

    } catch (error) {
        console.error('Ошибка при удалении пользователя:', error);
        toast.error('Ошибка подключения к серверу');
        restoreRow();
    }

    // Функция восстановления строки
    function restoreRow() {
        if (rowHTML && rowIndex >= 0) {
            if (table.children.length === 1 && table.children[0].textContent.includes('Нет пользователей')) {
                table.innerHTML = '';
            }
            if (rowIndex === 0) {
                table.insertAdjacentHTML('afterbegin', rowHTML);
            } else {
                table.children[rowIndex - 1]?.insertAdjacentHTML('afterend', rowHTML);
            }
        }
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
            toast.error(`Ошибка: ${data.error || 'Не удалось сбросить пароль'}`);
        }
    } catch (error) {
        toast.error('Ошибка при сбросе пароля');
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
                    ${escapeUserText(title)}
                </h2>
            </div>
            
            <div style="background: rgba(235, 77, 119, 0.1); border: 2px solid var(--pink); border-radius: 8px; padding: 20px; margin-bottom: 25px;">
                <div style="margin-bottom: 15px;">
                    <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Пользователь:</div>
                    <div style="color: var(--admin-text); font-size: 1.1rem; font-weight: 600;">${escapeUserText(userName)}</div>
                </div>
                
                <div style="margin-bottom: 15px;">
                    <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Телефон:</div>
                    <div style="color: var(--admin-text); font-size: 1.1rem; font-weight: 600;">${escapeUserText(userPhone)}</div>
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
                        ">${escapeUserText(password)}</code>
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
            toast.success('Пароль скопирован в буфер обмена!');
        } else {
            toast.error('Не удалось скопировать. Скопируйте вручную.');
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
    const newSalaryGroup = document.querySelector('.new-teacher-salary-group');
    if (bioGroup) bioGroup.style.display = isTeacher ? 'block' : 'none';
    if (photoGroup) photoGroup.style.display = isTeacher ? 'block' : 'none';
    if (newSalaryGroup) newSalaryGroup.style.display = isTeacher ? 'block' : 'none';

    // Форматирование телефона
    const phoneInput = document.getElementById('newUserPhone');
    if (phoneInput) {
        // Удаляем старые обработчики если они есть
        const newPhoneInput = phoneInput.cloneNode(true);
        phoneInput.parentNode.replaceChild(newPhoneInput, phoneInput);

        newPhoneInput.addEventListener('input', function (e) {
            let value = e.target.value.replace(/[^\d+]/g, '');
            if (value.startsWith('8')) {
                value = '+7' + value.substring(1);
            } else if (value.length > 0 && !value.startsWith('+')) {
                value = '+' + value;
            }
            if (value.length > 0) {
                value = '+' + value.replace(/\+/g, '');
            }
            if (value.length > 16) {
                value = value.substring(0, 16);
            }
            e.target.value = value;
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
    const createStudentUserBtn = document.getElementById('createStudentUserBtn');
    const createSalesManagerBtn = document.getElementById('createSalesManagerBtn');
    const createTeacherBtn = document.getElementById('createTeacherBtn');
    const createAdminBtn = document.getElementById('createAdminBtn');

    if (createStudentUserBtn) {
        createStudentUserBtn.addEventListener('click', () => openCreateUserModal('student'));
    }

    if (createSalesManagerBtn) {
        createSalesManagerBtn.addEventListener('click', () => openCreateUserModal('sales_manager'));
    }

    if (createTeacherBtn) {
        createTeacherBtn.addEventListener('click', () => openCreateUserModal('teacher'));
    }

    const provisionAllTeachersBtn = document.getElementById('provisionAllTeachersBtn');
    if (provisionAllTeachersBtn) {
        provisionAllTeachersBtn.addEventListener('click', () => void provisionAllTeachersPlatform());
    }

    if (createAdminBtn) {
        createAdminBtn.addEventListener('click', () => openCreateUserModal('admin'));
    }

    // 📸 Предпросмотр фото преподавателя
    const teacherPhotoFile = document.getElementById('teacherPhotoFile');
    if (teacherPhotoFile) {
        teacherPhotoFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            const preview = document.getElementById('teacherPhotoPreview');

            if (file && preview) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    preview.innerHTML = `
                        <img src="${e.target.result}" 
                             style="max-width: 200px; max-height: 200px; border-radius: 8px; 
                                    border: 2px solid rgba(255,255,255,0.2);" 
                             alt="Предпросмотр">
                        <p style="margin-top: 10px; opacity: 0.7; font-size: 0.85rem;">
                            ${file.name} (${(file.size / 1024).toFixed(0)} KB)
                        </p>
                    `;
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // Форматирование телефона при редактировании пользователя
    const editPhoneInput = document.getElementById('userPhone');
    if (editPhoneInput) {
        editPhoneInput.addEventListener('input', function (e) {
            let value = e.target.value.replace(/[^\d+]/g, '');
            if (value.startsWith('8')) {
                value = '+7' + value.substring(1);
            } else if (value.length > 0 && !value.startsWith('+')) {
                value = '+' + value;
            }
            if (value.length > 0) {
                value = '+' + value.replace(/\+/g, '');
            }
            if (value.length > 16) {
                value = value.substring(0, 16);
            }
            e.target.value = value;
        });
    }

    // Фильтры ролей
    document.querySelectorAll('[data-role]').forEach(btn => {
        btn.addEventListener('click', () => {
            const role = btn.dataset.role;

            document.querySelectorAll('[data-role]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            currentUserPage = 1;  // Сброс на первую страницу

            // Показать прогресс-бар при фильтрации
            if (window.showLoading) {
                window.showLoading();
            }
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
                // Показать прогресс-бар при поиске
                if (window.showLoading) {
                    window.showLoading();
                }
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
            const lastName = document.getElementById('userLastName').value;
            const middleName = document.getElementById('userMiddleName')?.value || '';
            const phone = document.getElementById('userPhone').value;

            try {
                const token = getAuthToken();
                const currentRole = document.getElementById('userRole').getAttribute('data-original-role');
                
                let body = { name, lastName, middleName: middleName.trim() || undefined, phone, role: newRole };

                if (newRole !== currentRole && newRole !== 'teacher') {
                    const confirmMsg = `Изменить роль пользователя на "${getRoleText(newRole)}"?`;
                    if (!await customConfirm(confirmMsg)) {
                        return;
                    }
                }

                if (newRole === 'teacher') {
                    const checkboxes = document.querySelectorAll('#teacherFields input[name="directions"]:checked');
                    body.teacherDirections = Array.from(checkboxes).map(cb => cb.value);

                    const bioInput = document.getElementById('userBio');
                    body.bio = bioInput?.value.trim() || '';

                    const displayOrderInput = document.getElementById('teacherDisplayOrder');
                    body.displayOrder = displayOrderInput?.value ? parseInt(displayOrderInput.value) : 0;
                    body.scheduleColor = document.getElementById('teacherScheduleColor')?.value || '#C58A45';
                    body.weeklyHours = parseInt(document.getElementById('teacherWeeklyHours')?.value || '40', 10);
                    body.salaryIndividual = parseInt(document.getElementById('teacherSalaryIndividual')?.value || '0', 10);
                    body.salaryGroup = parseInt(document.getElementById('teacherSalaryGroup')?.value || '0', 10);
                    body.salaryOther = parseInt(document.getElementById('teacherSalaryOther')?.value || '0', 10);

                    // 📸 Загружаем фото если выбрано
                    let photo = document.getElementById('userPhoto')?.value || '';
                    const photoFileInput = document.getElementById('teacherPhotoFile');

                    if (photoFileInput?.files && photoFileInput.files[0]) {
                        console.log('📸 Загрузка фото преподавателя...');
                        const formData = new FormData();
                        formData.append('photo', photoFileInput.files[0]);

                        const uploadResponse = await fetch(`${API_URL}/users/upload-teacher-photo`, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${token}`
                            },
                            body: formData
                        });

                        if (uploadResponse.ok) {
                            const uploadData = await uploadResponse.json();
                            photo = uploadData.photoUrl;
                            console.log(`✅ Фото загружено: ${photo}`);
                        } else {
                            const uploadData = await uploadResponse.json().catch(() => ({}));
                            throw new Error(uploadData.error || 'Не удалось загрузить фото преподавателя');
                        }
                    }
                    body.photo = photo;
                }

                const response = await fetch(`${API_URL}/users/${userId}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                });

                const data = await response.json();

                if (data.success) {
                    toast.success('Пользователь успешно обновлен');
                    closeUserModal();
                    renderUsers(currentRoleFilter);
                } else {
                    toast.error(`Ошибка: ${data.error || 'Не удалось обновить пользователя'}`);
                }

            } catch (error) {
                toast.error('Ошибка подключения к серверу');
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
            const lastName = document.getElementById('newUserLastName').value;
            const middleName = document.getElementById('newUserMiddleName')?.value || '';
            const phone = document.getElementById('newUserPhone').value;
            const password = document.getElementById('newUserPassword').value;
            const email = document.getElementById("newUserEmail")?.value || "";

            let directions = [];
            let bio = '';
            let photo = '';
            let salaryIndividual = 0;
            let salaryGroup = 0;
            let salaryOther = 0;

            if (role === 'teacher') {
                const checkboxes = document.querySelectorAll('input[name="newDirections"]:checked');
                directions = Array.from(checkboxes).map(cb => cb.value);

                const bioInput = document.getElementById('newUserBio');
                const photoInput = document.getElementById('newUserPhoto');
                if (bioInput) bio = bioInput.value.trim();
                if (photoInput) photo = photoInput.value.trim();

                salaryIndividual = parseInt(document.getElementById('newUserSalaryIndividual')?.value || '0', 10);
                salaryGroup = parseInt(document.getElementById('newUserSalaryGroup')?.value || '0', 10);
                salaryOther = parseInt(document.getElementById('newUserSalaryOther')?.value || '0', 10);
            }

            try {
                const token = getAuthToken();
                let endpoint = '';
                let body = { name, lastName, middleName: middleName.trim() || undefined, phone, password, gender: 'male' };

                switch (role) {
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
                        body.salaryIndividual = salaryIndividual;
                        body.salaryGroup = salaryGroup;
                        body.salaryOther = salaryOther;
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

                    await renderUsers(currentRoleFilter, currentUserSearch, currentUserPage);

                    // Обновляем список учеников в фоне если это был ученик
                    if (role === 'student' && typeof window.renderStudents === 'function') {
                        setTimeout(() => {
                            window.renderStudents(
                                window.currentStudentSearch || '',
                                window.currentStudentPage || 1,
                                window.currentStudentFilter || 'all'
                            ).catch(console.error);
                        }, 100);
                    }

                    // Обновляем дашборд в фоне
                    if (typeof renderDashboard === 'function') {
                        setTimeout(() => renderDashboard().catch(console.error), 100);
                    }
                } else {
                    toast.error(`Ошибка: ${data.error || 'Не удалось создать пользователя'}`);
                }
            } catch (error) {
                console.error(error);
                alert('JS Error: ' + error.message + '\n\n' + error.stack);
                toast.error('Ошибка подключения к серверу');
            }
        });
    }
}

// Экспорт для admin.js
window.initUserHandlers = initUserHandlers;
window.renderUsers = renderUsers;
window.deleteUser = deleteUser;
window.provisionTeacherPlatform = provisionTeacherPlatform;
window.openTeacherInPlatform = openTeacherInPlatform;
window.provisionAllTeachersPlatform = provisionAllTeachersPlatform;

async function provisionTeacherPlatform(teacherId) {
    try {
        const response = await fetch(`${API_URL}/users/teachers/${teacherId}/provision-platform`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            showToast(data.error || 'Не удалось создать аккаунт в платформе', 'error');
            return;
        }
        const login = data.data?.login;
        const tempPassword = data.data?.temporaryPassword;
        let message = data.data?.alreadyLinked
            ? 'Аккаунт уже был связан с платформой'
            : (data.data?.created ? 'Аккаунт преподавателя создан в Learning Platform' : 'Преподаватель привязан к платформе');
        if (login) message += ` (логин: ${login})`;
        if (tempPassword) message += `. Временный пароль: ${tempPassword}`;
        showToast(message, 'success', 12000);
        await renderUsers(currentRoleFilter, currentUserSearch, currentUserPage);
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function openTeacherInPlatform(teacherId) {
    try {
        const response = await fetch(`${API_URL}/students/${teacherId}/sso-token`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            showToast(data.error || 'SSO недоступен', 'error');
            return;
        }
        const token = data.data?.token;
        const loginBase = (data.data?.redirectUrl || 'https://maestro-school.duckdns.org/login').split('?')[0];
        const next = data.data?.next || '/admin/offline-lessons';
        if (!token) {
            showToast('SSO-токен не получен', 'error');
            return;
        }
        const url = `${loginBase}?ssoToken=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`;
        window.open(url, '_blank', 'noopener');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function provisionAllTeachersPlatform() {
    if (!confirm('Создать аккаунты в Learning Platform для всех преподавателей без связи?')) return;
    try {
        if (window.showLoading) window.showLoading();
        const response = await fetch(`${API_URL}/users/teachers/provision-all`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            showToast(data.error || 'Массовое создание не удалось', 'error');
            return;
        }
        const summary = data.data || {};
        showToast(`Готово: ${summary.linked || 0} из ${summary.total || 0} преподавателей связаны с платформой`, 'success', 10000);
        await renderUsers(currentRoleFilter, currentUserSearch, currentUserPage);
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        if (window.hideLoading) window.hideLoading();
    }
}

// Экспорт переменных состояния для обновления списка из других модулей
Object.defineProperty(window, 'currentRoleFilter', {
    get: () => currentRoleFilter,
    set: (val) => { currentRoleFilter = val; }
});
Object.defineProperty(window, 'currentUserPage', {
    get: () => currentUserPage,
    set: (val) => { currentUserPage = val; }
});
Object.defineProperty(window, 'currentUserSearch', {
    get: () => currentUserSearch,
    set: (val) => { currentUserSearch = val; }
});
