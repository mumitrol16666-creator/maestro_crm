// Личный кабинет ученика CRM (офлайн-школа)

function formatDateRu(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatStatus(status) {
    const map = {
        scheduled: 'Запланирован',
        started: 'Идёт',
        pending_admin_review: 'На проверке',
        completed: 'Проведён',
        not_filled: 'Не заполнен',
        cancelled: 'Отменён'
    };
    return map[status] || status;
}

function membershipTypeLabel(type) {
    const map = {
        trial: 'Пробный',
        monthly: 'Месячный',
        monthly_12: '12 занятий',
        quarterly: 'Квартальный',
        individual_single: 'Индивидуальный',
        individual_package: 'Пакет индивид.'
    };
    return map[type] || type;
}

function renderLessonItem(lesson, isUpcoming) {
    const hwBlock = lesson.homework
        ? `<div class="hw"><strong>Домашнее задание:</strong><br>${escapeHtml(lesson.homework)}</div>`
        : '';
    const topicBlock = lesson.topic
        ? `<div class="meta" style="margin-top:6px;">Тема: ${escapeHtml(lesson.topic)}</div>`
        : '';

    return `
        <div class="lesson-item ${isUpcoming ? '' : 'past'}">
            <div class="title">${escapeHtml(lesson.title)}</div>
            <div class="meta">
                ${formatDateRu(lesson.date)} · ${lesson.startTime}–${lesson.endTime}
                ${lesson.teacherName ? ` · ${escapeHtml(lesson.teacherName)}` : ''}
                ${lesson.roomName ? ` · ${escapeHtml(lesson.roomName)}` : ''}
            </div>
            <div class="meta">${formatStatus(lesson.status)}${lesson.groupName ? ` · ${escapeHtml(lesson.groupName)}` : ''}</div>
            ${topicBlock}
            ${hwBlock}
        </div>
    `;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Обработка формы смены пароля
function initPasswordChange() {
    const btn = document.getElementById('changePasswordBtn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        const msgEl = document.getElementById('passwordMessage');
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        msgEl.textContent = '';
        msgEl.className = '';

        if (!currentPassword || !newPassword || !confirmPassword) {
            msgEl.textContent = 'Заполните все поля';
            msgEl.className = 'error';
            return;
        }

        if (newPassword !== confirmPassword) {
            msgEl.textContent = 'Пароли не совпадают';
            msgEl.className = 'error';
            return;
        }

        if (newPassword.length < 8) {
            msgEl.textContent = 'Пароль должен быть не менее 8 символов';
            msgEl.className = 'error';
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Сохранение...';

        try {
            const token = getAuthToken();
            const response = await fetch(`${API_URL}/auth/change-password`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ currentPassword, newPassword })
            });

            const data = await response.json();

            if (response.ok && data.ok) {
                msgEl.textContent = data.message || 'Пароль успешно изменён';
                msgEl.className = 'success';
                document.getElementById('currentPassword').value = '';
                document.getElementById('newPassword').value = '';
                document.getElementById('confirmPassword').value = '';
                if (typeof toast !== 'undefined') toast.success('Пароль изменён');
            } else {
                msgEl.textContent = data.error || 'Ошибка при смене пароля';
                msgEl.className = 'error';
            }
        } catch (error) {
            console.error('Change password error:', error);
            msgEl.textContent = 'Ошибка сети. Попробуйте позже.';
            msgEl.className = 'error';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Сменить пароль';
        }
    });
}

