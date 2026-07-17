// =====================================================
// BOOKINGS MODULE - Управление заявками
// =====================================================

// Текущий фильтр заявок
let currentBookingFilter = null;
let currentBookingPage = 1;
let currentBookingSearch = '';
let currentBookings = [];

function escapeBookingText(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function jsBookingArg(value) {
    return escapeBookingText(JSON.stringify(String(value || '')));
}

function formatBookingFio(person) {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ');
}

function getAppBookingStatusText(status) {
    return ({
        new: 'новая',
        assigned: 'преподаватель назначен',
        scheduled: 'урок назначен',
        completed: 'урок завершён',
        cancelled: 'отменено',
        no_show: 'неявка',
    })[status] || status || '';
}

function getStatusText(status) {
    return ({
        new: 'Новая',
        processed: 'В работе',
        trial: 'Пробное',
        thinking: 'Провели пробный / Думают',
        sold: 'Продано',
        rejected: 'Отклонено',
    })[status] || status || '—';
}

// Универсальный помощник: привязывает поиск ученика-реферера к input-у и
// сохраняет выбранный id в скрытое поле hiddenInputId.
function attachReferrerAutocomplete(searchInputId, hiddenInputId, resultsContainerId, onPick) {
    const input = document.getElementById(searchInputId);
    const hidden = document.getElementById(hiddenInputId);
    const results = document.getElementById(resultsContainerId);
    if (!input || !hidden || !results) return;

    let t = null;
    const render = (list) => {
        if (list.length === 0) {
            results.innerHTML = '<div style="opacity:0.6;font-size:0.85em;padding:6px 0;">Ничего не найдено</div>';
            return;
        }
        results.innerHTML = list.slice(0, 8).map(s => {
            const uid = s._id || s.id;
            const ln = (s.lastName || '').replace(/</g, '&lt;');
            const nm = (s.name || '').replace(/</g, '&lt;');
            const mn = (s.middleName || '').replace(/</g, '&lt;');
            const ph = (s.phone || '').replace(/</g, '&lt;');
            const fio = [ln, nm, mn].filter(Boolean).join(' ');
            const badge = s.isBooking ? ' <span style="opacity:0.6;font-size:0.8em;">(Заявка)</span>' : '';
            return `
                <button type="button" class="referrer-pick-btn" data-id="${uid}" data-label="${fio} · ${ph}"
                    style="display:block;width:100%;text-align:left;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:6px 10px;color:#fff;font-size:0.85em;cursor:pointer;margin-bottom:4px;">
                    ${fio}${badge} · ${ph}
                </button>
            `;
        }).join('');
        results.querySelectorAll('.referrer-pick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                hidden.value = btn.dataset.id;
                input.value = btn.dataset.label;
                results.innerHTML = '';
                if (typeof onPick === 'function') onPick(btn.dataset.id);
            });
        });
    };

    input.addEventListener('input', () => {
        clearTimeout(t);
        const q = input.value.trim();
        hidden.value = '';
        if (!q) { results.innerHTML = ''; if (typeof onPick === 'function') onPick(null); return; }
        t = setTimeout(async () => {
            try {
                const resp = await fetch(
                    `${API_URL}/students?search=${encodeURIComponent(q)}&limit=10`,
                    { headers: { 'Authorization': `Bearer ${getAuthToken()}` } }
                );
                const data = await resp.json();
                render(data.students || data.data || []);
            } catch (err) {
                console.error('Referrer search error:', err);
            }
        }, 300);
    });
}

function getWhatsappLink(phone) {
    const raw = (phone || '').toString();
    const digits = raw.replace(/[^0-9+]/g, '').replace(/^\+/, '');
    if (!digits) {
        return `<span class="phone-contact"><span class="phone-number">${raw || '—'}</span></span>`;
    }
    const waNumber = digits.startsWith('7') || digits.startsWith('8') ? `7${digits.slice(1)}` : digits;
    const waUrl = `https://wa.me/${waNumber}`;
    return `
        <span class="phone-contact">
            <span class="phone-number">${raw}</span>
            <a class="phone-whatsapp" href="${waUrl}" target="_blank" rel="noopener" aria-label="Написать в WhatsApp" title="Написать в WhatsApp">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" fill="#25D366"/>
                </svg>
            </a>
        </span>
    `;
}

function bookingAgeLabel(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    const diffMinutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
    if (diffMinutes < 60) return `${diffMinutes || 1} мин`;
    const hours = Math.round(diffMinutes / 60);
    if (hours < 24) return `${hours} ч`;
    return `${Math.round(hours / 24)} дн`;
}

function bookingNextStep(booking) {
    if (booking.convertedToStudentId || booking.status === 'sold') {
        return { tone: 'ok', title: 'Создан', text: 'Заявка закрыта продажей.' };
    }
    if (booking.status === 'rejected') {
        return { tone: 'danger', title: 'Потеря', text: 'Проверьте причину отказа для аналитики.' };
    }
    if (!booking.phone) {
        return { tone: 'danger', title: 'Нет телефона', text: 'Нельзя связаться с клиентом.' };
    }
    if (booking.status === 'new') {
        return { tone: 'danger', title: 'Связаться', text: 'Новая заявка ждёт первого контакта.' };
    }
    if (!booking.trialScheduledAt && !booking.externalSourceId) {
        return { tone: 'warning', title: 'Пробный', text: 'Без даты пробного заявка зависнет.' };
    }
    if (booking.trialScheduledAt && !booking.depositPaid) {
        return { tone: 'warning', title: 'Оплата?', text: 'Диагностический урок назначен, оплата 2000 ₸ не отмечена.' };
    }
    if (booking.trialScheduledAt && booking.depositPaid) {
        return { tone: 'ok', title: 'Готово', text: 'После урока создайте ученика или закройте потерю.' };
    }
    if (booking.externalSourceId && booking.appStatus !== 'scheduled') {
        return { tone: 'warning', title: 'Онлайн', text: 'Заявка из приложения ждёт преподавателя и ссылку.' };
    }
    return { tone: 'neutral', title: 'Контроль', text: 'Проверьте следующий контакт.' };
}

function bookingWarnings(booking) {
    const warnings = [];
    if (!booking.source) warnings.push('нет источника');
    if (!booking.direction) warnings.push('нет направления');
    if (!booking.phone) warnings.push('нет телефона');
    if (booking.status === 'trial' && !booking.trialScheduledAt) warnings.push('статус пробного без даты');
    if (booking.trialScheduledAt && !booking.trialTeacherName) warnings.push('пробный без преподавателя');
    if (booking.trialScheduledAt && !booking.trialRoomName) warnings.push('пробный без кабинета');
    return warnings;
}

