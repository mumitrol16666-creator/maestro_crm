// =====================================================
// CASHBOX MODULE — Касса (сводка + ручные операции)
// =====================================================

const CASHBOX_CATEGORIES = {
    income: ['Прочий доход', 'Возврат', 'Аренда оборудования', 'Мерч', 'Другое'],
    expense: ['Закупки', 'Аренда', 'Коммунальные', 'Реклама', 'Зарплата', 'Прочее']
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
    const search = document.getElementById('cashboxSearchFilter')?.value;
    return { from, to, type, search };
}

function cashboxEsc(text) {
    return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function renderCashbox(forceReload = false) {
    const summaryEl = document.getElementById('cashboxSummary');
    const tbody = document.getElementById('cashboxTransactionsBody');
    if (!summaryEl || !tbody) return;

    const filters = cashboxGetFilters();
    if (!filters.from || !filters.to) {
        cashboxSetDefaultPeriod();
    }

    const currentFilters = cashboxGetFilters();
    summaryEl.innerHTML = '<p style="opacity:0.5; grid-column:1/-1;">Загрузка сводки...</p>';
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; opacity:0.5; padding:30px;">Загрузка...</td></tr>';

    try {
        const summaryQs = new URLSearchParams();
        if (currentFilters.from) summaryQs.append('from', currentFilters.from);
        if (currentFilters.to) summaryQs.append('to', currentFilters.to);

        const txQs = new URLSearchParams();
        if (currentFilters.from) txQs.append('from', currentFilters.from);
        if (currentFilters.to) txQs.append('to', currentFilters.to);
        if (currentFilters.type) txQs.append('type', currentFilters.type);
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

        const actualPayments = (s.paymentsTotal || 0) + (s.correctionsTotal || 0);

        summaryEl.innerHTML = `
            <div style="padding:14px; background:rgba(255,255,255,0.04); border-radius:8px;">
                <div style="opacity:0.65; font-size:0.85rem;">Платежи фактические</div>
                <div style="font-size:1.25rem; font-weight:600; margin-top:4px;">${cashboxFmtMoney(s.paymentsTotal)}</div>
                <small style="opacity:0.5;">с коррекцией: ${cashboxFmtMoney(actualPayments)}</small>
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
                <div style="opacity:0.65; font-size:0.85rem;">Корректировки</div>
                <div style="font-size:1.25rem; font-weight:600; margin-top:4px; color:${(s.correctionsTotal || 0) >= 0 ? '#28a745' : '#e9b95c'}">
                    ${(s.correctionsTotal || 0) >= 0 ? '+' : ''}${cashboxFmtMoney(s.correctionsTotal)}
                </div>
                <small style="opacity:0.5;">${s.correctionsCount || 0} оп.</small>
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
            tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; opacity:0.5; padding:30px;">Нет операций за период</td></tr>';
            return;
        }

        tbody.innerHTML = transactions.map(tx => {
            const author = tx.createdBy
                ? `${tx.createdBy.name || ''} ${tx.createdBy.lastName || ''}`.trim()
                : '—';
            
            let studentName = '—';
            let teacherName = '—';
            
            if (tx.relatedPayment) {
                if (tx.relatedPayment.student) {
                    studentName = `${tx.relatedPayment.student.name || ''} ${tx.relatedPayment.student.lastName || ''}`.trim();
                }
                if (tx.relatedPayment.teacher) {
                    teacherName = `${tx.relatedPayment.teacher.name || ''} ${tx.relatedPayment.teacher.lastName || ''}`.trim();
                }
            } else if (tx.category === 'salary') {
                const match = tx.description.match(/Зарплата преподавателя:\s*([^(\n]+)/);
                if (match && match[1]) {
                    teacherName = match[1].trim();
                }
            }

            const typeLabel = (() => {
                if (tx.category === 'payment') return '<span style="color:#28a745; font-weight:600;">Приход (оплата)</span>';
                if (tx.category === 'correction') return '<span style="color:#e9b95c; font-weight:600;">Корректировка</span>';
                if (tx.category === 'refund') return '<span style="color:#dc3545; font-weight:600;">Возврат</span>';
                if (tx.category === 'salary') return '<span style="color:#a78bfa; font-weight:600;">Зарплата</span>';
                if (tx.category === 'salary_advance') return '<span style="color:#fbbf24; font-weight:600;">Аванс преподавателю</span>';
                if (tx.category === 'salary_bonus') return '<span style="color:#4ade80; font-weight:600;">Премия преподавателю</span>';
                if (tx.category === 'transfer') return '<span style="color:#74b7f2; font-weight:600;">Перенос остатка</span>';
                return tx.type === 'income'
                    ? '<span style="color:#28a745;">Приход</span>'
                    : '<span style="color:#dc3545;">Расход</span>';
            })();

            const categoryLabel = (() => {
                if (tx.category === 'payment') return 'Исправление платежа' ? 'Оплата обучения' : 'Оплата обучения';
                if (tx.category === 'correction') return 'Исправление платежа';
                if (tx.category === 'refund') return 'Возврат средств';
                if (tx.category === 'salary') return 'Выплата зарплаты';
                if (tx.category === 'salary_advance') return 'Аванс преподавателю';
                if (tx.category === 'salary_bonus') return 'Премия преподавателю';
                if (tx.category === 'transfer') return 'Перенос баланса';
                return tx.category;
            })();

            const editor = tx.category === 'correction' ? author : '—';
            const createdAtDate = tx.createdAt ? new Date(tx.createdAt).toLocaleString('ru-RU') : '—';
            const sumSign = tx.type === 'income' ? '+' : '−';
            const sumColor = tx.type === 'income' ? '#28a745' : '#dc3545';

            return `
                <tr onclick="cashboxViewTransactionDetails('${tx.id}')" style="cursor: pointer;" onmouseover="this.style.backgroundColor='rgba(255,255,255,0.03)'" onmouseout="this.style.backgroundColor='transparent'">
                    <td>${cashboxFmtDate(tx.date)}</td>
                    <td>${typeLabel}</td>
                    <td>${cashboxEsc(categoryLabel)}</td>
                    <td>${cashboxEsc(tx.description)}</td>
                    <td style="white-space:nowrap; font-weight:600; color:${sumColor};">${sumSign}${cashboxFmtMoney(tx.amount)}</td>
                    <td>${cashboxEsc(studentName)}</td>
                    <td>${cashboxEsc(teacherName)}</td>
                    <td>${cashboxEsc(author)}</td>
                    <td>${cashboxEsc(editor)}</td>
                    <td>${cashboxEsc(createdAtDate)}</td>
                    <td>${cashboxEsc(tx.notes || '—')}</td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Cashbox render error:', error);
        summaryEl.innerHTML = '<p style="color:#ef4444;">Не удалось загрузить сводку</p>';
        tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; color:#ef4444; padding:30px;">Не удалось загрузить кассу. Обновите страницу.</td></tr>';
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
        ? `${tx.createdBy.name || ''} ${tx.createdBy.lastName || ''}`.trim()
        : '—';
    
    let studentName = '—';
    let teacherName = '—';
    
    if (tx.relatedPayment) {
        if (tx.relatedPayment.student) {
            studentName = `${tx.relatedPayment.student.name || ''} ${tx.relatedPayment.student.lastName || ''}`.trim();
        }
        if (tx.relatedPayment.teacher) {
            teacherName = `${tx.relatedPayment.teacher.name || ''} ${tx.relatedPayment.teacher.lastName || ''}`.trim();
        }
    } else if (tx.category === 'salary') {
        const match = tx.description.match(/Зарплата преподавателя:\s*([^(\n]+)/);
        if (match && match[1]) {
            teacherName = match[1].trim();
        }
    }

    const typeLabel = (() => {
        if (tx.category === 'payment') return '<span style="color:#28a745; font-weight:600;">Приход (оплата)</span>';
        if (tx.category === 'correction') return '<span style="color:#e9b95c; font-weight:600;">Корректировка</span>';
        if (tx.category === 'refund') return '<span style="color:#dc3545; font-weight:600;">Возврат</span>';
        if (tx.category === 'salary') return '<span style="color:#a78bfa; font-weight:600;">Зарплата</span>';
        if (tx.category === 'salary_advance') return '<span style="color:#fbbf24; font-weight:600;">Аванс преподавателю</span>';
        if (tx.category === 'salary_bonus') return '<span style="color:#4ade80; font-weight:600;">Премия преподавателю</span>';
        if (tx.category === 'transfer') return '<span style="color:#74b7f2; font-weight:600;">Перенос остатка</span>';
        return tx.type === 'income'
            ? '<span style="color:#28a745; font-weight:600;">Приход</span>'
            : '<span style="color:#dc3545; font-weight:600;">Расход</span>';
    })();

    const categoryLabel = (() => {
        if (tx.category === 'payment') return 'Оплата обучения';
        if (tx.category === 'correction') return 'Исправление платежа';
        if (tx.category === 'refund') return 'Возврат средств';
        if (tx.category === 'salary') return 'Выплата зарплаты';
        if (tx.category === 'salary_advance') return 'Аванс преподавателю';
        if (tx.category === 'salary_bonus') return 'Премия преподавателю';
        if (tx.category === 'transfer') return 'Перенос баланса';
        return tx.category;
    })();

    const editor = tx.category === 'correction' ? author : '—';
    const createdAtDate = tx.createdAt ? new Date(tx.createdAt).toLocaleString('ru-RU') : '—';
    const sumSign = tx.type === 'income' ? '+' : '−';
    const sumColor = tx.type === 'income' ? '#28a745' : '#dc3545';

    document.getElementById('cashboxDetailAmount').innerHTML = `<span style="color: ${sumColor};">${sumSign}${cashboxFmtMoney(tx.amount)}</span>`;
    document.getElementById('cashboxDetailDate').textContent = cashboxFmtDate(tx.date);
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
        if (tx.category === 'correction') {
            editorRow.style.display = 'flex';
            document.getElementById('cashboxDetailEditor').textContent = editor;
        } else {
            editorRow.style.display = 'none';
        }
    }

    document.getElementById('cashboxDetailCreatedAt').textContent = createdAtDate;
    document.getElementById('cashboxDetailNotes').textContent = tx.notes || 'Нет заметок';

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
            body: JSON.stringify({ type, amount, category, description, date, notes })
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

    // 1. Calculate distributions (excluding corrections/refunds for core charts)
    const incomes = transactions.filter(tx => tx.type === 'income' && tx.category !== 'correction');
    const expenses = transactions.filter(tx => tx.type === 'expense' && tx.category !== 'correction' && tx.category !== 'refund');

    const incomeByCategory = {};
    let totalIncome = 0;
    for (const tx of incomes) {
        let cat = tx.category || 'Прочее';
        if (cat === 'payment') cat = 'Оплата обучения';
        incomeByCategory[cat] = (incomeByCategory[cat] || 0) + tx.amount;
        totalIncome += tx.amount;
    }

    const expenseByCategory = {};
    let totalExpense = 0;
    for (const tx of expenses) {
        let cat = tx.category || 'Прочее';
        if (cat === 'salary') cat = 'Выплата зарплаты';
        if (cat === 'salary_advance') cat = 'Аванс преподавателю';
        if (cat === 'salary_bonus') cat = 'Премия преподавателю';
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
    const corrections = transactions.filter(tx => tx.category === 'correction');
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
                <h3 style="margin-top: 0; margin-bottom: 15px; font-size: 1.1rem; opacity: 0.85;">Технические корректировки</h3>
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
                <h3 style="margin-top: 0; margin-bottom: 15px; font-size: 1.1rem; opacity: 0.85; width: 100%; text-align: left;">Технические корректировки</h3>
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
