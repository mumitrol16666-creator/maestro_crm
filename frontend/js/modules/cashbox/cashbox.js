// =====================================================
// CASHBOX MODULE - Касса
// =====================================================

let currentCashboxPeriod = 'month';
let currentCashboxStartDate = null;
let currentCashboxEndDate = null;

// Получить текст типа платежа с детализацией
function getPaymentTypeText(type) {
    const types = {
        'trial_advance': 'Аванс (пробное)',
        'trial_full': 'Пробное занятие',
        'membership_advance': 'Аванс (абонемент)',
        'membership_balance': 'Доплата (абонемент)',
        'membership_full': 'Абонемент (полный)',
        'single_class': 'Разовое занятие',
        'individual_class': 'Индивидуальное занятие'
    };
    return types[type] || type;
}

// Отобразить кассу
async function renderCashbox(period = 'month', startDate = null, endDate = null) {
    currentCashboxPeriod = period;
    currentCashboxStartDate = startDate;
    currentCashboxEndDate = endDate;
    
    try {
        const token = getAuthToken();
        
        // Формируем URL с параметрами
        let url = `${API_URL}/cashbox/stats?period=${period}`;
        if (startDate && endDate) {
            url += `&startDate=${startDate}&endDate=${endDate}`;
        }
        
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (data.success) {
            renderCashboxStats(data);
        } else {
            toast.error('Ошибка загрузки данных кассы');
        }
    } catch (error) {
        console.error('Cashbox render error:', error);
        toast.error('Ошибка подключения к серверу');
    }
}

