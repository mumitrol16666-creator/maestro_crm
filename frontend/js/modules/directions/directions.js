// =====================================================
// DIRECTIONS MODULE - Управление направлениями
// =====================================================

// Отобразить направления
let currentDirectionPlans = [];
const maestroTariffTypes = [
    ['hybrid_1', 'Гибрид 1'], ['group_evening', 'Группа вечер'], ['group_mini', 'Группа мини'],
    ['duet', 'Дуэт'], ['individual_1_2', 'Индив 1-2'], ['individual_2_2', 'Индив 2-2'],
    ['individual_4_long', 'Индив 4'], ['individual_archived', 'Индивидуальный (Архивный)'],
    ['individual_1', 'Индивидуальный 1'], ['individual_2', 'Индивидуальный 2'],
    ['individual_3', 'Индивидуальный 3'], ['individual_4', 'Индивидуальный 4'],
    ['individual_8_25', 'Индивидуальный 8 по 25'], ['individual_year', 'Индивидуальный год'],
    ['single_lesson', 'Одноразовые уроки'], ['theory', 'Теория'], ['quartet_only', 'Только квартет'],
];

async function renderDirections() {
    const directions = await fetchDirections();
    const tableBody = document.getElementById('directionsTable');
    
    if (!tableBody) return;
    
    if (directions.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; padding: 40px; opacity: 0.5;">
                    Направления не найдены
                </td>
            </tr>
        `;
        return;
    }
    
    tableBody.innerHTML = directions.map(direction => `
        <tr>
            <td>
                <div style="font-weight: 600;">${direction.name}</div>
                <div style="font-size: 0.85rem; opacity: 0.7; margin-top: 3px;">${direction.description || ''}</div>
                <div style="font-size: 0.75rem; opacity: 0.6; margin-top: 3px;">От ${direction.minAge} лет • ${direction.level}</div>
                <div style="font-size: 0.75rem; opacity: 0.8; margin-top: 5px; color: var(--pink);">
                    ${(direction.plans || []).filter(plan => plan.isActive !== false).length} активных тарифов
                </div>
            </td>
            <td>${direction.order}</td>
            <td>
                <span class="status-badge ${direction.isActive ? 'status-active' : 'status-inactive'}">
                    ${direction.isActive ? 'Активно' :'Неактивно'}
                </span>
            </td>
            <td>
                <button class="table-btn" onclick="editDirection('${direction._id}')">Редактировать</button>
                <button class="table-btn danger" onclick="deleteDirection('${direction._id}', '${direction.name}')">Удалить</button>
            </td>
        </tr>
    `).join('');
}

// Открыть модальное окно создания направления
function openDirectionModal() {
    const modal = document.getElementById('directionModal');
    const form = document.getElementById('directionForm');
    const title = document.getElementById('directionModalTitle');
    
    form.reset();
    document.getElementById('directionId').value = '';
    title.textContent = 'ДОБАВИТЬ НАПРАВЛЕНИЕ';
    
    currentDirectionPlans = [
        { label: 'Новый групповой тариф', type: 'group_evening', classes: 8, days: 30, price: 20000, lessonFormat: 'group', durationMinutes: 60, isActive: true }
    ];
    renderDirectionPlans();

    modal.classList.add('show');
}

// Редактировать направление
async function editDirection(id) {
    try {
        const response = await fetch(`${API_URL}/directions`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        const data = await response.json();
        const direction = data.directions.find(d => d._id === id);
        
        if (!direction) {
            toast.warning( 'Направление не найдено');
            return;
        }
        
        document.getElementById('directionId').value = direction._id;
        document.getElementById('directionName').value = direction.name;
        document.getElementById('directionDescription').value = direction.description || '';
        document.getElementById('directionMinAge').value = direction.minAge || 0;
        document.getElementById('directionLevel').value = direction.level || '';
        document.getElementById('directionPriceTrial').value = direction.pricing?.trial || 2000;
        document.getElementById('directionPriceMonth').value = direction.pricing?.month || 22000;
        document.getElementById('directionPriceThreeMonths').value = direction.pricing?.threeMonths || 55000;
        document.getElementById('directionOrder').value = direction.order;
        document.getElementById('directionModalTitle').textContent = 'РЕДАКТИРОВАТЬ НАПРАВЛЕНИЕ';
        
        if (direction.plans && direction.plans.length > 0) {
            currentDirectionPlans = [...direction.plans];
        } else {
            currentDirectionPlans = [
                { label: 'Пробное (1 занятие)', type: 'trial', classes: 1, days: 7, price: direction.pricing?.trial || 2000, isActive: true },
                { label: 'Разовое занятие (1 занятие)', type: 'single_class', classes: 1, days: 1, price: 3500, isActive: true },
                { label: 'Месячный (8 занятий)', type: 'monthly', classes: 8, days: 30, price: direction.pricing?.month || 22000, isActive: true },
                { label: 'Трёхмесячный (24 занятия)', type: 'quarterly', classes: 24, days: 90, price: direction.pricing?.threeMonths || 55000, isActive: true }
            ];
        }
        renderDirectionPlans();

        document.getElementById('directionModal').classList.add('show');
    } catch (error) {
        toast.error('Ошибка при загрузке направления');
    }
}

// Закрыть модальное окно направления
function closeDirectionModal() {
    document.getElementById('directionModal').classList.remove('show');
}

// Удалить направление
async function deleteDirection(id, name) {
    if (!await customConfirm(`Вы уверены, что хотите удалить направление "${name}"?`, {icon: 'warning'})) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/directions/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            toast.error( data.error || 'Ошибка при удалении направления');
            return;
        }
        
        toast.success( 'Направление успешно удалено');
        renderDirections();
    } catch (error) {
        toast.error('Ошибка при удалении направления');
    }
}

// Обработка формы направления
document.getElementById('directionForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const id = document.getElementById('directionId').value;
    const name = document.getElementById('directionName').value.trim();
    const description = document.getElementById('directionDescription').value.trim();
    const minAge = parseInt(document.getElementById('directionMinAge').value);
    const level = document.getElementById('directionLevel').value.trim();
    const priceTrial = parseInt(document.getElementById('directionPriceTrial').value) || 2000;
    const priceMonth = parseInt(document.getElementById('directionPriceMonth').value) || 22000;
    const priceThreeMonths = parseInt(document.getElementById('directionPriceThreeMonths').value) || 55000;
    const order = parseInt(document.getElementById('directionOrder').value) || 0;
    
    if (!name || !description || !minAge || !level) {
        toast.warning( 'Заполните все обязательные поля');
        return;
    }

    if (currentDirectionPlans.length === 0) {
        toast.warning('Добавьте хотя бы один абонемент');
        return;
    }
    
    try {
        const url = id 
            ? `${API_URL}/directions/${id}`
            : `${API_URL}/directions`;
        
        const method = id ? 'PATCH' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({ 
                name, 
                description, 
                minAge, 
                level, 
                pricing: {
                    trial: priceTrial,
                    month: priceMonth,
                    threeMonths: priceThreeMonths
                },
                plans: currentDirectionPlans,
                order 
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            toast.error( data.error || 'Ошибка при сохранении направления');
            return;
        }
        
        toast.warning( id ? 'Направление успешно обновлено' : 'Направление успешно создано');
        closeDirectionModal();
        renderDirections();
    } catch (error) {
        toast.error('Ошибка при сохранении направления');
    }
});

// Управление планами
function renderDirectionPlans() {
    const list = document.getElementById('directionPlansList');
    if (!list) return;
    
    list.innerHTML = currentDirectionPlans.map((plan, i) => `
        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); padding: 20px; border-radius: 12px; position: relative; margin-bottom: 15px;">
            <button type="button" onclick="removeDirectionPlan(${i})" style="position: absolute; top: 15px; right: 15px; background: rgba(220, 53, 69, 0.15); border: none; color: #ff4d4f; border-radius: 8px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; font-size: 20px; line-height: 1;" title="Удалить">&times;</button>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-right: 30px;">
                <div style="grid-column: 1 / -1;">
                    <label style="font-size: 0.85rem; margin-bottom: 6px; display: block; color: var(--admin-text); opacity: 0.8; font-weight: 600; text-transform: uppercase;">Название</label>
                    <input type="text" class="admin-input" style="margin: 0; width: 100%;" value="${plan.label}" onchange="updateDirectionPlan(${i}, 'label', this.value)" placeholder="Например: 8 занятий" required>
                </div>
                
                <div style="grid-column: 1 / -1;">
                    <label style="font-size: 0.85rem; margin-bottom: 6px; display: block; color: var(--admin-text); opacity: 0.8; font-weight: 600; text-transform: uppercase;">Формат тарифа</label>
                    <select class="admin-input" style="margin: 0; width: 100%;" onchange="updateDirectionPlan(${i}, 'type', this.value)" required>
                        ${maestroTariffTypes.map(([type, label]) => `<option value="${type}" ${plan.type === type ? 'selected' : ''}>${label}</option>`).join('')}
                    </select>
                </div>

                <div>
                    <label style="font-size: 0.85rem; margin-bottom: 6px; display: block; color: var(--admin-text); opacity: 0.8; font-weight: 600; text-transform: uppercase;">Цена (₸)</label>
                    <input type="number" class="admin-input" style="margin: 0; width: 100%;" value="${plan.price}" min="0" onchange="updateDirectionPlan(${i}, 'price', this.value)" required>
                </div>

                <div>
                    <label style="font-size: 0.85rem; margin-bottom: 6px; display: block; color: var(--admin-text); opacity: 0.8; font-weight: 600; text-transform: uppercase;">Занятий</label>
                    <input type="number" class="admin-input" style="margin: 0; width: 100%;" value="${plan.classes}" min="1" onchange="updateDirectionPlan(${i}, 'classes', this.value)" required>
                </div>
                
                <div>
                    <label style="font-size: 0.85rem; margin-bottom: 6px; display: block; color: var(--admin-text); opacity: 0.8; font-weight: 600; text-transform: uppercase;">Дней действия</label>
                    <input type="number" class="admin-input" style="margin: 0; width: 100%;" value="${plan.days}" min="1" onchange="updateDirectionPlan(${i}, 'days', this.value)" required>
                </div>

                <div>
                    <label style="font-size: 0.85rem; margin-bottom: 6px; display: block; color: var(--admin-text); opacity: 0.8; font-weight: 600; text-transform: uppercase;">Формат урока</label>
                    <select class="admin-input" style="margin: 0; width: 100%;" onchange="updateDirectionPlan(${i}, 'lessonFormat', this.value)" required>
                        <option value="group" ${plan.lessonFormat === 'group' ? 'selected' : ''}>Групповой</option>
                        <option value="individual" ${plan.lessonFormat === 'individual' ? 'selected' : ''}>Индивидуальный</option>
                        <option value="mixed" ${plan.lessonFormat === 'mixed' ? 'selected' : ''}>Составной</option>
                        <option value="trial" ${plan.lessonFormat === 'trial' ? 'selected' : ''}>Пробный</option>
                    </select>
                </div>

                <div>
                    <label style="font-size: 0.85rem; margin-bottom: 6px; display: block; color: var(--admin-text); opacity: 0.8; font-weight: 600; text-transform: uppercase;">Минут в занятии</label>
                    <input type="number" class="admin-input" style="margin: 0; width: 100%;" value="${plan.durationMinutes || 60}" min="1" onchange="updateDirectionPlan(${i}, 'durationMinutes', this.value)" required>
                </div>

                <div style="grid-column: 1 / -1;">
                    <label style="font-size: 0.85rem; margin-bottom: 8px; display: block; color: var(--admin-text); opacity: 0.8; font-weight: 600; text-transform: uppercase;">Состав абонемента</label>
                    <div style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px;">
                        <input type="number" class="admin-input" style="margin:0;" value="${plan.individualClasses ?? 0}" min="0" onchange="updateDirectionPlan(${i}, 'individualClasses', this.value)" placeholder="Индивидуальных">
                        <input type="number" class="admin-input" style="margin:0;" value="${plan.groupClasses ?? 0}" min="0" onchange="updateDirectionPlan(${i}, 'groupClasses', this.value)" placeholder="Групповых">
                        <input type="number" class="admin-input" style="margin:0;" value="${plan.theoryClasses ?? 0}" min="0" onchange="updateDirectionPlan(${i}, 'theoryClasses', this.value)" placeholder="Теория">
                    </div>
                    <small style="opacity:.65;">Для обычного тарифа оставьте нули. Для составного сумма должна совпадать с общим количеством занятий.</small>
                </div>

                <div style="grid-column: 1 / -1; margin-top: 10px;">
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 0.95rem;">
                        <input type="checkbox" ${plan.isActive ? 'checked' : ''} onchange="updateDirectionPlan(${i}, 'isActive', this.checked)" style="width: 20px; height: 20px; accent-color: #eb4d77; cursor: pointer;">
                        <span>Активен (доступен для продажи)</span>
                    </label>
                </div>
            </div>
        </div>
    `).join('');
}

window.addDirectionPlanRow = function() {
    const usedTypes = new Set(currentDirectionPlans.map(plan => plan.type));
    const availableTypes = maestroTariffTypes.map(([type]) => type);
    const nextType = availableTypes.find(type => !usedTypes.has(type));
    if (!nextType) {
        toast.warning('Все доступные форматы тарифов уже добавлены');
        return;
    }
    currentDirectionPlans.push({
        label: 'Новый абонемент',
        type: nextType,
        classes: 8,
        days: 30,
        price: 20000,
        lessonFormat: nextType.startsWith('individual_') || nextType === 'single_lesson' ? 'individual' : 'group',
        durationMinutes: 60,
        individualClasses: 0,
        groupClasses: 0,
        theoryClasses: 0,
        isActive: true,
        order: currentDirectionPlans.length
    });
    renderDirectionPlans();
};

window.removeDirectionPlan = function(index) {
    if (confirm('Удалить этот абонемент?')) {
        currentDirectionPlans.splice(index, 1);
        renderDirectionPlans();
    }
};

window.updateDirectionPlan = function(index, field, value) {
    if (field === 'price' || field === 'classes' || field === 'days' || field === 'order' || field === 'durationMinutes'
        || field === 'individualClasses' || field === 'groupClasses' || field === 'theoryClasses') {
        currentDirectionPlans[index][field] = parseInt(value) || 0;
    } else {
        currentDirectionPlans[index][field] = value;
    }
};

// Кнопка создания направления
document.getElementById('createDirectionBtn')?.addEventListener('click', openDirectionModal);
