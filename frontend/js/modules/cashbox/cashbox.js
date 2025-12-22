// =====================================================
// CASHBOX MODULE - Касса
// =====================================================

let currentCashboxPeriod = 'month';
let currentCashboxStartDate = null;
let currentCashboxEndDate = null;

// Пагинация для платежей
let currentPaymentsPage = 1;
let paymentsTotalPages = 1;
const paymentsPerPage = 20;

// Пагинация для транзакций
let currentTransactionsPage = 1;
let transactionsTotalPages = 1;
const transactionsPerPage = 20;

// Получить текст типа платежа с детализацией
function getPaymentTypeText(payment) {
    // Если передали просто строку (старый формат) - вернем базовый текст
    if (typeof payment === 'string') {
        const types = {
            'trial_advance': 'Аванс (пробное)',
            'trial_full': 'Пробное занятие',
            'membership_advance': 'Аванс (абонемент)',
            'membership_balance': 'Доплата (абонемент)',
            'membership_full': 'Абонемент (полный)',
            'single_class': 'Разовое занятие',
            'individual_class': 'Индивидуальное занятие'
        };
        return types[payment] || payment;
    }
    
    // Детальная информация с типом абонемента
    const type = payment.type;
    const membershipType = payment.membership?.type;
    
    // Названия типов абонементов
    const membershipNames = {
        'trial': 'пробное',
        'monthly': 'месячный',
        'quarterly': 'квартальный'
    };
    
    // Формируем детальный текст
    switch(type) {
        case 'trial_advance':
            return 'Аванс (пробное)';
        case 'trial_full':
            return 'Пробное занятие';
        case 'membership_advance':
            if (membershipType) {
                return `Аванс (${membershipNames[membershipType] || membershipType})`;
            }
            return 'Аванс (абонемент)';
        case 'membership_balance':
            if (membershipType) {
                return `Доплата (${membershipNames[membershipType] || membershipType})`;
            }
            return 'Доплата (абонемент)';
        case 'membership_full':
            if (membershipType) {
                return `${membershipNames[membershipType]?.charAt(0).toUpperCase() + membershipNames[membershipType]?.slice(1) || membershipType} (полный)`;
            }
            return 'Абонемент (полный)';
        case 'single_class':
            return 'Разовое занятие';
        case 'individual_class':
            return 'Индивидуальное занятие';
        default:
            return type;
    }
}

