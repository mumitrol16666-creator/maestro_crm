// =====================================================
// SALARY MODULE - Управление зарплатой преподавателей
// =====================================================

let currentSalaryPage = 1;
let salaryFilters = {};

function salaryEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function salaryMoney(value) {
    return Number(value || 0).toLocaleString('ru-RU') + ' ₸';
}

// Инициализация модуля зарплаты
function initSalaryModule() {
    // Устанавливаем даты по умолчанию
    setDefaultDates();
    
    // Загружаем преподавателей
    loadTeachersForSalary();
    
    // Загружаем данные при открытии секции
    loadSalaryData();
    loadSalaryOperations();
    loadSalaryBalances();
    
    // Обработчики событий
    setupSalaryEventListeners();
}

// Настройка обработчиков событий
function setupSalaryEventListeners() {
    // Кнопка расчета зарплаты
    const calculateBtn = document.getElementById('calculateSalaryBtn');
    if (calculateBtn) {
        calculateBtn.replaceWith(calculateBtn.cloneNode(true));
        const freshCalculateBtn = document.getElementById('calculateSalaryBtn');
        freshCalculateBtn.addEventListener('click', showCalculateSalaryModal);
    }

    const createOperationBtn = document.getElementById('createSalaryOperationBtn');
    if (createOperationBtn) {
        createOperationBtn.replaceWith(createOperationBtn.cloneNode(true));
        document.getElementById('createSalaryOperationBtn')?.addEventListener('click', createSalaryOperation);
    }

    const operationDate = document.getElementById('salaryOperationDate');
    if (operationDate && !operationDate.value) {
        const today = new Date();
        operationDate.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    }

    const refreshBalanceBtn = document.getElementById('refreshSalaryBalanceBtn');
    if (refreshBalanceBtn) {
        refreshBalanceBtn.replaceWith(refreshBalanceBtn.cloneNode(true));
        document.getElementById('refreshSalaryBalanceBtn')?.addEventListener('click', loadSalaryBalances);
    }

    document.getElementById('salaryStartDate')?.addEventListener('change', loadSalaryBalances);
    document.getElementById('salaryEndDate')?.addEventListener('change', loadSalaryBalances);
}

function openTeachersFromSalary() {
    const usersLink = document.querySelector('.sidebar-link[data-section="users"]');
    if (usersLink) {
        usersLink.click();
        setTimeout(() => {
            document.querySelector('.filter-btn[data-role="teacher"]')?.click();
        }, 120);
        return;
    }

    if (typeof renderUsers === 'function') {
        renderUsers('teacher');
    }
}

