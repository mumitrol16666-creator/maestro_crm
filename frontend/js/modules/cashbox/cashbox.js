// =====================================================
// CASHBOX MODULE — Касса (сводка + ручные операции)
// =====================================================

const CASHBOX_CATEGORIES = {
    income: ['Прочий доход', 'Возврат', 'Аренда оборудования', 'Мерч', 'Другое'],
    expense: ['Закупки', 'Аренда', 'Коммунальные', 'Реклама', 'Зарплата', 'Прочее']
};

const CASHBOX_ACCOUNT_LABELS = {
    kaspi: 'Каспи',
    cash: 'Наличные',
    kaspi_pay: 'КаспиПей',
    freedom: 'Фридом',
    halyk: 'Халык Банк',
    unspecified: 'Счёт не указан'
};

const CASHBOX_CATEGORY_LABELS = {
    payment: 'Оплата обучения',
    trial_payment: 'Диагностический урок',
    correction: 'Корректировка баланса',
    balance_adjustment: 'Корректировка баланса',
    refund: 'Возврат средств',
    shop_sale: 'Розничная продажа',
    shop_refund: 'Отмена розничной продажи',
    shop_purchase: 'Закупка товара',
    salary: 'Выплата зарплаты',
    salary_advance: 'Аванс преподавателю',
    salary_bonus: 'Премия преподавателю',
    deletion: 'Удаление платежа',
    transfer: 'Перенос баланса',
    account_transfer_out: 'Перевод между счетами',
    account_transfer_in: 'Перевод между счетами'
};

function cashboxFmtMoney(n) {
    const v = Math.round(Number(n) || 0);
    return v.toLocaleString('ru-RU').replace(/\u00a0/g, ' ') + ' ₸';
}

function cashboxFmtDate(d) {
    const dd = d instanceof Date ? d : new Date(d);
    if (isNaN(dd.getTime())) return '—';
    return dd.toLocaleDateString('ru-RU');
}

function cashboxFormatLocalISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function cashboxSetDefaultPeriod() {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const fromEl = document.getElementById('cashboxFrom');
    const toEl = document.getElementById('cashboxTo');
    if (fromEl) fromEl.value = cashboxFormatLocalISO(from);
    if (toEl) toEl.value = cashboxFormatLocalISO(to);
}

function cashboxGetFilters() {
    const from = document.getElementById('cashboxFrom')?.value;
    const to = document.getElementById('cashboxTo')?.value;
    const type = document.getElementById('cashboxTypeFilter')?.value;
    const paymentMethod = document.getElementById('cashboxAccountFilter')?.value;
    const search = document.getElementById('cashboxSearchFilter')?.value;
    return { from, to, type, paymentMethod, search };
}