function renderBookingSafety(booking) {
    const next = bookingNextStep(booking);
    const warnings = bookingWarnings(booking);
    const age = bookingAgeLabel(booking.createdAt);
    const hint = [
        next.text,
        age ? `В работе ${age}` : '',
        warnings.length ? `Проверьте: ${warnings.join(', ')}` : '',
    ].filter(Boolean).join(' ');
    const visibleWarnings = warnings.slice(0, 2);
    return `
        <div class="booking-safety" title="${escapeBookingText(hint)}">
            <span class="booking-next is-${escapeBookingText(next.tone)}">${escapeBookingText(next.title)}</span>
            ${age ? `<span class="booking-age-chip">${escapeBookingText(age)}</span>` : ''}
            ${visibleWarnings.map(warning => `<span class="booking-warning-chip">${escapeBookingText(warning)}</span>`).join('')}
            ${warnings.length > visibleWarnings.length ? `<span class="booking-warning-chip">+${warnings.length - visibleWarnings.length}</span>` : ''}
        </div>
    `;
}

function bookingStatusRiskText(booking, newStatus) {
    if (newStatus === 'trial' && !booking?.trialScheduledAt) {
        return 'Вы ставите статус «Пробное», но дата пробного урока не назначена. Лучше сначала нажать «Назначить пробный», чтобы урок попал в расписание.';
    }
    if (newStatus === 'processed' && booking?.status === 'new') {
        return 'Заявка уйдёт из новых. Убедитесь, что первый контакт был сделан и следующий шаг понятен.';
    }
    if (newStatus === 'rejected') {
        return 'Заявка будет закрыта как потеря. Причина отказа попадёт в аналитику.';
    }
    return '';
}

function renderBookingConversionChecklist(booking) {
    const checks = [
        ['Телефон', Boolean(booking.phone), 'без телефона ученик не сможет нормально получать напоминания'],
        ['Направление', Boolean(booking.direction), 'нужно для группы, тарифа и аналитики'],
        ['Пробный урок', Boolean(booking.trialScheduledAt), 'лучше конвертировать после назначенного или проведённого пробного'],
        ['Оплата диагностики', Boolean(booking.depositPaid), 'отметьте оплату 2000 ₸ до создания ученика'],
        ['Источник', Boolean(booking.source), 'важно для аналитики продаж'],
    ];
    return `
        <div class="booking-conversion-checklist">
            <strong>Проверьте перед созданием ученика</strong>
            ${checks.map(([label, ok, hint]) => `
                <div class="${ok ? 'is-ok' : 'is-warning'}">
                    <span>${ok ? '✓' : '!'}</span>
                    <p><b>${escapeBookingText(label)}</b><small>${escapeBookingText(ok ? 'готово' : hint)}</small></p>
                </div>
            `).join('')}
        </div>
    `;
}