window.openTeachersFromSalary = openTeachersFromSalary;

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
            const salaries = Array.isArray(data.data) ? data.data : (data.data?.salaries || []);
            console.log('📊 Список зарплат:', salaries);
            renderSalaryList(salaries);
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
    const toLocalDateValue = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };
    
    const startDateInput = document.getElementById('salaryStartDate');
    const endDateInput = document.getElementById('salaryEndDate');
    
    if (startDateInput) {
        startDateInput.value = toLocalDateValue(startOfMonth);
    }
    if (endDateInput) {
        endDateInput.value = toLocalDateValue(endOfMonth);
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
                const rates = [
                    `инд. ${Number(teacher.salaryIndividual || 0).toLocaleString('ru-RU')}₸`,
                    `гр. ${Number(teacher.salaryGroup || 0).toLocaleString('ru-RU')}₸`,
                    `др. ${Number(teacher.salaryOther || 0).toLocaleString('ru-RU')}₸`
                ].join(' · ');
                option.textContent = `${teacher.name} ${teacher.lastName || ''} — ${rates}`.trim();
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

    if (!salaries || salaries.length === 0) {
        salaryList.innerHTML = '';
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
                        <span class="amount" style="display: block; margin-bottom: 4px;">${salary.teacherSalary.toLocaleString()} ₸</span>
                        <span class="status ${statusClass}">${statusText}</span>
                    </div>
                </div>

                <div class="salary-actions">
                    <button class="btn btn-sm btn-secondary" onclick="viewSalaryDetails('${salary._id}')">
                        Детали
                    </button>
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

function getSalaryOperationLabel(type) {
    switch (type) {
        case 'payout': return 'Выдача ЗП';
        case 'advance': return 'Аванс';
        case 'bonus': return 'Премия';
        case 'penalty': return 'Штраф';
        default: return type || 'Операция';
    }
}

function getSalaryOperationImpact(type) {
    switch (type) {
        case 'payout':
        case 'advance':
        case 'bonus':
            return 'Расход в кассе';
        case 'penalty':
            return 'Без движения по кассе';
        default:
            return 'Операция';
    }
}

async function loadSalaryOperations() {
    const list = document.getElementById('salaryOperationsList');
    if (!list) return;

    try {
        const response = await fetch(`${API_URL}/salary/operations?limit=8`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.message || `HTTP ${response.status}`);
        }

        const operations = data.operations || [];
        if (operations.length === 0) {
            list.innerHTML = '<div style="text-align:center;opacity:.5;padding:16px;">Ручных операций пока нет</div>';
            return;
        }

        list.innerHTML = operations.map((operation) => `
            <div class="salary-operation-item">
                <div>
                    <strong>${salaryEsc(getSalaryOperationLabel(operation.type))}: ${salaryEsc(operation.teacherName)}</strong>
                    <small>${salaryEsc(operation.description || '')}</small>
                    ${operation.notes ? `<small>${salaryEsc(operation.notes)}</small>` : ''}
                </div>
                <div class="salary-operation-amount">${operation.type === 'penalty' ? '-' : ''}${salaryMoney(operation.amount)}</div>
                <div class="salary-operation-badge">${salaryEsc(getSalaryOperationImpact(operation.type))} · ${new Date(operation.date).toLocaleDateString('ru-RU')}</div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Ошибка загрузки операций зарплаты:', error);
        list.innerHTML = '<div style="text-align:center;color:#f87171;padding:16px;">Ошибка загрузки ручных операций</div>';
    }
}

async function loadSalaryBalances() {
    const summary = document.getElementById('salaryBalanceSummary');
    const list = document.getElementById('salaryBalanceList');
    if (!summary || !list) return;

    const startDate = document.getElementById('salaryStartDate')?.value || '';
    const endDate = document.getElementById('salaryEndDate')?.value || '';
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);

    try {
        const response = await fetch(`${API_URL}/salary/balances?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || `HTTP ${response.status}`);
        }

        const totals = data.totals || {};
        summary.innerHTML = [
            ['Начислено', totals.accrued],
            ['Премии', totals.bonuses],
            ['Штрафы', totals.penalties],
            ['Выплачено', (totals.paidByStatements || 0) + (totals.manualPayout || 0)],
            ['Авансы', totals.advances],
            ['Остаток к выплате', totals.due]
        ].map(([label, value]) => `
            <div class="salary-balance-stat">
                <span>${salaryEsc(label)}</span>
                <strong>${salaryMoney(value)}</strong>
            </div>
        `).join('');

        const teachers = data.teachers || [];
        if (teachers.length === 0) {
            list.innerHTML = '<div style="text-align:center;opacity:.5;padding:16px;">Нет преподавателей для отчета</div>';
            return;
        }

        list.innerHTML = `
            <table class="salary-balance-table">
                <thead>
                    <tr>
                        <th>Преподаватель</th>
                        <th>Начислено</th>
                        <th>Премии</th>
                        <th>Штрафы</th>
                        <th>Выплачено</th>
                        <th>Авансы</th>
                        <th>К выплате</th>
                    </tr>
                </thead>
                <tbody>
                    ${teachers.map((teacher) => {
                        const paid = (teacher.paidByStatements || 0) + (teacher.manualPayout || 0);
                        return `
                            <tr>
                                <td>${salaryEsc(teacher.teacherName)}</td>
                                <td>${salaryMoney(teacher.accrued)}</td>
                                <td>${salaryMoney(teacher.bonuses)}</td>
                                <td>${salaryMoney(teacher.penalties)}</td>
                                <td>${salaryMoney(paid)}</td>
                                <td>${salaryMoney(teacher.advances)}</td>
                                <td class="salary-balance-due">${salaryMoney(teacher.due)}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error('Ошибка загрузки баланса зарплат:', error);
        summary.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#f87171;padding:16px;">Ошибка загрузки баланса</div>';
        list.innerHTML = '';
    }
}

