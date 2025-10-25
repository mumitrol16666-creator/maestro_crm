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
    console.log('💰 Загрузка данных зарплаты...');
    
    try {
        const response = await fetch('/api/salary', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        console.log('💰 Ответ сервера:', response.status);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('💰 Данные зарплаты:', data);
        
        if (data.success) {
            renderSalaryList(data.data.salaries);
        } else {
            throw new Error(data.message || 'Ошибка загрузки данных');
        }

    } catch (error) {
        console.error('❌ Ошибка загрузки зарплаты:', error);
        // Показываем пустой список при ошибке
        const salaryList = document.getElementById('salaryList');
        if (salaryList) {
            salaryList.innerHTML = `
                <div style="text-align: center; padding: 40px; opacity: 0.5;">
                    <p>Ошибка загрузки данных</p>
                    <p>${error.message}</p>
                </div>
            `;
        }
    }
}

// Функция не нужна - убрана

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

// Простые функции не нужны

// Экспорт функций для глобального использования
window.initSalaryModule = initSalaryModule;
window.calculateSalary = calculateSalary;
window.paySalary = paySalary;