// Отобразить заявки
async function renderBookings(filter = null, search = '', page = 1) {
    const table = document.getElementById('bookingsTable');
    table.innerHTML = '<tr class="table-message"><td colspan="8">Загрузка...</td></tr>';

    // Показать прогресс-бар
    if (window.showLoading) {
        window.showLoading();
    }

    currentBookingFilter = filter;
    currentBookingSearch = search;
    currentBookingPage = page;

    try {
        const data = await fetchBookings(filter, search, page, 20);
        const bookings = data.bookings || [];
        currentBookings = bookings;

        // ⚡ Badge обновляется ТОЛЬКО из дашборда (там правильная статистика)
        // НЕ обновляем здесь, чтобы избежать неточностей из-за пагинации

        if (bookings.length === 0) {
            table.innerHTML = '<tr class="table-message"><td colspan="8">Нет заявок</td></tr>';
            renderBookingsPagination(0, page, 0);
            return;
        }

        const userRole = getUserRole();
        const isAdmin = ['admin', 'super_admin'].includes(userRole);
        const canManageBookings = ['sales_manager', 'admin', 'super_admin'].includes(userRole);

        // Показать/скрыть колонку "Действия"
        const actionsColumn = document.getElementById('bookingsActionsColumn');
        if (actionsColumn) {
            actionsColumn.style.display = canManageBookings ? '' : 'none';
        }

        const canEditSource = isSuperAdmin();

        table.innerHTML = bookings.map(booking => `
        <tr class="booking-row status-${escapeBookingText(booking.status || 'new')}${booking.convertedToStudentId ? ' is-converted' : ''}" data-booking-id="${escapeBookingText(booking._id)}">
            <td class="booking-name-cell" data-label="Имя">
                <div class="card-field">
                    <span class="card-field-label">Имя</span>
                    <div class="card-field-value booking-person">
                        <strong class="booking-person-name">${escapeBookingText(formatBookingFio(booking) || 'Без имени')}</strong>
                        ${renderBookingSafety(booking)}
                    </div>
                </div>
            </td>
            <td class="booking-phone-cell" data-label="Телефон">
                <div class="card-field">
                    <span class="card-field-label">Телефон</span>
                    <span class="card-field-value">${getWhatsappLink(booking.phone)}</span>
                </div>
            </td>
            <td class="booking-direction-cell" data-label="Направление">
                <div class="card-field">
                    <span class="card-field-label">Направление</span>
                    <div class="card-field-value booking-direction">
                        <strong>${escapeBookingText(booking.direction || '—')}</strong>
                        ${booking.notes ? `<small>${escapeBookingText(booking.notes)}</small>` : ''}
                        ${booking.appStatus ? `<small class="booking-app-note">Приложение: ${escapeBookingText(getAppBookingStatusText(booking.appStatus))}${booking.onlineTeacherName ? ` · ${escapeBookingText(booking.onlineTeacherName)}` : ''}${booking.onlineScheduledAt ? ` · ${formatDateTime(booking.onlineScheduledAt)}` : ''}</small>` : ''}
                    </div>
                </div>
            </td>
            <td class="booking-trial-cell" data-label="Пробный урок">
                <div class="card-field">
                    <span class="card-field-label">Пробный урок</span>
                    <div class="card-field-value booking-trial-summary">
                        <strong>${booking.trialScheduledAt ? formatDateTime(booking.trialScheduledAt) : 'Не назначен'}</strong>
                        ${booking.trialTeacherName ? `<span>${escapeBookingText(booking.trialTeacherName)}</span>` : ''}
                        ${booking.trialRoomName ? `<span>${escapeBookingText(booking.trialRoomName)}</span>` : ''}
                        <em class="${booking.depositPaid ? 'is-paid' : 'is-unpaid'}">Диагностика: ${booking.depositPaid ? 'оплачена' : 'не оплачена'}</em>
                    </div>
                </div>
            </td>
            <td class="booking-source-cell" data-label="Источник">
                <div class="card-field">
                    <span class="card-field-label">Источник</span>
                    ${canEditSource ? `
                    <div class="card-field-value">
	                        <select class="source-select" data-booking-id="${escapeBookingText(booking._id)}" data-current-source="${escapeBookingText(booking.source || '')}">
                            <option value="" ${!booking.source ? 'selected' : ''}>Не указан</option>
                            <option value="Телефонный звонок" ${booking.source === 'Телефонный звонок' ? 'selected' : ''}>Телефонный звонок</option>
                            <option value="WhatsApp" ${booking.source === 'WhatsApp' ? 'selected' : ''}>WhatsApp</option>
                            <option value="Instagram Direct" ${booking.source === 'Instagram Direct' ? 'selected' : ''}>Instagram Direct</option>
                            <option value="Личное обращение" ${booking.source === 'Личное обращение' ? 'selected' : ''}>Личное обращение</option>
                            <option value="Сайт" ${booking.source === 'Сайт' ? 'selected' : ''}>Сайт</option>
                            <option value="Приложение — пробный урок" ${booking.source === 'Приложение — пробный урок' ? 'selected' : ''}>Приложение — пробный урок</option>
                            <option value="Приложение — онлайн-урок" ${booking.source === 'Приложение — онлайн-урок' ? 'selected' : ''}>Приложение — онлайн-урок</option>
                            <option value="Рекомендация" ${booking.source === 'Рекомендация' ? 'selected' : ''}>Рекомендация</option>
                            <option value="1fit" ${booking.source === '1fit' ? 'selected' : ''}>1fit</option>
                            <option value="Другое" ${booking.source === 'Другое' ? 'selected' : ''}>Другое</option>
                        </select>
                    </div>
                    ` : `<span class="card-field-value">${escapeBookingText(booking.source || '—')}</span>`}
                </div>
            </td>
            <td class="date-cell booking-date-cell" data-label="Дата и время">
                <div class="card-field">
                    <span class="card-field-label">Дата и время</span>
                    <span class="card-field-value">${booking.trialScheduledAt ? formatDateTime(booking.trialScheduledAt) : formatDateTime(booking.createdAt)}</span>
                </div>
            </td>
            <td class="status-cell booking-status-cell status-${escapeBookingText(booking.status)}" data-label="Статус">
                <div class="card-field">
                    <span class="card-field-label">Статус</span>
                    <div class="card-field-value">
	                        <select class="status-select" data-booking-id="${escapeBookingText(booking._id)}" data-current-status="${escapeBookingText(booking.status)}">
                            <option value="new" ${booking.status === 'new' ? 'selected' : ''}>Новая</option>
                            <option value="processed" ${booking.status === 'processed' ? 'selected' : ''}>В работе</option>
                            <option value="trial" ${booking.status === 'trial' ? 'selected' : ''}>Пробное</option>
                            <option value="thinking" ${booking.status === 'thinking' ? 'selected' : ''}>Думают</option>
                            ${booking.status === 'sold' ? '<option value="sold" selected>Продано</option>' : ''}
                            <option value="rejected" ${booking.status === 'rejected' ? 'selected' : ''}>Отклонено</option>
                        </select>
                    </div>
                </div>
            </td>
            ${canManageBookings ? `
            <td class="table-actions booking-actions-cell" data-label="Действия">
                <div class="card-field">
                    <span class="card-field-label">Действия</span>
                    <div class="card-field-value booking-actions">
                        ${booking.externalSourceId ? `<button class="table-btn" title="${booking.appStatus === 'scheduled' ? 'Изменить онлайн-урок' : 'Назначить онлайн-урок'}" onclick="openOnlineLessonSchedule(${jsBookingArg(booking._id)})">${booking.appStatus === 'scheduled' ? 'Онлайн' : 'Онлайн'}</button>` : ''}
                        <button class="table-btn" title="${booking.trialScheduledAt ? 'Изменить пробный урок' : 'Назначить пробный урок'}" onclick="openTrialDetails(${jsBookingArg(booking._id)})">${booking.trialScheduledAt ? 'Изменить' : 'Назначить'}</button>
                        ${!booking.convertedToStudentId ? `<button class="table-btn" title="Создать ученика из заявки" onclick="openConvertBookingModal(${jsBookingArg(booking._id)})">Ученик</button>` : ''}
                        ${isAdmin && !booking.convertedToStudentId ? `<button class="table-btn danger" title="Удалить заявку" onclick="deleteBooking(${jsBookingArg(booking._id)}, ${jsBookingArg(formatBookingFio(booking))})">Удалить</button>` : ''}
                    </div>
                </div>
            </td>
            ` : `
            <td data-label="Действия">
                <div class="card-field">
                    <span class="card-field-label">Действия</span>
                    <span class="card-field-value">—</span>
                </div>
            </td>`}
        </tr>
    `).join('');

        // Добавляем обработчики на select'ы статусов
        document.querySelectorAll('.status-select').forEach(select => {
            select.addEventListener('change', async (e) => {
                const bookingId = e.target.dataset.bookingId;
                const currentStatus = e.target.dataset.currentStatus;
                const newStatus = e.target.value;
                const booking = currentBookings.find(item => String(item._id || item.id) === String(bookingId));

                // Подтверждение изменения для остальных статусов
                const riskText = bookingStatusRiskText(booking, newStatus);
                const confirmMessage = [
                    `Изменить статус заявки с "${getStatusText(currentStatus)}" на "${getStatusText(newStatus)}"?`,
                    riskText,
                ].filter(Boolean).join('\n\n');

                if (await customConfirm(confirmMessage, { icon: 'warning' })) {
                    // Обновляем атрибут для цвета перед отправкой
                    e.target.dataset.currentStatus = newStatus;
                    await changeBookingStatusDirect(bookingId, newStatus);
                } else {
                    // Вернуть старое значение
                    e.target.value = currentStatus;
                }
            });
        });

        // Добавляем обработчики на select'ы источников (только для Super Admin)
        document.querySelectorAll('.source-select').forEach(select => {
            select.addEventListener('change', async (e) => {
                const bookingId = e.target.dataset.bookingId;
                const currentSource = e.target.dataset.currentSource;
                const newSource = e.target.value;

                // Подтверждение изменения
                const confirmMessage = `Изменить источник заявки на "${newSource || 'Не указан'}"?`;

                if (await customConfirm(confirmMessage, { icon: 'warning' })) {
                    await changeBookingSource(bookingId, newSource);
                } else {
                    // Вернуть старое значение
                    e.target.value = currentSource;
                }
            });
        });

        // ⚡ Рендерим пагинацию
        renderBookingsPagination(data.total, page, data.pages);

    } catch (error) {
        table.innerHTML = '<tr class="table-message"><td colspan="8" style="color:red;">Не удалось загрузить заявки. Обновите страницу.</td></tr>';

        // Скрыть прогресс-бар при ошибке
        if (window.hideLoading) {
            window.hideLoading();
        }
    }

    // Скрыть прогресс-бар после завершения
    if (window.hideLoading) {
        window.hideLoading();
    }
}

