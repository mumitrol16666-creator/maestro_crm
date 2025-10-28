// =====================================================
// SALARY MODULE - Управление зарплатой преподавателей
// =====================================================

let currentSalaryPage = 1;
let salaryFilters = {};

// Инициализация модуля зарплаты
function initSalaryModule() {
    // Устанавливаем даты по умолчанию
    setDefaultDates();
    
    // Загружаем преподавателей
    loadTeachersForSalary();
    
    // Загружаем данные при открытии секции
    loadSalaryData();
    
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
}

// Загрузка данных зарплаты
async function loadSalaryData() {
    try {
        const response = await fetch(`${API_URL}/salary`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('📊 Ответ загрузки зарплат:', data);
        
        if (data.success) {
            console.log('📊 Список зарплат:', data.data.salaries);
            renderSalaryList(data.data.salaries);
        } else {
            console.error('❌ Ошибка загрузки зарплат:', data.message);
            throw new Error(data.message || 'Ошибка загрузки данных');
        }

    } catch (error) {
        console.error('Ошибка загрузки зарплаты:', error);
        const salaryList = document.getElementById('salaryList');
        if (salaryList) {
            salaryList.innerHTML = `
                <div style="text-align: center; padding: 40px; opacity: 0.5;">
                    <p>Ошибка загрузки данных</p>
                </div>
            `;
        }
    }
}

// Установка дат по умолчанию
function setDefaultDates() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    const startDateInput = document.getElementById('salaryStartDate');
    const endDateInput = document.getElementById('salaryEndDate');
    
    if (startDateInput) {
        startDateInput.value = startOfMonth.toISOString().split('T')[0];
    }
    if (endDateInput) {
        endDateInput.value = endOfMonth.toISOString().split('T')[0];
    }
}

