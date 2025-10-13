// =====================================================
// DATA MODULE - Функции загрузки данных с сервера
// =====================================================

// Загрузить заявки
async function fetchBookings(status = null) {
    try {
        const token = getAuthToken();
        const url = status ? `${API_URL}/bookings?status=${status}` : `${API_URL}/bookings`;
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        return data.bookings || [];
    } catch (error) {
        console.error('Ошибка загрузки заявок:', error);
        return [];
    }
}

// Загрузить учеников
async function fetchStudents(search = '') {
    try {
        const token = getAuthToken();
        const url = search ? `${API_URL}/students?search=${search}` : `${API_URL}/students`;
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        return data.students || [];
    } catch (error) {
        console.error('Ошибка загрузки учеников:', error);
        return [];
    }
}

// Загрузить группы
async function fetchGroups() {
    try {
        const response = await fetch(`${API_URL}/groups`);
        const data = await response.json();
        return data.groups || [];
    } catch (error) {
        console.error('Ошибка загрузки групп:', error);
        return [];
    }
}

// Загрузить направления
async function fetchDirections() {
    try {
        const response = await fetch(`${API_URL}/directions`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        const data = await response.json();
        return data.directions || [];
    } catch (error) {
        console.error('Ошибка загрузки направлений:', error);
        return [];
    }
}

console.log('✅ Data модуль загружен');