async function createSalaryOperation() {
    const teacherSelect = document.getElementById('salaryTeacherSelect');
    const teacherId = teacherSelect?.value || '';
    const type = document.getElementById('salaryOperationType')?.value || 'payout';
    const amount = parseInt(document.getElementById('salaryOperationAmount')?.value || '0', 10);
    const date = document.getElementById('salaryOperationDate')?.value || '';
    const description = document.getElementById('salaryOperationDescription')?.value?.trim() || '';
    const button = document.getElementById('createSalaryOperationBtn');

    if (!teacherId) {
        alert('Выберите преподавателя сверху');
        return;
    }
    if (!amount || amount <= 0) {
        alert('Введите сумму больше 0');
        return;
    }
    if (!date) {
        alert('Укажите дату операции');
        return;
    }

    const label = getSalaryOperationLabel(type);
    const cashNote = type === 'penalty'
        ? 'Штраф не создаст движение в кассе.'
        : 'Операция создаст расход в кассе.';
    if (!confirm(`${label}: ${salaryMoney(amount)}?\n\n${cashNote}`)) {
        return;
    }

    try {
        if (button) {
            button.disabled = true;
            button.textContent = 'Сохранение...';
        }

        const response = await fetch(`${API_URL}/salary/operations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({ teacherId, type, amount, date, description })
        });
        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.message || `HTTP ${response.status}`);
        }

        document.getElementById('salaryOperationAmount').value = '';
        document.getElementById('salaryOperationDescription').value = '';
        if (typeof toast !== 'undefined' && toast.success) {
            toast.success(data.message || 'Операция сохранена');
        } else {
            alert(data.message || 'Операция сохранена');
        }
        await loadSalaryOperations();
        await loadSalaryBalances();
    } catch (error) {
        console.error('Ошибка создания операции зарплаты:', error);
        alert('Ошибка создания операции: ' + error.message);
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = 'Сохранить';
        }
    }
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
    const bonus = parseInt(document.getElementById('salaryBonusInput')?.value || '0', 10);
    const fine = parseInt(document.getElementById('salaryFineInput')?.value || '0', 10);
    const advance = parseInt(document.getElementById('salaryAdvanceInput')?.value || '0', 10);

    if (!teacherId) {
        alert('Выберите преподавателя');
        return;
    }

    if (!startDate || !endDate) {
        alert('Укажите период');
        return;
    }

    calculateSalaryDirect(teacherId, startDate, endDate, bonus, fine, advance);
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
async function calculateSalaryDirect(teacherId, startDate, endDate, bonus = 0, fine = 0, advance = 0) {
    try {
        console.log('🧮 Начинаем расчет зарплаты...');
        
        // ПОКАЗЫВАЕМ МОДАЛКУ ЗАГРУЗКИ СРАЗУ!
        showLoadingModal();
        
        console.log('🧮 API_URL:', API_URL);
        console.log('🧮 URL:', `${API_URL}/salary/calculate`);
        console.log('🧮 Данные:', { teacherId, startDate, endDate, bonus, fine, advance });
        
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
                bonus,
                fine,
                advance
            })
        });

        console.log('🧮 Статус ответа:', response.status);
        const data = await response.json();
        console.log('🧮 Ответ сервера:', data);

        if (!response.ok) {
            throw new Error(data.message || `HTTP ${response.status}`);
        }
        
        if (data.success) {
            console.log('✅ Зарплата успешно рассчитана');
            console.log('💰 Данные зарплаты:', data.data);
            
            // Завершаем прогресс-бар
            completeLoadingProgress();
            
            // Небольшая задержка, чтобы пользователь увидел 100%
            setTimeout(() => {
                // Удаляем модалку загрузки
                hideLoadingModal();

                if (!data.data?.salaryId) {
                    alert(data.message || 'За выбранный период нет новых проведённых уроков');
                    loadSalaryData();
                    loadSalaryBalances();
                    return;
                }
                
                // Показываем детали расчета
                showSalaryCalculationDetails(data.data);
                
                loadSalaryData();
                loadSalaryBalances();
            }, 500); // 500мс задержка
        } else {
            console.error('❌ Ошибка расчета зарплаты:', data.message);
            hideLoadingModal();
            throw new Error(data.message || 'Ошибка расчета зарплаты');
        }

    } catch (error) {
        console.error('❌ Ошибка расчета зарплаты:', error);
        hideLoadingModal();
        alert('Ошибка расчета зарплаты: ' + error.message);
    }
}

// Показать модалку загрузки
function showLoadingModal() {
    const loadingModal = document.createElement('div');
    loadingModal.id = 'salaryLoadingModal';
    loadingModal.className = 'modal show';
    loadingModal.style.display = 'flex';
    loadingModal.style.alignItems = 'center';
    loadingModal.style.justifyContent = 'center';
    loadingModal.innerHTML = `
        <div class="modal-overlay"></div>
        <div class="modal-content" style="max-width: 400px;">
            <div class="modal-title">Расчет зарплаты</div>
            
            <div style="text-align: center; margin-bottom: 30px;">
                <div style="color: var(--pink); margin-bottom: 15px;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                        <polyline points="3.27,6.96 12,12.01 20.73,6.96"></polyline>
                        <line x1="12" y1="22.08" x2="12" y2="12"></line>
                    </svg>
                </div>
                <h3 style="color: var(--admin-text); font-size: 1.2rem; margin: 0 0 20px 0;">
                    Обработка данных...
                </h3>
            </div>
            
            <div style="margin-bottom: 25px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                    <span style="color: var(--admin-text); font-size: 0.9rem;">Прогресс:</span>
                    <span id="apiLoadingPercent" style="color: var(--pink); font-weight: 600;">0%</span>
                </div>
                <div style="background: rgba(255, 255, 255, 0.1); border-radius: 10px; height: 8px; overflow: hidden;">
                    <div id="apiLoadingBar" style="background: var(--pink); height: 100%; width: 0%; transition: width 0.3s ease;"></div>
                </div>
            </div>
            
            <div id="apiLoadingStatus" style="text-align: center; color: var(--admin-text); opacity: 0.8; font-size: 0.9rem; margin-bottom: 20px;">
                Отправка запроса на сервер...
            </div>
        </div>
    `;
    
    document.body.appendChild(loadingModal);
    
    // Симулируем прогресс API запроса (более реалистично)
    let progress = 0;
    const interval = setInterval(() => {
        // Очень плавный прогресс
        if (progress < 90) {
            progress += Math.random() * 3; // Быстрее до 90%
        } else if (progress < 98) {
            progress += Math.random() * 0.5; // Очень медленно от 90% до 98%
        }
        // На 98% останавливаемся и ждем ответа сервера
        
        const bar = document.getElementById('apiLoadingBar');
        const percent = document.getElementById('apiLoadingPercent');
        const status = document.getElementById('apiLoadingStatus');
        
        if (bar) bar.style.width = progress + '%';
        if (percent) percent.textContent = Math.round(progress) + '%';
        if (status) {
            if (progress < 10) status.textContent = 'Отправка запроса на сервер...';
            else if (progress < 25) status.textContent = 'Поиск занятий преподавателя...';
            else if (progress < 45) status.textContent = 'Обработка посещаемости...';
            else if (progress < 65) status.textContent = 'Расчет зарплаты по студентам...';
            else if (progress < 85) status.textContent = 'Финальная обработка данных...';
            else if (progress < 98) status.textContent = 'Почти готово...';
            else status.textContent = 'Завершение обработки...';
        }
    }, 150); // Еще более частые обновления
    
    // Сохраняем interval для очистки
    loadingModal._interval = interval;
}

// Завершить прогресс-бар
function completeLoadingProgress() {
    const bar = document.getElementById('apiLoadingBar');
    const percent = document.getElementById('apiLoadingPercent');
    const status = document.getElementById('apiLoadingStatus');
    
    if (bar) bar.style.width = '100%';
    if (percent) percent.textContent = '100%';
    if (status) status.textContent = 'Готово!';
}

// Скрыть модалку загрузки
function hideLoadingModal() {
    const modal = document.getElementById('salaryLoadingModal');
    if (modal) {
        if (modal._interval) {
            clearInterval(modal._interval);
        }
        modal.remove();
    }
}

// Расчет зарплаты (для совместимости)
async function calculateSalary() {
    calculateSalaryDirect();
}

// Показать детали расчета зарплаты
function showSalaryCalculationDetails(data) {
    console.log('📊 Начинаем создание модального окна зарплаты...');
    
    // Создаем основное модальное окно сразу (без модалки загрузки)
    createMainSalaryModal(data);
}

// Создание основного модального окна зарплаты
function createMainSalaryModal(data) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    
    // Оптимизированное формирование HTML - только основные данные
    let classesSummary = '';
    if (data.classes && data.classes.length > 0) {
        classesSummary = data.classes.map(cls => {
            return `
                <div class="class-summary">
                    <div class="class-info">
                        <strong>${cls.className}</strong>
                        <span class="class-date">${new Date(cls.classDate).toLocaleDateString('ru-RU')}</span>
                    </div>
                    <div class="class-stats">
                        <span>${cls.students ? cls.students.length : 0} студентов</span>
                        <span class="earnings">${cls.totalEarnings || 0} ₸</span>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    modal.innerHTML = `
        <div class="modal-content">
            <button class="modal-close" onclick="this.closest('.modal').remove()">×</button>
            <div class="modal-title">Детали расчета зарплаты</div>
            
            <div class="admin-card" style="margin-bottom: 20px;">
                <div style="display: flex; align-items: center; margin-bottom: 15px;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 10px; color: var(--pink);">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                    <span style="font-weight: 600; color: var(--admin-text);">${data.teacher.name}</span>
                </div>
                
                <div style="display: flex; align-items: center; margin-bottom: 20px;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px; color: var(--admin-text); opacity: 0.7;">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    <span style="color: var(--admin-text); opacity: 0.8;">${new Date(data.period.start).toLocaleDateString('ru-RU')} - ${new Date(data.period.end).toLocaleDateString('ru-RU')}</span>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 15px;">
                    <div style="text-align: center; padding: 15px; background: rgba(255, 255, 255, 0.05); border-radius: 8px;">
                        <div style="font-size: 1.5rem; font-weight: 600; color: var(--pink); margin-bottom: 5px;">${data.statistics.totalClasses}</div>
                        <div style="font-size: 0.85rem; color: var(--admin-text); opacity: 0.8;">Занятий</div>
                    </div>
                    <div style="text-align: center; padding: 15px; background: rgba(255, 255, 255, 0.05); border-radius: 8px;">
                        <div style="font-size: 1.5rem; font-weight: 600; color: var(--pink); margin-bottom: 5px;">${data.statistics.totalStudents}</div>
                        <div style="font-size: 0.85rem; color: var(--admin-text); opacity: 0.8;">Студентов</div>
                    </div>
                    <div style="text-align: center; padding: 15px; background: rgba(255, 255, 255, 0.05); border-radius: 8px;">
                        <div style="font-size: 1.5rem; font-weight: 600; color: var(--pink); margin-bottom: 5px;">${data.statistics.totalEarnings}₸</div>
                        <div style="font-size: 0.85rem; color: var(--admin-text); opacity: 0.8;">Начислено по ставкам</div>
                    </div>
                    ${data.statistics.bonus > 0 ? `
                    <div style="text-align: center; padding: 15px; background: rgba(74, 222, 128, 0.05); border-radius: 8px; border: 1px solid rgba(74, 222, 128, 0.2);">
                        <div style="font-size: 1.5rem; font-weight: 600; color: #4ade80; margin-bottom: 5px;">+${data.statistics.bonus} ₸</div>
                        <div style="font-size: 0.85rem; color: var(--admin-text); opacity: 0.8;">Премия</div>
                    </div>
                    ` : ''}
                    ${data.statistics.penaltyDeduction > 0 ? `
                    <div style="text-align: center; padding: 15px; background: rgba(248, 113, 113, 0.05); border-radius: 8px; border: 1px solid rgba(248, 113, 113, 0.2);">
                        <div style="font-size: 1.5rem; font-weight: 600; color: #f87171; margin-bottom: 5px;">-${data.statistics.penaltyDeduction} ₸</div>
                        <div style="font-size: 0.85rem; color: var(--admin-text); opacity: 0.8;">Штраф</div>
                    </div>
                    ` : ''}
                    ${data.statistics.advance > 0 ? `
                    <div style="text-align: center; padding: 15px; background: rgba(251, 191, 36, 0.05); border-radius: 8px; border: 1px solid rgba(251, 191, 36, 0.2);">
                        <div style="font-size: 1.5rem; font-weight: 600; color: #fbbf24; margin-bottom: 5px;">-${data.statistics.advance} ₸</div>
                        <div style="font-size: 0.85rem; color: var(--admin-text); opacity: 0.8;">Аванс</div>
                    </div>
                    ` : ''}
                    <div style="text-align: center; padding: 15px; background: rgba(235, 77, 119, 0.1); border: 2px solid var(--pink); border-radius: 8px;">
                        <div style="font-size: 1.5rem; font-weight: 600; color: var(--pink); margin-bottom: 5px;">${data.statistics.teacherSalary}₸</div>
                        <div style="font-size: 0.85rem; color: var(--admin-text); opacity: 0.8;">Итого к выплате</div>
                    </div>
                </div>
            </div>
            
            <div class="admin-card">
                <h4 style="color: var(--pink); margin-bottom: 15px; font-size: 1.1em; display: flex; align-items: center;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                        <path d="M9 11H5a2 2 0 0 0-2 2v3c0 1.1.9 2 2 2h4m0-7h4m0-7H9a2 2 0 0 0-2 2v3c0 1.1.9 2 2 2h4m0-7h4m0-7H9a2 2 0 0 0-2 2v3c0 1.1.9 2 2 2h4"></path>
                    </svg>
                    ДЕТАЛИ ПО ЗАНЯТИЯМ
                </h4>
                <div style="max-height: 300px; overflow-y: auto;">
                    ${classesSummary || '<p style="text-align: center; padding: 20px; opacity: 0.5; color: var(--admin-text);">Нет данных о занятиях</p>'}
                </div>
            </div>
            
            <div class="modal-footer" style="margin-top: 20px; text-align: center;">
                <button class="admin-btn btn-primary" onclick="exportSalaryToExcelAsync(${JSON.stringify(data).replace(/"/g, '&quot;')})">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14,2 14,8 20,8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                        <polyline points="10,9 9,9 8,9"></polyline>
                    </svg>
                    Скачать Excel
                </button>
            </div>
        </div>
    `;
    
    // Упрощенные стили для быстрой загрузки
    const style = document.createElement('style');
    style.textContent = `
        .class-summary {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 15px;
            margin-bottom: 8px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 6px;
            border-left: 3px solid var(--pink);
        }
        
        .class-info {
            display: flex;
            flex-direction: column;
        }
        
        .class-info strong {
            color: var(--admin-text);
            font-size: 0.95rem;
            margin-bottom: 3px;
        }
        
        .class-date {
            color: var(--admin-text);
            opacity: 0.7;
            font-size: 0.8rem;
        }
        
        .class-stats {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            text-align: right;
        }
        
        .class-stats span {
            color: var(--admin-text);
            font-size: 0.85rem;
        }
        
        .earnings {
            color: var(--pink) !important;
            font-weight: 600;
            margin-top: 3px;
        }
    `;
    
    document.head.appendChild(style);
    
    // Удаляем стили при закрытии модалки
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            style.remove();
        }
    });
    
    document.body.appendChild(modal);
    
    // Удаляем стили при закрытии через крестик
    const closeBtn = modal.querySelector('.modal-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', function() {
            style.remove();
        });
    }
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
            loadSalaryBalances();
        } else {
            throw new Error(data.message || 'Ошибка выплаты зарплаты');
        }

    } catch (error) {
        console.error('❌ Ошибка выплаты зарплаты:', error);
        alert('Ошибка выплаты зарплаты: ' + error.message);
    }
}

