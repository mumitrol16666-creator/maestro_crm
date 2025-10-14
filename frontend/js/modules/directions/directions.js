// =====================================================
// DIRECTIONS MODULE - Управление направлениями
// =====================================================

// Отобразить направления
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
                    Пробное: ${direction.pricing?.trial || 2000}₸ • Месяц: ${direction.pricing?.month || 22000}₸ • 3 месяца: ${direction.pricing?.threeMonths || 55000}₸
                </div>
            </td>
            <td>${direction.order}</td>
            <td>
                <span class="status-badge ${direction.isActive ? 'status-active' : 'status-inactive'}">
                    ${direction.isActive ? 'Активно' : 'Неактивно'}
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
            showNotification(notificationWithIcon('warning', 'Направление не найдено'));
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
        
        document.getElementById('directionModal').classList.add('show');
    } catch (error) {
        showNotification(notificationWithIcon('error', 'Ошибка при загрузке направления'));
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
            showNotification(notificationWithIcon('error', data.error || 'Ошибка при удалении направления'));
            return;
        }
        
        showNotification(notificationWithIcon('success', 'Направление успешно удалено'));
        renderDirections();
    } catch (error) {
        showNotification(notificationWithIcon('error', 'Ошибка при удалении направления'));
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
        showNotification(notificationWithIcon('warning', 'Заполните все обязательные поля'));
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
                order 
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            showNotification(notificationWithIcon('error', data.error || 'Ошибка при сохранении направления'));
            return;
        }
        
        showNotification(notificationWithIcon('warning', id ? 'Направление успешно обновлено' : 'Направление успешно создано'));
        closeDirectionModal();
        renderDirections();
    } catch (error) {
        showNotification(notificationWithIcon('error', 'Ошибка при сохранении направления'));
    }
});

// Кнопка создания направления
document.getElementById('createDirectionBtn')?.addEventListener('click', openDirectionModal);


