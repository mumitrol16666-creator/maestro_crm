(() => {
    const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const money = n => `${Number(n || 0).toLocaleString('ru-RU')} ₸`;
    const account = key => ({ cash: 'Наличные', kaspi_pay: 'КаспиПей', freedom: 'Фридом', halyk: 'Халык Банк' }[key] || key);
    const day = d => d ? new Date(d).toLocaleDateString('ru-RU', { timeZone: 'Asia/Aqtobe' }) : 'не указан';
    const fio = s => [s.lastName, s.name, s.middleName].filter(Boolean).join(' ');
    const labels = { individual: 'Индивидуальный', duo: 'Дуо', trio: 'Трио', quartet: 'Квартет', theory: 'Теория' };
    let root, state, busy = false, version = 0;
    const field = (name, label, value = '', type = 'text', attrs = '') => `<label class="enrollment-field">${h(label)}<input class="admin-input" name="${name}" value="${h(value)}" type="${type}" ${attrs}></label>`;
    const btn = (action, label, id = '', primary = false) => `<button type="button" class="admin-btn ${primary ? 'btn-primary' : 'btn-secondary'}" data-action="${action}" data-id="${h(id)}">${h(label)}</button>`;
    async function api(path, body) {
        const response = await fetch(`${API_URL}/subscription-periods${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
        const result = await response.json(); if (!response.ok || !result.success) throw new Error(result.error || 'Не удалось выполнить действие.'); return result;
    }
    function error(message) { const el = root.querySelector('[role=alert]'); el.textContent = message; el.hidden = false; }
    function paymentFields() {
        return `<div class="enrollment-fields">${field('amount', 'Фактически получено, ₸', '', 'number', 'required min="0" step="1"')}<label class="enrollment-field">Счёт получения<select class="admin-input" name="paymentMethod"><option value="cash">Наличные</option><option value="kaspi_pay">КаспиПей</option><option value="freedom">Фридом</option><option value="halyk">Халык Банк</option></select></label>${field('paymentDate', 'Дата и время получения / зачёта', new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16), 'datetime-local', 'required')}${field('payer', 'Фактический плательщик', '', 'text', 'required')}${field('notes', 'Комментарий')}</div>`;
    }
    const paymentData = v => ({ amount: Number(v.amount), paymentMethod: v.paymentMethod, paymentDate: new Date(v.paymentDate).toISOString(), payer: v.payer, notes: v.notes });
    async function reload() { state = await api(`/student/${state.student.id}`); render(); }
    async function action(fn) {
        if (busy) return; busy = true; root.querySelector('[role=alert]').hidden = true;
        const controls = [...root.querySelectorAll('button,input,select,textarea')].filter(el => !el.disabled); controls.forEach(el => el.disabled = true);
        try { await fn(); if (root.isConnected) await reload(); }
        catch (err) { error(err.message); }
        finally { busy = false; controls.filter(el => el.isConnected).forEach(el => el.disabled = false); }
    }
    function bind() { root.querySelectorAll('[data-action]').forEach(el => el.onclick = () => dispatch(el.dataset.action, el.dataset.id)); }
    function render() {
        const r = state.pendingRenewal;
        root.querySelector('[data-content]').innerHTML = `<p>Баланс: ${money(state.student.accountBalance)}. ${state.student.status === 'active' ? 'Ученик активен.' : 'Обучение приостановлено. Оплата и продление сами его не возобновляют.'}</p><p>Доплата погашает долг текущего периода. Продление создаёт новый период только после вашего подтверждения.</p>${r ? `<section class="enrollment-notice"><h3>Подготовлено продление</h3><p>${h(r.terms.name)} · ${day(r.validFrom)} — ${day(r.validUntil)} (${r.terms.days} дней)</p><p>Стоимость ${money(r.terms.totalPrice)}. Зачёт ${money(r.creditAmount)}. Получено ${money(r.paymentPayload.amount)}. Доплатить ${money(r.terms.totalPrice - r.creditAmount - r.paymentPayload.amount)}.</p><p>Плательщик: ${h(r.paymentPayload.payer)} · ${h(account(r.paymentPayload.paymentMethod))} · ${day(r.paymentPayload.paymentDate)}</p><p>Основание: ${h(r.documentBasis.reference)}. ${h(r.creditReason)}</p><p>Проверьте расчёт. Подтверждение запишет полученные деньги один раз и запустит новый период. Зачёт не создаёт приход в кассу.</p><div class="enrollment-actions">${btn('confirm-renewal', 'Подтвердить оплату и продление', r.id, true)}${btn('cancel-renewal', 'Отменить черновик', r.id)}</div></section>` : ''}${state.periods.length ? state.periods.map(p => `<section class="enrollment-account"><h3>${h(p.membership.tariffName || p.membership.type)}${p.membership.id === state.student.activeMembershipId ? ' · текущий' : ''}</h3><p>${day(p.membership.validFrom)} — ${day(p.membership.validUntil)} · ${p.membership.status === 'active' ? 'действующий тариф' : 'предыдущий период'}</p>${p.terms ? `<p>Стоимость ${money(p.terms.totalPrice)} · Получено ${money(p.receivedAmount)} · Зачтено ${money(p.creditAmount)} · Доплата ${money(p.remainingAmount)}</p>${p.remainingAmount > 0 ? `<p class="enrollment-notice">${p.overdue ? 'Доплата просрочена.' : 'Доплата — до окончания второго учитываемого урока.'} Учтено ${p.countedLessons}.${p.dueAt ? ` Срок: ${new Date(p.dueAt).toLocaleString('ru-RU', { timeZone: 'Asia/Aqtobe' })}.` : ''}${p.overdue ? ` Проверьте уведомление заказчика и приостановку. С ${day(p.reviewAfter)} — вопрос снятия с расписания. Все действия выполняет администратор.` : ''}</p>` : ''}` : '<p>У старого тарифа не сохранены стоимость и срок купленного периода. Баланс не означает долг или подтверждённый остаток этого абонемента. Сверьте прежние условия с бумажным приложением и внесите их в расчёт продления.</p>'}${p.pendingInstallment ? `<div class="enrollment-notice"><p>Черновик доплаты: ${money(p.pendingInstallment.payload.amount)} · ${h(p.pendingInstallment.payload.payer)} · ${day(p.pendingInstallment.payload.paymentDate)}</p><div class="enrollment-actions">${btn('confirm-installment', 'Подтвердить полученную доплату', p.pendingInstallment.id, true)}${btn('cancel-installment', 'Отменить черновик', p.pendingInstallment.id)}</div></div>` : p.remainingAmount > 0 ? btn('topup', 'Доплатить текущий период', p.membership.id) : ''}${!r && !p.remainingAmount && !state.periods.some(next => next.membership.previousMembershipId === p.membership.id) && (p.membership.id === state.student.activeMembershipId || !state.student.activeMembershipId) ? btn('renew', 'Продлить абонемент', p.membership.id, true) : ''}${p.payments.length ? `<details><summary>Оплаты этого периода</summary>${p.payments.map(pay => `<p>${day(pay.paymentDate)} · ${money(pay.amount)} · учтено после возвратов ${money(pay.netAmount)}</p>`).join('')}</details>` : ''}</section>`).join('') : '<p>Тариф с расценками пока не подключён. Продолжите первое оформление.</p>'}<div class="enrollment-actions">${btn('profile', 'Открыть карточку и расписание')}${!state.student.lostAt ? btn('pause', state.student.status === 'active' ? 'Приостановить занятия…' : 'Возобновить занятия…') : ''}${state.student.status === 'inactive' && !state.student.lostAt ? btn('release', 'Снять с расписания…') : ''}${btn('refresh', 'Обновить')}</div><div data-form></div>`;
        bind();
        root.querySelector('.enrollment-dialog').scrollTop = 0;
    }
    function form(kind, id) {
        const p = state.periods.find(x => x.membership.id === id); if (!p) return;
        const t = p.terms || {}, target = root.querySelector('[data-form]');
        target.innerHTML = `<form><h3>${kind === 'renew' ? 'Расчёт продления' : 'Доплата текущего периода'}</h3>${kind === 'renew' ? `<div class="enrollment-fields">${field('name', 'Название абонемента', t.name || p.membership.tariffName, 'text', 'required')}${field('direction', 'Направление(я)', t.direction, 'text', 'required')}${field('scheduleText', 'Согласованное расписание', t.scheduleText, 'text', 'required')}${field('totalPrice', 'Стоимость периода, ₸', t.totalPrice, 'number', 'required min="1" step="1"')}${field('days', 'Срок использования, дней', t.days, 'number', 'required min="1" max="730" step="1"')}${field('firstPayment', 'Согласованная первая часть с зачётом, ₸', t.firstPayment, 'number', 'required min="1" step="1"')}${field('emergencyCancellations', 'Экстренных отмен', t.emergencyCancellations ?? p.membership.emergencyFreezesAvailable ?? 0, 'number', 'required min="0" max="100" step="1"')}<label class="enrollment-field">Вид абонемента<select class="admin-input" name="renewalKind" required><option value="">Выберите</option><option value="ordinary" ${t.renewalKind === 'ordinary' ? 'selected' : ''}>Обычный</option><option value="half_year" ${t.renewalKind === 'half_year' ? 'selected' : ''}>Полугодовой</option><option value="year" ${t.renewalKind === 'year' ? 'selected' : ''}>Годовой</option></select></label></div><h4>Согласованные расценки</h4>${Object.entries(labels).map(([key, label]) => { const r = t.rates?.[key] || p.membership.lessonRates?.[key]; return `<div class="enrollment-fields"><label class="enrollment-check"><input type="checkbox" name="format_${key}" ${r ? 'checked' : ''}>${label}</label>${field(`price_${key}`, 'Цена урока, ₸', r?.price, 'number', 'min="0" max="1000000" step="1"')}${field(`duration_${key}`, 'Длительность, минут', t.durations?.[key], 'number', 'min="15" max="240" step="1"')}</div>`; }).join('')}${field('additionalTerms', 'Дополнительные условия', t.additionalTerms)}<div class="enrollment-fields">${field('creditAmount', 'Подтверждённый зачёт остатка, ₸', 0, 'number', `required min="0" max="${p.creditLimit}" step="1"`)}${field('creditReason', 'Основание и расчёт зачёта', '', 'text', 'maxlength="1000"')}</div><p>Верхняя граница по текущему учёту: ${money(p.creditLimit)}. Это не автоматическое подтверждение происхождения старых денег. Проверьте расчёт с заказчиком.</p><label class="enrollment-field">Основание условий<select class="admin-input" name="documentMode"><option value="same">Прежние условия обычного абонемента</option><option value="new_appendix">Новое подписанное приложение</option></select></label>${field('documentReference', 'Номер и дата действующего / нового подписанного приложения', p.documentBasis?.reference, 'text', 'required maxlength="500"')}<p>Полугодовой, годовой и изменённые условия требуют нового подписанного приложения. Здесь фиксируется ссылка на фактически подписанный документ. Если прежнего приложения нет в CRM, администратор сверяет введённые условия с бумажным экземпляром.</p>` : `<p>Осталось ${money(p.remainingAmount)}. Даты ${day(p.membership.validFrom)} — ${day(p.membership.validUntil)} не изменятся. Возобновление занятий — отдельное решение администратора.</p>`}${paymentFields()}${kind === 'renew' ? '<label class="enrollment-check"><input type="checkbox" name="confirmed" required> Условия, вид абонемента, подписанное приложение и зачёт проверены; расчёт сообщён заказчику до оплаты</label>' : ''}<button class="admin-btn btn-primary" type="submit">${kind === 'renew' ? 'Подготовить продление для проверки' : 'Подготовить доплату'}</button></form>`;
        target.querySelector('form').onsubmit = event => {
            event.preventDefault(); const v = Object.fromEntries(new FormData(event.target)); let body;
            try {
                if (kind === 'renew') {
                    const rates = {}, durations = {};
                    for (const k of Object.keys(labels)) if (v[`format_${k}`]) {
                        if (v[`price_${k}`] === '' || v[`duration_${k}`] === '') throw new Error(`Укажите цену и длительность: ${labels[k]}`);
                        const price = Number(v[`price_${k}`]), previous = t.rates?.[k] || p.membership.lessonRates?.[k];
                        rates[k] = previous?.price === price ? previous : { basePrice: price, reason: price === 0 ? 'Бесплатный формат по подписанным условиям' : '' };
                        durations[k] = Number(v[`duration_${k}`]);
                    }
                    body = { terms: { ...v, days: Number(v.days), firstPayment: Number(v.firstPayment), totalPrice: Number(v.totalPrice), emergencyCancellations: Number(v.emergencyCancellations), rates, durations }, creditAmount: Number(v.creditAmount), creditReason: v.creditReason,
                        documentBasis: { mode: v.documentMode, reference: v.documentReference }, confirmed: Boolean(v.confirmed), payment: paymentData(v) };
                } else body = paymentData(v);
                action(() => api(`/memberships/${id}/${kind === 'renew' ? 'renewals' : 'installments'}`, body));
            } catch (err) { error(err.message); }
        };
        target.scrollIntoView({ block: 'start', behavior: 'smooth' }); target.querySelector('input')?.focus();
    }
    function dispatch(name, id) {
        if (name === 'renew' || name === 'topup') { form(name, id); return; }
        if (name === 'profile' || name === 'pause') { root.remove(); viewStudent(state.student.id).then(() => { if (name === 'pause') window.toggleStudentPauseState(); }); return; }
        if (name === 'release') {
            const target = root.querySelector('[data-form]');
            target.innerHTML = `<form><h3>Снять ученика с расписания</h3><p>Будущие индивидуальные слоты и места в группах освободятся. История уроков, деньги и срок абонемента сохранятся. Возвращение потребует согласования расписания.</p>${field('reason', 'Причина решения администратора', '', 'text', 'required minlength="5" maxlength="1000"')}<label class="enrollment-check"><input type="checkbox" name="confirmed" required> Уведомление заказчика и основание проверены; снять с расписания</label><button class="admin-btn btn-primary" type="submit">Подтвердить снятие с расписания</button></form>`;
            target.querySelector('form').onsubmit = event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.target)); action(() => api(`/student/${state.student.id}/release-schedule`, { reason: values.reason, confirmed: Boolean(values.confirmed) })); };
            target.scrollIntoView({ block: 'start' }); return;
        }
        action(async () => {
            if (name === 'refresh') return;
            const [operation, kind] = name.split('-');
            await api(`/${kind === 'renewal' ? 'renewals' : 'installments'}/${id}/${operation}`, {});
            if (typeof invalidateCache === 'function') invalidateCache('students', 'dashboard', 'membership-actions');
        });
    }
    window.openStudentPeriods = async studentId => {
        if (busy) return; const current = ++version;
        document.getElementById('subscriptionPeriodsModal')?.remove();
        root = document.createElement('div'); root.id = 'subscriptionPeriodsModal'; root.className = 'modal show enrollment-modal';
        root.innerHTML = `<div class="modal-overlay" data-close></div><section class="modal-content enrollment-dialog" role="dialog" aria-modal="true" aria-labelledby="periodTitle"><header><h2 id="periodTitle">Абонементы и доплаты</h2><button class="admin-btn btn-secondary" type="button" data-close aria-label="Закрыть абонементы">×</button></header><div class="enrollment-error" role="alert" hidden></div><div data-content>Загрузка…</div></section>`;
        document.body.append(root); root.querySelectorAll('[data-close]').forEach(el => el.onclick = () => { if (!busy) root.remove(); });
        root.onkeydown = event => {
            if (event.key === 'Escape' && !busy) { event.stopPropagation(); root.remove(); }
            if (event.key === 'Tab') { const items = [...root.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')].filter(e => e.offsetParent !== null);
                if (event.shiftKey && document.activeElement === items[0]) { items.at(-1)?.focus(); event.preventDefault(); }
                if (!event.shiftKey && document.activeElement === items.at(-1)) { items[0]?.focus(); event.preventDefault(); }
            }
        };
        root.querySelector('button[data-close]').focus();
        try { const result = await api(`/student/${studentId}`); if (current !== version || !root.isConnected) return; state = result; root.querySelector('#periodTitle').textContent = `${fio(state.student)} — абонементы`; render(); }
        catch (err) { if (current === version) error(err.message); }
    };
})();
