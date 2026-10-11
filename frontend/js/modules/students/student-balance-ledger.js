(() => {
    const titles = {
        opening: 'Начальный остаток', payment: 'Оплата', payment_correction: 'Исправление оплаты',
        payment_refund: 'Возврат средств', payment_cancellation: 'Отмена оплаты',
        lesson_charge: 'Списание за урок', lesson_reversal: 'Возврат за урок', manual_adjustment: 'Корректировка',
    };
    let generation = 0;
    window.initStudentBalanceLedger = function(studentId) {
        const panel = document.getElementById('studentBalanceLedgerPanel');
        const content = document.getElementById('studentBalanceLedgerContent');
        if (!panel || !content) return;
        const version = ++generation;
        panel.hidden = !['admin', 'super_admin'].includes(getUserRole());
        panel.open = false;
        content.replaceChildren();
        let loaded = false, loading = false, cursor = null;
        let body;
        const info = document.createElement('p');
        info.setAttribute('aria-live', 'polite');
        const more = document.createElement('button');
        more.type = 'button'; more.className = 'admin-btn btn-secondary';
        more.textContent = 'Показать ещё'; more.hidden = true;
        const money = amount => `${new Intl.NumberFormat('ru-RU').format(amount)} ₸`;
        const cell = (row, text) => { const td = document.createElement('td'); td.textContent = text; td.style.padding = '10px 8px'; row.append(td); };

        async function load() {
            if (loading || panel.hidden) return;
            loading = true; more.disabled = true;
            if (!loaded) { content.replaceChildren(info); info.textContent = 'Загрузка журнала…'; }
            try {
                const response = await fetch(`${API_URL}/students/${encodeURIComponent(studentId)}/balance-ledger${cursor === null ? '' : `?before=${cursor}`}`, {
                    headers: { Authorization: `Bearer ${getAuthToken()}` },
                });
                const data = await response.json();
                if (!response.ok || !data.success) throw new Error(data.error || 'Журнал недоступен');
                if (version !== generation) return;
                const summary = data.summary;
                info.textContent = `Текущий баланс: ${money(summary.balance)}. Начальный остаток: ${money(summary.openingAmount ?? 0)}.`
                    + (summary.needsReviewCount ? ' История до перехода или отдельные старые списания требуют сверки.' : '')
                    + (!summary.consistent ? ' Обнаружено расхождение с журналом. Требуется проверка администратора.' : '');
                if (!loaded) {
                    const table = document.createElement('table');
                    table.style.cssText = 'width:100%;font-size:0.85em;text-align:left;';
                    const head = table.createTHead().insertRow();
                    for (const title of ['Когда записано', 'Операция и причина', 'Изменение', 'Было', 'Стало']) {
                        const th = document.createElement('th'); th.scope = 'col'; th.textContent = title;
                        th.style.cssText = 'padding:10px 8px;position:sticky;top:0;background:var(--ops-surface,#1c1c18);';
                        head.append(th);
                    }
                    body = table.createTBody();
                    const scroll = document.createElement('div');
                    scroll.style.cssText = 'overflow:auto;max-height:420px;';
                    scroll.tabIndex = 0; scroll.setAttribute('role', 'region');
                    scroll.setAttribute('aria-label', 'Движения баланса, таблица с прокруткой');
                    scroll.append(table);
                    content.append(scroll, more);
                }
                for (const entry of data.entries) {
                    const row = body.insertRow();
                    cell(row, new Date(entry.recordedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Aqtobe' }));
                    cell(row, `${titles[entry.kind] || entry.kind}. ${entry.reason}${entry.needsReview ? ' · Требует сверки' : ''}`);
                    cell(row, `${entry.amount > 0 ? '+' : ''}${money(entry.amount)}`);
                    cell(row, money(entry.balanceBefore)); cell(row, money(entry.balanceAfter));
                }
                loaded = true; cursor = data.nextBefore; more.hidden = cursor === null;
                more.textContent = 'Показать ещё';
            } catch (error) {
                if (version !== generation) return;
                info.textContent = error.message;
                if (!content.contains(more)) content.append(more);
                more.hidden = false; more.textContent = 'Повторить загрузку';
            } finally {
                loading = false; more.disabled = false;
            }
        }
        more.addEventListener('click', load);
        panel.ontoggle = () => { if (panel.open && !loaded) load(); };
    };
})();
