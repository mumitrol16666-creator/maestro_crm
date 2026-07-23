// Печатные документы карточки ученика.
(() => {
    const state = {
        type: 'attendance',
        payload: null,
        requestId: 0,
    };

    const byId = id => document.getElementById(id);
    const html = value => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    const money = value => `${Math.round(Number(value) || 0).toLocaleString('ru-RU').replace(/\u00a0/g, ' ')} ₸`;
    const dateValue = value => {
        if (!value) return '—';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('ru-RU');
    };
    const shortDate = value => {
        if (!value) return '—';
        const date = new Date(value);
        return Number.isNaN(date.getTime())
            ? '—'
            : date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };
    const studentName = student => [student?.lastName, student?.name, student?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || 'Ученик';
    const personName = person => [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || '—';

    function todayInputValue() {
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000;
        return new Date(now.getTime() - offset).toISOString().slice(0, 10);
    }

    function firstDayOfMonthInputValue() {
        const now = new Date();
        const local = new Date(now.getFullYear(), now.getMonth(), 1);
        const offset = local.getTimezoneOffset() * 60000;
        return new Date(local.getTime() - offset).toISOString().slice(0, 10);
    }

    function periodText(range) {
        if (!range) return '';
        return `${dateValue(range.from)} — ${dateValue(range.to)}`;
    }

    function brandName() {
        return window.MAESTRO_BRAND?.fullName || 'Музыкальная школа Maestro';
    }

    function documentShell(title, subtitle, body) {
        const payload = state.payload || {};
        const student = payload.student || {};
        const generatedAt = payload.generatedAt ? new Date(payload.generatedAt) : new Date();
        const generatedText = generatedAt.toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });

        return `
            <article class="student-print-sheet" data-student-document="${html(state.type)}">
                <header class="student-print-sheet__header">
                    <div class="student-print-brand">
                        <span class="student-print-brand__mark">M</span>
                        <div>
                            <strong>MAESTRO</strong>
                            <span>${html(brandName())}</span>
                        </div>
                    </div>
                    <div class="student-print-sheet__document">
                        <span>Документ</span>
                        <strong>${html(title)}</strong>
                    </div>
                </header>
                <section class="student-print-sheet__student">
                    <span>Ученик</span>
                    <h1>${html(studentName(student))}</h1>
                    <p>${html(subtitle)}</p>
                </section>
                ${body}
                <footer class="student-print-sheet__footer">
                    <span>${html(brandName())}</span>
                    <span>Сформировано ${html(generatedText)}</span>
                </footer>
            </article>
        `;
    }

    function attendanceStatus(status) {
        const statuses = {
            present: { label: 'Присутствовал', className: 'is-good' },
            late: { label: 'Опоздал', className: 'is-warning' },
            excused_absence: { label: 'Уважительный пропуск', className: 'is-info' },
            unexcused_absence: { label: 'Прогул', className: 'is-danger' },
            emergency_freeze: { label: 'Заморозка', className: 'is-freeze' },
            unmarked: { label: 'Не отмечено', className: 'is-muted' },
        };
        return statuses[status] || statuses.unmarked;
    }

    function classTypeLabel(type) {
        return {
            individual: 'Индивидуальный',
            group: 'Групповой',
            trial: 'Пробный',
            theory: 'Теория',
        }[type] || 'Урок';
    }

    function renderAttendanceDocument() {
        const attendance = state.payload?.attendance || {};
        const summary = attendance.summary || {};
        const records = attendance.records || [];
        const rows = records.length
            ? records.map(record => {
                const status = attendanceStatus(record.attendanceStatus);
                const context = [
                    classTypeLabel(record.classType),
                    record.groupName,
                    record.roomName,
                ].filter(Boolean).join(' · ');
                return `
                    <tr>
                        <td>
                            <strong>${html(shortDate(record.date))}</strong>
                            <span>${html([record.startTime, record.endTime].filter(Boolean).join('–') || '—')}</span>
                        </td>
                        <td>
                            <strong>${html(record.title || 'Занятие')}</strong>
                            <span>${html(context || 'Урок')}</span>
                        </td>
                        <td>${html(record.teacherName || '—')}</td>
                        <td><span class="student-print-status ${status.className}">${html(status.label)}</span></td>
                        <td class="is-money">${record.chargeAmount > 0 ? html(money(record.chargeAmount)) : '—'}</td>
                    </tr>
                `;
            }).join('')
            : '<tr><td colspan="5" class="student-print-table__empty">За выбранный период занятий нет</td></tr>';

        return documentShell(
            'Посещаемость',
            `Период: ${periodText(state.payload?.range)}`,
            `
                <section class="student-print-summary">
                    <div><span>Всего занятий</span><strong>${Number(summary.totalClasses || 0)}</strong></div>
                    <div><span>Посещено</span><strong>${Number(summary.attendedCount || 0)}</strong></div>
                    <div><span>Пропущено</span><strong>${Number(summary.missedCount || 0)}</strong></div>
                    <div class="is-accent"><span>Посещаемость</span><strong>${Number(summary.attendanceRate || 0)}%</strong></div>
                </section>
                <section class="student-print-breakdown">
                    <span>Вовремя: <strong>${Number(summary.presentCount || 0)}</strong></span>
                    <span>Опоздания: <strong>${Number(summary.lateCount || 0)}</strong></span>
                    <span>Уважительные: <strong>${Number(summary.excusedCount || 0)}</strong></span>
                    <span>Прогулы: <strong>${Number(summary.unexcusedCount || 0)}</strong></span>
                    <span>Заморозки: <strong>${Number(summary.freezeCount || 0)}</strong></span>
                    ${summary.unmarkedCount ? `<span>Не отмечено: <strong>${Number(summary.unmarkedCount)}</strong></span>` : ''}
                </section>
                <section class="student-print-section">
                    <div class="student-print-section__head">
                        <h2>История занятий</h2>
                        <span>Списано за период: ${html(money(summary.chargedTotal || 0))}</span>
                    </div>
                    <table class="student-print-table student-print-table--attendance">
                        <thead><tr><th>Дата и время</th><th>Занятие</th><th>Преподаватель</th><th>Статус</th><th>Списание</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </section>
            `,
        );
    }

    function genderLabel(gender) {
        return gender === 'male' ? 'Мужской' : gender === 'female' ? 'Женский' : 'Не указан';
    }

    function statusLabel(student) {
        if (student?.status === 'active') return 'Активен';
        if (student?.lostAt) return 'Бывший ученик';
        return student?.pausedUntil
            ? `На паузе до ${dateValue(student.pausedUntil)}`
            : 'На паузе';
    }

    function departureReasonLabel(reason) {
        return {
            stopped: 'Забросил обучение',
            other_school: 'Перешёл в другую школу',
            moved: 'Переехал',
            schedule: 'Не подошло расписание',
            price: 'Не подошла стоимость',
            health: 'По состоянию здоровья',
            no_contact: 'Не выходит на связь',
            test_record: 'Тестовая карточка',
            other: 'Другая причина',
        }[reason] || 'Не указана';
    }

    function membershipName(membership) {
        return membership?.plan?.name || {
            monthly: 'Месячный',
            monthly_12: 'Месячный',
            quarterly: 'Квартальный',
            individual_single: 'Индивидуальный',
            individual_package: 'Индивидуальный пакет',
        }[membership?.type] || membership?.type || 'Абонемент';
    }

    function membershipFormat(membership) {
        return {
            individual: 'Индивидуально',
            group: 'Группа',
            mixed: 'Гибридный',
            trial: 'Пробный',
        }[membership?.lessonFormat] || '—';
    }

    function scheduleRows(student) {
        const dayNames = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
        const rows = [];
        (student.groups || []).forEach(link => {
            const group = link.group || {};
            (group.schedules || []).forEach(schedule => {
                rows.push({
                    dayOfWeek: Number(schedule.dayOfWeek || 0),
                    day: dayNames[schedule.dayOfWeek] || 'День',
                    time: schedule.time || '—',
                    duration: schedule.duration,
                    type: schedule.isPractice ? 'Практика' : `Группа «${group.name || 'Без названия'}»`,
                    teacher: personName(group.teacher || student.assignedTeacher),
                    room: schedule.room?.name || '—',
                });
            });
        });
        (student.schedules || []).forEach(schedule => {
            rows.push({
                dayOfWeek: Number(schedule.dayOfWeek || 0),
                day: dayNames[schedule.dayOfWeek] || 'День',
                time: schedule.time || '—',
                duration: schedule.duration,
                type: schedule.isPractice ? 'Практика' : 'Индивидуальное занятие',
                teacher: personName(schedule.teacher || student.assignedTeacher),
                room: schedule.room?.name || '—',
            });
        });
        return rows.sort((left, right) =>
            left.dayOfWeek - right.dayOfWeek || String(left.time).localeCompare(String(right.time), 'ru')
        );
    }

    function renderProfileDocument() {
        const student = state.payload?.student || {};
        const contacts = [
            { label: 'Основной', phone: student.phone },
            ...(student.additionalPhones || []).map(contact => ({
                label: contact.label || 'Дополнительный',
                phone: contact.phone,
            })),
        ];
        const memberships = student.memberships || [];
        const schedules = scheduleRows(student);
        const contactRows = contacts.map(contact => `
            <div class="student-print-contact">
                <span>${html(contact.label)}</span>
                <strong>${html(contact.phone || '—')}</strong>
            </div>
        `).join('');
        const membershipRows = memberships.length
            ? memberships.map(membership => `
                <tr>
                    <td><strong>${html(membershipName(membership))}</strong><span>${html(membershipFormat(membership))}</span></td>
                    <td>${html(membership.group?.name || 'Общий')}</td>
                    <td>${html(`${dateValue(membership.startDate)} — ${dateValue(membership.endDate)}`)}</td>
                    <td>${Number(membership.classesRemaining || 0)} / ${Number(membership.totalClasses || 0)}</td>
                    <td class="is-money">${html(money(membership.paidAmount || 0))}</td>
                </tr>
            `).join('')
            : '<tr><td colspan="5" class="student-print-table__empty">Активных абонементов нет</td></tr>';
        const scheduleTableRows = schedules.length
            ? schedules.map(schedule => `
                <tr>
                    <td><strong>${html(schedule.day)}</strong><span>${html(schedule.time)}</span></td>
                    <td>${html(schedule.type)}</td>
                    <td>${html(schedule.teacher)}</td>
                    <td>${html(schedule.room)}</td>
                    <td>${Number(schedule.duration || 0)} мин</td>
                </tr>
            `).join('')
            : '<tr><td colspan="5" class="student-print-table__empty">Регулярное расписание не задано</td></tr>';

        return documentShell(
            'Карточка ученика',
            `Дата регистрации: ${dateValue(student.registeredAt)}`,
            `
                <section class="student-print-profile-grid">
                    <div class="student-print-profile-block">
                        <h2>Личные данные</h2>
                        <dl>
                            <div><dt>Дата рождения</dt><dd>${html(dateValue(student.dateOfBirth))}</dd></div>
                            <div><dt>Пол</dt><dd>${html(genderLabel(student.gender))}</dd></div>
                            <div><dt>Статус</dt><dd>${html(statusLabel(student))}</dd></div>
                            <div><dt>Заказчик / родитель</dt><dd>${html(student.customerName || 'Не указан')}</dd></div>
                            ${student.lostAt ? `<div><dt>Причина ухода</dt><dd>${html(departureReasonLabel(student.lostReason))}</dd></div>` : ''}
                        </dl>
                    </div>
                    <div class="student-print-profile-block">
                        <h2>Обучение</h2>
                        <dl>
                            <div><dt>Направления</dt><dd>${html((student.learningDirections || []).join(', ') || 'Не указаны')}</dd></div>
                            <div><dt>Уровень</dt><dd>${html(student.learningLevel || 'Не указан')}</dd></div>
                            <div><dt>Основной педагог</dt><dd>${html(personName(student.assignedTeacher))}</dd></div>
                            <div><dt>Текущий баланс</dt><dd>${html(money(student.accountBalance || 0))}</dd></div>
                        </dl>
                    </div>
                    <div class="student-print-profile-block is-wide">
                        <h2>Контакты</h2>
                        <div class="student-print-contacts">${contactRows}</div>
                    </div>
                </section>
                <section class="student-print-section">
                    <div class="student-print-section__head"><h2>Активные абонементы</h2><span>${memberships.length}</span></div>
                    <table class="student-print-table">
                        <thead><tr><th>Абонемент</th><th>Группа</th><th>Период</th><th>Остаток</th><th>Оплачено</th></tr></thead>
                        <tbody>${membershipRows}</tbody>
                    </table>
                </section>
                <section class="student-print-section">
                    <div class="student-print-section__head"><h2>Регулярное расписание</h2><span>${schedules.length}</span></div>
                    <table class="student-print-table">
                        <thead><tr><th>День и время</th><th>Формат</th><th>Преподаватель</th><th>Кабинет</th><th>Длительность</th></tr></thead>
                        <tbody>${scheduleTableRows}</tbody>
                    </table>
                </section>
            `,
        );
    }

    function eventTitle(event) {
        if (event.kind !== 'payment') return event.title || 'Операция';
        const type = typeof getPaymentTypeText === 'function' ? getPaymentTypeText(event.sourceType) : '';
        return type || event.title || 'Оплата';
    }

    function renderFinanceDocument() {
        const financial = state.payload?.financial || {};
        const summary = financial.summary || {};
        const events = financial.events || [];
        const rows = events.length
            ? events.map(event => {
                const method = event.paymentMethod && typeof getPaymentMethodLabel === 'function'
                    ? getPaymentMethodLabel(event.paymentMethod)
                    : event.paymentMethod;
                const description = [
                    event.description,
                    event.teacherName ? `Педагог: ${event.teacherName}` : '',
                    event.managerName ? `Внёс: ${event.managerName}` : '',
                ].filter(Boolean).join(' · ');
                return `
                    <tr>
                        <td>${html(shortDate(event.date))}</td>
                        <td><strong>${html(eventTitle(event))}</strong><span>${html(description || '—')}</span></td>
                        <td>${html(method || '—')}</td>
                        <td class="is-money ${event.amount < 0 ? 'is-negative' : 'is-positive'}">${event.amount > 0 ? '+' : '−'}${html(money(Math.abs(event.amount)))}</td>
                        <td class="is-money">${html(money(event.balanceAfter))}</td>
                    </tr>
                `;
            }).join('')
            : '<tr><td colspan="5" class="student-print-table__empty">За выбранный период финансовых операций нет</td></tr>';

        return documentShell(
            'Финансовая выписка',
            `Период: ${periodText(state.payload?.range)}`,
            `
                <section class="student-print-summary">
                    <div><span>На начало периода</span><strong>${html(money(summary.openingBalance || 0))}</strong></div>
                    <div><span>Поступления</span><strong>${html(money(summary.income || 0))}</strong></div>
                    <div><span>Списания и возвраты</span><strong>${html(money(summary.expenses || 0))}</strong></div>
                    <div class="is-accent"><span>На конец периода</span><strong>${html(money(summary.closingBalance || 0))}</strong></div>
                </section>
                <section class="student-print-section">
                    <div class="student-print-section__head">
                        <h2>Движение средств</h2>
                        <span>${events.length} операций</span>
                    </div>
                    <table class="student-print-table student-print-table--finance">
                        <thead><tr><th>Дата</th><th>Операция</th><th>Счёт</th><th>Сумма</th><th>Баланс</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </section>
            `,
        );
    }

    function renderCurrentDocument() {
        if (!state.payload) return '';
        if (state.type === 'profile') return renderProfileDocument();
        if (state.type === 'finance') return renderFinanceDocument();
        return renderAttendanceDocument();
    }

    function setLoading(isLoading, message = '') {
        const status = byId('studentPrintState');
        const refresh = byId('refreshStudentPrintPreview');
        const print = byId('printStudentDocument');
        if (status) {
            status.className = `student-print-state${isLoading ? ' is-loading' : ''}`;
            status.innerHTML = message || (isLoading
                ? '<span class="student-print-spinner"></span><span>Готовим документ...</span>'
                : '');
        }
        if (refresh) refresh.disabled = isLoading;
        if (print) print.disabled = isLoading || !state.payload;
    }

    async function loadPreview() {
        const preview = byId('studentPrintPreview');
        const from = byId('studentPrintFrom')?.value;
        const to = byId('studentPrintTo')?.value;
        if (!currentViewingStudentId) {
            if (preview) preview.innerHTML = '';
            setLoading(false, 'Сначала откройте карточку ученика');
            return;
        }
        if (!from || !to || from > to) {
            state.payload = null;
            if (preview) preview.innerHTML = '';
            setLoading(false, 'Проверьте выбранный период');
            return;
        }

        const requestId = ++state.requestId;
        state.payload = null;
        if (preview) preview.innerHTML = '';
        setLoading(true);
        try {
            const params = new URLSearchParams({ from, to });
            const response = await fetch(`${API_URL}/students/${currentViewingStudentId}/print-data?${params}`, {
                headers: { Authorization: `Bearer ${getAuthToken()}` },
                cache: 'no-store',
            });
            const payload = await response.json().catch(() => ({}));
            if (requestId !== state.requestId) return;
            if (!response.ok || !payload.success) {
                throw new Error(payload.error || 'Не удалось подготовить документ');
            }
            state.payload = payload;
            if (preview) preview.innerHTML = renderCurrentDocument();
            setLoading(false);
        } catch (error) {
            if (requestId !== state.requestId) return;
            state.payload = null;
            if (preview) preview.innerHTML = '';
            setLoading(false, html(error.message || 'Не удалось подготовить документ'));
        }
    }

    function selectType(type) {
        state.type = ['attendance', 'profile', 'finance'].includes(type) ? type : 'attendance';
        document.querySelectorAll('[data-student-print-type]').forEach(button => {
            const active = button.dataset.studentPrintType === state.type;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-selected', String(active));
        });
        byId('studentPrintPeriod')?.classList.toggle('is-hidden', state.type === 'profile');
        const preview = byId('studentPrintPreview');
        if (state.payload && preview) preview.innerHTML = renderCurrentDocument();
    }

    function openDialog() {
        if (!currentViewingStudentId || !currentViewingStudentRecord) {
            toast.error('Карточка ученика ещё загружается');
            return;
        }
        const modal = byId('studentPrintModal');
        if (!modal) return;
        if (!byId('studentPrintFrom').value) byId('studentPrintFrom').value = firstDayOfMonthInputValue();
        if (!byId('studentPrintTo').value) byId('studentPrintTo').value = todayInputValue();
        state.type = 'attendance';
        state.payload = null;
        selectType('attendance');
        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');
        loadPreview();
    }

    function closeDialog() {
        const modal = byId('studentPrintModal');
        if (!modal) return;
        state.requestId += 1;
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
    }

    function printDocument() {
        const sheet = byId('studentPrintPreview')?.querySelector('.student-print-sheet');
        const printRoot = byId('studentDocumentPrintRoot');
        if (!sheet || !printRoot || !state.payload) return;

        const previousTitle = document.title;
        const titleByType = {
            attendance: 'Посещаемость',
            profile: 'Карточка ученика',
            finance: 'Финансовая выписка',
        };
        printRoot.innerHTML = sheet.outerHTML;
        printRoot.setAttribute('aria-hidden', 'false');
        document.body.classList.add('student-document-printing');
        document.title = `${titleByType[state.type]} — ${studentName(state.payload.student)}`;

        const cleanup = () => {
            document.body.classList.remove('student-document-printing');
            printRoot.setAttribute('aria-hidden', 'true');
            printRoot.innerHTML = '';
            document.title = previousTitle;
            window.removeEventListener('afterprint', cleanup);
        };
        window.addEventListener('afterprint', cleanup);
        window.print();
    }

    function bind() {
        const openButton = byId('printStudentBtn');
        if (!openButton || openButton.dataset.bound === 'true') return;
        openButton.dataset.bound = 'true';
        openButton.addEventListener('click', openDialog);
        byId('closeStudentPrintModal')?.addEventListener('click', closeDialog);
        byId('cancelStudentPrint')?.addEventListener('click', closeDialog);
        byId('studentPrintModalOverlay')?.addEventListener('click', closeDialog);
        byId('refreshStudentPrintPreview')?.addEventListener('click', loadPreview);
        byId('printStudentDocument')?.addEventListener('click', printDocument);
        document.querySelectorAll('[data-student-print-type]').forEach(button => {
            button.addEventListener('click', () => selectType(button.dataset.studentPrintType));
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && byId('studentPrintModal')?.classList.contains('show')) {
                event.stopImmediatePropagation();
                closeDialog();
            }
        }, true);
    }

    window.openStudentPrintDialog = openDialog;
    document.addEventListener('DOMContentLoaded', bind);
})();
