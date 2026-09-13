// =====================================================
// DIRECTIONS MODULE - направления и единые цены уроков
// =====================================================

function escapeDirectionHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
}

function escapeDirectionJsArg(value) {
    return String(value == null ? '' : value)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/</g, '\\x3C');
}

function directionPriceLine(direction) {
    const pricing = direction.pricing || {};
    const money = value => `${new Intl.NumberFormat('ru-RU').format(Number(value) || 0)} ₸`;
    const program = (Number(pricing.individual) * 4) + (Number(pricing.theory) * 2) + (Number(pricing.group) * 4);
    const twoMonths = program * 2 - 4000;
    return `1 месяц ${money(program)} · 2 месяца ${money(twoMonths)} · индивидуально ${money(pricing.individual)} · теория ${money(pricing.theory)} · квартет ${money(pricing.group)}`;
}

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
                <div style="font-weight: 600;">${escapeDirectionHtml(direction.name)}</div>
                <div style="font-size: 0.85rem; opacity: 0.7; margin-top: 3px;">${escapeDirectionHtml(direction.description || '')}</div>
                <div style="font-size: 0.75rem; opacity: 0.6; margin-top: 3px;">От ${escapeDirectionHtml(direction.minAge)} лет • ${escapeDirectionHtml(direction.level)}</div>
                <div style="font-size: 0.75rem; opacity: 0.8; margin-top: 5px; color: var(--pink);">
                    ${directionPriceLine(direction)}
                </div>
            </td>
            <td>${direction.order}</td>
            <td>
                <span class="status-badge ${direction.isActive ? 'status-active' : 'status-inactive'}">
                    ${direction.isActive ? 'Активно' : 'Неактивно'}
                </span>
            </td>
            <td>
                <button class="table-btn" onclick="editDirection('${escapeDirectionJsArg(direction._id)}')">Редактировать</button>
                <button class="table-btn danger" onclick="deleteDirection('${escapeDirectionJsArg(direction._id)}', '${escapeDirectionJsArg(direction.name)}')">Отключить</button>
            </td>
        </tr>
    `).join('');
}

function openDirectionModal() {
    const form = document.getElementById('directionForm');
    form.reset();
    document.getElementById('directionId').value = '';
    document.getElementById('directionModalTitle').textContent = 'ДОБАВИТЬ НАПРАВЛЕНИЕ';
    document.getElementById('directionPriceTrial').value = 2000;
    document.getElementById('directionPriceGroup').value = 2250;
    document.getElementById('directionPriceTheory').value = 1000;
    document.getElementById('directionPriceIndividual').value = 4000;
    document.getElementById('directionModal').classList.add('show');
}

async function editDirection(id) {
    try {
        const response = await fetch(`${API_URL}/directions`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` },
        });
        const data = await response.json();
        const direction = data.directions.find(item => item._id === id);
        if (!direction) {
            toast.warning('Направление не найдено');
            return;
        }

        document.getElementById('directionId').value = direction._id;
        document.getElementById('directionName').value = direction.name;
        document.getElementById('directionDescription').value = direction.description || '';
        document.getElementById('directionMinAge').value = direction.minAge || 0;
        document.getElementById('directionLevel').value = direction.level || '';
        document.getElementById('directionPriceTrial').value = direction.pricing?.trial || 2000;
        document.getElementById('directionPriceGroup').value = direction.pricing?.group || 2250;
        document.getElementById('directionPriceTheory').value = direction.pricing?.theory || 1000;
        document.getElementById('directionPriceIndividual').value = direction.pricing?.individual || 4000;
        document.getElementById('directionOrder').value = direction.order;
        document.getElementById('directionModalTitle').textContent = 'РЕДАКТИРОВАТЬ НАПРАВЛЕНИЕ';
        document.getElementById('directionModal').classList.add('show');
    } catch (error) {
        toast.error('Ошибка при загрузке направления');
    }
}

function closeDirectionModal() {
    document.getElementById('directionModal').classList.remove('show');
}

async function deleteDirection(id, name) {
    if (!await customConfirm(`Вы уверены, что хотите отключить направление "${name}"?`, { icon: 'warning' })) return;
    try {
        const response = await fetch(`${API_URL}/directions/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getAuthToken()}` },
        });
        const data = await response.json();
        if (!response.ok) {
            toast.error(data.error || 'Ошибка при отключении направления');
            return;
        }
        toast.success(data.message || 'Направление отключено');
        renderDirections();
    } catch (error) {
        toast.error('Ошибка при отключении направления');
    }
}

document.getElementById('directionForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const id = document.getElementById('directionId').value;
    const name = document.getElementById('directionName').value.trim();
    const description = document.getElementById('directionDescription').value.trim();
    const minAge = parseInt(document.getElementById('directionMinAge').value, 10);
    const level = document.getElementById('directionLevel').value.trim();
    const order = parseInt(document.getElementById('directionOrder').value, 10) || 0;
    const pricing = {
        trial: parseInt(document.getElementById('directionPriceTrial').value, 10),
        group: parseInt(document.getElementById('directionPriceGroup').value, 10),
        theory: parseInt(document.getElementById('directionPriceTheory').value, 10),
        individual: parseInt(document.getElementById('directionPriceIndividual').value, 10),
    };

    if (!name || !description || !Number.isFinite(minAge) || minAge < 0 || !level || Object.values(pricing).some(value => !value || value <= 0)) {
        toast.warning('Заполните направление и четыре цены за урок');
        return;
    }

    try {
        const response = await fetch(id ? `${API_URL}/directions/${id}` : `${API_URL}/directions`, {
            method: id ? 'PATCH' : 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`,
            },
            body: JSON.stringify({ name, description, minAge, level, pricing, order }),
        });
        const data = await response.json();
        if (!response.ok) {
            toast.error(data.error || 'Ошибка при сохранении направления');
            return;
        }
        toast.success(id ? 'Направление обновлено' : 'Направление создано');
        closeDirectionModal();
        renderDirections();
    } catch (error) {
        toast.error('Ошибка при сохранении направления');
    }
});

document.getElementById('createDirectionBtn')?.addEventListener('click', openDirectionModal);
