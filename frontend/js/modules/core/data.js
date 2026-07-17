// =====================================================
// DATA MODULE - Функции загрузки данных с сервера
// =====================================================

async function fetchBookings(status = null, search = '', page = 1, limit = 20) {
    try {
        let url = `/bookings?page=${page}&limit=${limit}`;
        
        if (status) url += `&status=${status}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        
        const data = await apiGet(url);
        return data;
    } catch (error) {
        console.error('Error fetching bookings:', error);
        return { bookings: [], total: 0, pages: 0, success: false, error: error.message };
    }
}

// Загрузить учеников
async function fetchStudents(search = '') {
    try {
        const url = search ? `/students?search=${search}` : `/students`;
        const data = await apiGet(url);
        return data.students || [];
    } catch (error) {
        console.error('Error fetching students:', error);
        return [];
    }
}

// Загрузить группы
async function fetchGroups(options = {}) {
    try {
        const params = new URLSearchParams();
        if (options.includeArchived) params.set('includeArchived', 'true');
        if (options.archivedOnly) params.set('archived', 'true');
        const query = params.toString();
        const data = await apiGet(`/groups${query ? `?${query}` : ''}`);
        return data.groups || [];
    } catch (error) {
        return [];
    }
}

// Загрузить направления
async function fetchDirections() {
    try {
        const data = await apiGet('/directions');
        return data.directions || [];
    } catch (error) {
        return [];
    }
}

