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
        
        // Заполнить выпадающий список групп с расписанием
        const groupSelect = document.getElementById('membershipGroupId');
        groupSelect.innerHTML = '<option value="">Выберите группу</option>';
        
        // Сначала показать группы ученика
        activeGroups.forEach(g => {
            if (g.groupId) {
                const option = document.createElement('option');
                option.value = g.groupId._id;
                // Используем форматирование с расписанием + пометка
                const formatted = window.formatGroupWithSchedule ? 
                    window.formatGroupWithSchedule(g.groupId) : 
                    g.groupId.name;
                option.textContent = `${formatted} (текущая)`;
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
                // Используем форматирование с расписанием
                option.textContent = window.formatGroupWithSchedule ? 
                    window.formatGroupWithSchedule(group) : 
                    group.name;
                groupSelect.appendChild(option);
            }
        });
        
        document.getElementById('membershipStudentId').value = student._id;
        document.getElementById('membershipType').value = '';
        document.getElementById('membershipPreview').textContent = 'Выберите тип абонемента';
        
        document.getElementById('membershipModal').classList.add('show');
    } catch (error) {
        toast.error('Ошибка при загрузке данных ученика');
    }
}

// Закрыть модалку абонемента
function closeMembershipModal() {
    document.getElementById('membershipModal').classList.remove('show');
}

