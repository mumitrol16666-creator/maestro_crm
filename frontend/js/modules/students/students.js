// =====================================================
// STUDENTS MODULE - Управление учениками
// =====================================================

// Переменная для хранения всех учеников и их статистики
let allStudentsData = [];
let currentStudentFilter = 'active';
let currentViewingStudentId = null;
let currentViewingStudentStatus = null;
let currentViewingStudentRecord = null;
let selectedStudentMembershipId = null;
let currentStudentPage = 1;
let currentStudentSearch = '';
let currentStudentSort = 'name';
let currentStudentSortOrder = 'asc';

function getWhatsappLink(phone) {
    const raw = (phone || '').toString();
    const safeRaw = escapeHtml(raw);
    const digits = raw.replace(/[^0-9+]/g, '').replace(/^\+/, '');
    if (!digits) {
        return `<span class="phone-contact"><span class="phone-number">${safeRaw || '—'}</span></span>`;
    }
    const waNumber = digits.startsWith('7') || digits.startsWith('8') ? `7${digits.slice(1)}` : digits;
    const waUrl = `https://wa.me/${waNumber}`;

    return `
        <span class="phone-contact">
            <span class="phone-number">${safeRaw}</span>
            <a class="phone-whatsapp" href="${waUrl}" target="_blank" rel="noopener" aria-label="Написать в WhatsApp" title="Написать в WhatsApp">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" fill="#25D366"/>
                </svg>
            </a>
        </span>
    `;
}

function formatStudentFio(student) {
    return [student?.lastName, student?.name, student?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ');
}

function renderStudentFioWithAge(student, fallback = 'Ученик') {
    const fio = formatStudentFio(student) || fallback;
    const ageBadge = typeof renderStudentAgeBadge === 'function' ? renderStudentAgeBadge(student?.dateOfBirth) : '';
    return `${escapeHtml(fio)}${ageBadge}`;
}

function formatStudentDate(dateValue) {
    if (!dateValue) return 'Не указана';
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return 'Не указана';
    return date.toLocaleDateString('ru-RU');
}

function toDateInputValue(dateValue) {
    if (!dateValue) return '';
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
}

function getStudentId(student) {
    return student?._id || student?.id || student?.studentId || '';
}

function normalizeStudentRecord(student) {
    const id = getStudentId(student);
    return {
        ...(student || {}),
        id: student?.id || id,
        _id: id,
    };
}

function getStudentStatusLabel(studentOrStatus) {
    const student = typeof studentOrStatus === 'object' ? studentOrStatus : null;
    const status = student ? student.status : studentOrStatus;
    if (student?.lostAt) return 'Завершил обучение';
    if (status !== 'active' && student?.pausedUntil) {
        const date = new Date(student.pausedUntil);
        if (!Number.isNaN(date.getTime())) {
            return `На паузе до ${date.toLocaleDateString('ru-RU')}`;
        }
    }
    return status === 'active' ? 'Активен' : 'На паузе';
}

const STUDENT_PROFILE_ACTION_ICONS = {
    pause: `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="8" y1="5" x2="8" y2="19"></line>
            <line x1="16" y1="5" x2="16" y2="19"></line>
        </svg>
    `,
    resume: `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m7 4 13 8-13 8Z"></path>
        </svg>
    `,
    edit: `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
    `,
};

function setStudentProfileActionIcon(button, icon, label) {
    if (!button) return;
    button.innerHTML = STUDENT_PROFILE_ACTION_ICONS[icon] || '';
    button.title = label;
    button.setAttribute('aria-label', label);
}

function updateStudentEditButton(isEditing = false) {
    const button = document.getElementById('editStudentBtn');
    if (!button) return;
    setStudentProfileActionIcon(
        button,
        'edit',
        isEditing ? 'Закрыть редактирование' : 'Редактировать профиль',
    );
    button.classList.toggle('is-editing', isEditing);
    button.setAttribute('aria-pressed', String(isEditing));
}

function updateStudentPauseButton(student) {
    const btn = document.getElementById('pauseStudentBtn');
    if (!btn) return;
    const isFormer = student?.status === 'inactive' && Boolean(student?.lostAt);
    btn.style.display = isFormer ? 'none' : '';
    const isPaused = student?.status !== 'active';
    setStudentProfileActionIcon(
        btn,
        isPaused ? 'resume' : 'pause',
        isPaused ? 'Вернуть ученика в активные' : 'Поставить ученика на паузу',
    );
    btn.classList.toggle('is-paused', isPaused);
    btn.setAttribute('aria-pressed', String(isPaused));
    btn.disabled = !getStudentId(student);
    const finishBtn = document.getElementById('finishStudentEducationBtn');
    if (finishBtn) {
        const canFinishEducation = student?.status === 'active';
        finishBtn.style.display = canFinishEducation ? '' : 'none';
        const footer = finishBtn.closest('.student-detail-footer-actions');
        if (footer) footer.style.display = canFinishEducation ? '' : 'none';
        finishBtn.disabled = !getStudentId(student);
    }
}

function openFinishStudentEducationModal() {
    if (!currentViewingStudentId) return;
    document.getElementById('finishStudentEducationModal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'finishStudentEducationModal';
    modal.className = 'modal show student-departure-modal';
    modal.innerHTML = `
        <div class="modal-overlay" data-close-departure-modal></div>
        <div class="modal-content student-departure-dialog">
            <button type="button" class="modal-close" data-close-departure-modal>×</button>
            <p class="student-departure-eyebrow">ЗАВЕРШЕНИЕ ОБУЧЕНИЯ</p>
            <h2>Перевести в бывшие ученики</h2>
            <p class="student-departure-description">История уроков и оплат сохранится. Доступ, расписание, активные абонементы, группы и педагог будут сняты.</p>
            <form id="finishStudentEducationForm">
                <div class="form-group">
                    <label>ПРИЧИНА УХОДА *</label>
                    <select class="admin-input" name="reason" required>
                        <option value="">Выберите причину</option>
                        <option value="stopped">Забросил обучение</option>
                        <option value="other_school">Перешёл в другую школу</option>
                        <option value="moved">Переехал</option>
                        <option value="schedule">Не подошло расписание</option>
                        <option value="price">Не подошла стоимость</option>
                        <option value="health">По состоянию здоровья</option>
                        <option value="no_contact">Не выходит на связь</option>
                        <option value="test_record">Тестовая карточка</option>
                        <option value="other">Другая причина</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>КОММЕНТАРИЙ</label>
                    <textarea class="admin-input" name="note" rows="4" placeholder="Что произошло и что важно знать при возможном возвращении"></textarea>
                </div>
                <div class="student-departure-actions">
                    <button type="button" class="admin-btn btn-secondary" data-close-departure-modal>Отмена</button>
                    <button type="submit" class="admin-btn btn-danger">Завершить обучение</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-close-departure-modal]').forEach(control => {
        control.addEventListener('click', () => modal.remove());
    });
    modal.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault();
        const submit = event.submitter;
        if (submit) submit.disabled = true;
        const formData = new FormData(event.currentTarget);
        try {
            const response = await fetch(`${API_URL}/students/${currentViewingStudentId}/finish-education`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${getAuthToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    reason: formData.get('reason'),
                    note: formData.get('note'),
                }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Не удалось завершить обучение');
            modal.remove();
            closeStudentDetailModal();
            invalidateCache('dashboard', 'students', 'groups', 'membership-actions', 'analytics');
            toast.success(data.message);
            await renderStudents(currentStudentSearch, 1, currentStudentFilter);
        } catch (error) {
            toast.error(error.message);
            if (submit) submit.disabled = false;
        }
    });
}

function showStudentDetailModal() {
    const modal = document.getElementById('studentDetailModal');
    if (!modal) return null;
    modal.style.removeProperty('display');
    modal.style.removeProperty('visibility');
    modal.style.removeProperty('opacity');
    modal.style.removeProperty('pointer-events');
    modal.style.removeProperty('z-index');
    modal.querySelector('.modal-content')?.removeAttribute('style');
    modal.classList.add('show');
    return modal;
}

function normalizeSecureMediaUrl(url) {
    const value = String(url || '').trim();
    if (!value) return '';
    if (window.location.protocol === 'https:' && value.startsWith('http://')) {
        return value.replace(/^http:\/\//i, 'https://');
    }
    return value;
}

async function parseStudentJsonResponse(response, fallbackMessage) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || fallbackMessage || 'Не удалось загрузить данные');
    }
    return data;
}

// Отобразить учеников
async function renderStudents(searchQuery = '', page = 1, filter = currentStudentFilter) {
    const table = document.getElementById('studentsTable');
    const requestedFilter = filter || currentStudentFilter || 'active';

    // Если таблица не существует (вкладка не активна), просто обновляем состояние
    if (!table) {
        currentStudentSearch = searchQuery;
        currentStudentPage = page;
        currentStudentFilter = requestedFilter;
        return;
    }

    table.innerHTML = '<tr class="table-message"><td colspan="7">Загрузка...</td></tr>';

    // Показать прогресс-бар
    if (window.showLoading) {
        window.showLoading();
    }

    currentStudentSearch = searchQuery;
    currentStudentPage = page;

    // ⚡ Загружаем с пагинацией и фильтром
    const apiFilter = requestedFilter === 'with-debt' ? 'with_debt' : requestedFilter;
    let url = `${API_URL}/students?role=student&status=active&search=${encodeURIComponent(searchQuery)}&page=${page}&limit=20&sortBy=${currentStudentSort}&sortOrder=${currentStudentSortOrder}`;
    if (apiFilter && (apiFilter === 'with_debt' || apiFilter === 'overdue' || apiFilter === 'lost')) {
        url += `&filter=${apiFilter}`;
    }
    currentStudentFilter = requestedFilter;
    updateStudentSortHeaders();

    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${getAuthToken()}` }
    });

    const data = await response.json();
    const students = (data.students || [])
        .map(normalizeStudentRecord)
        .filter(student => student._id);

    if (students.length === 0) {
        allStudentsData = [];
        table.innerHTML = '<tr class="table-message"><td colspan="7">Нет учеников</td></tr>';
        renderStudentsPagination(0, page, 0);
        return;
    }

    // ⚡ Показываем учеников сразу
    renderStudentsTable(students, {});

    // ⚡ Рендерим пагинацию
    renderStudentsPagination(data.total, page, data.pages);

    // Загружаем статистику в фоне
    try {
        const studentIds = students.map(getStudentId).filter(Boolean);
        const statsResponse = await fetch(`${API_URL}/students/stats/batch-light`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ studentIds })
        });

        if (statsResponse.ok) {
            const statsData = await statsResponse.json();
            const statsMap = statsData.stats || {};
            // Обновляем таблицу со статистикой
            renderStudentsTable(students, statsMap);
        }
    } catch (error) {
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

function sortStudentsBy(sortBy) {
    const allowedSorts = new Set(['name', 'phone', 'teacher', 'balance']);
    if (!allowedSorts.has(sortBy)) return;

    if (currentStudentSort === sortBy) {
        currentStudentSortOrder = currentStudentSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        currentStudentSort = sortBy;
        currentStudentSortOrder = 'asc';
    }

    updateStudentSortHeaders();
    renderStudents(currentStudentSearch, 1, currentStudentFilter);
}

function updateStudentSortHeaders() {
    document.querySelectorAll('[data-student-sort]').forEach(button => {
        const active = button.dataset.studentSort === currentStudentSort;
        button.classList.toggle('active', active);
        button.setAttribute('aria-sort', active
            ? (currentStudentSortOrder === 'asc' ? 'ascending' : 'descending')
            : 'none');
        const icon = button.querySelector('.student-sort-icon');
        if (icon) {
            icon.textContent = active
                ? (currentStudentSortOrder === 'asc' ? '↑' : '↓')
                : '↕';
        }
    });
}

// Рендер пагинации для учеников
function renderStudentsPagination(total, currentPage, totalPages) {
    const container = document.getElementById('studentsPagination');
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
            renderStudents(currentStudentSearch, page, currentStudentFilter);
        });
    });
}

function getStudentLinkBadge(student) {
    const status = student.externalLinkStatus || (student.appUserId ? 'linked' : null);
    if ((!status && !student.appUserId) || status === 'unlinked') return '';
    const labels = {
        linked: { text: 'Есть вход в приложение', cls: 'student-link-badge--linked', icon: 'platform-ok' },
        pending: { text: 'Подключение приложения ожидается', cls: 'student-link-badge--pending', icon: 'platform-wait' },
        conflict: { text: 'Конфликт связи с приложением', cls: 'student-link-badge--conflict', icon: 'platform-alert' },
        manual_review: { text: 'Связь с приложением требует проверки', cls: 'student-link-badge--review', icon: 'platform-alert' },
        unlinked: { text: 'Нет входа в приложение', cls: 'student-link-badge--unlinked', icon: 'platform-off' },
    };
    const key = status || 'unlinked';
    const meta = labels[key] || labels.unlinked;
    return `
        <span class="student-link-badge student-status-icon ${meta.cls}" title="${escapeHtml(meta.text)}"
            role="img" tabindex="0" aria-label="${escapeHtml(meta.text)}">
            ${renderStudentStatusIcon(meta.icon)}
        </span>
    `;
}

