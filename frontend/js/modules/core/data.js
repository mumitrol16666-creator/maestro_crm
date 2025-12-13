// =====================================================
// DATA MODULE - Функции загрузки данных с сервера
// =====================================================

// Загрузить заявки (с пагинацией и поиском)
async function fetchBookings(status = null, search = '', page = 1, limit = 20) {
    try {
        const token = getAuthToken();
        let url = `${API_URL}/bookings?page=${page}&limit=${limit}`;
        
        if (status) url += `&status=${status}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('Error fetching bookings:', response.status, errorData);
            return { bookings: [], total: 0, pages: 0, success: false, error: errorData.error || `HTTP ${response.status}` };
        }
        
        const data = await response.json();
        return data;  // Возвращаем весь объект (с total, pages)
    } catch (error) {
        console.error('Error fetching bookings:', error);
        return { bookings: [], total: 0, pages: 0, success: false, error: error.message };
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
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('Error fetching students:', response.status, errorData);
            return [];
        }
        
        const data = await response.json();
        return data.students || [];
    } catch (error) {
        console.error('Error fetching students:', error);
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
        return [];
    }
}


