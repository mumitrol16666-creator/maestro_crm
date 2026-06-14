// =====================================================
// BOOKINGS MODULE - Управление заявками
// =====================================================

// Текущий фильтр заявок
let currentBookingFilter = null;
let currentBookingPage = 1;
let currentBookingSearch = '';
let convertAllGroupsData = []; // Для доступа к планам направлений

function escapeBookingText(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
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
            const ph = (s.phone || '').replace(/</g, '&lt;');
            const badge = s.isBooking ? ' <span style="opacity:0.6;font-size:0.8em;">(Заявка)</span>' : '';
            return `
                <button type="button" class="referrer-pick-btn" data-id="${uid}" data-label="${ln} ${nm} · ${ph}"
                    style="display:block;width:100%;text-align:left;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:6px 10px;color:#fff;font-size:0.85em;cursor:pointer;margin-bottom:4px;">
                    ${ln} ${nm}${badge} · ${ph}
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

// Разбивка цены со скидками для #convertBookingModal
let lastConvertPricingPreview = null;

function fmtMoneyConvert(n) {
    return new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0));
}

function renderConvertPriceHint(hintTextEl, data, unlocked, hasReferrer) {
    if (!hintTextEl) return;
    if (unlocked) {
        hintTextEl.innerHTML = '<span style="opacity:0.8;">Цена задана вручную</span>';
        return;
    }
    if (!data) {
        hintTextEl.innerHTML = '';
        return;
    }
    
    let parts = [`<span>База: <b>${fmtMoneyConvert(data.basePrice)} ₸</b></span>`];
    if (data.reasons && data.reasons.length > 0) {
        const reasonsHtml = data.reasons.map(r => `<span class="price-hint-accent">${r.toLowerCase()}</span>`).join(' · ');
        parts.push(reasonsHtml);
    }
    
    hintTextEl.innerHTML = parts.join(' · ');
}

async function updateConvertPricePreview() {
    const type = document.getElementById('convertMembershipType')?.value;
    const priceInput = document.getElementById('convertTotalPrice');
    const unlockBtn = document.getElementById('convertUnlockPrice');
    const hintTextEl = document.getElementById('convertPriceHintText');

    if (!type || !priceInput) return;

    const unlocked = priceInput.dataset.unlocked === '1';
    const referrerId = document.getElementById('convertReferrerId')?.value || '';

    const params = new URLSearchParams();
    params.set('type', type);
    if (referrerId) {
        params.set('referrerId', referrerId);
    }
    const groupId = document.getElementById('convertGroupId')?.value;
    if (groupId) {
        params.set('groupId', groupId);
    }

    try {
        const resp = await fetch(`${API_URL}/memberships/price-preview?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        const data = await resp.json();
        if (!data.success) return;
        lastConvertPricingPreview = data;

        if (!unlocked) priceInput.value = data.totalPrice;
        renderConvertPriceHint(hintTextEl, data, unlocked, !!referrerId);
        if (unlockBtn) unlockBtn.textContent = unlocked ? 'вернуть авто' : 'изменить';
    } catch (err) {
        console.error('Convert price preview error:', err);
    }
}
window.updateConvertPricePreview = updateConvertPricePreview;

