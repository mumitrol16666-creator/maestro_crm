// A student's rates are independent of attendance counts, groups and expiry dates.
(() => {
    const labels = { individual: 'Индивидуальный', theory: 'Теория', quartet: 'Квартет', duo: 'Дуо', trio: 'Трио' };
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const money = value => new Intl.NumberFormat('ru-RU').format(value);
    let state = null;
    let requestVersion = 0;
    let saving = false;

    async function api(path, body) {
        const response = await fetch(`${API_URL}/memberships${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { Authorization: `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Не удалось выполнить запрос');
        return result;
    }

    function ensureModal() {
        let modal = document.getElementById('rateCardModal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'rateCardModal';
        modal.className = 'modal';
        modal.innerHTML = `<div class="modal-overlay"></div><div class="modal-content" style="max-width:760px;width:calc(100% - 24px);max-height:92vh;overflow:auto">
            <button type="button" class="modal-close" aria-label="Закрыть">×</button>
            <h2 class="modal-title">ТАРИФ УЧЕНИКА</h2>
            <p>Расценки действуют до замены тарифа. Количество занятий и срок не ограничены.</p>
            <p id="rateCardStatus" role="status"></p>
            <form id="rateCardForm" class="admin-form">
                <div class="form-group"><label for="rateCardTemplate">ШАБЛОН</label><select id="rateCardTemplate" class="admin-input"></select></div>
                <div class="form-group"><label for="rateCardName">НАЗВАНИЕ</label><input id="rateCardName" class="admin-input" maxlength="150" required></div>
                <div id="rateCardRows"></div>
                <p>Скидка в тенге указана за один урок. Отключённая строка означает, что тариф не подходит для этого вида занятия.</p>
                <div class="form-group"><label><input type="checkbox" id="rateCardSaveTemplate"> Сохранить расценки как новый шаблон</label></div>
                <div id="rateCardReplaced" class="info-box"></div>
                <button type="submit" class="modal-submit">ПОДКЛЮЧИТЬ ТАРИФ</button>
            </form></div>`;
        document.body.appendChild(modal);
        const close = () => { if (saving) return; modal.classList.remove('show'); requestVersion++; };
        modal.querySelector('.modal-close').addEventListener('click', close);
        modal.querySelector('.modal-overlay').addEventListener('click', close);
        modal.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
        modal.querySelector('#rateCardTemplate').addEventListener('change', event => {
            const plan = state?.plans.find(p => p.id === event.target.value);
            if (plan) {
                document.getElementById('rateCardName').value = plan.name;
                drawRates(plan.lessonRates);
            }
        });
        modal.querySelector('#rateCardForm').addEventListener('submit', save);
        return modal;
    }

    function drawRates(rates = {}) {
        const target = document.getElementById('rateCardRows');
        target.innerHTML = Object.entries(labels).map(([kind, label]) => {
            const row = rates[kind];
            return `<fieldset data-rate="${kind}" style="border:1px solid #d8d8d8;border-radius:8px;padding:12px;margin:12px 0">
                <legend><label><input type="checkbox" data-field="enabled" ${row ? 'checked' : ''}> ${label}</label></legend>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px">
                    <label>Цена урока, ₸<input class="admin-input" type="number" min="0" max="1000000" step="1" data-field="basePrice" value="${row?.basePrice ?? ''}"></label>
                    <label>Скидка, %<input class="admin-input" type="number" min="0" max="100" step="0.01" data-field="discountPercent" value="${row?.discountPercent ?? 0}"></label>
                    <label>Или скидка, ₸<input class="admin-input" type="number" min="0" step="1" data-field="discountAmount" value="${row?.discountAmount ?? 0}"></label>
                </div>
                <label>Причина скидки / особые условия<input class="admin-input" data-field="reason" maxlength="500" value="${esc(row?.reason || '')}"></label>
                <p data-field="total" aria-live="polite"></p>
            </fieldset>`;
        }).join('');
        const update = () => target.querySelectorAll('fieldset').forEach(fieldset => {
            const enabled = fieldset.querySelector('[data-field="enabled"]').checked;
            fieldset.querySelectorAll('input:not([type="checkbox"])').forEach(input => { input.disabled = !enabled; });
            const base = Number(fieldset.querySelector('[data-field="basePrice"]').value);
            const percent = Number(fieldset.querySelector('[data-field="discountPercent"]').value);
            const amount = Number(fieldset.querySelector('[data-field="discountAmount"]').value);
            const total = base - (amount || Math.round(base * percent / 100));
            fieldset.querySelector('[data-field="total"]').textContent = enabled ? `К списанию за урок: ${money(total)} ₸` : 'Этот вид занятия не подключён';
        });
        target.oninput = update;
        update();
    }

    async function save(event) {
        event.preventDefault();
        const button = event.target.querySelector('button[type="submit"]');
        // The shared submit guard disables this button before our listener runs.
        if (!state || saving) return;
        saving = true;
        button.disabled = true;
        const status = document.getElementById('rateCardStatus');
        try {
            const lessonRates = {};
            document.querySelectorAll('#rateCardRows fieldset').forEach(fieldset => {
                if (!fieldset.querySelector('[data-field="enabled"]').checked) return;
                const values = {};
                for (const field of ['basePrice', 'discountPercent', 'discountAmount', 'reason']) {
                    const input = fieldset.querySelector(`[data-field="${field}"]`);
                    if (field === 'basePrice' && input.value === '') throw new Error('Укажите цену для каждого включённого вида занятия');
                    values[field] = field === 'reason' ? input.value : Number(input.value);
                }
                lessonRates[fieldset.dataset.rate] = values;
            });
            const name = document.getElementById('rateCardName').value.trim();
            await api('/rate-card-preview', { lessonRates });
            const assigned = await api('/rate-card', {
                studentId: state.studentId, name, lessonRates,
                expectedActiveIds: state.memberships.filter(m => m.status === 'active').map(m => m.id || m._id),
                replaceMembershipId: state.replaceMembershipId,
            });
            if (document.getElementById('rateCardSaveTemplate').checked) {
                try { await api('/rate-card-catalog', { name, lessonRates }); }
                catch (error) { toast.warning(`Тариф подключён; шаблон не сохранён: ${error.message}`); }
            }
            state = null;
            document.getElementById('rateCardModal').classList.remove('show');
            toast.success('Тариф подключён. Денежный баланс сохранён.');
            if (typeof viewStudent === 'function') await viewStudent(assigned.membership.studentId);
        } catch (error) { status.textContent = error.message; }
        finally { saving = false; button.disabled = false; }
    }

    window.openRateCardModal = async (studentId, membershipId = null) => {
        if (saving) return;
        if (!studentId) { toast.warning('Выберите ученика'); return; }
        const modal = ensureModal();
        const otherModals = [...document.querySelectorAll('.modal.show')].filter(item => item !== modal);
        modal.style.zIndex = String(Math.max(10000, ...otherModals.map(item => Number(getComputedStyle(item).zIndex) || 0)) + 10);
        const version = ++requestVersion;
        state = null;
        modal.classList.add('show');
        modal.querySelector('.modal-content').scrollTop = 0;
        document.getElementById('rateCardForm').hidden = true;
        document.getElementById('rateCardStatus').textContent = 'Загрузка расценок...';
        try {
            const [catalog, student] = await Promise.all([api('/rate-card-catalog'), api(`/student/${encodeURIComponent(studentId)}`)]);
            if (version !== requestVersion) return;
            const memberships = student.memberships || [];
            const cards = memberships.filter(m => m.billingModel === 'rate_card' && m.status === 'active');
            const selected = cards.find(m => (m.id || m._id) === membershipId) || cards[0];
            state = { studentId, memberships, plans: catalog.plans, replaceMembershipId: selected?.id || null };
            document.getElementById('rateCardTemplate').innerHTML = '<option value="">Персональные расценки</option>'
                + catalog.plans.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
            document.getElementById('rateCardName').value = selected?.tariffName || 'Персональный тариф';
            document.getElementById('rateCardSaveTemplate').checked = false;
            const combined = {};
            for (const card of cards) Object.assign(combined, card.lessonRates || {});
            drawRates(selected?.lessonRates || combined);
            const active = memberships.filter(m => m.status === 'active');
            document.getElementById('rateCardReplaced').textContent = active.length
                ? `Подключение заменит активные абонементы (${active.length}). Проверьте все нужные виды занятий. Деньги и история сохраняются.`
                : 'Подключение тарифа не пополняет и не списывает деньги.';
            document.getElementById('rateCardStatus').textContent = '';
            document.getElementById('rateCardForm').hidden = false;
            document.getElementById('rateCardName').focus();
        } catch (error) { document.getElementById('rateCardStatus').textContent = error.message; }
    };

    window.renderRateCardSummary = membership => {
        const rows = Object.entries(membership.lessonRates || {}).map(([kind, row]) =>
            `<tr><td style="padding:8px">${esc(labels[kind] || kind)}</td><td style="padding:8px;text-align:right">${money(row.price)} ₸${row.price !== row.basePrice ? `<br><small>вместо ${money(row.basePrice)} ₸</small>` : ''}</td></tr>`).join('');
        return `<h3>${esc(membership.tariffName || 'Тариф ученика')}</h3><p>Бессрочно · без лимита занятий</p>
            <table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left">Занятие</th><th style="text-align:right">Списание за урок</th></tr></thead><tbody>${rows}</tbody></table>
            <button type="button" class="btn-primary" onclick="openRateCardModal('${esc(membership.studentId)}','${esc(membership.id || membership._id)}')">Изменить расценки</button>`;
    };
})();
