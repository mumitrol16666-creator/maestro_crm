// ==================== PAYMENTS MODULE ====================

let currentPaymentFilter = 'all';
let currentPaymentPage = 1;
let currentPaymentSearch = '';

// Инициализация секции платежей
function initPayments() {
    renderPayments();
    initPaymentHandlers();
}

// Отрисовка списка платежей
async function renderPayments(filter = 'all', page = 1, search = '') {
    try {
        const token = getAuthToken();
        const params = new URLSearchParams({ page, limit: 20 });
        
        if (filter && filter !== 'all') {
            params.append('type', filter);
        }
        
        if (search) {
            params.append('search', search);
        }
        
        const response = await fetch(`${API_URL}/payments?${params}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            toast.error('Не удалось загрузить платежи');
            return;
        }
        
        const data = await response.json();
        const paymentsTable = document.getElementById('paymentsTable');
        
        if (!paymentsTable) return;
        
        if (!data.payments || data.payments.length === 0) {
            paymentsTable.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; opacity: 0.5;">Нет платежей</td></tr>';
            document.getElementById('paymentsPagination').innerHTML = '';
            return;
        }
        
        paymentsTable.innerHTML = data.payments.map(payment => `
            <tr>
                <td>${formatDate(payment.paymentDate)}</td>
                <td>${payment.student?.name || ''} ${payment.student?.lastName || ''}</td>
                <td>${payment.manager?.name || ''} ${payment.manager?.lastName || ''}</td>
                <td>${formatAmount(payment.amount)}</td>
                <td>${getPaymentTypeText(payment.type)}</td>
                <td><span class="payment-status-badge status-${payment.status}">${getPaymentStatusText(payment.status)}</span></td>
                <td>
                    <button class="btn-icon" onclick="viewPaymentDetails('${payment._id}')" title="Детали">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                </td>
            </tr>
        `).join('');
        
        // Пагинация
        renderPaymentsPagination(data.pagination);
        
    } catch (error) {
        toast.error('Ошибка при загрузке платежей');
    }
}

// Пагинация
function renderPaymentsPagination(pagination) {
    const container = document.getElementById('paymentsPagination');
    if (!container || !pagination) return;
    
    if (pagination.pages <= 1) {
        container.innerHTML = '';
        return;
    }
    
    let html = '<div class="pagination">';
    
    for (let i = 1; i <= pagination.pages; i++) {
        html += `<button class="pagination-btn ${i === pagination.page ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }
    
    html += '</div>';
    container.innerHTML = html;
    
    // Event listeners
    container.querySelectorAll('.pagination-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const page = parseInt(e.target.dataset.page);
            currentPaymentPage = page;
            renderPayments(currentPaymentFilter, page, currentPaymentSearch);
        });
    });
}

// Инициализация обработчиков
function initPaymentHandlers() {
    // Фильтры по типу
    const filterButtons = document.querySelectorAll('#section-payments .filter-btn');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            currentPaymentFilter = btn.dataset.filter;
            currentPaymentPage = 1;
            renderPayments(currentPaymentFilter, 1, currentPaymentSearch);
        });
    });
    
    // Поиск (будет добавлен позже)
}

// Просмотр деталей платежа
async function viewPaymentDetails(paymentId) {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/payments/${paymentId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        
        if (!data.success) {
            toast.error('Не удалось загрузить детали платежа');
            return;
        }
        
        const payment = data.payment;
        
        // Формируем детальное сообщение
        let details = `💰 ПЛАТЕЖ #${payment._id.slice(-6)}\n\n`;
        details += `Студент: ${payment.student?.name || ''} ${payment.student?.lastName || ''}\n`;
        details += `Телефон: ${payment.student?.phone || ''}\n\n`;
        details += `Сумма: ${formatAmount(payment.amount)}\n`;
        details += `Тип: ${getPaymentTypeText(payment.type)}\n`;
        details += `Дата: ${formatDate(payment.paymentDate)}\n`;
        details += `Статус: ${getPaymentStatusText(payment.status)}\n\n`;
        details += `Менеджер: ${payment.manager?.name || ''} ${payment.manager?.lastName || ''}\n`;
        
        if (payment.teacher) {
            details += `Преподаватель: ${payment.teacher.name || ''} ${payment.teacher.lastName || ''}\n`;
        }
        
        if (payment.relatedPayment) {
            details += `\nСвязанный платеж: ${formatAmount(payment.relatedPayment.amount)} (${formatDate(payment.relatedPayment.paymentDate)})\n`;
        }
        
        if (payment.notes) {
            details += `\nПримечание: ${payment.notes}`;
        }
        
        toast.info(details, 6000);  // 6 секунд
        
    } catch (error) {
        toast.error('Ошибка при загрузке деталей');
    }
}

// Утилиты
function formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatAmount(amount) {
    return new Intl.NumberFormat('ru-RU').format(amount) + ' ₸';
}

function getPaymentTypeText(type) {
    const types = {
        'trial_advance': 'Аванс (пробное)',
        'trial_full': 'Пробное занятие',
        'membership_advance': 'Аванс (абонемент)',
        'membership_balance': 'Доплата',
        'membership_full': 'Абонемент',
        'single_class': 'Разовое',
        'individual_class': 'Индивидуальное'
    };
    return types[type] || type;
}

function getPaymentStatusText(status) {
    const statuses = {
        'pending': 'Ожидает доплаты',
        'completed': 'Оплачено',
        'converted_to_membership': 'В абонемент',
        'refunded': 'Возврат',
        'cancelled': 'Отменено'
    };
    return statuses[status] || status;
}

// Экспорт
if (typeof window !== 'undefined') {
    window.initPayments = initPayments;
    window.renderPayments = renderPayments;
    window.viewPaymentDetails = viewPaymentDetails;
    window.initPaymentHandlers = initPaymentHandlers;
}