const STUDENT_LINK_STATUS_META = {
    linked: { text: 'Связан', color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
    pending: { text: 'Ожидает связывания', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    conflict: { text: 'Конфликт', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
    manual_review: { text: 'Ручная проверка', color: '#a855f7', bg: 'rgba(168,85,247,0.12)' },
    unlinked: { text: 'Не связан', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
};

function renderStudentIntegrationBlock(student) {
    const el = document.getElementById('studentIntegrationInfo');
    if (!el) return;

    const status = student.externalLinkStatus || (student.appUserId ? 'linked' : 'unlinked');
    const meta = STUDENT_LINK_STATUS_META[status] || STUDENT_LINK_STATUS_META.unlinked;
    const linkedAt = student.linkedAt
        ? new Date(student.linkedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '—';
    const crmId = getStudentId(student);
    const escapedCrmId = escapeHtml(crmId);
    const canManage = ['super_admin', 'admin', 'sales', 'sales_manager'].includes(getUserRole());
    const isLinked = status === 'linked' && student.appUserId;
    const canRebind = canManage && (isLinked || status === 'manual_review' || status === 'conflict');

    el.innerHTML = `
        <div class="student-integration-grid">
            <div class="student-info-item">
                <span class="student-info-label">Статус связи</span>
                <span class="student-info-value">
                    <span class="student-integration-status" style="color:${meta.color};background:${meta.bg};border:1px solid ${meta.color}33;">
                        ${meta.text}
                    </span>
                </span>
            </div>
            <div class="student-info-item">
                <span class="student-info-label">Аккаунт приложения</span>
                <span class="student-info-value">${isLinked ? 'Подключён' : 'Не подключён'}</span>
            </div>
            <div class="student-info-item">
                <span class="student-info-label">Дата подключения</span>
                <span class="student-info-value">${linkedAt}</span>
            </div>
            <div class="student-info-item">
                <span class="student-info-label">Фото профиля</span>
                <span class="student-info-value">${student.studentAvatar ? 'Синхронизировано' : 'Не загружено'}</span>
            </div>
        </div>
        <div id="studentIntegrationCheckResult" class="student-integration-check" style="display:none;"></div>
        <div class="student-integration-actions">
            <button type="button" class="admin-btn btn-secondary" onclick="checkStudentPlatformLink('${escapedCrmId}')">Проверить связь</button>
            ${canManage && !isLinked ? `<button type="button" class="admin-btn btn-primary" onclick="openStudentPlatformAccessDialog('${escapedCrmId}', 'create')">Создать аккаунт ученика</button>` : ''}
            ${canManage && !isLinked ? `<button type="button" class="admin-btn btn-secondary" onclick="linkStudentToPlatform('${escapedCrmId}')">Связать по телефону</button>` : ''}
            ${canManage && isLinked ? `<button type="button" class="admin-btn btn-secondary" onclick="openStudentPlatformAccessDialog('${escapedCrmId}', 'reset')">Изменить пароль</button>` : ''}
            ${canRebind ? `<button type="button" class="admin-btn btn-secondary" onclick="rebindStudentToPlatform('${escapedCrmId}')">Перепривязать аккаунт</button>` : ''}
            ${isLinked ? `<button type="button" class="admin-btn btn-primary" onclick="openStudentInPlatform('${escapedCrmId}')">Открыть в платформе</button>` : ''}
        </div>
    `;
}

async function checkStudentPlatformLink(studentId) {
    const resultEl = document.getElementById('studentIntegrationCheckResult');
    if (!resultEl) return;
    resultEl.style.display = 'block';
    resultEl.innerHTML = '<span style="opacity:0.6;">Проверка...</span>';
    try {
        const response = await fetch(`${API_URL}/students/${studentId}/link-status`, {
            headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            resultEl.innerHTML = `<span style="color:#ef4444;">${escapeHtml(data.error || 'Ошибка проверки')}</span>`;
            return;
        }
        const combined = data.data?.status || 'unlinked';
        const meta = STUDENT_LINK_STATUS_META[combined] || STUDENT_LINK_STATUS_META.unlinked;
        const appUser = data.data?.app?.appUser;
        const appLine = appUser
            ? `${escapeHtml(appUser.firstName || '')} ${escapeHtml(appUser.lastName || '')} (${escapeHtml(appUser.phone || '')})`
            : 'Аккаунт в платформе не найден';
        resultEl.innerHTML = `
            <div style="padding:10px 12px;border-radius:8px;background:${meta.bg};border:1px solid ${meta.color}33;font-size:0.88em;">
                <div style="color:${meta.color};font-weight:600;margin-bottom:4px;">Статус подключения: ${meta.text}</div>
                <div style="opacity:0.85;">Платформа: ${appLine}</div>
            </div>
        `;
    } catch (error) {
        resultEl.innerHTML = `<span style="color:#ef4444;">${escapeHtml(error.message)}</span>`;
    }
}

function generateStudentPlatformPassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const values = new Uint32Array(10);
    if (window.crypto?.getRandomValues) {
        window.crypto.getRandomValues(values);
    } else {
        for (let i = 0; i < values.length; i += 1) values[i] = Math.floor(Math.random() * alphabet.length);
    }
    return Array.from(values, value => alphabet[value % alphabet.length]).join('');
}

function closeStudentPlatformModal(modalId) {
    document.getElementById(modalId)?.remove();
}

function openStudentPlatformAccessDialog(studentId, mode = 'create') {
    closeStudentPlatformModal('studentPlatformAccessModal');
    const student = currentViewingStudentRecord && getStudentId(currentViewingStudentRecord) === String(studentId)
        ? currentViewingStudentRecord
        : { id: studentId };
    const isReset = mode === 'reset';
    const modal = document.createElement('div');
    modal.id = 'studentPlatformAccessModal';
    modal.className = 'student-platform-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'studentPlatformAccessTitle');
    modal.innerHTML = `
        <div class="student-platform-modal__backdrop" data-close-platform-modal></div>
        <form class="student-platform-modal__panel" id="studentPlatformAccessForm">
            <div class="student-platform-modal__header">
                <div>
                    <span class="student-platform-modal__eyebrow">Обучающая платформа</span>
                    <h3 id="studentPlatformAccessTitle">${isReset ? 'Изменить пароль' : 'Создать аккаунт ученика'}</h3>
                </div>
                <button type="button" class="student-platform-modal__icon-btn" data-close-platform-modal aria-label="Закрыть" title="Закрыть">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
                </button>
            </div>
            <p class="student-platform-modal__student">${escapeHtml(formatStudentFio(student) || 'Ученик')}</p>
            <label class="student-platform-password">
                <span>Пароль для входа</span>
                <div class="student-platform-password__control">
                    <input id="studentPlatformPasswordInput" type="password" minlength="8" maxlength="128"
                        value="${escapeHtml(generateStudentPlatformPassword())}" autocomplete="new-password" required>
                    <button type="button" id="toggleStudentPlatformPassword" class="student-platform-modal__icon-btn"
                        aria-label="Показать пароль" title="Показать пароль">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                    <button type="button" id="generateStudentPlatformPassword" class="student-platform-modal__icon-btn"
                        aria-label="Сгенерировать пароль" title="Сгенерировать пароль">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v6h-6"/></svg>
                    </button>
                </div>
                <small>Минимум 8 символов. Его можно заменить на свой.</small>
            </label>
            <div id="studentPlatformAccessError" class="student-platform-modal__error" aria-live="polite"></div>
            <div class="student-platform-modal__actions">
                <button type="button" class="admin-btn btn-secondary" data-close-platform-modal>Отмена</button>
                <button type="submit" class="admin-btn btn-primary" id="studentPlatformAccessSubmit">
                    ${isReset ? 'Сохранить пароль' : 'Создать аккаунт'}
                </button>
            </div>
        </form>
    `;
    document.body.appendChild(modal);

    const input = modal.querySelector('#studentPlatformPasswordInput');
    modal.querySelectorAll('[data-close-platform-modal]').forEach(button => {
        button.addEventListener('click', () => closeStudentPlatformModal(modal.id));
    });
    modal.querySelector('#toggleStudentPlatformPassword').addEventListener('click', (event) => {
        const visible = input.type === 'text';
        input.type = visible ? 'password' : 'text';
        event.currentTarget.title = visible ? 'Показать пароль' : 'Скрыть пароль';
        event.currentTarget.setAttribute('aria-label', event.currentTarget.title);
    });
    modal.querySelector('#generateStudentPlatformPassword').addEventListener('click', () => {
        input.value = generateStudentPlatformPassword();
        input.type = 'text';
        input.focus();
        input.select();
    });
    modal.querySelector('#studentPlatformAccessForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        await provisionStudentPlatform(studentId, input.value, mode, modal);
    });
    requestAnimationFrame(() => {
        input.focus();
        input.select();
    });
}

async function provisionStudentPlatform(studentId, password, mode = 'create', modal = null) {
    const errorEl = modal?.querySelector('#studentPlatformAccessError');
    const submitButton = modal?.querySelector('#studentPlatformAccessSubmit');
    if (password.length < 8 || password.length > 128) {
        if (errorEl) errorEl.textContent = 'Пароль должен содержать от 8 до 128 символов';
        return;
    }
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Сохранение...';
    }
    try {
        const endpoint = mode === 'reset' ? 'platform-password' : 'provision-platform';
        const response = await fetch(`${API_URL}/students/${studentId}/${endpoint}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ password }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            if (errorEl) errorEl.textContent = data.error || 'Не удалось сохранить данные для входа';
            return;
        }
        const student = currentViewingStudentRecord || { id: studentId };
        const phoneDigits = String(student.phone || '').replace(/\D/g, '');
        const login = data.data?.login || (phoneDigits ? `s_${phoneDigits}` : student.phone);
        closeStudentPlatformModal('studentPlatformAccessModal');
        await viewStudent(studentId);
        renderStudents(currentStudentSearch, currentStudentPage, currentStudentFilter);
        showStudentPlatformCredentials(student, login, password, mode);
    } catch (error) {
        if (errorEl) errorEl.textContent = 'Не удалось сохранить данные. Попробуйте позже.';
    } finally {
        if (submitButton?.isConnected) {
            submitButton.disabled = false;
            submitButton.textContent = mode === 'reset' ? 'Сохранить пароль' : 'Создать аккаунт';
        }
    }
}

function showStudentPlatformCredentials(student, login, password, mode) {
    closeStudentPlatformModal('studentPlatformCredentialsModal');
    const platformUrl = 'https://maestro-school.duckdns.org/';
    const phoneDigitsRaw = String(student.phone || '').replace(/\D/g, '');
    const whatsappPhone = phoneDigitsRaw.startsWith('8')
        ? `7${phoneDigitsRaw.slice(1)}`
        : phoneDigitsRaw;
    const intro = mode === 'reset'
        ? 'Данные для входа в приложение Maestro обновлены.'
        : 'Для вас создан доступ к приложению Maestro.';
    const message = `Здравствуйте!\n\n${intro}\n\nСсылка: ${platformUrl}\nЛогин: ${login}\nПароль: ${password}\n\nСохраните эти данные для входа.`;
    const whatsappUrl = whatsappPhone
        ? `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(message)}`
        : '';

    const modal = document.createElement('div');
    modal.id = 'studentPlatformCredentialsModal';
    modal.className = 'student-platform-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'studentPlatformCredentialsTitle');
    modal.innerHTML = `
        <div class="student-platform-modal__backdrop" data-close-platform-modal></div>
        <div class="student-platform-modal__panel student-platform-modal__panel--credentials">
            <div class="student-platform-modal__header">
                <div>
                    <span class="student-platform-modal__eyebrow">Доступ готов</span>
                    <h3 id="studentPlatformCredentialsTitle">${mode === 'reset' ? 'Пароль изменён' : 'Аккаунт создан'}</h3>
                </div>
                <button type="button" class="student-platform-modal__icon-btn" data-close-platform-modal aria-label="Закрыть" title="Закрыть">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
                </button>
            </div>
            <div class="student-platform-credentials">
                <div><span>Ссылка</span><strong>${escapeHtml(platformUrl)}</strong></div>
                <div><span>Логин</span><strong>${escapeHtml(login || '—')}</strong></div>
                <div><span>Пароль</span><strong>${escapeHtml(password)}</strong></div>
            </div>
            <div class="student-platform-message">
                <span>Готовое сообщение</span>
                <pre>${escapeHtml(message)}</pre>
            </div>
            <div class="student-platform-modal__actions">
                <button type="button" class="admin-btn btn-secondary" id="copyStudentPlatformMessage">Скопировать</button>
                ${whatsappUrl ? `<a class="admin-btn student-platform-whatsapp" href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener">Открыть WhatsApp</a>` : ''}
                <button type="button" class="admin-btn btn-primary" data-close-platform-modal>Готово</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-close-platform-modal]').forEach(button => {
        button.addEventListener('click', () => closeStudentPlatformModal(modal.id));
    });
    modal.querySelector('#copyStudentPlatformMessage').addEventListener('click', async (event) => {
        const copied = await copyToClipboard(message);
        event.currentTarget.textContent = copied ? 'Скопировано' : 'Не удалось скопировать';
    });
}

async function linkStudentToPlatform(studentId) {
    try {
        const response = await fetch(`${API_URL}/students/${studentId}/link`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            showToast(data.error || 'Не удалось связать', 'error');
            return;
        }
        showToast('Ученик связан с платформой', 'success');
        await viewStudent(studentId);
        renderStudents(currentStudentSearch, currentStudentPage, currentStudentFilter);
    } catch (error) {
        showToast('Не удалось связать ученика. Попробуйте позже.', 'error');
    }
}

async function rebindStudentToPlatform(studentId) {
    try {
        const statusResponse = await fetch(`${API_URL}/students/${studentId}/link-status`, {
            headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        const statusData = await statusResponse.json();
        if (!statusResponse.ok || !statusData.success) {
            showToast(statusData.error || 'Не удалось проверить текущую связь', 'error');
            return;
        }

        const linkData = statusData.data || {};
        const appUser = linkData.app?.appUser;
        const appUserId = linkData.app?.appUserId || linkData.crm?.appUserId || null;
        if (!appUserId) {
            showToast('Аккаунт платформы для перепривязки не найден. Сначала создайте его или проверьте номер телефона.', 'error');
            return;
        }

        const accountName = [appUser?.firstName, appUser?.lastName].filter(Boolean).join(' ') || 'аккаунт платформы';
        const accountPhone = appUser?.phone ? ` (${appUser.phone})` : '';
        const confirmed = await customConfirm(
            `Перепривязать ученика к аккаунту «${accountName}»${accountPhone}?\n\nТекущая связь будет заменена. Сам аккаунт и его учебные данные не удаляются.`,
            { icon: 'warning', yesText: 'Перепривязать', noText: 'Отмена' },
        );
        if (!confirmed) return;

        const response = await fetch(`${API_URL}/students/${studentId}/link`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ appUserId, force: true }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            showToast(data.error || 'Не удалось перепривязать аккаунт', 'error');
            return;
        }
        showToast('Аккаунт перепривязан. Старая связь снята, данные аккаунта сохранены.', 'success');
        await viewStudent(studentId);
        renderStudents(currentStudentSearch, currentStudentPage, currentStudentFilter);
    } catch (error) {
        showToast('Не удалось перепривязать аккаунт. Попробуйте позже.', 'error');
    }
}

async function openStudentInPlatform(studentId) {
    try {
        const response = await fetch(`${API_URL}/students/${studentId}/sso-token`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            showToast(data.error || 'Не удалось открыть приложение', 'error');
            return;
        }
        const token = data.data?.token;
        const loginBase = (data.data?.redirectUrl || 'https://maestro-school.duckdns.org/login').split('?')[0];
        const next = data.data?.next || '/school-lessons';
        if (!token) {
            showToast('Не удалось открыть приложение. Попробуйте позже.', 'error');
            return;
        }
        const url = `${loginBase}?ssoToken=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`;
        window.open(url, '_blank', 'noopener');
    } catch (error) {
        showToast('Не удалось открыть приложение. Попробуйте позже.', 'error');
    }
}

function getStudentActiveGroups(student) {
    return Array.isArray(student?.groups)
        ? student.groups.filter(g => {
            const group = g.groupId || g.group;
            return g.status === 'active' && group && group.isActive !== false;
        })
        : [];
}

function getMembershipClassesRemaining(membership) {
    if (!membership) return null;
    const candidates = [
        membership.classesRemaining,
        membership.groupClassesRemaining,
        membership.individualClassesRemaining,
        membership.theoryClassesRemaining
    ].map(value => Number(value)).filter(value => Number.isFinite(value));

    if (!candidates.length) return null;
    return Math.max(...candidates);
}

function hasStudentAssignedTeacher(student) {
    return Boolean(student?.assignedTeacher || student?.teacher || student?.teacherId);
}

function hasStudentPlatformLink(student) {
    const status = student?.externalLinkStatus || (student?.appUserId ? 'linked' : '');
    return status === 'linked' || Boolean(student?.appUserId);
}

function renderStudentStatusIcon(icon) {
    const icons = {
        booking: '<path d="M9 5h6"/><path d="M9 3h6v4H9z"/><path d="M7 5H5v16h14V5h-2"/>',
        lost: '<circle cx="10" cy="8" r="4"/><path d="M3 21a7 7 0 0 1 11-5.7"/><path d="m16 16 5 5m0-5-5 5"/>',
        paused: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6m4-6v6"/>',
        debt: '<path d="M4 7h16v12H4z"/><path d="M4 10h16"/><path d="M16 15h2"/>',
        membership: '<path d="M4 6h16v5a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/><path d="M12 8v8"/>',
        lessons: '<path d="M4 6h16v5a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/><path d="M12 9v3l2 1"/>',
        phone: '<path d="M7 3h10v18H7z"/><path d="M10 18h4"/>',
        responsible: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 12-5"/><path d="m17 16 5 5m0-5-5 5"/>',
        teacher: '<path d="m3 9 9-5 9 5-9 5z"/><path d="M7 12v5c3 2 7 2 10 0v-5"/><path d="M21 9v6"/>',
        group: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 19a6 6 0 0 1 12 0"/><path d="M15 15a5 5 0 0 1 6 4"/>',
        'platform-ok': '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M10 18h4"/><path d="m9 11 2 2 4-4"/>',
        'platform-wait': '<rect x="7" y="2" width="10" height="20" rx="2"/><circle cx="12" cy="11" r="3"/><path d="M12 9v2l1.5 1"/>',
        'platform-alert': '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M12 8v5m0 3h.01"/>',
        'platform-off': '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M10 18h4"/><path d="m3 3 18 18"/>',
        ready: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
        more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    };
    const slashedIcons = new Set(['phone', 'membership', 'responsible', 'teacher', 'group']);
    const slash = slashedIcons.has(icon) ? '<path class="student-status-icon__slash" d="m3 3 18 18"/>' : '';
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[icon] || icons.more}${slash}</svg>`;
}

function getStudentSafetyItems(student, membership = student?.activeMembership) {
    if (student?.isBooking === true) {
        return [{ level: 'warning', icon: 'booking', label: 'Это заявка', detail: 'Карточка ученика ещё не создана' }];
    }

    const items = [];
    const balance = Number(student?.accountBalance || 0);
    const balanceEstimate = estimateLessonsFromBalance(balance, membership);
    const classesRemaining = balanceEstimate ? balanceEstimate.lessons : getMembershipClassesRemaining(membership);
    const activeGroups = getStudentActiveGroups(student);

    if (student?.isLost === true) {
        items.push({ level: 'danger', icon: 'lost', label: 'Потерян', detail: 'Сначала свяжитесь с родителем' });
    }

    if (student?.status && student.status !== 'active') {
        items.push({ level: 'warning', icon: 'paused', label: 'На паузе', detail: 'Проверьте перед записью на урок' });
    }

    if (balance < 0) {
        items.push({ level: 'danger', icon: 'debt', label: `Долг ${formatAmount(Math.abs(balance))}`, detail: 'Не проводите новое списание без проверки' });
    }

    if (!membership) {
        items.push({ level: 'danger', icon: 'membership', label: 'Нет тарифа', detail: 'Продажа/оплата не привязана к активному абонементу' });
    } else if (classesRemaining !== null && classesRemaining <= 1) {
        items.push({
            level: classesRemaining <= 0 ? 'danger' : 'warning',
            icon: 'lessons',
            label: classesRemaining < 0 ? `Долг ${Math.abs(classesRemaining)} ур.` : (classesRemaining === 0 ? 'Баланс на 0 уроков' : 'Остался 1 урок'),
            detail: balanceEstimate ? `Расчёт по ставке ${formatAmount(balanceEstimate.lessonPrice)}` : 'Нужна продажа или продление'
        });
    }

    if (!student?.phone) {
        items.push({ level: 'danger', icon: 'phone', label: 'Нет телефона', detail: 'Админ не сможет быстро связаться' });
    }

    if (!student?.customerName) {
        items.push({ level: 'warning', icon: 'responsible', label: 'Нет ответственного', detail: 'Укажите родителя/заказчика' });
    }

    if (!hasStudentAssignedTeacher(student)) {
        items.push({ level: 'warning', icon: 'teacher', label: 'Нет педагога', detail: 'Расписание и зарплата могут разойтись' });
    }

    if (!activeGroups.length) {
        items.push({ level: 'warning', icon: 'group', label: 'Нет активной группы', detail: 'Проверьте расписание ученика' });
    }

    if (!hasStudentPlatformLink(student)) {
        items.push({ level: 'info', icon: 'platform-off', label: 'Нет входа в приложение', detail: 'Родитель не увидит занятия в личном кабинете' });
    }

    return items;
}

function renderStudentSafety(student, membership = student?.activeMembership, options = {}) {
    const items = getStudentSafetyItems(student, membership);
    if (!items.length) {
        return options.showOk
            ? `<div class="student-safety is-ok"><span class="student-risk-chip student-status-icon"
                title="Карточка готова к работе" role="img" tabindex="0"
                aria-label="Карточка готова к работе">${renderStudentStatusIcon('ready')}</span></div>`
            : '';
    }

    const maxItems = options.maxItems || 6;
    const visibleItems = items.slice(0, maxItems);
    const hiddenCount = items.length - visibleItems.length;
    const chips = visibleItems.map(item => `
        <span class="student-risk-chip student-status-icon is-${item.level}"
            title="${escapeHtml(`${item.label}. ${item.detail || ''}`.trim())}" role="img" tabindex="0"
            aria-label="${escapeHtml(item.label)}">
            ${renderStudentStatusIcon(item.icon)}
        </span>
    `).join('');

    return `
        <div class="student-safety" aria-label="Проверки карточки ученика">
            ${chips}
            ${hiddenCount > 0 ? `<span class="student-risk-chip student-status-icon is-more"
                title="Ещё предупреждений: ${hiddenCount}" role="img" tabindex="0"
                aria-label="Ещё предупреждений: ${hiddenCount}">
                ${renderStudentStatusIcon('more')}<b>${hiddenCount}</b>
            </span>` : ''}
        </div>
    `;
}

// Вспомогательная функция для отрисовки таблицы учеников
function renderStudentsTable(students, statsMap) {
    const table = document.getElementById('studentsTable');

    // Присоединить статистику к ученикам
    const studentsWithStats = students
        .map(normalizeStudentRecord)
        .filter(student => student._id)
        .map(student => ({
            ...student,
            stats: statsMap[student._id] || statsMap[student.id] || {
                monthMissed: 0
            }
        }));

    // Сохранить для фильтрации
    allStudentsData = studentsWithStats;

    // Применить фильтр
    const filteredStudents = applyStudentFilter(studentsWithStats, currentStudentFilter);

    if (filteredStudents.length === 0) {
        table.innerHTML = '<tr class="table-message"><td colspan="7">Нет учеников по данному фильтру</td></tr>';
        return;
    }

    table.innerHTML = filteredStudents.map(student => {
        const studentId = getStudentId(student);
        const isBookingRow = student.isBooking === true || String(studentId || '').startsWith('booking_');
        const activeGroups = getStudentActiveGroups(student);
        const groupNames = activeGroups
            .map(g => g.groupId?.name || 'Группа')
            .join(', ') || 'Нет групп';

        const membership = student.activeMembership;
        const membershipHTML = renderMembershipBalanceBadge(student, membership);
        const safetyHTML = renderStudentSafety(student, membership);

        const membershipClass = getBalanceBadgeClass(student.accountBalance, membership);

        // Статистика
        const stats = student.stats || {};
        const monthMissed = stats.monthMissed || 0;

        const isLost = student.isLost === true;
        const platformBadge = isBookingRow
            ? '<span style="display:inline-block;margin-left:8px;padding:2px 8px;background:rgba(215,173,74,0.16);color:#d7ad4a;border:1px solid rgba(215,173,74,0.35);border-radius:10px;font-size:0.7em;font-weight:600;letter-spacing:0.03em;text-transform:uppercase;vertical-align:middle;">Заявка</span>'
            : getStudentLinkBadge(student);
        const ageBadge = typeof renderStudentAgeBadge === 'function' ? renderStudentAgeBadge(student.dateOfBirth) : '';
        const directionsText = (student.learningDirections || []).join(', ') || 'Направление не указано';
        const teacherText = student.assignedTeacher
            ? formatStudentFio(student.assignedTeacher)
            : 'Не назначен';
        const customerText = student.customerName || 'Контакт не указан';

        const studentAvatarUrl = normalizeSecureMediaUrl(student.studentAvatar);
        const studentAvatar = studentAvatarUrl
            ? `<img src="${escapeHtml(studentAvatarUrl)}" alt="" class="student-list-avatar-img">`
            : escapeHtml((student.lastName || student.name || '?').charAt(0));

        return `
            <tr data-student-id="${escapeHtml(studentId)}" data-absences="${monthMissed}" data-lost="${isLost}">
                <td data-label="Имя">
                    <div class="card-field">
                        <span class="card-field-label">Имя</span>
                        <span class="card-field-value student-name-cell student-name-with-avatar">
                            <span class="student-list-avatar">${studentAvatar}</span>
                            <span>
                                ${escapeHtml(formatStudentFio(student))}${ageBadge}${platformBadge ? ` ${platformBadge}` : ''}
                                <small>${escapeHtml(directionsText)}</small>
                                ${safetyHTML}
                            </span>
                        </span>
                    </div>
                </td>
                <td data-label="Телефон">
                    <div class="card-field">
                        <span class="card-field-label">Телефон</span>
                        <span class="card-field-value">${getWhatsappLink(student.phone)}<small>${escapeHtml(customerText)}</small></span>
                    </div>
                </td>
                <td data-label="Преподаватель">
                    <div class="card-field">
                        <span class="card-field-label">Преподаватель</span>
                        <span class="card-field-value">${escapeHtml(teacherText)}</span>
                    </div>
                </td>
                <td data-label="Группы">
                    <div class="card-field">
                        <span class="card-field-label">Группы</span>
                        <span class="card-field-value">${escapeHtml(groupNames)}</span>
                    </div>
                </td>
                <td data-label="Баланс / тариф">
                    <div class="card-field">
                        <span class="card-field-label">Баланс / тариф</span>
                        <span class="card-field-value"><span class="membership-badge ${membershipClass}">${membershipHTML}</span></span>
                    </div>
                </td>
                <td class="table-actions" data-label="Действия">
                    <div class="card-field">
                        <span class="card-field-label">Действия</span>
                        <div class="card-field-value">
                            ${isBookingRow
                                ? `<button class="table-btn" type="button" onclick="toast.info('Это заявка, карточка ученика ещё не создана. Откройте раздел «Заявки».'); return false;">Заявка</button>`
                                : `
                                    <button class="table-btn" type="button" data-student-profile-id="${escapeHtml(studentId)}">Профиль</button>
                                `
                            }
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    bindStudentProfileButtons();
}

function bindStudentProfileButtons() {
    if (document.body.dataset.studentProfileClickBound === 'true') return;
    document.body.dataset.studentProfileClickBound = 'true';

    document.addEventListener('click', event => {
        const pauseButton = event.target.closest('[data-student-pause-toggle]');
        if (pauseButton) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof window.toggleStudentPauseState === 'function') {
                window.toggleStudentPauseState();
            }
            return;
        }

        const button = event.target.closest('[data-student-profile-id]');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        const studentId = button.dataset.studentProfileId;
        if (!studentId || studentId === 'undefined' || studentId === 'null') {
            toast.error('Не удалось открыть карточку ученика. Обновите список и попробуйте снова.');
            console.error('Student profile button without valid id:', button);
            return;
        }
        openStudentProfileSafe(studentId);
    });
}