// Загрузка преподавателей для зарплаты
async function loadTeachersForSalary() {
    try {
        const teacherSelect = document.getElementById('salaryTeacherSelect');
        if (!teacherSelect) {
            console.error('❌ Элемент salaryTeacherSelect не найден');
            return;
        }
        
        const token = getAuthToken();
        if (!token) {
            console.error('❌ Нет токена авторизации');
            return;
        }
        
        console.log('👨‍🏫 Загружаем преподавателей...');
        console.log('👨‍🏫 API_URL:', API_URL);
        console.log('👨‍🏫 URL:', `${API_URL}/students?role=teacher`);
        console.log('👨‍🏫 Токен:', token ? 'Есть' : 'Нет');
        
        // Проверяем доступность API
        console.log('🔍 Проверяем доступность API...');
        const healthCheck = await fetch(`${API_URL}/health`);
        console.log('🔍 Health check статус:', healthCheck.status);
        
        const response = await fetch(`${API_URL}/students?role=teacher`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        console.log('👨‍🏫 Статус ответа:', response.status);
        console.log('👨‍🏫 Headers:', response.headers);
        
        const data = await response.json();
        console.log('👨‍🏫 Данные преподавателей:', data);
        console.log('👨‍🏫 Тип данных:', typeof data);
        console.log('👨‍🏫 Ключи данных:', Object.keys(data));

        if (data.success && data.students && data.students.length > 0) {
            teacherSelect.innerHTML = '<option value="">Выберите преподавателя</option>';
            
            data.students.forEach(teacher => {
                const option = document.createElement('option');
                option.value = teacher._id;
                option.textContent = `${teacher.name} ${teacher.lastName || ''}`.trim();
                teacherSelect.appendChild(option);
            });
            console.log('✅ Преподаватели загружены:', data.students.length);
        } else {
            console.error('❌ Нет преподавателей или ошибка API:', data);
            teacherSelect.innerHTML = '<option value="">Нет преподавателей - создайте в разделе "Пользователи"</option>';
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
            <div style="text-align: center; padding: 40px; opacity: 0.5;">
                <p>Нет расчетов зарплаты</p>
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

                <div class="salary-actions">
                    ${salary.status === 'calculated' ? `
                        <button class="btn btn-sm btn-success" onclick="paySalary('${salary._id}')">
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
    // Простая статистика не нужна
}

// Показать модальное окно расчета зарплаты
function showCalculateSalaryModal() {
    const teacherId = document.getElementById('salaryTeacherSelect').value;
    const startDate = document.getElementById('salaryStartDate').value;
    const endDate = document.getElementById('salaryEndDate').value;
    const percentage = document.getElementById('salaryPercentage').value || 35;

           if (!teacherId) {
               alert('Выберите преподавателя');
               return;
           }

           if (!startDate || !endDate) {
               alert('Укажите период');
               return;
           }

    calculateSalaryDirect(teacherId, startDate, endDate, percentage);
}

// Загрузка преподавателей для модального окна
async function loadTeachersForModal() {
    try {
        const response = await fetch(`${API_URL}/students?role=teacher`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
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
        alert('Ошибка загрузки списка преподавателей');
    }
}

// Прямой расчет зарплаты
async function calculateSalaryDirect(teacherId, startDate, endDate, percentage) {
    try {
        console.log('🧮 Начинаем расчет зарплаты...');
        console.log('🧮 API_URL:', API_URL);
        console.log('🧮 URL:', `${API_URL}/salary/calculate`);
        console.log('🧮 Данные:', { teacherId, startDate, endDate, percentage });
        
        const response = await fetch(`${API_URL}/salary/calculate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({
                teacherId,
                startDate,
                endDate,
                percentage: parseInt(percentage)
            })
        });

        console.log('🧮 Статус ответа:', response.status);
        console.log('🧮 Headers ответа:', response.headers);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Ошибка сервера:', errorText);
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log('🧮 Ответ сервера:', data);
        
        if (data.success) {
            console.log('✅ Зарплата успешно рассчитана');
            console.log('💰 Данные зарплаты:', data.data);
            
            // Показываем детали расчета
            showSalaryCalculationDetails(data.data);
            
            loadSalaryData();
        } else {
            console.error('❌ Ошибка расчета зарплаты:', data.message);
            throw new Error(data.message || 'Ошибка расчета зарплаты');
        }

    } catch (error) {
        console.error('❌ Ошибка расчета зарплаты:', error);
        alert('Ошибка расчета зарплаты: ' + error.message);
    }
}

// Расчет зарплаты (для совместимости)
async function calculateSalary() {
    calculateSalaryDirect();
}

// Показать детали расчета зарплаты
function showSalaryCalculationDetails(data) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    
    // Оптимизированное формирование HTML - только основные данные
    let classesSummary = '';
    if (data.classes && data.classes.length > 0) {
        classesSummary = data.classes.map(cls => {
            const paymentTypeText = cls.students && cls.students.length > 0 ? 
                (cls.students[0].payment.type === 'membership' ? 'Абонемент' : 
                 cls.students[0].payment.type === 'single' ? 'Разовое' : 'Пробное') : 'Неизвестно';
            
            return `
                <div class="class-summary">
                    <div class="class-info">
                        <strong>${cls.className}</strong>
                        <span class="class-date">${new Date(cls.classDate).toLocaleDateString('ru-RU')}</span>
                    </div>
                    <div class="class-stats">
                        <span>${cls.totalAttendedClasses} занятий</span>
                        <span class="earnings">${cls.totalEarnings}₸</span>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    modal.innerHTML = `
        <div class="modal-content salary-modal">
            <div class="modal-header">
                <div class="header-content">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                    </svg>
                    <h3>Детали расчета зарплаты</h3>
                </div>
                <button class="close-btn" onclick="this.closest('.modal').remove()">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div class="modal-body">
                <div class="summary-card">
                    <div class="teacher-info">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                        <span class="teacher-name">${data.teacher.name}</span>
                    </div>
                    <div class="period-info">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        <span>${new Date(data.period.start).toLocaleDateString('ru-RU')} - ${new Date(data.period.end).toLocaleDateString('ru-RU')}</span>
                    </div>
                    <div class="stats-grid">
                        <div class="stat-card">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M9 11H5a2 2 0 0 0-2 2v3c0 1.1.9 2 2 2h4m0-7h4m0-7H9a2 2 0 0 0-2 2v3c0 1.1.9 2 2 2h4m0-7h4m0-7H9a2 2 0 0 0-2 2v3c0 1.1.9 2 2 2h4"></path>
                            </svg>
                            <div class="stat-content">
                                <span class="stat-value">${data.statistics.totalClasses}</span>
                                <span class="stat-label">Занятий</span>
                            </div>
                        </div>
                        <div class="stat-card">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                <circle cx="9" cy="7" r="4"></circle>
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                            <div class="stat-content">
                                <span class="stat-value">${data.statistics.totalStudents}</span>
                                <span class="stat-label">Студентов</span>
                            </div>
                        </div>
                        <div class="stat-card">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                            </svg>
                            <div class="stat-content">
                                <span class="stat-value">${data.statistics.totalEarnings}₸</span>
                                <span class="stat-label">Доход</span>
                            </div>
                        </div>
                        <div class="stat-card highlight">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                            </svg>
                            <div class="stat-content">
                                <span class="stat-value">${data.statistics.teacherSalary}₸</span>
                                <span class="stat-label">Зарплата (${data.statistics.teacherPercentage}%)</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="classes-section">
                    <h4 class="section-title">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 11H5a2 2 0 0 0-2 2v3c0 1.1.9 2 2 2h4m0-7h4m0-7H9a2 2 0 0 0-2 2v3c0 1.1.9 2 2 2h4m0-7h4m0-7H9a2 2 0 0 0-2 2v3c0 1.1.9 2 2 2h4"></path>
                        </svg>
                        Детали по занятиям
                    </h4>
                    <div class="classes-list">
                        ${classesSummary || '<p class="no-data">Нет данных о занятиях</p>'}
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="admin-btn btn-primary" onclick="exportSalaryToExcel(${JSON.stringify(data).replace(/"/g, '&quot;')})">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14,2 14,8 20,8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                        <polyline points="10,9 9,9 8,9"></polyline>
                    </svg>
                    Скачать Excel
                </button>
                <button class="admin-btn btn-secondary" onclick="this.closest('.modal').remove()">Закрыть</button>
            </div>
        </div>
    `;
    
    // Упрощенные стили для быстрой загрузки
    const style = document.createElement('style');
    style.textContent = `
        .salary-modal {
            max-width: 600px;
            max-height: 80vh;
            overflow-y: auto;
        }
        
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            border-bottom: 1px solid #e5e7eb;
            background: #f9fafb;
        }
        
        .header-content {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .header-content svg {
            color: var(--pink);
        }
        
        .header-content h3 {
            margin: 0;
            font-size: 1.1rem;
            font-weight: 600;
            color: #1f2937;
        }
        
        .close-btn {
            background: none;
            border: none;
            padding: 6px;
            border-radius: 4px;
            cursor: pointer;
            color: #6b7280;
        }
        
        .close-btn:hover {
            background: #f3f4f6;
        }
        
        .modal-body {
            padding: 20px;
        }
        
        .summary-card {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 20px;
        }
        
        .teacher-info {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 10px;
            font-weight: 600;
            color: #1f2937;
        }
        
        .teacher-info svg {
            color: var(--pink);
        }
        
        .period-info {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 16px;
            color: #6b7280;
            font-size: 0.9rem;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
        }
        
        .stat-card {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 12px;
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
        }
        
        .stat-card.highlight {
            background: var(--pink);
            color: white;
            border-color: var(--pink);
        }
        
        .stat-card.highlight svg {
            color: white;
        }
        
        .stat-content {
            display: flex;
            flex-direction: column;
        }
        
        .stat-value {
            font-weight: 700;
            font-size: 1rem;
        }
        
        .stat-label {
            font-size: 0.75rem;
            opacity: 0.8;
        }
        
        .classes-section {
            margin-top: 20px;
        }
        
        .section-title {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 0 0 12px 0;
            font-size: 1rem;
            font-weight: 600;
            color: var(--pink);
        }
        
        .classes-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .class-summary {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
        }
        
        .class-info {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        
        .class-info strong {
            color: #1f2937;
        }
        
        .class-date {
            font-size: 0.8rem;
            color: #6b7280;
        }
        
        .class-stats {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 4px;
        }
        
        .class-stats span {
            font-size: 0.8rem;
            color: #6b7280;
        }
        
        .class-stats .earnings {
            font-weight: 700;
            color: var(--pink);
            font-size: 0.9rem;
        }
        
        .no-data {
            text-align: center;
            color: #9ca3af;
            font-style: italic;
            padding: 16px;
        }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(modal);
    
    // Удаляем стили при закрытии модального окна
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
            style.remove();
        }
    });
}

