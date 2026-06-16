// =====================================================
// STUDENTS MODULE - Управление учениками
// =====================================================

// Переменная для хранения всех учеников и их статистики
let allStudentsData = [];
let currentStudentFilter = 'all';
let currentViewingStudentId = null;
let selectedStudentMembershipId = null;
let currentStudentPage = 1;
let currentStudentSearch = '';

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

// Отобразить учеников
async function renderStudents(searchQuery = '', page = 1, filter = '') {
    const table = document.getElementById('studentsTable');

    // Если таблица не существует (вкладка не активна), просто обновляем состояние
    if (!table) {
        currentStudentSearch = searchQuery;
        currentStudentPage = page;
        currentStudentFilter = filter;
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
    const apiFilter = filter === 'with-debt' ? 'with_debt' : filter;
    let url = `${API_URL}/students?role=student&search=${searchQuery}&page=${page}&limit=20`;
    if (apiFilter && (apiFilter === 'with_debt' || apiFilter === 'overdue' || apiFilter === 'lost')) {
        url += `&filter=${apiFilter}`;
    }
    currentStudentFilter = filter || currentStudentFilter;

    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${getAuthToken()}` }
    });

    const data = await response.json();
    const students = data.students || [];

    if (students.length === 0) {
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
        const studentIds = students.map(s => s._id);
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
            renderStudents(currentStudentSearch, page);
        });
    });
}

function getStudentLinkBadge(student) {
    const status = student.externalLinkStatus || (student.appUserId ? 'linked' : null);
    if (!status && !student.appUserId) return '';
    const labels = {
        linked: { text: 'Платформа', cls: 'student-link-badge--linked' },
        pending: { text: 'Ожидает', cls: 'student-link-badge--pending' },
        conflict: { text: 'Конфликт', cls: 'student-link-badge--conflict' },
        manual_review: { text: 'Проверка', cls: 'student-link-badge--review' },
        unlinked: { text: 'Не связан', cls: 'student-link-badge--unlinked' },
    };
    const key = status || 'unlinked';
    const meta = labels[key] || labels.unlinked;
    return `<span class="student-link-badge ${meta.cls}" title="Связь с обучающей платформой: ${meta.text}">${meta.text}</span>`;
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
    const appUserId = student.appUserId || '—';
    const canManage = ['super_admin', 'admin', 'sales'].includes(getUserRole());
    const isLinked = status === 'linked' && student.appUserId;

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
                <span class="student-info-label">ID в платформе</span>
                <span class="student-info-value student-integration-id">${escapeHtml(appUserId)}</span>
            </div>
            <div class="student-info-item">
                <span class="student-info-label">Связан с</span>
                <span class="student-info-value">${linkedAt}</span>
            </div>
            <div class="student-info-item">
                <span class="student-info-label">CRM ID</span>
                <span class="student-info-value student-integration-id">${escapeHtml(student._id || student.id || '—')}</span>
            </div>
        </div>
        <div id="studentIntegrationCheckResult" class="student-integration-check" style="display:none;"></div>
        <div class="student-integration-actions">
            <button type="button" class="admin-btn btn-secondary" onclick="checkStudentPlatformLink('${student._id}')">Проверить связь</button>
            ${canManage && !isLinked ? `<button type="button" class="admin-btn btn-primary" onclick="provisionStudentPlatform('${student._id}')">Создать в LP</button>` : ''}
            ${canManage && !isLinked ? `<button type="button" class="admin-btn btn-secondary" onclick="linkStudentToPlatform('${student._id}')">Связать по телефону</button>` : ''}
            ${isLinked ? `<button type="button" class="admin-btn btn-primary" onclick="openStudentInPlatform('${student._id}')">Открыть в платформе</button>` : ''}
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
                <div style="color:${meta.color};font-weight:600;margin-bottom:4px;">Сводный статус: ${meta.text}</div>
                <div style="opacity:0.85;">Платформа: ${appLine}</div>
            </div>
        `;
    } catch (error) {
        resultEl.innerHTML = `<span style="color:#ef4444;">${escapeHtml(error.message)}</span>`;
    }
}

async function provisionStudentPlatform(studentId) {
    try {
        const response = await fetch(`${API_URL}/students/${studentId}/provision-platform`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            showToast(data.error || 'Не удалось создать аккаунт в платформе', 'error');
            return;
        }
        const login = data.data?.login;
        const tempPassword = data.data?.temporaryPassword;
        let message = data.data?.alreadyLinked
            ? 'Аккаунт уже был связан с платформой'
            : (data.data?.created ? 'Аккаунт ученика создан в Learning Platform' : 'Ученик привязан к платформе');
        if (login) message += ` (логин: ${login})`;
        if (tempPassword) message += `. Временный пароль: ${tempPassword}`;
        showToast(message, 'success', 12000);
        await viewStudent(studentId);
        renderStudents(currentStudentSearch, currentStudentPage, currentStudentFilter);
    } catch (error) {
        showToast(error.message, 'error');
    }
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
        showToast(error.message, 'error');
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
            showToast(data.error || 'SSO недоступен', 'error');
            return;
        }
        const token = data.data?.token;
        const loginBase = (data.data?.redirectUrl || 'https://maestro-school.duckdns.org/login').split('?')[0];
        const next = data.data?.next || '/school-lessons';
        if (!token) {
            showToast('SSO-токен не получен', 'error');
            return;
        }
        const url = `${loginBase}?ssoToken=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`;
        window.open(url, '_blank', 'noopener');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Вспомогательная функция для отрисовки таблицы учеников