// Рендер пагинации для заявок
function renderBookingsPagination(total, currentPage, totalPages) {
    const container = document.getElementById('bookingsPagination');
    if (!container) return;

    if (!totalPages || totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    const buttons = [];

    // Кнопка "Назад"
    if (currentPage > 1) {
        buttons.push(`<button class="pagination-btn" data-page="${currentPage - 1}">‹ Назад</button>`);
    }

    // Номера страниц
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
            const active = i === currentPage ? 'active' : '';
            buttons.push(`<button class="pagination-btn ${active}" data-page="${i}">${i}</button>`);
        } else if (i === currentPage - 3 || i === currentPage + 3) {
            buttons.push(`<span style="padding: 5px 10px; opacity: 0.5;">...</span>`);
        }
    }

    // Кнопка "Вперед"
    if (currentPage < totalPages) {
        buttons.push(`<button class="pagination-btn" data-page="${currentPage + 1}">Вперед ›</button>`);
    }

    container.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; justify-content: center; padding: 20px 0; flex-wrap: wrap;">
            ${buttons.join('')}
            <span style="margin-left: 15px; opacity: 0.7; font-size: 0.9rem;">
                Всего: ${total} | Страница ${currentPage} из ${totalPages}
            </span>
        </div>
    `;

    // Добавляем обработчики событий
    container.querySelectorAll('.pagination-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const page = parseInt(btn.dataset.page);

            // Показать прогресс-бар при пагинации
            if (window.showLoading) {
                window.showLoading();
            }
            renderBookings(currentBookingFilter, currentBookingSearch, page);
        });
    });
}

// Изменить источник заявки
async function changeBookingSource(id, newSource) {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/bookings/${id}/source`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ source: newSource })
        });

        const data = await response.json();

        if (data.success) {
            toast.success(`Источник изменен на "${newSource || 'Не указан'}"`);
            renderBookings(currentBookingFilter);
        } else {
            toast.error(data.error || 'Не удалось изменить источник');
            renderBookings(currentBookingFilter);
        }
    } catch (error) {
        toast.error('Не удалось связаться с сервисом');
        renderBookings(currentBookingFilter);
    }
}

// Открыть модалку конвертации заявки
async function openConvertBookingModal(bookingId) {
    try {
        const token = getAuthToken();

        document.getElementById('convertBookingInfo').innerHTML = '<div style="text-align: center; padding: 20px; opacity: 0.5;">Загрузка...</div>';
        document.getElementById('convertBookingId').value = bookingId;
        document.getElementById('convertBookingModal').classList.add('show');

        const bookingData = await fetch(`${API_URL}/bookings/${bookingId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.json());

        const booking = bookingData.booking;

        document.getElementById('convertBookingInfo').innerHTML = `
            <strong style="display: block; margin-bottom: 8px;">Заявка:</strong>
            <div style="font-size: 0.95em; opacity: 0.9;">
                <div>ФИО: ${escapeBookingText(formatBookingFio(booking))}</div>
                <div>Телефон: ${escapeBookingText(booking.phone || 'Не указан')}</div>
                <div>Направление: ${escapeBookingText(booking.direction || 'Не указано')}</div>
            </div>
            ${renderBookingConversionChecklist(booking)}
        `;

        const referrerHidden = document.getElementById('convertReferrerId');
        const referrerSearch = document.getElementById('convertReferrerSearch');
        const referrerResults = document.getElementById('convertReferrerResults');
        if (referrerHidden) referrerHidden.value = booking.referrerStudentId || '';
        if (referrerResults) referrerResults.innerHTML = '';
        if (referrerSearch) {
            if (booking.referrerStudentId) {
                try {
                    const r = await fetch(`${API_URL}/students/${booking.referrerStudentId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const rd = await r.json();
                    if (rd.success && rd.student) {
                        referrerSearch.value = `${formatBookingFio(rd.student)} · ${rd.student.phone || ''}`.trim();
                    } else {
                        referrerSearch.value = '';
                    }
                } catch {
                    referrerSearch.value = '';
                }
            } else {
                referrerSearch.value = '';
            }
        }
    } catch (error) {
        document.getElementById('convertBookingInfo').innerHTML = '<div style="text-align: center; padding: 20px; color: #dc3545;">Не удалось загрузить заявку</div>';
        toast.error('Не удалось загрузить заявку');
    }
}

// Закрыть модалку конвертации
function closeConvertBookingModal() {
    document.getElementById('convertBookingModal').classList.remove('show');
}