// Просмотр деталей зарплаты
async function viewSalaryDetails(salaryId) {
    try {
        const response = await fetch(`${API_URL}/salary/${salaryId}`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || `HTTP ${response.status}`);
        }
        createMainSalaryModal(data.data);
    } catch (error) {
        console.error('Ошибка загрузки ведомости:', error);
        alert('Не удалось открыть ведомость: ' + error.message);
    }
}

// Простые функции не нужны

// Асинхронный экспорт зарплаты в Excel с прогресс-баром
async function exportSalaryToExcelAsync(salaryData) {
    try {
        console.log('📊 Начинаем асинхронный экспорт зарплаты в Excel:', salaryData);
        
        // Создаем модальное окно прогресса
        const progressModal = document.createElement('div');
        progressModal.className = 'modal show';
        progressModal.style.display = 'flex';
        progressModal.style.alignItems = 'center';
        progressModal.style.justifyContent = 'center';
        progressModal.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content" style="max-width: 500px;">
                <button class="modal-close" onclick="this.closest('.modal').remove()">×</button>
                <div class="modal-title">Формирование Excel файла</div>
                
                <div style="text-align: center; margin-bottom: 30px;">
                    <div style="color: var(--pink); margin-bottom: 15px;">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14,2 14,8 20,8"></polyline>
                            <line x1="16" y1="13" x2="8" y2="13"></line>
                            <line x1="16" y1="17" x2="8" y2="17"></line>
                            <polyline points="10,9 9,9 8,9"></polyline>
                        </svg>
                    </div>
                    <h3 style="color: var(--admin-text); font-size: 1.2rem; margin: 0 0 20px 0;">
                        Подготовка детального отчета...
                    </h3>
                </div>
                
                <div style="background: rgba(235, 77, 119, 0.1); border: 2px solid var(--pink); border-radius: 8px; padding: 20px; margin-bottom: 25px;">
                    <div style="margin-bottom: 15px;">
                        <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Преподаватель:</div>
                        <div style="color: var(--admin-text); font-size: 1.1rem; font-weight: 600;">${salaryData.teacherName || salaryData.teacher?.name || 'Неизвестно'}</div>
                    </div>
                    <div style="margin-bottom: 15px;">
                        <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Период:</div>
                        <div style="color: var(--admin-text); font-size: 1rem;">${new Date(salaryData.period.start).toLocaleDateString('ru-RU')} - ${new Date(salaryData.period.end).toLocaleDateString('ru-RU')}</div>
                    </div>
                    <div style="margin-bottom: 15px;">
                        <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Занятий:</div>
                        <div style="color: var(--admin-text); font-size: 1rem;">${salaryData.statistics.totalClasses}</div>
                    </div>
                </div>
                
                <div style="margin-bottom: 25px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                        <span style="color: var(--admin-text); font-size: 0.9rem;">Прогресс:</span>
                        <span id="progressPercent" style="color: var(--pink); font-weight: 600;">0%</span>
                    </div>
                    <div style="background: rgba(255, 255, 255, 0.1); border-radius: 10px; height: 8px; overflow: hidden;">
                        <div id="progressBar" style="background: var(--pink); height: 100%; width: 0%; transition: width 0.3s ease;"></div>
                    </div>
                </div>
                
                <div id="progressStatus" style="text-align: center; color: var(--admin-text); opacity: 0.8; font-size: 0.9rem; margin-bottom: 20px;">
                    Инициализация...
                </div>
                
                <div style="text-align: center;">
                    <button class="modal-submit" onclick="this.closest('.modal').remove()" style="opacity: 0.5; cursor: not-allowed;" disabled>
                        Отмена
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(progressModal);
        console.log('✅ Модальное окно прогресса добавлено в DOM');
        
        // Функция обновления прогресса
        function updateProgress(percent, status) {
            const progressBar = document.getElementById('progressBar');
            const progressPercent = document.getElementById('progressPercent');
            const progressStatus = document.getElementById('progressStatus');
            
            if (progressBar) progressBar.style.width = percent + '%';
            if (progressPercent) progressPercent.textContent = percent + '%';
            if (progressStatus) progressStatus.textContent = status;
        }
        
        // Симулируем прогресс с задержками
        updateProgress(10, 'Создание рабочей книги...');
        await new Promise(resolve => setTimeout(resolve, 300));
        
        updateProgress(25, 'Подготовка сводной информации...');
        await new Promise(resolve => setTimeout(resolve, 200));
        
        updateProgress(40, 'Обработка данных по занятиям...');
        await new Promise(resolve => setTimeout(resolve, 400));
        
        updateProgress(60, 'Формирование детализации...');
        await new Promise(resolve => setTimeout(resolve, 300));
        
        updateProgress(80, 'Создание статистики...');
        await new Promise(resolve => setTimeout(resolve, 200));
        
        updateProgress(90, 'Финальная обработка...');
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Создаем рабочую книгу Excel
        const wb = XLSX.utils.book_new();
        
        // 1. Сводная информация
        const summaryData = [
            ['ПРЕПОДАВАТЕЛЬ', salaryData.teacherName || salaryData.teacher?.name || 'Неизвестно'],
            ['ПЕРИОД', `${new Date(salaryData.period.start).toLocaleDateString('ru-RU')} - ${new Date(salaryData.period.end).toLocaleDateString('ru-RU')}`],
            ['ОБЩЕЕ КОЛИЧЕСТВО ЗАНЯТИЙ', salaryData.statistics.totalClasses],
            ['ОБЩЕЕ КОЛИЧЕСТВО СТУДЕНТОВ', salaryData.statistics.totalStudents],
            ['ВЫПЛАТЫ ЗА ЗАНЯТИЯ', `${salaryData.statistics.totalEarnings}₸`],
            ['ЗАРПЛАТА К ВЫПЛАТЕ', `${salaryData.statistics.teacherSalary}₸`],
            ['СТАТУС', getSalaryStatusText(salaryData.status)],
            ['ДАТА РАСЧЕТА', new Date(salaryData.calculatedAt || Date.now()).toLocaleString('ru-RU')]
        ];
        
        const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, summarySheet, 'Сводка');
        
        updateProgress(95, 'Создание детализации...');
        
        // 2. Детализация по занятиям с полной информацией
        const classesData = [
            ['ЗАНЯТИЕ', 'ДАТА', 'ГРУППА', 'СТУДЕНТ', 'СТАВКА ЗА ЗАНЯТИЕ']
        ];
        
        if (salaryData.classes && salaryData.classes.length > 0) {
            salaryData.classes.forEach(cls => {
                if (cls.students && cls.students.length > 0) {
                    cls.students.forEach(student => {
                        classesData.push([
                            cls.className,
                            new Date(cls.classDate).toLocaleDateString('ru-RU'),
                            cls.groupName || 'Не указана',
                            student.studentName,
                            `${cls.totalEarnings}₸`
                        ]);
                    });
                } else {
                    classesData.push([
                        cls.className,
                        new Date(cls.classDate).toLocaleDateString('ru-RU'),
                        cls.groupName || 'Не указана',
                        'Нет студентов',
                        `${cls.totalEarnings}₸`
                    ]);
                }
            });
        }
        
        const classesSheet = XLSX.utils.aoa_to_sheet(classesData);
        XLSX.utils.book_append_sheet(wb, classesSheet, 'Детализация');
        
        // 3. Статистика по занятиям
        const paymentStats = [
            ['ЗАНЯТИЕ', 'ДАТА ЗАНЯТИЯ', 'СТАВКА']
        ];
        
        if (salaryData.classes && salaryData.classes.length > 0) {
            salaryData.classes.forEach(cls => {
                paymentStats.push([
                    cls.className,
                    new Date(cls.classDate).toLocaleDateString('ru-RU'),
                    `${cls.totalEarnings}₸`
                ]);
            });
        }
        
        const statsSheet = XLSX.utils.aoa_to_sheet(paymentStats);
        XLSX.utils.book_append_sheet(wb, statsSheet, 'Статистика');
        
        // 4. Детальная информация по каждому занятию
        const detailedClassesData = [
            ['ЗАНЯТИЕ', 'ДАТА ЗАНЯТИЯ', 'ГРУППА', 'ОБЩЕЕ КОЛИЧЕСТВО СТУДЕНТОВ', 'СТАВКА ЗАРПЛАТЫ', 'ДЕТАЛИ СТУДЕНТОВ']
        ];
        
        if (salaryData.classes && salaryData.classes.length > 0) {
            salaryData.classes.forEach(cls => {
                let studentsDetails = '';
                if (cls.students && cls.students.length > 0) {
                    studentsDetails = cls.students.map(student => student.studentName).join(', ');
                }
                
                detailedClassesData.push([
                    cls.className,
                    new Date(cls.classDate).toLocaleDateString('ru-RU'),
                    cls.groupName || 'Не указана',
                    cls.students ? cls.students.length : 0,
                    `${cls.totalEarnings}₸`,
                    studentsDetails || 'Нет студентов'
                ]);
            });
        }
        
        const detailedSheet = XLSX.utils.aoa_to_sheet(detailedClassesData);
        XLSX.utils.book_append_sheet(wb, detailedSheet, 'По занятиям');
        
        updateProgress(98, 'Сохранение файла...');
        
        // Генерируем имя файла
        const teacherName = salaryData.teacherName || salaryData.teacher?.name || 'Неизвестно';
        const fileName = `Зарплата_${teacherName}_${new Date(salaryData.period.start).toLocaleDateString('ru-RU').replace(/\./g, '-')}_${new Date(salaryData.period.end).toLocaleDateString('ru-RU').replace(/\./g, '-')}.xlsx`;
        
        updateProgress(100, 'Готово!');
        
        // Скачиваем файл
        XLSX.writeFile(wb, fileName);
        
        // Обновляем модальное окно на успех
        progressModal.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content" style="max-width: 500px;">
                <button class="modal-close" onclick="this.closest('.modal').remove()">×</button>
                <div class="modal-title">Excel файл готов!</div>
                
                <div style="text-align: center; margin-bottom: 30px;">
                    <div style="color: var(--pink); margin-bottom: 15px;">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 12l2 2 4-4"></path>
                            <circle cx="12" cy="12" r="10"></circle>
                        </svg>
                    </div>
                    <h3 style="color: var(--admin-text); font-size: 1.2rem; margin: 0 0 20px 0;">
                        Файл успешно создан
                    </h3>
                </div>
                
                <div style="background: rgba(235, 77, 119, 0.1); border: 2px solid var(--pink); border-radius: 8px; padding: 20px; margin-bottom: 25px;">
                    <div style="margin-bottom: 15px;">
                        <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Имя файла:</div>
                        <div style="color: var(--admin-text); font-size: 1rem; font-weight: 600;">${fileName}</div>
                    </div>
                    <div style="margin-bottom: 15px;">
                        <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Размер:</div>
                        <div style="color: var(--admin-text); font-size: 1rem;">4 листа с полной детализацией</div>
                    </div>
                    <div>
                        <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Время создания:</div>
                        <div style="color: var(--admin-text); font-size: 1rem;">${new Date().toLocaleTimeString('ru-RU')}</div>
                    </div>
                </div>
                
                <div style="text-align: center;">
                    <button class="modal-submit" onclick="this.closest('.modal').remove()">
                        Закрыть
                    </button>
                </div>
            </div>
        `;
        
        console.log('✅ Excel файл успешно создан:', fileName);
        
    } catch (error) {
        console.error('❌ Ошибка экспорта в Excel:', error);
        
        // Показываем ошибку в модальном окне
        const errorModal = document.createElement('div');
        errorModal.className = 'modal show';
        errorModal.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content" style="max-width: 500px;">
                <button class="modal-close" onclick="this.closest('.modal').remove()">×</button>
                <div class="modal-title">Ошибка создания файла</div>
                
                <div style="text-align: center; margin-bottom: 30px;">
                    <div style="color: #ff4757; margin-bottom: 15px;">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="15" y1="9" x2="9" y2="15"></line>
                            <line x1="9" y1="9" x2="15" y2="15"></line>
                        </svg>
                    </div>
                    <h3 style="color: var(--admin-text); font-size: 1.2rem; margin: 0 0 20px 0;">
                        Не удалось создать Excel файл
                    </h3>
                </div>
                
                <div style="background: rgba(255, 71, 87, 0.1); border: 2px solid #ff4757; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
                    <div style="color: var(--admin-text); font-size: 0.9rem;">
                        ${error.message || 'Неизвестная ошибка'}
                    </div>
                </div>
                
                <div style="text-align: center;">
                    <button class="modal-submit" onclick="this.closest('.modal').remove()">
                        Закрыть
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(errorModal);
    }
}

// Экспорт зарплаты в Excel
function exportSalaryToExcel(salaryData) {
    try {
        console.log('📊 Экспорт зарплаты в Excel:', salaryData);
        
        // Создаем рабочую книгу Excel
        const wb = XLSX.utils.book_new();
        
        // 1. Сводная информация
        const summaryData = [
            ['ПРЕПОДАВАТЕЛЬ', salaryData.teacherName || salaryData.teacher?.name || 'Неизвестно'],
            ['ПЕРИОД', `${new Date(salaryData.period.start).toLocaleDateString('ru-RU')} - ${new Date(salaryData.period.end).toLocaleDateString('ru-RU')}`],
            ['ОБЩЕЕ КОЛИЧЕСТВО ЗАНЯТИЙ', salaryData.statistics.totalClasses],
            ['ОБЩЕЕ КОЛИЧЕСТВО СТУДЕНТОВ', salaryData.statistics.totalStudents],
            ['ВЫПЛАТЫ ЗА ЗАНЯТИЯ', `${salaryData.statistics.totalEarnings}₸`],
            ['ЗАРПЛАТА К ВЫПЛАТЕ', `${salaryData.statistics.teacherSalary}₸`],
            ['СТАТУС', getSalaryStatusText(salaryData.status)],
            ['ДАТА РАСЧЕТА', new Date(salaryData.calculatedAt || Date.now()).toLocaleString('ru-RU')]
        ];
        
        const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, summarySheet, 'Сводка');
        
        // 2. Детализация по занятиям с полной информацией
        const classesData = [
            ['ЗАНЯТИЕ', 'ДАТА', 'ГРУППА', 'СТУДЕНТ', 'СТАВКА ЗА ЗАНЯТИЕ']
        ];
        
        if (salaryData.classes && salaryData.classes.length > 0) {
            salaryData.classes.forEach(cls => {
                if (cls.students && cls.students.length > 0) {
                    cls.students.forEach(student => {
                        classesData.push([
                            cls.className,
                            new Date(cls.classDate).toLocaleDateString('ru-RU'),
                            cls.groupName || 'Не указана',
                            student.studentName,
                            `${cls.totalEarnings}₸`
                        ]);
                    });
                } else {
                    classesData.push([
                        cls.className,
                        new Date(cls.classDate).toLocaleDateString('ru-RU'),
                        cls.groupName || 'Не указана',
                        'Нет студентов',
                        `${cls.totalEarnings}₸`
                    ]);
                }
            });
        }
        
        const classesSheet = XLSX.utils.aoa_to_sheet(classesData);
        XLSX.utils.book_append_sheet(wb, classesSheet, 'Детализация');
        
        // 3. Статистика по занятиям
        const paymentStats = [
            ['ЗАНЯТИЕ', 'ДАТА ЗАНЯТИЯ', 'СТАВКА']
        ];
        
        if (salaryData.classes && salaryData.classes.length > 0) {
            salaryData.classes.forEach(cls => {
                paymentStats.push([
                    cls.className,
                    new Date(cls.classDate).toLocaleDateString('ru-RU'),
                    `${cls.totalEarnings}₸`
                ]);
            });
        }
        
        const statsSheet = XLSX.utils.aoa_to_sheet(paymentStats);
        XLSX.utils.book_append_sheet(wb, statsSheet, 'Статистика');
        
        // 4. Детальная информация по каждому занятию
        const detailedClassesData = [
            ['ЗАНЯТИЕ', 'ДАТА ЗАНЯТИЯ', 'ГРУППА', 'ОБЩЕЕ КОЛИЧЕСТВО СТУДЕНТОВ', 'СТАВКА ЗАРПЛАТЫ', 'ДЕТАЛИ СТУДЕНТОВ']
        ];
        
        if (salaryData.classes && salaryData.classes.length > 0) {
            salaryData.classes.forEach(cls => {
                let studentsDetails = '';
                if (cls.students && cls.students.length > 0) {
                    studentsDetails = cls.students.map(student => student.studentName).join(', ');
                }
                
                detailedClassesData.push([
                    cls.className,
                    new Date(cls.classDate).toLocaleDateString('ru-RU'),
                    cls.groupName || 'Не указана',
                    cls.students ? cls.students.length : 0,
                    `${cls.totalEarnings}₸`,
                    studentsDetails || 'Нет студентов'
                ]);
            });
        }
        
        const detailedSheet = XLSX.utils.aoa_to_sheet(detailedClassesData);
        XLSX.utils.book_append_sheet(wb, detailedSheet, 'По занятиям');
        
        // Генерируем имя файла
        const teacherName = salaryData.teacherName || salaryData.teacher?.name || 'Неизвестно';
        const fileName = `Зарплата_${teacherName}_${new Date(salaryData.period.start).toLocaleDateString('ru-RU').replace(/\./g, '-')}_${new Date(salaryData.period.end).toLocaleDateString('ru-RU').replace(/\./g, '-')}.xlsx`;
        
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
window.createSalaryOperation = createSalaryOperation;
window.loadSalaryOperations = loadSalaryOperations;
window.exportSalaryToExcel = exportSalaryToExcel;
window.exportSalaryToExcelAsync = exportSalaryToExcelAsync;