function renderStudentsTable(students, statsMap) {
    const table = document.getElementById('studentsTable');

    // Присоединить статистику к ученикам
    const studentsWithStats = students.map(student => ({
        ...student,
        stats: statsMap[student._id] || {
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
        const groupNames = student.groups
            .filter(g => g.status === 'active')
            .map(g => g.groupId?.name || 'Группа')
            .join(', ') || 'Нет групп';

        const membership = student.activeMembership;
        const membershipHTML = renderMembershipBalanceBadge(student, membership);

        const membershipClass = getMembershipClass(membership);

        // Статистика
        const stats = student.stats || {};
        const monthMissed = stats.monthMissed || 0;

        // 🔴 ДОЛГ
        const debtAmount = student.debtAmount || 0;
        const isOverdue = student.isOverdue || false;
        const overdueDays = student.overdueDays || 0;
        const promisedPaymentDate = student.promisedPaymentDate || null;

        let debtHTML = '-';
        if (debtAmount > 0) {
            if (isOverdue) {
                debtHTML = `<span style="color: #ef4444; font-weight: 600;">${formatAmount(debtAmount)}</span>`;
                if (overdueDays > 0) {
                    debtHTML += `<br><span style="font-size: 0.75em; opacity: 0.7;">+${overdueDays} ${getDeclension(overdueDays, 'день', 'дня', 'дней')}</span>`;
                }
            } else {
                debtHTML = `<span style="color: #f59e0b; font-weight: 600;">${formatAmount(debtAmount)}</span>`;
                if (promisedPaymentDate) {
                    const promisedStr = new Date(promisedPaymentDate).toLocaleDateString('ru', { day: '2-digit', month: '2-digit' });
                    debtHTML += `<br><span style="font-size: 0.75em; opacity: 0.7;">до ${promisedStr}</span>`;
                }
            }
        }

        const isLost = student.isLost === true;
        const lastAttendedDate = student.lastAttendedDate || null;
        const lostBadge = isLost
            ? `<span style="display:inline-block;margin-left:8px;padding:2px 8px;background:rgba(100,116,139,0.25);color:#cbd5e1;border:1px solid rgba(148,163,184,0.4);border-radius:10px;font-size:0.7em;font-weight:600;letter-spacing:0.03em;text-transform:uppercase;vertical-align:middle;" title="${lastAttendedDate ? 'Последнее занятие: ' + new Date(lastAttendedDate).toLocaleDateString('ru') : 'Без посещений более 3 месяцев'}">Потерян</span>`
            : '';
        const platformBadge = getStudentLinkBadge(student);
        const directionsText = (student.learningDirections || []).join(', ') || 'Направление не указано';
        const teacherText = student.assignedTeacher
            ? `${student.assignedTeacher.name} ${student.assignedTeacher.lastName || ''}`.trim()
            : 'Не назначен';
        const customerText = student.customerName || 'Контакт не указан';

        return `
            <tr data-student-id="${student._id}" data-absences="${monthMissed}" data-debt="${debtAmount}" data-overdue="${isOverdue}" data-lost="${isLost}">
                <td data-label="Имя">
                    <div class="card-field">
                        <span class="card-field-label">Имя</span>
                        <span class="card-field-value student-name-cell">${escapeHtml(student.name)} ${escapeHtml(student.lastName || '')}${lostBadge}${platformBadge ? ` ${platformBadge}` : ''}
                            <small>${escapeHtml(directionsText)}</small>
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
                        <span class="card-field-value">${groupNames}</span>
                    </div>
                </td>
                <td data-label="Абонемент">
                    <div class="card-field">
                        <span class="card-field-label">Абонемент</span>
                        <span class="card-field-value"><span class="membership-badge ${membershipClass}">${membershipHTML}</span></span>
                    </div>
                </td>
                <td data-label="Долг">
                    <div class="card-field">
                        <span class="card-field-label">Долг</span>
                        <span class="card-field-value">${debtHTML}</span>
                    </div>
                </td>
                <td class="table-actions" data-label="Действия">
                    <div class="card-field">
                        <span class="card-field-label">Действия</span>
                        <div class="card-field-value">
                            <button class="table-btn" onclick="viewStudent('${student._id}')">Профиль</button>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
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
        case 'inactive':
            // Неактивные = без абонемента или истек
            return students.filter(s => {
                const membership = s.activeMembership;
                return !membership || membership.classesRemaining === 0;
            });
        case 'ending-soon':
            // Заканчивается абонемент = осталось 1-2 занятия
            return students.filter(s => {
                const membership = s.activeMembership;
                return membership && membership.classesRemaining > 0 && membership.classesRemaining <= 2;
            });
        case 'with-debt':
            // 🔴 С долгом
            return students.filter(s => (s.debtAmount || 0) > 0);
        case 'overdue':
            // 🔴 Просроченные платежи
            return students.filter(s => s.isOverdue === true);
        case 'lost':
            // ⚫ Потерянные — > 3 месяцев без занятий
            return students.filter(s => s.isLost === true);
        case 'all':
        default:
            return students;
    }
}

// Показать студентов с просроченными платежами (вызывается из Dashboard)
function showOverdueStudents() {
    // Переключиться на секцию учеников
    showSection('students');

    // Применить фильтр "Просрочено"
    filterStudents('overdue');

    // Обновить активный фильтр в UI
    document.querySelectorAll('[data-filter]').forEach(btn => {
        if (btn.getAttribute('data-filter') === 'overdue') {
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
    document.querySelectorAll('[data-filter]').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.filter === filter) {
            btn.classList.add('active');
        }
    });

    // Для фильтров "С долгом" и "Просрочено" - делаем запрос к API
    if (filter === 'with-debt' || filter === 'overdue') {
        renderStudents(currentStudentSearch, 1, filter);
        return;
    }

    // Для фильтра "Потерянные" — всегда идём на сервер (нужен глобальный фильтр по всей базе)
    if (filter === 'lost') {
        renderStudents(currentStudentSearch, 1, 'lost');
        return;
    }

    // Для остальных фильтров — перерисовываем таблицу из уже загруженных данных,
    // используя ту же функцию renderStudentsTable (чтобы шаблон строки и набор колонок
    // совпадал с основным рендером, включая колонку "Долг").
    const statsMap = {};
    allStudentsData.forEach(s => { statsMap[s._id] = s.stats || { monthMissed: 0 }; });
    renderStudentsTable(allStudentsData, statsMap);
}

// Просмотр ученика
async function viewStudent(id) {
    try {
        if (currentViewingStudentId !== id) selectedStudentMembershipId = null;
        currentViewingStudentId = id;
        const token = getAuthToken();

        // ⚡ МОМЕНТАЛЬНО показываем модалку с загрузкой
        document.getElementById('studentDetailModalTitle').textContent = 'Загрузка...';
        document.getElementById('studentBasicInfo').innerHTML = '<p style="text-align: center; padding: 30px; opacity: 0.5;">Загрузка данных...</p>';
        const integrationInfoEl = document.getElementById('studentIntegrationInfo');
        if (integrationInfoEl) {
            integrationInfoEl.innerHTML = '<p style="text-align: center; opacity: 0.5;">Загрузка...</p>';
        }
        document.getElementById('studentStatsInfo').innerHTML = '<p style="text-align: center; padding: 30px; opacity: 0.5;">Загрузка статистики...</p>';
        document.getElementById('studentAttendanceHistory').innerHTML = '<p style="text-align: center; padding: 20px; opacity: 0.5;">Загрузка истории...</p>';

        // ОТКРЫВАЕМ МОДАЛКУ СРАЗУ!
        document.getElementById('studentDetailModal').classList.add('show');

        // ⚡ ПАРАЛЛЕЛЬНО загружаем ВСЕ данные В ФОНЕ (включая абонемент, платежи и заморозки!)
        const [studentData, statsData, membershipData, paymentsData, freezesData] = await Promise.all([
            fetch(`${API_URL}/students/${id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => {
                // Student data loaded
                return r.json();
            }).catch(err => {
                console.error(`❌ Student fetch error:`, err);
                throw new Error(`Не удалось загрузить данные студента: ${err.message}`);
            }),
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

        const student = studentData.student;
        const stats = statsData.stats;

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

        // Обновляем заголовок
        document.getElementById('studentDetailModalTitle').textContent =
            `${student.name || ''} ${student.lastName || ''}`.trim() || 'Информация об ученике';

        // Устанавливаем обработчики для кнопок редактирования после загрузки данных
        // Используем setTimeout для гарантии, что DOM обновлен
        setTimeout(() => {
            setupStudentEditHandlers();
        }, 100);

        // Основная информация
        const activeGroups = student.groups.filter(g => g.status === 'active');
        const groups = activeGroups.map(g => g.groupId?.name || 'Группа').join(', ') || 'Нет групп';
        const dayNames = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
        const groupCards = activeGroups.length ? `
            <div class="student-group-list">
                ${activeGroups.map(entry => {
                    const group = entry.groupId || entry.group || {};
                    const schedule = (group.schedules || []).filter(item => !item.isPractice)
                        .map(item => `${dayNames[item.dayOfWeek]} ${item.time}`).join(' · ') || 'Расписание не задано';
                    const instruments = (group.instruments || []).map(item => `${item.name} ×${item.quantity}`).join(', ');
                    return `<div class="student-group-card"><strong>${escapeHtml(group.name || 'Группа')}</strong><span>${escapeHtml(schedule)}</span>${instruments ? `<small style="display:block;opacity:.65;margin-top:4px;">${escapeHtml(instruments)}</small>` : ''}</div>`;
                }).join('')}
            </div>` : '';

        const membership = student.activeMembership;
        const membershipEstimate = estimateLessonsFromBalance(student.accountBalance, membership);

        const membershipClass = getMembershipClass(membership);
        const genderText = student.gender === 'male' ? 'Мужской' : student.gender === 'female' ? 'Женский' : 'Не указан';
        const assignedTeacherText = student.assignedTeacher
            ? escapeHtml(`${student.assignedTeacher.name} ${student.assignedTeacher.lastName || ''}`.trim())
            : 'Не закреплён';
        const directions = (student.learningDirections || []).length
            ? student.learningDirections.map(item => `<span class="student-tag">${escapeHtml(item)}</span>`).join('')
            : '<span class="student-muted">Не указаны</span>';
        const customerText = student.customerName ? escapeHtml(student.customerName) : 'Не указан';
        const sourceText = student.acquisitionSource ? escapeHtml(student.acquisitionSource) : 'Не указан';
        const levelText = student.learningLevel ? escapeHtml(student.learningLevel) : 'Не указан';
        const statusText = student.status === 'active' ? 'Активен' : 'Неактивен';
        const birthDateText = student.dateOfBirth
            ? new Date(student.dateOfBirth).toLocaleDateString('ru-RU')
            : 'Не указана';

        const notesValue = student.notes ? String(student.notes) : '';
        const notesEscaped = notesValue
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

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
            <div class="student-lost-block" style="background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.35); border-radius: 10px; padding: 12px 14px; margin-bottom: 14px;">
                <div style="color:#ef4444;font-weight:600;margin-bottom:4px;">Ученик в статусе «Потерян»</div>
                <div style="opacity:0.8;font-size:0.88em;">${lostInfoText}</div>
            </div>
        ` : '';

        const additionalPhones = Array.isArray(student.additionalPhones) ? student.additionalPhones : [];
        const phonesHtml = [
            `<div class="student-contact-phone"><strong>Основной</strong>${getWhatsappLink(student.phone)}</div>`,
            ...additionalPhones.map(item => `
                <div class="student-contact-phone">
                    <strong>${escapeHtml(item.label || 'Дополнительный')}</strong>
                    ${getWhatsappLink(item.phone)}
                </div>
            `)
        ].join('');
        const lastPaymentText = student.lastPaymentDate
            ? new Date(student.lastPaymentDate).toLocaleDateString('ru-RU')
            : 'Нет платежей';
        const lastVisitText = student.lastAttendedDate
            ? new Date(student.lastAttendedDate).toLocaleDateString('ru-RU')
            : 'Нет посещений';

        document.getElementById('studentBasicInfo').innerHTML = `
            ${lostBlock}
            <div class="student-overview">
                <div class="student-overview-main">
                    <div class="student-avatar">${escapeHtml((student.lastName || student.name || '?').charAt(0))}</div>
                    <div>
                        <div class="student-status-line">
                            <span class="student-status-pill ${student.status === 'active' ? 'is-active' : ''}">${statusText}</span>
                            <span>${birthDateText}</span>
                        </div>
                        <div class="student-tags">${directions}</div>
                        <div class="student-overview-meta">${levelText} · ${assignedTeacherText}</div>
                    </div>
                </div>
                <div class="student-kpi-grid">
                    <div class="student-kpi"><span>Группы</span><strong>${activeGroups.length}</strong></div>
                    <div class="student-kpi"><span>Баланс в уроках</span><strong>${membershipEstimate ? `≈ ${membershipEstimate.lessons}` : (membership?.classesRemaining ?? '—')}</strong></div>
                    <div class="student-kpi"><span>Денежный баланс</span><strong>${formatAmount(student.accountBalance || 0)}</strong></div>
                    <div class="student-kpi"><span>Последнее занятие</span><strong>${lastVisitText}</strong></div>
                </div>
            </div>
            <div class="student-info-grid student-info-grid--details">
                <div class="student-info-item">
                    <span class="student-info-label">Контакты</span>
                    <span class="student-info-value student-contact-phones">${phonesHtml}</span>
                </div>
                <div class="student-info-item">
                    <span class="student-info-label">Заказчик / родитель</span>
                    <span class="student-info-value">${customerText}</span>
                </div>
                <div class="student-info-item">
                    <span class="student-info-label">Источник</span>
                    <span class="student-info-value">${sourceText}</span>
                </div>
                <div class="student-info-item">
                    <span class="student-info-label">Группы</span>
                    <span class="student-info-value">${groups}</span>
                </div>
                <div class="student-info-item">
                    <span class="student-info-label">Пол</span>
                    <span class="student-info-value">${genderText}</span>
                </div>
                <div class="student-info-item">
                    <span class="student-info-label">Регистрация</span>
                    <span class="student-info-value">${new Date(student.registeredAt).toLocaleDateString('ru')}</span>
                </div>
            </div>
            <div class="student-notes" style="margin-top:14px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    <span class="student-info-label" style="letter-spacing:0.05em;">Комментарий</span>
                    <span id="studentNotesStatus" style="font-size:0.75em;opacity:0.6;"></span>
                </div>
                <textarea
                    id="studentNotesInput"
                    data-student-id="${student._id}"
                    data-initial="${notesEscaped}"
                    rows="3"
                    placeholder="Заметка об ученике…"
                    style="width:100%;min-height:72px;resize:vertical;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#fff;padding:10px 12px;font-size:0.9em;font-family:inherit;line-height:1.4;outline:none;box-sizing:border-box;"
                >${notesEscaped}</textarea>
            </div>
            ${groupCards}
        `;

        initStudentNotesAutosave();
        void initStudentRegularScheduleEditor(student._id);
        try {
            renderStudentIntegrationBlock(student);
        } catch (integrationError) {
            console.error('Integration block render error:', integrationError);
            const integrationEl = document.getElementById('studentIntegrationInfo');
            if (integrationEl) {
                integrationEl.innerHTML = '<p style="color:#ef4444;text-align:center;">Не удалось отобразить блок платформы</p>';
            }
        }

        // Рендер «Скидки и категория» в отдельный сворачиваемый блок под платежами
        const discountsInfoEl = document.getElementById('studentDiscountsInfo');
        if (discountsInfoEl && typeof renderStudentDiscountsBlock === 'function') {
            discountsInfoEl.innerHTML = renderStudentDiscountsBlock(student);
            if (typeof initStudentDiscountsHandlers === 'function') {
                initStudentDiscountsHandlers(student);
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
                const statusColor = item.attended ? '#10b981' : '#ef4444';
                const statusText = item.attended ? 'Присутствовал' : 'Отсутствовал';
                const statusIcon = item.attended
                    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${statusColor}" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`
                    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${statusColor}" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

                const statusIconSimple = item.attended ? '✓' : '✗';
                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.85em;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="color: ${statusColor}; font-weight: 700; font-size: 1.1em; width: 18px;">${statusIconSimple}</span>
                            <span>${item.title || 'Занятие'}</span>
                        </div>
                        <span style="opacity: 0.6;">${new Date(item.date).toLocaleDateString('ru', { day: '2-digit', month: 'short' })}</span>
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

            const rawStartDate = new Date(activeMembership.startDate || activeMembership.createdAt);
            const startDateISO = rawStartDate.toISOString().split('T')[0];
            const freezesText = `${activeMembership.freezesUsed || 0}/${activeMembership.freezesAvailable || 0}`;

            const userRole = getUserRole();
            const canAddClasses = userRole === 'super_admin' || userRole === 'admin';
            const canFreeze = userRole === 'super_admin' || userRole === 'admin';
            const classesRemaining = Number(activeMembership.classesRemaining);
            const classesColor = classesRemaining === 1 ? '#ef4444' : '#eb4d77';
            const primaryComponentBalances = [
                ['Индивидуальные', activeMembership.individualClassesRemaining],
                ['Групповые', activeMembership.groupClassesRemaining],
                ['Теория', activeMembership.theoryClassesRemaining],
            ].filter(([, value]) => value !== null && value !== undefined);
            const primaryComponentBalancesHTML = primaryComponentBalances.length ? `
                <strong style="color: rgba(255,255,255,0.7);">Остатки по форматам:</strong>
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
            const membershipGroup = activeMembership.groupId && typeof activeMembership.groupId === 'object'
                ? activeMembership.groupId
                : (membershipData.memberships || []).find(m => m._id === activeMembership._id)?.groupId || null;
            const groupSchedules = membershipGroup?.schedules
                || student.groups?.find(sg => sg.groupId?.id === activeMembership.groupId || sg.group?.id === activeMembership.groupId)?.group?.schedules
                || student.groups?.find(sg => sg.status === 'active')?.group?.schedules
                || [];
            const regularScheduleText = typeof window.formatRegularScheduleCompact === 'function'
                ? window.formatRegularScheduleCompact(groupSchedules)
                : '—';
            const membershipEndDateText = activeMembership.endDate
                ? new Date(activeMembership.endDate).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
                : '—';
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
                            <strong>Активные абонементы</strong>
                            <span>${activeMembershipsAll.length} шт. Нажмите «Открыть», чтобы посмотреть подробности.</span>
                        </div>
                    </div>
                    ${activeMembershipsAll.map(membership => {
                        const membershipId = membership._id || membership.id;
                        const isSelected = membershipId === (activeMembership._id || activeMembership.id);
                        const componentBalances = [
                            ['Индивидуальные', membership.individualClassesRemaining],
                            ['Групповые', membership.groupClassesRemaining],
                            ['Теория', membership.theoryClassesRemaining],
                        ].filter(([, value]) => value !== null && value !== undefined);
                        return `
                            <div class="student-membership-item ${isSelected ? 'is-selected' : ''}">
                                <div class="student-membership-item-head">
                                    <div>
                                        <strong>${escapeHtml(membership.plan?.name || typeNames[membership.type] || membership.type)}</strong>
                                        <span>${escapeHtml(membership.plan?.direction?.name || membership.groupId?.name || 'Без привязки к группе')}</span>
                                    </div>
                                    <span class="student-membership-balance">${membership.classesRemaining} занятий</span>
                                </div>
                                ${componentBalances.length ? `
                                    <div class="student-membership-components">
                                        ${componentBalances.map(([label, value]) => `<span class="student-tag">${label}: ${value}</span>`).join('')}
                                    </div>
                                ` : ''}
                                <div class="student-membership-item-actions">
                                    <button type="button" class="table-btn" onclick="selectStudentMembership('${membershipId}')">${isSelected ? 'Открыт' : 'Открыть'}</button>
                                    <button type="button" class="table-btn" onclick="openMembershipModal('${membershipId}')">Продлить этот</button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;

            document.getElementById('studentMembershipInfo').innerHTML = `
                    ${membershipsOverview}
                    <div class="student-membership-detail-title">
                        Подробности выбранного абонемента
                    </div>
                    <div style="display: grid; grid-template-columns: auto 1fr; gap: 15px; align-items: center;">
                        <strong style="color: rgba(255,255,255,0.7);">Тип:</strong>
                        <span>${escapeHtml(activeMembership.plan?.name || typeNames[activeMembership.type] || activeMembership.type)}</span>
                        
                        <strong style="color: rgba(255,255,255,0.7);">Занятий осталось:</strong>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="color: ${classesColor}; font-weight: ${classesRemaining === 1 ? '700' : '600'}; font-size: 1.3em;">${classesRemaining}</span>
                            ${canAddClasses ? `
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <button 
                                        onclick="openAddClassesModal('${id}', '${activeMembership._id}', 'add', ${classesRemaining})" 
                                        class="icon-btn"
                                        title="Добавить занятия"
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                            <line x1="12" y1="5" x2="12" y2="19"></line>
                                            <line x1="5" y1="12" x2="19" y2="12"></line>
                                        </svg>
                                    </button>
                                    <button 
                                        onclick="openAddClassesModal('${id}', '${activeMembership._id}', 'remove', ${classesRemaining})" 
                                        class="icon-btn"
                                        title="Списать занятия"
                                        ${classesRemaining <= 0 ? 'disabled style="opacity: 0.4; cursor: not-allowed;"' : ''}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                            <line x1="5" y1="12" x2="19" y2="12"></line>
                                        </svg>
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                        
                        <strong style="color: rgba(255,255,255,0.7);">Использовано:</strong>
                        <span>${activeMembership.classesUsed} из ${activeMembership.totalClasses}</span>
                        ${primaryComponentBalancesHTML}
                        
                        <strong style="color: rgba(255,255,255,0.7);">Заморозок использовано:</strong>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span>${freezesText}</span>
                            ${canFreeze ? `
                                <button
                                    onclick="openFreezeModal('${id}', '${activeMembership._id}', '${student.gender || ''}')"
                                    class="icon-btn"
                                    title="Заморозить занятия"
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                        <line x1="12" y1="2" x2="12" y2="22"></line>
                                        <line x1="2" y1="12" x2="22" y2="12"></line>
                                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
                                        <line x1="19.07" y1="4.93" x2="4.93" y2="19.07"></line>
                                    </svg>
                                </button>
                            ` : ''}
                        </div>
                        ${freezesListHTML}

                        <strong style="color: rgba(255,255,255,0.7);">Период абонемента:</strong>
                        <span>${membershipPeriodLabel}</span>

                        <strong style="color: rgba(255,255,255,0.7);">Действует до:</strong>
                        <span>${membershipEndDateText}</span>
                        
                        <strong style="color: rgba(255,255,255,0.7);">Активирован:</strong>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <input 
                                type="date" 
                                id="membershipStartDateInput"
                                value="${startDateISO}"
                                data-membership-id="${activeMembership._id}"
                                style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;padding:4px 8px;font-size:0.9em;cursor:pointer;"
                            >
                            <span id="membershipStartDateStatus" style="font-size:0.75em;opacity:0.6;"></span>
                        </div>
                        
                        <strong style="color: rgba(255,255,255,0.7);">Стоимость:</strong>
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                            <span id="membershipPriceValue">${formatAmount(activeMembership.totalPrice || 0)}</span>
                            <button type="button" id="membershipPriceEditBtn" class="price-hint-action" data-membership-id="${activeMembership._id}" style="font-size:0.75em;">изменить</button>
                            <span id="membershipPriceEditStatus" style="font-size:0.75em;opacity:0.6;"></span>
                        </div>

                        <strong style="color: rgba(255,255,255,0.7);">Статус:</strong>
                        <span style="color: #10b981;">${activeMembership.status === 'active' ? 'Активен' : 'Неактивен'}</span>
                    </div>
                `;

            // Inline-редактирование цены абонемента
            const priceEditBtn = document.getElementById('membershipPriceEditBtn');
            if (priceEditBtn) {
                priceEditBtn.addEventListener('click', () => {
                    const valEl = document.getElementById('membershipPriceValue');
                    const statusEl = document.getElementById('membershipPriceEditStatus');
                    const mId = priceEditBtn.dataset.membershipId;
                    const currentValue = Number(activeMembership.totalPrice) || 0;
                    if (!valEl) return;

                    // Меняем отображение на input
                    valEl.innerHTML = `
                        <input type="number" id="membershipPriceInput" min="0" step="100" value="${currentValue}"
                            style="width:120px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;padding:4px 8px;font-size:0.9em;">
                    `;
                    priceEditBtn.textContent = 'сохранить';
                    priceEditBtn.classList.add('is-active');

                    const input = document.getElementById('membershipPriceInput');
                    if (input) {
                        input.focus();
                        input.select();
                    }

                    const save = async () => {
                        const newPrice = parseInt(document.getElementById('membershipPriceInput')?.value) || 0;
                        if (newPrice < 0) {
                            toast.warning('Цена не может быть отрицательной');
                            return;
                        }
                        if (newPrice === currentValue) {
                            viewStudent(id);
                            return;
                        }
                        if (statusEl) { statusEl.textContent = '⏳'; }
                        try {
                            const resp = await fetch(`${API_URL}/memberships/${mId}/price`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAuthToken()}` },
                                body: JSON.stringify({ totalPrice: newPrice })
                            });
                            const data = await resp.json();
                            if (data.success) {
                                if (statusEl) { statusEl.textContent = '✓'; }
                                viewStudent(id);
                            } else {
                                if (statusEl) { statusEl.textContent = '✕'; }
                                toast.error(data.error || 'Не удалось сохранить цену');
                            }
                        } catch (err) {
                            console.error('Price edit error:', err);
                            if (statusEl) { statusEl.textContent = '✕'; }
                            toast.error('Ошибка сети');
                        }
                    };

                    // Один-единственный обработчик клика "сохранить"
                    priceEditBtn.onclick = save;
                    // Enter в инпуте тоже сохраняет
                    if (input) {
                        input.addEventListener('keydown', (ev) => {
                            if (ev.key === 'Enter') {
                                ev.preventDefault();
                                save();
                            }
                        });
                    }
                });
            }

            // Автосохранение даты активации
            const dateInput = document.getElementById('membershipStartDateInput');
            if (dateInput) {
                dateInput.addEventListener('change', async (e) => {
                    const mId = e.target.dataset.membershipId;
                    const newDate = e.target.value;
                    const statusEl = document.getElementById('membershipStartDateStatus');
                    if (statusEl) { statusEl.textContent = '⏳'; statusEl.style.opacity = '1'; }
                    try {
                        const resp = await fetch(`${API_URL}/memberships/${mId}/update-dates`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAuthToken()}` },
                            body: JSON.stringify({ startDate: newDate })
                        });
                        const result = await resp.json();
                        if (result.success) {
                            if (statusEl) { statusEl.textContent = '✅'; setTimeout(() => { statusEl.textContent = ''; }, 2000); }
                        } else {
                            if (statusEl) { statusEl.textContent = '❌'; }
                            toast.error('Ошибка сохранения: ' + (result.error || ''));
                        }
                    } catch (err) {
                        if (statusEl) { statusEl.textContent = '❌'; }
                        toast.error('Ошибка сети');
                    }
                });
            }
        } else {
            document.getElementById('studentMembershipInfo').innerHTML = `
                <p style="text-align: center; opacity: 0.5; padding: 20px;">Нет активного абонемента</p>
            `;
        }

        // 💰 Рендерим платежи студента
        // Rendering payments for student

        if (paymentsData.success && paymentsData.payments && paymentsData.payments.length > 0) {
            const payments = paymentsData.payments;
            const summary = paymentsData.summary || {};
            // Payments found for display

            // 🔴 Проверяем АБОНЕМЕНТ на наличие долга
            let paymentNotice = '';

            // Показываем блок "Оплатить до / Просрочка" для ВСЕХ сценариев с долгом:
            // - partial (аванс + остаток)
            // - not_paid (оплата позже)
            // - trial_advance (аванс за пробный)
            // и для платежа ЛЮБОГО типа, у которого указан dueDate для этого абонемента.
            const hasDebt = activeMembership &&
                activeMembership.remainingAmount > 0 &&
                (activeMembership.paymentStatus === 'partial' || activeMembership.paymentStatus === 'not_paid');

            if (hasDebt) {
                // Ищем ближайший платёж с dueDate, относящийся к этому абонементу.
                // Берём самый ранний dueDate — это и есть обещанная дата доплаты.
                const promisedPayment = payments
                    .filter(p => p.membership === activeMembership._id && p.dueDate)
                    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];

                // Платёж по которому будем обновлять dueDate (с датой или ближайший без неё)
                const paymentForDueDate = promisedPayment || payments
                    .filter(p => p.membership === activeMembership._id)
                    .sort((a, b) => new Date(b.paymentDate || 0) - new Date(a.paymentDate || 0))[0];

                const editBtnHtml = paymentForDueDate
                    ? `<button onclick="editPromisedPaymentDate('${paymentForDueDate._id}', '${paymentForDueDate.dueDate || ''}')"
                          style="background: none; border: none; cursor: pointer; padding: 2px 4px; opacity: 0.6; flex-shrink: 0;"
                          title="Изменить дату">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                          </svg>
                      </button>`
                    : '';

                if (promisedPayment && promisedPayment.dueDate) {
                    const dueDate = new Date(promisedPayment.dueDate);
                    const today = new Date();
                    const isOverdue = dueDate < today;
                    const daysDiff = Math.ceil(Math.abs(today - dueDate) / (1000 * 60 * 60 * 24));
                    const dueDateStr = dueDate.toLocaleDateString('ru', { day: 'numeric', month: 'long' });

                    if (isOverdue) {
                        // ПРОСРОЧКА
                        paymentNotice = `
                            <div style="background: rgba(239, 68, 68, 0.15); padding: 12px; margin-bottom: 10px; border-radius: 6px; display: flex; align-items: center; gap: 12px;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" style="flex-shrink: 0;">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <line x1="12" y1="8" x2="12" y2="12"></line>
                                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                                </svg>
                                <div style="flex: 1;">
                                    <div style="color: #ef4444; font-weight: 600; font-size: 0.9em; margin-bottom: 3px; display: flex; align-items: center; gap: 6px;">
                                        ПРОСРОЧКА: ${daysDiff} ${getDeclension(daysDiff, 'день', 'дня', 'дней')}
                                        ${editBtnHtml}
                                    </div>
                                    <div style="font-size: 0.85em; opacity: 0.9;">
                                        Крайний срок был: ${dueDateStr}
                                    </div>
                                    <div style="font-size: 0.9em; margin-top: 4px; font-weight: 600; color: #ef4444;">
                                        К оплате: ${formatAmount(activeMembership.remainingAmount)}
                                    </div>
                                </div>
                            </div>
                        `;
                    } else {
                        // АКТИВНОЕ НАПОМИНАНИЕ (срок еще не истек)
                        const bgColor = daysDiff <= 3 ? 'rgba(239, 68, 68, 0.15)' : daysDiff <= 7 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)';
                        const textColor = daysDiff <= 3 ? '#ef4444' : daysDiff <= 7 ? '#f59e0b' : '#10b981';

                        paymentNotice = `
                            <div style="background: ${bgColor}; padding: 12px; margin-bottom: 10px; border-radius: 6px; display: flex; align-items: center; gap: 12px;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${textColor}" stroke-width="2.5" style="flex-shrink: 0;">
                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                    <line x1="16" y1="2" x2="16" y2="6"></line>
                                    <line x1="8" y1="2" x2="8" y2="6"></line>
                                    <line x1="3" y1="10" x2="21" y2="10"></line>
                                </svg>
                                <div style="flex: 1;">
                                    <div style="color: ${textColor}; font-weight: 600; font-size: 0.9em; margin-bottom: 3px; display: flex; align-items: center; gap: 6px;">
                                        Оплатить до: ${dueDateStr}
                                        ${editBtnHtml}
                                    </div>
                                    <div style="font-size: 0.85em; opacity: 0.9;">
                                        ${daysDiff > 0 ? `Осталось ${daysDiff} ${getDeclension(daysDiff, 'день', 'дня', 'дней')}` : 'Сегодня последний день'}
                                    </div>
                                    <div style="font-size: 0.9em; margin-top: 4px; font-weight: 600; color: ${textColor};">
                                        К оплате: ${formatAmount(activeMembership.remainingAmount)}
                                    </div>
                                </div>
                            </div>
                        `;
                    }
                } else {
                    // Долг есть, но дата не назначена — показываем блок с кнопкой «Назначить дату»
                    paymentNotice = `
                        <div style="background: rgba(100, 116, 139, 0.15); padding: 12px; margin-bottom: 10px; border-radius: 6px; display: flex; align-items: center; gap: 12px;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2.5" style="flex-shrink: 0;">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                <line x1="16" y1="2" x2="16" y2="6"></line>
                                <line x1="8" y1="2" x2="8" y2="6"></line>
                                <line x1="3" y1="10" x2="21" y2="10"></line>
                            </svg>
                            <div style="flex: 1;">
                                <div style="color: #94a3b8; font-weight: 600; font-size: 0.9em; margin-bottom: 3px; display: flex; align-items: center; gap: 6px;">
                                    Дата оплаты не назначена
                                    ${editBtnHtml}
                                </div>
                                <div style="font-size: 0.9em; margin-top: 4px; font-weight: 600; color: #f59e0b;">
                                    К оплате: ${formatAmount(activeMembership.remainingAmount)}
                                </div>
                            </div>
                        </div>
                    `;
                }
            }

            const paymentsHTML = payments.slice(0, 4).map(payment => {
                const date = new Date(payment.paymentDate).toLocaleDateString('ru', { day: '2-digit', month: 'short' });
                const statusColor = payment.status === 'completed' ? '#10b981' : '#f59e0b';

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
                                <div style="font-weight: 500;">${formatAmount(payment.amount)}</div>
                                <div style="font-size: 0.85em; opacity: 0.6; margin-top: 2px;">
                                    ${(payment.amount === 0 && payment.type === 'membership_advance') ? 'Оплата позже' : getPaymentTypeText(payment.type)}
                                    ${payment.dueDate ? ` <span style="font-size: 0.9em; font-weight: 500; opacity: 0.8; color: #f59e0b;">(до ${new Date(payment.dueDate).toLocaleDateString('ru', { day: '2-digit', month: '2-digit' })})</span>` : ''}
                                    ${methodLabel ? ` <span style="font-size: 0.9em; opacity: 0.8; color: #60a5fa;">· ${methodLabel}</span>` : ''}
                                </div>
                                ${discountHtml}
                            </div>
                        </div>
                        <span style="opacity: 0.5; font-size: 0.85em;">${date}</span>
                    </div>
                `;
            }).join('');

            document.getElementById('studentPaymentsInfo').style.display = 'flex';
            document.getElementById('studentPaymentsInfo').style.flexDirection = 'column';
            document.getElementById('studentPaymentsInfo').innerHTML = `
                ${paymentNotice}
                ${paymentsHTML}
                <div style="margin-top: auto; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1);">
                    <div style="display: flex; justify-content: space-between; font-size: 0.85em;">
                        <div>
                            <div style="opacity: 0.6; font-size: 0.8em; margin-bottom: 2px;">ОПЛАЧЕНО</div>
                            <div style="font-weight: 600; color: #10b981; font-size: 1.1em;">${formatAmount(summary.totalPaid || 0)}</div>
                        </div>
                        <div style="text-align: right;">
                            <div style="opacity: 0.6; font-size: 0.8em; margin-bottom: 2px;">К ОПЛАТЕ</div>
                            <div style="font-weight: 600; color: #f59e0b; font-size: 1.1em;">${formatAmount(summary.totalRemaining || 0)}</div>
                            ${summary.totalFutureRemaining > 0 ? `
                                <div style="font-size: 0.75em; opacity: 0.5; margin-top: 2px;">
                                    + ${formatAmount(summary.totalFutureRemaining)} (план)
                                </div>
                            ` : ''}
                        </div>
                    </div>
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
        toast.error(`Ошибка загрузки: ${error.message || 'Неизвестная ошибка'}`);

        // Закрываем модалку при критической ошибке
        closeStudentDetailModal();
    }
}

// =====================================================
// Автосохранение комментария к ученику (notes)
// =====================================================
function initStudentNotesAutosave() {
    const textarea = document.getElementById('studentNotesInput');
    const statusEl = document.getElementById('studentNotesStatus');
    if (!textarea) return;

    const studentId = textarea.dataset.studentId;
    let savedValue = textarea.dataset.initial || '';
    let saveTimer = null;

    const setStatus = (text, opacity = '1') => {
        if (!statusEl) return;
        statusEl.textContent = text;
        statusEl.style.opacity = opacity;
    };

    const save = async () => {
        const value = textarea.value;
        if (value === savedValue) return;
        setStatus('⏳');
        try {
            const resp = await fetch(`${API_URL}/students/${studentId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getAuthToken()}`
                },
                body: JSON.stringify({ notes: value })
            });
            const data = await resp.json();
            if (data.success) {
                savedValue = value;
                setStatus('Сохранено ✓', '0.7');
                setTimeout(() => setStatus('', '0.6'), 1800);
            } else {
                setStatus('Ошибка ✕');
                toast.error(data.error || 'Не удалось сохранить комментарий');
            }
        } catch (err) {
            console.error('Save notes error:', err);
            setStatus('Ошибка сети ✕');
        }
    };

    textarea.addEventListener('input', () => {
        setStatus('Редактирование…', '0.5');
        clearTimeout(saveTimer);
        saveTimer = setTimeout(save, 1200);
    });

    textarea.addEventListener('blur', () => {
        clearTimeout(saveTimer);
        save();
    });
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
    const referrerLabel = referrer
        ? `${escapeHtml(referrer.lastName || '')} ${escapeHtml(referrer.name || '')}`.trim() || 'Указан'
        : '';
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
                    <span>${escapeHtml(m.lastName || '')} ${escapeHtml(m.name || '')}</span>
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
                        placeholder="${referrer ? referrerLabel : 'Поиск по фамилии / имени / телефону…'}">
                    ${referrer ? `<button id="referrerClearBtn" type="button" class="discounts-btn is-danger">Убрать</button>` : ''}
                </div>
                <div id="referrerSearchResults" class="discounts-search-results"></div>
                ${referrer ? `<div class="discounts-meta" style="margin-top: 10px;">Привёл: <b>${referrerLabel}</b></div>` : ''}
                ${referralsCount > 0 ? `<div class="discounts-meta" style="margin-top: 15px;">
                    <b>Сам привёл (${referralsCount}):</b>
                    <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 5px;">
                        ${student.referrals.map(r => `
                            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.05); padding: 6px 10px; border-radius: 6px;">
                                <span>${escapeHtml(r.lastName || '')} ${escapeHtml(r.name || '')}</span>
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
                                    ${escapeHtml(s.lastName || '')} ${escapeHtml(s.name || '')} · ${escapeHtml(s.phone || '')}
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
                            ${escapeHtml(s.lastName || '')} ${escapeHtml(s.name || '')} · ${escapeHtml(s.phone || '')}
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
                            ${escapeHtml(s.lastName || '')} ${escapeHtml(s.name || '')} · ${escapeHtml(s.phone || '')}
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
    document.getElementById('studentDetailModal').classList.remove('show');
    currentViewingStudentId = null;
    selectedStudentMembershipId = null;
    // Сбрасываем режим редактирования при закрытии
    const editForm = document.getElementById('studentEditForm');
    const basicInfo = document.getElementById('studentBasicInfo');
    const editBtn = document.getElementById('editStudentBtn');
    if (editForm && basicInfo) {
        editForm.style.display = 'none';
        basicInfo.style.display = '';
        if (editBtn) {
            editBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; vertical-align: middle; margin-right: 6px;">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                РЕДАКТИРОВАТЬ
            `;
        }
    }
}

window.selectStudentMembership = async function(membershipId) {
    selectedStudentMembershipId = membershipId;
    if (currentViewingStudentId) await viewStudent(currentViewingStudentId);
};

// Переключить режим редактирования
function toggleStudentEditMode() {
    console.log('toggleStudentEditMode called');
    const editForm = document.getElementById('studentEditForm');
    const basicInfo = document.getElementById('studentBasicInfo');
    const editBtn = document.getElementById('editStudentBtn');

    if (!editForm || !basicInfo) {
        console.warn('Edit form or basic info not found', { editForm, basicInfo });
        return;
    }

    const isEditing = editForm.style.display !== 'none';

    if (isEditing) {
        // Выходим из режима редактирования
        editForm.style.display = 'none';
        basicInfo.style.display = 'block';
        if (editBtn) {
            editBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; vertical-align: middle; margin-right: 6px;">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                РЕДАКТИРОВАТЬ
            `;
        }
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
        if (editBtn) {
            editBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; vertical-align: middle; margin-right: 6px;">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
                ОТМЕНА
            `;
        }
    }
}

// Загрузить данные ученика для редактирования
async function loadStudentDataForEdit(studentId) {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/students/${studentId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();
        if (data.success && data.student) {
            const student = data.student;
            document.getElementById('editStudentName').value = student.name || '';
            document.getElementById('editStudentLastName').value = student.lastName || '';
            document.getElementById('editStudentPhone').value = student.phone || '';
            document.getElementById('editStudentCustomerName').value = student.customerName || '';
            document.getElementById('editStudentSource').value = student.acquisitionSource || '';
            document.getElementById('editStudentDirections').value = (student.learningDirections || []).join(', ');
            document.getElementById('editStudentLevel').value = student.learningLevel || '';
            const list = document.getElementById('editStudentAdditionalPhones');
            if (list) {
                list.innerHTML = '';
                (student.additionalPhones || []).forEach(item => addStudentPhoneField(item));
            }
        }
    } catch (error) {
        console.error('Error loading student data for edit:', error);
        toast.error('Ошибка загрузки данных ученика');
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
    const phone = document.getElementById('editStudentPhone').value.trim();
    const additionalPhones = Array.from(document.querySelectorAll('#editStudentAdditionalPhones .student-phone-row'))
        .map(row => ({
            label: row.querySelector('[data-phone-label]')?.value.trim() || '',
            phone: row.querySelector('[data-phone-number]')?.value.trim() || ''
        }))
        .filter(item => item.phone);
    const customerName = document.getElementById('editStudentCustomerName').value.trim();
    const acquisitionSource = document.getElementById('editStudentSource').value.trim();
    const learningDirections = document.getElementById('editStudentDirections').value
        .split(',').map(value => value.trim()).filter(Boolean);
    const learningLevel = document.getElementById('editStudentLevel').value.trim();

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
                phone,
                additionalPhones,
                customerName,
                acquisitionSource,
                learningDirections,
                learningLevel
            })
        });

        const data = await response.json();

        if (data.success) {
            toast.success('Данные ученика успешно обновлены');
            // Обновляем отображение данных ученика
            await viewStudent(studentId);
            // Выходим из режима редактирования
            toggleStudentEditMode();

            // ⚡ ОПТИМИСТИЧЕСКОЕ ОБНОВЛЕНИЕ ТАБЛИЦ (Мгновенно)

            // 1. Обновляем таблицу учеников
            const studentRow = document.querySelector(`#studentsTable tr[data-student-id="${studentId}"]`);
            if (studentRow) {
                // Имя
                const nameCell = studentRow.querySelector('td[data-label="Имя"] .card-field-value') || studentRow.querySelector('td[data-label="Имя"]');
                if (nameCell) nameCell.textContent = `${name} ${lastName}`;

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
                    cells[0].textContent = `${name} ${lastName}`;
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
            toast.error(data.error || 'Ошибка при сохранении данных');
        }
    } catch (error) {
        console.error('Error saving student changes:', error);
        toast.error('Ошибка при сохранении данных');
    }
}