async function openStudentProfileSafe(studentId) {
    if (!studentId || studentId === 'undefined' || studentId === 'null') {
        toast.error('Не удалось открыть карточку ученика. Обновите список и попробуйте снова.');
        console.error('openStudentProfileSafe called without valid id:', studentId);
        return;
    }

    const normalizedId = String(studentId);
    if (normalizedId.startsWith('booking_')) {
        toast.info('Это заявка, а не карточка ученика. Откройте её в разделе «Заявки».');
        console.warn('Student profile skipped for booking row:', { studentId: normalizedId });
        return;
    }

    const title = document.getElementById('studentDetailModalTitle');
    if (title) title.textContent = 'Загрузка...';

    const editForm = document.getElementById('studentEditForm');
    const basicInfo = document.getElementById('studentBasicInfo');
    if (editForm) editForm.style.display = 'none';
    if (basicInfo) {
        basicInfo.style.display = '';
        basicInfo.innerHTML = '<p style="text-align:center;padding:30px;opacity:0.55;">Открываем карточку ученика...</p>';
    }
    const modal = showStudentDetailModal();

    try {
        await viewStudent(normalizedId);
    } catch (error) {
        console.error('openStudentProfileSafe ERROR:', error);
        toast.error('Не удалось открыть карточку ученика. Обновите страницу и попробуйте снова.');
        if (modal) modal.classList.add('show');
        if (title) title.textContent = 'Ошибка открытия профиля';
        if (basicInfo) {
            basicInfo.innerHTML = `
                <div style="text-align:center;padding:30px;color:#ef4444;">
                    <p style="font-weight:700;margin-bottom:8px;">Не удалось открыть карточку ученика</p>
                    <p style="opacity:0.75;">${escapeHtml(error.message || 'Неизвестная ошибка')}</p>
                </div>
            `;
        }
    }
}