// Изменить статус заявки напрямую (через select)
async function changeBookingStatusDirect(id, newStatus) {
    try {
        const token = getAuthToken();

        // Phase 2: при переводе в "отклонено" — спросить причину/этап потери
        let extraBody = {};
        if (newStatus === 'rejected') {
            const booking = currentBookings.find(item => item._id === id || item.id === id);
            const initialStage = booking?.convertedToStudentId
                ? 'on_trial'
                : (booking?.status === 'trial' || booking?.appStatus === 'scheduled' ? 'on_trial' : 'before_trial');
            const loss = await window.openLossReasonDialog({
                title: 'Отклонение заявки — причина потери',
                withStage: true,
                initialStage,
            });
            if (!loss) {
                const select = document.querySelector(`[data-booking-id="${id}"] .status-select`);
                if (select) select.value = select.dataset.currentStatus || 'new';
                return;
            }
            extraBody = { lossReason: loss.reason, lossStage: loss.stage };
        }

        const response = await fetch(`${API_URL}/bookings/${id}/status`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: newStatus, ...extraBody })
        });

        const data = await response.json();

        if (data.success) {
            toast.success(`Статус изменен на "${getStatusText(newStatus)}"`);
            updateBookingRow(id, newStatus);

            // Если статус изменился с "new" на другой, или наоборот - нужно обновить счетчик
            if (newStatus !== 'new' || document.querySelector(`[data-booking-id="${id}"] .status-select`)?.dataset.currentStatus === 'new') {
                setTimeout(() => {
                    if (window.fetchNewBookingsCount) {
                        window.fetchNewBookingsCount(); // Принудительно обновит badge
                    }
                }, 500); // Небольшая задержка, чтобы БД успела обновиться
            }
        } else {
            toast.error(data.error || 'Не удалось изменить статус');
            // При ошибке возвращаем старое значение
            const select = document.querySelector(`[data-booking-id="${id}"]`);
            if (select) {
                select.value = select.dataset.currentStatus;
            }
        }
    } catch (error) {
        toast.error('Не удалось связаться с сервисом');
        // При ошибке возвращаем старое значение
        const select = document.querySelector(`[data-booking-id="${id}"]`);
        if (select) {
            select.value = select.dataset.currentStatus;
        }
    }
}

// Обновить только одну строку заявки
function updateBookingRow(bookingId, newStatus) {
    const row = document.querySelector(`tr[data-booking-id="${bookingId}"]`);
    if (!row) return;

    // Обновляем статус в select
    const statusSelect = row.querySelector('.status-select');
    if (statusSelect) {
        statusSelect.value = newStatus;
        statusSelect.dataset.currentStatus = newStatus;
    }

    // Обновляем цвет статуса
    const statusCell = row.querySelector('.status-cell');
    if (statusCell) {
        statusCell.className = `status-cell status-${newStatus}`;
    }

    // Обновляем дату изменения (если есть)
    const dateCell = row.querySelector('.date-cell');
    if (dateCell) {
        dateCell.textContent = new Date().toLocaleDateString('ru-RU');
    }
}