function cashboxEsc(text) {
    return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cashboxPersonName(person, fallback = '') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function cashboxEffectiveAmount(tx) {
    if (tx?.category === 'payment' && tx.relatedPayment?.amount != null) {
        return tx.relatedPayment.amount;
    }
    return tx?.amount || 0;
}

function cashboxAccountLabel(value) {
    return CASHBOX_ACCOUNT_LABELS[String(value || '').trim()] || 'Счёт не указан';
}

function cashboxCategoryLabel(value) {
    const category = String(value || '').trim();
    if (!category) return 'Прочее';
    if (CASHBOX_CATEGORY_LABELS[category]) return CASHBOX_CATEGORY_LABELS[category];
    return /^[a-z0-9_-]+$/i.test(category) ? 'Прочее' : category;
}

function cashboxRenderAccounts(accounts, selectedAccount = '') {
    const accountsEl = document.getElementById('cashboxAccounts');
    const totalEl = document.getElementById('cashboxAccountsTotal');
    if (!accountsEl) return;
    if (!accounts?.length) {
        accountsEl.innerHTML = '<div style="opacity:0.55; padding:16px 0;">Счета пока не настроены</div>';
        if (totalEl) totalEl.textContent = '';
        return;
    }

    const currentTotal = accounts.reduce((sum, account) => sum + Number(account.currentBalance || 0), 0);
    if (totalEl) {
        totalEl.innerHTML = `Всего по учёту: <strong style="color:${currentTotal >= 0 ? '#58d895' : '#ef6b78'};">${cashboxFmtMoney(currentTotal)}</strong>`;
    }

    accountsEl.innerHTML = accounts.map(account => {
        const isSelected = selectedAccount === account.paymentMethod;
        const isUnspecified = account.paymentMethod === 'unspecified';
        const balance = Number(account.balance || 0);
        const currentBalance = Number(account.currentBalance || 0);
        return `
            <button type="button" onclick="cashboxSelectAccount('${cashboxEsc(account.paymentMethod)}')"
                    style="text-align:left; color:inherit; padding:14px; background:${isUnspecified ? 'rgba(251,191,36,0.08)' : 'rgba(255,255,255,0.04)'}; border:1px solid ${isSelected ? 'var(--gold)' : isUnspecified ? 'rgba(251,191,36,0.35)' : 'rgba(255,255,255,0.08)'}; border-radius:8px; cursor:pointer;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    <strong>${cashboxEsc(account.label || cashboxAccountLabel(account.paymentMethod))}</strong>
                    <small style="opacity:0.55;">${Number(account.operations || 0)} оп.</small>
                </div>
                <div style="margin-top:12px;">
                    <span style="display:block; opacity:0.55; font-size:0.72rem;">Остаток по учёту</span>
                    <strong style="display:block; margin-top:3px; color:${currentBalance >= 0 ? '#58d895' : '#ef6b78'}; font-size:1.15rem;">${cashboxFmtMoney(currentBalance)}</strong>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:12px; font-size:0.78rem;">
                    <span style="color:#58d895;">Приход<br><b>+${cashboxFmtMoney(account.income)}</b></span>
                    <span style="color:#ef6b78;">Расход<br><b>−${cashboxFmtMoney(account.expense)}</b></span>
                </div>
                <div style="margin-top:10px; padding-top:9px; border-top:1px solid rgba(255,255,255,0.08); font-size:0.82rem; opacity:0.8;">
                    За период: <b style="color:${balance >= 0 ? '#58d895' : '#ef6b78'};">${balance >= 0 ? '+' : '−'}${cashboxFmtMoney(Math.abs(balance))}</b>
                </div>
            </button>
        `;
    }).join('');
}

function cashboxSelectAccount(paymentMethod) {
    const filter = document.getElementById('cashboxAccountFilter');
    if (!filter) return;
    filter.value = filter.value === paymentMethod ? '' : paymentMethod;
    renderCashbox(true);
}

function cashboxDisplayNotes(tx) {
    const notes = String(tx?.notes || '').trim();
    if (!notes) return '';
    if (tx?.category === 'trial_payment' && notes === 'Невозвратная оплата диагностического урока') {
        return '';
    }
    return notes;
}

async function renderCashbox(forceReload = false) {
    const summaryEl = document.getElementById('cashboxSummary');
    const accountsEl = document.getElementById('cashboxAccounts');
    const tbody = document.getElementById('cashboxTransactionsBody');
    if (!summaryEl || !tbody) return;

    const filters = cashboxGetFilters();
    if (!filters.from || !filters.to) {
        cashboxSetDefaultPeriod();
    }

    const currentFilters = cashboxGetFilters();
    summaryEl.innerHTML = '<p style="opacity:0.5; grid-column:1/-1;">Загрузка сводки...</p>';
    if (accountsEl) accountsEl.innerHTML = '<div style="opacity:0.5; padding:16px 0;">Загрузка счетов...</div>';
    tbody.innerHTML = '<tr><td colspan="12" style="text-align:center; opacity:0.5; padding:30px;">Загрузка...</td></tr>';

    try {
        const summaryQs = new URLSearchParams();
        if (currentFilters.from) summaryQs.append('from', currentFilters.from);
        if (currentFilters.to) summaryQs.append('to', currentFilters.to);
        if (currentFilters.paymentMethod) summaryQs.append('paymentMethod', currentFilters.paymentMethod);

        const txQs = new URLSearchParams();
        if (currentFilters.from) txQs.append('from', currentFilters.from);
        if (currentFilters.to) txQs.append('to', currentFilters.to);
        if (currentFilters.type) txQs.append('type', currentFilters.type);
        if (currentFilters.paymentMethod) txQs.append('paymentMethod', currentFilters.paymentMethod);
        if (currentFilters.search) txQs.append('search', currentFilters.search);
        txQs.append('limit', '100');

        const headers = { 'Authorization': `Bearer ${getAuthToken()}` };

        const [summaryRes, txRes] = await Promise.all([
            fetch(`${API_URL}/cashbox/summary?${summaryQs}`, { headers }),
            fetch(`${API_URL}/cashbox/transactions?${txQs}`, { headers })
        ]);

        if (!summaryRes.ok || !txRes.ok) throw new Error('Не удалось загрузить кассу');

        const summaryData = await summaryRes.json();
        const txData = await txRes.json();
        const s = summaryData.summary || {};
        cashboxRenderAccounts(summaryData.accounts || [], currentFilters.paymentMethod);

        summaryEl.innerHTML = `
            <div style="padding:14px; background:rgba(255,255,255,0.04); border-radius:8px;">
                <div style="opacity:0.65; font-size:0.85rem;">Платежи фактические</div>
                <div style="font-size:1.25rem; font-weight:600; margin-top:4px;">${cashboxFmtMoney(s.paymentsTotal)}</div>
                <small style="opacity:0.5;">включая диагностику: ${cashboxFmtMoney(s.trialPaymentsTotal || 0)} (${s.trialPaymentsCount || 0})</small>
            </div>
            <div style="padding:14px; background:rgba(88,216,149,0.08); border-radius:8px;">
                <div style="opacity:0.65; font-size:0.85rem;">Продажи магазина</div>
                <div style="font-size:1.25rem; font-weight:600; margin-top:4px; color:#58d895;">${cashboxFmtMoney(s.shopSalesTotal)}</div>
                <small style="opacity:0.5;">${s.shopSalesCount || 0} продаж · возвраты ${cashboxFmtMoney(s.shopRefundsTotal)}</small>
            </div>
            <div style="padding:14px; background:rgba(116,183,242,0.08); border-radius:8px;">
                <div style="opacity:0.65; font-size:0.85rem;">Закупки магазина</div>
                <div style="font-size:1.25rem; font-weight:600; margin-top:4px; color:#74b7f2;">${cashboxFmtMoney(s.shopPurchasesTotal)}</div>
                <small style="opacity:0.5;">${s.shopPurchasesCount || 0} поступлений с расходом</small>
            </div>
            <div style="padding:14px; background:rgba(255,255,255,0.04); border-radius:8px;">
                <div style="opacity:0.65; font-size:0.85rem;">Ручной доход</div>
                <div style="font-size:1.25rem; font-weight:600; margin-top:4px; color:#28a745;">${cashboxFmtMoney(s.manualIncome)}</div>
                <small style="opacity:0.5;">${s.manualIncomeCount || 0} оп.</small>
            </div>
            <div style="padding:14px; background:rgba(255,255,255,0.04); border-radius:8px;">
                <div style="opacity:0.65; font-size:0.85rem;">Реальные расходы</div>
                <div style="font-size:1.25rem; font-weight:600; margin-top:4px; color:#dc3545;">${cashboxFmtMoney(s.realExpenses)}</div>
                <small style="opacity:0.5;">${s.realExpensesCount || 0} оп.</small>
            </div>
            <div style="padding:14px; background:rgba(255,255,255,0.04); border-radius:8px;">
                <div style="opacity:0.65; font-size:0.85rem;">Корректировки баланса</div>
                <div style="font-size:1.25rem; font-weight:600; margin-top:4px; color:${(s.correctionsTotal || 0) >= 0 ? '#28a745' : '#e9b95c'}">
                    ${(s.correctionsTotal || 0) >= 0 ? '+' : ''}${cashboxFmtMoney(s.correctionsTotal)}
                </div>
                <small style="opacity:0.5;">не входят в доходы: ${s.correctionsCount || 0} оп.</small>
            </div>
            <div style="padding:14px; background:rgba(235,77,119,0.1); border-radius:8px;">
                <div style="opacity:0.65; font-size:0.85rem;">Кассовый итог</div>
                <div style="font-size:1.25rem; font-weight:600; margin-top:4px; color:var(--pink);">${cashboxFmtMoney(s.cashTotal)}</div>
                <small style="opacity:0.5;">возвраты: ${cashboxFmtMoney(s.refundsTotal)}</small>
            </div>
            <div style="padding:14px; background:rgba(40,167,69,0.12); border-radius:8px;">
                <div style="opacity:0.65; font-size:0.85rem;">Расчётная прибыль</div>
                <div style="font-size:1.25rem; font-weight:600; margin-top:4px; color:#28a745;">${cashboxFmtMoney(s.profit)}</div>
                <small style="opacity:0.5;">выручка - расходы</small>
            </div>
        `;

        const transactions = txData.transactions || [];
        window.cashboxLoadedTransactions = transactions;
        cashboxRenderCharts(transactions);
        if (!transactions.length) {
            tbody.innerHTML = '<tr><td colspan="12" style="text-align:center; opacity:0.5; padding:30px;">Нет операций за период</td></tr>';
            return;
        }

        tbody.innerHTML = transactions.map(tx => {
            const author = tx.createdBy
                ? cashboxPersonName(tx.createdBy)
                : '—';
            
            let studentName = '—';
            let teacherName = '—';
            
            if (tx.relatedPayment) {
                if (tx.relatedPayment.student) {
                    studentName = cashboxPersonName(tx.relatedPayment.student);
                }
                if (tx.relatedPayment.teacher) {
                    teacherName = cashboxPersonName(tx.relatedPayment.teacher);
                }
            } else if (tx.relatedBooking) {
                studentName = cashboxPersonName(tx.relatedBooking, 'Клиент заявки');
            } else if (tx.relatedShopSale) {
                studentName = tx.relatedShopSale.customerName || 'Покупатель магазина';
            } else if (tx.category === 'salary') {
                const match = tx.description.match(/Зарплата преподавателя:\s*([^(\n]+)/);
                if (match && match[1]) {
                    teacherName = match[1].trim();
                }
            }

            const typeLabel = (() => {
                if (tx.category === 'payment') return '<span style="color:#28a745; font-weight:600;">Приход (оплата)</span>';
                if (tx.category === 'trial_payment') return '<span style="color:#28a745; font-weight:600;">Приход (диагностика)</span>';
                if (['correction', 'balance_adjustment'].includes(tx.category)) return '<span style="color:#e9b95c; font-weight:600;">Тех. корректировка</span>';
                if (tx.category === 'refund') return '<span style="color:#dc3545; font-weight:600;">Возврат</span>';
                if (tx.category === 'shop_sale') return '<span style="color:#58d895; font-weight:600;">Продажа магазина</span>';
                if (tx.category === 'shop_refund') return '<span style="color:#dc3545; font-weight:600;">Возврат магазина</span>';
                if (tx.category === 'shop_purchase') return '<span style="color:#74b7f2; font-weight:600;">Закупка магазина</span>';
                if (tx.category === 'salary') return '<span style="color:#a78bfa; font-weight:600;">Зарплата</span>';
                if (tx.category === 'salary_advance') return '<span style="color:#fbbf24; font-weight:600;">Аванс преподавателю</span>';
                if (tx.category === 'salary_bonus') return '<span style="color:#4ade80; font-weight:600;">Премия преподавателю</span>';
                if (tx.category === 'account_transfer_out') return '<span style="color:#68d7cd; font-weight:600;">Перевод со счёта</span>';
                if (tx.category === 'account_transfer_in') return '<span style="color:#68d7cd; font-weight:600;">Перевод на счёт</span>';
                if (tx.category === 'transfer') return '<span style="color:#74b7f2; font-weight:600;">Перенос остатка</span>';
                return tx.type === 'income'
                    ? '<span style="color:#28a745;">Приход</span>'
                    : '<span style="color:#dc3545;">Расход</span>';
            })();

            const categoryLabel = cashboxCategoryLabel(tx.category);

            const editor = ['correction', 'balance_adjustment'].includes(tx.category) ? author : '—';
            const createdAtDate = tx.createdAt ? new Date(tx.createdAt).toLocaleString('ru-RU') : '—';
            const sumSign = tx.type === 'income' ? '+' : '−';
            const sumColor = tx.type === 'income' ? '#28a745' : '#dc3545';
            const displayAmount = cashboxEffectiveAmount(tx);

            return `
                <tr onclick="cashboxViewTransactionDetails('${tx.id}')" style="cursor: pointer;" onmouseover="this.style.backgroundColor='rgba(255,255,255,0.03)'" onmouseout="this.style.backgroundColor='transparent'">
                    <td>${cashboxFmtDate(tx.date)}</td>
                    <td>${typeLabel}</td>
                    <td>${cashboxEsc(categoryLabel)}</td>
                    <td>${cashboxEsc(tx.description)}</td>
                    <td style="white-space:nowrap; font-weight:600; color:${sumColor};">${sumSign}${cashboxFmtMoney(displayAmount)}</td>
                    <td>${cashboxEsc(cashboxAccountLabel(tx.paymentMethod))}</td>
                    <td>${cashboxEsc(studentName)}</td>
                    <td>${cashboxEsc(teacherName)}</td>
                    <td>${cashboxEsc(author)}</td>
                    <td>${cashboxEsc(editor)}</td>
                    <td>${cashboxEsc(createdAtDate)}</td>
                    <td>${cashboxEsc(cashboxDisplayNotes(tx) || '—')}</td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Cashbox render error:', error);
        summaryEl.innerHTML = '<p style="color:#ef4444;">Не удалось загрузить сводку</p>';
        if (accountsEl) accountsEl.innerHTML = '<div style="color:#ef4444; padding:16px 0;">Не удалось загрузить счета</div>';
        tbody.innerHTML = '<tr><td colspan="12" style="text-align:center; color:#ef4444; padding:30px;">Не удалось загрузить кассу. Обновите страницу.</td></tr>';
    }
}

function openCashboxModal(type) {
    const modal = document.getElementById('cashboxModal');
    const title = document.getElementById('cashboxModalTitle');
    const typeInput = document.getElementById('cashboxTxType');
    const categoryInput = document.getElementById('cashboxCategory');
    const datalist = document.getElementById('cashboxCategoriesList');
    const dateInput = document.getElementById('cashboxDate');

    if (!modal || !typeInput || !categoryInput) return;

    typeInput.value = type;
    title.textContent = type === 'income' ? 'ПРИХОД' : 'РАСХОД';

    if (datalist) {
        datalist.innerHTML = (CASHBOX_CATEGORIES[type] || []).map(c => `<option value="${c}"></option>`).join('');
    }

    categoryInput.value = '';
    document.getElementById('cashboxAmount').value = '';
    document.getElementById('cashboxDescription').value = '';
    document.getElementById('cashboxNotes').value = '';
    document.getElementById('cashboxPaymentMethod').value = '';
    if (dateInput) dateInput.value = cashboxFormatLocalISO(new Date());

    modal.classList.add('show');
}

function closeCashboxModal() {
    const modal = document.getElementById('cashboxModal');
    if (modal) modal.classList.remove('show');
}

function cashboxViewTransactionDetails(txId) {
    const tx = (window.cashboxLoadedTransactions || []).find(t => t.id === txId || t._id === txId);
    if (!tx) return;

    const modal = document.getElementById('cashboxDetailsModal');
    if (!modal) return;

    const author = tx.createdBy
        ? cashboxPersonName(tx.createdBy)
        : '—';
    
    let studentName = '—';
    let teacherName = '—';
    
    if (tx.relatedPayment) {
        if (tx.relatedPayment.student) {
            studentName = cashboxPersonName(tx.relatedPayment.student);
        }
        if (tx.relatedPayment.teacher) {
            teacherName = cashboxPersonName(tx.relatedPayment.teacher);
        }
    } else if (tx.relatedBooking) {
        studentName = cashboxPersonName(tx.relatedBooking, 'Клиент заявки');
    } else if (tx.relatedShopSale) {
        studentName = tx.relatedShopSale.customerName || 'Покупатель магазина';
    } else if (tx.category === 'salary') {
        const match = tx.description.match(/Зарплата преподавателя:\s*([^(\n]+)/);
        if (match && match[1]) {
            teacherName = match[1].trim();
        }
    }

    const typeLabel = (() => {
        if (tx.category === 'payment') return '<span style="color:#28a745; font-weight:600;">Приход (оплата)</span>';
        if (tx.category === 'trial_payment') return '<span style="color:#28a745; font-weight:600;">Приход (диагностика)</span>';
        if (['correction', 'balance_adjustment'].includes(tx.category)) return '<span style="color:#e9b95c; font-weight:600;">Тех. корректировка</span>';
        if (tx.category === 'refund') return '<span style="color:#dc3545; font-weight:600;">Возврат</span>';
        if (tx.category === 'shop_sale') return '<span style="color:#58d895; font-weight:600;">Продажа магазина</span>';
        if (tx.category === 'shop_refund') return '<span style="color:#dc3545; font-weight:600;">Возврат магазина</span>';
        if (tx.category === 'shop_purchase') return '<span style="color:#74b7f2; font-weight:600;">Закупка магазина</span>';
        if (tx.category === 'salary') return '<span style="color:#a78bfa; font-weight:600;">Зарплата</span>';
        if (tx.category === 'salary_advance') return '<span style="color:#fbbf24; font-weight:600;">Аванс преподавателю</span>';
        if (tx.category === 'salary_bonus') return '<span style="color:#4ade80; font-weight:600;">Премия преподавателю</span>';
        if (tx.category === 'account_transfer_out') return '<span style="color:#68d7cd; font-weight:600;">Перевод со счёта</span>';
        if (tx.category === 'account_transfer_in') return '<span style="color:#68d7cd; font-weight:600;">Перевод на счёт</span>';
        if (tx.category === 'transfer') return '<span style="color:#74b7f2; font-weight:600;">Перенос остатка</span>';
        return tx.type === 'income'
            ? '<span style="color:#28a745; font-weight:600;">Приход</span>'
            : '<span style="color:#dc3545; font-weight:600;">Расход</span>';
    })();

    const categoryLabel = cashboxCategoryLabel(tx.category);

    const editor = ['correction', 'balance_adjustment'].includes(tx.category) ? author : '—';
    const createdAtDate = tx.createdAt ? new Date(tx.createdAt).toLocaleString('ru-RU') : '—';
    const sumSign = tx.type === 'income' ? '+' : '−';
    const sumColor = tx.type === 'income' ? '#28a745' : '#dc3545';
    const displayAmount = cashboxEffectiveAmount(tx);

    document.getElementById('cashboxDetailAmount').innerHTML = `<span style="color: ${sumColor};">${sumSign}${cashboxFmtMoney(displayAmount)}</span>`;
    document.getElementById('cashboxDetailDate').textContent = cashboxFmtDate(tx.date);
    document.getElementById('cashboxDetailAccount').textContent = cashboxAccountLabel(tx.paymentMethod);
    document.getElementById('cashboxDetailType').innerHTML = typeLabel;
    document.getElementById('cashboxDetailCategory').textContent = categoryLabel;
    document.getElementById('cashboxDetailDescription').textContent = tx.description || '—';
    
    const studentRow = document.getElementById('cashboxDetailStudentRow');
    if (studentRow) {
        if (studentName !== '—') {
            studentRow.style.display = 'flex';
            document.getElementById('cashboxDetailStudent').textContent = studentName;
        } else {
            studentRow.style.display = 'none';
        }
    }
    
    const teacherRow = document.getElementById('cashboxDetailTeacherRow');
    if (teacherRow) {
        if (teacherName !== '—') {
            teacherRow.style.display = 'flex';
            document.getElementById('cashboxDetailTeacher').textContent = teacherName;
        } else {
            teacherRow.style.display = 'none';
        }
    }

    document.getElementById('cashboxDetailAuthor').textContent = author;
    
    const editorRow = document.getElementById('cashboxDetailEditorRow');
    if (editorRow) {
        if (['correction', 'balance_adjustment'].includes(tx.category)) {
            editorRow.style.display = 'flex';
            document.getElementById('cashboxDetailEditor').textContent = editor;
        } else {
            editorRow.style.display = 'none';
        }
    }

    document.getElementById('cashboxDetailCreatedAt').textContent = createdAtDate;
    const notes = cashboxDisplayNotes(tx);
    const notesRow = document.getElementById('cashboxDetailNotesRow');
    if (notesRow) notesRow.style.display = notes ? 'flex' : 'none';
    document.getElementById('cashboxDetailNotes').textContent = notes;

    modal.classList.add('show');
}

function closeCashboxDetailsModal() {
    const modal = document.getElementById('cashboxDetailsModal');
    if (modal) modal.classList.remove('show');
}

window.cashboxViewTransactionDetails = cashboxViewTransactionDetails;
window.closeCashboxDetailsModal = closeCashboxDetailsModal;

async function submitCashboxTransaction(event) {
    event.preventDefault();

    const type = document.getElementById('cashboxTxType').value;
    const amount = parseInt(document.getElementById('cashboxAmount').value, 10);
    const category = document.getElementById('cashboxCategory').value;
    const description = document.getElementById('cashboxDescription').value.trim();
    const date = document.getElementById('cashboxDate').value;
    const notes = document.getElementById('cashboxNotes').value.trim();
    const paymentMethod = document.getElementById('cashboxPaymentMethod').value;
    const btn = document.getElementById('cashboxSubmitBtn');

    if (!amount || amount <= 0) {
        toast.error('Укажите сумму больше 0');
        return;
    }

    btn.disabled = true;
    try {
        const response = await fetch(`${API_URL}/cashbox/transactions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({ type, amount, category, description, date, notes, paymentMethod })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Не удалось сохранить операцию');

        toast.success('Операция сохранена');
        closeCashboxModal();
        await renderCashbox(true);
    } catch (error) {
        console.error('Cashbox submit error:', error);
        toast.error(error.message || 'Не удалось сохранить операцию');
    } finally {
        btn.disabled = false;
    }
}

function openCashboxTransferModal() {
    const modal = document.getElementById('cashboxTransferModal');
    const fromInput = document.getElementById('cashboxTransferFrom');
    const toInput = document.getElementById('cashboxTransferTo');
    const selectedAccount = document.getElementById('cashboxAccountFilter')?.value || '';
    if (!modal || !fromInput || !toInput) return;

    fromInput.value = selectedAccount && selectedAccount !== 'unspecified' ? selectedAccount : '';
    toInput.value = '';
    document.getElementById('cashboxTransferAmount').value = '';
    document.getElementById('cashboxTransferNotes').value = '';
    document.getElementById('cashboxTransferDate').value = cashboxFormatLocalISO(new Date());
    modal.classList.add('show');
}

function closeCashboxTransferModal() {
    document.getElementById('cashboxTransferModal')?.classList.remove('show');
}

async function submitCashboxTransfer(event) {
    event.preventDefault();

    const fromPaymentMethod = document.getElementById('cashboxTransferFrom').value;
    const toPaymentMethod = document.getElementById('cashboxTransferTo').value;
    const amount = Number(document.getElementById('cashboxTransferAmount').value);
    const date = document.getElementById('cashboxTransferDate').value;
    const notes = document.getElementById('cashboxTransferNotes').value.trim();
    const btn = document.getElementById('cashboxTransferSubmitBtn');

    if (!fromPaymentMethod || !toPaymentMethod) {
        toast.error('Выберите оба счёта');
        return;
    }
    if (fromPaymentMethod === toPaymentMethod) {
        toast.error('Выберите два разных счёта');
        return;
    }
    if (!Number.isInteger(amount) || amount <= 0) {
        toast.error('Укажите сумму больше 0');
        return;
    }

    btn.disabled = true;
    try {
        const response = await fetch(`${API_URL}/cashbox/accounts/transfer`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`,
                'X-Idempotency-Key': `cashbox-transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`
            },
            body: JSON.stringify({ fromPaymentMethod, toPaymentMethod, amount, date, notes })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Не удалось провести перевод');

        toast.success(data.message || 'Перевод между счетами проведён');
        closeCashboxTransferModal();
        await renderCashbox(true);
    } catch (error) {
        console.error('Cashbox transfer error:', error);
        toast.error(error.message || 'Не удалось провести перевод');
    } finally {
        btn.disabled = false;
    }
}

function cashboxExportToExcel() {
    const table = document.querySelector('#section-cashbox table');
    if (!table) return;
    try {
        const wb = XLSX.utils.table_to_book(table, { sheet: "Касса" });
        XLSX.writeFile(wb, `cashbox-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
        if (typeof toast !== 'undefined' && toast.success) {
            toast.success('Отчёт кассы скачан');
        }
    } catch (e) {
        console.error('Excel export error:', e);
        if (typeof toast !== 'undefined' && toast.error) {
            toast.error('Не удалось подготовить отчёт кассы');
        } else {
            alert('Не удалось подготовить отчёт кассы');
        }
    }
}

function initCashboxHandlers() {
    cashboxSetDefaultPeriod();

    const applyBtn = document.getElementById('cashboxApplyBtn');
    if (applyBtn) {
        applyBtn.addEventListener('click', () => renderCashbox(true));
    }

    const exportBtn = document.getElementById('cashboxExportBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', cashboxExportToExcel);
    }
}

document.addEventListener('DOMContentLoaded', initCashboxHandlers);

const CASHBOX_CHART_COLORS = ['#36a2eb', '#ff6384', '#ffcd56', '#4bc0c0', '#9966ff', '#ff9f40', '#00cd9b', '#ebb85c'];

function cashboxRenderCharts(transactions) {
    const chartsEl = document.getElementById('cashboxCharts');
    if (!chartsEl) return;

    if (!transactions || !transactions.length) {
        chartsEl.innerHTML = '<div style="grid-column: 1/-1; text-align: center; opacity: 0.5; padding: 20px;">Нет данных для графиков</div>';
        return;
    }

    // 1. Calculate distributions (excluding technical corrections/refunds for core charts)
    const isTechnicalCorrection = tx => ['correction', 'balance_adjustment'].includes(tx.category);
    const isAccountTransfer = tx => ['account_transfer_in', 'account_transfer_out'].includes(tx.category);
    const incomes = transactions.filter(tx => tx.type === 'income' && !isTechnicalCorrection(tx) && !isAccountTransfer(tx));
    const expenses = transactions.filter(tx => tx.type === 'expense' && !isTechnicalCorrection(tx) && !isAccountTransfer(tx) && tx.category !== 'refund');

    const incomeByCategory = {};
    let totalIncome = 0;
    for (const tx of incomes) {
        const amount = cashboxEffectiveAmount(tx);
        const cat = cashboxCategoryLabel(tx.category);
        incomeByCategory[cat] = (incomeByCategory[cat] || 0) + amount;
        totalIncome += amount;
    }

    const expenseByCategory = {};
    let totalExpense = 0;
    for (const tx of expenses) {
        const cat = cashboxCategoryLabel(tx.category);
        expenseByCategory[cat] = (expenseByCategory[cat] || 0) + tx.amount;
        totalExpense += tx.amount;
    }

    // Sort categories desc
    const sortedIncomes = Object.entries(incomeByCategory)
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value);

    const sortedExpenses = Object.entries(expenseByCategory)
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value);

    // 2. Render helper for conic donut
    const renderDonut = (title, items, total, sign) => {
        if (!total) {
            return `
                <div class="admin-card" style="padding: 20px;">
                    <h3 style="margin-top: 0; margin-bottom: 15px; font-size: 1.1rem; opacity: 0.85;">${title}</h3>
                    <div style="text-align: center; opacity: 0.5; padding: 40px 0;">Нет операций</div>
                </div>
            `;
        }

        let cursor = 0;
        const segments = items.map((item, index) => {
            const start = cursor;
            cursor += (item.value / total) * 100;
            const color = CASHBOX_CHART_COLORS[index % CASHBOX_CHART_COLORS.length];
            return `${color} ${start}% ${cursor}%`;
        });

        return `
            <div class="admin-card" style="padding: 20px; display: flex; flex-direction: column;">
                <h3 style="margin-top: 0; margin-bottom: 15px; font-size: 1.1rem; opacity: 0.85;">${title}</h3>
                <div style="display: flex; align-items: center; gap: 24px; flex-wrap: wrap; margin-top: auto; margin-bottom: auto;">
                    <div style="position: relative; width: 140px; height: 140px; border-radius: 50%; background: conic-gradient(${segments.join(', ')}); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <div style="position: absolute; width: 96px; height: 96px; border-radius: 50%; background: var(--bg-paper, #1e1e24); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 6px;">
                            <strong style="font-size: 0.95rem; font-weight: 700; white-space: nowrap; max-width: 84px; overflow: hidden; text-overflow: ellipsis;" title="${total.toLocaleString('ru-RU')} ₸">${sign}${total.toLocaleString('ru-RU')}</strong>
                            <span style="font-size: 0.75rem; opacity: 0.5; margin-top: 2px;">тенге</span>
                        </div>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 140px;">
                        ${items.map((item, index) => {
                            const color = CASHBOX_CHART_COLORS[index % CASHBOX_CHART_COLORS.length];
                            const pct = Math.round((item.value / total) * 100);
                            return `
                                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.85rem; gap: 10px;">
                                    <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
                                        <i style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${color}; flex-shrink: 0;"></i>
                                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${cashboxEsc(item.label)}">${cashboxEsc(item.label)}</span>
                                    </div>
                                    <strong style="white-space: nowrap; flex-shrink: 0; opacity: 0.85;">${pct}%</strong>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;
    };

    // 3. Technical Corrections Render
    const corrections = transactions.filter(tx => isTechnicalCorrection(tx));
    let correctionsHtml = '';
    if (corrections.length > 0) {
        let totalCorr = 0;
        const corrList = corrections.map(c => {
            const sign = c.type === 'income' ? 1 : -1;
            totalCorr += c.amount * sign;
            return `
                <div style="display:flex; justify-content:space-between; font-size:0.82rem; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.05); gap:12px;">
                    <span style="opacity:0.85; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${cashboxEsc(c.description)}">${cashboxEsc(c.description)}</span>
                    <strong style="color:${sign > 0 ? '#28a745' : '#e9b95c'}; white-space:nowrap;">${sign > 0 ? '+' : '−'}${cashboxFmtMoney(c.amount)}</strong>
                </div>
            `;
        }).join('');
        correctionsHtml = `
            <div class="admin-card" style="padding: 20px; display: flex; flex-direction: column;">
                <h3 style="margin-top: 0; margin-bottom: 15px; font-size: 1.1rem; opacity: 0.85;">Корректировки баланса</h3>
                <div style="flex: 1; display: flex; flex-direction: column; justify-content: space-between;">
                    <div style="max-height: 120px; overflow-y: auto; margin-bottom: 12px; padding-right: 4px;">
                        ${corrList}
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.9rem; font-weight: 700; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px;">
                        <span>Итог корректировок:</span>
                        <span style="color:${totalCorr >= 0 ? '#28a745' : '#e9b95c'};">${totalCorr >= 0 ? '+' : ''}${cashboxFmtMoney(totalCorr)}</span>
                    </div>
                </div>
            </div>
        `;
    } else {
        correctionsHtml = `
            <div class="admin-card" style="padding: 20px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;">
                <h3 style="margin-top: 0; margin-bottom: 15px; font-size: 1.1rem; opacity: 0.85; width: 100%; text-align: left;">Корректировки баланса</h3>
                <div style="opacity: 0.5; padding: 40px 0;">Корректировок за период нет</div>
            </div>
        `;
    }

    chartsEl.innerHTML = `
        ${renderDonut('Структура доходов', sortedIncomes, totalIncome, '+')}
        ${renderDonut('Структура расходов', sortedExpenses, totalExpense, '−')}
        ${correctionsHtml}
    `;
}

window.renderCashbox = renderCashbox;
window.openCashboxModal = openCashboxModal;
window.closeCashboxModal = closeCashboxModal;
window.submitCashboxTransaction = submitCashboxTransaction;
window.cashboxSelectAccount = cashboxSelectAccount;
window.openCashboxTransferModal = openCashboxTransferModal;
window.closeCashboxTransferModal = closeCashboxTransferModal;
window.submitCashboxTransfer = submitCashboxTransfer;