function getUniqueStudentDirections(student) {
    const seen = new Set();
    return (Array.isArray(student?.learningDirections) ? student.learningDirections : [])
        .map(item => String(item || '').trim())
        .filter(item => {
            const key = item.toLocaleLowerCase('ru-RU');
            if (!item || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function formatStudentGroupInstruments(instruments) {
    const totals = new Map();
    (Array.isArray(instruments) ? instruments : []).forEach(item => {
        const name = String(item?.name || '').trim();
        if (!name) return;
        const key = name.toLocaleLowerCase('ru-RU');
        const quantity = Number(item?.quantity);
        const current = totals.get(key) || { name, quantity: 0 };
        current.quantity += Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
        totals.set(key, current);
    });
    return Array.from(totals.values())
        .map(item => `${item.name} ×${item.quantity}`)
        .join(', ');
}

function getStudentProfileDate(dateValue, fallback = 'Не указана') {
    if (!dateValue) return fallback;
    const date = new Date(dateValue);
    return Number.isNaN(date.getTime()) ? fallback : date.toLocaleDateString('ru-RU');
}

function buildStudentProfileOverview(student) {
    const safeStudent = normalizeStudentRecord(student);
    const activeGroups = getStudentActiveGroups(safeStudent);
    const directions = getUniqueStudentDirections(safeStudent);
    const teacher = safeStudent.assignedTeacher
        ? formatStudentFio(safeStudent.assignedTeacher)
        : 'Не закреплён';
    const avatarUrl = normalizeSecureMediaUrl(safeStudent.studentAvatar);
    const avatarHtml = avatarUrl
        ? `<img src="${escapeHtml(avatarUrl)}" alt="" class="student-avatar-img">`
        : escapeHtml((safeStudent.lastName || safeStudent.name || '?').charAt(0));
    const balanceValue = Number(safeStudent.accountBalance || 0);
    const balanceStateClass = balanceValue < 0 ? 'is-danger' : (balanceValue < 10000 ? 'is-warning' : 'is-good');
    const membershipEstimate = estimateLessonsFromBalance(balanceValue, safeStudent.activeMembership);
    const lastVisitText = getStudentProfileDate(safeStudent.lastAttendedDate, 'Нет посещений');
    const genderText = safeStudent.gender === 'male'
        ? 'Мужской'
        : safeStudent.gender === 'female'
            ? 'Женский'
            : 'Не указан';
    const directionTags = directions.length
        ? directions.map(item => `<span class="student-tag">${escapeHtml(item)}</span>`).join('')
        : '<span class="student-muted">Направления не указаны</span>';
    const levelTag = safeStudent.learningLevel
        ? `<span class="student-tag is-neutral">${escapeHtml(safeStudent.learningLevel)}</span>`
        : '';
    const safetyHTML = renderStudentSafety(safeStudent, safeStudent.activeMembership, { showOk: true, maxItems: 6 });
    const additionalPhones = Array.isArray(safeStudent.additionalPhones) ? safeStudent.additionalPhones : [];
    const notificationFields = [
        ['notifyHomework', 'ДЗ'],
        ['notifyLessons', 'Уроки'],
        ['notifyPayments', 'Оплата'],
    ];
    const legacyNotificationRouting = [safeStudent, ...additionalPhones].every(item =>
        notificationFields.every(([field]) => typeof item?.[field] !== 'boolean')
    );
    const notificationBadges = (contact, isPrimary = false) => {
        const labels = notificationFields
            .filter(([field]) => contact?.[field] === true || (legacyNotificationRouting && isPrimary))
            .map(([, label]) => `<span>${label}</span>`)
            .join('');
        return labels ? `<div class="student-contact-routing">${labels}</div>` : '';
    };
    const phonesHtml = [
        `<div class="student-contact-phone"><strong>Основной</strong>${getWhatsappLink(safeStudent.phone)}${notificationBadges(safeStudent, true)}</div>`,
        ...additionalPhones.map(item => `
            <div class="student-contact-phone">
                <strong>${escapeHtml(item.label || 'Дополнительный')}</strong>
                ${getWhatsappLink(item.phone)}
                ${notificationBadges(item)}
            </div>
        `),
    ].join('');
    const notesValue = String(safeStudent.notes || '').trim();
    const notesHtml = notesValue
        ? escapeHtml(notesValue)
        : '<span class="student-muted">Комментарий не указан</span>';
    const dayNames = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const groupRows = activeGroups.length
        ? activeGroups.map(entry => {
            const group = entry.groupId || entry.group || {};
            const schedule = (group.schedules || [])
                .filter(item => !item.isPractice)
                .map(item => `${dayNames[item.dayOfWeek] || 'День'} ${item.time || ''}`.trim())
                .join(' · ') || 'Расписание не задано';
            const instruments = formatStudentGroupInstruments(group.instruments);
            return `
                <div class="student-group-row">
                    <div class="student-group-row__main">
                        <strong>${escapeHtml(group.name || 'Группа')}</strong>
                        ${instruments ? `<span>${escapeHtml(instruments)}</span>` : ''}
                    </div>
                    <span class="student-group-row__schedule">${escapeHtml(schedule)}</span>
                </div>
            `;
        }).join('')
        : '<div class="student-profile-empty">Активных групп нет</div>';

    return `
        <div class="student-profile-identity">
            <div class="student-avatar">${avatarHtml}</div>
            <div class="student-profile-identity__content">
                <div class="student-profile-identity__topline">
                    <span class="student-status-pill ${safeStudent.status === 'active' ? 'is-active' : 'is-paused'}">${getStudentStatusLabel(safeStudent)}</span>
                    <div class="student-tags">${directionTags}${levelTag}</div>
                </div>
                <div class="student-overview-meta">Педагог: <strong>${escapeHtml(teacher)}</strong></div>
                ${safetyHTML}
            </div>
        </div>

        <div class="student-kpi-grid">
            <div class="student-kpi ${balanceStateClass}">
                <span>Денежный баланс</span>
                <strong>${formatAmount(balanceValue)}</strong>
            </div>
            <div class="student-kpi">
                <span>Примерно хватит на</span>
                <strong>${membershipEstimate ? `${membershipEstimate.lessons} зан.` : '—'}</strong>
            </div>
            <div class="student-kpi">
                <span>Последнее занятие</span>
                <strong>${lastVisitText}</strong>
            </div>
            <div class="student-kpi">
                <span>Активные группы</span>
                <strong>${activeGroups.length}</strong>
            </div>
        </div>

        <div class="student-profile-columns">
            <section class="student-profile-section">
                <div class="student-profile-section__head">
                    <h3>Контакты и личные данные</h3>
                </div>
                <div class="student-contact-phones">${phonesHtml}</div>
                <div class="student-profile-data-grid">
                    <div><span>Заказчик / родитель</span><strong>${escapeHtml(safeStudent.customerName || 'Не указан')}</strong></div>
                    <div><span>Дата рождения</span><strong>${formatStudentDate(safeStudent.dateOfBirth)}</strong></div>
                    <div><span>Пол</span><strong>${genderText}</strong></div>
                </div>
            </section>

            <section class="student-profile-section">
                <div class="student-profile-section__head">
                    <h3>Обучение</h3>
                </div>
                <div class="student-profile-data-grid">
                    <div class="is-wide"><span>Преподаватель</span><strong>${escapeHtml(teacher)}</strong></div>
                    <div><span>Источник</span><strong>${escapeHtml(safeStudent.acquisitionSource || 'Не указан')}</strong></div>
                    <div><span>Регистрация</span><strong>${getStudentProfileDate(safeStudent.registeredAt)}</strong></div>
                </div>
            </section>
        </div>

        <section class="student-profile-notes">
            <span>Комментарий</span>
            <p>${notesHtml}</p>
        </section>

        <section class="student-profile-groups">
            <div class="student-profile-section__head">
                <h3>Группы</h3>
                <span>${activeGroups.length}</span>
            </div>
            <div class="student-group-list">${groupRows}</div>
        </section>
    `;
}

function renderStudentBasicProfile(student) {
    const safeStudent = normalizeStudentRecord(student);
    const title = document.getElementById('studentDetailModalTitle');
    if (title) {
        const fio = formatStudentFio(safeStudent) || 'Информация об ученике';
        const ageBadge = typeof renderStudentAgeBadge === 'function' ? renderStudentAgeBadge(safeStudent.dateOfBirth) : '';
        title.innerHTML = `${escapeHtml(fio)}${ageBadge}`;
    }

    const basicInfo = document.getElementById('studentBasicInfo');
    if (basicInfo) basicInfo.innerHTML = buildStudentProfileOverview(safeStudent);
}

// Форматировать дату последнего визита
function formatLastVisit(date) {
    if (!date) return '<span style="color: #ef4444;">Никогда</span>';

    const days = getDaysSinceLastVisit(date);

    if (days === 0) return '<span style="color: #10b981;">Сегодня</span>';
    if (days === 1) return 'Вчера';
    if (days < 7) return `${days} ${getDeclension(days, 'день', 'дня', 'дней')} назад`;
    if (days < 14) return '<span style="color: #f59e0b;">Неделю назад</span>';
    if (days < 30) return '<span style="color: #ef4444;">' + Math.floor(days / 7) + ' ' + getDeclension(Math.floor(days / 7), 'неделю', 'недели', 'недель') + ' назад</span>';
    return '<span style="color: #ef4444;">Более месяца назад</span>';
}

// Получить количество дней с последнего визита
function getDaysSinceLastVisit(date) {
    if (!date) return 999;
    const lastDate = new Date(date);
    const today = new Date();
    const diffTime = today - lastDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
}

// Применить фильтр учеников
function applyStudentFilter(students, filter) {
    switch (filter) {
        case 'with-absences':
            return students.filter(s => (s.stats?.monthMissed || 0) > 0);
        case 'ending-soon':
            // Финансовый сигнал продления: баланс от 0 до 4 000 ₸.
            return students.filter(s => Number(s.accountBalance || 0) >= 0 && Number(s.accountBalance || 0) <= 4000);
        case 'with-debt':
            // Отрицательный баланс
            return students.filter(s => (s.accountBalance || 0) < 0);
        case 'lost':
            // ⚫ Потерянные — > 3 месяцев без занятий
            return students.filter(s => s.isLost === true);
        case 'active':
        default:
            return students.filter(s => s.status === 'active');
    }
}

// Показать студентов с отрицательным балансом (вызывается из Dashboard)
function showOverdueStudents() {
    // Переключиться на секцию учеников
    showSection('students');

    // Применить фильтр "Отрицательный баланс"
    filterStudents('with-debt');

    // Обновить активный фильтр в UI
    document.querySelectorAll('#section-students [data-filter]').forEach(btn => {
        if (btn.getAttribute('data-filter') === 'with-debt') {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// Фильтровать учеников
function filterStudents(filter) {
    currentStudentFilter = filter;

    // Обновить активную кнопку
    document.querySelectorAll('#section-students [data-filter]').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.filter === filter) {
            btn.classList.add('active');
        }
    });

    // Каждый фильтр начинает с полной активной выборки. Это не позволяет
    // результатам предыдущего фильтра влиять на следующий.
    renderStudents(currentStudentSearch, 1, filter);
}

// Просмотр ученика
async function viewStudent(id) {
    let basicProfileRendered = false;
    try {
        if (!id || id === 'undefined' || id === 'null') {
            toast.error('Не удалось открыть карточку ученика. Обновите список и попробуйте снова.');
            console.error('viewStudent called without valid id:', id);
            return;
        }
        id = String(id);
        if (currentViewingStudentId !== id) selectedStudentMembershipId = null;
        currentViewingStudentId = id;
        currentViewingStudentStatus = null;
        currentViewingStudentRecord = null;
        const token = getAuthToken();

        // ⚡ МОМЕНТАЛЬНО показываем модалку с загрузкой
        document.getElementById('studentDetailModalTitle').textContent = 'Загрузка...';
        const editForm = document.getElementById('studentEditForm');
        const basicInfoEl = document.getElementById('studentBasicInfo');
        if (editForm) editForm.style.display = 'none';
        if (basicInfoEl) basicInfoEl.style.display = '';
        document.getElementById('studentBasicInfo').innerHTML = '<p style="text-align: center; padding: 30px; opacity: 0.5;">Загрузка данных...</p>';
        const integrationInfoEl = document.getElementById('studentIntegrationInfo');
        if (integrationInfoEl) {
            integrationInfoEl.innerHTML = '<p style="text-align: center; opacity: 0.5;">Загрузка...</p>';
        }
        const membershipInfoEl = document.getElementById('studentMembershipInfo');
        if (membershipInfoEl) membershipInfoEl.innerHTML = '<p style="text-align: center; opacity: 0.5; padding: 20px;">Загрузка абонемента...</p>';
        const paymentsInfoEl = document.getElementById('studentPaymentsInfo');
        if (paymentsInfoEl) paymentsInfoEl.innerHTML = '<p style="text-align: center; opacity: 0.5; padding: 20px;">Загрузка платежей...</p>';
        document.getElementById('studentStatsInfo').innerHTML = '<p style="text-align: center; padding: 30px; opacity: 0.5;">Загрузка статистики...</p>';
        document.getElementById('studentAttendanceHistory').innerHTML = '<p style="text-align: center; padding: 20px; opacity: 0.5;">Загрузка истории...</p>';

        showStudentDetailModal();

        const studentData = await fetch(`${API_URL}/students/${id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => parseStudentJsonResponse(r, 'Не удалось загрузить данные ученика')).catch(err => {
            console.error(`❌ Student fetch error:`, err);
            throw new Error(`Не удалось загрузить данные студента: ${err.message}`);
        });

        const rawStudent = studentData.student || studentData.data || null;
        if (!studentData.success || !rawStudent) {
            throw new Error(studentData.error || 'Не удалось загрузить карточку ученика');
        }
        const student = normalizeStudentRecord(rawStudent);
        currentViewingStudentRecord = student;
        currentViewingStudentStatus = student.status || null;
        updateStudentPauseButton(student);
        renderStudentBasicProfile(student);
        basicProfileRendered = true;

        // Вторичные блоки грузятся после базовой карточки. Их ошибка не должна мешать открыть профиль.
        const [statsData, membershipData, paymentsData, freezesData] = await Promise.all([
            fetch(`${API_URL}/students/${id}/stats`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => {
                // Student stats loaded
                return r.json();
            }).catch(err => {
                console.error(`❌ Stats fetch error:`, err);
                return { success: true, stats: { attendanceRate: 0, totalClasses: 0, attendedCount: 0, missedCount: 0, monthMissed: 0, recentHistory: [] } };
            }),
            fetch(`${API_URL}/memberships/student/${id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => {
                // Memberships loaded
                return r.json();
            }).catch(err => {
                console.error(`❌ Membership fetch error:`, err);
                return { success: false, memberships: [] };
            }),
            fetch(`${API_URL}/payments/student/${id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => {
                // Payments loaded
                if (!r.ok) {
                    console.error(`❌ Payments response not OK:`, r.status, r.statusText);
                }
                return r.json();
            }).then(data => {
                // Payments data processed
                return data;
            }).catch(err => {
                console.error(`❌ Payments fetch error:`, err);
                return { success: false, payments: [] };
            }),
            fetch(`${API_URL}/freezes?studentId=${id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json()).catch(err => {
                console.error(`❌ Freezes fetch error:`, err);
                return { success: false, freezes: [] };
            })
        ]);

        const stats = statsData.stats || { attendanceRate: 0, totalClasses: 0, attendedCount: 0, missedCount: 0, monthMissed: 0, recentHistory: [] };

        // ⚡ Находим активный абонемент (нужен для рендеринга платежей)
        let activeMembership = null;
        let hasNonTrialMembership = false;  // Есть ли не-пробный абонемент

        if (membershipData.success && membershipData.memberships && membershipData.memberships.length > 0) {
            // All memberships processed

            // ПРИОРИТЕТ: monthly/quarterly > trial
            // Сначала ищем активный monthly/quarterly/individual_package
            activeMembership = membershipData.memberships.find(m =>
                m.status === 'active' && (m._id === selectedStudentMembershipId || m.id === selectedStudentMembershipId)
            ) || membershipData.memberships.find(m =>
                m.status === 'active' && (m.type === 'monthly' || m.type === 'monthly_12' || m.type === 'quarterly' || m.type === 'individual_package')
            );

            // Если не нашли - берем любой активный (включая trial и individual_single)
            if (!activeMembership) {
                activeMembership = membershipData.memberships.find(m => m.status === 'active');
            }

            // Active membership found

            // Проверяем есть ли серьезный абонемент для кнопок конвертации
            hasNonTrialMembership = membershipData.memberships.some(m =>
                m.status === 'active' && (m.type === 'monthly' || m.type === 'monthly_12' || m.type === 'quarterly' || m.type === 'individual_package')
            );

            // Non-trial membership check completed
            // Conversion button visibility determined
        }

        // Обновляем заголовок (Фамилия Имя)
        const detailTitle = document.getElementById('studentDetailModalTitle');
        if (detailTitle) {
            const fio = formatStudentFio(student) || 'Информация об ученике';
            const ageBadge = typeof renderStudentAgeBadge === 'function' ? renderStudentAgeBadge(student.dateOfBirth) : '';
            detailTitle.innerHTML = `${escapeHtml(fio)}${ageBadge}`;
        }

        // Устанавливаем обработчики для кнопок редактирования после загрузки данных
        // Используем setTimeout для гарантии, что DOM обновлен
        setTimeout(() => {
            setupStudentEditHandlers();
        }, 100);

        const isLost = student.isLost === true;
        const lastPaymentDate = student.lastPaymentDate ? new Date(student.lastPaymentDate) : null;
        let lostInfoText;
        if (lastPaymentDate) {
            const days = Math.floor((Date.now() - lastPaymentDate.getTime()) / (1000 * 60 * 60 * 24));
            lostInfoText = `Последний платёж: ${lastPaymentDate.toLocaleDateString('ru-RU')} (${days} дн. назад). Возврат будет зафиксирован автоматически при новом платеже.`;
        } else {
            lostInfoText = 'Платежей не было. Возврат будет зафиксирован автоматически при первом платеже.';
        }
        const lostBlock = isLost ? `
            <div class="student-lost-block">
                <strong>Ученик в статусе «Потерян»</strong>
                <span>${lostInfoText}</span>
            </div>
        ` : '';

        const profileHtml = buildStudentProfileOverview(student);
        document.getElementById('studentBasicInfo').innerHTML = `${lostBlock}${profileHtml}`;

        void initStudentRegularScheduleEditor(getStudentId(student));
        try {
            renderStudentIntegrationBlock(student);
        } catch (integrationError) {
            console.error('Integration block render error:', integrationError);
            const integrationEl = document.getElementById('studentIntegrationInfo');
            if (integrationEl) {
                integrationEl.innerHTML = '<p style="color:#ef4444;text-align:center;">Не удалось отобразить блок платформы</p>';
            }
        }

        // Статистика посещаемости
        const attendanceRate = stats.attendanceRate || 0;
        const totalClasses = stats.totalClasses || 0;
        const attendedCount = stats.attendedCount || 0;
        const missedCount = stats.missedCount || 0;
        const monthMissed = stats.monthMissed || 0;
        const lastAttendedDate = stats.lastAttendedDate;

        let attendanceColor = '#10b981';
        if (attendanceRate < 50) attendanceColor = '#ef4444';
        else if (attendanceRate < 75) attendanceColor = '#f59e0b';

        document.getElementById('studentStatsInfo').innerHTML = `
            <div style="display: flex; flex-wrap: wrap; gap: 25px; align-items: center; font-size: 0.9em;">
                <div style="text-align: center;">
                    <div style="color: rgba(255,255,255,0.6); font-size: 0.75em; margin-bottom: 3px;">ПОСЕЩАЕМОСТЬ</div>
                    <div style="color: ${attendanceColor}; font-weight: 700; font-size: 1.8em;">${attendanceRate}%</div>
                </div>
                <div style="border-left: 1px solid rgba(255,255,255,0.1); padding-left: 20px;">
                    <div style="color: rgba(255,255,255,0.6); font-size: 0.75em; margin-bottom: 3px;">ПОСЕЩЕНО</div>
                    <div style="color: #10b981; font-weight: 600; font-size: 1.3em;">${attendedCount}</div>
                </div>
                <div>
                    <div style="color: rgba(255,255,255,0.6); font-size: 0.75em; margin-bottom: 3px;">ПРОПУЩЕНО</div>
                    <div style="color: #ef4444; font-weight: 600; font-size: 1.3em;">${missedCount}</div>
                </div>
                <div style="border-left: 1px solid rgba(255,255,255,0.1); padding-left: 20px;">
                    <div style="color: rgba(255,255,255,0.6); font-size: 0.75em; margin-bottom: 3px;">В ЭТОМ МЕСЯЦЕ</div>
                    <div style="color: ${monthMissed > 2 ? '#ef4444' : '#64748b'}; font-weight: 600; font-size: 1.3em;">${monthMissed} пропусков</div>
                </div>
            </div>
        `;

        // История посещений
        const history = stats.recentHistory || [];

        if (history.length === 0) {
            document.getElementById('studentAttendanceHistory').innerHTML = `
                <p style="text-align: center; opacity: 0.5; padding: 20px;">Нет истории посещений</p>
            `;
        } else {
            document.getElementById('studentAttendanceHistory').innerHTML = history.map(item => {
                const date = new Date(item.date).toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: 'numeric' });
                
                let statusColor = '#10b981';
                let statusText = 'Присутствовал';
                let statusIconSimple = '✓';
                
                if (item.attendanceStatus === 'present') {
                    statusColor = '#10b981';
                    statusText = 'Присутствовал';
                    statusIconSimple = '✓';
                } else if (item.attendanceStatus === 'late') {
                    statusColor = '#f59e0b';
                    statusText = 'Опоздал';
                    statusIconSimple = '✓';
                } else if (item.attendanceStatus === 'excused_absence') {
                    statusColor = '#3b82f6';
                    statusText = 'Пропуск (уваж. — не списано)';
                    statusIconSimple = '✗';
                } else if (item.attendanceStatus === 'unexcused_absence') {
                    statusColor = '#ef4444';
                    statusIconSimple = '✗';
                    if (item.chargeSource === 'membership') {
                        statusText = 'Прогул (списано с абонемента)';
                    } else if (item.chargeAmount > 0) {
                        statusText = `Прогул (списано с баланса: ${item.chargeAmount.toLocaleString('ru-RU')} ₸)`;
                    } else {
                        statusText = 'Прогул (списано)';
                    }
                } else {
                    // Обратная совместимость
                    statusColor = item.attended ? '#10b981' : '#ef4444';
                    statusText = item.attended ? 'Присутствовал' : 'Отсутствовал';
                    statusIconSimple = item.attended ? '✓' : '✗';
                }

                const cursorStyle = item.classId ? 'cursor: pointer;' : '';
                const hoverStyle = item.classId ? 'onmouseover="this.style.backgroundColor=\'rgba(255,255,255,0.03)\'" onmouseout="this.style.backgroundColor=\'transparent\'"' : '';
                const clickAttr = item.classId ? `onclick="openLessonReviewItem('${item.classId}')"` : '';

                return `
                    <div ${clickAttr} ${hoverStyle} style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.85em; transition: background 0.2s; ${cursorStyle}">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="color: ${statusColor}; font-weight: 700; font-size: 1.1em; width: 18px;">${statusIconSimple}</span>
                            <div style="display: flex; flex-direction: column;">
                                <span style="font-weight: 500;">${item.title || 'Занятие'}</span>
                                <span style="font-size: 0.75em; color: ${statusColor}; font-weight: 500;">${statusText}</span>
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="opacity: 0.6;">${new Date(item.date).toLocaleDateString('ru', { day: '2-digit', month: 'short' })}</span>
                            ${item.classId ? '<span style="opacity: 0.4; font-size: 0.8em;">➔</span>' : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Обработать данные абонемента (уже загружены в Promise.all!)
        if (activeMembership) {
            const typeNames = {
                'trial': 'Пробный',
                'single_class': 'Разовое занятие',
                'monthly': 'Месячный',
                'monthly_12': 'Месячный (12 занятий)',
                'quarterly': 'Квартальный',
                'individual_single': 'Инд. разовое',
                'individual_package': 'Инд. абонемент'
            };

            const rawStartDate = activeMembership.startDate || activeMembership.createdAt ? new Date(activeMembership.startDate || activeMembership.createdAt) : null;
            const startDateISO = rawStartDate && !isNaN(rawStartDate.getTime()) ? rawStartDate.toISOString().split('T')[0] : '';
            const freezesText = `${activeMembership.freezesUsed || 0}/${activeMembership.freezesAvailable || 0}`;

            const userRole = getUserRole();
            const canAddClasses = userRole === 'super_admin' || userRole === 'admin';
            const canFreeze = userRole === 'super_admin' || userRole === 'admin';
            const lessonPrice = getMembershipAverageCharge(activeMembership);
            const balanceEstimate = estimateLessonsFromBalance(student.accountBalance, activeMembership);
            const calculatedLessonsRemaining = balanceEstimate?.lessons ?? null;
            const calculatedLessonsColor = calculatedLessonsRemaining === null
                ? '#eb4d77'
                : calculatedLessonsRemaining < 0
                    ? '#ef4444'
                    : calculatedLessonsRemaining <= 1
                        ? '#f59e0b'
                        : '#10b981';
            const primaryComponentBalances = [
                ['Индивидуальные', activeMembership.individualClassesRemaining],
                ['Групповые', activeMembership.groupClassesRemaining],
                ['Теория', activeMembership.theoryClassesRemaining],
            ].filter(([, value]) => value !== null && value !== undefined);
            const primaryComponentBalancesHTML = primaryComponentBalances.length ? `
                <strong style="color: rgba(255,255,255,0.7);">Остаток по форматам занятий:</strong>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    ${primaryComponentBalances.map(([label, value]) => `<span class="student-tag">${label}: ${value}</span>`).join('')}
                </div>
            ` : '';

            // Активные/ожидающие заморозки по этому абонементу
            const allFreezes = (freezesData && freezesData.freezes) ? freezesData.freezes : [];
            const membershipFreezes = allFreezes.filter(f =>
                (f.membershipId === activeMembership._id || f.membershipId === activeMembership.id)
                && ['active', 'pending'].includes(f.status)
            );
            const freezeTypeLabels = {
                regular: 'Обычная',
                period: 'Менструация',
                sick: 'Болезнь',
                business_trip: 'Командировка',
                other: 'Другое'
            };
            const fmtDate = (d) => new Date(d).toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: '2-digit' });
            const freezesListHTML = membershipFreezes.length > 0 ? `
                <div style="grid-column: 1 / -1; margin-top: 6px; display: flex; flex-direction: column; gap: 6px;">
                    ${membershipFreezes.map(f => `
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.25);border-radius:8px;padding:6px 10px;font-size:0.85em;">
                            <div style="display:flex;flex-direction:column;gap:2px;min-width:0;">
                                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                    <span style="color:#60a5fa;font-weight:600;">🧊 ${freezeTypeLabels[f.type] || f.type}</span>
                                    <span style="opacity:0.7;">${fmtDate(f.startDate)} — ${fmtDate(f.endDate)}</span>
                                    <span style="opacity:0.6;">${f.frozenClasses} зан.</span>
                                    ${f.status === 'pending' ? '<span style="color:#f59e0b;font-size:0.85em;">ожидает</span>' : ''}
                                </div>
                                ${f.reason ? `<div style="opacity:0.55;font-size:0.85em;">${f.reason}</div>` : ''}
                            </div>
                            ${canFreeze ? `
                                <button onclick="cancelFreeze('${f._id || f.id}')" class="icon-btn" title="Отменить заморозку" style="color:#ef4444;">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
            ` : '';

            const activeMembershipsAll = (membershipData.memberships || []).filter(m => m.status === 'active');
            const activeMembershipId = activeMembership._id || activeMembership.id;
            const membershipGroup = activeMembership.groupId && typeof activeMembership.groupId === 'object'
                ? activeMembership.groupId
                : (membershipData.memberships || []).find(m => (m._id || m.id) === activeMembershipId)?.groupId || null;
            const groupSchedules = membershipGroup?.schedules
                || student.groups?.find(sg => sg.groupId?.id === activeMembership.groupId || sg.group?.id === activeMembership.groupId)?.group?.schedules
                || student.groups?.find(sg => sg.status === 'active')?.group?.schedules
                || [];
            const regularScheduleText = typeof window.formatRegularScheduleCompact === 'function'
                ? window.formatRegularScheduleCompact(groupSchedules)
                : '—';
            let membershipEndDateText = '—';
            if (activeMembership.endDate) {
                const d = new Date(activeMembership.endDate);
                if (!isNaN(d.getTime())) {
                    membershipEndDateText = d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
                }
            }
            const membershipPeriodDays = activeMembership.startDate && activeMembership.endDate
                ? Math.max(1, Math.round((new Date(activeMembership.endDate) - new Date(activeMembership.startDate)) / (1000 * 60 * 60 * 24)))
                : null;
            const membershipPeriodLabel = membershipPeriodDays
                ? (membershipPeriodDays >= 85 && membershipPeriodDays <= 95 ? '3 месяца' : `${membershipPeriodDays} дн.`)
                : '—';

            const membershipsOverview = `
                <div class="student-membership-list">
                    <div class="student-membership-list-head">
                        <div>
                            <strong>Активные тарифы</strong>
                            <span>${activeMembershipsAll.length} шт. Нажмите «Открыть», чтобы посмотреть подробности.</span>
                        </div>
                    </div>
                    ${activeMembershipsAll.map(membership => {
                        const membershipId = membership._id || membership.id;
                        const isSelected = membershipId === (activeMembership._id || activeMembership.id);
                        return `
                            <div class="student-membership-item ${isSelected ? 'is-selected' : ''}">
                                <div class="student-membership-item-head">
                                    <div>
                                        <strong>${escapeHtml(membership.plan?.name || typeNames[membership.type] || membership.type)}</strong>
                                        <span>${escapeHtml(membership.plan?.direction?.name || membership.groupId?.name || 'Без привязки к группе')}</span>
                                    </div>
                                    <span class="student-membership-balance">${getMembershipAverageCharge(membership) ? `${formatAmount(getMembershipAverageCharge(membership))} / урок` : 'Без расчета'}</span>
                                </div>
                                <div class="student-membership-item-actions">
                                    <button type="button" class="table-btn" onclick="selectStudentMembership('${membershipId}')">${isSelected ? 'Открыт' : 'Открыть'}</button>
                                    <button type="button" class="table-btn" onclick="openMembershipModal('${membershipId}')">Продлить этот</button>
                                    ${canAddClasses ? `<button type="button" class="table-btn student-membership-delete" onclick="deleteStudentMembership('${membershipId}')">Удалить</button>` : ''}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;

            document.getElementById('studentMembershipInfo').innerHTML = `
                    ${membershipsOverview}
                    <div class="student-membership-detail-title">
                        Подробности выбранного тарифа
                    </div>
                    <div style="display: grid; grid-template-columns: auto 1fr; gap: 15px; align-items: center;">
                        <strong style="color: rgba(255,255,255,0.7);">Тариф:</strong>
                        <span>${escapeHtml(activeMembership.plan?.name || typeNames[activeMembership.type] || activeMembership.type)}</span>
                        
                        <strong style="color: rgba(255,255,255,0.7);">Среднее списание:</strong>
                        <span>${lessonPrice ? `${formatAmount(lessonPrice)} за урок` : 'Не рассчитано'}</span>

                        <strong style="color: rgba(255,255,255,0.7);">Остаток по балансу:</strong>
                        <span style="color:${calculatedLessonsColor};font-weight:800;">
                            ${calculatedLessonsRemaining === null ? '—' : `${calculatedLessonsRemaining} ${getDeclension(Math.abs(calculatedLessonsRemaining), 'урок', 'урока', 'уроков')}`}
                        </span>

                        <strong style="color: rgba(255,255,255,0.7);">Денежный баланс:</strong>
                        <span>${formatAmount(student.accountBalance || 0)}</span>

                        <strong style="color: rgba(255,255,255,0.7);">Заморозок использовано:</strong>
                        <span>${freezesText}</span>
                        ${freezesListHTML}

                        <strong style="color: rgba(255,255,255,0.7);">Период абонемента:</strong>
                        <span>${membershipPeriodLabel}</span>

                        <strong style="color: rgba(255,255,255,0.7);">Действует до:</strong>
                        <span>${membershipEndDateText}</span>
                        
                        <strong style="color: rgba(255,255,255,0.7);">Активирован:</strong>
                        <span>${(() => {
                            if (!activeMembership.startDate) return '—';
                            const d = new Date(activeMembership.startDate);
                            return !isNaN(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
                        })()}</span>
                        
                        <strong style="color: rgba(255,255,255,0.7);">Стоимость:</strong>
                        <span>${formatAmount(activeMembership.totalPrice || 0)}</span>

                        <strong style="color: rgba(255,255,255,0.7);">Статус:</strong>
                        <span style="color: #10b981;">${activeMembership.status === 'active' ? 'Активен' : 'Неактивен'}</span>
                    </div>
                `;
        } else {
            document.getElementById('studentMembershipInfo').innerHTML = `
                <p style="text-align: center; opacity: 0.5; padding: 20px;">Нет активного тарифа</p>
            `;
        }

        // 💰 Рендерим платежи студента
        // Rendering payments for student

        if (paymentsData.success && paymentsData.payments && paymentsData.payments.length > 0) {
            const payments = paymentsData.payments;
            const summary = paymentsData.summary || {};
            // Payments found for display

            const paymentsHTML = payments.slice(0, 4).map(payment => {
                const paymentDateObj = new Date(payment.paymentDate);
                const date = !isNaN(paymentDateObj.getTime()) ? paymentDateObj.toLocaleDateString('ru', { day: '2-digit', month: 'short' }) : '—';
                const isRefund = payment.status === 'refunded';
                const statusColor = payment.status === 'completed' ? '#10b981' : (isRefund ? '#ef4444' : '#f59e0b');

                const statusIcon = payment.status === 'completed'
                    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${statusColor}" stroke-width="3">
                        <polyline points="20 6 9 17 4 12"></polyline>
                       </svg>`
                    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${statusColor}" stroke-width="2.5">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                       </svg>`;

                const methodLabel = (typeof getPaymentMethodLabel === 'function')
                    ? getPaymentMethodLabel(payment.paymentMethod)
                    : (payment.paymentMethod || '');

                const totalDiscount = Number(payment.discountPercent) || 0;
                const basePrice = Number(payment.basePrice) || 0;
                const discountHtml = (totalDiscount > 0 && basePrice > 0)
                    ? `<div style="font-size: 0.85em; opacity: 0.75; margin-top: 2px; color: #10b981;">
                            <span style="text-decoration: line-through; opacity: 0.7;">${formatAmount(basePrice)}</span>
                            − ${totalDiscount}% = <b>${formatAmount(payment.amount)}</b>
                       </div>`
                    : '';

                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.85em;">
                        <div style="flex: 1; display: flex; align-items: center; gap: 8px;">
                            <span style="display: flex; align-items: center;">${statusIcon}</span>
                            <div>
                                <div style="font-weight: 500; color:${isRefund ? '#ef8585' : 'inherit'};">${isRefund ? '− ' : ''}${formatAmount(payment.amount)}</div>
                                <div style="font-size: 0.85em; opacity: 0.6; margin-top: 2px;">
                                    ${getPaymentTypeText(payment.type)}
                                    ${methodLabel ? ` <span style="font-size: 0.9em; opacity: 0.8; color: #60a5fa;">· ${methodLabel}</span>` : ''}
                                </div>
                                ${discountHtml}
                            </div>
                        </div>
                        <div class="student-payment-actions">
                            <span style="opacity: 0.5; font-size: 0.85em;">${date}</span>
                            ${payment.status === 'completed' ? `
                                <button type="button" onclick="openEditPaymentModal('${payment._id || payment.id}')">Изменить</button>
                                <button type="button" class="is-refund" onclick="openRefundModal('${payment._id || payment.id}')">Возврат</button>
                            ` : ''}
                        </div>
                    </div>
                `;
            }).join('');

            document.getElementById('studentPaymentsInfo').style.display = 'flex';
            document.getElementById('studentPaymentsInfo').style.flexDirection = 'column';
            document.getElementById('studentPaymentsInfo').innerHTML = `
                ${paymentsHTML}
                <div style="margin-top: auto; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1);">
                    <div style="display: flex; justify-content: space-between; font-size: 0.85em;">
                        <div>
                            <div style="opacity: 0.6; font-size: 0.8em; margin-bottom: 2px;">ОПЛАЧЕНО</div>
                            <div style="font-weight: 600; color: #10b981; font-size: 1.1em;">${formatAmount(summary.totalPaid || 0)}</div>
                        </div>
                        <div style="text-align: right;">
                            <div style="opacity: 0.6; font-size: 0.8em; margin-bottom: 2px;">БАЛАНС</div>
                            <div style="font-weight: 600; color: ${(summary.balance || 0) > 0 ? '#10b981' : (summary.balance || 0) < 0 ? '#ef4444' : '#94a3b8'}; font-size: 1.1em;">${formatAmount(summary.balance || 0)}</div>
                        </div>
                    </div>
                    <button type="button" class="student-refund-main-btn" onclick="openRefundModal()">ВОЗВРАТ СРЕДСТВ</button>
                </div>
            `;
        } else {
            console.log(`💰 No payments to display (success: ${paymentsData.success}, payments length: ${paymentsData.payments?.length || 0})`);
            document.getElementById('studentPaymentsInfo').innerHTML = `
                <p style="text-align: center; opacity: 0.4; padding: 15px; font-size: 0.85em;">Нет платежей</p>
            `;
        }
    } catch (error) {
        console.error('❌ viewStudent ERROR:', error);
        console.error('Error details:', {
            message: error.message,
            name: error.name,
            stack: error.stack
        });
        toast.error('Не удалось загрузить карточку ученика');

        showStudentDetailModal();
        if (basicProfileRendered) {
            const membershipInfo = document.getElementById('studentMembershipInfo');
            if (membershipInfo) {
                membershipInfo.innerHTML = '<p style="text-align:center;color:#ef4444;padding:20px;">Часть данных карточки пока недоступна. Обновите страницу позже.</p>';
            }
        } else {
            const title = document.getElementById('studentDetailModalTitle');
            if (title) title.textContent = 'Карточка недоступна';
            const basicInfo = document.getElementById('studentBasicInfo');
            if (basicInfo) {
                basicInfo.innerHTML = `
                    <div style="text-align:center; padding:30px; color:#ef4444;">
                        <p style="font-weight:700; margin-bottom:8px;">Не удалось загрузить карточку ученика</p>
                        <p style="opacity:0.75;">Обновите страницу и попробуйте снова.</p>
                    </div>
                `;
            }
        }
    }
}

// =====================================================
// Блок «Скидки и категория» в профиле ученика
// =====================================================
const CONCESSION_OPTIONS = [
    { value: '',             label: 'Нет' },
    { value: 'multi_child',  label: 'Многодетная семья' },
    { value: 'student',      label: 'Студент' },
    { value: 'low_income',   label: 'Малоимущий' },
    { value: 'other',        label: 'Другое' }
];

function getConcessionLabel(value) {
    const found = CONCESSION_OPTIONS.find(o => o.value === (value || ''));
    return found ? found.label : 'Нет';
}

function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Человекочитаемое имя семьи: если name не задан — собираем уникальные фамилии членов
function getFamilyDisplayName(family) {
    if (!family) return '';
    if (family.name && family.name.trim()) return family.name.trim();
    const students = Array.isArray(family.students) ? family.students : [];
    const lastNames = [];
    const seen = new Set();
    for (const s of students) {
        const ln = (s.lastName || '').trim();
        if (!ln) continue;
        const key = ln.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        lastNames.push(ln);
    }
    if (lastNames.length === 0) return 'Семья';
    return `Семья ${lastNames.join(' / ')}`;
}

function renderStudentDiscountsBlock(student) {
    if (!student) return '';
    const sid = student._id || student.id;
    const referrer = student.referredBy;
    const referrerLabel = referrer ? renderStudentFioWithAge(referrer, 'Указан') : '';
    const referrerPlaceholder = referrer ? escapeHtml(formatStudentFio(referrer) || 'Указан') : 'Поиск по фамилии / имени / телефону…';
    const referralsCount = Array.isArray(student.referrals) ? student.referrals.length : 0;

    const family = student.family;
    const familyMembers = family && Array.isArray(family.students)
        ? family.students.filter(s => (s.id || s._id) !== sid)
        : [];
    const familyName = getFamilyDisplayName(family);

    const concessionOptionsHtml = CONCESSION_OPTIONS.map(o => {
        const sel = (student.concessionType || '') === o.value ? 'selected' : '';
        return `<option value="${o.value}" ${sel}>${o.label}</option>`;
    }).join('');

    const familyMembersHtml = family
        ? (familyMembers.length === 0
            ? '<div class="discounts-hint">В семье пока только этот ученик. Добавьте других членов семьи.</div>'
            : familyMembers.map(m => `
                <div class="discounts-family-member">
                    <span>${renderStudentFioWithAge(m)}</span>
                    <button class="discounts-btn is-danger is-small family-remove-btn" type="button"
                        data-family-id="${family.id || family._id}" data-student-id="${m.id || m._id}">
                        Убрать
                    </button>
                </div>
            `).join(''))
        : '';

    const familySection = family
        ? `
            <div class="discounts-family-head">
                <div class="discounts-family-name">${escapeHtml(familyName)}</div>
                <div class="discounts-family-actions">
                    <button id="familyAddMemberBtn" type="button" class="discounts-btn is-primary">+ Добавить</button>
                    <button id="familyLeaveBtn" type="button" class="discounts-btn is-danger">Выйти</button>
                </div>
            </div>
            <div class="discounts-family-list">${familyMembersHtml}</div>
        `
        : `
            <div class="discounts-inline">
                <button id="familyCreateBtn" type="button" class="discounts-btn is-primary">Создать семью</button>
                <button id="familyJoinBtn" type="button" class="discounts-btn is-info">Присоединить к существующей</button>
            </div>
        `;

    return `
        <div class="student-discounts discounts-grid" data-student-id="${sid}">
            <div class="discounts-row">
                <div class="discounts-label">Кто привёл</div>
                <div class="discounts-inline">
                    <input type="text" id="referrerSearchInput"
                        placeholder="${referrerPlaceholder}">
                    ${referrer ? `<button id="referrerClearBtn" type="button" class="discounts-btn is-danger">Убрать</button>` : ''}
                </div>
                <div id="referrerSearchResults" class="discounts-search-results"></div>
                ${referrer ? `<div class="discounts-meta" style="margin-top: 10px;">Привёл: <b>${referrerLabel}</b></div>` : ''}
                ${referralsCount > 0 ? `<div class="discounts-meta" style="margin-top: 15px;">
                    <b>Сам привёл (${referralsCount}):</b>
                    <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 5px;">
                        ${student.referrals.map(r => `
                            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.05); padding: 6px 10px; border-radius: 6px;">
                                <span>${renderStudentFioWithAge(r)}</span>
                                <button type="button" class="discounts-btn is-danger is-small referral-remove-btn" data-id="${r.id || r._id}">Отвязать</button>
                            </div>
                        `).join('')}
                    </div>
                </div>` : ''}
            </div>

            <div class="discounts-row">
                <div class="discounts-label">Семья</div>
                ${familySection}
            </div>

            <div class="discounts-row">
                <div class="discounts-label">Льготная категория</div>
                <select id="concessionSelect">${concessionOptionsHtml}</select>
            </div>

            <div id="discountsStatus" class="discounts-status"></div>
        </div>
    `;
}

function initStudentDiscountsHandlers(student) {
    const container = document.querySelector('.student-discounts');
    if (!container) return;
    const sid = container.dataset.studentId;
    const statusEl = document.getElementById('discountsStatus');

    const setStatus = (text, opacity = '1') => {
        if (!statusEl) return;
        statusEl.textContent = text;
        statusEl.style.opacity = opacity;
    };

    const patchStudent = async (patch, onSuccess) => {
        setStatus('⏳');
        try {
            const resp = await fetch(`${API_URL}/students/${sid}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getAuthToken()}`
                },
                body: JSON.stringify(patch)
            });
            const data = await resp.json();
            if (data.success) {
                setStatus('Сохранено ✓', '0.7');
                setTimeout(() => setStatus(''), 1500);
                if (typeof onSuccess === 'function') onSuccess(data.student);
            } else {
                setStatus('Ошибка ✕');
                toast.error(data.error || 'Не удалось сохранить');
            }
        } catch (err) {
            console.error('Discounts save error:', err);
            setStatus('Ошибка сети ✕');
        }
    };

    // --- Concession ---
    const concessionSelect = document.getElementById('concessionSelect');
    if (concessionSelect) {
        concessionSelect.addEventListener('change', () => {
            patchStudent({ concessionType: concessionSelect.value || null });
        });
    }

    // --- Referrer search ---
    const referrerInput = document.getElementById('referrerSearchInput');
    const referrerResults = document.getElementById('referrerSearchResults');
    const referrerClearBtn = document.getElementById('referrerClearBtn');

    if (referrerClearBtn) {
        referrerClearBtn.addEventListener('click', () => {
            if (confirm('Отвязать этого ученика от того, кто его привёл?')) {
                patchStudent({ referredByStudentId: null }, () => viewStudent(sid));
            }
        });
    }

    // --- Remove individual referrals (whom this student brought) ---
    document.querySelectorAll('.referral-remove-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Отвязать этого ученика? Он больше не будет считаться приглашенным вами.')) return;
            setStatus('⏳');
            try {
                const targetId = btn.dataset.id;
                const resp = await fetch(`${API_URL}/students/${targetId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${getAuthToken()}`
                    },
                    body: JSON.stringify({ referredByStudentId: null })
                });
                const data = await resp.json();
                if (data.success) {
                    setStatus('Отвязано ✓', '0.7');
                    setTimeout(() => setStatus(''), 1500);
                    viewStudent(sid); // Refresh current student profile
                } else {
                    setStatus('Ошибка ✕');
                    toast.error(data.error || 'Не удалось отвязать');
                }
            } catch (err) {
                console.error('Referral remove error:', err);
                setStatus('Ошибка сети ✕');
            }
        });
    });

    if (referrerInput) {
        let searchTimer = null;
        referrerInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            const q = referrerInput.value.trim();
            if (!q) {
                if (referrerResults) referrerResults.innerHTML = '';
                return;
            }
            searchTimer = setTimeout(async () => {
                try {
                    const resp = await fetch(
                        `${API_URL}/students?search=${encodeURIComponent(q)}&limit=8`,
                        { headers: { 'Authorization': `Bearer ${getAuthToken()}` } }
                    );
                    const data = await resp.json();
                    const list = data.students || data.data || [];
                    if (!referrerResults) return;
                    if (list.length === 0) {
                        referrerResults.innerHTML = '<div class="discounts-hint">Ничего не найдено</div>';
                        return;
                    }
                    referrerResults.innerHTML = list
                        .filter(s => (s._id || s.id) !== sid)
                        .slice(0, 8)
                        .map(s => {
                            const uid = s._id || s.id;
                            return `
                                <div class="discounts-search-item referrer-pick-btn" data-id="${uid}">
                                    ${renderStudentFioWithAge(s)} · ${escapeHtml(s.phone || '')}
                                </div>
                            `;
                        })
                        .join('');
                    referrerResults.querySelectorAll('.referrer-pick-btn').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const id = btn.dataset.id;
                            patchStudent({ referredByStudentId: id }, () => viewStudent(sid));
                        });
                    });
                } catch (err) {
                    console.error('Referrer search error:', err);
                }
            }, 300);
        });
    }

    // --- Family: create/join/leave/add/remove members ---
    const createBtn = document.getElementById('familyCreateBtn');
    if (createBtn) {
        createBtn.addEventListener('click', async () => {
            setStatus('⏳');
            try {
                const resp = await fetch(`${API_URL}/families`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${getAuthToken()}`
                    },
                    body: JSON.stringify({ studentIds: [sid] })
                });
                const data = await resp.json();
                if (data.success) {
                    setStatus('');
                    viewStudent(sid);
                } else {
                    setStatus('Ошибка ✕');
                    toast.error(data.error || 'Не удалось создать семью');
                }
            } catch (err) {
                console.error('Family create error:', err);
                setStatus('Ошибка сети ✕');
            }
        });
    }

    const joinBtn = document.getElementById('familyJoinBtn');
    if (joinBtn) {
        joinBtn.addEventListener('click', () => openFamilyJoinPopup(sid));
    }

    const leaveBtn = document.getElementById('familyLeaveBtn');
    if (leaveBtn) {
        leaveBtn.addEventListener('click', () => {
            if (!confirm('Убрать ученика из семьи?')) return;
            patchStudent({ familyId: null }, () => viewStudent(sid));
        });
    }

    const addMemberBtn = document.getElementById('familyAddMemberBtn');
    if (addMemberBtn) {
        addMemberBtn.addEventListener('click', () => {
            const familyId = student.family ? (student.family.id || student.family._id) : null;
            if (!familyId) return;
            openFamilyAddMemberPopup(familyId, sid);
        });
    }

    container.querySelectorAll('.family-remove-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const familyId = btn.dataset.familyId;
            const memberId = btn.dataset.studentId;
            if (!familyId || !memberId) return;
            if (!confirm('Убрать из семьи?')) return;
            try {
                const resp = await fetch(`${API_URL}/families/${familyId}/members/${memberId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${getAuthToken()}` }
                });
                const data = await resp.json();
                if (data.success) viewStudent(sid);
                else toast.error(data.error || 'Ошибка');
            } catch (err) {
                console.error('Family remove error:', err);
            }
        });
    });
}