async function openOnlineLessonSchedule(bookingId) {
    try {
        const token = getAuthToken();
        const [bookingResponse, teachersResponse] = await Promise.all([
            fetch(`${API_URL}/bookings/${bookingId}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
            fetch(`${API_URL}/students?role=teacher&status=active&limit=200`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        ]);
        const booking = bookingResponse.booking;
        const teachers = teachersResponse.students || [];
        const linkedTeachers = teachers.filter(teacher => teacher.appUserId && teacher.externalLinkStatus === 'linked');

        if (!booking) return toast.error('Заявка не найдена');
        if (!linkedTeachers.length) return toast.warning('Нет преподавателей, подключённых к приложению');

        const scheduledValue = booking.onlineScheduledAt
            ? new Date(new Date(booking.onlineScheduledAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
            : '';
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.style.zIndex = '10020';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width:560px;">
                <button class="modal-close" type="button">×</button>
                <h2>Назначить урок в приложении</h2>
                <p style="opacity:.7;margin-bottom:18px;">${escapeBookingText(formatBookingFio(booking))} · ${escapeBookingText(booking.direction)}</p>
                <form id="onlineLessonScheduleForm">
                    <div class="form-group">
                        <label>Преподаватель *</label>
                        <select id="onlineLessonTeacher" required>
                            <option value="">Выберите преподавателя</option>
                            ${linkedTeachers.map(teacher => `<option value="${teacher.id}" ${teacher.id === booking.onlineTeacherId ? 'selected' : ''}>${escapeBookingText(formatBookingFio(teacher))}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Дата и время *</label>
                        <input id="onlineLessonScheduledAt" type="datetime-local" required value="${scheduledValue}">
                    </div>
                    <div class="form-group">
                        <label>Ссылка на онлайн-урок *</label>
                        <input id="onlineLessonMeetingUrl" type="url" required value="${escapeBookingText(booking.onlineMeetingUrl || '')}" placeholder="https://zoom.us/j/...">
                    </div>
                    <button class="btn-primary" type="submit" style="width:100%;">Сохранить и отправить в приложение</button>
                </form>
            </div>
        `;
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.querySelector('.modal-close').addEventListener('click', close);
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        overlay.querySelector('#onlineLessonScheduleForm').addEventListener('submit', async event => {
            event.preventDefault();
            const submitButton = event.target.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            submitButton.textContent = 'Отправляем...';
            try {
                const response = await fetch(`${API_URL}/bookings/${bookingId}/online-schedule`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        teacherId: overlay.querySelector('#onlineLessonTeacher').value,
                        scheduledAt: new Date(overlay.querySelector('#onlineLessonScheduledAt').value).toISOString(),
                        meetingUrl: overlay.querySelector('#onlineLessonMeetingUrl').value,
                    }),
                });
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error(result.error || 'Не удалось назначить урок');
                close();
                toast.success('Урок назначен. Ученик и преподаватель увидят его в приложении.');
                renderBookings(currentBookingFilter, currentBookingSearch, currentBookingPage);
            } catch (error) {
                toast.error(error.message);
                submitButton.disabled = false;
                submitButton.textContent = 'Сохранить и отправить в приложение';
            }
        });
    } catch (error) {
        toast.error('Не удалось открыть назначение урока');
    }
}
window.openOnlineLessonSchedule = openOnlineLessonSchedule;

async function openTrialDetails(bookingId) {
    try {
        const token = getAuthToken();
        const [bookingResponse, optionsResponse] = await Promise.all([
            fetch(`${API_URL}/bookings/${bookingId}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
            fetch(`${API_URL}/bookings/trial-options`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        ]);
        const booking = bookingResponse.booking;
        if (!booking) return toast.error('Заявка не найдена');

        const teachers = optionsResponse.teachers || [];
        const rooms = optionsResponse.rooms || [];
        const scheduledValue = booking.trialScheduledAt
            ? new Date(new Date(booking.trialScheduledAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
            : '';

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.style.zIndex = '10020';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width:560px;">
                <button class="modal-close" type="button">×</button>
                <h2>Пробный урок</h2>
                <p style="opacity:.7;margin-bottom:18px;">${escapeBookingText(formatBookingFio(booking))} · ${escapeBookingText(booking.direction)}</p>
                <form id="trialDetailsForm">
                    <div class="form-group">
                        <label>Преподаватель</label>
                        <select id="trialDetailsTeacher">
                            <option value="">Не назначен</option>
                            ${teachers.map(teacher => {
                                const linked = teacher.appUserId && teacher.externalLinkStatus === 'linked';
                                const teacherName = formatBookingFio(teacher) || 'Преподаватель';
                                return `<option value="${teacher.id}" ${teacher.id === booking.trialTeacherId ? 'selected' : ''} ${linked ? '' : 'disabled'}>${escapeBookingText(`${teacherName}${linked ? '' : ' — не подключён к приложению'}`)}</option>`;
                            }).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Кабинет</label>
                        <select id="trialDetailsRoom">
                            <option value="">Не назначен</option>
                            ${rooms.map(room => `<option value="${room.id}" ${room.id === booking.trialRoomId ? 'selected' : ''}>${escapeBookingText(room.name)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Дата и время</label>
                        <input id="trialDetailsScheduledAt" type="datetime-local" value="${scheduledValue}">
                        <small style="opacity:.7;display:block;margin-top:5px;">Длительность — 30 минут. Урок сразу появится в расписании и приложении преподавателя.</small>
                    </div>
                    <label class="attendance-present-toggle" style="justify-content:flex-start;margin-bottom:18px;">
                        <input type="checkbox" id="trialDetailsDeposit" ${booking.depositPaid ? 'checked' : ''}>
                        <span>Диагностический урок 2000 ₸ оплачен</span>
                    </label>
                    <button class="btn-primary" type="submit" style="width:100%;">Сохранить пробный</button>
                </form>
            </div>
        `;
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.querySelector('.modal-close').addEventListener('click', close);
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        overlay.querySelector('#trialDetailsForm').addEventListener('submit', async event => {
            event.preventDefault();
            const submitButton = event.target.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            try {
                const value = overlay.querySelector('#trialDetailsScheduledAt').value;
                const response = await fetch(`${API_URL}/bookings/${bookingId}/trial-details`, {
                    method: 'PATCH',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        teacherId: overlay.querySelector('#trialDetailsTeacher').value || null,
                        roomId: overlay.querySelector('#trialDetailsRoom').value || null,
                        scheduledAt: value ? new Date(value).toISOString() : null,
                        depositPaid: overlay.querySelector('#trialDetailsDeposit').checked,
                    }),
                });
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error(result.error || 'Не удалось сохранить пробный');
                close();
                toast.success('Диагностический урок создан на 30 минут и отправлен в расписание преподавателя');
                renderBookings(currentBookingFilter, currentBookingSearch, currentBookingPage);
            } catch (error) {
                toast.error(error.message);
                submitButton.disabled = false;
            }
        });
    } catch (error) {
        toast.error('Не удалось открыть пробный урок');
    }
}
window.openTrialDetails = openTrialDetails;

// Просмотр заявки
async function viewBooking(id) {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/bookings/${id}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();
        const booking = data.booking;

        toast.info(`Заявка #${id.slice(-6)}\n\nФИО: ${formatBookingFio(booking)}\nТелефон: ${booking.phone}\nНаправление: ${booking.direction}\nСтатус: ${getStatusText(booking.status)}\nДата: ${new Date(booking.createdAt).toLocaleString('ru')}`);
    } catch (error) {
        toast.error('Не удалось загрузить заявку');
    }
}

function confirmBookingDeleteMode(bookingName) {
    return new Promise((resolve) => {
        const safeName = escapeBookingText(bookingName || 'заявки');
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 100060;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 18px;
            background: rgba(0, 0, 0, 0.88);
        `;

        overlay.innerHTML = `
            <div style="
                width: min(520px, 100%);
                padding: 28px;
                border: 1px solid var(--admin-border);
                border-radius: 22px;
                background: var(--admin-card);
                box-shadow: 0 24px 70px var(--admin-shadow);
                color: var(--admin-text);
            ">
                <div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:20px;">
                    <div style="color:var(--pink);flex:0 0 auto;">${typeof getIcon !== 'undefined' ? getIcon('warning', 28) : ''}</div>
                    <div style="min-width:0;">
                        <h3 style="margin:0 0 10px;font-size:1.25rem;line-height:1.2;">Удалить заявку?</h3>
                        <p style="margin:0;color:var(--admin-text-secondary);line-height:1.55;">
                            ${safeName}<br>
                            По умолчанию заявка уйдет в отказ, а история останется в статистике.
                        </p>
                    </div>
                </div>

                <label style="
                    display:flex;
                    gap:12px;
                    align-items:flex-start;
                    padding:14px;
                    border:1px solid rgba(255,77,79,.34);
                    border-radius:14px;
                    background:rgba(255,77,79,.08);
                    cursor:pointer;
                    text-align:left;
                ">
                    <input id="bookingHardDeleteToggle" type="checkbox" style="margin-top:4px; width:18px; height:18px;">
                    <span style="line-height:1.45;">
                        <strong style="display:block;color:#ff8080;">Это ошибочная заявка, удалить полностью</strong>
                        <small style="display:block;margin-top:4px;color:var(--admin-text-secondary);">
                            Заявка исчезнет из системы и не попадет в статистику. Нельзя для заявок с учеником, оплатами, абонементом или проведенным уроком.
                        </small>
                    </span>
                </label>

                <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:22px;flex-wrap:wrap;">
                    <button id="bookingDeleteCancel" type="button" class="table-btn">Отмена</button>
                    <button id="bookingDeleteConfirm" type="button" class="table-btn danger">Удалить</button>
                </div>
            </div>
        `;

        const close = (result) => {
            document.removeEventListener('keydown', onKeydown);
            overlay.remove();
            resolve(result);
        };
        const onKeydown = (event) => {
            if (event.key === 'Escape') close({ confirmed: false, hardDelete: false });
        };

        document.addEventListener('keydown', onKeydown);
        overlay.querySelector('#bookingDeleteCancel')?.addEventListener('click', () => {
            close({ confirmed: false, hardDelete: false });
        });
        overlay.querySelector('#bookingDeleteConfirm')?.addEventListener('click', () => {
            const hardDelete = Boolean(overlay.querySelector('#bookingHardDeleteToggle')?.checked);
            close({ confirmed: true, hardDelete });
        });

        document.body.appendChild(overlay);
    });
}

// Удалить заявку
async function deleteBooking(bookingId, bookingName) {
    // Проверка прав
    const userRole = getUserRole();
    if (!['admin', 'super_admin'].includes(userRole)) {
        toast.warning('Доступ запрещен. Требуются права администратора.');
        return;
    }

    const decision = await confirmBookingDeleteMode(bookingName);
    if (!decision.confirmed) {
        return;
    }

    try {
        const token = getAuthToken();

        // ⚡ OPTIMISTIC UI: Сразу удаляем строку из UI, не дожидаясь ответа сервера
        const row = document.querySelector(`tr[data-booking-id="${bookingId}"]`);
        // Сохраняем копию строки для возможного отката
        const rowClone = row ? row.cloneNode(true) : null;
        const table = document.getElementById('bookingsTable');

        if (row) {
            // Анимация удаления
            row.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            row.style.opacity = '0';
            row.style.transform = 'translateX(-20px)';

            setTimeout(() => {
                row.remove();
                // Проверяем если таблица пустая
                if (table && table.children.length === 0) {
                    table.innerHTML = '<tr><td colspan="8" style="text-align: center; opacity: 0.5; padding: 40px;">Нет заявок</td></tr>';
                }
            }, 300);
        }

        const deleteUrl = `${API_URL}/bookings/${bookingId}${decision.hardDelete ? '?hardDelete=1' : ''}`;
        const response = await fetch(deleteUrl, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            toast.success(data.message || (decision.hardDelete ? 'Ошибочная заявка удалена полностью' : 'Заявка перенесена в отказ'));
            // Обновляем badge
            if (window.fetchNewBookingsCount) window.fetchNewBookingsCount();
        } else {
            // ❌ ОШИБКА: Восстанавливаем строку
            if (rowClone && table) {
                // Если таблица была "пустой", очищаем сообщение
                if (table.querySelector('td[colspan="8"]')) {
                    table.innerHTML = '';
                }

                // Возвращаем стили
                rowClone.style.opacity = '1';
                rowClone.style.transform = 'none';
                table.appendChild(rowClone);
            }
            toast.error(data.error || 'Не удалось удалить заявку');
        }

    } catch (error) {
        toast.error('Не удалось связаться с сервисом');
    }
}

// Закрыть модальное окно создания заявки
function closeCreateBookingModal() {
    const modal = document.getElementById('createBookingModal');
    modal.classList.remove('show');
    document.getElementById('createBookingForm').reset();
    const hidden = document.getElementById('bookingReferrerId');
    if (hidden) hidden.value = '';
    const results = document.getElementById('bookingReferrerResults');
    if (results) results.innerHTML = '';
}

// Инициализация фильтров заявок
function initBookingFilters() {
    const bookingFilters = document.querySelectorAll('#section-bookings .filter-btn');
    bookingFilters.forEach(btn => {
        btn.addEventListener('click', () => {
            bookingFilters.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            currentBookingFilter = btn.dataset.filter === 'all' ? null : btn.dataset.filter;
            currentBookingPage = 1;  // Сброс на первую страницу

            // Показать прогресс-бар при фильтрации
            if (window.showLoading) {
                window.showLoading();
            }
            renderBookings(currentBookingFilter, currentBookingSearch, 1);
        });
    });
}

// Инициализация поиска заявок
function initBookingSearch() {
    const bookingSearch = document.getElementById('bookingSearch');
    if (bookingSearch) {
        let searchTimeout;
        bookingSearch.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                currentBookingPage = 1;  // Сброс на первую страницу
                // Показать прогресс-бар при поиске
                if (window.showLoading) {
                    window.showLoading();
                }
                renderBookings(currentBookingFilter, e.target.value, 1);
            }, 300);  // Debounce 300мс
        });
    }
}

// Инициализация обработчика создания заявки
function initBookingCreate() {
    // Открыть модальное окно создания заявки
    const createBtn = document.getElementById('createBookingBtn');
    if (createBtn) {
        createBtn.addEventListener('click', async () => {
            const modal = document.getElementById('createBookingModal');
            modal.classList.add('show');

            // Загрузка направлений и справочников пробного параллельно
            try {
                const token = getAuthToken();
                const [directionsRes, trialOptions] = await Promise.all([
                    fetch(`${API_URL}/directions`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }).then(r => r.json()).catch(() => ({ directions: [] })),
                    fetch(`${API_URL}/bookings/trial-options`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }).then(r => r.json()).catch(() => ({ teachers: [], rooms: [] }))
                ]);

                // Заполняем направления
                const dirSelect = document.getElementById('bookingDirection');
                dirSelect.innerHTML = '<option value="">Выберите направление</option>';
                if (directionsRes.directions) {
                    directionsRes.directions.forEach(d => {
                        const opt = document.createElement('option');
                        opt.value = d.name;
                        opt.textContent = d.name;
                        dirSelect.appendChild(opt);
                    });
                }

                const teacherSelect = document.getElementById('bookingTrialTeacher');
                teacherSelect.innerHTML = '<option value="">Назначить позже</option>' + (trialOptions.teachers || [])
                    .map(teacher => {
                        const linked = teacher.appUserId && teacher.externalLinkStatus === 'linked';
                        const teacherName = formatBookingFio(teacher) || 'Преподаватель';
                        return `<option value="${teacher.id}" ${linked ? '' : 'disabled'}>${escapeBookingText(`${teacherName}${linked ? '' : ' — не подключён к приложению'}`)}</option>`;
                    })
                    .join('');
                const roomSelect = document.getElementById('bookingTrialRoom');
                roomSelect.innerHTML = '<option value="">Назначить позже</option>' + (trialOptions.rooms || [])
                    .map(room => `<option value="${room.id}">${escapeBookingText(room.name)}</option>`)
                    .join('');
            } catch (e) {
                console.error('Ошибка загрузки данных для модалки', e);
            }
        });
    }

    // Закрыть при клике на overlay
    const overlay = document.querySelector('#createBookingModal .modal-overlay');
    if (overlay) {
        overlay.addEventListener('click', closeCreateBookingModal);
    }

    // Форматирование телефона в модальном окне
    const bookingPhoneInput = document.getElementById('bookingPhone');
    if (bookingPhoneInput) {
        bookingPhoneInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/[^\d+]/g, '');
            if (value.startsWith('8')) {
                value = '+7' + value.substring(1);
            } else if (value.length > 0 && !value.startsWith('+')) {
                value = '+' + value;
            }
            if (value.length > 0) {
                value = '+' + value.replace(/\+/g, '');
            }
            if (value.length > 16) {
                value = value.substring(0, 16);
            }
            e.target.value = value;
        });
    }

    // Автокомплит "Кто привёл" в форме создания заявки
    attachReferrerAutocomplete('bookingReferrerSearch', 'bookingReferrerId', 'bookingReferrerResults');

    // Создание заявки через API
    const createForm = document.getElementById('createBookingForm');
    if (createForm) {
        createForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = document.getElementById('bookingName').value;
            const lastName = document.getElementById('bookingLastName').value;
            const middleName = document.getElementById('bookingMiddleName')?.value || '';
            const dateOfBirth = document.getElementById('bookingDateOfBirth')?.value || '';
            const phone = document.getElementById('bookingPhone').value;
            const direction = document.getElementById('bookingDirection').value;
            const source = document.getElementById('bookingSource').value;
            const referrerStudentId = document.getElementById('bookingReferrerId')?.value || '';
            const trialTeacherId = document.getElementById('bookingTrialTeacher')?.value || '';
            const trialRoomId = document.getElementById('bookingTrialRoom')?.value || '';
            const trialScheduledValue = document.getElementById('bookingTrialScheduledAt')?.value || '';
            const depositPaid = Boolean(document.getElementById('bookingDepositPaid')?.checked);

            if ((trialTeacherId || trialRoomId || trialScheduledValue) && (!trialTeacherId || !trialRoomId || !trialScheduledValue)) {
                toast.warning('Для пробного выберите преподавателя, кабинет, дату и время');
                return;
            }

            try {
                const token = getAuthToken();

                const response = await fetch(`${API_URL}/bookings/create-admin`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name, lastName, middleName, dateOfBirth: dateOfBirth || undefined, phone, direction, source,
                        trialTeacherId: trialTeacherId || undefined,
                        trialRoomId: trialRoomId || undefined,
                        trialScheduledAt: trialScheduledValue ? new Date(trialScheduledValue).toISOString() : undefined,
                        depositPaid,
                        referrerStudentId: referrerStudentId || undefined
                    })
                });

                const data = await response.json();
                console.log('📋 Create booking response:', response.status, data);

                if (data.success) {
                    closeCreateBookingModal();
                    toast.party('Заявка успешно создана!');
                    await renderBookings(currentBookingFilter, currentBookingSearch, 1);
                    if (window.fetchNewBookingsCount) window.fetchNewBookingsCount();
                } else {
                    toast.error(data.error || 'Не удалось создать заявку');
                }
            } catch (error) {
                toast.error('Не удалось связаться с сервисом');
            }
        });
    }
}

// Инициализация обработчика формы конвертации
function initBookingConversion() {
    // Автокомплит реферера в модалке конвертации
    attachReferrerAutocomplete('convertReferrerSearch', 'convertReferrerId', 'convertReferrerResults');

    const convertForm = document.getElementById('convertBookingForm');
    if (convertForm) {
        convertForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const bookingId = document.getElementById('convertBookingId').value;
            const convertReferrerId = document.getElementById('convertReferrerId')?.value || '';

            try {
                const token = getAuthToken();

                const confirmed = typeof customConfirm === 'function'
                    ? await customConfirm(
                        'Создать карточку ученика? В статистике продаж заявка станет успешной только после первой оплаты.',
                        { icon: 'warning', yesText: 'Создать ученика', noText: 'Отмена' }
                    )
                    : window.confirm('Создать карточку ученика? В статистике продаж заявка станет успешной только после первой оплаты.');
                if (!confirmed) return;

                // ⚡ МОМЕНТАЛЬНО закрываем модалку конвертации
                closeConvertBookingModal();

                // ⚡ СРАЗУ показываем модалку результата с "Создание..."
                showStudentCreatedModal('Создание ученика...', '', 'Загрузка...', null, null, false, null);

                const convertData = await fetch(`${API_URL}/bookings/${bookingId}/convert`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        referrerStudentId: convertReferrerId || undefined
                    })
                }).then(r => r.json());

                if (convertData.success) {
                    const pwd = convertData.generatedPassword || 'changeme123';
                    const studentName = convertData.student.name;
                    const studentPhone = convertData.student.phone;
                    const platformInfo = convertData.platform?.login
                        ? { login: convertData.platform.login, url: 'https://maestro-school.duckdns.org' }
                        : null;

                    // Копируем пароль в буфер
                    const copySuccess = await copyToClipboard(pwd);

                    // Удаляем ВСЕ существующие модалки с z-index 10002 (могут быть дубликаты)
                    document.querySelectorAll('[style*="z-index: 10002"]').forEach(modal => modal.remove());

                    // Показываем РЕАЛЬНУЮ модалку с данными
                    showStudentCreatedModal(studentName, studentPhone, pwd, null, null, copySuccess, null, platformInfo, convertData.student.id);

                    // 🎉 Toast уведомление
                    toast.party('Ученик успешно создан!');

                    // Обновляем списки в фоне
                    setTimeout(() => {
                        // Обновляем заявки с сохранением текущих фильтров и поиска
                        // Карточка создана, но заявка останется на этапе пробного до реальной оплаты.
                        renderBookings(currentBookingFilter, currentBookingSearch, currentBookingPage);

                        // Обновляем badge
                        if (window.fetchNewBookingsCount) window.fetchNewBookingsCount();

                        // Обновляем список учеников - переключаемся на первую страницу без фильтров для показа нового ученика
                        if (typeof renderStudents === 'function') {
                            renderStudents('', 1, '');
                        } else if (typeof window.renderStudents === 'function') {
                            window.renderStudents('', 1, '');
                        }
                    }, 100);
                } else {
                    // Удаляем ВСЕ loading модалки
                    document.querySelectorAll('[style*="z-index: 10002"]').forEach(modal => modal.remove());
                    toast.error(convertData.error || 'Не удалось создать ученика');
                }
            } catch (error) {
                console.error('Ошибка конвертации на клиенте:', error);
                // Удаляем ВСЕ loading модалки
                document.querySelectorAll('[style*="z-index: 10002"]').forEach(modal => modal.remove());
                toast.error('Не удалось создать ученика из заявки. Попробуйте ещё раз.');
            }
        });
    }
}