function toggleConvertManualPrice() {
    const priceInput = document.getElementById('convertTotalPrice');
    const unlockBtn = document.getElementById('convertUnlockPrice');
    const hintTextEl = document.getElementById('convertPriceHintText');
    const referrerId = document.getElementById('convertReferrerId')?.value || '';
    if (!priceInput) return;
    const next = priceInput.dataset.unlocked !== '1';
    priceInput.dataset.unlocked = next ? '1' : '0';
    priceInput.readOnly = !next;
    if (unlockBtn) {
        unlockBtn.textContent = next ? 'вернуть авто' : 'изменить';
        unlockBtn.classList.toggle('is-active', next);
    }
    if (next) {
        renderConvertPriceHint(hintTextEl, lastConvertPricingPreview, true, !!referrerId);
        priceInput.focus();
        priceInput.select?.();
    } else {
        updateConvertPricePreview();
    }
}
window.toggleConvertManualPrice = toggleConvertManualPrice;

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

        // ⚡ Badge обновляется ТОЛЬКО из дашборда (там правильная статистика)
        // НЕ обновляем здесь, чтобы избежать неточностей из-за пагинации

        if (bookings.length === 0) {
            table.innerHTML = '<tr class="table-message"><td colspan="8">Нет заявок</td></tr>';
            renderBookingsPagination(0, page, 0);
            return;
        }

        const userRole = getUserRole();
        const isAdmin = ['admin', 'super_admin'].includes(userRole);

        // Показать/скрыть колонку "Действия"
        const actionsColumn = document.getElementById('bookingsActionsColumn');
        if (actionsColumn) {
            actionsColumn.style.display = isAdmin ? '' : 'none';
        }

        const canEditSource = isSuperAdmin();

        table.innerHTML = bookings.map(booking => `
        <tr data-booking-id="${booking._id}">
            <td data-label="Имя">
                <div class="card-field">
                    <span class="card-field-label">Имя</span>
                    <span class="card-field-value">${booking.name} ${booking.lastName || ''}</span>
                </div>
            </td>
            <td data-label="Телефон">
                <div class="card-field">
                    <span class="card-field-label">Телефон</span>
                    <span class="card-field-value">${getWhatsappLink(booking.phone)}</span>
                </div>
            </td>
            <td data-label="Направление">
                <div class="card-field">
                    <span class="card-field-label">Направление</span>
                    <span class="card-field-value">${booking.direction}</span>
                    ${booking.notes ? `<small style="display:block;margin-top:6px;white-space:pre-line;opacity:0.7;">${escapeBookingText(booking.notes)}</small>` : ''}
                    ${booking.appStatus ? `<small style="display:block;margin-top:6px;color:#d7ad4a;">Приложение: ${escapeBookingText(getAppBookingStatusText(booking.appStatus))}${booking.onlineTeacherName ? ` · ${escapeBookingText(booking.onlineTeacherName)}` : ''}${booking.onlineScheduledAt ? ` · ${formatDateTime(booking.onlineScheduledAt)}` : ''}</small>` : ''}
                </div>
            </td>
            <td data-label="Группа">
                <div class="card-field">
                    <span class="card-field-label">Группа</span>
                    <span class="card-field-value">${window.formatGroupScheduleOnly ? window.formatGroupScheduleOnly(booking.group) : (booking.group ? booking.group.name : '—')}</span>
                </div>
            </td>
            <td data-label="Источник">
                <div class="card-field">
                    <span class="card-field-label">Источник</span>
                    ${canEditSource ? `
                    <div class="card-field-value">
                        <select class="source-select" data-booking-id="${booking._id}" data-current-source="${booking.source || ''}">
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
                    ` : `<span class="card-field-value">${booking.source || '—'}</span>`}
                </div>
            </td>
            <td class="date-cell" data-label="Дата и время">
                <div class="card-field">
                    <span class="card-field-label">Дата и время</span>
                    <span class="card-field-value">${formatDateTime(booking.createdAt)}</span>
                </div>
            </td>
            <td class="status-cell status-${booking.status}" data-label="Статус">
                <div class="card-field">
                    <span class="card-field-label">Статус</span>
                    <div class="card-field-value">
                        <select class="status-select" data-booking-id="${booking._id}" data-current-status="${booking.status}">
                            <option value="new" ${booking.status === 'new' ? 'selected' : ''}>Новая</option>
                            <option value="processed" ${booking.status === 'processed' ? 'selected' : ''}>Думает</option>
                            <option value="trial" ${booking.status === 'trial' ? 'selected' : ''}>Пробное</option>
                            <option value="sold" ${booking.status === 'sold' ? 'selected' : ''}>Продано</option>
                            <option value="rejected" ${booking.status === 'rejected' ? 'selected' : ''}>Отклонено</option>
                        </select>
                    </div>
                </div>
            </td>
            ${isAdmin ? `
            <td class="table-actions" data-label="Действия">
                <div class="card-field">
                    <span class="card-field-label">Действия</span>
                    <div class="card-field-value">
                        ${booking.externalSourceId ? `<button class="table-btn" onclick="openOnlineLessonSchedule('${booking._id}')">${booking.appStatus === 'scheduled' ? 'Изменить онлайн' : 'Назначить онлайн'}</button>` : ''}
                        <button class="table-btn danger" onclick="deleteBooking('${booking._id}', '${booking.name} ${booking.lastName || ''}')">Удалить</button>
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

                // Для статуса "sold" сразу открываем модалку без подтверждения
                if (newStatus === 'sold') {
                    e.target.dataset.currentStatus = newStatus;
                    await changeBookingStatusDirect(bookingId, newStatus);
                    return;
                }

                // Подтверждение изменения для остальных статусов
                const confirmMessage = `Изменить статус заявки с "${getStatusText(currentStatus)}" на "${getStatusText(newStatus)}"?`;

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
        table.innerHTML = '<tr class="table-message"><td colspan="8" style="color:red;">Ошибка загрузки заявок</td></tr>';

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
            toast.error(`Ошибка: ${data.error || 'Не удалось изменить источник'}`);
            renderBookings(currentBookingFilter);
        }
    } catch (error) {
        toast.error('Ошибка подключения к серверу');
        renderBookings(currentBookingFilter);
    }
}