// Попап: присоединить ученика к существующей семье (поиск любого члена семьи)
function openFamilyJoinPopup(studentId) {
    const existing = document.getElementById('familyJoinPopup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.id = 'familyJoinPopup';
    popup.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: #1e1e2e; border: 1px solid rgba(255,255,255,0.15); border-radius: 10px;
        padding: 20px 22px; z-index: 10000; width: 360px; max-width: 92vw; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    `;
    popup.innerHTML = `
        <div style="font-size:0.85em;opacity:0.75;margin-bottom:10px;letter-spacing:0.05em;">ПРИСОЕДИНИТЬ К СЕМЬЕ</div>
        <div style="font-size:0.8em;opacity:0.6;margin-bottom:10px;">Найдите любого члена семьи — ученик будет добавлен в эту же семью.</div>
        <input type="text" id="familyJoinSearch" placeholder="Поиск ученика…"
            style="width:100%;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.2);border-radius:6px;padding:10px 12px;color:#fff;font-size:0.95em;outline:none;box-sizing:border-box;margin-bottom:10px;">
        <div id="familyJoinResults" style="max-height:220px;overflow-y:auto;"></div>
        <div style="display:flex;gap:10px;margin-top:10px;">
            <button id="familyJoinCancel"
                style="flex:1;padding:8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#fff;cursor:pointer;font-size:0.9em;">Отмена</button>
        </div>
    `;
    document.body.appendChild(popup);

    document.getElementById('familyJoinCancel').addEventListener('click', () => popup.remove());

    const searchInput = document.getElementById('familyJoinSearch');
    const resultsEl = document.getElementById('familyJoinResults');
    let t = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(t);
        const q = searchInput.value.trim();
        if (!q) { resultsEl.innerHTML = ''; return; }
        t = setTimeout(async () => {
            try {
                const resp = await fetch(
                    `${API_URL}/students?search=${encodeURIComponent(q)}&limit=10`,
                    { headers: { 'Authorization': `Bearer ${getAuthToken()}` } }
                );
                const data = await resp.json();
                const list = (data.students || data.data || []).filter(s => {
                    const fid = s.familyId || (s.family && (s.family.id || s.family._id));
                    return fid; // показываем только тех, у кого уже есть семья
                });
                if (list.length === 0) {
                    resultsEl.innerHTML = '<div style="opacity:0.6;font-size:0.85em;padding:6px 0;">Ни у кого из найденных нет семьи</div>';
                    return;
                }
                resultsEl.innerHTML = list.map(s => {
                    const uid = s._id || s.id;
                    const fid = s.familyId || (s.family && (s.family.id || s.family._id));
                    return `
                        <button class="family-join-pick" data-family-id="${fid}"
                            style="display:block;width:100%;text-align:left;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:8px 10px;color:#fff;font-size:0.9em;cursor:pointer;margin-bottom:6px;">
                            ${renderStudentFioWithAge(s)} · ${escapeHtml(s.phone || '')}
                        </button>
                    `;
                }).join('');
                resultsEl.querySelectorAll('.family-join-pick').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const fid = btn.dataset.familyId;
                        try {
                            const resp = await fetch(`${API_URL}/families/${fid}/members`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${getAuthToken()}`
                                },
                                body: JSON.stringify({ studentId })
                            });
                            const data = await resp.json();
                            if (data.success) {
                                popup.remove();
                                viewStudent(studentId);
                            } else {
                                toast.error(data.error || 'Ошибка');
                            }
                        } catch (err) {
                            console.error('Join family error:', err);
                        }
                    });
                });
            } catch (err) {
                console.error('Family search error:', err);
            }
        }, 300);
    });
}

// Попап: добавить нового ученика в текущую семью
function openFamilyAddMemberPopup(familyId, currentStudentId) {
    const existing = document.getElementById('familyAddPopup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.id = 'familyAddPopup';
    popup.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: #1e1e2e; border: 1px solid rgba(255,255,255,0.15); border-radius: 10px;
        padding: 20px 22px; z-index: 10000; width: 360px; max-width: 92vw; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    `;
    popup.innerHTML = `
        <div style="font-size:0.85em;opacity:0.75;margin-bottom:10px;letter-spacing:0.05em;">ДОБАВИТЬ В СЕМЬЮ</div>
        <input type="text" id="familyAddSearch" placeholder="Поиск ученика…"
            style="width:100%;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.2);border-radius:6px;padding:10px 12px;color:#fff;font-size:0.95em;outline:none;box-sizing:border-box;margin-bottom:10px;">
        <div id="familyAddResults" style="max-height:220px;overflow-y:auto;"></div>
        <div style="display:flex;gap:10px;margin-top:10px;">
            <button id="familyAddCancel"
                style="flex:1;padding:8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#fff;cursor:pointer;font-size:0.9em;">Закрыть</button>
        </div>
    `;
    document.body.appendChild(popup);

    document.getElementById('familyAddCancel').addEventListener('click', () => popup.remove());

    const searchInput = document.getElementById('familyAddSearch');
    const resultsEl = document.getElementById('familyAddResults');
    let t = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(t);
        const q = searchInput.value.trim();
        if (!q) { resultsEl.innerHTML = ''; return; }
        t = setTimeout(async () => {
            try {
                const resp = await fetch(
                    `${API_URL}/students?search=${encodeURIComponent(q)}&limit=10`,
                    { headers: { 'Authorization': `Bearer ${getAuthToken()}` } }
                );
                const data = await resp.json();
                const list = (data.students || data.data || []).filter(s => (s._id || s.id) !== currentStudentId);
                if (list.length === 0) {
                    resultsEl.innerHTML = '<div style="opacity:0.6;font-size:0.85em;padding:6px 0;">Ничего не найдено</div>';
                    return;
                }
                resultsEl.innerHTML = list.map(s => {
                    const uid = s._id || s.id;
                    return `
                        <button class="family-add-pick" data-id="${uid}"
                            style="display:block;width:100%;text-align:left;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:8px 10px;color:#fff;font-size:0.9em;cursor:pointer;margin-bottom:6px;">
                            ${renderStudentFioWithAge(s)} · ${escapeHtml(s.phone || '')}
                        </button>
                    `;
                }).join('');
                resultsEl.querySelectorAll('.family-add-pick').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const studentId = btn.dataset.id;
                        try {
                            const resp = await fetch(`${API_URL}/families/${familyId}/members`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${getAuthToken()}`
                                },
                                body: JSON.stringify({ studentId })
                            });
                            const data = await resp.json();
                            if (data.success) {
                                popup.remove();
                                viewStudent(currentStudentId);
                            } else {
                                toast.error(data.error || 'Ошибка');
                            }
                        } catch (err) {
                            console.error('Add family member error:', err);
                        }
                    });
                });
            } catch (err) {
                console.error('Family search error:', err);
            }
        }, 300);
    });
}

// =====================================================
// Изменить дату обещанного платежа (inline попап)
// =====================================================
function editPromisedPaymentDate(paymentId, currentDueDate) {
    // Убираем существующий попап если есть
    const existing = document.getElementById('dueDatePopup');
    if (existing) existing.remove();

    // Дефолтная дата в инпуте: текущая dueDate или завтра
    let defaultDate = '';
    if (currentDueDate) {
        defaultDate = new Date(currentDueDate).toISOString().split('T')[0];
    } else {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        defaultDate = tomorrow.toISOString().split('T')[0];
    }

    const popup = document.createElement('div');
    popup.id = 'dueDatePopup';
    popup.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: #1e1e2e; border: 1px solid rgba(255,255,255,0.15); border-radius: 10px;
        padding: 20px 24px; z-index: 10000; min-width: 280px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    `;
    popup.innerHTML = `
        <div style="font-size: 0.85em; opacity: 0.7; margin-bottom: 10px; letter-spacing: 0.05em;">ДАТА ОБЕЩАННОГО ПЛАТЕЖА</div>
        <input type="date" id="dueDateInput" value="${defaultDate}"
            style="width: 100%; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.2);
                   border-radius: 6px; padding: 10px 12px; color: #fff; font-size: 1em;
                   outline: none; box-sizing: border-box; margin-bottom: 14px;">
        <div style="display: flex; gap: 10px;">
            <button id="dueDateSaveBtn"
                style="flex: 1; padding: 9px; background: #e91e8c; border: none; border-radius: 6px;
                       color: #fff; font-weight: 600; cursor: pointer; font-size: 0.9em;">
                Сохранить
            </button>
            ${currentDueDate ? `
            <button id="dueDateClearBtn"
                style="padding: 9px 14px; background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3);
                       border-radius: 6px; color: #ef4444; font-weight: 600; cursor: pointer; font-size: 0.9em;"
                title="Убрать дату">
                ✕
            </button>` : ''}
            <button id="dueDateCancelBtn"
                style="padding: 9px 14px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1);
                       border-radius: 6px; color: #fff; cursor: pointer; font-size: 0.9em;">
                Отмена
            </button>
        </div>
    `;
    document.body.appendChild(popup);

    const close = () => popup.remove();

    document.getElementById('dueDateCancelBtn').addEventListener('click', close);

    if (currentDueDate) {
        document.getElementById('dueDateClearBtn').addEventListener('click', async () => {
            await saveDueDate(paymentId, null);
            close();
        });
    }

    document.getElementById('dueDateSaveBtn').addEventListener('click', async () => {
        const val = document.getElementById('dueDateInput').value;
        if (!val) { toast.error('Выберите дату'); return; }
        await saveDueDate(paymentId, val);
        close();
    });

    // Закрыть по клику вне попапа
    setTimeout(() => {
        document.addEventListener('click', function outsideClick(e) {
            if (!popup.contains(e.target)) {
                close();
                document.removeEventListener('click', outsideClick);
            }
        });
    }, 50);
}

async function saveDueDate(paymentId, dateValue) {
    try {
        const res = await fetch(`${API_URL}/payments/${paymentId}/due-date`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ dueDate: dateValue })
        });
        const data = await res.json();
        if (data.success) {
            toast.success(dateValue ? 'Дата обновлена' : 'Дата убрана');
            if (currentViewingStudentId) await viewStudent(currentViewingStudentId);
        } else {
            toast.error(data.error || 'Ошибка сохранения');
        }
    } catch (e) {
        console.error(e);
        toast.error('Ошибка сети');
    }
}

// Закрыть модальное окно детального просмотра ученика
function closeStudentDetailModal() {
    const modal = document.getElementById('studentDetailModal');
    if (modal) {
        modal.classList.remove('show');
        modal.style.removeProperty('display');
        modal.style.removeProperty('visibility');
        modal.style.removeProperty('opacity');
        modal.style.removeProperty('pointer-events');
        modal.style.removeProperty('z-index');
        modal.querySelector('.modal-content')?.removeAttribute('style');
    }
    currentViewingStudentId = null;
    currentViewingStudentStatus = null;
    selectedStudentMembershipId = null;
    // Сбрасываем режим редактирования при закрытии
    const editForm = document.getElementById('studentEditForm');
    const basicInfo = document.getElementById('studentBasicInfo');
    if (editForm && basicInfo) {
        editForm.style.display = 'none';
        basicInfo.style.display = '';
        updateStudentEditButton(false);
    }
}

if (!window.__studentDetailEscapeCloseBound) {
    window.__studentDetailEscapeCloseBound = true;
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const modal = document.getElementById('studentDetailModal');
        if (!modal?.classList.contains('show')) return;
        const anotherModalIsOpen = Array.from(document.querySelectorAll('.modal.show'))
            .some(item => item.id && item.id !== 'studentDetailModal');
        if (anotherModalIsOpen) return;
        event.preventDefault();
        closeStudentDetailModal();
    });
}

window.selectStudentMembership = async function(membershipId) {
    selectedStudentMembershipId = membershipId;
    if (currentViewingStudentId) await viewStudent(currentViewingStudentId);
};

window.deleteStudentMembership = async function(membershipId) {
    if (!membershipId || !currentViewingStudentId) return;
    const confirmed = await customConfirm(
        'Удалить этот абонемент?\n\nПлатежи останутся в истории ученика, но сам абонемент, его списания и заморозки будут удалены.'
    );
    if (!confirmed) return;

    try {
        const response = await fetch(`${API_URL}/memberships/${membershipId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Не удалось удалить абонемент');
        }
        selectedStudentMembershipId = result.replacementMembershipId || null;
        invalidateCache('dashboard', 'membership-actions', 'students');
        toast.success(result.message || 'Абонемент удалён');
        await viewStudent(currentViewingStudentId);
    } catch (error) {
        toast.error(error.message);
    }
};