async function loadStudentProfile() {
    const app = document.getElementById('profileApp');
    const token = getAuthToken();
    const role = getUserRole();

    if (!token || role !== 'student') {
        window.location.href = '/login.html';
        return;
    }

    try {
        const response = await fetch(`${API_URL}/students/me/cabinet`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.status === 401) {
            localStorage.clear();
            window.location.href = '/login.html';
            return;
        }

        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Ошибка загрузки');
        }

        const p = data.profile;
        const brand = window.MAESTRO_BRAND || {};
        const onlineUrl = brand.website || 'https://maestro-school.duckdns.org';

        const membershipsHtml = p.memberships.length
            ? p.memberships.map(m => `
                <div class="stat-box">
                    <div class="value">${m.classesRemaining}</div>
                    <div class="label">${escapeHtml(m.groupName)} · ${membershipTypeLabel(m.type)}<br>из ${m.totalClasses} до ${formatDateRu(m.endDate)}</div>
                </div>
            `).join('')
            : '<p class="empty">Нет активных абонементов</p>';

        const upcomingHtml = p.upcomingLessons.length
            ? p.upcomingLessons.map(l => renderLessonItem(l, true)).join('')
            : '<p class="empty">Ближайших уроков нет</p>';

        const historyHtml = p.lessonHistory.length
            ? p.lessonHistory.map(l => renderLessonItem(l, false)).join('')
            : '<p class="empty">История уроков пуста</p>';

        app.innerHTML = `
            <div class="profile-card">
                <h2>Мой профиль</h2>
                <p class="profile-name">${escapeHtml(p.name)} ${escapeHtml(p.lastName || '')}</p>
                <p class="profile-meta">${escapeHtml(p.phone)}</p>
                ${p.groups.length ? `<p class="profile-meta" style="margin-top:8px;">Группы: ${p.groups.map(g => escapeHtml(g.name)).join(', ')}</p>` : ''}
                ${p.debtAmount > 0 ? `<p class="debt-warn" style="margin-top:12px;">Долг: ${p.debtAmount.toLocaleString('ru-RU')} ₸</p>` : ''}
                <a class="online-link" href="${onlineUrl}" target="_blank" rel="noopener">
                    Онлайн-курсы и обучение →
                </a>
            </div>

            <div class="profile-card">
                <h2>Абонементы</h2>
                <div class="stat-grid">${membershipsHtml}</div>
            </div>

            <div class="profile-card">
                <h2>Уроки в школе — ближайшие</h2>
                <div class="lesson-list">${upcomingHtml}</div>
            </div>

            <div class="profile-card">
                <h2>История уроков</h2>
                <div class="lesson-list">${historyHtml}</div>
            </div>

            <div class="profile-card">
                <h2>Безопасность</h2>
                <div class="password-form">
                    <div class="form-group">
                        <label for="currentPassword">Текущий пароль</label>
                        <input type="password" id="currentPassword" placeholder="Введите текущий пароль" autocomplete="current-password">
                    </div>
                    <div class="form-group">
                        <label for="newPassword">Новый пароль</label>
                        <input type="password" id="newPassword" placeholder="Минимум 8 символов" autocomplete="new-password">
                    </div>
                    <div class="form-group">
                        <label for="confirmPassword">Повторите новый пароль</label>
                        <input type="password" id="confirmPassword" placeholder="Повторите новый пароль" autocomplete="new-password">
                    </div>
                    <button class="btn-submit" id="changePasswordBtn">Сменить пароль</button>
                    <div id="passwordMessage"></div>
                </div>
            </div>

            <p class="profile-meta" style="text-align:center; margin-top:24px;">
                Вопросы? ${typeof getMaestroSupportMessage === 'function' ? getMaestroSupportMessage() : 'Свяжитесь с администратором школы'}
            </p>
        `;

        initPasswordChange();
    } catch (error) {
        console.error('Profile load error:', error);
        app.innerHTML = `<div class="profile-card"><p class="debt-warn">Не удалось загрузить кабинет. ${escapeHtml(error.message)}</p></div>`;
        if (typeof toast !== 'undefined') toast.error(error.message);
    }
}

document.getElementById('logoutBtn')?.addEventListener('click', () => {
    localStorage.clear();
    window.location.href = '/login.html';
});

document.addEventListener('DOMContentLoaded', loadStudentProfile);