// Открыть модальное окно добавления/списания занятий
function openAddClassesModal(studentId, membershipId, mode = 'add', availableClasses = null) {
    const normalizedMode = mode === 'remove' ? 'remove' : 'add';
    
    document.getElementById('addClassesStudentId').value = studentId;
    document.getElementById('addClassesMembershipId').value = membershipId;
    document.getElementById('addClassesMode').value = normalizedMode;
    document.getElementById('addClassesAvailable').value = Number.isFinite(availableClasses) ? availableClasses : '';
    
    document.getElementById('addClassesAmount').value = '';
    document.getElementById('addClassesReason').value = '';
    
    const amountInput = document.getElementById('addClassesAmount');
    const reasonTextarea = document.getElementById('addClassesReason');
    const modalTitle = document.getElementById('addClassesModalTitle');
    const submitButton = document.getElementById('addClassesSubmit');
    const noticeElement = document.getElementById('addClassesNotice');
    
    const available = Number.isFinite(availableClasses) ? availableClasses : null;
    amountInput.min = 1;
    if (normalizedMode === 'remove' && available !== null) {
        amountInput.max = available > 0 ? available : 1;
        amountInput.setAttribute('max', amountInput.max);
    } else {
        amountInput.max = 50;
        amountInput.setAttribute('max', '50');
    }
    
    if (normalizedMode === 'remove' && available === 0) {
        amountInput.value = 0;
        amountInput.disabled = true;
    } else {
        amountInput.disabled = false;
    }
    
    modalTitle.textContent = normalizedMode === 'remove' ? 'СПИСАТЬ ЗАНЯТИЯ' : 'ДОБАВИТЬ ЗАНЯТИЯ';
    submitButton.textContent = normalizedMode === 'remove' ? 'СПИСАТЬ ЗАНЯТИЯ' : 'ДОБАВИТЬ ЗАНЯТИЯ';
    reasonTextarea.placeholder = normalizedMode === 'remove'
        ? 'Например: Исправление ошибки, списание бонусных занятий'
        : 'Например: Доплата за дополнительные занятия';
    
    if (noticeElement) {
        noticeElement.textContent = normalizedMode === 'remove'
            ? '⚠️ Списанные занятия будут немедленно убраны из абонемента и могут завершить его действие'
            : '⚠️ Добавленные занятия будут учтены в абонементе и продлят его действие';
    }
    
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
                    'single_class': 'Разовое занятие',
                    'monthly': 'Месячный',
                    'monthly_12': 'Месячный (12 занятий)',
                    'quarterly': 'Квартальный',
                    'individual_single': 'Индивидуальное разовое',
                    'individual_package': 'Индивидуальный абонемент'
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
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <button 
                                        onclick="openAddClassesModal('${studentId}', '${activeMembership._id}', 'add', ${classesRemaining})" 
                                        class="icon-btn"
                                        title="Добавить занятия"
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                            <line x1="12" y1="5" x2="12" y2="19"></line>
                                            <line x1="5" y1="12" x2="19" y2="12"></line>
                                        </svg>
                                    </button>
                                    <button 
                                        onclick="openAddClassesModal('${studentId}', '${activeMembership._id}', 'remove', ${classesRemaining})" 
                                        class="icon-btn"
                                        title="Списать занятия"
                                        ${classesRemaining <= 0 ? 'disabled style="opacity: 0.4; cursor: not-allowed;"' : ''}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                            <line x1="5" y1="12" x2="19" y2="12"></line>
                                        </svg>
                                    </button>
                                </div>
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
    // 💰 Обработчик для radio buttons оплаты
    const paymentTypeRadios = document.querySelectorAll('input[name="paymentType"]');
    const advanceAmountGroup = document.getElementById('advanceAmountGroup');
    const advanceDueDateGroup = document.getElementById('advanceDueDateGroup');
    
    paymentTypeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'advance') {
                advanceAmountGroup.style.display = 'block';
                advanceDueDateGroup.style.display = 'block';
            } else {
                advanceAmountGroup.style.display = 'none';
                advanceDueDateGroup.style.display = 'none';
            }
        });
    });
    
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
                case 'single_class':
                    text = `Разовое занятие: 1 занятие<br>Заморозок: 0`;
                    break;
                case 'monthly':
                    text = `Месячный абонемент: 8 занятий (30 дней)<br>Заморозок: ${freezes}`;
                    break;
                case 'monthly_12':
                    text = `Месячный абонемент: 12 занятий (30 дней)<br>Заморозок: ${freezes}`;
                    break;
                case 'quarterly':
                    text = `Квартальный абонемент: 24 занятия (90 дней)<br>Заморозок: ${freezes}`;
                    break;
                case 'individual_single':
                    text = `Индивидуальное разовое: 1 занятие<br>Стоимость: 10,000₸<br>Заморозок: 0`;
                    break;
                case 'individual_package':
                    text = `Индивидуальный абонемент: 8 занятий<br>Стоимость: 55,900₸<br>Заморозок: ${freezes}`;
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
            
            // 💰 Получить payment данные
            const paymentType = document.querySelector('input[name="paymentType"]:checked')?.value || 'later';
            const totalPrice = parseInt(document.getElementById('membershipTotalPrice').value) || 0;
            const advanceAmount = parseInt(document.getElementById('membershipAdvanceAmount').value) || 0;
            const advanceDueDate = document.getElementById('membershipAdvanceDueDate').value;
            
            if (!groupId) {
                toast.warning('Выберите группу для абонемента');
                return;
            }
            
            if (paymentType === 'advance' && advanceAmount >= totalPrice) {
                toast.warning('Сумма аванса должна быть меньше общей стоимости');
                return;
            }
            
            try {
                const token = getAuthToken();
                
                const requestBody = { 
                    studentId, 
                    groupId, 
                    type,
                    // 💰 Добавляем payment поля
                    paymentType,
                    totalPrice,
                    advanceAmount: paymentType === 'advance' ? advanceAmount : undefined,
                    advanceDueDate: paymentType === 'advance' && advanceDueDate ? advanceDueDate : undefined
                };
                
                const response = await fetch(`${API_URL}/memberships`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody)
                });
                
                const data = await response.json();
                
                console.log(`💰 Membership created response:`, data);
                
                if (data.success) {
                    const typeNames = {
                        'trial': 'Пробный',
                        'monthly': 'Месячный',
                        'monthly_12': 'Месячный (12 занятий)',
                        'quarterly': 'Квартальный'
                    };
                    
                    const paymentMsg = paymentType === 'full' ? ' (оплачено)' :
                                      paymentType === 'advance' ? ` (аванс ${advanceAmount}₸)` : '';
                    
                    toast.success(`Абонемент создан!${paymentMsg}\n\nТип: ${typeNames[type]}\nЗанятий: ${data.membership.classesRemaining}`);
                    
                    closeMembershipModal();
                    
                    // ⚡ СНАЧАЛА обновляем профиль, ПОТОМ таблицу студентов
                    if (currentViewingStudentId) {
                        // Обновляем профиль в фоне
                        setTimeout(async () => {
                            await viewStudent(currentViewingStudentId);
                            await renderStudents();
                        }, 100);
                    } else {
                        await renderStudents();
                    }
                } else {
                    toast.error(`Ошибка: ${data.error || 'Не удалось создать абонемент'}`);
                }
            } catch (error) {
                toast.error('Ошибка при создании абонемента');
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
            const mode = document.getElementById('addClassesMode').value || 'add';
            const availableRaw = document.getElementById('addClassesAvailable').value;
            const available = availableRaw !== '' ? parseInt(availableRaw) : null;
            
            // Adding classes to membership
            
            if (!amount || amount <= 0) {
                const message = mode === 'remove'
                    ? 'Укажите количество занятий для списания'
                    : 'Укажите количество занятий для добавления';
                toast.warning(message);
                return;
            }
            
            if (mode === 'remove' && available !== null && amount > available) {
                toast.warning(`Нельзя списать больше, чем доступно. Осталось ${available}`);
                return;
            }
            
            if (!reason || reason.trim() === '') {
                const message = mode === 'remove'
                    ? 'Укажите причину списания занятий'
                    : 'Укажите причину добавления занятий';
                toast.warning(message);
                return;
            }
            
            try {
                const requestBody = { amount, reason: reason.trim() };
                // Sending request to server
                
                const endpoint = mode === 'remove' ? 'remove-classes' : 'add-classes';
                
                const response = await fetch(`${API_URL}/memberships/${membershipId}/${endpoint}`, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${getAuthToken()}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody)
                });
                
                const data = await response.json();
                // Server response received
                
                if (data.success) {
                    const successMessage = mode === 'remove'
                        ? `Списано ${amount} занятий с абонемента`
                        : `Добавлено ${amount} занятий к абонементу!`;
                    toast.success(successMessage);
                    closeAddClassesModal();
                    
                    const studentId = document.getElementById('addClassesStudentId').value;
                    
                    // Обновляем только строку студента в списке СРАЗУ (до обновления профиля)
                    if (typeof window.updateStudentRow === 'function') {
                        window.updateStudentRow(studentId, data.membership.classesRemaining);
                    }
                    
                    // Затем обновляем только абонемент в профиле, если он открыт (БЕЗ полной перезагрузки!)
                    if (currentViewingStudentId === studentId) {
                        // Используем новую функцию из students.js, если доступна
                        if (typeof updateStudentMembershipInProfile === 'function') {
                            await updateStudentMembershipInProfile(studentId);
                        } else if (typeof window.updateStudentMembershipInProfile === 'function') {
                            await window.updateStudentMembershipInProfile(studentId);
                        } else {
                            // Fallback - полная перезагрузка если функция недоступна
                            viewStudent(studentId);
                        }
                    }
                    
                    // Если функция не найдена - перерисовываем весь список
                    if (typeof window.updateStudentRow !== 'function') {
                        renderStudents();
                    }
                } else {
                    console.error('❌ Ошибка от сервера:', data.error);
                    const errorMessage = mode === 'remove'
                        ? `Ошибка: ${data.error || 'Не удалось списать занятия'}`
                        : `Ошибка: ${data.error || 'Не удалось добавить занятия'}`;
                    toast.error(errorMessage);
                }
            } catch (error) {
                console.error('❌ Ошибка запроса:', error);
                const errorMessage = mode === 'remove'
                    ? 'Ошибка при списании занятий'
                    : 'Ошибка при добавлении занятий';
                toast.error(errorMessage);
            }
        });
    }
}

// Экспорт для admin.js
window.initMembershipHandlers = initMembershipHandlers;