// Отрисовать статистику кассы
function renderCashboxStats(data) {
    const { summary, byType, byManager, byDay, recentPayments, period } = data;
    
    // Форматируем период для заголовка
    const periodText = getPeriodText(period.type, period.start, period.end);
    document.getElementById('cashboxPeriodTitle').textContent = periodText;
    
    // ИТОГО ЗА ПЕРИОД (только оборот от платежей)
    // Остальные показатели (доходы, расходы, прибыль) будут из loadTransactionStatistics
    const totalElement = document.getElementById('cashboxTotal');
    if (totalElement) {
        totalElement.textContent = formatAmount(summary.total);
    }
    
    // РАЗБИВКА ПО ТИПАМ
    const byTypeTable = document.getElementById('cashboxByTypeTable');
    if (byType && byType.length > 0) {
        byTypeTable.innerHTML = byType.map(item => `
            <tr>
                <td>${getPaymentTypeText(item._id)}</td>
                <td style="text-align: center;">${item.count}</td>
                <td style="text-align: right; font-weight: 600; color: var(--pink);">${formatAmount(item.total)}</td>
            </tr>
        `).join('');
    } else {
        byTypeTable.innerHTML = '<tr><td colspan="3" style="text-align: center; opacity: 0.5;">Нет данных</td></tr>';
    }
    
    // РАЗБИВКА ПО МЕНЕДЖЕРАМ
    const byManagerTable = document.getElementById('cashboxByManagerTable');
    if (byManager && byManager.length > 0) {
        byManagerTable.innerHTML = byManager.map(item => `
            <tr>
                <td>${item.managerName}</td>
                <td style="text-align: center;">${item.count}</td>
                <td style="text-align: right; font-weight: 600; color: var(--pink);">${formatAmount(item.total)}</td>
            </tr>
        `).join('');
    } else {
        byManagerTable.innerHTML = '<tr><td colspan="3" style="text-align: center; opacity: 0.5;">Нет данных</td></tr>';
    }
    
    // РАЗБИВКА ПО ДНЯМ
    const byDayTable = document.getElementById('cashboxByDayTable');
    if (byDay && byDay.length > 0) {
        byDayTable.innerHTML = byDay.slice(-10).reverse().map(item => {
            const date = new Date(item._id).toLocaleDateString('ru', { day: 'numeric', month: 'short', weekday: 'short' });
            return `
                <tr>
                    <td>${date}</td>
                    <td style="text-align: center;">${item.count}</td>
                    <td style="text-align: right; font-weight: 600; color: var(--pink);">${formatAmount(item.total)}</td>
                </tr>
            `;
        }).join('');
    } else {
        byDayTable.innerHTML = '<tr><td colspan="3" style="text-align: center; opacity: 0.5;">Нет данных</td></tr>';
    }
    
    // ПОСЛЕДНИЕ ПЛАТЕЖИ
    const recentPaymentsTable = document.getElementById('cashboxRecentPayments');
    if (recentPayments && recentPayments.length > 0) {
        recentPaymentsTable.innerHTML = recentPayments.map(payment => {
            const date = new Date(payment.paymentDate).toLocaleDateString('ru', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
            
            // Используем сохраненные имена (даже если студент/менеджер удален)
            const studentName = payment.studentName || 'Студент удален';
            const managerName = payment.managerName || 'Менеджер удален';
            
            return `
                <tr>
                    <td>${date}</td>
                    <td>${studentName}</td>
                    <td>${getPaymentTypeText(payment.type)}</td>
                    <td>${managerName}</td>
                    <td style="text-align: right; font-weight: 600; color: var(--pink);">${formatAmount(payment.amount)}</td>
                </tr>
            `;
        }).join('');
    } else {
        recentPaymentsTable.innerHTML = '<tr><td colspan="5" style="text-align: center; opacity: 0.5;">Нет платежей</td></tr>';
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
    // Обновить активную кнопку
    document.querySelectorAll('.cashbox-period-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-period="${period}"]`)?.classList.add('active');
    
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
    
    renderCashbox('custom', startDate, endDate);
}

// Загрузить список менеджеров
async function loadManagers() {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/users/sales-managers`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (data.success && data.managers) {
            const select = document.getElementById('salaryManagerSelect');
            select.innerHTML = '<option value="">Выберите менеджера</option>' +
                data.managers.map(m => 
                    `<option value="${m._id}">${m.name} ${m.lastName || ''}</option>`
                ).join('');
        }
    } catch (error) {
        console.error('Load managers error:', error);
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

// Загрузить и отобразить транзакции
async function loadCashTransactions() {
    try {
        const token = getAuthToken();
        if (!token) {
            console.warn('No auth token for transactions');
            return;
        }
        
        let url = `${API_URL}/cash-transactions?`;
        const params = [];
        
        if (currentCashboxStartDate && currentCashboxEndDate) {
            params.push(`startDate=${currentCashboxStartDate}&endDate=${currentCashboxEndDate}`);
        }
        
        if (currentTransactionFilter !== 'all') {
            params.push(`type=${currentTransactionFilter}`);
        }
        
        url += params.join('&');
        
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            renderTransactionsTable(data.transactions);
        } else {
            console.error('Failed to load transactions:', data.error);
            renderTransactionsTable([]);
        }
    } catch (error) {
        console.error('Load transactions error:', error);
        // Показываем пустую таблицу в случае ошибки
        const tbody = document.getElementById('cashboxTransactions');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; opacity: 0.5;">Нет транзакций</td></tr>';
        }
    }
}

// Отобразить таблицу транзакций
function renderTransactionsTable(transactions) {
    const tbody = document.getElementById('cashboxTransactions');
    
    if (!transactions || transactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; opacity: 0.5;">Нет транзакций</td></tr>';
        return;
    }
    
    const categoryNames = {
        // Доходы
        'membership': 'Членский взнос',
        'class_payment': 'Оплата занятия',
        'other_income': 'Прочие доходы',
        // Расходы
        'rent': 'Аренда помещения',
        'utilities': 'Коммунальные услуги',
        'salary': 'Зарплата',
        'equipment': 'Оборудование',
        'marketing': 'Маркетинг',
        'supplies': 'Расходные материалы',
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
        
        if (currentCashboxStartDate && currentCashboxEndDate) {
            params.push(`startDate=${currentCashboxStartDate}&endDate=${currentCashboxEndDate}`);
        }
        
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
            
            // Обновляем карточки статистики с проверкой существования элементов
            const incomeEl = document.getElementById('cashboxIncome');
            if (incomeEl) incomeEl.textContent = formatAmount(stats.totalIncome || 0);
            
            const expenseEl = document.getElementById('cashboxExpense');
            if (expenseEl) expenseEl.textContent = formatAmount(stats.totalExpense || 0);
            
            const profitEl = document.getElementById('cashboxProfit');
            if (profitEl) profitEl.textContent = formatAmount(stats.netProfit || 0);
            
            // Общее количество транзакций
            const countEl = document.getElementById('cashboxCount');
            if (countEl) countEl.textContent = (stats.incomeCount || 0) + (stats.expenseCount || 0);
            
            // Загружаем доход за месяц из дашборда
            await loadMonthlyRevenue();
        }
    } catch (error) {
        console.error('Load transaction statistics error:', error);
        // Устанавливаем нули в случае ошибки
        const incomeEl = document.getElementById('cashboxIncome');
        if (incomeEl) incomeEl.textContent = '0₸';
        
        const expenseEl = document.getElementById('cashboxExpense');
        if (expenseEl) expenseEl.textContent = '0₸';
        
        const profitEl = document.getElementById('cashboxProfit');
        if (profitEl) profitEl.textContent = '0₸';
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
            // Перезагружаем данные
            loadCashTransactions();
            loadTransactionStatistics();
        } else {
            toast.error(data.error || 'Ошибка удаления');
        }
    } catch (error) {
        console.error('Delete transaction error:', error);
        toast.error('Ошибка удаления транзакции');
    }
}

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
    
    // Форма дохода
    const incomeForm = document.getElementById('incomeForm');
    if (incomeForm) {
        incomeForm.addEventListener('submit', async (e) => {
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
        });
    }
    
    // Форма расхода
    const expenseForm = document.getElementById('expenseForm');
    if (expenseForm) {
        expenseForm.addEventListener('submit', async (e) => {
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
        });
    }
}

// Отправить транзакцию на сервер
async function submitTransaction(formData) {
    try {
        const token = getAuthToken();
        
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
            
            // Перезагружаем данные
            loadCashTransactions();
            loadTransactionStatistics();
        } else {
            toast.error(data.error || 'Ошибка при добавлении транзакции');
        }
    } catch (error) {
        console.error('Submit transaction error:', error);
        toast.error('Ошибка при отправке данных');
    }
}

// Переопределяем renderCashbox для загрузки транзакций
const originalRenderCashbox = renderCashbox;
renderCashbox = async function(period = 'month', startDate = null, endDate = null) {
    try {
        await originalRenderCashbox(period, startDate, endDate);
        
        // Загружаем транзакции (безопасно)
        try {
            await loadCashTransactions();
        } catch (err) {
            console.error('Failed to load transactions:', err);
        }
        
        // Загружаем статистику транзакций (безопасно)
        try {
            await loadTransactionStatistics();
        } catch (err) {
            console.error('Failed to load transaction statistics:', err);
        }
        
        // Инициализируем обработчики
        initTransactionHandlers();
        
        // Устанавливаем активный фильтр
        const filterAll = document.getElementById('transFilterAll');
        if (filterAll) {
            filterAll.classList.add('active');
        }
    } catch (error) {
        console.error('RenderCashbox error:', error);
        // Оригинальная ошибка уже обработана в originalRenderCashbox
    }
}

// Загрузить доход за месяц из API дашборда
async function loadMonthlyRevenue() {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/admin/stats`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            const monthlyRevenueEl = document.getElementById('cashboxMonthlyRevenue');
            if (monthlyRevenueEl && data.stats) {
                monthlyRevenueEl.textContent = formatAmount(data.stats.monthlyRevenue || 0);
            }
        }
    } catch (error) {
        console.error('Load monthly revenue error:', error);
        const monthlyRevenueEl = document.getElementById('cashboxMonthlyRevenue');
        if (monthlyRevenueEl) monthlyRevenueEl.textContent = '0₸';
    }
}
