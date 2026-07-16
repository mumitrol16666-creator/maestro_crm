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

function formatMoney(value) {
    return `${Number(value || 0).toLocaleString('ru-RU')} ₸`;
}

function balanceTone(value) {
    const amount = Number(value || 0);
    if (amount < 0) return 'debt';
    if (amount > 0) return 'positive';
    return 'neutral';
}

function lessonDateLine(lesson) {
    return `${formatDateRu(lesson.date)} · ${lesson.startTime}–${lesson.endTime}`;
}

function renderLessonItem(lesson, isUpcoming) {
    const hwBlock = lesson.homework
        ? `<div class="hw"><strong>Домашнее задание:</strong><br>${escapeHtml(lesson.homework)}</div>`
        : '';
    const topicBlock = lesson.topic
        ? `<div class="meta" style="margin-top:6px;">Тема: ${escapeHtml(lesson.topic)}</div>`
        : '';

    return `
        <article class="lesson-item ${isUpcoming ? '' : 'past'}">
            <div class="title">${escapeHtml(lesson.title)}</div>
            <div class="meta">
                ${formatDateRu(lesson.date)} · ${lesson.startTime}–${lesson.endTime}
                ${lesson.teacherName ? ` · ${escapeHtml(lesson.teacherName)}` : ''}
                ${lesson.roomName ? ` · ${escapeHtml(lesson.roomName)}` : ''}
            </div>
            <div class="meta">${formatStatus(lesson.status)}${lesson.groupName ? ` · ${escapeHtml(lesson.groupName)}` : ''}</div>
            ${topicBlock}
            ${hwBlock}
        </article>
    `;
}

function renderNextLesson(lesson) {
    if (!lesson) {
        return '<div class="profile-next-lesson"><strong>Ближайших уроков нет</strong><span>Когда администратор поставит урок в расписание, он появится здесь.</span></div>';
    }
    return `
        <div class="profile-next-lesson">
            <strong>${escapeHtml(lesson.title)}</strong>
            <span>${lessonDateLine(lesson)}</span>
            <span>${lesson.teacherName ? escapeHtml(lesson.teacherName) : 'Преподаватель уточняется'}${lesson.roomName ? ` · ${escapeHtml(lesson.roomName)}` : ''}</span>
        </div>
    `;
}