// Отобразить кассу - ПРОСТАЯ ФУНКЦИЯ БЕЗ ГОВНА!
async function renderCashbox(period = 'month', startDate = null, endDate = null) {
    // Показать прогресс-бар
    if (window.showLoading) {
        window.showLoading();
    }
    
    try {
        const token = getAuthToken();
        if (!token) {
            console.error('No auth token');
            return;
        }
        
        // Сохраняем период для использования в запросах
        currentCashboxPeriod = period;
        currentCashboxStartDate = startDate;
        currentCashboxEndDate = endDate;
        
        // Загружаем статистику кассы (только summary, без byType, byManager, byDay)
        let url = `${API_URL}/cashbox/stats?period=${period}`;
        if (startDate && endDate) {
            url += `&startDate=${startDate}&endDate=${endDate}`;
        }
        
        const statsResponse = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const statsData = await statsResponse.json();
        
        // Загружаем статистику транзакций
        let transUrl = `${API_URL}/cash-transactions/statistics?period=${period}`;
        if (startDate && endDate) {
            transUrl += `&startDate=${startDate}&endDate=${endDate}`;
        }
        
        const transResponse = await fetch(transUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const transData = await transResponse.json();
        
        // РАСЧИТЫВАЕМ ВСЕ ДАННЫЕ
        if (statsData.success && transData.success) {
            const stats = statsData.summary;
            const trans = transData.statistics;
            
            // ДОХОД = платежи + доходные транзакции
            const totalRevenue = (stats.total || 0) + (trans.totalIncome || 0);
            
            // РАСХОДЫ = расходные транзакции
            const totalExpenses = trans.totalExpense || 0;
            
            // ПРИБЫЛЬ = доход - расходы
            const netProfit = totalRevenue - totalExpenses;
            
            // ТРАНЗАКЦИИ = все вместе
            const totalTransactions = (stats.count || 0) + (trans.incomeCount || 0) + (trans.expenseCount || 0);
            
            // УСТАНАВЛИВАЕМ ВСЕ ЗНАЧЕНИЯ
            document.getElementById('newCashboxRevenue').textContent = formatAmount(totalRevenue);
            document.getElementById('newCashboxExpense').textContent = formatAmount(totalExpenses);
            document.getElementById('newCashboxProfit').textContent = formatAmount(netProfit);
            document.getElementById('newCashboxCount').textContent = totalTransactions;
            
            // Загружаем платежи с пагинацией
            try {
                await loadPayments();
            } catch (error) {
                console.error('❌ Load payments error:', error);
            }
            
            // Инициализируем обработчики кнопок
            initTransactionHandlers();
            
        } else {
            console.error('❌ API calls failed:', { statsData, transData });
        }
        
        // Загружаем транзакции для таблицы (с пагинацией)
        try {
            await loadCashTransactions();
        } catch (error) {
            console.error('❌ Load transactions error:', error);
        }
        
    } catch (error) {
        console.error('❌ CASHBOX ERROR:', error);
    } finally {
        // Скрыть прогресс-бар после завершения (всегда)
        if (window.hideLoading) {
            window.hideLoading();
        }
    }
    
    // Загружаем менеджеров для зарплаты
    await loadManagers();
    
    // Инициализация зарплаты преподавателей
    if (typeof initSalaryModule === 'function') {
        initSalaryModule();
    }
    
    // Принудительно обновляем списки через небольшую задержку
    setTimeout(() => {
        loadManagers();
        if (typeof loadTeachersForSalary === 'function') {
            loadTeachersForSalary();
        }
    }, 500);
}

// Добавляем в глобальную область для тестирования
window.testCashbox = function() {
    renderCashbox('month');
};

// Глобальная функция для принудительной загрузки списков
window.loadSalaryLists = function() {
    loadManagers();
    if (typeof loadTeachersForSalary === 'function') {
        loadTeachersForSalary();
    }
};

// Загрузить платежи с пагинацией
async function loadPayments() {
    try {
        const token = getAuthToken();
        if (!token) {
            console.error('No auth token');
            return;
        }
        
        // Определяем период для запроса
        let start = null;
        let end = null;
        const now = new Date();
        
        if (currentCashboxStartDate && currentCashboxEndDate) {
            start = currentCashboxStartDate;
            end = currentCashboxEndDate;
        }
        
        let url = `${API_URL}/cashbox/payments?page=${currentPaymentsPage}&limit=${paymentsPerPage}&period=${currentCashboxPeriod}`;
        if (start && end) {
            url += `&startDate=${start}&endDate=${end}`;
        }
        
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Payments API error:', response.status, errorText);
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
            console.error('Failed to load payments:', data.error || 'Unknown error');
            renderPayments([], 0, 1, 1);
            updatePaymentsPagination();
            return;
        }
        
        // Проверяем наличие данных
        if (!data.payments) {
            console.warn('Payments data is missing payments array');
            renderPayments([], 0, 1, 1);
            updatePaymentsPagination();
            return;
        }
        
        renderPayments(data.payments || [], data.total || 0, data.page || 1, data.totalPages || 1);
        paymentsTotalPages = data.totalPages || 1;
        updatePaymentsPagination();
        
        // Обновляем заголовок периода
        if (data.period) {
            try {
                const periodText = getPeriodText(data.period.type, data.period.start, data.period.end);
                const periodTitle = document.getElementById('cashboxPeriodTitle');
                if (periodTitle) {
                    periodTitle.textContent = periodText;
                }
            } catch (periodError) {
                console.error('Error formatting period text:', periodError);
            }
        }
    } catch (error) {
        console.error('Load payments error:', error);
        const table = document.getElementById('cashboxRecentPayments');
        if (table) {
            table.innerHTML = '<tr><td colspan="6" style="text-align: center; opacity: 0.5; color: #dc3545;">Ошибка загрузки данных</td></tr>';
        }
        paymentsTotalPages = 1;
        updatePaymentsPagination();
    }
}

