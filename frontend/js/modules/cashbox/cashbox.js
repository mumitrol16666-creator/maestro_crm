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