function renderMembershipCard(membership) {
    const estimated = Number.isFinite(Number(membership.estimatedLessonsRemaining))
        ? Number(membership.estimatedLessonsRemaining)
        : Number(membership.classesRemaining || 0);
    const lessonTone = estimated < 0 ? 'debt' : (estimated <= 2 ? 'low' : 'ok');
    const lessonLabel = estimated === 1 ? 'урок' : 'уроков';
    const lessonPrice = Number(membership.lessonPrice || 0);
    return `
        <article class="membership-card">
            <div class="membership-card__top">
                <div>
                    <strong>${escapeHtml(membership.groupName || 'Общий абонемент')}</strong>
                    <span>${escapeHtml(membershipTypeLabel(membership.type))} · до ${formatDateRu(membership.endDate)}</span>
                </div>
                <div class="membership-lessons is-${lessonTone}">
                    <b>${Number.isFinite(estimated) ? estimated : '—'}</b>
                    <small>${lessonLabel}</small>
                </div>
            </div>
            <div class="membership-card__meta">
                <span>Баланс: ${formatMoney(membership.remainingAmount)}</span>
                ${lessonPrice ? `<span>~ ${formatMoney(lessonPrice)} за урок</span>` : ''}
                <span>Пакет: ${membership.totalClasses || 0} зан.</span>
            </div>
        </article>
    `;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getDeclension(number, one, two, five) {
    let n = Math.abs(number);
    n %= 100;
    if (n >= 5 && n <= 20) return five;
    n %= 10;
    if (n === 1) return one;
    if (n >= 2 && n <= 4) return two;
    return five;
}

function formatStudentAgeLabel(dateValue) {
    if (!dateValue) return '';
    const birthDate = new Date(dateValue);
    if (Number.isNaN(birthDate.getTime())) return '';

    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    const hasBirthdayPassed = monthDiff > 0 || (monthDiff === 0 && today.getDate() >= birthDate.getDate());
    if (!hasBirthdayPassed) age -= 1;

    if (age < 0 || age > 120) return '';
    return `${age} ${getDeclension(age, 'год', 'года', 'лет')}`;
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
        const profileName = [p.lastName, p.name, p.middleName].filter(Boolean).join(' ').trim() || 'Ученик';
        const ageLabel = formatStudentAgeLabel(p.dateOfBirth);

        const membershipsHtml = p.memberships.length
            ? p.memberships.map(renderMembershipCard).join('')
            : '<p class="empty">Нет активных абонементов</p>';

        const upcomingHtml = p.upcomingLessons.length
            ? p.upcomingLessons.map(l => renderLessonItem(l, true)).join('')
            : '<p class="empty">Ближайших уроков нет</p>';

        const historyHtml = p.lessonHistory.length
            ? p.lessonHistory.map(l => renderLessonItem(l, false)).join('')
            : '<p class="empty">История уроков пуста</p>';

        app.innerHTML = `
            <div class="profile-shell">
                <section class="profile-card profile-hero profile-section" id="profileHome">
                    <div class="profile-hero-top">
                        <div>
                            <h2>Мой кабинет</h2>
                            <p class="profile-name">${escapeHtml(profileName)}${ageLabel ? `<span class="profile-age">${escapeHtml(ageLabel)}</span>` : ''}</p>
                            <p class="profile-meta">${escapeHtml(p.phone)}</p>
                            <div class="profile-pill-row">
                                ${p.groups.length ? p.groups.map(g => `<span class="profile-pill">${escapeHtml(g.name)}</span>`).join('') : '<span class="profile-pill">Без группы</span>'}
                            </div>
                        </div>
                        <div class="profile-balance is-${balanceTone(p.accountBalance)}">
                            <span>Баланс</span>
                            <strong>${formatMoney(p.accountBalance)}</strong>
                        </div>
                    </div>
                    <div style="margin-top:16px;">${renderNextLesson(p.upcomingLessons[0])}</div>
                    <a class="online-link" href="${onlineUrl}" target="_blank" rel="noopener">Онлайн-курсы и обучение →</a>
                </section>

                <section class="profile-card profile-section" id="profileMemberships">
                    <div class="profile-section-head">
                        <h2>Абонементы</h2>
                        <span class="profile-section-count">${p.memberships.length}</span>
                    </div>
                    <div class="membership-list">${membershipsHtml}</div>
                </section>

                <section class="profile-card profile-section" id="profileLessons">
                    <div class="profile-section-head">
                        <h2>Ближайшие уроки</h2>
                        <span class="profile-section-count">${p.upcomingLessons.length}</span>
                    </div>
                    <div class="lesson-list">${upcomingHtml}</div>
                </section>

                <section class="profile-card profile-section" id="profileHistory">
                    <div class="profile-section-head">
                        <h2>История</h2>
                        <span class="profile-section-count">${p.lessonHistory.length}</span>
                    </div>
                    <div class="lesson-list">${historyHtml}</div>
                </section>

                <section class="profile-card profile-section" id="profileSecurity">
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
                </section>

                <p class="profile-meta" style="text-align:center; margin-top:8px;">
                    Вопросы? ${typeof getMaestroSupportMessage === 'function' ? getMaestroSupportMessage() : 'Свяжитесь с администратором школы'}
                </p>
            </div>
            <nav class="app-tabbar" aria-label="Навигация кабинета">
                <a href="#profileHome">Главная</a>
                <a href="#profileMemberships">Абонем.</a>
                <a href="#profileLessons">Уроки</a>
                <a href="#profileSecurity">Пароль</a>
            </nav>
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
