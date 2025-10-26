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
        
        if (data.success) {
            renderSalaryList(data.data.salaries);
        } else {
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

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        
        if (data.success) {
            showSuccess('Зарплата успешно рассчитана');
            loadSalaryData();
        } else {
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
            showSuccess('Зарплата отмечена как выплаченная');
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

// Экспорт функций для глобального использования
window.initSalaryModule = initSalaryModule;
window.calculateSalary = calculateSalary;
window.paySalary = paySalary;
