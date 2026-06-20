// =====================================================
// ROOMS MODULE - Управление залами
// =====================================================

// Открыть модальное окно управления залами
async function openManageRoomsModal() {
    if (allRooms.length === 0) {
        await loadRooms();
    }
    
    renderRoomsListInModal();
    
    const modal = document.getElementById('manageRoomsModal');
    modal.classList.add('show');
}

// Закрыть модальное окно управления залами
function closeManageRoomsModal() {
    const modal = document.getElementById('manageRoomsModal');
    modal.classList.remove('show');
}

// Открыть модальное окно формы создания/редактирования зала
function openRoomFormModal() {
    const modal = document.getElementById('roomFormModal');
    const form = document.getElementById('roomForm');
    const title = document.getElementById('roomFormModalTitle');
    
    form.reset();
    document.getElementById('roomId').value = '';
    title.textContent = 'СОЗДАТЬ ЗАЛ';
    document.getElementById('roomColor').value = '#eb4d77';
    document.getElementById('roomWorkingStart').value = '08:00';
    document.getElementById('roomWorkingEnd').value = '21:00';
    
    modal.classList.add('show');
}

// Закрыть модальное окно формы зала
function closeRoomFormModal() {
    const modal = document.getElementById('roomFormModal');
    modal.classList.remove('show');
}

// Редактировать зал
async function editRoom(id) {
    try {
        // Ищем зал в уже загруженных
        let room = allRooms.find(r => r._id === id);
        
        // Если нет - загружаем заново
        if (!room) {
            await loadRooms();
            room = allRooms.find(r => r._id === id);
        }
        
        if (!room) {
            toast.warning( 'Зал не найден');
            return;
        }
        
        document.getElementById('roomId').value = room._id;
        document.getElementById('roomName').value = room.name;
        document.getElementById('roomColor').value = room.color || '#eb4d77';
        document.getElementById('roomWorkingStart').value = room.workingStart || '08:00';
        document.getElementById('roomWorkingEnd').value = room.workingEnd || '21:00';
        
        document.getElementById('roomFormModalTitle').textContent = 'РЕДАКТИРОВАТЬ ЗАЛ';
        document.getElementById('roomFormModal').classList.add('show');
    } catch (error) {
        toast.error('Ошибка при загрузке данных зала');
    }
}

// Удалить зал
async function deleteRoom(id, name) {
    if (!await customConfirm(`Удалить зал "${name}"?`, {icon: 'warning'})) { 
        return; 
    }
    
    try {
        const response = await fetch(`${API_URL}/rooms/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        const data = await response.json();
        
        if (!data.success) {
            toast.error( data.error || 'Ошибка при удалении зала');
            return;
        }
        
        toast.success( 'Зал успешно удален');
        
        // Обновляем список залов
        await loadRooms();
        
        // Обновляем список в модалке
        renderRoomsListInModal();
        
        // Перезагружаем события календаря
        if (calendar) {
            calendar.refetchEvents();
        }
    } catch (error) {
        toast.error('Ошибка при удалении зала');
    }
}

// Рендерим список залов в модалке управления
function renderRoomsListInModal() {
    const container = document.getElementById('roomsListInModal');
    if (!container) return;
    
    if (allRooms.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; opacity: 0.5;">Залы не созданы</div>';
        return;
    }
    
    container.innerHTML = allRooms.map(room => `
        <div style="
            display: flex; 
            align-items: center; 
            gap: 10px; 
            padding: 12px; 
            border-radius: 5px;
        " class="info-box" style="margin-bottom: 10px;">
            <div style="width: 24px; height: 24px; background: ${room.color}; border-radius: 4px;"></div>
            <span style="font-size: 1rem; flex: 1;">${room.name}</span>
            <span style="font-size:0.78rem;opacity:0.6;">${room.workingStart || '08:00'}–${room.workingEnd || '21:00'}</span>
            <button 
                onclick="editRoom('${room._id}')" 
                class="room-action-btn"
                title="Редактировать"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
            <button 
                onclick="deleteRoom('${room._id}', '${room.name}')" 
                class="room-action-btn danger"
                title="Удалить"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
            </button>
        </div>
    `).join('');
}

// Показать кнопку управления залами для админов
function initRoomButton() {
    const userRole = localStorage.getItem('userRole');
    const manageRoomsBtn = document.getElementById('manageRoomsBtn');
    
    if (manageRoomsBtn) {
        // Кнопка доступна только для admin и super_admin
        if (['admin', 'super_admin'].includes(userRole)) {
            manageRoomsBtn.style.display = 'flex';
        } else {
            manageRoomsBtn.style.display = 'none';
        }
    }
}

// Инициализация обработчиков для rooms
function initRoomHandlers() {
    // Вызываем показ кнопки
    initRoomButton();

    // Кнопка управления залами
    const manageRoomsBtn = document.getElementById('manageRoomsBtn');
    if (manageRoomsBtn) {
        manageRoomsBtn.addEventListener('click', openManageRoomsModal);
    }
    
    // Обработчик формы зала
    const roomForm = document.getElementById('roomForm');
    if (roomForm) {
        roomForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const id = document.getElementById('roomId').value;
            const name = document.getElementById('roomName').value.trim();
            const color = document.getElementById('roomColor').value;
            const workingStart = document.getElementById('roomWorkingStart').value || '08:00';
            const workingEnd = document.getElementById('roomWorkingEnd').value || '21:00';
            
            if (!name) {
                toast.warning( 'Заполните название зала');
                return;
            }
            
            try {
                const url = id 
                    ? `${API_URL}/rooms/${id}`
                    : `${API_URL}/rooms`;
                
                const method = id ? 'PATCH' : 'POST';
                
                const response = await fetch(url, {
                    method,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${getAuthToken()}`
                    },
                    body: JSON.stringify({ 
                        name, 
                        color,
                        workingStart,
                        workingEnd,
                    })
                });
                
                const data = await response.json();
                
                if (!data.success) {
                    toast.error( data.error || 'Ошибка при сохранении зала');
                    return;
                }
                
                toast.warning( id ? 'Зал успешно обновлен' : 'Зал успешно создан');
                closeRoomFormModal();
                
                // Обновляем список залов в календаре
                await loadRooms();
                
                // Обновляем список в модалке управления
                renderRoomsListInModal();
                
                // Перезагружаем события календаря
                if (calendar) {
                    calendar.refetchEvents();
                }
            } catch (error) {
                toast.error('Ошибка при сохранении зала');
            }
        });
    }
}

// Экспорт для admin.js
window.initRoomHandlers = initRoomHandlers;
