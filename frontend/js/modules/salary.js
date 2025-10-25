// =====================================================
// SALARY MODULE - Управление зарплатой преподавателей
// =====================================================

let currentSalaryPage = 1;
let salaryFilters = {};

// Инициализация модуля зарплаты
function initSalaryModule() {
    console.log('💰 Инициализация модуля зарплаты');
    
    // Загружаем данные при открытии секции
    loadSalaryData();
    loadTeachersForFilter();
    
    // Обработчики событий
    setupSalaryEventListeners();
}

// Настройка обработчиков событий
function setupSalaryEventListeners() {
    // Кнопка расчета зарплаты
    const calculateBtn = document.getElementById('calculateSalaryBtn');
    if (calculateBtn) {
        calculateBtn.addEventListener('click', showCalculateSalaryModal);
    }

    // Фильтры
    const applyFiltersBtn = document.getElementById('applySalaryFilters');
    if (applyFiltersBtn) {
        applyFiltersBtn.addEventListener('click', applySalaryFilters);
    }

    // Сброс фильтров
    const resetFiltersBtn = document.getElementById('resetSalaryFilters');
    if (resetFiltersBtn) {
        resetFiltersBtn.addEventListener('click', resetSalaryFilters);
    }
}

// Загрузка данных зарплаты
async function loadSalaryData() {
    try {
        const response = await fetch('/api/salary', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        
        if (data.success) {
            renderSalaryList(data.data.salaries);
            updateSalaryStats(data.data);
            updateSalaryPagination(data.data.pagination);
        } else {
            throw new Error(data.message || 'Ошибка загрузки данных');
        }

    } catch (error) {
        console.error('❌ Ошибка загрузки зарплаты:', error);
        showError('Ошибка загрузки данных зарплаты: ' + error.message);
    }
}

// Загрузка преподавателей для фильтра
async function loadTeachersForFilter() {
    try {
        const response = await fetch('/api/students?role=teacher', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        
        if (data.success) {
            const teacherSelect = document.getElementById('salaryTeacherFilter');
            if (teacherSelect) {
                // Очищаем существующие опции (кроме первой)
                teacherSelect.innerHTML = '<option value="">Все преподаватели</option>';
                
                // Добавляем преподавателей
                data.data.students.forEach(teacher => {
                    const option = document.createElement('option');
                    option.value = teacher._id;
                    option.textContent = `${teacher.name} ${teacher.lastName || ''}`.trim();
                    teacherSelect.appendChild(option);
                });
            }
        }

    } catch (error) {
        console.error('❌ Ошибка загрузки преподавателей:', error);
    }
}

// Отображение списка зарплаты
function renderSalaryList(salaries) {
    const salaryList = document.getElementById('salaryList');
    if (!salaryList) return;

    if (salaries.length === 0) {
        salaryList.innerHTML = `
            <div class="empty-state">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                </svg>
                <h3>Нет расчетов зарплаты</h3>
                <p>Нажмите "Рассчитать зарплату" для создания первого расчета</p>
            </div>
        `;
        return;
    }

    const salaryHTML = salaries.map(salary => {
        const statusClass = getSalaryStatusClass(salary.status);
        const statusText = getSalaryStatusText(salary.status);
        
        return `
            <div class="salary-item">
                <div class="salary-header">
                    <div class="salary-teacher">
                        <h3>${salary.teacherName}</h3>
                        <span class="salary-period">
                            ${new Date(salary.period.start).toLocaleDateString()} - 
                            ${new Date(salary.period.end).toLocaleDateString()}
                        </span>
                    </div>
                    <div class="salary-amount">
                        <span class="amount">${salary.teacherSalary.toLocaleString()} ₸</span>
                        <span class="status ${statusClass}">${statusText}</span>
                    </div>
                </div>
                
                <div class="salary-stats">
                    <div class="stat">
                        <span class="label">Групп:</span>
                        <span class="value">${salary.totalGroups}</span>
                    </div>
                    <div class="stat">
                        <span class="label">Учеников:</span>
                        <span class="value">${salary.totalStudents}</span>
                    </div>
                    <div class="stat">
                        <span class="label">Занятий:</span>
                        <span class="value">${salary.totalAttendedClasses}</span>
                    </div>
                    <div class="stat">
                        <span class="label">Доход:</span>
                        <span class="value">${salary.totalEarnings.toLocaleString()} ₸</span>
                    </div>
                    <div class="stat">
                        <span class="label">Процент:</span>
                        <span class="value">${salary.teacherPercentage}%</span>
                    </div>
                </div>

                <div class="salary-actions">
                    <button class="btn btn-sm btn-info" onclick="viewSalaryDetails('${salary._id}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                        Подробно
                    </button>
                    
                    ${salary.status === 'calculated' ? `
                        <button class="btn btn-sm btn-success" onclick="paySalary('${salary._id}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                            </svg>
                            Выплатить
                        </button>
                    ` : ''}
                    
                    ${salary.status === 'paid' ? `
                        <span class="paid-date">
                            Выплачено: ${new Date(salary.paidAt).toLocaleDateString()}
                        </span>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    salaryList.innerHTML = salaryHTML;
}

// Получение класса статуса
function getSalaryStatusClass(status) {
    switch (status) {
        case 'calculated': return 'status-calculated';
        case 'paid': return 'status-paid';
        case 'cancelled': return 'status-cancelled';
        default: return 'status-unknown';
    }
}

// Получение текста статуса
function getSalaryStatusText(status) {
    switch (status) {
        case 'calculated': return 'К выплате';
        case 'paid': return 'Выплачено';
        case 'cancelled': return 'Отменено';
        default: return 'Неизвестно';
    }
}

// Обновление статистики
function updateSalaryStats(data) {
    // Загружаем статистику отдельно
    loadSalaryStatistics();
}

// Загрузка статистики зарплаты
async function loadSalaryStatistics() {
    try {
        const response = await fetch('/api/salary/statistics', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        
        if (data.success) {
            document.getElementById('totalSalaries').textContent = data.data.totalSalaries;
            document.getElementById('paidSalaries').textContent = data.data.paidSalaries;
            document.getElementById('pendingSalaries').textContent = data.data.pendingSalaries;
            document.getElementById('totalPaidAmount').textContent = `${data.data.totalPaidAmount.toLocaleString()} ₸`;
            document.getElementById('totalPendingAmount').textContent = `${data.data.totalPendingAmount.toLocaleString()} ₸`;
        }

    } catch (error) {
        console.error('❌ Ошибка загрузки статистики зарплаты:', error);
    }
}

// Обновление пагинации
function updateSalaryPagination(pagination) {
    const paginationContainer = document.getElementById('salaryPagination');
    if (!paginationContainer) return;

    if (pagination.total <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }

    let paginationHTML = '<div class="pagination">';
    
    // Предыдущая страница
    if (pagination.current > 1) {
        paginationHTML += `<button class="pagination-btn" onclick="changeSalaryPage(${pagination.current - 1})">‹</button>`;
    }

    // Страницы
    for (let i = 1; i <= pagination.total; i++) {
        if (i === pagination.current) {
            paginationHTML += `<button class="pagination-btn active">${i}</button>`;
        } else {
            paginationHTML += `<button class="pagination-btn" onclick="changeSalaryPage(${i})">${i}</button>`;
        }
    }

    // Следующая страница
    if (pagination.current < pagination.total) {
        paginationHTML += `<button class="pagination-btn" onclick="changeSalaryPage(${pagination.current + 1})">›</button>`;
    }

    paginationHTML += '</div>';
    paginationContainer.innerHTML = paginationHTML;
}

// Смена страницы
function changeSalaryPage(page) {
    currentSalaryPage = page;
    loadSalaryData();
}

// Показать модальное окно расчета зарплаты
function showCalculateSalaryModal() {
    // Создаем модальное окно
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Рассчитать зарплату</h3>
                <button class="modal-close" onclick="closeModal(this)">×</button>
            </div>
            <div class="modal-body">
                <form id="calculateSalaryForm">
                    <div class="form-group">
                        <label for="salaryTeacherSelect">Преподаватель:</label>
                        <select id="salaryTeacherSelect" required>
                            <option value="">Выберите преподавателя</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="salaryStartDate">Период с:</label>
                        <input type="date" id="salaryStartDate" required>
                    </div>
                    <div class="form-group">
                        <label for="salaryEndDate">Период по:</label>
                        <input type="date" id="salaryEndDate" required>
                    </div>
                    <div class="form-group">
                        <label for="salaryPercentage">Процент преподавателя:</label>
                        <input type="number" id="salaryPercentage" value="35" min="1" max="100" required>
                        <small>Процент от общего дохода группы</small>
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal(this)">Отмена</button>
                <button class="btn btn-primary" onclick="calculateSalary()">Рассчитать</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Загружаем преподавателей
    loadTeachersForModal();
}

// Загрузка преподавателей для модального окна
async function loadTeachersForModal() {
    try {
        const response = await fetch('/api/students?role=teacher', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        
        if (data.success) {
            const teacherSelect = document.getElementById('salaryTeacherSelect');
            if (teacherSelect) {
                teacherSelect.innerHTML = '<option value="">Выберите преподавателя</option>';
                
                data.data.students.forEach(teacher => {
                    const option = document.createElement('option');
                    option.value = teacher._id;
                    option.textContent = `${teacher.name} ${teacher.lastName || ''}`.trim();
                    teacherSelect.appendChild(option);
                });
            }
        }

    } catch (error) {
        console.error('❌ Ошибка загрузки преподавателей:', error);
        showError('Ошибка загрузки списка преподавателей');
    }
}

// Расчет зарплаты
async function calculateSalary() {
    const teacherId = document.getElementById('salaryTeacherSelect').value;
    const startDate = document.getElementById('salaryStartDate').value;
    const endDate = document.getElementById('salaryEndDate').value;
    const percentage = document.getElementById('salaryPercentage').value;

    if (!teacherId || !startDate || !endDate) {
        showError('Заполните все поля');
        return;
    }

    try {
        const response = await fetch('/api/salary/calculate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                teacherId,
                startDate,
                endDate,
                percentage: parseInt(percentage)
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        
        if (data.success) {
            showSuccess('Зарплата успешно рассчитана');
            closeModal(document.querySelector('.modal-overlay'));
            loadSalaryData();
        } else {
            throw new Error(data.message || 'Ошибка расчета зарплаты');
        }

    } catch (error) {
        console.error('❌ Ошибка расчета зарплаты:', error);
        showError('Ошибка расчета зарплаты: ' + error.message);
    }
}

// Выплата зарплаты
async function paySalary(salaryId) {
    if (!confirm('Отметить зарплату как выплаченную? Это создаст расход в кассе.')) {
        return;
    }

    try {
        const response = await fetch(`/api/salary/${salaryId}/pay`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                notes: 'Выплата зарплаты преподавателю'
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        
        if (data.success) {
            showSuccess('Зарплата отмечена как выплаченная');
            loadSalaryData();
            loadSalaryStatistics();
        } else {
            throw new Error(data.message || 'Ошибка выплаты зарплаты');
        }

    } catch (error) {
        console.error('❌ Ошибка выплаты зарплаты:', error);
        showError('Ошибка выплаты зарплаты: ' + error.message);
    }
}

// Просмотр деталей зарплаты
function viewSalaryDetails(salaryId) {
    // TODO: Реализовать детальный просмотр
    console.log('Просмотр деталей зарплаты:', salaryId);
    showInfo('Функция детального просмотра в разработке');
}

// Применение фильтров
function applySalaryFilters() {
    const teacherId = document.getElementById('salaryTeacherFilter').value;
    const status = document.getElementById('salaryStatusFilter').value;
    const dateFrom = document.getElementById('salaryDateFrom').value;
    const dateTo = document.getElementById('salaryDateTo').value;

    salaryFilters = {
        teacherId: teacherId || undefined,
        status: status || undefined,
        startDate: dateFrom || undefined,
        endDate: dateTo || undefined
    };

    currentSalaryPage = 1;
    loadSalaryData();
}

// Сброс фильтров
function resetSalaryFilters() {
    document.getElementById('salaryTeacherFilter').value = '';
    document.getElementById('salaryStatusFilter').value = '';
    document.getElementById('salaryDateFrom').value = '';
    document.getElementById('salaryDateTo').value = '';

    salaryFilters = {};
    currentSalaryPage = 1;
    loadSalaryData();
}

// Экспорт функций для глобального использования
window.initSalaryModule = initSalaryModule;
window.changeSalaryPage = changeSalaryPage;
window.calculateSalary = calculateSalary;
window.paySalary = paySalary;
window.viewSalaryDetails = viewSalaryDetails;
window.applySalaryFilters = applySalaryFilters;
window.resetSalaryFilters = resetSalaryFilters;
