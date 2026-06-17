// =====================================================
// MEMBERSHIPS MODULE - Управление абонементами
// =====================================================

let currentMembershipStudentId = null;
let currentMembershipStudent = null;
let allGroupsData = []; // Кэш групп с ценами направлений
let allMembershipDirections = [];
let allMembershipTeachers = [];
let lastMembershipPricingPreview = null;
let currentMembershipRenewalId = null;

// Форматирование суммы в «22 000»
function fmtMoney(n) {
    return new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0));
}

// Собрать короткую подпись вида «скидка −20% (реферал + льгота)» из breakdown
function buildDiscountSummary(data) {
    if (!data || !data.discountPercent || data.discountPercent <= 0) return '';
    const parts = [];
    if (data.discountReferralPercent > 0)   parts.push('реферал');
    if (data.discountFamilyPercent > 0)     parts.push('семья');
    if (data.discountConcessionPercent > 0) parts.push('льгота');
    if (data.discountManualPercent > 0)     parts.push('доп. скидка');
    const tail = parts.length ? ` (${parts.join(' + ')})` : '';
    return `скидка −${data.discountPercent}%${tail}`;
}

// Отрендерить подпись под ценой (одна строка): «22 000 ₸ · скидка −20% (реферал + льгота)»
function renderPriceHint(hintTextEl, data, unlocked) {
    if (!hintTextEl) return;
    if (unlocked) {
        hintTextEl.innerHTML = '<span style="opacity:0.8;">Цена задана вручную</span>';
        return;
    }
    if (!data) {
        hintTextEl.innerHTML = '';
        return;
    }
    if (!data.discountPercent || data.discountPercent <= 0) {
        hintTextEl.innerHTML = `<span>База: <b>${fmtMoney(data.basePrice)} ₸</b></span>`;
        return;
    }
    const summary = buildDiscountSummary(data);
    hintTextEl.innerHTML = `<span class="price-hint-base">${fmtMoney(data.basePrice)} ₸</span>`
        + `<span class="price-hint-accent">${summary}</span>`;
}