// Отрисовать платежи
function renderPayments(payments, total, page, totalPages) {
    const table = document.getElementById('cashboxRecentPayments');
    
    if (!table) {
        console.error('Table element cashboxRecentPayments not found');
        return;
    }
    
    if (!payments || payments.length === 0) {
        table.innerHTML = '<tr><td colspan="6" style="text-align: center; opacity: 0.5;">Нет платежей за выбранный период</td></tr>';
        return;
    }
    
    table.innerHTML = payments.map(payment => {
        const date = new Date(payment.paymentDate).toLocaleDateString('ru', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        
        const studentName = payment.studentName || 'Студент удален';
        const managerName = payment.managerName || 'Менеджер удален';
        
        return `
            <tr>
                <td>${date}</td>
                <td>${studentName}</td>
                <td>${getPaymentTypeText(payment)}</td>
                <td>${managerName}</td>
                <td style="text-align: right; font-weight: 600; color: var(--pink);">${formatAmount(payment.amount)}</td>
                <td style="text-align: center;">
                    <button class="table-btn" onclick="deletePayment('${payment._id}')" style="background: #dc3545; padding: 6px 12px;">
                        Удалить
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Обновить пагинацию платежей
function updatePaymentsPagination() {
    const prevBtn = document.getElementById('paymentsPrevBtn');
    const nextBtn = document.getElementById('paymentsNextBtn');
    const pageInfo = document.getElementById('paymentsPageInfo');
    
    if (prevBtn) prevBtn.disabled = currentPaymentsPage === 1;
    if (nextBtn) nextBtn.disabled = currentPaymentsPage >= paymentsTotalPages;
    if (pageInfo) pageInfo.textContent = `Страница ${currentPaymentsPage} из ${paymentsTotalPages}`;
}

// Изменить страницу платежей
window.changePaymentsPage = function(direction) {
    const newPage = currentPaymentsPage + direction;
    if (newPage >= 1 && newPage <= paymentsTotalPages) {
        currentPaymentsPage = newPage;
        loadPayments();
    }
}

// Получить текст периода для заголовка
function getPeriodText(type, start, end) {
    const startDate = new Date(start);
    const endDate = new Date(end);
    
    switch(type) {
        case 'today':
            return `Сегодня, ${startDate.toLocaleDateString('ru', { day: 'numeric', month: 'long' })}`;
        case 'week':
            return `Последние 7 дней`;
        case 'month':
            return startDate.toLocaleDateString('ru', { month: 'long', year: 'numeric' });
        case 'year':
            return `${startDate.getFullYear()} год`;
        default:
            return `${startDate.toLocaleDateString('ru')} - ${endDate.toLocaleDateString('ru')}`;
    }
}

// Изменить период
function changeCashboxPeriod(period) {
    // Сбрасываем пагинацию
    currentPaymentsPage = 1;
    currentTransactionsPage = 1;
    
    // Обновить активную кнопку
    document.querySelectorAll('.cashbox-period-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-period="${period}"]`)?.classList.add('active');
    
    // Показать прогресс-бар при смене периода
    if (window.showLoading) {
        window.showLoading();
    }
    renderCashbox(period);
}

// Применить пользовательский период
function applyCashboxCustomPeriod() {
    const startDate = document.getElementById('cashboxStartDate').value;
    const endDate = document.getElementById('cashboxEndDate').value;
    
    if (!startDate || !endDate) {
        toast.warning('Укажите начальную и конечную даты');
        return;
    }
    
    if (new Date(startDate) > new Date(endDate)) {
        toast.warning('Начальная дата не может быть позже конечной');
        return;
    }
    
    // Сбрасываем пагинацию
    currentPaymentsPage = 1;
    currentTransactionsPage = 1;
    
    // Показать прогресс-бар при применении пользовательского периода
    if (window.showLoading) {
        window.showLoading();
    }
    renderCashbox('custom', startDate, endDate);
}

// Загрузить список менеджеров
async function loadManagers() {
    try {
        const select = document.getElementById('salaryManagerSelect');
        if (!select) {
            console.error('❌ Элемент salaryManagerSelect не найден');
            return;
        }
        
        const token = getAuthToken();
        if (!token) {
            console.error('❌ Нет токена авторизации');
            return;
        }
        
        console.log('👥 Загружаем менеджеров...');
        console.log('👥 API_URL:', API_URL);
        console.log('👥 URL:', `${API_URL}/users/sales-managers`);
        console.log('👥 Токен:', token ? 'Есть' : 'Нет');
        
        const response = await fetch(`${API_URL}/users/sales-managers`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        console.log('👥 Статус ответа:', response.status);
        console.log('👥 Headers:', response.headers);
        
        const data = await response.json();
        console.log('👥 Данные менеджеров:', data);
        console.log('👥 Тип данных:', typeof data);
        console.log('👥 Ключи данных:', Object.keys(data));
        
        if (data.success && data.managers && data.managers.length > 0) {
            select.innerHTML = '<option value="">Выберите менеджера</option>' +
                data.managers.map(m => 
                    `<option value="${m._id}">${m.name} ${m.lastName || ''}</option>`
                ).join('');
            console.log('✅ Менеджеры загружены:', data.managers.length);
        } else {
            console.error('❌ Нет менеджеров или ошибка API:', data);
            select.innerHTML = '<option value="">Нет менеджеров - создайте в разделе "Пользователи"</option>';
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки менеджеров:', error);
    }
}

// Показать зарплату менеджера
async function showManagerSalary() {
    const managerId = document.getElementById('salaryManagerSelect').value;
    const month = document.getElementById('salaryMonth').value;
    const plan = document.getElementById('salaryPlan').value;
    
    if (!managerId) {
        toast.warning('Выберите менеджера');
        return;
    }
    
    try {
        const token = getAuthToken();
        const params = new URLSearchParams();
        if (month) params.append('month', month);
        if (plan) params.append('plan', plan);
        
        const url = `${API_URL}/cashbox/salary/${managerId}${params.toString() ? '?' + params.toString() : ''}`;
        
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (data.success) {
            renderManagerSalary(data, plan);
        } else {
            toast.error(data.error || 'Ошибка получения зарплаты');
        }
    } catch (error) {
        console.error('Show salary error:', error);
        toast.error('Ошибка подключения к серверу');
    }
}

// Отрисовать зарплату менеджера
function renderManagerSalary(data, plan) {
    const { manager, summary, breakdown, config } = data;
    
    const container = document.getElementById('salaryBreakdown');
    
    // Определить тир на основе количества абонементов
    const tier = config.membershipTiers.find(t => 
        summary.membershipsSold >= t.min && 
        (t.max === null || summary.membershipsSold <= t.max)
    );
    
    // Проверка выполнения плана
    const planValue = parseFloat(plan);
    const planAchieved = planValue > 0 && summary.totalRevenue >= planValue;
    
    container.innerHTML = `
        <div style="background: rgba(235, 77, 119, 0.05); border: 1px solid rgba(235, 77, 119, 0.2); border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <h4 style="color: var(--pink); margin: 0 0 15px 0; font-size: 1.1em;">${manager.name}</h4>
            
            ${planValue > 0 ? `
                <div style="background: rgba(${planAchieved ? '16, 185, 129' : '255, 193, 7'}, 0.1); border: 1px solid rgba(${planAchieved ? '16, 185, 129' : '255, 193, 7'}, 0.3); border-radius: 6px; padding: 12px; margin-bottom: 15px; text-align: center;">
                    <div style="font-size: 0.8em; opacity: 0.8; margin-bottom: 5px;">ПЛАН МЕСЯЦА</div>
                    <div style="font-size: 1.3em; font-weight: 700; color: ${planAchieved ? '#10b981' : '#ffc107'};">
                        ${formatAmount(summary.totalRevenue)} / ${formatAmount(planValue)}
                    </div>
                    <div style="font-size: 0.85em; margin-top: 5px; color: ${planAchieved ? '#10b981' : '#ffc107'};">
                        ${planAchieved ? '✅ ПЛАН ВЫПОЛНЕН! Премия +20,000₸' : '⏳ План не выполнен'}
                    </div>
                </div>
            ` : ''}
            
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 20px;">
                <div style="text-align: center;">
                    <div style="font-size: 0.8em; opacity: 0.7; margin-bottom: 5px;">ПРОДАНО АБОНЕМЕНТОВ</div>
                    <div style="font-size: 1.8em; font-weight: 700; color: var(--pink);">${summary.membershipsSold}</div>
                    <div style="font-size: 0.75em; opacity: 0.6; margin-top: 3px;">Ставка: ${summary.commissionRate}%</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 0.8em; opacity: 0.7; margin-bottom: 5px;">ВЫРУЧКА</div>
                    <div style="font-size: 1.8em; font-weight: 700;">${formatAmount(summary.totalRevenue)}</div>
                    <div style="font-size: 0.75em; opacity: 0.6; margin-top: 3px;">${summary.paymentsCount} платежей</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 0.8em; opacity: 0.7; margin-bottom: 5px;">ЗАРПЛАТА</div>
                    <div style="font-size: 2.2em; font-weight: 700; color: #10b981;">${formatAmount(summary.totalSalary)}</div>
                </div>
            </div>
            
            <!-- Разбивка по типам -->
            <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 15px;">
                <h5 style="font-size: 0.9em; opacity: 0.8; margin-bottom: 10px;">РАЗБИВКА КОМИССИИ:</h5>
                
                ${breakdown.memberships.count > 0 ? `
                    <div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                            <span>Абонементы (${breakdown.memberships.count} шт)</span>
                            <span style="font-weight: 600;">${formatAmount(breakdown.memberships.commission)}</span>
                        </div>
                        <div style="font-size: 0.75em; opacity: 0.6;">
                            ${formatAmount(breakdown.memberships.amount)} × ${summary.commissionRate}%
                        </div>
                    </div>
                ` : ''}
                
                ${breakdown.trials.count > 0 ? `
                    <div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                            <span>Пробные (${breakdown.trials.count} шт)</span>
                            <span style="font-weight: 600;">${formatAmount(breakdown.trials.commission)}</span>
                        </div>
                        <div style="font-size: 0.75em; opacity: 0.6;">
                            ${formatAmount(breakdown.trials.amount)} × ${config.trialRate}%
                        </div>
                    </div>
                ` : ''}
                
                ${breakdown.singleClasses.count > 0 ? `
                    <div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                            <span>Разовые (${breakdown.singleClasses.count} шт)</span>
                            <span style="font-weight: 600;">${formatAmount(breakdown.singleClasses.commission)}</span>
                        </div>
                        <div style="font-size: 0.75em; opacity: 0.6;">
                            ${formatAmount(breakdown.singleClasses.amount)} × ${config.singleClassRate}%
                        </div>
                    </div>
                ` : ''}
                
                ${breakdown.individualClasses.count > 0 ? `
                    <div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                            <span>Индивидуальные (${breakdown.individualClasses.count} шт)</span>
                            <span style="font-weight: 600;">${formatAmount(breakdown.individualClasses.commission)}</span>
                        </div>
                        <div style="font-size: 0.75em; opacity: 0.6;">
                            ${formatAmount(breakdown.individualClasses.amount)} × ${config.individualClassRate}%
                        </div>
                    </div>
                ` : ''}
                
                ${summary.planBonus > 0 ? `
                    <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <span>🎯 Бонус за выполнение плана</span>
                        <span style="font-weight: 600; color: #10b981;">${formatAmount(summary.planBonus)}</span>
                    </div>
                ` : ''}
                
                <div style="display: flex; justify-content: space-between; padding: 15px 0 0 0; margin-top: 10px; border-top: 2px solid rgba(235,77,119,0.3);">
                    <strong style="font-size: 1.1em;">ИТОГО К ВЫПЛАТЕ:</strong>
                    <strong style="font-size: 1.3em; color: #10b981;">${formatAmount(summary.totalSalary)}</strong>
                </div>
            </div>
        </div>
        
        <!-- Ставки комиссий -->
        <div style="background: rgba(255,255,255,0.02); padding: 15px; border-radius: 8px; font-size: 0.85em;">
            <h5 style="font-size: 0.9em; opacity: 0.8; margin-bottom: 10px;">СТАВКИ КОМИССИЙ:</h5>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
                ${config.membershipTiers.map(tier => `
                    <div>
                        ${tier.min}-${tier.max || '∞'} абонементов → <strong>${tier.rate}%</strong>
                        ${summary.membershipsSold >= tier.min && (tier.max === null || summary.membershipsSold <= tier.max) ? 
                            '<span style="color: #10b981;"> ← текущая</span>' : ''}
                    </div>
                `).join('')}
                <div>Пробные → <strong>${config.trialRate}%</strong></div>
                <div>Разовые → <strong>${config.singleClassRate}%</strong></div>
                <div>Индивидуальные → <strong>${config.individualClassRate}%</strong></div>
            </div>
        </div>
    `;
}

// =====================================================
// ТРАНЗАКЦИИ КАССЫ (РАСХОДЫ/ДОХОДЫ)
// =====================================================

let currentTransactionFilter = 'all';

// Открыть модалку добавления дохода
window.openIncomeModal = function() {
    const modal = document.getElementById('incomeModal');
    const form = document.getElementById('incomeForm');
    
    form.reset();
    document.getElementById('incomeDate').value = new Date().toISOString().split('T')[0];
    
    modal.classList.add('show');
}

// Открыть модалку добавления расхода
window.openExpenseModal = function() {
    const modal = document.getElementById('expenseModal');
    const form = document.getElementById('expenseForm');
    
    form.reset();
    document.getElementById('expenseDate').value = new Date().toISOString().split('T')[0];
    
    modal.classList.add('show');
}

// Закрыть модалки транзакций
window.closeCashTransactionModal = function() {
    document.getElementById('incomeModal')?.classList.remove('show');
    document.getElementById('expenseModal')?.classList.remove('show');
}

// Загрузить и отобразить транзакции с пагинацией
async function loadCashTransactions() {
    try {
        const token = getAuthToken();
        if (!token) {
            console.warn('No auth token for transactions');
            return;
        }
        
        // Определяем период для запроса
        let start = null;
        let end = null;
        
        if (currentCashboxStartDate && currentCashboxEndDate) {
            start = currentCashboxStartDate;
            end = currentCashboxEndDate;
        }
        
        let url = `${API_URL}/cash-transactions?page=${currentTransactionsPage}&limit=${transactionsPerPage}`;
        const params = [];
        
        if (start && end) {
            params.push(`startDate=${start}&endDate=${end}`);
        }
        
        if (currentTransactionFilter !== 'all') {
            params.push(`type=${currentTransactionFilter}`);
        }
        
        if (params.length > 0) {
            url += '&' + params.join('&');
        }
        
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Transactions API error:', response.status, errorText);
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
            console.error('Failed to load transactions:', data.error || 'Unknown error');
            renderTransactionsTable([]);
            transactionsTotalPages = 1;
            updateTransactionsPagination();
            return;
        }
        
        // Проверяем наличие данных
        if (!data.transactions) {
            console.warn('Transactions data is missing transactions array');
            renderTransactionsTable([]);
            transactionsTotalPages = 1;
            updateTransactionsPagination();
            return;
        }
        
        renderTransactionsTable(data.transactions || []);
        transactionsTotalPages = data.totalPages || 1;
        updateTransactionsPagination();
    } catch (error) {
        console.error('Load transactions error:', error);
        // Показываем сообщение об ошибке в таблице
        const tbody = document.getElementById('cashboxTransactions');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; opacity: 0.5; color: #dc3545;">Ошибка загрузки данных</td></tr>';
        }
        transactionsTotalPages = 1;
        updateTransactionsPagination();
    }
}

// Обновить пагинацию транзакций
function updateTransactionsPagination() {
    const prevBtn = document.getElementById('transactionsPrevBtn');
    const nextBtn = document.getElementById('transactionsNextBtn');
    const pageInfo = document.getElementById('transactionsPageInfo');
    
    if (prevBtn) prevBtn.disabled = currentTransactionsPage === 1;
    if (nextBtn) nextBtn.disabled = currentTransactionsPage >= transactionsTotalPages;
    if (pageInfo) pageInfo.textContent = `Страница ${currentTransactionsPage} из ${transactionsTotalPages}`;
}

// Изменить страницу транзакций
window.changeTransactionsPage = function(direction) {
    const newPage = currentTransactionsPage + direction;
    if (newPage >= 1 && newPage <= transactionsTotalPages) {
        currentTransactionsPage = newPage;
        loadCashTransactions();
    }
}

// Отобразить таблицу транзакций
function renderTransactionsTable(transactions) {
    const tbody = document.getElementById('cashboxTransactions');
    
    if (!tbody) {
        console.error('Table element cashboxTransactions not found');
        return;
    }
    
    if (!transactions || transactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; opacity: 0.5;">Нет транзакций</td></tr>';
        return;
    }
    
    const categoryNames = {
        // Доходы
        'hall_rental': 'Аренда зала',
        'water': 'Вода',
        'adjustment_income': 'Корректировка',
        'other': 'Прочие',
        // Расходы
        'rent': 'Аренда помещения',
        'utilities': 'Коммунальные услуги',
        'salary': 'Зарплата',
        'equipment': 'Оборудование',
        'marketing': 'Маркетинг',
        'supplies': 'Расходные материалы',
        'advance': 'Аванс',
        'adjustment_expense': 'Корректировка',
        'other_expense': 'Прочие расходы'
    };
    
    tbody.innerHTML = transactions.map(t => {
        const date = new Date(t.date).toLocaleDateString('ru', { day: 'numeric', month: 'short', year: 'numeric' });
        const typeText = t.type === 'income' ? 'Доход' : 'Расход';
        const typeColor = t.type === 'income' ? '#28a745' : '#dc3545';
        
        return `
            <tr>
                <td>${date}</td>
                <td><span style="color: ${typeColor}; font-weight: 600;">${typeText}</span></td>
                <td>${categoryNames[t.category] || t.category}</td>
                <td>${t.description}</td>
                <td>${t.createdBy?.name || 'Неизвестен'}</td>
                <td style="text-align: right; font-weight: 600; color: ${typeColor};">
                    ${t.type === 'income' ? '+' : '-'}${formatAmount(t.amount)}
                </td>
                <td style="text-align: center;">
                    <button class="table-btn" onclick="deleteTransaction('${t._id}')" style="background: #dc3545; padding: 6px 12px;">
                        Удалить
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Фильтр транзакций
window.filterTransactions = function(type) {
    currentTransactionFilter = type;
    currentTransactionsPage = 1; // Сбрасываем на первую страницу при изменении фильтра
    
    // Обновляем активную кнопку
    document.getElementById('transFilterAll')?.classList.toggle('active', type === 'all');
    document.getElementById('transFilterIncome')?.classList.toggle('active', type === 'income');
    document.getElementById('transFilterExpense')?.classList.toggle('active', type === 'expense');
    
    loadCashTransactions();
}

// Загрузить статистику транзакций
async function loadTransactionStatistics() {
    try {
        const token = getAuthToken();
        if (!token) {
            console.warn('No auth token for transaction statistics');
            return;
        }
        
        let url = `${API_URL}/cash-transactions/statistics?`;
        const params = [];
        
        // Если период custom - используем сохраненные даты
        if (currentCashboxStartDate && currentCashboxEndDate) {
            params.push(`startDate=${currentCashboxStartDate}&endDate=${currentCashboxEndDate}`);
        } 
        // Если период month/week/year - рассчитываем даты
        else if (currentCashboxPeriod) {
            const now = new Date();
            let start, end;
            
            switch(currentCashboxPeriod) {
                case 'month':
                    start = new Date(now.getFullYear(), now.getMonth(), 1);
                    end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                    break;
                case 'week':
                    start = new Date(now);
                    start.setDate(start.getDate() - 7);
                    end = new Date();
                    break;
                case 'year':
                    start = new Date(now.getFullYear(), 0, 1);
                    end = new Date(now.getFullYear(), 11, 31);
                    break;
            }
            
            if (start && end) {
                // ✅ Используем локальное форматирование без конверсии в UTC
                const formatDate = (date) => {
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    return `${year}-${month}-${day}`;
                };
                
                params.push(`startDate=${formatDate(start)}&endDate=${formatDate(end)}`);
            }
        }
        
        // Кэширование отключено - данные всегда актуальные
        
        url += params.join('&');
        
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success && data.statistics) {
            const stats = data.statistics;
            console.log('📊 Transaction statistics received:', stats);
            
            // Устанавливаем начальные значения если они еще не установлены
            const revenueEl = document.getElementById('cashboxRevenue');
            if (revenueEl && !revenueEl.textContent || revenueEl.textContent === '0₸') {
                const baseRevenue = parseFloat(revenueEl.getAttribute('data-base-revenue') || 0);
                revenueEl.textContent = formatAmount(baseRevenue);
                console.log('💰 Initial revenue set:', formatAmount(baseRevenue));
            }
            
            // Обновляем РАСХОДЫ (из CashTransaction)
            const expenseEl = document.getElementById('cashboxExpense');
            if (expenseEl) {
                expenseEl.textContent = formatAmount(stats.totalExpense || 0);
                console.log('💰 Updated EXPENSES:', formatAmount(stats.totalExpense || 0));
            }
            
            // Пересчитываем ДОХОД = платежи студентов + доходные транзакции
            if (revenueEl) {
                // Берём базовый доход (только платежи) из сохранённого атрибута
                const paymentsRevenue = parseFloat(revenueEl.getAttribute('data-base-revenue') || 0);
                const incomeTransactions = stats.totalIncome || 0;
                const totalRevenue = paymentsRevenue + incomeTransactions;
                
                console.log('💰 Revenue calculation:', {
                    paymentsRevenue,
                    incomeTransactions,
                    totalRevenue
                });
                
                // Обновляем ДОХОД с учётом доходных транзакций
                revenueEl.textContent = formatAmount(totalRevenue);
                console.log('💰 Updated REVENUE:', formatAmount(totalRevenue));
            }
            
            // Пересчитываем ЧИСТУЮ ПРИБЫЛЬ = (платежи + доходы) - расходы
            const expense = stats.totalExpense || 0;
            const netProfit = totalRevenue - expense;
            
            const profitEl = document.getElementById('cashboxProfit');
            if (profitEl) {
                profitEl.textContent = formatAmount(netProfit);
                console.log('💰 Updated PROFIT:', formatAmount(netProfit));
            }
            
            // Общее количество транзакций = платежи + доходы + расходы
            const paymentsCount = revenueEl ? parseInt(revenueEl.getAttribute('data-count') || 0) : 0;
            const totalTransactions = paymentsCount + (stats.incomeCount || 0) + (stats.expenseCount || 0);
            
            console.log('📊 Transaction count calculation:', {
                paymentsCount,
                incomeCount: stats.incomeCount || 0,
                expenseCount: stats.expenseCount || 0,
                totalTransactions
            });
            
            const countEl = document.getElementById('cashboxCount');
            if (countEl) countEl.textContent = totalTransactions;
        }
    } catch (error) {
        console.error('❌ Load transaction statistics error:', error);
        console.log('🔧 Attempting to load transaction statistics again...');
        
        // Попробуем еще раз через небольшую задержку
        setTimeout(async () => {
            try {
                console.log('🔄 Retrying loadTransactionStatistics...');
                await loadTransactionStatistics();
            } catch (retryError) {
                console.error('❌ Retry failed:', retryError);
                // Только в крайнем случае устанавливаем нули
                const expenseEl = document.getElementById('cashboxExpense');
                if (expenseEl) expenseEl.textContent = '0₸';
                
                const profitEl = document.getElementById('cashboxProfit');
                if (profitEl) profitEl.textContent = '0₸';
            }
        }, 1000);
    }
}

// Удалить транзакцию
window.deleteTransaction = async function(id) {
    if (!confirm('Удалить эту транзакцию?')) return;
    
    try {
        const token = getAuthToken();
        
        const response = await fetch(`${API_URL}/cash-transactions/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (data.success) {
            toast.success('Транзакция удалена');
            
            // Сбрасываем на первую страницу и перезагружаем данные
            currentTransactionsPage = 1;
            loadCashTransactions();
            loadTransactionStatistics();
            
            // Перезагружаем кассу для обновления статистики
            renderCashbox(currentCashboxPeriod, currentCashboxStartDate, currentCashboxEndDate);
        } else {
            toast.error(data.error || 'Ошибка удаления');
        }
    } catch (error) {
        console.error('Delete transaction error:', error);
        toast.error('Ошибка удаления транзакции');
    }
}

// Удалить платеж
window.deletePayment = async function(id) {
    if (!confirm('Удалить этот платеж? Платеж также будет удален из профиля ученика.')) return;
    
    try {
        const token = getAuthToken();
        
        const response = await fetch(`${API_URL}/payments/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (data.success) {
            toast.success('Платеж удален');
            
            // Сбрасываем на первую страницу и перезагружаем данные
            currentPaymentsPage = 1;
            loadPayments();
            
            // Перезагружаем кассу для обновления статистики
            renderCashbox(currentCashboxPeriod, currentCashboxStartDate, currentCashboxEndDate);
        } else {
            toast.error(data.error || 'Ошибка удаления');
        }
    } catch (error) {
        console.error('Delete payment error:', error);
        toast.error('Ошибка удаления платежа');
    }
}

// Хранилище обработчиков для правильного удаления
let incomeFormHandler = null;
let expenseFormHandler = null;

// Инициализация обработчиков транзакций
function initTransactionHandlers() {
    // Кнопка добавления дохода
    const addIncomeBtn = document.getElementById('addIncomeBtn');
    if (addIncomeBtn) {
        addIncomeBtn.removeEventListener('click', window.openIncomeModal);
        addIncomeBtn.addEventListener('click', window.openIncomeModal);
    }
    
    // Кнопка добавления расхода
    const addExpenseBtn = document.getElementById('addExpenseBtn');
    if (addExpenseBtn) {
        addExpenseBtn.removeEventListener('click', window.openExpenseModal);
        addExpenseBtn.addEventListener('click', window.openExpenseModal);
    }
    
    // Форма дохода - удаляем старый обработчик перед добавлением нового
    const incomeForm = document.getElementById('incomeForm');
    if (incomeForm) {
        if (incomeFormHandler) {
            incomeForm.removeEventListener('submit', incomeFormHandler);
        }
        
        incomeFormHandler = async (e) => {
            e.preventDefault();
            
            const formData = {
                type: 'income',
                amount: parseFloat(document.getElementById('incomeAmount').value),
                category: document.getElementById('incomeCategory').value,
                description: document.getElementById('incomeDescription').value,
                date: document.getElementById('incomeDate').value,
                notes: document.getElementById('incomeNotes').value
            };
            
            await submitTransaction(formData);
        };
        
        incomeForm.addEventListener('submit', incomeFormHandler);
    }
    
    // Форма расхода - удаляем старый обработчик перед добавлением нового
    const expenseForm = document.getElementById('expenseForm');
    if (expenseForm) {
        if (expenseFormHandler) {
            expenseForm.removeEventListener('submit', expenseFormHandler);
        }
        
        expenseFormHandler = async (e) => {
            e.preventDefault();
            
            const formData = {
                type: 'expense',
                amount: parseFloat(document.getElementById('expenseAmount').value),
                category: document.getElementById('expenseCategory').value,
                description: document.getElementById('expenseDescription').value,
                date: document.getElementById('expenseDate').value,
                notes: document.getElementById('expenseNotes').value
            };
            
            await submitTransaction(formData);
        };
        
        expenseForm.addEventListener('submit', expenseFormHandler);
    }
}

// Флаг для защиты от двойной отправки
let isSubmittingTransaction = false;

// Отправить транзакцию на сервер
async function submitTransaction(formData) {
    // Защита от двойной отправки
    if (isSubmittingTransaction) {
        console.warn('⚠️ Transaction submission already in progress, ignoring duplicate request');
        return;
    }
    
    isSubmittingTransaction = true;
    
    try {
        const token = getAuthToken();
        
        // Блокируем кнопки отправки
        const submitButtons = document.querySelectorAll('#incomeForm button[type="submit"], #expenseForm button[type="submit"]');
        submitButtons.forEach(btn => {
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Отправка...';
            }
        });
        
        const response = await fetch(`${API_URL}/cash-transactions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            toast.success(data.message);
            closeCashTransactionModal();
            
            // Сбрасываем на первую страницу и перезагружаем данные
            currentTransactionsPage = 1;
            loadCashTransactions();
            loadTransactionStatistics();
            
            // Перезагружаем кассу для обновления статистики
            renderCashbox(currentCashboxPeriod, currentCashboxStartDate, currentCashboxEndDate);
        } else {
            // Специальная обработка для дубликатов (409 статус)
            if (response.status === 409) {
                toast.warning(data.error || 'Похожая транзакция уже была создана недавно');
                // Перезагружаем список транзакций, чтобы показать существующую
                currentTransactionsPage = 1;
                loadCashTransactions();
            } else {
                toast.error(data.error || 'Ошибка при добавлении транзакции');
            }
        }
    } catch (error) {
        console.error('Submit transaction error:', error);
        toast.error('Ошибка при отправке данных');
    } finally {
        // Разблокируем кнопки отправки
        const submitButtons = document.querySelectorAll('#incomeForm button[type="submit"], #expenseForm button[type="submit"]');
        submitButtons.forEach(btn => {
            if (btn) {
                btn.disabled = false;
                const originalText = btn.getAttribute('data-original-text') || 'Сохранить';
                btn.textContent = originalText;
            }
        });
        
        isSubmittingTransaction = false;
    }
}

// Старая функция удалена - все в renderCashbox!

// Показать/скрыть индикатор загрузки кассы
function showCashboxLoading(show) {
    const loadingEl = document.getElementById('cashboxLoading');
    if (loadingEl) {
        loadingEl.style.display = show ? 'flex' : 'none';
    }
    
    // Блокируем кнопки во время загрузки
    const buttons = document.querySelectorAll('#cashboxAddIncome, #cashboxAddExpense');
    buttons.forEach(btn => {
        if (btn) {
            btn.disabled = show;
            btn.style.opacity = show ? '0.6' : '1';
        }
    });
}

// Очистить кэш кассы для получения актуальных данных
async function clearCashboxCache() {
    try {
        const token = getAuthToken();
        if (!token) {
            console.warn('No auth token for cache clearing');
            return;
        }
        
        // Добавляем timestamp к URL для обхода кэша
        const timestamp = Date.now();
        console.log('🔄 Adding cache-busting timestamp:', timestamp);
        
        // Обновляем глобальные переменные для использования в запросах
        window.cashboxCacheBuster = timestamp;
        
    } catch (error) {
        console.error('Cache clearing error:', error);
    }
}
