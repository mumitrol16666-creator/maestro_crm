// =====================================================
// MEMBERSHIPS MODULE - Управление абонементами
// =====================================================

let currentMembershipStudentId = null;
let currentMembershipStudent = null;

// Открыть модальное окно создания абонемента
async function openMembershipModal() {
    if (!currentViewingStudentId) {
        toast.warning('Ошибка: ученик не выбран');
        return;
    }
    
    try {
        const token = getAuthToken();
        
        // ⚡ МОМЕНТАЛЬНО открываем модалку с загрузкой
        document.getElementById('membershipStudentInfo').innerHTML = '<p style="text-align: center; padding: 20px; opacity: 0.5;">Загрузка...</p>';
        document.getElementById('membershipModal').classList.add('show');
        
        // ⚡ ПАРАЛЛЕЛЬНО загружаем данные В ФОНЕ
        const [studentData, groupsData] = await Promise.all([
            fetch(`${API_URL}/students/${currentViewingStudentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json()),
            fetch(`${API_URL}/groups`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json())
        ]);
        
        const student = studentData.student;
        const allGroups = groupsData.groups || [];
        
        // Проверить есть ли у ученика группы
        const activeGroups = student.groups?.filter(g => g.status === 'active') || [];
        
        if (activeGroups.length === 0) {
            document.getElementById('membershipModal').classList.remove('show');
            toast.warning( 'ОШИБКА\n\nУченик не прикреплён ни к одной группе!\n\nСначала добавьте ученика в группу во вкладке "Группы".');
            return;
        }
        
        currentMembershipStudentId = student._id;
        currentMembershipStudent = student;
        
        // Информация об ученике
        const genderText = student.gender === 'male' ? 'Мужчина' : 'Женщина';
        const groupNames = activeGroups.map(g => g.groupId?.name || 'Группа').join(', ');
        
        document.getElementById('membershipStudentInfo').innerHTML = `
            <div style="font-size: 0.9em;">
                <strong>${student.name}</strong><br>
                Телефон: ${student.phone}<br>
                Пол: ${genderText}<br>
                <span style="color: #eb4d77;">Группы: ${groupNames}</span>
            </div>
        `;
        
        // Заполнить выпадающий список групп
        const groupSelect = document.getElementById('membershipGroupId');
        groupSelect.innerHTML = '<option value="">Выберите группу</option>';
        
        // Сначала показать группы ученика
        activeGroups.forEach(g => {
            if (g.groupId) {
                const option = document.createElement('option');
                option.value = g.groupId._id;
                option.textContent = `${g.groupId.name} (текущая группа ученика)`;
                option.selected = true;
                groupSelect.appendChild(option);
            }
        });
        
        // Потом показать остальные группы
        allGroups.forEach(group => {
            const isStudentGroup = activeGroups.some(g => g.groupId?._id === group._id);
            if (!isStudentGroup) {
                const option = document.createElement('option');
                option.value = group._id;
                option.textContent = group.name;
                groupSelect.appendChild(option);
            }
        });
        
        document.getElementById('membershipStudentId').value = student._id;
        document.getElementById('membershipType').value = '';
        document.getElementById('membershipPreview').textContent = 'Выберите тип абонемента';
        
        document.getElementById('membershipModal').classList.add('show');
    } catch (error) {
        showNotification(notificationWithIcon('error','Ошибка при загрузке данных ученика');
    }
}

// Закрыть модалку абонемента
function closeMembershipModal() {
    document.getElementById('membershipModal').classList.remove('show');
}

// Открыть модальное окно добавления занятий
function openAddClassesModal(studentId, membershipId) {
    document.getElementById('addClassesStudentId').value = studentId;
    document.getElementById('addClassesMembershipId').value = membershipId;
    document.getElementById('addClassesAmount').value = '';
    document.getElementById('addClassesReason').value = '';
    document.getElementById('addClassesModal').classList.add('show');
}

// Закрыть модальное окно добавления занятий
function closeAddClassesModal() {
    document.getElementById('addClassesModal').classList.remove('show');
}

// Загрузить информацию об абонементе ученика
async function loadStudentMembership(studentId, student = null) {
    try {
        const token = getAuthToken();
        
        // Если студент не передан, загружаем
        if (!student) {
            const studentResponse = await fetch(`${API_URL}/students/${studentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const studentData = await studentResponse.json();
            student = studentData.student;
        }
        
        const response = await fetch(`${API_URL}/memberships/student/${studentId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        
        if (data.success && data.memberships && data.memberships.length > 0) {
            const activeMembership = data.memberships.find(m => m.status === 'active');
            
            if (activeMembership) {
                const typeNames = {
                    'trial': 'Пробный',
                    'monthly': 'Месячный',
                    'quarterly': 'Квартальный'
                };
                
                const startDate = new Date(activeMembership.startDate || activeMembership.createdAt).toLocaleDateString('ru');
                
                // Логика отображения заморозок для текущего цикла
                const classesUsed = activeMembership.classesUsed || 0;
                const freezesPerCycle = student.gender === 'female' ? 2 : 1;
                
                const currentCycleNumber = Math.floor(classesUsed / 8);
                const freezesUsedInPreviousCycles = currentCycleNumber * freezesPerCycle;
                const freezesUsedInCurrentCycle = Math.max(0, (activeMembership.freezesUsed || 0) - freezesUsedInPreviousCycles);
                const freezesText = `${Math.min(freezesUsedInCurrentCycle, freezesPerCycle)}/${freezesPerCycle}`;
                
                const userRole = localStorage.getItem('userRole');
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
                                    onclick="openAddClassesModal('${studentId}', '${activeMembership._id}')" 
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
                        <span style="color: #10b981;">Активен</span>
                    </div>
                `;
            } else {
                document.getElementById('studentMembershipInfo').innerHTML = `
                    <div style="text-align: center; padding: 20px; opacity: 0.7;">
                        Нет активного абонемента
                    </div>
                `;
            }
        } else {
            document.getElementById('studentMembershipInfo').innerHTML = `
                <div style="text-align: center; padding: 20px; opacity: 0.7;">
                    Нет активного абонемента
                </div>
            `;
        }
    } catch (error) {
        document.getElementById('studentMembershipInfo').innerHTML = `
            <div style="text-align: center; padding: 20px; color: #ef4444;">
                Ошибка загрузки абонемента
            </div>
        `;
    }
}

// Инициализация обработчиков для memberships
function initMembershipHandlers() {
    // Preview при выборе типа абонемента
    const membershipTypeSelect = document.getElementById('membershipType');
    if (membershipTypeSelect) {
        membershipTypeSelect.addEventListener('change', (e) => {
            const type = e.target.value;
            const preview = document.getElementById('membershipPreview');
            
            if (!type) {
                preview.textContent = 'Выберите тип абонемента';
                return;
            }
            
            const gender = currentMembershipStudent?.gender;
            const freezes = gender === 'female' ? 2 : 1;
            
            let text = '';
            switch(type) {
                case 'trial':
                    text = `Пробный абонемент: 1 занятие<br>Заморозок: 0`;
                    break;
                case 'monthly':
                    text = `Месячный абонемент: 8 занятий (30 дней)<br>Заморозок: ${freezes}`;
                    break;
                case 'quarterly':
                    text = `Квартальный абонемент: 24 занятия (90 дней)<br>Заморозок: ${freezes}`;
                    break;
            }
            
            preview.innerHTML = text;
        });
    }
    
    // Создание абонемента
    const membershipForm = document.getElementById('membershipForm');
    if (membershipForm) {
        membershipForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const studentId = document.getElementById('membershipStudentId').value;
            const groupId = document.getElementById('membershipGroupId').value;
            const type = document.getElementById('membershipType').value;
            
            if (!groupId) {
                toast.warning( 'Выберите группу для абонемента');
                return;
            }
            
            try {
                const token = getAuthToken();
                const response = await fetch(`${API_URL}/memberships`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ studentId, groupId, type })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    const typeNames = {
                        'trial': 'Пробный',
                        'monthly': 'Месячный',
                        'quarterly': 'Квартальный'
                    };
                    
                    toast.success( `Абонемент создан!\n\nТип: ${typeNames[type]}\nЗанятий: ${data.membership.classesRemaining}`));
                    
                    closeMembershipModal();
                    
                    if (currentViewingStudentId) {
                        await viewStudent(currentViewingStudentId);
                    }
                    
                    await renderStudents();
                } else {
                    showNotification(notificationWithIcon('error', `Ошибка: ${data.error ||'Не удалось создать абонемент'}`));
                }
            } catch (error) {
                showNotification(notificationWithIcon('error','Ошибка при создании абонемента');
            }
        });
    }
    
    // Обработка формы добавления занятий
    const addClassesForm = document.getElementById('addClassesForm');
    if (addClassesForm) {
        addClassesForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const membershipId = document.getElementById('addClassesMembershipId').value;
            const amount = parseInt(document.getElementById('addClassesAmount').value);
            const reason = document.getElementById('addClassesReason').value;
            
            if (!amount || amount <= 0) {
                toast.warning( 'Укажите количество занятий');
                return;
            }
            
            try {
                const response = await fetch(`${API_URL}/memberships/${membershipId}/add-classes`, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${getAuthToken()}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ amount, reason })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    toast.success( `Добавлено ${amount} занятий к абонементу!`));
                    closeAddClassesModal();
                    
                    const studentId = document.getElementById('addClassesStudentId').value;
                    if (currentViewingStudentId === studentId) {
                        viewStudent(studentId);
                    }
                    
                    renderStudents();
                } else {
                    showNotification(notificationWithIcon('error', `Ошибка: ${data.error ||'Не удалось добавить занятия'}`));
                }
            } catch (error) {
                showNotification(notificationWithIcon('error','Ошибка при добавлении занятий');
            }
        });
    }
}