// Открыть модалку конвертации заявки
async function openConvertBookingModal(bookingId) {
    try {
        const token = getAuthToken();

        // ⚡ МОМЕНТАЛЬНО показываем модалку с загрузкой
        document.getElementById('convertBookingInfo').innerHTML = '<div style="text-align: center; padding: 20px; opacity: 0.5;">Загрузка...</div>';
        document.getElementById('convertGroupId').innerHTML = '<option value="">Загрузка групп...</option>';
        document.getElementById('convertBookingId').value = bookingId;
        document.getElementById('convertBookingModal').classList.add('show');

        // ⚡ ПАРАЛЛЕЛЬНО загружаем данные В ФОНЕ
        const [bookingData, groupsData] = await Promise.all([
            fetch(`${API_URL}/bookings/${bookingId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json()),
            fetch(`${API_URL}/groups`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json())
        ]);

        const booking = bookingData.booking;
        const allGroups = groupsData.groups || [];
        convertAllGroupsData = allGroups;

        // Заполнить информацию о заявке
        const genderText = booking.gender ? (booking.gender === 'male' ? 'Мужчина' : 'Женщина') : 'Не указан';
        document.getElementById('convertBookingInfo').innerHTML = `
            <strong style="display: block; margin-bottom: 8px;">Заявка:</strong>
            <div style="font-size: 0.95em; opacity: 0.9;">
                <div>Имя: ${booking.name} ${booking.lastName || ''}</div>
                <div>Телефон: ${booking.phone}</div>
                <div>Направление: ${booking.direction}</div>
                <div>Пол: ${genderText}</div>
            </div>
        `;

        // Заполнить список групп с расписанием
        const groupSelect = document.getElementById('convertGroupId');
        groupSelect.innerHTML = '<option value="">Выберите группу</option>';

        // Добавляем группы с pricing в data-атрибутах
        allGroups.forEach(group => {
            const option = document.createElement('option');
            option.value = group._id;
            option.textContent = window.formatGroupWithSchedule
                ? window.formatGroupWithSchedule(group)
                : `${group.name} (${group.direction})`;
            // Сохраняем цены из направления
            if (group.pricing) {
                option.dataset.pricingTrial = group.pricing.trial || 2000;
                option.dataset.pricingMonth = group.pricing.month || 22000;
                option.dataset.pricingThreeMonths = group.pricing.threeMonths || 55000;
            }
            groupSelect.appendChild(option);
        });

        document.getElementById('convertGender').value = booking.gender || '';

        // 💰 Сброс полей оплаты
        const fullRadio = document.querySelector('input[name="convertPaymentType"][value="full"]');
        if (fullRadio) fullRadio.checked = true;

        document.getElementById('convertAdvanceAmount').value = 0;
        document.getElementById('convertAdvanceDueDate').value = '';
        document.getElementById('convertLaterDueDate').value = '';
        document.getElementById('convertAdvanceGroup').style.display = 'none';
        document.getElementById('convertAdvanceDueDateGroup').style.display = 'none';
        document.getElementById('convertLaterDueDateGroup').style.display = 'none';

        // Сброс цены/подписи и предзаполнение реферера из заявки
        const convertPriceInput = document.getElementById('convertTotalPrice');
        if (convertPriceInput) {
            convertPriceInput.dataset.unlocked = '0';
            convertPriceInput.readOnly = true;
        }
        const convertUnlockBtn = document.getElementById('convertUnlockPrice');
        if (convertUnlockBtn) {
            convertUnlockBtn.textContent = 'изменить';
            convertUnlockBtn.classList.remove('is-active');
        }
        const convertHintText = document.getElementById('convertPriceHintText');
        if (convertHintText) convertHintText.innerHTML = '';
        lastConvertPricingPreview = null;

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
                        referrerSearch.value = `${rd.student.lastName || ''} ${rd.student.name || ''} · ${rd.student.phone || ''}`.trim();
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

        // ⚡ Пересчёт цен при открытии
        if (window.updateConvertTypeOptionLabels) updateConvertTypeOptionLabels();
        if (window.onConvertTypeChange) onConvertTypeChange();

        // Автоматически выбрать группу, если она была указана в заявке
        if (booking.group) {
            const preselectedGroupId = typeof booking.group === 'object' ? booking.group._id : booking.group;
            if (preselectedGroupId) {
                groupSelect.value = preselectedGroupId;
            }
        }

        // ⚡ Сразу обновляем подписи с ценами (группа уже выбрана)
        if (window.updateConvertTypeOptionLabels) {
            window.updateConvertTypeOptionLabels();
        }
        // Пересчитать цену в поле ввода на основе выбранной группы
        if (window.onConvertTypeChange) {
            window.onConvertTypeChange();
        }
        // Запросить preview с учётом группы и реферера — обновит поле цены и подсказку
        updateConvertPricePreview();

        const startDateInput = document.getElementById('convertMembershipStartDate');
        if (startDateInput) {
            const today = new Date();
            const formatted = today.toISOString().split('T')[0];
            startDateInput.value = formatted;
        }

        // 💰 По умолчанию "Полная оплата"
        const fullPaymentRadio = document.querySelector('input[name="convertPaymentType"][value="full"]');
        if (fullPaymentRadio) {
            fullPaymentRadio.checked = true;
            // Скрываем поля аванса
            const advGroup = document.getElementById('convertAdvanceGroup');
            const advDateGroup = document.getElementById('convertAdvanceDueDateGroup');
            if (advGroup) advGroup.style.display = 'none';
            if (advDateGroup) advDateGroup.style.display = 'none';
        }


    } catch (error) {
        document.getElementById('convertBookingInfo').innerHTML = '<div style="text-align: center; padding: 20px; color: #dc3545;">Ошибка загрузки</div>';
        toast.error('Ошибка при загрузке заявки');
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

        // Если статус "Продано" - открываем модалку конвертации
        if (newStatus === 'sold') {
            openConvertBookingModal(id);
            return;
        }

        // Phase 2: при переводе в "отклонено" — спросить причину/этап потери
        let extraBody = {};
        if (newStatus === 'rejected') {
            const loss = await window.openLossReasonDialog({
                title: 'Отклонение заявки — причина потери',
                withStage: true,
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
            toast.error(`Ошибка: ${data.error || 'Не удалось изменить статус'}`);
            // При ошибке возвращаем старое значение
            const select = document.querySelector(`[data-booking-id="${id}"]`);
            if (select) {
                select.value = select.dataset.currentStatus;
            }
        }
    } catch (error) {
        toast.error('Ошибка подключения к серверу');
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
                <p style="opacity:.7;margin-bottom:18px;">${escapeBookingText(booking.name)} ${escapeBookingText(booking.lastName)} · ${escapeBookingText(booking.direction)}</p>
                <form id="onlineLessonScheduleForm">
                    <div class="form-group">
                        <label>Преподаватель *</label>
                        <select id="onlineLessonTeacher" required>
                            <option value="">Выберите преподавателя</option>
                            ${linkedTeachers.map(teacher => `<option value="${teacher.id}" ${teacher.id === booking.onlineTeacherId ? 'selected' : ''}>${escapeBookingText(`${teacher.name} ${teacher.lastName || ''}`)}</option>`).join('')}
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

        toast.info(`Заявка #${id.slice(-6)}\n\nИмя: ${booking.name} ${booking.lastName || ''}\nТелефон: ${booking.phone}\nНаправление: ${booking.direction}\nСтатус: ${getStatusText(booking.status)}\nДата: ${new Date(booking.createdAt).toLocaleString('ru')}`);
    } catch (error) {
        toast.error('Ошибка загрузки заявки');
    }
}

// Удалить заявку
async function deleteBooking(bookingId, bookingName) {
    // Проверка прав
    const userRole = getUserRole();
    if (!['admin', 'super_admin'].includes(userRole)) {
        toast.warning('Доступ запрещен. Требуются права администратора.');
        return;
    }

    // Подтверждение
    const confirmMsg = `Удалить заявку от "${bookingName}"?\n\nЭто действие нельзя отменить!`;
    if (!await customConfirm(confirmMsg)) {
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

        // Выполняем запрос
        const response = await fetch(`${API_URL}/bookings/${bookingId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            toast.success(`Заявка удалена`);
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
            toast.error(`Ошибка: ${data.error || 'Не удалось удалить заявку'}`);
        }

    } catch (error) {
        toast.error('Ошибка подключения к серверу');
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

            // Загрузка направлений и групп параллельно
            try {
                const token = getAuthToken();
                const [directionsRes, groupsRes] = await Promise.all([
                    fetch(`${API_URL}/directions`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }).then(r => r.json()).catch(() => ({ directions: [] })),
                    fetch(`${API_URL}/groups`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }).then(r => r.json()).catch(() => ({ groups: [] }))
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

                // Заполняем группы
                const groupSelect = document.getElementById('bookingGroup');
                groupSelect.innerHTML = '<option value="">Выберите группу (необязательно)</option>';

                if (groupsRes.groups) {
                    if (window.formatGroupsForSelect) {
                        groupSelect.innerHTML += window.formatGroupsForSelect(groupsRes.groups);
                    } else {
                        groupsRes.groups.forEach(group => {
                            const option = document.createElement('option');
                            option.value = group._id;
                            option.textContent = `${group.name} (${group.direction})`;
                            groupSelect.appendChild(option);
                        });
                    }
                }
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
            const phone = document.getElementById('bookingPhone').value;
            const direction = document.getElementById('bookingDirection').value;
            const source = document.getElementById('bookingSource').value;
            const groupId = document.getElementById('bookingGroup').value;
            const groupSelect = document.getElementById('bookingGroup');
            const groupName = groupId ? groupSelect.options[groupSelect.selectedIndex].text : '—';
            const referrerStudentId = document.getElementById('bookingReferrerId')?.value || '';

            try {
                const token = getAuthToken();

                const response = await fetch(`${API_URL}/bookings/create-admin`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name, lastName, phone, direction, source, groupId,
                        referrerStudentId: referrerStudentId || undefined
                    })
                });

                const data = await response.json();
                console.log('📋 Create booking response:', response.status, data);

                if (data.success) {
                    // ✅ Закрываем модалку ТОЛЬКО после успешного сохранения
                    closeCreateBookingModal();

                    // ✨ Toast уведомление
                    toast.party('Заявка успешно создана!');

                    // ⚡ OPTIMISTIC UI: Добавляем новую строку В НАЧАЛО таблицы БЕЗ перерисовки
                    const table = document.getElementById('bookingsTable');
                    const booking = data.booking;
                    const userRole = getUserRole();
                    const isAdmin = ['admin', 'super_admin'].includes(userRole);
                    const canEditSource = isSuperAdmin();

                    const newRow = document.createElement('tr');
                    newRow.setAttribute('data-booking-id', booking._id);
                    newRow.innerHTML = `
                        <td data-label="Имя">
                            <div class="card-field">
                                <span class="card-field-label">Имя</span>
                                <span class="card-field-value">${booking.name} ${booking.lastName || ''}</span>
                            </div>
                        </td>
                        <td data-label="Телефон">
                            <div class="card-field">
                                <span class="card-field-label">Телефон</span>
                                <span class="card-field-value">${getWhatsappLink(booking.phone)}</span>
                            </div>
                        </td>
                        <td data-label="Направление">
                            <div class="card-field">
                                <span class="card-field-label">Направление</span>
                                <span class="card-field-value">${booking.direction}</span>
                            </div>
                        </td>
                        <td data-label="Группа">
                            <div class="card-field">
                                <span class="card-field-label">Группа</span>
                                <span class="card-field-value">${booking.group ? (typeof booking.group === 'object' ? (window.formatGroupScheduleOnly ? window.formatGroupScheduleOnly(booking.group) : booking.group.name) : '—') : '—'}</span>
                            </div>
                        </td>
                        <td data-label="Источник">
                            <div class="card-field">
                                <span class="card-field-label">Источник</span>
                                ${canEditSource ? `
                                <div class="card-field-value">
                                    <select class="source-select" data-booking-id="${booking._id}" data-current-source="${booking.source || ''}">
                                        <option value="" ${!booking.source ? 'selected' : ''}>Не указан</option>
                                        <option value="Телефонный звонок" ${booking.source === 'Телефонный звонок' ? 'selected' : ''}>Телефонный звонок</option>
                                        <option value="WhatsApp" ${booking.source === 'WhatsApp' ? 'selected' : ''}>WhatsApp</option>
                                        <option value="Instagram Direct" ${booking.source === 'Instagram Direct' ? 'selected' : ''}>Instagram Direct</option>
                                        <option value="Личное обращение" ${booking.source === 'Личное обращение' ? 'selected' : ''}>Личное обращение</option>
                                        <option value="Сайт" ${booking.source === 'Сайт' ? 'selected' : ''}>Сайт</option>
                                        <option value="Рекомендация" ${booking.source === 'Рекомендация' ? 'selected' : ''}>Рекомендация</option>
                                        <option value="1fit" ${booking.source === '1fit' ? 'selected' : ''}>1fit</option>
                                        <option value="Другое" ${booking.source === 'Другое' ? 'selected' : ''}>Другое</option>
                                    </select>
                                </div>
                                ` : `<span class="card-field-value">${booking.source || '—'}</span>`}
                            </div>
                        </td>
                        <td class="date-cell" data-label="Дата и время">
                            <div class="card-field">
                                <span class="card-field-label">Дата и время</span>
                                <span class="card-field-value">${formatDateTime(booking.createdAt)}</span>
                            </div>
                        </td>
                        <td class="status-cell status-${booking.status}" data-label="Статус">
                            <div class="card-field">
                                <span class="card-field-label">Статус</span>
                                <div class="card-field-value">
                                    <select class="status-select" data-booking-id="${booking._id}" data-current-status="${booking.status}">
                                        <option value="new" ${booking.status === 'new' ? 'selected' : ''}>Новая</option>
                                        <option value="processed" ${booking.status === 'processed' ? 'selected' : ''}>Думает</option>
                                        <option value="trial" ${booking.status === 'trial' ? 'selected' : ''}>Пробное</option>
                                        <option value="sold" ${booking.status === 'sold' ? 'selected' : ''}>Продано</option>
                                        <option value="rejected" ${booking.status === 'rejected' ? 'selected' : ''}>Отклонено</option>
                                    </select>
                                </div>
                            </div>
                        </td>
                        ${isAdmin ? `
                        <td class="table-actions" data-label="Действия">
                            <div class="card-field">
                                <span class="card-field-label">Действия</span>
                                <div class="card-field-value">
                                    <button class="table-btn danger" onclick="deleteBooking('${booking._id}', '${booking.name} ${booking.lastName || ''}')">Удалить</button>
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
                    `;

                    // Добавляем в начало таблицы
                    table.insertBefore(newRow, table.firstChild);

                    // Добавляем обработчики для новой строки
                    const statusSelect = newRow.querySelector('.status-select');
                    if (statusSelect) {
                        statusSelect.addEventListener('change', async (e) => {
                            const bookingId = e.target.dataset.bookingId;
                            const currentStatus = e.target.dataset.currentStatus;
                            const newStatus = e.target.value;

                            // Для статуса "sold" сразу открываем модалку без подтверждения
                            if (newStatus === 'sold') {
                                e.target.dataset.currentStatus = newStatus;
                                await changeBookingStatusDirect(bookingId, newStatus);
                                return;
                            }

                            const confirmMessage = `Изменить статус заявки с "${getStatusText(currentStatus)}" на "${getStatusText(newStatus)}"?`;

                            if (await customConfirm(confirmMessage, { icon: 'warning' })) {
                                e.target.dataset.currentStatus = newStatus;
                                await changeBookingStatusDirect(bookingId, newStatus);
                            } else {
                                e.target.value = currentStatus;
                            }
                        });
                    }

                    const sourceSelect = newRow.querySelector('.source-select');
                    if (sourceSelect) {
                        sourceSelect.addEventListener('change', async (e) => {
                            const bookingId = e.target.dataset.bookingId;
                            const currentSource = e.target.dataset.currentSource;
                            const newSource = e.target.value;

                            const confirmMessage = `Изменить источник с "${currentSource || 'Не указан'}" на "${newSource || 'Не указан'}"?`;

                            if (await customConfirm(confirmMessage, { icon: 'warning' })) {
                                e.target.dataset.currentSource = newSource;
                                await changeBookingSource(bookingId, newSource);
                            } else {
                                e.target.value = currentSource;
                            }
                        });
                    }

                    // Обновляем badge в фоне
                    setTimeout(() => {
                        if (window.fetchNewBookingsCount) window.fetchNewBookingsCount();
                    }, 0);
                } else {
                    toast.error(`Ошибка: ${data.error || 'Не удалось создать заявку'}`);
                }
            } catch (error) {
                toast.error('Ошибка подключения к серверу');
            }
        });
    }
}

// Инициализация обработчика формы конвертации
function initBookingConversion() {
    // 💰 Обработчик для radio buttons оплаты (конвертация)
    const convertPaymentRadios = document.querySelectorAll('input[name="convertPaymentType"]');
    const convertAdvanceGroup = document.getElementById('convertAdvanceGroup');
    const convertAdvanceDueDateGroup = document.getElementById('convertAdvanceDueDateGroup');
    const convertLaterDueDateGroup = document.getElementById('convertLaterDueDateGroup');

    if (convertPaymentRadios && convertAdvanceGroup && convertAdvanceDueDateGroup) {
        const convertPaymentMethodGroup = document.getElementById('convertPaymentMethodGroup');
        convertPaymentRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                convertAdvanceGroup.style.display = e.target.value === 'advance' ? 'block' : 'none';
                convertAdvanceDueDateGroup.style.display = e.target.value === 'advance' ? 'block' : 'none';
                if (convertLaterDueDateGroup) {
                    convertLaterDueDateGroup.style.display = e.target.value === 'later' ? 'block' : 'none';
                }
                if (convertPaymentMethodGroup) {
                    convertPaymentMethodGroup.style.display = e.target.value === 'later' ? 'none' : 'block';
                }
            });
        });
    }

    // Автоподстановка цены при выборе типа абонемента (модалка конвертации)
    const convertTypeSelect = document.getElementById('convertMembershipType');
    const convertGroupEl = document.getElementById('convertGroupId');

    // Вспомогательная функция: обновляет подписи в списке типов С ЦЕНАМИ И ТАРИФАМИ из БД
    function updateConvertTypeOptionLabels() {
        if (!convertTypeSelect || !convertGroupEl) return;
        const groupId = convertGroupEl.value;
        const fullGroup = convertAllGroupsData && convertAllGroupsData.find(g => g._id === groupId);

        const fmt = n => new Intl.NumberFormat('ru-RU').format(n);
        const currentType = convertTypeSelect.value;

        if (fullGroup && fullGroup.plans && fullGroup.plans.length > 0) {
            convertTypeSelect.innerHTML = '';
            fullGroup.plans.forEach(plan => {
                const option = document.createElement('option');
                option.value = plan.type;
                option.textContent = `${plan.label} — ${fmt(plan.price)} ₸`;
                option.dataset.price = plan.price;
                if (plan.type === currentType) option.selected = true;
                convertTypeSelect.appendChild(option);
            });
        } else {
            // Фолбек
            const selectedOption = convertGroupEl.options[convertGroupEl.selectedIndex];
            const p = {
                trial:       parseInt(selectedOption?.dataset.pricingTrial)       || 2000,
                month:       parseInt(selectedOption?.dataset.pricingMonth)       || 22000,
                threeMonths: parseInt(selectedOption?.dataset.pricingThreeMonths) || 55000,
            };

            const LABELS = {
                trial:              { text: 'Пробное (1 занятие)',              price: p.trial },
                single_class:       { text: 'Разовое занятие (1 занятие)',      price: 3500 },
                monthly:            { text: 'Месячный (8 занятий)',             price: p.month },
                monthly_12:         { text: 'Месячный (12 занятий)',            price: p.month },
                quarterly:          { text: 'Квартальный (24 занятия)',         price: p.threeMonths },
                individual_single:  { text: 'Индивидуальное разовое (1)',       price: 10000 },
                individual_package: { text: 'Индивидуальный абонемент (8)',     price: 55900 },
            };

            convertTypeSelect.innerHTML = '';
            Object.entries(LABELS).forEach(([key, cfg]) => {
                const option = document.createElement('option');
                option.value = key;
                option.textContent = `${cfg.text} — ${fmt(cfg.price)} ₸`;
                option.dataset.price = cfg.price;
                if (key === currentType) option.selected = true;
                convertTypeSelect.appendChild(option);
            });
        }

        if (!convertTypeSelect.value && convertTypeSelect.options.length > 0) {
            convertTypeSelect.selectedIndex = 0;
        }
    }

    const onConvertTypeChange = () => {
        const type = convertTypeSelect?.value;
        const priceInput = document.getElementById('convertTotalPrice');
        if (!type || !priceInput) return;

        const currentOpt = convertTypeSelect.options[convertTypeSelect.selectedIndex];
        if (currentOpt?.dataset.price) {
            priceInput.value = currentOpt.dataset.price;
        }
    };

    if (convertTypeSelect) {
        convertTypeSelect.addEventListener('change', () => {
            onConvertTypeChange();
            updateConvertPricePreview();
        });
    }
    if (convertGroupEl) {
        convertGroupEl.addEventListener('change', () => {
            updateConvertTypeOptionLabels();
            onConvertTypeChange(); // пересчитать цену поля ввода тоже
            updateConvertPricePreview();
        });
        // Также вызываем при открытии, когда группа уже выбрана
        convertGroupEl.addEventListener('focus', updateConvertTypeOptionLabels, { once: false });
    }

    // Делаем функцию доступной для вызова из openConvertBookingModal
    window.updateConvertTypeOptionLabels = updateConvertTypeOptionLabels;
    window.onConvertTypeChange = onConvertTypeChange;

    // Кнопка-ссылка «изменить» — переключает ручной режим ввода цены
    const convertUnlockBtn = document.getElementById('convertUnlockPrice');
    if (convertUnlockBtn) {
        convertUnlockBtn.addEventListener('click', () => toggleConvertManualPrice());
    }

    // Автокомплит реферера в модалке конвертации
    attachReferrerAutocomplete('convertReferrerSearch', 'convertReferrerId', 'convertReferrerResults', () => updateConvertPricePreview());

    const convertForm = document.getElementById('convertBookingForm');
    if (convertForm) {
        convertForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const bookingId = document.getElementById('convertBookingId').value;
            const gender = document.getElementById('convertGender').value;
            const groupId = document.getElementById('convertGroupId').value;
            const membershipType = document.getElementById('convertMembershipType').value;
            const startDate = document.getElementById('convertMembershipStartDate').value;

            // 💰 Получить payment данные
            const totalPrice = parseInt(document.getElementById('convertTotalPrice')?.value) || 0;
            const paymentType = document.querySelector('input[name="convertPaymentType"]:checked')?.value || 'full';
            const advanceAmount = parseInt(document.getElementById('convertAdvanceAmount')?.value) || 0;
            const advanceDueDate = document.getElementById('convertAdvanceDueDate')?.value;
            const laterDueDate = document.getElementById('convertLaterDueDate')?.value;
            const paymentMethod = document.getElementById('convertPaymentMethod')?.value || '';
            const convertPriceInputEl = document.getElementById('convertTotalPrice');
            const convertUnlockChecked = convertPriceInputEl?.dataset.unlocked === '1';
            const convertReferrerId = document.getElementById('convertReferrerId')?.value || '';

            // Валидация обязательных полей
            if (!gender) {
                toast.warning('Выберите пол ученика');
                return;
            }
            if (!groupId) {
                toast.warning('Выберите группу для ученика');
                return;
            }
            if (!membershipType) {
                toast.warning('Выберите тип абонемента');
                return;
            }
            if (!startDate) {
                toast.warning('Укажите дату начала абонемента');
                return;
            }

            // 💰 Валидация payment данных
            if (paymentType === 'advance' && (!advanceAmount || !advanceDueDate)) {
                toast.warning('Укажите сумму аванса и срок оплаты остатка');
                return;
            }
            if (paymentType === 'later' && !laterDueDate) {
                toast.warning('Укажите срок оплаты (Оплатить до)');
                return;
            }

            try {
                const token = getAuthToken();

                // ⚡ МОМЕНТАЛЬНО закрываем модалку конвертации
                closeConvertBookingModal();

                // ⚡ СРАЗУ показываем модалку результата с "Создание..."
                showStudentCreatedModal('Создание ученика...', '', 'Загрузка...', 0, membershipType, false, null);

                // ⚡ ПАРАЛЛЕЛЬНО выполняем конвертацию и загрузку группы В ФОНЕ
                const [convertData, groupData] = await Promise.all([
                    fetch(`${API_URL}/bookings/${bookingId}/convert`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            gender,
                            groupId,
                            membershipType,
                            startDate,
                            // totalPrice отправляем только если пользователь вручную разблокировал цену —
                            // иначе backend пересчитает сам из basePrice + скидок
                            totalPrice: convertUnlockChecked ? totalPrice : undefined,
                            paymentType,
                            advanceAmount: paymentType === 'advance' ? advanceAmount : undefined,
                            advanceDueDate: paymentType === 'advance' && advanceDueDate ? advanceDueDate
                                : paymentType === 'later' && laterDueDate ? laterDueDate
                                : undefined,
                            paymentMethod: paymentType !== 'later' ? (paymentMethod || undefined) : undefined,
                            basePriceOverride: convertUnlockChecked && totalPrice > 0 ? totalPrice : undefined,
                            // Ручная цена — финальная, сервер не должен накидывать скидки сверху
                            skipConcession: convertUnlockChecked ? true : undefined,
                            referrerStudentId: convertReferrerId || undefined
                        })
                    }).then(r => r.json()),
                    fetch(`${API_URL}/groups/${groupId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }).then(r => r.json()).catch(() => null)
                ]);

                if (convertData.success) {
                    const pwd = convertData.generatedPassword || 'changeme123';
                    const studentName = convertData.student.name;
                    const studentPhone = convertData.student.phone;
                    const classesCount = convertData.membership.classesRemaining;
                    const membershipType = convertData.membership.type;
                    const platformInfo = convertData.platform?.login
                        ? { login: convertData.platform.login, url: 'https://maestro-school.duckdns.org' }
                        : null;

                    // Информация о группе
                    let groupInfo = null;
                    if (groupData && groupData.group) {
                        groupInfo = {
                            name: groupData.group.name,
                            schedule: groupData.group.schedule
                        };
                    }

                    // Копируем пароль в буфер
                    const copySuccess = await copyToClipboard(pwd);

                    // Удаляем ВСЕ существующие модалки с z-index 10002 (могут быть дубликаты)
                    document.querySelectorAll('[style*="z-index: 10002"]').forEach(modal => modal.remove());

                    // Показываем РЕАЛЬНУЮ модалку с данными
                    showStudentCreatedModal(studentName, studentPhone, pwd, classesCount, membershipType, copySuccess, groupInfo, platformInfo);

                    // 🎉 Toast уведомление
                    toast.party('Ученик успешно создан!');

                    // Обновляем статус заявки в списке на "Продано" (не удаляем!)
                    const bookingRow = document.querySelector(`tr[data-booking-id="${bookingId}"]`);
                    if (bookingRow) {
                        // Обновляем статус в select
                        const statusSelect = bookingRow.querySelector('.status-select');
                        if (statusSelect) {
                            statusSelect.value = 'sold';
                            statusSelect.dataset.currentStatus = 'sold';
                        }

                        // Обновляем цвет статуса
                        const statusCell = bookingRow.querySelector('.status-cell');
                        if (statusCell) {
                            statusCell.className = 'status-cell status-sold';
                        }
                    }

                    // Обновляем списки в фоне
                    setTimeout(() => {
                        // Обновляем заявки с сохранением текущих фильтров и поиска
                        // Заявка останется в списке со статусом 'sold' для статистики и отслеживания
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
                    toast.error(`Ошибка: ${convertData.error || 'Не удалось создать ученика'}`);
                }
            } catch (error) {
                console.error('Ошибка конвертации на клиенте:', error);
                // Удаляем ВСЕ loading модалки
                document.querySelectorAll('[style*="z-index: 10002"]').forEach(modal => modal.remove());
                toast.error(`Ошибка при конвертации: ${error.message || 'Неизвестная ошибка'}`);
            }
        });
    }
}
