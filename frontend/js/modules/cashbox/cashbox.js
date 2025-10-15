// =====================================================
// CASHBOX MODULE - Касса
// =====================================================

let currentCashboxPeriod = 'month';
let currentCashboxStartDate = null;
let currentCashboxEndDate = null;

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
    
    // ИТОГО ЗА ПЕРИОД
    document.getElementById('cashboxTotal').textContent = formatAmount(summary.total);
    document.getElementById('cashboxCount').textContent = summary.count;
    document.getElementById('cashboxAverage').textContent = formatAmount(summary.average);
    
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
            const studentName = payment.student ? `${payment.student.name} ${payment.student.lastName || ''}` : 'Неизвестно';
            const managerName = payment.manager ? `${payment.manager.name} ${payment.manager.lastName || ''}` : '-';
            
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
    
    if (!managerId) {
        toast.warning('Выберите менеджера');
        return;
    }
    
    try {
        const token = getAuthToken();
        let url = `${API_URL}/cashbox/salary/${managerId}`;
        if (month) {
            url += `?month=${month}`;
        }
        
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (data.success) {
            renderManagerSalary(data);
        } else {
            toast.error(data.error || 'Ошибка получения зарплаты');
        }
    } catch (error) {
        console.error('Show salary error:', error);
        toast.error('Ошибка подключения к серверу');
    }
}

// Отрисовать зарплату менеджера
function renderManagerSalary(data) {
    const { manager, summary, breakdown, config } = data;
    
    const container = document.getElementById('salaryBreakdown');
    
    // Определить тир на основе количества абонементов
    const tier = config.membershipTiers.find(t => 
        summary.membershipsSold >= t.min && 
        (t.max === null || summary.membershipsSold <= t.max)
    );
    
    container.innerHTML = `
        <div style="background: rgba(235, 77, 119, 0.05); border: 1px solid rgba(235, 77, 119, 0.2); border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <h4 style="color: var(--pink); margin: 0 0 15px 0; font-size: 1.1em;">${manager.name}</h4>
            
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
                    <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <span>Абонементы (${breakdown.memberships.count} шт, ${summary.commissionRate}%)</span>
                        <span style="font-weight: 600;">${formatAmount(breakdown.memberships.commission)}</span>
                    </div>
                ` : ''}
                
                ${breakdown.trials.count > 0 ? `
                    <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <span>Пробные (${breakdown.trials.count} шт, ${config.trialRate}%)</span>
                        <span style="font-weight: 600;">${formatAmount(breakdown.trials.commission)}</span>
                    </div>
                ` : ''}
                
                ${breakdown.singleClasses.count > 0 ? `
                    <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <span>Разовые (${breakdown.singleClasses.count} шт, ${config.singleClassRate}%)</span>
                        <span style="font-weight: 600;">${formatAmount(breakdown.singleClasses.commission)}</span>
                    </div>
                ` : ''}
                
                ${breakdown.individualClasses.count > 0 ? `
                    <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <span>Индивидуальные (${breakdown.individualClasses.count} шт, ${config.individualClassRate}%)</span>
                        <span style="font-weight: 600;">${formatAmount(breakdown.individualClasses.commission)}</span>
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