function openStudentPausePeriodModal() {
    return new Promise(resolve => {
        const today = new Date();
        const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        document.getElementById('studentPausePeriodModal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'studentPausePeriodModal';
        modal.className = 'modal show student-departure-modal';
        modal.innerHTML = `
            <div class="modal-overlay" data-close-student-pause-modal></div>
            <div class="modal-content student-departure-dialog">
                <button type="button" class="modal-close" data-close-student-pause-modal>×</button>
                <p class="student-departure-eyebrow">ПАУЗА УЧЕНИКА</p>
                <h2>Поставить ученика на паузу</h2>
                <p class="student-departure-description">Укажите дату окончания, если пауза временная. Без даты пауза будет бессрочной: будущие занятия и индивидуальное расписание ученика удалятся.</p>
                <form id="studentPausePeriodForm">
                    <div class="form-group">
                        <label>ОКОНЧАНИЕ ПАУЗЫ</label>
                        <input type="date" class="admin-input" name="endDate" min="${todayISO}">
                        <small style="opacity: 0.7; display: block; margin-top: 5px;">С датой расписание сохранится, а занятия на период паузы будут убраны из списка ученика.</small>
                    </div>
                    <div style="display:flex; gap:10px; margin-top:20px;">
                        <button type="button" class="admin-btn btn-secondary" data-close-student-pause-modal style="flex:1;">ОТМЕНА</button>
                        <button type="submit" class="admin-btn btn-primary" style="flex:1;">ПОСТАВИТЬ НА ПАУЗУ</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(modal);

        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            modal.remove();
            resolve(result);
        };
        modal.querySelectorAll('[data-close-student-pause-modal]').forEach(button => {
            button.addEventListener('click', () => finish({ confirmed: false, endDate: null }));
        });
        modal.querySelector('#studentPausePeriodForm')?.addEventListener('submit', event => {
            event.preventDefault();
            finish({
                confirmed: true,
                endDate: String(new FormData(event.currentTarget).get('endDate') || '').trim() || null,
            });
        });
    });
}

window.toggleStudentPauseState = async function() {
    if (!currentViewingStudentId) {
        toast.error('Ученик не выбран');
        return;
    }

    const isPaused = currentViewingStudentStatus !== 'active';
    let pauseEndDate = null;
    if (isPaused) {
        const confirmed = await customConfirm(
            'Вернуть ученика в активные?\n\nЕсли пауза была временной, группы снова станут активными. Индивидуальное расписание сохранится только если при паузе была указана дата окончания.'
        );
        if (!confirmed) return;
    } else {
        const pauseResult = await openStudentPausePeriodModal();
        if (!pauseResult.confirmed) return;
        pauseEndDate = pauseResult.endDate;
    }

    const btn = document.getElementById('pauseStudentBtn');
    if (btn) btn.disabled = true;

    try {
        const action = isPaused ? 'resume' : 'pause';
        const response = await fetch(`${API_URL}/students/${currentViewingStudentId}/${action}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json',
            },
            body: isPaused ? undefined : JSON.stringify({ endDate: pauseEndDate }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Не удалось изменить статус ученика');
        }

        invalidateCache('dashboard', 'students', 'groups', 'membership-actions');
        const details = !isPaused
            ? `${pauseEndDate ? `Пауза до ${new Date(`${pauseEndDate}T00:00:00`).toLocaleDateString('ru-RU')}` : 'Бессрочная пауза'}. Групп снято: ${result.pausedGroups || 0}, индивидуальных слотов удалено: ${result.removedIndividualSchedules || 0}, будущих уроков убрано: ${(result.removedFutureIndividualClasses || 0) + (result.removedFutureClassAttendees || 0)}`
            : `Ученик снова активен. Групп восстановлено: ${result.restoredGroups || 0}${result.wasTemporaryPause ? '' : '. Бессрочная пауза удаляла расписание — его нужно назначить заново'}`;
        toast.success(`${result.message || 'Готово'}. ${details}`);
        await viewStudent(currentViewingStudentId);
        if (typeof renderStudents === 'function') {
            renderStudents(currentStudentSearch, currentStudentPage, currentStudentFilter);
        }
    } catch (error) {
        toast.error(error.message || 'Не удалось изменить статус ученика');
    } finally {
        if (btn) btn.disabled = false;
    }
};

// Переключить режим редактирования
function toggleStudentEditMode() {
    console.log('toggleStudentEditMode called');
    const editForm = document.getElementById('studentEditForm');
    const basicInfo = document.getElementById('studentBasicInfo');

    if (!editForm || !basicInfo) {
        console.warn('Edit form or basic info not found', { editForm, basicInfo });
        return;
    }

    const isEditing = editForm.style.display !== 'none';

    if (isEditing) {
        // Выходим из режима редактирования
        editForm.style.display = 'none';
        basicInfo.style.display = 'block';
        updateStudentEditButton(false);
    } else {
        // Входим в режим редактирования
        if (!currentViewingStudentId) {
            toast.error('Ученик не выбран');
            return;
        }

        // Загружаем текущие данные ученика для формы
        loadStudentDataForEdit(currentViewingStudentId);

        editForm.style.display = 'block';
        basicInfo.style.display = 'none';
        updateStudentEditButton(true);
    }
}

// Загрузить данные ученика для редактирования
async function loadStudentDataForEdit(studentId) {
    try {
        const token = getAuthToken();
        const [data, teachersData] = await Promise.all([
            fetch(`${API_URL}/students/${studentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(response => response.json()),
            fetch(`${API_URL}/users?role=teacher&limit=100`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(response => response.json()).catch(() => ({ users: [] }))
        ]);
        if (data.success && data.student) {
            const student = data.student;
            document.getElementById('editStudentName').value = student.name || '';
            document.getElementById('editStudentLastName').value = student.lastName || '';
            document.getElementById('editStudentMiddleName').value = student.middleName || '';
            document.getElementById('editStudentDateOfBirth').value = toDateInputValue(student.dateOfBirth);
            document.getElementById('editStudentPhone').value = student.phone || '';
            setStudentPhoneRouting(document.querySelector('[data-phone-contact].is-primary'), student, student);
            document.getElementById('editStudentGender').value = student.gender || '';
            document.getElementById('editStudentCustomerName').value = student.customerName || '';
            document.getElementById('editStudentSource').value = student.acquisitionSource || '';
            document.getElementById('editStudentDirections').value = (student.learningDirections || []).join(', ');
            document.getElementById('editStudentLevel').value = student.learningLevel || '';
            const notesInput = document.getElementById('editStudentNotes');
            if (notesInput) notesInput.value = student.notes || '';
            const teacherSelect = document.getElementById('editStudentAssignedTeacher');
            if (teacherSelect) {
                const selectedTeacherId = student.assignedTeacher?._id || student.assignedTeacher?.id || '';
                teacherSelect.innerHTML = '<option value="">Не закреплён</option>';
                (teachersData.users || [])
                    .filter(teacher => teacher.status !== 'inactive')
                    .forEach(teacher => {
                        const option = document.createElement('option');
                        option.value = teacher._id || teacher.id;
                        option.textContent = formatStudentFio(teacher) || 'Преподаватель';
                        if (option.value === selectedTeacherId) option.selected = true;
                        teacherSelect.appendChild(option);
                    });
            }
            const list = document.getElementById('editStudentAdditionalPhones');
            if (list) {
                list.innerHTML = '';
                (student.additionalPhones || []).forEach(item => addStudentPhoneField(item, student));
            }
        }
    } catch (error) {
        console.error('Error loading student data for edit:', error);
        toast.error('Не удалось загрузить данные ученика');
    }
}

// Сохранить изменения ученика
async function saveStudentChanges() {
    const form = document.getElementById('editStudentForm');
    if (!form) return;

    const studentId = currentViewingStudentId;
    if (!studentId) {
        toast.error('Ученик не выбран');
        return;
    }

    const name = document.getElementById('editStudentName').value.trim();
    const lastName = document.getElementById('editStudentLastName').value.trim();
    const middleName = document.getElementById('editStudentMiddleName').value.trim();
    const dateOfBirth = document.getElementById('editStudentDateOfBirth').value;
    const phone = document.getElementById('editStudentPhone').value.trim();
    const primaryNotifications = readStudentPhoneRouting(document.querySelector('[data-phone-contact].is-primary'));
    const gender = document.getElementById('editStudentGender').value;
    const additionalPhones = Array.from(document.querySelectorAll('#editStudentAdditionalPhones .student-phone-row'))
        .map(row => ({
            label: row.querySelector('[data-phone-label]')?.value.trim() || '',
            phone: row.querySelector('[data-phone-number]')?.value.trim() || '',
            ...readStudentPhoneRouting(row),
        }))
        .filter(item => item.phone);
    const customerName = document.getElementById('editStudentCustomerName').value.trim();
    const acquisitionSource = document.getElementById('editStudentSource').value.trim();
    const learningDirections = document.getElementById('editStudentDirections').value
        .split(',').map(value => value.trim()).filter(Boolean);
    const learningLevel = document.getElementById('editStudentLevel').value.trim();
    const assignedTeacherId = document.getElementById('editStudentAssignedTeacher')?.value || '';
    const notes = document.getElementById('editStudentNotes')?.value.trim() || '';

    if (!name || !lastName || !phone) {
        toast.warning('Заполните все обязательные поля');
        return;
    }

    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/students/${studentId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name,
                lastName,
                middleName,
                dateOfBirth: dateOfBirth || null,
                phone,
                ...primaryNotifications,
                gender,
                additionalPhones,
                customerName,
                acquisitionSource,
                learningDirections,
                learningLevel,
                assignedTeacherId,
                notes
            })
        });

        const data = await response.json();

        if (data.success) {
            toast.success('Данные ученика успешно обновлены');
            // Обновляем отображение данных ученика
            await viewStudent(studentId);

            // ⚡ ОПТИМИСТИЧЕСКОЕ ОБНОВЛЕНИЕ ТАБЛИЦ (Мгновенно)

            // 1. Обновляем таблицу учеников
            const studentRow = document.querySelector(`#studentsTable tr[data-student-id="${studentId}"]`);
            if (studentRow) {
                // Имя
                const nameCell = studentRow.querySelector('td[data-label="Имя"] .card-field-value') || studentRow.querySelector('td[data-label="Имя"]');
                if (nameCell) nameCell.textContent = [lastName, name, middleName].filter(Boolean).join(' ');

                // Телефон
                const phoneCell = studentRow.querySelector('td[data-label="Телефон"] .card-field-value') || studentRow.querySelector('td[data-label="Телефон"]');
                if (phoneCell && typeof getWhatsappLink === 'function') {
                    phoneCell.innerHTML = getWhatsappLink(phone);
                }
            }

            // 2. Обновляем таблицу пользователей
            const userRow = document.querySelector(`#usersTable tr[data-user-id="${studentId}"]`);
            if (userRow) {
                const cells = userRow.querySelectorAll('td');
                if (cells.length > 1) {
                    // 0: Name, 1: Phone
                    cells[0].textContent = [lastName, name, middleName].filter(Boolean).join(' ');
                    cells[1].textContent = phone;
                }
            }

            // Обновляем список учеников (фоновая синхронизация)
            if (typeof renderStudents === 'function') {
                renderStudents(currentStudentSearch, currentStudentPage, currentStudentFilter);
            }

            // Обновляем список пользователей (фоновая синхронизация)
            if (typeof window.renderUsers === 'function') {
                const roleFilter = window.currentRoleFilter || 'all';
                const search = window.currentUserSearch || '';
                const page = window.currentUserPage || 1;
                window.renderUsers(roleFilter, search, page);
            }
        } else {
            toast.error(data.error || 'Не удалось сохранить данные');
        }
    } catch (error) {
        console.error('Error saving student changes:', error);
        toast.error('Не удалось сохранить данные');
    }
}

function readStudentPhoneRouting(contact) {
    return {
        notifyHomework: Boolean(contact?.querySelector('[data-notify-kind="homework"]')?.checked),
        notifyLessons: Boolean(contact?.querySelector('[data-notify-kind="lessons"]')?.checked),
        notifyPayments: Boolean(contact?.querySelector('[data-notify-kind="payments"]')?.checked),
    };
}

function setStudentPhoneRouting(contact, phone = {}, student = null) {
    if (!contact) return;
    const allContacts = student ? [student, ...(student.additionalPhones || [])] : [];
    const legacy = allContacts.length > 0 && allContacts.every(item =>
        ['notifyHomework', 'notifyLessons', 'notifyPayments'].every(field => typeof item?.[field] !== 'boolean')
    );
    const isPrimary = contact.classList.contains('is-primary');
    const fields = {
        homework: 'notifyHomework',
        lessons: 'notifyLessons',
        payments: 'notifyPayments',
    };
    Object.entries(fields).forEach(([kind, field]) => {
        const checkbox = contact.querySelector(`[data-notify-kind="${kind}"]`);
        if (checkbox) checkbox.checked = phone?.[field] === true || (legacy && isPrimary);
    });
}

function studentPhoneRoutingControls() {
    return `
        <div class="student-phone-routing" aria-label="Уведомления для этого номера">
            <label title="Домашние задания"><input type="checkbox" data-notify-kind="homework"><span>ДЗ</span></label>
            <label title="Напоминания об уроках"><input type="checkbox" data-notify-kind="lessons"><span>Уроки</span></label>
            <label title="Напоминания об оплате"><input type="checkbox" data-notify-kind="payments"><span>Оплата</span></label>
        </div>
    `;
}

function enforceUniqueStudentPhoneRouting(event) {
    const checkbox = event.target.closest('[data-notify-kind]');
    if (!checkbox?.checked) return;
    const kind = checkbox.dataset.notifyKind;
    document.querySelectorAll(`#editStudentForm [data-notify-kind="${kind}"]`).forEach(other => {
        if (other !== checkbox) other.checked = false;
    });
}

function addStudentPhoneField(phone = {}, student = null) {
    const list = document.getElementById('editStudentAdditionalPhones');
    if (!list) return;

    const row = document.createElement('div');
    row.className = 'student-phone-row';
    row.dataset.phoneContact = '';
    row.innerHTML = `
        <input type="text" class="admin-input" data-phone-label placeholder="Кто отвечает: мама, папа…" value="${escapeHtml(phone.label || '')}">
        <input type="tel" class="admin-input" data-phone-number placeholder="+7…" value="${escapeHtml(phone.phone || '')}">
        ${studentPhoneRoutingControls()}
        <button type="button" class="student-phone-remove" title="Удалить номер">×</button>
    `;
    setStudentPhoneRouting(row, phone, student);
    row.querySelector('.student-phone-remove').onclick = () => row.remove();
    const phoneInput = row.querySelector('[data-phone-number]');
    phoneInput.addEventListener('input', event => {
        let value = event.target.value.replace(/[^\d+]/g, '');
        if (value.startsWith('8')) value = `+7${value.substring(1)}`;
        if (value && !value.startsWith('+')) value = `+${value}`;
        event.target.value = value.substring(0, 16);
    });
    list.appendChild(row);
}

document.addEventListener('change', event => {
    if (event.target.closest('#editStudentForm [data-notify-kind]')) {
        enforceUniqueStudentPhoneRouting(event);
    }
});

// Показать модальное окно создания ученика
function showStudentCreatedModal(studentName, studentPhone, password, classesCount, membershipType, copySuccess, groupInfo = null, platformInfo = null, studentId = null) {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10002;
    `;

    // Тип абонемента для отображения
    const membershipTypeText = membershipType ? ({
        'trial': 'Пробный',
        'monthly': 'Месячный',
        'monthly_12': 'Месячный (12 занятий)',
        'quarterly': 'Квартальный'
    }[membershipType] || membershipType) : '';
    const hasMembership = Boolean(membershipType);

    // Форматируем расписание группы
    let scheduleText = '';
    let practiceText = '';
    let nextClassText = '';

    if (groupInfo && groupInfo.schedule && groupInfo.schedule.length > 0) {
        const dayNames = [
            '', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'
        ];
        const dayNamesShort = ['', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];

        // Разделяем занятия и практики
        const regularClasses = groupInfo.schedule.filter(s => !s.isPractice);
        const practices = groupInfo.schedule.filter(s => s.isPractice);

        // Форматируем обычные занятия
        if (regularClasses.length > 0) {
            scheduleText = regularClasses.map(s =>
                `${dayNames[s.dayOfWeek]} ${s.time}`
            ).join('\n');
        }

        // Форматируем практики
        if (practices.length > 0) {
            practiceText = practices.map(s =>
                `${dayNames[s.dayOfWeek]} ${s.time} (Практика)`
            ).join('\n');
        }

        // Находим ближайшее занятие (только обычные, не практики)
        const now = new Date();
        const currentDay = now.getDay();

        const convertDay = (groupDay) => {
            return groupDay === 7 ? 0 : groupDay;
        };

        let nextClass = null;
        let minDaysAway = 8;

        regularClasses.forEach(s => {
            const schedDay = convertDay(s.dayOfWeek);
            let daysAway = (schedDay - currentDay + 7) % 7;
            if (daysAway === 0) daysAway = 7;

            if (daysAway < minDaysAway) {
                minDaysAway = daysAway;
                nextClass = {
                    day: dayNames[s.dayOfWeek],
                    dayShort: dayNamesShort[s.dayOfWeek],
                    time: s.time,
                    daysAway
                };
            }
        });

        if (nextClass) {
            const nextDate = new Date(now);
            nextDate.setDate(now.getDate() + nextClass.daysAway);
            const dateStr = nextDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

            nextClassText = `БЛИЖАЙШЕЕ ЗАНЯТИЕ:\n${nextClass.day}, ${dateStr} в ${nextClass.time}`;
        }
    }

    // Формируем готовое сообщение для WhatsApp
    const schoolName = (window.MAESTRO_BRAND && window.MAESTRO_BRAND.fullName) || 'Музыкальная школа Maestro';
    const supportContact = typeof getMaestroSupportText === 'function'
        ? getMaestroSupportText()
        : ((window.MAESTRO_BRAND && window.MAESTRO_BRAND.website) || 'maestro-school.duckdns.org');
    const platformLogin = platformInfo?.login || studentPhone;
    const platformUrl = platformInfo?.url || 'https://maestro-school.duckdns.org';
    const crmLoginNote = platformInfo?.login && platformInfo.login !== studentPhone
        ? `\nКабинет оплаты: ${studentPhone}`
        : '';

    const whatsappMessage = `🎉 Добро пожаловать в ${schoolName}!

ВАШ АККАУНТ В ОБУЧАЮЩЕЙ ПЛАТФОРМЕ:
━━━━━━━━━━━━━━━━━
Логин: ${platformLogin}
Пароль: ${password}${crmLoginNote}

${hasMembership ? `ВАШ АБОНЕМЕНТ:
━━━━━━━━━━━━━━━━━
Тип: ${membershipTypeText}
Занятий: ${classesCount}${groupInfo ? `
Группа: ${groupInfo.name}` : ''}${nextClassText ? `

${nextClassText}` : ''}${scheduleText ? `

РАСПИСАНИЕ ЗАНЯТИЙ:
${scheduleText}` : ''}${practiceText ? `

ПРАКТИКИ (открытые для всех групп):
${practiceText}` : ''}` : `КАРТОЧКА УЧЕНИКА СОЗДАНА
━━━━━━━━━━━━━━━━━
Абонемент и оплату администратор оформит отдельно в карточке ученика.`}

ЛИЧНЫЙ КАБИНЕТ:
${platformUrl}

КОНТАКТЫ:
${supportContact}

Ждём вас на занятиях!`;

    const encodedMessage = encodeURIComponent(whatsappMessage);
    const whatsappPhone = studentPhone.replace(/\D/g, '');
    const whatsappUrl = `https://wa.me/${whatsappPhone}?text=${encodedMessage}`;

    modal.innerHTML = `
        <div style="
            background: var(--admin-card);
            border: 2px solid var(--pink);
            padding: 30px;
            max-width: 600px;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 10px 40px var(--admin-shadow);
        ">
            <div style="text-align: center; margin-bottom: 30px;">
                <div style="color: var(--pink); margin-bottom: 15px;">
                    ${getIcon('success', 48)}
                </div>
                <h2 style="color: var(--admin-text); font-size: 1.5rem; letter-spacing: 0.1em; margin: 0;">
                    УЧЕНИК УСПЕШНО СОЗДАН
                </h2>
            </div>
            
            <div style="background: rgba(235, 77, 119, 0.1); border: 2px solid var(--pink); border-radius: 8px; padding: 20px; margin-bottom: 25px;">
                <div style="margin-bottom: 15px;">
                    <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Ученик:</div>
                    <div style="color: var(--admin-text); font-size: 1.1rem; font-weight: 600;">${studentName}</div>
                </div>
                
                <div style="margin-bottom: 15px;">
                    <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Телефон:</div>
                    <div style="color: var(--admin-text); font-size: 1.1rem; font-weight: 600;">${getWhatsappLink(studentPhone)}</div>
                </div>
                
                ${hasMembership ? `<div style="margin-bottom: 15px;">
                    <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Тариф:</div>
                    <div style="color: var(--admin-text); font-size: 1.1rem; font-weight: 600;">${membershipTypeText} — расчетно ${classesCount} занятий</div>
                </div>` : `
                <div style="margin-bottom: 15px;">
                    <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Следующий шаг:</div>
                    <div style="color: var(--admin-text); font-size: 1rem; font-weight: 600;">Открыть карточку ученика и отдельно оформить абонемент и платёж</div>
                </div>`}
                
                ${groupInfo ? `
                <div style="margin-bottom: 15px;">
                    <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Группа:</div>
                    <div style="color: var(--admin-text); font-size: 1.1rem; font-weight: 600;">${groupInfo.name}</div>
                </div>
                ` : ''}
                
                ${nextClassText ? `
                <div style="background: rgba(16, 185, 129, 0.2); padding: 12px; border-radius: 6px; margin-top: 15px;">
                    <div style="color: #10b981; font-size: 0.95rem; font-weight: 600; white-space: pre-line;">${nextClassText}</div>
                </div>
                ` : ''}
                
                <div style="border-top: 1px solid rgba(235, 77, 119, 0.3); padding-top: 15px; margin-top: 15px;">
                    <div style="color: var(--pink); font-size: 0.85rem; margin-bottom: 8px; letter-spacing: 0.1em;">ДАННЫЕ ДЛЯ ВХОДА В ПЛАТФОРМУ:</div>
                    <div style="
                        background: rgba(0, 0, 0, 0.3);
                        padding: 15px;
                        border-radius: 6px;
                        margin-bottom: 10px;
                    ">
                        <div style="color: var(--admin-text); margin-bottom: 8px;">
                            <span style="opacity: 0.7;">Логин:</span>
                            <code style="color: var(--pink); font-size: 1.1rem; margin-left: 10px; font-family: 'Courier New', monospace;">${platformLogin}</code>
                        </div>
                        <div style="color: var(--admin-text);">
                            <span style="opacity: 0.7;">Пароль:</span>
                            <code style="color: var(--pink); font-size: 1.3rem; font-weight: 700; margin-left: 10px; font-family: 'Courier New', monospace;">${password}</code>
                        </div>
                        ${platformInfo?.login && platformInfo.login !== studentPhone ? `
                        <div style="color: var(--admin-text); margin-top: 10px; font-size: 0.85rem; opacity: 0.75;">
                            Кабинет оплаты: логин — телефон <code style="color: var(--pink);">${studentPhone}</code>
                        </div>
                        ` : ''}
                    </div>
                    ${copySuccess ? `
                        <div style="color: #10b981; font-size: 0.9rem; text-align: center;">
                            ${getIcon('check', 16)} Пароль скопирован в буфер обмена
                        </div>
                    ` : ''}
                </div>
            </div>
            
            <div style="background: rgba(16, 185, 129, 0.1); border-left: 3px solid #10b981; padding: 15px; margin-bottom: 25px; border-radius: 4px;">
                <div style="color: var(--admin-text); font-weight: 600; margin-bottom: 10px;">
                    📱 Готовое сообщение для ученика:
                </div>
                <div id="whatsappMessagePreview" style="
                    color: var(--admin-text);
                    background: rgba(0, 0, 0, 0.2);
                    padding: 15px;
                    border-radius: 6px;
                    font-size: 0.9rem;
                    line-height: 1.6;
                    white-space: pre-line;
                    max-height: 200px;
                    overflow-y: auto;
                ">${whatsappMessage}</div>
            </div>
            
            <div style="display: flex; gap: 15px; justify-content: center; flex-wrap: wrap;">
                ${studentId ? `<button id="openCreatedStudentBtn" class="admin-btn btn-primary">ОТКРЫТЬ КАРТОЧКУ</button>` : ''}
                <button id="sendWhatsAppBtn" style="
                    padding: 12px 30px;
                    background: #25D366;
                    color: #ffffff;
                    border: none;
                    cursor: pointer;
                    letter-spacing: 0.1em;
                    font-size: 0.9rem;
                    transition: all 0.3s ease;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                ">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                    </svg>
                    ОТПРАВИТЬ В WHATSAPP
                </button>
                <button id="copyMessageBtn" style="
                    padding: 12px 30px;
                    background: var(--pink);
                    color: #ffffff;
                    border: none;
                    cursor: pointer;
                    letter-spacing: 0.1em;
                    font-size: 0.9rem;
                    transition: all 0.3s ease;
                ">СКОПИРОВАТЬ СООБЩЕНИЕ</button>
                <button id="closeStudentModal" style="
                    padding: 12px 30px;
                    background: transparent;
                    color: var(--admin-text);
                    border: 2px solid var(--admin-border);
                    cursor: pointer;
                    letter-spacing: 0.1em;
                    font-size: 0.9rem;
                    transition: all 0.3s ease;
                ">ЗАКРЫТЬ</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('openCreatedStudentBtn')?.addEventListener('click', async () => {
        modal.remove();
        if (typeof viewStudent === 'function') await viewStudent(studentId);
    });

    // Кнопка WhatsApp
    document.getElementById('sendWhatsAppBtn').addEventListener('click', () => {
        window.open(whatsappUrl, '_blank');
        toast.success('WhatsApp открыт! Отправьте сообщение ученику.');
    });

    // Кнопка копирования сообщения
    document.getElementById('copyMessageBtn').addEventListener('click', async () => {
        const success = await copyToClipboard(whatsappMessage);
        if (success) {
            toast.success('Сообщение скопировано! Отправьте ученику.');
        } else {
            toast.error('Не удалось скопировать. Скопируйте вручную из окна.');
        }
    });

    // Кнопка закрытия
    document.getElementById('closeStudentModal').addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    // Закрытие по клику на overlay
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

// Утилиты для платежей
function getPaymentTypeText(type) {
    const types = {
        'trial_advance': 'Диагностический урок 2000 ₸',
        'trial_full': 'Диагностический урок',
        'membership_advance': 'Пополнение баланса',
        'membership_balance': 'Пополнение баланса',
        'membership_full': 'Пополнение баланса',
        'single_class': 'Разовое',
        'individual_class': 'Индивидуальное'
    };
    return types[type] || type;
}

function formatAmount(amount) {
    return new Intl.NumberFormat('ru-RU').format(amount) + ' ₸';
}

function getMembershipFormatLabel(membership) {
    if (!membership) return '';
    const individual = Number(membership.individualClassesRemaining || 0);
    const group = Number(membership.groupClassesRemaining || 0);
    if (individual > 0 && group > 0) return 'Гибридный';
    if (individual > 0) return 'Индивидуально';
    if (group > 0) return 'Группа';
    if (membership.lessonFormat === 'mixed') return 'Гибридный';
    if (membership.lessonFormat === 'individual') return 'Индивидуально';
    return 'Группа';
}

function getMembershipAverageCharge(membership) {
    if (!membership) return null;
    const totalPrice = Number(membership.totalPrice || 0);
    const totalClasses = Number(membership.totalClasses || 0);
    if (totalPrice <= 0 || totalClasses <= 0) return null;
    const lessonPrice = totalPrice / totalClasses;
    if (!Number.isFinite(lessonPrice) || lessonPrice <= 0) return null;
    return Math.round(lessonPrice);
}

function estimateLessonsFromBalance(balance, membership) {
    const amount = Number(balance || 0);
    if (!membership) return null;
    const lessonPrice = getMembershipAverageCharge(membership);
    if (!lessonPrice) return null;
    return {
        lessons: Math.floor(amount / lessonPrice),
        lessonPrice
    };
}

function renderMembershipBalanceBadge(student, membership) {
    const balance = Number(student.accountBalance || 0);
    if (!membership) {
        return `
            <span>Нет тарифа</span>
            <small style="display:block;opacity:.75;margin-top:2px;">${formatAmount(balance)} на балансе</small>
        `;
    }
    const estimate = estimateLessonsFromBalance(balance, membership);
    const formatLabel = getMembershipFormatLabel(membership);
    return `
        <span>${formatAmount(balance)} на балансе</span>
        <small style="display:block;opacity:.75;margin-top:2px;">${formatLabel}${estimate ? ` · ${estimate.lessons} ${getDeclension(Math.abs(estimate.lessons), 'урок', 'урока', 'уроков')}` : ''}</small>
    `;
}

function getBalanceBadgeClass(balance, membership) {
    const amount = Number(balance || 0);
    const estimate = estimateLessonsFromBalance(amount, membership);
    if (amount < 0) return 'critical';
    if (!membership) return 'none';
    if (estimate && estimate.lessons <= 0) return 'critical';
    if (estimate && estimate.lessons <= 1) return 'expiring';
    if (amount < 10000) return 'expiring';
    return 'active';
}

function getPaymentStatusText(status) {
    const statuses = {
        'pending': 'Ожидает',
        'completed': 'Оплачено',
        'converted_to_membership': 'В абонемент',
        'refunded': 'Возврат',
        'cancelled': 'Отменено'
    };
    return statuses[status] || status;
}

// Открыть модальное окно добавления платежа
async function openAddPaymentModal() {
    if (!currentViewingStudentId) {
        toast.error('Студент не выбран');
        return;
    }

    try {
        const token = getAuthToken();

        // Получить данные студента и его активный абонемент
        const [studentData, membershipData] = await Promise.all([
            fetch(`${API_URL}/students/${currentViewingStudentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json()),
            fetch(`${API_URL}/memberships/student/${currentViewingStudentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json())
        ]);

        const student = studentData.student;
        const activeMembership = membershipData.memberships?.find(m => m.status === 'active');

        // Заполнить информацию о студенте
        document.getElementById('paymentStudentInfo').innerHTML = `
            <strong>${renderStudentFioWithAge(student)}</strong><br>
            <small>${student.phone}</small>
            <br><small style="opacity:0.8;">Денежный баланс: <strong>${formatAmount(student.accountBalance || 0)}</strong></small>
            ${activeMembership ? `
                <br><small style="opacity: 0.7;">
                    Активный тариф: ${activeMembership.type === 'trial'
                    ? 'Пробный'
                    : activeMembership.type === 'monthly'
                        ? 'Месячный'
                        : activeMembership.type === 'monthly_12'
                            ? 'Месячный (12 занятий)'
                        : 'Квартальный'
                }
                    ${getMembershipAverageCharge(activeMembership) ? `· среднее списание ${formatAmount(getMembershipAverageCharge(activeMembership))}` : ''}
                </small>
            ` : ''}
        `;

        // Установить скрытые поля
        document.getElementById('paymentStudentId').value = currentViewingStudentId;
        document.getElementById('paymentMembershipId').value = '';

        // Установить текущую дату
        document.getElementById('paymentDate').value = new Date().toISOString().split('T')[0];

        // Открыть модалку
        document.getElementById('addPaymentModal').classList.add('show');

        const paymentInfo = document.getElementById('paymentInfo');
        paymentInfo.style.display = 'none';
        paymentInfo.innerHTML = '';

    } catch (error) {
        console.error('Error opening payment modal:', error);
        toast.error('Не удалось открыть форму платежа');
    }
}

// Закрыть модальное окно добавления платежа
function closeAddPaymentModal() {
    document.getElementById('addPaymentModal').classList.remove('show');
    document.getElementById('addPaymentForm').reset();
}

function createMoneyOperationModal(title, body, onSubmit) {
    document.getElementById('studentMoneyOperationModal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'studentMoneyOperationModal';
    modal.className = 'modal show';
    modal.innerHTML = `
        <div class="modal-overlay"></div>
        <div class="modal-content" style="max-width:500px;">
            <button type="button" class="modal-close">×</button>
            <h2 class="modal-title">${title}</h2>
            <form class="admin-form">${body}</form>
        </div>
    `;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('.modal-close').addEventListener('click', close);
    modal.querySelector('.modal-overlay').addEventListener('click', close);
    let submitting = false;
    modal.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault();
        if (submitting) return;
        submitting = true;
        const button = event.currentTarget.querySelector('button[type="submit"]');
        button.disabled = true;
        const originalText = button.textContent;
        button.textContent = 'Сохранение...';
        try {
            await onSubmit(new FormData(event.currentTarget));
            close();
        } catch (error) {
            toast.error(error.message);
            submitting = false;
            button.disabled = false;
            button.textContent = originalText;
        }
    });
}

window.openEditPaymentModal = async function(paymentId) {
    try {
        const response = await fetch(`${API_URL}/payments/${paymentId}`, {
            headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Не удалось загрузить платёж');
        const payment = result.payment;
        const date = new Date(payment.paymentDate).toISOString().slice(0, 10);
        createMoneyOperationModal('ИЗМЕНИТЬ ПЛАТЁЖ', `
            <div class="form-group"><label>СУММА (₸)</label><input class="admin-input" name="amount" type="number" min="1" step="1" value="${Number(payment.amount) || 0}" required></div>
            <div class="form-group"><label>СПОСОБ ОПЛАТЫ</label>
                <select class="admin-input" name="paymentMethod" required>
                    ${typeof renderPaymentMethodOptions === 'function' ? renderPaymentMethodOptions(payment.paymentMethod || '') : ''}
                </select>
            </div>
            <div class="form-group"><label>ДАТА</label><input class="admin-input" name="paymentDate" type="date" value="${date}" required></div>
            <div class="form-group"><label>ЗАМЕТКА</label><textarea class="admin-input" name="notes" rows="3">${escapeHtml(payment.notes || '')}</textarea></div>
            <div class="info-notice">Если изменить сумму, денежный баланс ученика автоматически пересчитается на разницу.</div>
            <button type="submit" class="modal-submit">СОХРАНИТЬ И ПЕРЕСЧИТАТЬ</button>
        `, async formData => {
            const updateResponse = await fetch(`${API_URL}/payments/${paymentId}`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${getAuthToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(Object.fromEntries(formData.entries())),
            });
            const updateResult = await updateResponse.json();
            if (!updateResponse.ok || !updateResult.success) throw new Error(updateResult.error || 'Ошибка изменения');
            toast.success(updateResult.message);
            if (currentViewingStudentId) await viewStudent(currentViewingStudentId);
        });
    } catch (error) {
        toast.error(error.message);
    }
};

window.openRefundModal = async function(originalPaymentId = '') {
    if (!currentViewingStudentId) return;
    try {
        const [studentResponse, paymentResponse] = await Promise.all([
            fetch(`${API_URL}/students/${currentViewingStudentId}`, {
                headers: { Authorization: `Bearer ${getAuthToken()}` },
            }),
            originalPaymentId
                ? fetch(`${API_URL}/payments/${originalPaymentId}`, {
                    headers: { Authorization: `Bearer ${getAuthToken()}` },
                })
                : Promise.resolve(null),
        ]);
        const studentResult = await studentResponse.json();
        const paymentResult = paymentResponse ? await paymentResponse.json() : null;
        if (!studentResponse.ok || !studentResult.success) throw new Error(studentResult.error || 'Ученик не найден');
        if (paymentResponse && (!paymentResponse.ok || !paymentResult.success)) throw new Error(paymentResult.error || 'Платёж не найден');
        const student = studentResult.student;
        const payment = paymentResult?.payment;
        const available = Math.max(0, Number(student.accountBalance) || 0);
        if (available <= 0) {
            throw new Error('На балансе ученика нет средств, доступных для возврата');
        }
        const paymentAvailable = payment
            ? Math.max(0, Number(payment.refundableAmount ?? payment.amount) || 0)
            : available;
        if (payment && paymentAvailable <= 0) {
            throw new Error('Этот платёж уже полностью возвращён');
        }
        const suggested = Math.min(available, paymentAvailable);
        createMoneyOperationModal('ВОЗВРАТ СРЕДСТВ', `
            <div class="info-box"><strong>${renderStudentFioWithAge(student)}</strong><br><small>Доступно на балансе: ${formatAmount(available)}</small></div>
            <div class="form-group"><label>СУММА ВОЗВРАТА (₸)</label><input class="admin-input" name="amount" type="number" min="1" max="${available}" step="1" value="${suggested || 0}" required></div>
            <div class="form-group"><label>СПОСОБ ВОЗВРАТА</label>
                <select class="admin-input" name="paymentMethod" required>
                    ${typeof renderPaymentMethodOptions === 'function' ? renderPaymentMethodOptions(payment?.paymentMethod || '') : ''}
                </select>
            </div>
            <div class="form-group"><label>ПРИЧИНА ВОЗВРАТА</label><textarea class="admin-input" name="reason" rows="3" required placeholder="Например: отказ от обучения, ошибочная оплата"></textarea></div>
            <div class="info-notice">Возврат уменьшит баланс ученика и будет записан расходом в кассе. Исходный платёж останется в истории.</div>
            <button type="submit" class="modal-submit student-refund-submit">ОФОРМИТЬ ВОЗВРАТ</button>
        `, async formData => {
            const payload = Object.fromEntries(formData.entries());
            payload.studentId = currentViewingStudentId;
            if (originalPaymentId) payload.originalPaymentId = originalPaymentId;
            const refundResponse = await fetch(`${API_URL}/payments/refund`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${getAuthToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });
            const refundResult = await refundResponse.json();
            if (!refundResponse.ok || !refundResult.success) throw new Error(refundResult.error || 'Ошибка возврата');
            toast.success(refundResult.message);
            invalidateCache('dashboard', 'membership-actions', 'students');
            await viewStudent(currentViewingStudentId);
        });
    } catch (error) {
        toast.error(error.message);
    }
};

window.openBalanceAdjustmentModal = async function() {
    if (!currentViewingStudentId) {
        toast.error('Ученик не выбран');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/students/${currentViewingStudentId}`, {
            headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Ученик не найден');

        const student = result.student;
        createMoneyOperationModal('НАСТРОИТЬ БАЛАНС', `
            <div class="info-box">
                <strong>${renderStudentFioWithAge(student)}</strong><br>
                <small>Текущий баланс: <strong>${formatAmount(student.accountBalance || 0)}</strong></small>
            </div>
            <div class="form-group">
                <label>ДЕЙСТВИЕ</label>
                <select class="admin-input" name="direction" required>
                    <option value="increase">Увеличить баланс</option>
                    <option value="decrease">Уменьшить баланс</option>
                </select>
            </div>
            <div class="form-group">
                <label>СУММА (₸)</label>
                <input class="admin-input" name="amount" type="number" min="1" step="1" required>
            </div>
            <div class="form-group">
                <label>ПРИЧИНА</label>
                <textarea class="admin-input" name="reason" rows="3" required placeholder="Например: перенос остатка, исправление долга, ошибка ввода"></textarea>
            </div>
            <div class="info-notice">Коррекция меняет только баланс ученика. Она не создаёт доход или расход в кассе и не влияет на аналитику выручки.</div>
            <button type="submit" class="modal-submit">СОХРАНИТЬ КОРРЕКТИРОВКУ</button>
        `, async formData => {
            const payload = Object.fromEntries(formData.entries());
            const rawAmount = Number(payload.amount);
            if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
                throw new Error('Укажите сумму больше 0');
            }
            const signedAmount = payload.direction === 'decrease'
                ? -Math.trunc(rawAmount)
                : Math.trunc(rawAmount);

            const adjustResponse = await fetch(`${API_URL}/students/${currentViewingStudentId}/balance-adjustment`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${getAuthToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    amount: signedAmount,
                    reason: payload.reason,
                }),
            });
            const adjustResult = await adjustResponse.json();
            if (!adjustResponse.ok || !adjustResult.success) {
                throw new Error(adjustResult.error || 'Не удалось скорректировать баланс');
            }
            toast.success(adjustResult.message || 'Баланс скорректирован');
            invalidateCache('dashboard', 'students');
            await viewStudent(currentViewingStudentId);
        });
    } catch (error) {
        toast.error(error.message);
    }
};

// Инициализация обработчика формы добавления платежа
function initAddPaymentHandler() {
    const form = document.getElementById('addPaymentForm');
    if (form) {
        let isSubmitting = false; // 🛡️ Защита от двойного клика

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            // 🛡️ Защита от двойного клика
            if (isSubmitting) {
                console.warn('⚠️ Попытка повторной отправки формы платежа заблокирована');
                return;
            }

            const studentId = document.getElementById('paymentStudentId').value;
            const type = 'membership_full';
            const amount = parseInt(document.getElementById('paymentAmount').value);
            const paymentDate = document.getElementById('paymentDate').value;
            const notes = document.getElementById('paymentNotes').value;
            const paymentMethod = document.getElementById('paymentMethod')?.value || '';

            if (!amount || amount <= 0) {
                toast.warning('Укажите сумму платежа');
                return;
            }
            if (!paymentMethod) {
                toast.warning('Выберите счет оплаты');
                return;
            }

            // Блокируем форму и кнопку отправки
            isSubmitting = true;
            const submitButton = form.querySelector('button[type="submit"]');
            const originalButtonText = submitButton ? submitButton.textContent : '';
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = 'Сохранение...';
            }

            try {
                const token = getAuthToken();
                console.log(`💰 Добавление платежа в общий баланс:`, { studentId, type, amount, notes });
                const response = await fetch(`${API_URL}/payments`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        studentId,
                        amount,
                        type,
                        paymentDate: paymentDate || new Date().toISOString(),
                        notes,
                        paymentMethod: paymentMethod || undefined
                    })
                });

                const data = await response.json();

                if (data.success) {
                    toast.success(`Платеж ${formatAmount(amount)} успешно добавлен!`);
                    closeAddPaymentModal();
                    invalidateCache('dashboard', 'membership-actions', 'students');
                    if (typeof updateOperationalIndicators === 'function') {
                        updateOperationalIndicators({ force: true });
                    }
                    if (
                        typeof renderMembershipActions === 'function'
                        && !document.getElementById('section-membership-actions')?.classList.contains('hidden')
                    ) {
                        renderMembershipActions();
                    }

                    // Обновить профиль студента
                    if (currentViewingStudentId) {
                        await viewStudent(currentViewingStudentId);
                    }
                } else {
                    // Проверка на дубликат
                    if (response.status === 409 && data.duplicatePayment) {
                        toast.warning(`Похожий платеж уже был создан недавно. Дубликат предотвращен.`);
                        console.warn('Дубликат платежа:', data.duplicatePayment);
                    } else {
                        toast.error(data.error || 'Не удалось добавить платеж');
                    }
                }
            } catch (error) {
                console.error('Error adding payment:', error);
                toast.error('Не удалось добавить платеж');
            } finally {
                // Разблокируем форму
                isSubmitting = false;
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.textContent = originalButtonText;
                }
            }
        });
    }
}

