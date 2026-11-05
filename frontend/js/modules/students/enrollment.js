// One server-owned enrollment; no payment intent or password is persisted in browser storage.
(() => {
    const h = v => String(v ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
    const fio = s => [s.lastName, s.name || s.firstName, s.middleName].filter(Boolean).join(' ');
    const money = n => `${Number(n || 0).toLocaleString('ru-RU')} ₸`;
    const date = d => d ? new Date(d).toLocaleDateString('ru-RU') : '—';
    const labels = { individual: 'Индивидуальный', duo: 'Дуо', trio: 'Трио', quartet: 'Квартет', theory: 'Теория' };
    let state, step, root, busy = false, parentPreview = null, openVersion = 0;
    async function api(path, body, method = body ? 'POST' : 'GET') {
        const response = await fetch(`${API_URL}${path}`, { method, headers: { Authorization: `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' },
            ...(body ? { body: JSON.stringify(body) } : {}) });
        const data = await response.json();
        if (!response.ok || data.success === false) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || 'Не удалось выполнить действие');
        return data;
    }
    const endpoint = suffix => `/enrollments/${state.id}${suffix}`;
    function shell(title) {
        document.getElementById('enrollmentModal')?.remove();
        root = document.createElement('div'); root.id = 'enrollmentModal'; root.className = 'modal show enrollment-modal';
        root.innerHTML = `<div class="modal-overlay" data-close></div><section class="modal-content enrollment-dialog" role="dialog" aria-modal="true" aria-labelledby="enrollmentTitle"><header><div><p class="enrollment-eyebrow">ОФОРМЛЕНИЕ УЧЕНИКА</p><h2 id="enrollmentTitle">${h(title)}</h2></div><button type="button" class="admin-btn btn-secondary" data-close aria-label="Закрыть оформление">×</button></header><div class="enrollment-error" role="alert" hidden></div><div id="enrollmentContent">Загрузка…</div></section>`;
        document.body.append(root);
        root.querySelectorAll('[data-close]').forEach(el => el.onclick = () => { if (!busy) root.remove(); });
        root.addEventListener('keydown', e => {
            if (e.key === 'Escape' && !busy) { e.stopPropagation(); root.remove(); }
            if (e.key === 'Tab') {
                const items = [...root.querySelectorAll('button:not(:disabled),input,select,textarea,a[href]')].filter(el => el.offsetParent !== null);
                if (e.shiftKey && document.activeElement === items[0]) { items.at(-1)?.focus(); e.preventDefault(); }
                if (!e.shiftKey && document.activeElement === items.at(-1)) { items[0]?.focus(); e.preventDefault(); }
            }
        });
        root.querySelector('button[data-close]').focus();
    }
    function error(message) { const box = root?.querySelector('.enrollment-error'); if (box) { box.textContent = message; box.hidden = false; } }
    async function action(fn, refresh = true) {
        if (busy) return;
        busy = true;
        root.querySelector('.enrollment-error').hidden = true;
        const controls = [...root.querySelectorAll('button,input,select,textarea')].filter(el => !el.disabled);
        controls.forEach(el => el.disabled = true);
        try { await fn(); if (refresh) await reload(); }
        catch (err) { error(err.message); }
        finally { busy = false; controls.filter(el => el.isConnected).forEach(el => el.disabled = false); }
    }
    async function reload() {
        state = (await api(endpoint(''))).enrollment;
        render();
    }
    const field = (name, label, value = '', type = 'text', attrs = '') => `<label class="enrollment-field">${h(label)}<input class="admin-input" name="${name}" type="${type}" value="${h(value)}" ${attrs}></label>`;
    const button = (name, text, primary = false) => `<button type="button" class="admin-btn ${primary ? 'btn-primary' : 'btn-secondary'}" data-action="${name}">${h(text)}</button>`;
    function render() {
        const target = root.querySelector('#enrollmentContent');
        if (!state) return;
        step ||= state.nextStep || (state.remainingAmount > 0 ? 'payment' : 'summary');
        target.innerHTML = `<nav class="enrollment-steps" aria-label="Шаги оформления">${state.steps.map((s, i) => `<button type="button" data-step="${s.key}" class="${step === s.key ? 'is-current' : ''} ${s.ready ? 'is-complete' : ''}" ${step === s.key ? 'aria-current="step"' : ''}><span class="enrollment-step-number" aria-hidden="true">${s.ready ? '✓' : i + 1}</span><span>${h(s.label)}${s.ready ? '<span class="sr-only"> — выполнено</span>' : ''}</span></button>`).join('')}<button type="button" data-step="summary" class="${step === 'summary' ? 'is-current' : ''}" ${step === 'summary' ? 'aria-current="step"' : ''}><span class="enrollment-step-number" aria-hidden="true">${state.steps.length + 1}</span><span>Итог оформления</span></button></nav><p class="enrollment-saving">Сохранённые шаги доступны другим администраторам. Несохранённые поля нужно сохранить перед переходом.</p><div id="enrollmentStep"></div>`;
        const stepsNav = target.querySelector('.enrollment-steps');
        const currentStep = stepsNav.querySelector('[aria-current="step"]');
        if (currentStep && stepsNav.scrollWidth > stepsNav.clientWidth) {
            stepsNav.scrollLeft += currentStep.getBoundingClientRect().left - stepsNav.getBoundingClientRect().left;
        }
        target.querySelectorAll('[data-step]').forEach(el => el.onclick = () => { step = el.dataset.step; parentPreview = null; render(); });
        const pane = target.querySelector('#enrollmentStep');
        if (step === 'details') details(pane);
        else if (step === 'terms') terms(pane);
        else if (step === 'documents') documents(pane);
        else if (step === 'payment') payment(pane);
        else if (step === 'schedule') schedule(pane);
        else if (step === 'access') accounts(pane);
        else summary(pane);
        pane.querySelectorAll('[data-action]').forEach(el => el.onclick = () => dispatch(el.dataset.action));
    }
    function details(pane) {
        const c = state.customer || {}, s = state.student, self = state.minor === false;
        pane.innerHTML = `<h3>Ученик и заказчик</h3><p>${h(fio(s))} · Дата рождения: ${date(s.dateOfBirth)} · Контакт: ${h(s.phone)}</p>${button('profile', 'Исправить данные ученика')}<p>${self ? 'Заказчик — сам ученик. Фактический плательщик может быть другим человеком.' : 'Телефон ребёнка не обязателен: контакт семьи не объединяет кабинеты.'}</p><form id="enrollmentCustomer"><div class="enrollment-fields">${field('fullName', 'ФИО заказчика', c.fullName || (self ? fio(s) : s.customerName || ''), 'text', self ? 'readonly' : 'required maxlength="250"')}${field('iin', 'ИИН заказчика', c.iin, 'text', 'required pattern="[0-9]{12}" maxlength="12" inputmode="numeric"')}${field('phone', 'Телефон заказчика', c.phone || s.phone, 'tel', 'required')}${field('address', 'Адрес заказчика', c.address, 'text', 'required maxlength="500"')}${!self ? `<label class="enrollment-field">Отношение к ученику<select class="admin-input" name="relationship"><option value="mother" ${c.relationship === 'mother' ? 'selected' : ''}>Мать</option><option value="father" ${c.relationship === 'father' ? 'selected' : ''}>Отец</option><option value="guardian" ${c.relationship === 'guardian' ? 'selected' : ''}>Законный представитель</option></select></label>${field('representation', 'Основание представительства', c.representation || '', 'text', 'required placeholder="Родитель / документ о представительстве"')}` : ''}</div><button class="admin-btn btn-primary" type="submit">Сохранить заказчика и продолжить</button></form>`;
        pane.querySelector('form').onsubmit = event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.target)); action(async () => {
            await api(endpoint(''), { revision: state.revision, customer: { ...values, type: self ? 'self' : 'representative' } }, 'PUT'); step = 'terms';
        }); };
    }
    function terms(pane) {
        const t = state.terms || {};
        pane.innerHTML = `<h3>Первый абонемент</h3><p>Введите согласованные условия. Этот процесс не заменяет действующий тариф и не переносит старый остаток автоматически.</p><form id="enrollmentTerms"><div class="enrollment-fields">${field('name', 'Название тарифа', t.name, 'text', 'required maxlength="150"')}${field('direction', 'Направление(я) обучения', t.direction || state.student.learningDirections?.join(', '), 'text', 'required')}${field('days', 'Общий срок использования, дней', t.days, 'number', 'required min="1" max="730" step="1"')}${field('totalPrice', 'Стоимость абонемента, ₸', t.totalPrice, 'number', 'required min="1" step="1"')}${field('firstPayment', 'Согласованный первый платёж, ₸ (не менее 50%)', t.firstPayment, 'number', 'required min="1" step="1"')}${field('emergencyCancellations', 'Экстренных отмен на абонемент', t.emergencyCancellations, 'number', 'required min="0" max="100" step="1"')}${field('documentDate', 'Дата договора', t.documentDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Aqtobe' }).format(new Date()), 'date', 'required')}</div><fieldset><legend>Форматы занятий</legend>${Object.entries(labels).map(([kind, label]) => `<div class="enrollment-rate"><label><input type="checkbox" name="format_${kind}" ${t.rates?.[kind] ? 'checked' : ''}> ${label}</label>${field(`price_${kind}`, 'Цена за урок, ₸', t.rates?.[kind]?.price, 'number', 'min="0" max="1000000" step="1"')}${field(`duration_${kind}`, 'Длительность, минут', t.durations?.[kind], 'number', 'min="15" max="240" step="1"')}</div>`).join('')}</fieldset>${field('scheduleText', 'Согласованное расписание для приложения (формат, дни и время)', t.scheduleText, 'text', 'required maxlength="1000"')}${field('additionalTerms', 'Дополнительные согласованные условия', t.additionalTerms, 'text', 'maxlength="1000"')}<button class="admin-btn btn-primary" type="submit">Сохранить условия и продолжить</button></form>`;
        pane.querySelector('form').onsubmit = event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.target)), rates = {}, durations = {};
            for (const kind of Object.keys(labels)) if (values[`format_${kind}`]) { if (values[`price_${kind}`] === '' || values[`duration_${kind}`] === '') { error(`Укажите цену и длительность: ${labels[kind]}`); return; } rates[kind] = { basePrice: Number(values[`price_${kind}`]), reason: Number(values[`price_${kind}`]) === 0 ? 'Бесплатный формат по подписанному приложению' : '' }; durations[kind] = Number(values[`duration_${kind}`]); }
            action(async () => { await api(endpoint(''), { revision: state.revision, documentDate: values.documentDate, terms: {
                ...values, days: Number(values.days), totalPrice: Number(values.totalPrice), firstPayment: Number(values.firstPayment),
                emergencyCancellations: Number(values.emergencyCancellations), rates, durations,
            } }, 'PUT'); step = 'documents'; });
        };
    }
    function documents(pane) {
        const doc = state.documents.find(d => d.revision === state.revision);
        pane.innerHTML = `<h3>Документы</h3><p>Комплект на русском и казахском: договор, приложение и согласие. Печать не означает подпись. Необязательные согласия заказчик отмечает на бумаге.</p>${doc ? `<p>Договор М-${doc.number}. Подготовлен ${date(doc.createdAt)}. ${doc.printedAt ? `Печать отмечена ${date(doc.printedAt)}.` : 'Печать ещё не отмечена.'}</p><div class="enrollment-actions">${button('print', 'Открыть сохранённый комплект', true)}${button('printedAt', 'Отметить распечатанным')}<button type="button" class="admin-btn btn-secondary" data-scans="${h(doc.id)}">Сканы подписанных документов</button></div><div class="enrollment-signatures">${[['contractSignedAt', 'Договор'], ['appendixSignedAt', 'Приложение'], ['consentSignedAt', 'Согласие на обработку данных']].map(([key, label]) => `<div><span>${label}: ${doc[key] ? `подписан ${date(doc[key])}` : 'подпись не отмечена'}</span>${!doc[key] ? button(key, 'Заказчик подписал') : ''}</div>`).join('')}</div>` : button('prepare-documents', 'Подготовить комплект', true)}${state.documents.some(d => d.id !== doc?.id) ? `<details><summary>Предыдущие экземпляры</summary>${state.documents.filter(d => d.id !== doc?.id).map(d => `<p><button type="button" class="admin-btn btn-secondary" data-document="${h(d.id)}">М-${d.number} · ${date(d.createdAt)}</button> <button type="button" class="admin-btn btn-secondary" data-scans="${h(d.id)}">Сканы</button></p>`).join('')}</details>` : ''}`;
        pane.querySelectorAll('[data-scans]').forEach(el => el.onclick = () => window.openDocumentScans('enrollment', el.dataset.scans));
        pane.querySelectorAll('[data-document]').forEach(el => el.onclick = () => printDocument(el.dataset.document));
    }
    function payment(pane) {
        const pending = state.paymentIntents.find(i => !i.paymentId && !i.cancelledAt);
        pane.innerHTML = `<h3>Зафиксировать полученную оплату</h3><p>Стоимость: ${money(state.terms?.totalPrice)} · Получено по оформлению: ${money(state.paidAmount)} · Доплатить: ${money(state.remainingAmount)}</p><p>Указывается уже полученная сумма. Это запись в CRM, а не подтверждение банка или фискальный чек.</p>${pending ? `<div class="enrollment-notice"><h4>Общий черновик оплаты</h4><p>${money(pending.payload.amount)} · ${h(pending.payload.paymentMethod)} · ${date(pending.payload.paymentDate)}</p><p>Плательщик: ${h(pending.payload.payer)}. ${h(pending.payload.notes)}</p><div class="enrollment-actions">${button('confirm-payment', 'Подтвердить полученные деньги', true)}${button('cancel-payment', 'Отменить черновик')}</div></div>` : `<form id="enrollmentPayment"><div class="enrollment-fields">${field('amount', 'Фактически получено, ₸', '', 'number', 'required min="1" step="1"')}<label class="enrollment-field">Счёт получения<select name="paymentMethod" class="admin-input"><option value="cash">Наличные</option><option value="kaspi_pay">КаспиПей</option><option value="freedom">Фридом</option><option value="halyk">Халык Банк</option></select></label>${field('paymentDate', 'Дата и время получения', new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16), 'datetime-local', 'required')}${field('payer', 'Фактический плательщик', state.customer?.fullName, 'text', 'required')}${field('notes', 'Комментарий')}</div><button type="submit" class="admin-btn btn-primary">Подготовить запись оплаты</button></form>`}<div class="enrollment-history">${state.paymentIntents.filter(i => i.paymentId).map(i => `<p>${i.payment?.status === 'completed' ? '✓' : '○'} Оплата ${money(i.payment?.amount ?? i.payload.amount)}${i.payment?.status !== 'completed' ? ' (отменена / возвращена)' : ''} · ${date(i.payload.paymentDate)} · № ${h(i.paymentId)}</p>`).join('')}</div>${state.membership ? `<p>Период запущен: ${date(state.membership.validFrom)} — ${date(state.membership.validUntil)}.</p>${state.remainingAmount > 0 ? `<p class="enrollment-notice">Доплата ${money(state.remainingAmount)} — до окончания второго учитываемого урока. Учтено платных уроков: ${state.countedLessons}.</p>` : ''}` : `<p>После подписания договора и поступления согласованного первого платежа запустите период. Срок в днях отсчитывается со следующего дня после оплаты.</p>${button('activate', 'Запустить первый период', true)}`}`;
        pane.querySelector('form')?.addEventListener('submit', event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.target)); action(async () => api(endpoint('/payment-intents'), { ...values, amount: Number(values.amount), paymentDate: new Date(values.paymentDate).toISOString() })); });
    }
    function schedule(pane) {
        pane.innerHTML = `<h3>Первый урок</h3><p>${state.nextLesson ? `${h(state.nextLesson.title)} · ${date(state.nextLesson.date)} в ${h(state.nextLesson.startTime)} · ${state.nextLesson.duration} мин · ${state.nextLesson.teacher ? h(fio(state.nextLesson.teacher)) : 'Педагог не назначен'}` : 'Будущий урок в календаре пока не найден.'}</p><p>Настройте группу или индивидуальное расписание в карточке. После сохранения вернитесь кнопкой «Продолжить оформление» и проверьте фактически созданный урок.</p><div class="enrollment-actions">${button('schedule', 'Открыть расписание ученика', true)}${button('refresh', 'Проверить первый урок')}</div>${!state.steps.find(s => s.key === 'schedule').ready ? '<p class="enrollment-notice">Для готовности нужны действующий тариф с подписанными расценками, согласованная длительность и назначенный преподаватель у первого урока в пределах срока.</p>' : ''}`;
    }
    function accounts(pane) {
        pane.innerHTML = '<h3>Кабинеты ученика и родителя</h3><p id="enrollmentAccessLoading">Проверяем Платформу…</p>';
        api(endpoint('/access')).then(({ data }) => {
            if (step !== 'access' || !pane.isConnected) return;
            const student = data.student, parent = data.parents.find(p => p.id === state.parentUserId);
            pane.innerHTML = `<h3>Кабинеты семьи</h3><p>Кабинеты и пароли отдельные. Данные доступа передаются лично администратором; автоматической рассылки здесь нет.</p><section class="enrollment-account"><h4>Ученик</h4>${student ? `<p>Логин: <code>${h(student.login)}</code> · ${student.isActive ? 'Доступ действует' : 'Доступ отключён'}</p>${state.student.appUserId !== student.id || state.student.externalLinkStatus !== 'linked' ? button('repair-student-link', 'Восстановить связь с кабинетом') : state.studentHandedAt ? `<p>Передача доступа отмечена ${date(state.studentHandedAt)}</p>` : button('handover-student', 'Доступ ученику передан')}` : `<form id="enrollmentStudentAccess">${field('password', 'Отдельный пароль ученика', '', 'password', 'required minlength="8" maxlength="72" autocomplete="new-password"')}<button type="submit" class="admin-btn btn-primary">Создать кабинет ученика</button></form>`}</section>${state.minor ? `<section class="enrollment-account"><h4>Родитель / законный представитель</h4>${parent ? `<p>${h(fio(parent))} · Логин: <code>${h(parent.login)}</code></p>${state.parentHandedAt ? `<p>Передача доступа отмечена ${date(state.parentHandedAt)}</p>` : button('handover-parent', 'Доступ родителю передан')}` : `<form id="enrollmentParentAccess"><label class="enrollment-field">Кабинет родителя<select class="admin-input" name="mode"><option value="create">Создать новый</option><option value="link">Связать существующий (например, второй ребёнок)</option></select></label>${field('login', 'Логин родителя', '', 'text', 'required minlength="3" maxlength="32" autocomplete="off"')}<div data-new-parent><div class="enrollment-fields">${field('lastName', 'Фамилия родителя', '', 'text', 'required')}${field('firstName', 'Имя родителя', '', 'text', 'required')}${field('middleName', 'Отчество родителя')}${field('phone', 'Телефон родителя', state.customer?.phone, 'tel')}${field('password', 'Отдельный пароль родителя', '', 'password', 'minlength="8" maxlength="72" autocomplete="new-password"')}</div></div><div data-existing-parent hidden>${button('preview-parent', 'Найти по логину')}<p id="enrollmentParentPreview"></p></div><label class="enrollment-check"><input type="checkbox" name="identityVerified" required> Личность и право представительства проверены, доступ выдаётся этому человеку</label><button type="submit" class="admin-btn btn-primary">Подтвердить кабинет родителя</button></form>`}</section>` : '<p>Для совершеннолетнего ученика родительский кабинет не создаётся.</p>'}<p>Первый вход не подтверждается созданием кабинета или отметкой передачи.</p>`;
            pane.querySelectorAll('[data-action]').forEach(el => el.onclick = () => dispatch(el.dataset.action));
            pane.querySelector('#enrollmentStudentAccess')?.addEventListener('submit', event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.target)); action(async () => { const result = await api(endpoint('/access/student'), values); toast.success(result.data.created ? 'Кабинет создан с указанным паролем. Передайте его ученику.' : 'Кабинет уже существует. Его пароль не изменён.'); }); });
            const form = pane.querySelector('#enrollmentParentAccess');
            if (form) {
                form.elements.mode.onchange = () => { parentPreview = null; form.querySelector('[data-new-parent]').hidden = form.elements.mode.value !== 'create'; form.querySelectorAll('[data-new-parent] input').forEach(input => input.disabled = form.elements.mode.value !== 'create'); form.querySelector('[data-existing-parent]').hidden = form.elements.mode.value !== 'link'; };
                form.elements.login.oninput = () => { parentPreview = null; form.querySelector('#enrollmentParentPreview').textContent = ''; };
                form.onsubmit = event => { event.preventDefault(); const values = Object.fromEntries(new FormData(form)); action(async () => {
                    if (values.mode === 'link' && !parentPreview) throw new Error('Сначала найдите родителя и проверьте ФИО и телефон.');
                    const body = { mode: values.mode, login: values.login, identityVerified: true, ...(values.mode === 'link' ? { parentUserId: parentPreview.id } : { firstName: values.firstName, lastName: values.lastName, middleName: values.middleName, phone: values.phone, password: values.password }) };
                    const result = await api(endpoint('/access/parent'), body);
                    toast.success(result.data.created ? 'Кабинет родителя создан с указанным паролем.' : 'Родитель связан. Существующий пароль не изменён.');
                }); };
            }
        }).catch(err => { const loading = pane.querySelector('#enrollmentAccessLoading'); if (pane.isConnected && loading) loading.textContent = err.message; });
    }
    function summary(pane) {
        pane.innerHTML = `<h3>${state.completedAt ? 'Оформление завершено' : 'Проверка оформления'}</h3><ul>${state.steps.map(s => `<li>${s.ready ? '✓' : '○'} ${h(s.label)}</li>`).join('')}</ul><p>Готовность к первому уроку: ${state.readyForLesson ? 'готов' : 'есть незавершённые шаги'}.</p><p>Получено: ${money(state.paidAmount)}. Осталось доплатить: ${money(state.remainingAmount)}.</p>${state.membership ? `<p>${h(state.membership.name)} · Период: ${date(state.membership.validFrom)} — ${date(state.membership.validUntil)}</p>` : ''}${state.nextLesson ? `<p>Первый урок: ${date(state.nextLesson.date)} в ${h(state.nextLesson.startTime)} · ${state.nextLesson.duration} мин · ${state.nextLesson.teacher ? h(fio(state.nextLesson.teacher)) : 'Педагог не назначен'}</p>` : ''}${state.complete && !state.completedAt ? button('complete', 'Завершить оформление', true) : state.nextStep ? button('next', 'Продолжить с незавершённого шага', true) : ''}${button('refresh', 'Обновить проверку')}`;
    }
    async function printDocument(id) {
        // Opening happens directly on the user gesture so popup blockers do not lose the document.
        const tab = window.open('', '_blank');
        if (!tab) { error('Разрешите открытие окна с документами в браузере.'); return; }
        tab.opener = null;
        try {
            const response = await fetch(`${API_URL}${endpoint(`/documents/${id}`)}`, { headers: { Authorization: `Bearer ${getAuthToken()}` } });
            if (!response.ok) throw new Error('Не удалось открыть сохранённый комплект');
            tab.document.open(); tab.document.write(await response.text()); tab.document.close(); tab.focus(); tab.print();
        } catch (err) { tab.close(); error(err.message); }
    }
    function dispatch(name) {
        if (name === 'next') { step = state.nextStep || 'summary'; render(); return; }
        if (name === 'profile' || name === 'schedule') {
            const studentId = state.studentId; root.remove();
            viewStudent(studentId).then(() => window.switchStudentDetailTab(name === 'schedule' ? 'education' : 'profile')); return;
        }
        if (name === 'print') { printDocument(state.documents.find(d => d.revision === state.revision).id); return; }
        action(async () => {
            const doc = state.documents.find(d => d.revision === state.revision);
            if (name === 'refresh') return;
            if (name === 'prepare-documents') await api(endpoint('/documents'), { revision: state.revision });
            else if (['printedAt', 'contractSignedAt', 'appendixSignedAt', 'consentSignedAt'].includes(name)) {
                await api(endpoint(`/documents/${doc.id}/status`), { field: name, confirmed: true });
            } else if (name === 'confirm-payment' || name === 'cancel-payment') {
                const pending = state.paymentIntents.find(i => !i.paymentId && !i.cancelledAt);
                await api(endpoint(`/payment-intents/${pending.id}/${name === 'confirm-payment' ? 'confirm' : 'cancel'}`), {});
            } else if (name === 'repair-student-link') await api(endpoint('/access/student-link'), {});
            else if (name === 'activate') await api(endpoint('/activate'), {});
            else if (name === 'preview-parent') {
                const form = root.querySelector('#enrollmentParentAccess');
                parentPreview = (await api(endpoint('/access/parent-preview'), { login: form.elements.login.value })).data;
                form.querySelector('#enrollmentParentPreview').textContent = `${fio(parentPreview)} · ${parentPreview.phone} · ${parentPreview.login}`;
            } else if (name.startsWith('handover-')) await api(endpoint('/handover'), { kind: name.slice(9), confirmed: true });
            else if (name === 'complete') await api(endpoint('/complete'), {});
        }, name !== 'preview-parent');
    }
    window.openStudentEnrollment = async studentId => {
        if (busy) return;
        const version = ++openVersion; shell('Оформление'); state = null; step = null;
        try {
            const result = await api('/enrollments/start', { studentId });
            if (version !== openVersion || !root.isConnected) return;
            state = result.enrollment;
            root.querySelector('#enrollmentTitle').textContent = fio(state.student); render();
        } catch (err) { error(err.message); }
    };
    window.openEnrollmentQueue = async () => {
        if (busy) return;
        const version = ++openVersion; shell('Оформления и доплаты'); state = null; step = null;
        try {
            const [{ enrollments }, { rows }] = await Promise.all([api('/enrollments'), api('/subscription-periods/attention')]);
            if (version !== openVersion || !root.isConnected) return;
            root.querySelector('#enrollmentContent').innerHTML = enrollments.length ? `<div class="enrollment-queue">${enrollments.map(e => `<button type="button" data-student="${h(e.studentId)}"><span>${h(fio(e.student))}</span><small>${h(e.nextStep)}</small></button>`).join('')}</div>` : '<p>Незавершённых оформлений нет. Откройте карточку ученика и нажмите «Продолжить оформление».</p>';
            root.querySelector('#enrollmentContent').insertAdjacentHTML('beforeend', `<h3>Контроль абонементов</h3><p>CRM показывает сроки и задолженность. Продление, приостановка и снятие с расписания выполняются администратором.</p><div class="enrollment-queue">${rows.map(row => `<button type="button" data-period-student="${h(row.student.id)}"><span>${h(fio(row.student))}</span><small>${row.messages.map(h).join(' ')}</small></button>`).join('') || '<p>Нет задач по доплатам и срокам.</p>'}</div>`);
            root.querySelectorAll('[data-period-student]').forEach(el => el.onclick = () => { root.remove(); window.openStudentPeriods(el.dataset.periodStudent); });
            root.querySelectorAll('[data-student]').forEach(el => el.onclick = () => window.openStudentEnrollment(el.dataset.student));
        } catch (err) { error(err.message); }
    };
})();