function addStudentPhoneField(phone = {}) {
    const list = document.getElementById('editStudentAdditionalPhones');
    if (!list) return;

    const row = document.createElement('div');
    row.className = 'student-phone-row';
    row.innerHTML = `
        <input type="text" class="admin-input" data-phone-label placeholder="Кто отвечает: мама, папа…" value="${escapeHtml(phone.label || '')}">
        <input type="tel" class="admin-input" data-phone-number placeholder="+7…" value="${escapeHtml(phone.phone || '')}">
        <button type="button" class="student-phone-remove" title="Удалить номер">×</button>
    `;
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

// Редактирование ученика
function editStudent(id) {
    // TODO: Сделать модальное окно редактирования в будущем
    viewStudent(id);
}

// Показать модальное окно создания ученика
function showStudentCreatedModal(studentName, studentPhone, password, classesCount, membershipType, copySuccess, groupInfo = null, platformInfo = null) {
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
    const membershipTypeText = {
        'trial': 'Пробный',
        'monthly': 'Месячный',
        'monthly_12': 'Месячный (12 занятий)',
        'quarterly': 'Квартальный'
    }[membershipType] || membershipType;

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
        ? `\nЛичный кабинет CRM (оплаты): ${studentPhone}`
        : '';

    const whatsappMessage = `🎉 Добро пожаловать в ${schoolName}!

ВАШ АККАУНТ В ОБУЧАЮЩЕЙ ПЛАТФОРМЕ:
━━━━━━━━━━━━━━━━━
Логин: ${platformLogin}
Пароль: ${password}${crmLoginNote}

ВАШ АБОНЕМЕНТ:
━━━━━━━━━━━━━━━━━
Тип: ${membershipTypeText}
Занятий: ${classesCount}${groupInfo ? `
Группа: ${groupInfo.name}` : ''}${nextClassText ? `

${nextClassText}` : ''}${scheduleText ? `

РАСПИСАНИЕ ЗАНЯТИЙ:
${scheduleText}` : ''}${practiceText ? `

ПРАКТИКИ (открытые для всех групп):
${practiceText}` : ''}

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
                
                <div style="margin-bottom: 15px;">
                    <div style="color: var(--admin-text); opacity: 0.7; font-size: 0.85rem; margin-bottom: 5px;">Абонемент:</div>
                    <div style="color: var(--admin-text); font-size: 1.1rem; font-weight: 600;">${membershipTypeText} — ${classesCount} занятий</div>
                </div>
                
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
                            В CRM (оплаты): логин — телефон <code style="color: var(--pink);">${studentPhone}</code>
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
        'trial_advance': 'Аванс (пробное)',
        'trial_full': 'Пробное занятие',
        'membership_advance': 'Аванс (абонемент)',
        'membership_balance': 'Доплата',
        'membership_full': 'Абонемент',
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

function estimateLessonsFromBalance(balance, membership) {
    const amount = Number(balance || 0);
    if (!membership || amount <= 0) return null;
    const totalPrice = Number(membership.totalPrice || 0);
    const totalClasses = Number(membership.totalClasses || 0);
    if (totalPrice <= 0 || totalClasses <= 0) return null;
    const lessonPrice = totalPrice / totalClasses;
    if (!Number.isFinite(lessonPrice) || lessonPrice <= 0) return null;
    return {
        lessons: Math.floor(amount / lessonPrice),
        lessonPrice: Math.round(lessonPrice)
    };
}

function renderMembershipBalanceBadge(student, membership) {
    if (!membership) return 'Нет абонемента';
    const balance = Number(student.accountBalance || 0);
    const estimate = estimateLessonsFromBalance(balance, membership);
    const formatLabel = getMembershipFormatLabel(membership);
    if (balance > 0) {
        return `
            <span>${formatAmount(balance)} баланс</span>
            <small style="display:block;opacity:.75;margin-top:2px;">${formatLabel}${estimate ? ` · ≈ ${estimate.lessons} ${getDeclension(estimate.lessons, 'урок', 'урока', 'уроков')}` : ''}</small>
        `;
    }
    return `
        <span>${membership.classesRemaining} ${getDeclension(membership.classesRemaining, 'занятие', 'занятия', 'занятий')}</span>
        <small style="display:block;opacity:.75;margin-top:2px;">${formatLabel}</small>
    `;
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
            <strong>${student.name} ${student.lastName || ''}</strong><br>
            <small>${student.phone}</small>
            <br><small style="opacity:0.8;">Денежный баланс: <strong>${formatAmount(student.accountBalance || 0)}</strong></small>
            ${activeMembership ? `
                <br><small style="opacity: 0.7;">
                    Активный абонемент: ${activeMembership.type === 'trial'
                    ? 'Пробный'
                    : activeMembership.type === 'monthly'
                        ? 'Месячный'
                        : activeMembership.type === 'monthly_12'
                            ? 'Месячный (12 занятий)'
                            : 'Квартальный'
                }
                    (${activeMembership.classesRemaining} занятий)
                    ${activeMembership.remainingAmount > 0 ? `<br>К оплате: ${formatAmount(activeMembership.remainingAmount)}` : ''}
                </small>
            ` : ''}
        `;

        // Установить скрытые поля
        document.getElementById('paymentStudentId').value = currentViewingStudentId;
        document.getElementById('paymentMembershipId').value = activeMembership?._id || '';

        // Установить текущую дату
        document.getElementById('paymentDate').value = new Date().toISOString().split('T')[0];

        // Открыть модалку
        document.getElementById('addPaymentModal').classList.add('show');

        // Обработчик изменения типа платежа
        const paymentTypeSelect = document.getElementById('paymentType');
        paymentTypeSelect.addEventListener('change', function () {
            const paymentInfo = document.getElementById('paymentInfo');
            const type = this.value;

            if (type === 'membership_balance' && activeMembership && activeMembership.remainingAmount > 0) {
                paymentInfo.style.display = 'block';
                paymentInfo.innerHTML = `
                    <div style="font-size: 0.9em; line-height: 1.6;">
                        Остаток к оплате: <strong>${formatAmount(activeMembership.remainingAmount)}</strong><br>
                        <small style="opacity: 0.7;">Это доплата за текущий абонемент</small>
                    </div>
                `;
                document.getElementById('paymentAmount').value = activeMembership.remainingAmount;
            } else {
                paymentInfo.style.display = 'none';
                document.getElementById('paymentAmount').value = '';
            }
        }, { once: true });

    } catch (error) {
        console.error('Error opening payment modal:', error);
        toast.error('Ошибка при открытии формы платежа');
    }
}

