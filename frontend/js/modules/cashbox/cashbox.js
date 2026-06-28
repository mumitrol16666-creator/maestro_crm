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

function cashboxSetDefaultPeriod() {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const fromEl = document.getElementById('cashboxFrom');
    const toEl = document.getElementById('cashboxTo');
    if (fromEl) fromEl.value = from.toISOString().split('T')[0];
    if (toEl) toEl.value = to.toISOString().split('T')[0];
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
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; opacity:0.5; padding:30px;">Загрузка...</td></tr>';

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

        if (!summaryRes.ok || !txRes.ok) throw new Error('Ошибка загрузки кассы');

        const summaryData = await summaryRes.json();
        const txData = await txRes.json();
        const s = summaryData.summary || {};

        summaryEl.innerHTML = `
            <div style="padding:14px; background:rgba(255,255,255,0.04); border-radius:8px;">
                <div style="opacity:0.65; font-size:0.85rem;">Платежи (абонементы)</div>
                <div style="font-size:1.25rem; font-weight:600; margin-top:4px;">${cashboxFmtMoney(s.paymentsTotal)}</div>
                <small style="opacity:0.5;">${s.paymentsCount || 0} операций</small>
            </div>
            <div style="padding:14px; background:rgba(40,167,69,0.08); border-radius:8px;">
                <div style="opacity:0.65; font-size:0.85rem;">Ручной приход</div>
                <div style="font-size:1.25rem; font-weight:600; margin-top:4px; color:#28a745;">${cashboxFmtMoney(s.manualIncome)}</div>
            </div>
            <div style="padding:14px; background:rgba(220,53,69,0.08); border-radius:8px;">
                <div style="opacity:0.65; font-size:0.85rem;">Расходы</div>
                <div style="font-size:1.25rem; font-weight:600; margin-top:4px; color:#dc3545;">${cashboxFmtMoney(s.expenses)}</div>
            </div>
            <div style="padding:14px; background:rgba(235,77,119,0.1); border-radius:8px;">
                <div style="opacity:0.65; font-size:0.85rem;">Итого (чистый)</div>
                <div style="font-size:1.25rem; font-weight:600; margin-top:4px; color:var(--pink);">${cashboxFmtMoney(s.net)}</div>
                <small style="opacity:0.5;">доход ${cashboxFmtMoney(s.totalIncome)}</small>
            </div>
        `;

        const transactions = txData.transactions || [];
        if (!transactions.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; opacity:0.5; padding:30px;">Нет операций за период</td></tr>';
            return;
        }

        tbody.innerHTML = transactions.map(tx => {
            const author = tx.createdBy
                ? `${tx.createdBy.name || ''} ${tx.createdBy.lastName || ''}`.trim()
                : '—';
            const typeLabel = tx.type === 'income'
                ? '<span style="color:#28a745;">Приход</span>'
                : '<span style="color:#dc3545;">Расход</span>';
            return `
                <tr>
                    <td>${cashboxFmtDate(tx.date)}</td>
                    <td>${typeLabel}</td>
                    <td>${cashboxEsc(tx.category)}</td>
                    <td>${cashboxEsc(tx.description)}</td>
                    <td style="white-space:nowrap; font-weight:600;">${cashboxFmtMoney(tx.amount)}</td>
                    <td>${cashboxEsc(author)}</td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Cashbox render error:', error);
        summaryEl.innerHTML = '<p style="color:#ef4444;">Не удалось загрузить сводку</p>';
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#ef4444; padding:30px;">Ошибка загрузки</td></tr>';
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
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    modal.classList.add('active');
}

function closeCashboxModal() {
    const modal = document.getElementById('cashboxModal');
    if (modal) modal.classList.remove('active');
}

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
        if (!response.ok) throw new Error(data.error || 'Ошибка сохранения');

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
            toast.success('Отчёт кассы успешно выгружен в Excel');
        }
    } catch (e) {
        console.error('Excel export error:', e);
        if (typeof toast !== 'undefined' && toast.error) {
            toast.error('Не удалось экспортировать кассу');
        } else {
            alert('Ошибка экспорта Excel');
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

window.renderCashbox = renderCashbox;
window.openCashboxModal = openCashboxModal;
window.closeCashboxModal = closeCashboxModal;
window.submitCashboxTransaction = submitCashboxTransaction;