// Выплата зарплаты
async function paySalary(salaryId) {
    if (!confirm('Отметить зарплату как выплаченную? Это создаст расход в кассе.')) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/salary/${salaryId}/pay`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
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
            alert('Зарплата отмечена как выплаченная');
            loadSalaryData();
        } else {
            throw new Error(data.message || 'Ошибка выплаты зарплаты');
        }

    } catch (error) {
        console.error('❌ Ошибка выплаты зарплаты:', error);
        alert('Ошибка выплаты зарплаты: ' + error.message);
    }
}

// Просмотр деталей зарплаты
function viewSalaryDetails(salaryId) {
    // TODO: Реализовать детальный просмотр
    console.log('Просмотр деталей зарплаты:', salaryId);
    showInfo('Функция детального просмотра в разработке');
}

// Простые функции не нужны

// Экспорт зарплаты в Excel
function exportSalaryToExcel(salaryData) {
    try {
        console.log('📊 Экспорт зарплаты в Excel:', salaryData);
        
        // Создаем рабочую книгу Excel
        const wb = XLSX.utils.book_new();
        
        // 1. Сводная информация
        const summaryData = [
            ['ПРЕПОДАВАТЕЛЬ', salaryData.teacherName],
            ['ПЕРИОД', `${new Date(salaryData.period.start).toLocaleDateString('ru-RU')} - ${new Date(salaryData.period.end).toLocaleDateString('ru-RU')}`],
            ['ОБЩЕЕ КОЛИЧЕСТВО ЗАНЯТИЙ', salaryData.statistics.totalClasses],
            ['ОБЩЕЕ КОЛИЧЕСТВО СТУДЕНТОВ', salaryData.statistics.totalStudents],
            ['ОБЩИЙ ДОХОД', `${salaryData.statistics.totalEarnings}₸`],
            ['ПРОЦЕНТ ПРЕПОДАВАТЕЛЯ', `${salaryData.statistics.teacherPercentage}%`],
            ['ЗАРПЛАТА ПРЕПОДАВАТЕЛЯ', `${salaryData.statistics.teacherSalary}₸`],
            ['СТАТУС', getSalaryStatusText(salaryData.status)],
            ['ДАТА РАСЧЕТА', new Date(salaryData.calculatedAt).toLocaleString('ru-RU')]
        ];
        
        const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, summarySheet, 'Сводка');
        
        // 2. Детализация по занятиям с полной информацией
        const classesData = [
            ['ЗАНЯТИЕ', 'ДАТА', 'ГРУППА', 'СТУДЕНТ', 'ТИП ОПЛАТЫ', 'СУММА ОПЛАТЫ', 'КОЛ-ВО ЗАНЯТИЙ В АБОНЕМЕНТЕ', 'СТОИМОСТЬ ЗА ЗАНЯТИЕ', 'ПОСЕЩЕННЫХ ЗАНЯТИЙ', 'ЗАРАБОТОК', 'ПРОЦЕНТ ПРЕПОДАВАТЕЛЯ', 'ЗАРПЛАТА ЗА СТУДЕНТА', 'ID ОПЛАТЫ', 'ДАТА ОПЛАТЫ', 'СТАТУС ОПЛАТЫ']
        ];
        
        if (salaryData.classes && salaryData.classes.length > 0) {
            salaryData.classes.forEach(cls => {
                if (cls.students && cls.students.length > 0) {
                    cls.students.forEach(student => {
                        const paymentTypeText = student.payment.type === 'membership' ? 'Абонемент' : 
                                             student.payment.type === 'single' ? 'Разовое' : 'Пробное';
                        
                        // Получаем детальную информацию об оплате
                        const paymentId = student.payment.paymentId || 'Не указан';
                        const paymentDate = student.payment.paymentDate ? 
                            new Date(student.payment.paymentDate).toLocaleDateString('ru-RU') : 'Не указана';
                        const paymentStatus = student.payment.status || 'Не указан';
                        
                        classesData.push([
                            cls.className,
                            new Date(cls.classDate).toLocaleDateString('ru-RU'),
                            cls.groupName || 'Не указана',
                            student.studentName,
                            paymentTypeText,
                            `${student.payment.amount}₸`,
                            student.payment.totalClasses,
                            `${student.payment.pricePerClass}₸`,
                            student.attendedClasses,
                            `${student.totalEarnings}₸`,
                            `${salaryData.statistics.teacherPercentage}%`,
                            `${Math.round(student.totalEarnings * salaryData.statistics.teacherPercentage / 100)}₸`,
                            paymentId,
                            paymentDate,
                            paymentStatus
                        ]);
                    });
                }
            });
        }
        
        const classesSheet = XLSX.utils.aoa_to_sheet(classesData);
        XLSX.utils.book_append_sheet(wb, classesSheet, 'Детализация');
        
        // 3. Статистика по типам оплат
        const paymentStats = [
            ['ТИП ОПЛАТЫ', 'КОЛИЧЕСТВО СТУДЕНТОВ', 'ОБЩАЯ СУММА', 'ПОСЕЩЕННЫХ ЗАНЯТИЙ', 'ЗАРАБОТОК', 'ЗАРПЛАТА']
        ];
        
        const paymentTypes = {};
        if (salaryData.classes && salaryData.classes.length > 0) {
            salaryData.classes.forEach(cls => {
                if (cls.students && cls.students.length > 0) {
                    cls.students.forEach(student => {
                        const type = student.payment.type === 'membership' ? 'Абонемент' : 
                                   student.payment.type === 'single' ? 'Разовое' : 'Пробное';
                        
                        if (!paymentTypes[type]) {
                            paymentTypes[type] = {
                                students: 0,
                                totalAmount: 0,
                                attendedClasses: 0,
                                earnings: 0
                            };
                        }
                        
                        paymentTypes[type].students++;
                        paymentTypes[type].totalAmount += student.payment.amount;
                        paymentTypes[type].attendedClasses += student.attendedClasses;
                        paymentTypes[type].earnings += student.totalEarnings;
                    });
                }
            });
        }
        
        Object.keys(paymentTypes).forEach(type => {
            const stats = paymentTypes[type];
            paymentStats.push([
                type,
                stats.students,
                `${stats.totalAmount}₸`,
                stats.attendedClasses,
                `${stats.earnings}₸`,
                `${Math.round(stats.earnings * salaryData.statistics.teacherPercentage / 100)}₸`
            ]);
        });
        
        const statsSheet = XLSX.utils.aoa_to_sheet(paymentStats);
        XLSX.utils.book_append_sheet(wb, statsSheet, 'Статистика');
        
        // 4. Детальная информация по каждому занятию
        const detailedClassesData = [
            ['ЗАНЯТИЕ', 'ДАТА ЗАНЯТИЯ', 'ГРУППА', 'ОБЩЕЕ КОЛИЧЕСТВО СТУДЕНТОВ', 'ОБЩИЙ ЗАРАБОТОК ЗА ЗАНЯТИЕ', 'ЗАРПЛАТА ЗА ЗАНЯТИЕ', 'ДЕТАЛИ СТУДЕНТОВ']
        ];
        
        if (salaryData.classes && salaryData.classes.length > 0) {
            salaryData.classes.forEach(cls => {
                let studentsDetails = '';
                if (cls.students && cls.students.length > 0) {
                    studentsDetails = cls.students.map(student => {
                        const paymentTypeText = student.payment.type === 'membership' ? 'Абонемент' : 
                                             student.payment.type === 'single' ? 'Разовое' : 'Пробное';
                        return `${student.studentName} (${paymentTypeText}: ${student.payment.amount}₸, посещений: ${student.attendedClasses}, заработок: ${student.totalEarnings}₸)`;
                    }).join('; ');
                }
                
                detailedClassesData.push([
                    cls.className,
                    new Date(cls.classDate).toLocaleDateString('ru-RU'),
                    cls.groupName || 'Не указана',
                    cls.students ? cls.students.length : 0,
                    `${cls.totalEarnings}₸`,
                    `${Math.round(cls.totalEarnings * salaryData.statistics.teacherPercentage / 100)}₸`,
                    studentsDetails
                ]);
            });
        }
        
        const detailedSheet = XLSX.utils.aoa_to_sheet(detailedClassesData);
        XLSX.utils.book_append_sheet(wb, detailedSheet, 'По занятиям');
        
        // Генерируем имя файла
        const fileName = `Зарплата_${salaryData.teacherName}_${new Date(salaryData.period.start).toLocaleDateString('ru-RU').replace(/\./g, '-')}_${new Date(salaryData.period.end).toLocaleDateString('ru-RU').replace(/\./g, '-')}.xlsx`;
        
        // Скачиваем файл
        XLSX.writeFile(wb, fileName);
        
        console.log('✅ Excel файл успешно создан:', fileName);
        
    } catch (error) {
        console.error('❌ Ошибка экспорта в Excel:', error);
        alert('Ошибка экспорта в Excel: ' + error.message);
    }
}

// Экспорт функций для глобального использования
window.initSalaryModule = initSalaryModule;
window.calculateSalary = calculateSalary;
window.paySalary = paySalary;
window.exportSalaryToExcel = exportSalaryToExcel;