// Закрыть модальное окно добавления платежа
function closeAddPaymentModal() {
    document.getElementById('addPaymentModal').classList.remove('show');
    document.getElementById('addPaymentForm').reset();
}

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
            const membershipId = document.getElementById('paymentMembershipId').value;
            const type = document.getElementById('paymentType').value;
            const amount = parseInt(document.getElementById('paymentAmount').value);
            const paymentDate = document.getElementById('paymentDate').value;
            const notes = document.getElementById('paymentNotes').value;
            const paymentMethod = document.getElementById('paymentMethod')?.value || '';

            if (!amount || amount <= 0) {
                toast.warning('Укажите сумму платежа');
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
                let response;

                // Если это платеж за абонемент и есть membershipId, используем специальный endpoint
                const isMembershipPayment = type.startsWith('membership_') && membershipId;

                if (isMembershipPayment) {
                    console.log(`💰 Добавление платежа к абонементу:`, { membershipId, type, amount, notes });
                    response = await fetch(`${API_URL}/memberships/${membershipId}/payment`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            amount,
                            type,
                            notes,
                            paymentMethod: paymentMethod || undefined
                        })
                    });
                } else {
                    // Для других типов используем общий endpoint создания платежа
                    console.log(`💰 Добавление платежа через /api/payments:`, { studentId, type, amount, membershipId });
                    response = await fetch(`${API_URL}/payments`, {
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
                            membershipId: membershipId || undefined,
                            paymentMethod: paymentMethod || undefined
                        })
                    });
                }

                const data = await response.json();

                if (data.success) {
                    toast.success(`Платеж ${formatAmount(amount)} успешно добавлен!`);
                    closeAddPaymentModal();

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
                        toast.error(`Ошибка: ${data.error || 'Не удалось добавить платеж'}`);
                    }
                }
            } catch (error) {
                console.error('Error adding payment:', error);
                toast.error('Ошибка при добавлении платежа');
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
    try {
        const token = getAuthToken();

        // Загружаем только данные об абонементе (БЕЗ статистики и платежей!)
        const membershipData = await fetch(`${API_URL}/memberships/student/${studentId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.json()).catch(() => ({ success: false, memberships: [] }));

        if (!membershipData.success || !membershipData.memberships) {
            return;
        }

        // Находим активный абонемент
        const activeMembership = membershipData.memberships.find(m =>
            m.status === 'active' && (m.type === 'monthly' || m.type === 'monthly_12' || m.type === 'quarterly')
        ) || membershipData.memberships.find(m => m.status === 'active');

        if (!activeMembership) {
            document.getElementById('studentMembershipInfo').innerHTML = `
                <p style="text-align: center; opacity: 0.5; padding: 20px;">Нет активного абонемента</p>
            `;
            return;
        }

        // Обновляем только секцию абонемента
        const typeNames = {
            'trial': 'Пробный',
            'monthly': 'Месячный',
            'monthly_12': 'Месячный (12 занятий)',
            'quarterly': 'Квартальный'
        };

        const startDate = new Date(activeMembership.startDate || activeMembership.createdAt).toLocaleDateString('ru');
        const freezesText = `${activeMembership.freezesUsed || 0}/${activeMembership.freezesAvailable || 0}`;

        const userRole = getUserRole();
        const canAddClasses = userRole === 'super_admin' || userRole === 'admin';
        const classesRemaining = Number(activeMembership.classesRemaining);
        const classesColor = classesRemaining === 1 ? '#ef4444' : '#eb4d77';

        // Проверяем есть ли месячный/квартальный абонемент
        const hasNonTrialMembership = membershipData.memberships.some(m =>
            m.status === 'active' && (m.type === 'monthly' || m.type === 'monthly_12' || m.type === 'quarterly')
        );

        document.getElementById('studentMembershipInfo').innerHTML = `
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 15px; align-items: center;">
                <strong style="color: rgba(255,255,255,0.7);">Тип:</strong>
                <span>${typeNames[activeMembership.type]}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Занятий осталось:</strong>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="color: ${classesColor}; font-weight: ${classesRemaining === 1 ? '700' : '600'}; font-size: 1.3em;">${classesRemaining}</span>
                    ${canAddClasses ? `
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <button 
                                onclick="openAddClassesModal('${studentId}', '${activeMembership._id}', 'add', ${classesRemaining})" 
                                class="icon-btn"
                                title="Добавить занятия"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                    <line x1="12" y1="5" x2="12" y2="19"></line>
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
                                </svg>
                            </button>
                            <button 
                                onclick="openAddClassesModal('${studentId}', '${activeMembership._id}', 'remove', ${classesRemaining})" 
                                class="icon-btn"
                                title="Списать занятия"
                                ${classesRemaining <= 0 ? 'disabled style="opacity: 0.4; cursor: not-allowed;"' : ''}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
                                </svg>
                            </button>
                        </div>
                    ` : ''}
                </div>
                
                <strong style="color: rgba(255,255,255,0.7);">Использовано:</strong>
                <span>${activeMembership.classesUsed} из ${activeMembership.totalClasses}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Заморозок использовано:</strong>
                <span>${freezesText}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Активирован:</strong>
                <span>${startDate}</span>
                
                <strong style="color: rgba(255,255,255,0.7);">Статус:</strong>
                <span style="color: #10b981;">${activeMembership.status === 'active' ? 'Активен' : 'Неактивен'}</span>
            </div>
        `;
    } catch (error) {
        console.error('Error updating membership in profile:', error);
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

let studentScheduleItems = [];
let studentScheduleMeta = { studentId: null, source: 'student', groupId: null, groupName: null };
let studentScheduleRooms = [];

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

function renderStudentScheduleList() {
    const container = document.getElementById('studentScheduleList');
    if (!container) return;

    if (!studentScheduleItems.length) {
        container.innerHTML = '<p style="opacity:0.55;text-align:center;padding:12px 0;">Расписание не задано — добавьте занятия</p>';
        return;
    }

    const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
    const showPractice = studentScheduleMeta.source === 'group';

    container.innerHTML = studentScheduleItems.map((item) => `
        <div style="margin-bottom:10px;padding:12px;background:rgba(255,255,255,0.04);border-radius:8px;border-left:3px solid ${item.isPractice ? '#4d9beb' : '#eb4d77'};">
            <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;margin-bottom:10px;">
                <select class="admin-input" style="margin:0;" onchange="updateStudentScheduleItem(${item.id}, 'dayOfWeek', this.value)">
                    ${days.map((day, index) => `
                        <option value="${index + 1}" ${item.dayOfWeek === index + 1 ? 'selected' : ''}>${day}</option>
                    `).join('')}
                </select>
                <input type="time" class="admin-input" style="margin:0;" value="${item.time}"
                       onchange="updateStudentScheduleItem(${item.id}, 'time', this.value)">
                <select class="admin-input" style="margin:0;" onchange="updateStudentScheduleItem(${item.id}, 'duration', this.value)">
                    <option value="60" ${item.duration === 60 ? 'selected' : ''}>60 мин</option>
                    <option value="90" ${item.duration === 90 ? 'selected' : ''}>90 мин</option>
                    <option value="120" ${item.duration === 120 ? 'selected' : ''}>120 мин</option>
                </select>
            </div>
            <div style="display:grid;grid-template-columns:1fr auto;gap:10px;${showPractice ? 'margin-bottom:10px;' : ''}">
                <select class="admin-input" style="margin:0;" onchange="updateStudentScheduleItem(${item.id}, 'roomId', this.value)">
                    <option value="">Зал не выбран</option>
                    ${studentScheduleRooms.map((room) => {
                        const roomId = room.id || room._id;
                        return `<option value="${roomId}" ${item.roomId === roomId ? 'selected' : ''}>${room.name}</option>`;
                    }).join('')}
                </select>
                <button type="button" class="table-btn" onclick="removeStudentScheduleItem(${item.id})"
                        style="padding:8px 16px;margin:0;background:#dc3545;white-space:nowrap;">Удалить</button>
            </div>
            ${showPractice ? `
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;">
                    <input type="checkbox" ${item.isPractice ? 'checked' : ''}
                           onchange="updateStudentScheduleItem(${item.id}, 'isPractice', this.checked)">
                    <span style="font-size:0.88em;opacity:0.8;">Практика (доступна всем ученикам группы)</span>
                </label>
            ` : ''}
        </div>
    `).join('');
}

async function initStudentRegularScheduleEditor(studentId) {
    studentScheduleMeta.studentId = studentId;
    const hintEl = document.getElementById('studentScheduleSourceHint');
    const statusEl = document.getElementById('studentScheduleStatus');
    if (hintEl) hintEl.textContent = 'Загрузка расписания...';
    if (statusEl) statusEl.textContent = '';

    await loadStudentScheduleRooms();

    try {
        const response = await fetch(`${API_URL}/students/${studentId}/schedule`, {
            headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            if (hintEl) hintEl.textContent = data.error || 'Не удалось загрузить расписание';
            studentScheduleItems = [];
            renderStudentScheduleList();
            return;
        }

        const payload = data.data || {};
        studentScheduleMeta.source = payload.source || 'student';
        studentScheduleMeta.groupId = payload.groupId || null;
        studentScheduleMeta.groupName = payload.groupName || null;

        studentScheduleItems = (payload.schedules || []).map((item) => ({
            id: Date.now() + Math.random(),
            dayOfWeek: item.dayOfWeek,
            time: item.time,
            duration: item.duration || 90,
            roomId: item.roomId || item.room?.id || null,
            isPractice: Boolean(item.isPractice),
        }));

        if (hintEl) {
            if (studentScheduleMeta.source === 'group' && studentScheduleMeta.groupName) {
                hintEl.textContent = `Расписание группы «${studentScheduleMeta.groupName}». Изменения применятся ко всем ученикам группы и сразу появятся в календаре.`;
            } else {
                hintEl.textContent = 'Индивидуальное расписание ученика. После сохранения занятия автоматически появятся в календаре.';
            }
        }

        renderStudentScheduleList();
    } catch (error) {
        if (hintEl) hintEl.textContent = 'Ошибка загрузки расписания';
        console.error(error);
    }
}

function addStudentScheduleItem() {
    studentScheduleItems.push({
        id: Date.now() + Math.random(),
        dayOfWeek: 1,
        time: '18:00',
        duration: 90,
        roomId: null,
        isPractice: false,
    });
    renderStudentScheduleList();
}

function removeStudentScheduleItem(itemId) {
    studentScheduleItems = studentScheduleItems.filter((item) => item.id !== itemId);
    renderStudentScheduleList();
}

function updateStudentScheduleItem(itemId, field, value) {
    const item = studentScheduleItems.find((entry) => entry.id === itemId);
    if (!item) return;
    if (field === 'dayOfWeek' || field === 'duration') {
        item[field] = parseInt(value, 10);
    } else if (field === 'isPractice') {
        item[field] = value === true || value === 'true';
    } else if (field === 'roomId') {
        item[field] = value || null;
    } else {
        item[field] = value;
    }
}

async function saveStudentRegularSchedule() {
    const studentId = studentScheduleMeta.studentId;
    const statusEl = document.getElementById('studentScheduleStatus');
    if (!studentId) return;

    if (statusEl) statusEl.textContent = 'Сохранение...';

    try {
        const response = await fetch(`${API_URL}/students/${studentId}/schedule`, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                schedules: studentScheduleItems.map((item) => ({
                    dayOfWeek: item.dayOfWeek,
                    time: item.time,
                    duration: item.duration,
                    roomId: item.roomId,
                    isPractice: item.isPractice,
                })),
            }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            const conflictText = data.conflicts?.map((item) => item.message).join('\n');
            showToast(conflictText ? `${data.error}:\n${conflictText}` : (data.error || 'Не удалось сохранить расписание'), 'error');
            if (statusEl) statusEl.textContent = data.conflicts?.[0]?.message || '';
            return;
        }

        const created = data.generation?.created || 0;
        showToast(`Расписание сохранено. В календарь добавлено занятий: ${created}`, 'success');
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
window.toggleStudentEditMode = toggleStudentEditMode;
window.saveStudentChanges = saveStudentChanges;
window.addStudentPhoneField = addStudentPhoneField;
window.initStudentEditForm = initStudentEditForm;
window.setupStudentEditHandlers = setupStudentEditHandlers;
window.checkStudentPlatformLink = checkStudentPlatformLink;
window.linkStudentToPlatform = linkStudentToPlatform;
window.provisionStudentPlatform = provisionStudentPlatform;
window.openStudentInPlatform = openStudentInPlatform;
window.addStudentScheduleItem = addStudentScheduleItem;
window.removeStudentScheduleItem = removeStudentScheduleItem;
window.updateStudentScheduleItem = updateStudentScheduleItem;
window.saveStudentRegularSchedule = saveStudentRegularSchedule;

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