// Запросить разбивку цены со скидками и обновить UI #membershipModal
async function updateMembershipPricePreview() {
    const studentId = document.getElementById('membershipStudentId')?.value;
    const type = document.getElementById('membershipType')?.value;
    const planId = document.getElementById('membershipType')?.selectedOptions?.[0]?.dataset.planId;
    const groupId = document.getElementById('membershipGroupId')?.value;
    const priceInput = document.getElementById('membershipTotalPrice');
    const unlockBtn = document.getElementById('membershipUnlockPrice');
    const hintTextEl = document.getElementById('membershipPriceHintText');

    if (!type || !priceInput) return;

    const unlocked = !!(priceInput.dataset.unlocked === '1');
    const params = new URLSearchParams();
    if (studentId) params.set('studentId', studentId);
    params.set('type', type);
    if (planId) params.set('directionPlanId', planId);
    if (groupId) params.set('groupId', groupId);

    try {
        const resp = await fetch(`${API_URL}/memberships/price-preview?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        const data = await resp.json();
        if (!data.success) return;
        lastMembershipPricingPreview = data;

        if (!unlocked) {
            priceInput.value = data.totalPrice;
        }
        renderPriceHint(hintTextEl, data, unlocked);
        if (unlockBtn) unlockBtn.textContent = unlocked ? 'вернуть авто' : 'изменить';
    } catch (err) {
        console.error('Price preview error:', err);
    }
}
window.updateMembershipPricePreview = updateMembershipPricePreview;

// Переключить режим ручной цены
function toggleMembershipManualPrice() {
    const priceInput = document.getElementById('membershipTotalPrice');
    const unlockBtn = document.getElementById('membershipUnlockPrice');
    const hintTextEl = document.getElementById('membershipPriceHintText');
    if (!priceInput) return;
    const currentlyUnlocked = priceInput.dataset.unlocked === '1';
    const next = !currentlyUnlocked;
    priceInput.dataset.unlocked = next ? '1' : '0';
    priceInput.readOnly = !next;
    if (unlockBtn) {
        unlockBtn.textContent = next ? 'вернуть авто' : 'изменить';
        unlockBtn.classList.toggle('is-active', next);
    }
    if (next) {
        renderPriceHint(hintTextEl, lastMembershipPricingPreview, true);
        priceInput.focus();
        priceInput.select?.();
    } else {
        updateMembershipPricePreview();
    }
}
window.toggleMembershipManualPrice = toggleMembershipManualPrice;

// Открыть модальное окно создания абонемента
async function openMembershipModal(membershipId = null) {
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
        const [studentData, groupsData, directionsData, membershipsData] = await Promise.all([
            fetch(`${API_URL}/students/${currentViewingStudentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json()),
            fetch(`${API_URL}/groups`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json()),
            fetch(`${API_URL}/directions`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json()),
            fetch(`${API_URL}/memberships/student/${currentViewingStudentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json())
        ]);
        
        const student = studentData.student;
        const allGroups = groupsData.groups || [];
        const renewalMembership = membershipId
            ? (membershipsData.memberships || []).find(item => item._id === membershipId || item.id === membershipId)
            : null;
        currentMembershipRenewalId = renewalMembership?._id || renewalMembership?.id || null;
        const modalTitle = document.getElementById('membershipModalTitle');
        if (modalTitle) modalTitle.textContent = renewalMembership ? 'ПРОДЛИТЬ ВЫБРАННЫЙ АБОНЕМЕНТ' : 'СОЗДАТЬ НОВЫЙ АБОНЕМЕНТ';
        
        // Проверить есть ли у ученика группы
        const activeGroups = student.groups?.filter(g => g.status === 'active') || [];
        
        currentMembershipStudentId = student._id;
        currentMembershipStudent = student;
        
        // Информация об ученике
        const genderText = student.gender === 'male' ? 'Мужчина' : student.gender === 'female' ? 'Женщина' : 'Не указан';
        const groupNames = activeGroups.map(g => g.groupId?.name || 'Группа').join(', ');
        
        document.getElementById('membershipStudentInfo').innerHTML = `
            <div style="font-size: 0.9em;">
                <strong>${student.name}</strong><br>
                Телефон: ${student.phone}<br>
                Пол: ${genderText}<br>
                <span style="color: #eb4d77;">Группы: ${groupNames}</span>
                ${renewalMembership ? `
                    <div class="membership-renewal-notice">
                        Продлеваем: <strong>${renewalMembership.plan?.name || renewalMembership.type}</strong>.
                        Новый пакет прибавится именно к этому абонементу.
                    </div>
                ` : `
                    <div class="membership-create-notice">
                        Создаётся отдельный новый абонемент. Существующие абонементы останутся без изменений.
                    </div>
                `}
            </div>
        `;
        
        // Сохраняем группы глобально для доступа при изменении выбора
        allGroupsData = allGroups;
        allMembershipDirections = (directionsData.directions || []).filter(d => d.isActive !== false);

        const directionSelect = document.getElementById('membershipDirectionId');
        directionSelect.innerHTML = '<option value="">Выберите направление</option>';
        allMembershipDirections.forEach(direction => {
            const option = document.createElement('option');
            option.value = direction._id;
            option.textContent = direction.name;
            directionSelect.appendChild(option);
        });

        document.getElementById('membershipStudentGender').value = student.gender || '';
        document.getElementById('membershipLessonFormat').value = renewalMembership?.lessonFormat || 'group';
        delete document.getElementById('membershipFreezesAvailable').dataset.lastType;
        
        document.getElementById('membershipStudentId').value = student._id;
        const renewalGroupId = renewalMembership?.groupId?._id || renewalMembership?.groupId?.id || null;
        const currentGroupId = renewalGroupId || null;
        const currentGroup = allGroups.find(group => group._id === currentGroupId);
        const initialDirection = allMembershipDirections.find(direction =>
            direction._id === renewalMembership?.plan?.direction?.id
            || direction.name === renewalMembership?.plan?.direction?.name
        ) || allMembershipDirections.find(direction => direction.name === currentGroup?.direction)
            || allMembershipDirections[0];
        directionSelect.value = initialDirection?._id || '';
        updateMembershipTypeOptionLabels(currentGroupId);
        if (renewalMembership) {
            document.getElementById('membershipType').value = renewalMembership.type;
            document.getElementById('membershipType').dispatchEvent(new Event('change'));
        }
        ['membershipDirectionId', 'membershipLessonFormat', 'membershipType', 'membershipGroupId'].forEach(id => {
            const field = document.getElementById(id);
            if (field) field.disabled = Boolean(renewalMembership);
        });

        const startDateInput = document.getElementById('membershipStartDate');
        if (startDateInput) {
            const today = new Date();
            const formatted = today.toISOString().split('T')[0];
            startDateInput.value = formatted;
        }

        document.getElementById('membershipModal').classList.add('show');
    } catch (error) {
        toast.error('Ошибка при загрузке данных ученика');
    }
}

// Закрыть модалку абонемента
function closeMembershipModal() {
    document.getElementById('membershipModal').classList.remove('show');
    currentMembershipRenewalId = null;
    ['membershipDirectionId', 'membershipLessonFormat', 'membershipType', 'membershipGroupId'].forEach(id => {
        const field = document.getElementById(id);
        if (field) field.disabled = false;
    });
    // Сбрасываем состояние «Ручная цена»
    const priceInputEl = document.getElementById('membershipTotalPrice');
    const unlockBtn = document.getElementById('membershipUnlockPrice');
    const hintTextEl = document.getElementById('membershipPriceHintText');
    if (priceInputEl) {
        priceInputEl.dataset.unlocked = '0';
        priceInputEl.readOnly = true;
    }
    if (unlockBtn) {
        unlockBtn.textContent = 'изменить';
        unlockBtn.classList.remove('is-active');
    }
    if (hintTextEl) hintTextEl.innerHTML = '';
    lastMembershipPricingPreview = null;
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

// Открыть модальное окно заморозки абонемента
function openFreezeModal(studentId, membershipId, gender = '') {
    document.getElementById('freezeStudentId').value = studentId;
    document.getElementById('freezeMembershipId').value = membershipId;
    document.getElementById('freezeStudentGender').value = gender || '';

    const today = new Date();
    const todayISO = today.toISOString().split('T')[0];
    const in7 = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const startInput = document.getElementById('freezeStartDate');
    const endInput = document.getElementById('freezeEndDate');
    const typeSelect = document.getElementById('freezeType');
    const reasonInput = document.getElementById('freezeReason');

    if (startInput) startInput.value = todayISO;
    if (endInput) endInput.value = in7;
    if (reasonInput) reasonInput.value = '';
    if (typeSelect) {
        typeSelect.value = 'regular';
        // Блокируем "Менструация" если не женщина
        Array.from(typeSelect.options).forEach(opt => {
            if (opt.value === 'period') {
                opt.disabled = gender !== 'female';
            }
        });
    }

    document.getElementById('freezeModal').classList.add('show');
}

// Закрыть модальное окно заморозки
function closeFreezeModal() {
    document.getElementById('freezeModal').classList.remove('show');
}

// Отмена заморозки (с подтверждением)
async function cancelFreeze(freezeId) {
    if (!freezeId) return;
    if (!confirm('Отменить эту заморозку? Если она активна, занятия будут списаны обратно.')) return;

    try {
        const response = await fetch(`${API_URL}/freezes/${freezeId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        const data = await response.json();
        if (data.success) {
            toast.success('Заморозка отменена');
            if (currentViewingStudentId) {
                if (typeof viewStudent === 'function') {
                    viewStudent(currentViewingStudentId);
                }
            }
        } else {
            toast.error(`Ошибка: ${data.error || 'Не удалось отменить заморозку'}`);
        }
    } catch (err) {
        console.error('Cancel freeze error:', err);
        toast.error('Ошибка при отмене заморозки');
    }
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
                
                const freezesText = `${activeMembership.freezesUsed || 0}/${activeMembership.freezesAvailable || 0}`;
                
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
function updateMembershipTypeOptionLabels(preferredGroupId = null) {
    const typeSelect = document.getElementById('membershipType');
    const groupSelect = document.getElementById('membershipGroupId');
    const directionSelect = document.getElementById('membershipDirectionId');
    if (!typeSelect || !groupSelect || !directionSelect) return;

    const direction = allMembershipDirections.find(item => item._id === directionSelect.value);
    const lessonFormat = document.getElementById('membershipLessonFormat')?.value || 'group';
    const formatForPlan = plan => plan.lessonFormat || (plan.type.startsWith('individual_') ? 'individual' : (plan.type === 'trial' ? 'trial' : 'group'));
    const plans = (direction?.plans || []).filter(plan => plan.isActive !== false && formatForPlan(plan) === lessonFormat);
    const previousType = typeSelect.value;

    typeSelect.innerHTML = plans.length
        ? '<option value="">Выберите тариф</option>'
        : '<option value="">У направления нет активных тарифов</option>';
    plans.forEach(plan => {
        const option = document.createElement('option');
        option.value = plan.type;
        option.textContent = `${plan.label} — ${fmtMoney(plan.price)} ₸`;
        option.dataset.planId = plan.id;
        option.dataset.label = plan.label;
        option.dataset.price = plan.price;
        option.dataset.classes = plan.classes;
        option.dataset.days = plan.days;
        option.dataset.lessonFormat = formatForPlan(plan);
        option.dataset.durationMinutes = plan.durationMinutes || 60;
        option.dataset.individualClasses = plan.individualClasses ?? '';
        option.dataset.groupClasses = plan.groupClasses ?? '';
        option.dataset.theoryClasses = plan.theoryClasses ?? '';
        if (plan.type === previousType) option.selected = true;
        typeSelect.appendChild(option);
    });

    const studentGroupIds = new Set(
        (currentMembershipStudent?.groups || [])
            .filter(item => item.status === 'active' && item.groupId?._id)
            .map(item => item.groupId._id)
    );
    const matchingGroups = allGroupsData.filter(group => group.direction === direction?.name || group.direction === 'Ансамбль');
    groupSelect.innerHTML = matchingGroups.length
        ? '<option value="">Без группы</option>'
        : '<option value="">Без группы</option>';
    matchingGroups
        .sort((a, b) => Number(studentGroupIds.has(b._id)) - Number(studentGroupIds.has(a._id)))
        .forEach(group => {
            const option = document.createElement('option');
            option.value = group._id;
            const formatted = window.formatGroupWithSchedule ? window.formatGroupWithSchedule(group) : group.name;
            option.textContent = `${formatted}${studentGroupIds.has(group._id) ? ' (текущая)' : ''}`;
            if (group._id === preferredGroupId) option.selected = true;
            groupSelect.appendChild(option);
        });
    document.getElementById('membershipGroupContainer').style.display = lessonFormat === 'individual' ? 'none' : 'block';

    if (!typeSelect.value && plans.length) {
        typeSelect.value = (plans.find(plan => plan.type === 'monthly') || plans[0]).type;
    }
    typeSelect.dispatchEvent(new Event('change'));
}
window.updateMembershipTypeOptionLabels = updateMembershipTypeOptionLabels;

function initMembershipHandlers() {
    const membershipDirectionSelect = document.getElementById('membershipDirectionId');
    if (membershipDirectionSelect) {
        membershipDirectionSelect.addEventListener('change', () => updateMembershipTypeOptionLabels());
    }

    const membershipFormatSelect = document.getElementById('membershipLessonFormat');
    if (membershipFormatSelect) {
        membershipFormatSelect.addEventListener('change', () => updateMembershipTypeOptionLabels());
    }

    const membershipGroupSelect = document.getElementById('membershipGroupId');
    if (membershipGroupSelect) {
        membershipGroupSelect.addEventListener('change', () => {
            document.getElementById('membershipType').dispatchEvent(new Event('change'));
        });
    }

    const membershipGenderSelect = document.getElementById('membershipStudentGender');
    const membershipFreezesInput = document.getElementById('membershipFreezesAvailable');
    membershipGenderSelect?.addEventListener('change', () => {
        const type = document.getElementById('membershipType').value;
        const selectedFormat = document.getElementById('membershipType').selectedOptions?.[0]?.dataset.lessonFormat;
        const noFreezeTypes = ['trial', 'single_class', 'individual_single', 'individual_package', 'single_lesson'];
        if (selectedFormat === 'individual' || noFreezeTypes.includes(type)) membershipFreezesInput.value = 0;
        else membershipFreezesInput.value = membershipGenderSelect.value === 'female' ? 2 : 1;
        document.getElementById('membershipType').dispatchEvent(new Event('change'));
    });
    membershipFreezesInput?.addEventListener('input', () => document.getElementById('membershipType').dispatchEvent(new Event('change')));

    // Preview при выборе типа абонемента
    const membershipTypeSelect = document.getElementById('membershipType');
    if (membershipTypeSelect) {
        membershipTypeSelect.addEventListener('change', (e) => {
            const type = e.target.value;
            const preview = document.getElementById('membershipPreview');
            const priceInput = document.getElementById('membershipTotalPrice');

            if (!type) {
                preview.textContent = 'Выберите тип абонемента';
                if (priceInput) priceInput.value = 0;
                const hintTextEl = document.getElementById('membershipPriceHintText');
                if (hintTextEl) hintTextEl.innerHTML = '';
                return;
            }

            // Цена и параметры записаны в dataset функцией updateMembershipTypeOptionLabels
            const selectedOpt = e.target.options[e.target.selectedIndex];
            const price = parseInt(selectedOpt?.dataset.price) || 0;
            const classesCount = parseInt(selectedOpt?.dataset.classes) || 0;
            const daysCount = parseInt(selectedOpt?.dataset.days) || 0;
            const labelText = selectedOpt?.dataset.label || type;
            
            if (priceInput) priceInput.value = price;

            const noFreezeTypes = ['trial', 'single_class', 'individual_single', 'individual_package', 'single_lesson'];
            const freezeInput = document.getElementById('membershipFreezesAvailable');
            if (freezeInput && freezeInput.dataset.lastType !== type) {
                freezeInput.value = selectedOpt?.dataset.lessonFormat === 'individual' || noFreezeTypes.includes(type)
                    ? 0
                    : (document.getElementById('membershipStudentGender')?.value === 'female' ? 2 : 1);
                freezeInput.dataset.lastType = type;
            }
            const freezeCount = parseInt(document.getElementById('membershipFreezesAvailable')?.value) || 0;
            const priceFormatted = new Intl.NumberFormat('ru-RU').format(price);
            const formatNames = { group: 'Групповой', individual: 'Индивидуальный', mixed: 'Составной', trial: 'Пробный' };
            const lessonFormat = document.getElementById('membershipLessonFormat')?.value || 'group';
            const parts = [
                ['инд.', selectedOpt?.dataset.individualClasses],
                ['групп.', selectedOpt?.dataset.groupClasses],
                ['теория', selectedOpt?.dataset.theoryClasses],
            ].filter(([, value]) => Number(value) > 0).map(([label, value]) => `${label}: ${value}`);

            const daysText = daysCount >= 365 ? 'Безлимит' : `${daysCount} дн.`;
            preview.innerHTML = `${formatNames[lessonFormat]} · ${labelText}: ${classesCount} зан. (${daysText})${parts.length ? `<br>Состав: ${parts.join(' · ')}` : ''}<br>Базовая стоимость: ${priceFormatted} ₸<br>Заморозок: ${freezeCount}`;

            // Показать/скрыть выбор группы
            const groupContainer = document.getElementById('membershipGroupContainer');
            if (groupContainer) {
                const isIndividualType = selectedOpt?.dataset.lessonFormat === 'individual';
                groupContainer.style.display = isIndividualType ? 'none' : 'block';
                if (isIndividualType) {
                    document.getElementById('membershipGroupId').value = '';
                }
            }

            // Запрашиваем разбивку цены со скидками
            updateMembershipPricePreview();
        });
    }

    // Кнопка-ссылка «изменить» — переключает ручной режим ввода цены
    const unlockBtn = document.getElementById('membershipUnlockPrice');
    if (unlockBtn) {
        unlockBtn.addEventListener('click', () => toggleMembershipManualPrice());
    }


    
    // Создание абонемента
    const membershipForm = document.getElementById('membershipForm');
    if (membershipForm) {
        membershipForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const studentId = document.getElementById('membershipStudentId').value;
            const groupId = document.getElementById('membershipGroupId').value;
            const type = document.getElementById('membershipType').value;
            const directionPlanId = document.getElementById('membershipType').selectedOptions?.[0]?.dataset.planId;
            const lessonFormat = document.getElementById('membershipLessonFormat').value;
            const gender = document.getElementById('membershipStudentGender').value;
            const freezesAvailable = parseInt(document.getElementById('membershipFreezesAvailable').value);
            const startDate = document.getElementById('membershipStartDate').value;
            
            const totalPrice = parseInt(document.getElementById('membershipTotalPrice').value) || 0;
            const priceInputEl = document.getElementById('membershipTotalPrice');
            const unlockPriceChecked = priceInputEl?.dataset.unlocked === '1';
            
            if (!directionPlanId) {
                toast.warning('Выберите направление и тариф');
                return;
            }
            if (!gender) {
                toast.warning('Укажите пол ученика');
                return;
            }

            if (!startDate) {
                toast.warning('Укажите дату начала абонемента');
                return;
            }
            try {
                const token = getAuthToken();
                
                const requestBody = {
                    studentId,
                    groupId,
                    type,
                    directionPlanId,
                    lessonFormat,
                    gender,
                    freezesAvailable,
                    startDate,
                    basePriceOverride: unlockPriceChecked && totalPrice > 0 ? totalPrice : undefined,
                    forceNew: !currentMembershipRenewalId
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
                    const scheduleMsg = data.scheduleGeneration?.created
                        ? `\nВ расписание добавлено занятий: ${data.scheduleGeneration.created}`
                        : '';

                    const selectedTariffName = document.getElementById('membershipType').selectedOptions?.[0]?.dataset.label || type;
                    toast.success(`Абонемент создан!\n\nТариф: ${selectedTariffName}\nЗанятий: ${data.membership.classesRemaining}${scheduleMsg}\n\nДеньги можно внести отдельным платежом.`);
                    
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

    // Обработка формы заморозки
    const freezeForm = document.getElementById('freezeForm');
    if (freezeForm) {
        freezeForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const studentId = document.getElementById('freezeStudentId').value;
            const membershipId = document.getElementById('freezeMembershipId').value;
            const type = document.getElementById('freezeType').value;
            const startDate = document.getElementById('freezeStartDate').value;
            const endDate = document.getElementById('freezeEndDate').value;
            const reason = document.getElementById('freezeReason').value.trim();

            if (!membershipId || !type || !startDate || !endDate) {
                toast.warning('Заполните все обязательные поля');
                return;
            }
            if (new Date(endDate) < new Date(startDate)) {
                toast.warning('Дата окончания не может быть раньше даты начала');
                return;
            }

            try {
                const response = await fetch(`${API_URL}/freezes`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${getAuthToken()}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        membershipId,
                        type,
                        startDate,
                        endDate,
                        reason: reason || undefined
                    })
                });

                const data = await response.json();

                if (data.success) {
                    const status = data.freeze && data.freeze.status;
                    if (status === 'pending') {
                        toast.success('Заморозка создана и ожидает одобрения');
                    } else {
                        toast.success('Заморозка активирована');
                    }
                    closeFreezeModal();

                    if (studentId && typeof viewStudent === 'function') {
                        viewStudent(studentId);
                    }
                    if (typeof renderStudents === 'function') {
                        renderStudents();
                    }
                } else {
                    toast.error(`Ошибка: ${data.error || 'Не удалось создать заморозку'}`);
                }
            } catch (err) {
                console.error('❌ Freeze request error:', err);
                toast.error('Ошибка при создании заморозки');
            }
        });
    }
}

// Экспорт для admin.js
window.initMembershipHandlers = initMembershipHandlers;
window.openFreezeModal = openFreezeModal;
window.closeFreezeModal = closeFreezeModal;
window.cancelFreeze = cancelFreeze;