// Обновить только одну строку студента в списке
function updateStudentRow(studentId, newClassesRemaining) {
    const row = document.querySelector(`tr[data-student-id="${studentId}"]`);
    if (!row) return;

    // Обновляем количество занятий в badge
    const membershipBadge = row.querySelector('.membership-badge');
    if (membershipBadge) {
        const membershipText = `${newClassesRemaining} ${getDeclension(newClassesRemaining, 'занятие', 'занятия', 'занятий')}`;
        membershipBadge.textContent = membershipText;

        // Обновляем класс для цвета
        const membershipClass = getMembershipClass({ classesRemaining: newClassesRemaining });
        membershipBadge.className = `membership-badge ${membershipClass}`;
    }
}

// Обновить только информацию об абонементе в профиле (без полной перезагрузки)
async function updateStudentMembershipInProfile(studentId) {
    if (currentViewingStudentId === studentId) {
        await viewStudent(studentId);
    }
}

// Инициализация поиска учеников
function initStudentSearch() {
    const studentSearch = document.getElementById('studentSearch');
    if (studentSearch) {
        let searchTimeout;
        studentSearch.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                // Показать прогресс-бар при поиске
                if (window.showLoading) {
                    window.showLoading();
                }
                // Сбрасываем на первую страницу при поиске
                renderStudents(e.target.value, 1);
            }, 300);  // Debounce 300мс
        });
    }
}

// Установка обработчиков для редактирования ученика (вызывается при открытии модального окна)
function setupStudentEditHandlers() {
    // Форматирование телефона при редактировании
    const editPhoneInput = document.getElementById('editStudentPhone');
    if (editPhoneInput) {
        editPhoneInput.addEventListener('input', function (e) {
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

    // Обработчик для кнопки редактирования
    const editBtn = document.getElementById('editStudentBtn');
    if (editBtn) {
        // Используем onclick свойство, чтобы не дублировать слушатели
        editBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('Edit button clicked');
            toggleStudentEditMode();
        };
    } else {
        console.warn('Edit button not found');
    }
    const finishBtn = document.getElementById('finishStudentEducationBtn');
    if (finishBtn) finishBtn.onclick = openFinishStudentEducationModal;

    // Обработчик для кнопки отмены
    const cancelBtn = document.getElementById('cancelEditStudentBtn');
    if (cancelBtn) {
        cancelBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('Cancel button clicked');
            toggleStudentEditMode();
        };
    }

    // Обработчик формы
    const form = document.getElementById('editStudentForm');
    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            await saveStudentChanges();
        };
    }
}

// Инициализация обработчика формы редактирования (при загрузке страницы)
function initStudentEditForm() {
    // Обработчики будут установлены при открытии модального окна
    // Эта функция оставлена для совместимости
}

// Экспорт для admin.js
window.initStudentSearch = initStudentSearch;

let studentScheduleItems = { group: [], individual: [] };
let studentScheduleMeta = {
    studentId: null,
    groupId: null,
    groupName: null,
    hasIndividualMembership: false,
    defaultTeacherId: null,
    defaultTeacherName: '',
};
let studentScheduleRooms = [];
let studentScheduleTeachers = [];
const DEFAULT_STUDENT_LESSON_DURATION = 60;

async function loadStudentScheduleRooms() {
    try {
        const response = await fetch(`${API_URL}/rooms`, {
            headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        if (!response.ok) throw new Error('rooms fetch failed');
        const data = await response.json();
        studentScheduleRooms = data.rooms || [];
    } catch (error) {
        console.error('Failed to load rooms for student schedule:', error);
        studentScheduleRooms = [];
    }
}

async function loadStudentScheduleTeachers() {
    try {
        const response = await fetch(`${API_URL}/users?role=teacher&limit=200`, {
            headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        if (!response.ok) throw new Error('teachers fetch failed');
        const data = await response.json();
        studentScheduleTeachers = (data.users || []).filter(teacher => teacher.status !== 'inactive');
    } catch (error) {
        console.error('Failed to load teachers for student schedule:', error);
        studentScheduleTeachers = [];
    }
}

function renderStudentScheduleList(scope) {
    const isGroup = scope === 'group';
    const container = document.getElementById(isGroup ? 'studentGroupScheduleList' : 'studentIndividualScheduleList');
    if (!container) return;

    const actionsEl = document.getElementById(isGroup ? 'studentGroupScheduleActions' : 'studentIndividualScheduleActions');
    const items = studentScheduleItems[scope] || [];

    if (actionsEl) {
        actionsEl.style.display = isGroup ? 'none' : 'flex';
    }

    if (!items.length) {
        const message = isGroup && !studentScheduleMeta.groupId
            ? 'Ученик не состоит в активной группе.'
            : 'Расписание не задано — добавьте занятия.';
        container.innerHTML = `
            <div class="student-schedule-empty">
                <span class="student-schedule-empty__mark" aria-hidden="true">+</span>
                <span>${message}</span>
            </div>
        `;
        return;
    }

    const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

    container.innerHTML = items.map((item, index) => {
        const selectedRoomId = item.roomId || null;
        const selectedTeacherId = item.teacherId || '';
        const disabledAttr = isGroup ? 'disabled' : '';
        const teacherFallbackLabel = studentScheduleMeta.defaultTeacherName
            ? `По карточке: ${studentScheduleMeta.defaultTeacherName}`
            : 'По карточке ученика';
        const teacherOptions = !isGroup ? [
            `<option value="" ${!selectedTeacherId ? 'selected' : ''}>${escapeHtml(teacherFallbackLabel)}</option>`,
            ...studentScheduleTeachers.map((teacher) => {
                const teacherId = teacher._id || teacher.id;
                return `<option value="${teacherId}" ${selectedTeacherId === teacherId ? 'selected' : ''}>${escapeHtml(formatStudentFio(teacher) || 'Преподаватель')}</option>`;
            }),
        ] : [];
        if (!isGroup && selectedTeacherId && !studentScheduleTeachers.some(teacher => (teacher._id || teacher.id) === selectedTeacherId)) {
            teacherOptions.push(`<option value="${selectedTeacherId}" selected>${escapeHtml(item.teacher?.name || 'Выбранный преподаватель')}</option>`);
        }
        const deleteButton = isGroup
            ? '<span class="student-schedule-row-source">Только просмотр</span>'
            : `<button type="button" class="student-schedule-delete" onclick="removeStudentScheduleItem('${scope}', ${item.id})"
                    aria-label="Удалить занятие ${index + 1}" title="Удалить занятие">
                    <span aria-hidden="true">×</span>
                    Удалить
                </button>`;
        const teacherField = !isGroup
            ? `<label class="student-schedule-field is-teacher">
                    <span class="student-schedule-field__label">Преподаватель</span>
                    <select class="admin-input" ${disabledAttr} onchange="updateStudentScheduleItem('${scope}', ${item.id}, 'teacherId', this.value)">
                        ${teacherOptions.join('')}
                    </select>
                    <small class="student-schedule-edit-note">${selectedTeacherId
                        ? 'Назначен только этому занятию'
                        : 'Основной преподаватель ученика'
                    }</small>
                </label>`
            : '';

        return `
            <div class="student-schedule-edit-card ${item.isPractice ? 'is-practice' : ''}">
                <div class="student-schedule-row-head">
                    <span>Занятие ${index + 1}</span>
                    ${deleteButton}
                </div>
                <div class="student-schedule-edit-grid ${isGroup ? 'is-group' : ''}">
                    ${teacherField}
                    <label class="student-schedule-field">
                        <span class="student-schedule-field__label">День недели</span>
                        <select class="admin-input" ${disabledAttr} onchange="updateStudentScheduleItem('${scope}', ${item.id}, 'dayOfWeek', this.value)">
                            ${days.map((day, dayIndex) => `
                                <option value="${dayIndex + 1}" ${Number(item.dayOfWeek) === dayIndex + 1 ? 'selected' : ''}>${day}</option>
                            `).join('')}
                        </select>
                    </label>
                    <label class="student-schedule-field">
                        <span class="student-schedule-field__label">Начало</span>
                        <input type="time" class="admin-input" ${disabledAttr} value="${item.time || '18:00'}"
                               onchange="updateStudentScheduleItem('${scope}', ${item.id}, 'time', this.value)">
                    </label>
                    <label class="student-schedule-field">
                        <span class="student-schedule-field__label">Длительность</span>
                        <span class="student-schedule-duration">
                            <input type="number" class="admin-input" ${disabledAttr} aria-label="Длительность занятия в минутах"
                                   value="${item.duration || DEFAULT_STUDENT_LESSON_DURATION}" min="1"
                                   onchange="updateStudentScheduleItem('${scope}', ${item.id}, 'duration', this.value)">
                            <span>мин</span>
                        </span>
                    </label>
                    <label class="student-schedule-field">
                        <span class="student-schedule-field__label">Кабинет</span>
                        <select class="admin-input" ${disabledAttr} onchange="updateStudentScheduleItem('${scope}', ${item.id}, 'roomId', this.value)">
                            <option value="">Не выбран</option>
                            ${studentScheduleRooms.map((room) => {
                                const roomId = room.id || room._id;
                                return `<option value="${roomId}" ${selectedRoomId === roomId ? 'selected' : ''}>${escapeHtml(room.name)}</option>`;
                            }).join('')}
                        </select>
                    </label>
                </div>
            </div>
        `;
    }).join('');
}

async function initStudentRegularScheduleEditor(studentId) {
    studentScheduleMeta.studentId = studentId;
    const groupHintEl = document.getElementById('studentGroupScheduleHint');
    const individualHintEl = document.getElementById('studentIndividualScheduleHint');
    const groupStatusEl = document.getElementById('studentGroupScheduleStatus');
    const individualStatusEl = document.getElementById('studentIndividualScheduleStatus');
    if (groupHintEl) groupHintEl.textContent = 'Загрузка расписания...';
    if (individualHintEl) individualHintEl.textContent = 'Загрузка расписания...';
    if (groupStatusEl) groupStatusEl.textContent = '';
    if (individualStatusEl) individualStatusEl.textContent = '';

    await Promise.all([
        loadStudentScheduleRooms(),
        loadStudentScheduleTeachers(),
    ]);

    try {
        const response = await fetch(`${API_URL}/students/${studentId}/schedule`, {
            headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            const errorText = data.error || 'Не удалось загрузить расписание';
            if (groupHintEl) groupHintEl.textContent = errorText;
            if (individualHintEl) individualHintEl.textContent = errorText;
            studentScheduleItems = { group: [], individual: [] };
            renderStudentScheduleList('group');
            renderStudentScheduleList('individual');
            return;
        }

        const payload = data.data || {};
        const groupSchedule = payload.groupSchedule || null;
        const individualSchedule = payload.individualSchedule || { schedules: [] };
        studentScheduleMeta.groupId = groupSchedule?.groupId || null;
        studentScheduleMeta.groupName = groupSchedule?.groupName || null;
        studentScheduleMeta.hasIndividualMembership = Boolean(payload.hasIndividualMembership);
        studentScheduleMeta.defaultTeacherId = individualSchedule.defaultTeacherId || individualSchedule.teacherId || null;
        studentScheduleMeta.defaultTeacherName = individualSchedule.defaultTeacher?.name || '';

        const mapItems = (items) => (items || []).map((item) => ({
            id: Date.now() + Math.random(),
            dayOfWeek: item.dayOfWeek,
            time: item.time,
            duration: item.duration || DEFAULT_STUDENT_LESSON_DURATION,
            roomId: item.roomId?.id || item.roomId?._id || item.roomId || item.room?.id || item.room?._id || null,
            teacherId: item.teacherId?.id || item.teacherId?._id || item.teacherId || item.teacher?.id || item.teacher?._id || null,
            teacher: item.teacher || null,
            effectiveTeacherId: item.effectiveTeacherId || null,
            effectiveTeacher: item.effectiveTeacher || null,
            isPractice: Boolean(item.isPractice),
        }));
        studentScheduleItems.group = mapItems(groupSchedule?.schedules);
        studentScheduleItems.individual = mapItems(individualSchedule.schedules);

        if (groupHintEl) {
            groupHintEl.textContent = groupSchedule
                ? `Группа «${groupSchedule.groupName}» (редактируется в разделе «Группы»).`
                : 'Активная группа не назначена.';
        }
        if (individualHintEl) {
            individualHintEl.textContent = payload.hasIndividualMembership
                ? 'Личное расписание индивидуальных занятий этого ученика.'
                : 'Индивидуальный абонемент не найден. Расписание можно подготовить заранее.';
        }

        renderStudentScheduleList('group');
        renderStudentScheduleList('individual');
    } catch (error) {
        if (groupHintEl) groupHintEl.textContent = 'Не удалось загрузить расписание';
        if (individualHintEl) individualHintEl.textContent = 'Не удалось загрузить расписание';
        console.error(error);
    }
}

function addStudentScheduleItem(scope) {
    if (!studentScheduleItems[scope]) return;
    studentScheduleItems[scope].push({
        id: Date.now() + Math.random(),
        dayOfWeek: 1,
        time: '18:00',
        duration: DEFAULT_STUDENT_LESSON_DURATION,
        roomId: null,
        teacherId: null,
        teacher: null,
        effectiveTeacherId: studentScheduleMeta.defaultTeacherId || null,
        effectiveTeacher: studentScheduleMeta.defaultTeacherName ? { name: studentScheduleMeta.defaultTeacherName } : null,
        isPractice: false,
    });
    renderStudentScheduleList(scope);
}

function removeStudentScheduleItem(scope, itemId) {
    if (!studentScheduleItems[scope]) return;
    studentScheduleItems[scope] = studentScheduleItems[scope].filter((item) => item.id !== itemId);
    renderStudentScheduleList(scope);
}

function updateStudentScheduleItem(scope, itemId, field, value) {
    const item = studentScheduleItems[scope]?.find((entry) => entry.id === itemId);
    if (!item) return;
    if (field === 'dayOfWeek' || field === 'duration') {
        item[field] = parseInt(value, 10);
    } else if (field === 'isPractice') {
        item[field] = value === true || value === 'true';
    } else if (field === 'teacherId') {
        item.teacherId = value || null;
        const teacher = studentScheduleTeachers.find(entry => (entry._id || entry.id) === item.teacherId);
        item.teacher = teacher ? { id: teacher._id || teacher.id, name: formatStudentFio(teacher) || 'Преподаватель' } : null;
        item.effectiveTeacherId = item.teacherId || studentScheduleMeta.defaultTeacherId || null;
        item.effectiveTeacher = item.teacher || (studentScheduleMeta.defaultTeacherName ? { name: studentScheduleMeta.defaultTeacherName } : null);
        renderStudentScheduleList(scope);
    } else if (field === 'roomId') {
        item[field] = value || null;
    } else {
        item[field] = value;
    }
}

async function saveStudentRegularSchedule(scope) {
    const studentId = studentScheduleMeta.studentId;
    const statusEl = document.getElementById(scope === 'group' ? 'studentGroupScheduleStatus' : 'studentIndividualScheduleStatus');
    if (!studentId || !studentScheduleItems[scope]) return;

    if (statusEl) statusEl.textContent = 'Сохранение...';

    try {
        const payload = {
            scope,
            schedules: studentScheduleItems[scope].map((item) => ({
                dayOfWeek: item.dayOfWeek,
                time: item.time,
                duration: item.duration,
                roomId: item.roomId,
                teacherId: scope === 'individual' ? item.teacherId : null,
                isPractice: item.isPractice,
            })),
        };

        let response = await fetch(`${API_URL}/students/${studentId}/schedule`, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        let data = await response.json();

        if (!data.success && response.status === 409) {
            const conflictText = data.conflicts?.map((item) => item.message).join('\n') || '';
            const confirmed = await customConfirm(
                `${data.error}\n\n${conflictText}\n\nИгнорировать конфликты и сохранить расписание?`,
                { icon: 'warning', yesText: 'Игнорировать', noText: 'Отмена' }
            );
            if (confirmed) {
                if (statusEl) statusEl.textContent = 'Сохранение...';
                payload.ignoreConflicts = true;
                response = await fetch(`${API_URL}/students/${studentId}/schedule`, {
                    method: 'PUT',
                    headers: {
                        Authorization: `Bearer ${getAuthToken()}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                });
                data = await response.json();
            }
        }

        if (!response.ok || !data.success) {
            const conflictText = data.conflicts?.map((item) => item.message).join('\n');
            showToast(conflictText ? `${data.error}:\n${conflictText}` : (data.error || 'Не удалось сохранить расписание'), 'error');
            if (statusEl) statusEl.textContent = data.conflicts?.[0]?.message || '';
            return;
        }

        const created = data.generation?.created || 0;
        const label = scope === 'group' ? 'Групповое расписание' : 'Индивидуальное расписание';
        showToast(`${label} сохранено. В календарь добавлено занятий: ${created}`, 'success');
        if (statusEl) {
            statusEl.textContent = 'Сохранено';
            setTimeout(() => { statusEl.textContent = ''; }, 2000);
        }
        await initStudentRegularScheduleEditor(studentId);
    } catch (error) {
        showToast(error.message, 'error');
        if (statusEl) statusEl.textContent = '';
    }
}

window.updateStudentRow = updateStudentRow;
window.updateStudentMembershipInProfile = updateStudentMembershipInProfile;
window.renderStudents = renderStudents;
window.viewStudent = viewStudent;
window.openStudentProfileSafe = openStudentProfileSafe;
window.closeStudentDetailModal = closeStudentDetailModal;
window.sortStudentsBy = sortStudentsBy;
window.toggleStudentEditMode = toggleStudentEditMode;
window.saveStudentChanges = saveStudentChanges;
window.addStudentPhoneField = addStudentPhoneField;
window.initStudentEditForm = initStudentEditForm;
window.setupStudentEditHandlers = setupStudentEditHandlers;
window.checkStudentPlatformLink = checkStudentPlatformLink;
window.linkStudentToPlatform = linkStudentToPlatform;
window.rebindStudentToPlatform = rebindStudentToPlatform;
window.provisionStudentPlatform = provisionStudentPlatform;
window.openStudentPlatformAccessDialog = openStudentPlatformAccessDialog;
window.openStudentInPlatform = openStudentInPlatform;
window.addStudentScheduleItem = addStudentScheduleItem;
window.removeStudentScheduleItem = removeStudentScheduleItem;
window.updateStudentScheduleItem = updateStudentScheduleItem;
window.saveStudentRegularSchedule = saveStudentRegularSchedule;
window.openFinishStudentEducationModal = openFinishStudentEducationModal;
bindStudentProfileButtons();

// Потерянный/возврат — полностью автоматический процесс:
//   потерянный = нет платежей ≥ 3 мес.
//   возврат    = новый платёж (автору платежа идёт зачёт в аналитику)
// Ручных кнопок/API для этого больше нет.

// Экспорт переменных состояния для доступа из других модулей
Object.defineProperty(window, 'currentStudentSearch', {
    get: () => currentStudentSearch,
    set: (val) => { currentStudentSearch = val; }
});
Object.defineProperty(window, 'currentStudentPage', {
    get: () => currentStudentPage,
    set: (val) => { currentStudentPage = val; }
});
Object.defineProperty(window, 'currentStudentFilter', {
    get: () => currentStudentFilter,
    set: (val) => { currentStudentFilter = val; }
});
