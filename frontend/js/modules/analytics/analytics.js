// =====================================================
// Аналитика (admin / super_admin)
// =====================================================

let analyticsState = {
    preset: 'thisMonth',
    from: null,
    to: null,
    tab: 'overview',
    loaded: { overview: false, teachers: false, managers: false, admins: false, losses: false },
};

const LOSS_STAGE_LABELS = {
    before_trial: 'До пробного',
    on_trial: 'На пробном',
    after_trial: 'После пробного',
    after_month1: 'После 1-го месяца',
    after_month2: 'После 2-го месяца',
    '—': 'Не указано',
};

function analyticsFormatMoney(n) {
    const v = Math.round(Number(n) || 0);
    return v.toLocaleString('ru-RU').replace(/\u00a0/g, ' ') + ' ₸';
}

function analyticsFormatPercent(n) {
    return `${Math.round(Number(n) || 0)}%`;
}

function analyticsFmtDate(d) {
    const dd = d instanceof Date ? d : new Date(d);
    if (isNaN(dd.getTime())) return '';
    const y = dd.getFullYear();
    const m = String(dd.getMonth() + 1).padStart(2, '0');
    const day = String(dd.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function analyticsComputePeriod(preset) {
    const now = new Date();
    let from, to = new Date(now);
    if (preset === 'thisMonth') {
        from = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (preset === 'lastMonth') {
        from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        to   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    } else if (preset === 'last3') {
        from = new Date(now);
        from.setMonth(from.getMonth() - 3);
    } else if (preset === 'last12') {
        from = new Date(now);
        from.setMonth(from.getMonth() - 12);
    } else {
        from = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    from.setHours(0, 0, 0, 0);
    return { from, to };
}

async function analyticsFetch(path) {
    const qs = new URLSearchParams();
    if (analyticsState.from) qs.set('from', analyticsState.from.toISOString());
    if (analyticsState.to)   qs.set('to',   analyticsState.to.toISOString());
    const url = `${API_URL}/analytics/${path}?${qs.toString()}`;
    const resp = await fetch(url, {
        headers: { 'Authorization': `Bearer ${getAuthToken()}` },
    });
    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${body || resp.statusText}`);
    }
    return resp.json();
}

// =====================================================
// Рендер
// =====================================================
function renderAnalytics() {
    const section = document.getElementById('section-analytics');
    if (!section) return;

    // Инициализация один раз (биндинги и дефолтный период)
    if (!section.dataset.inited) {
        section.dataset.inited = '1';
        const applyBtn = document.getElementById('analyticsApplyBtn');
        const presetSel = document.getElementById('analyticsPeriodPreset');
        const fromInp = document.getElementById('analyticsFrom');
        const toInp   = document.getElementById('analyticsTo');

        const resetLoaded = () => {
            analyticsState.loaded = { overview: false, teachers: false, managers: false, admins: false, losses: false };
        };

        const applyPeriod = () => {
            const v = presetSel.value;
            analyticsState.preset = v;
            if (v === 'custom') {
                const f = fromInp.value ? new Date(fromInp.value) : null;
                const t = toInp.value ? new Date(toInp.value) : null;
                if (!f || !t || isNaN(f) || isNaN(t)) {
                    alert('Укажите обе даты диапазона');
                    return;
                }
                analyticsState.from = f;
                analyticsState.to = t;
            } else {
                const p = analyticsComputePeriod(v);
                analyticsState.from = p.from;
                analyticsState.to = p.to;
            }
            updateActivePeriodBadge();
            resetLoaded();
            loadAnalyticsTab(analyticsState.tab, true);
        };

        presetSel?.addEventListener('change', () => {
            const v = presetSel.value;
            const custom = v === 'custom';
            fromInp.style.display = custom ? '' : 'none';
            toInp.style.display   = custom ? '' : 'none';
            // Авто-применение для всех пресетов, кроме "свой диапазон"
            if (!custom) applyPeriod();
        });

        fromInp?.addEventListener('change', () => { if (presetSel.value === 'custom') applyPeriod(); });
        toInp?.addEventListener('change',   () => { if (presetSel.value === 'custom') applyPeriod(); });

        applyBtn?.addEventListener('click', applyPeriod);

        document.querySelectorAll('.analytics-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                const name = btn.dataset.analyticsTab;
                document.querySelectorAll('.analytics-tab').forEach(b => b.classList.toggle('is-active', b === btn));
                document.querySelectorAll('.analytics-pane').forEach(p => {
                    p.classList.toggle('hidden', p.id !== `analyticsPane-${name}`);
                });
                analyticsState.tab = name;
                loadAnalyticsTab(name, false);
            });
        });
    }

    // Первичный период по умолчанию
    if (!analyticsState.from || !analyticsState.to) {
        const p = analyticsComputePeriod(analyticsState.preset);
        analyticsState.from = p.from;
        analyticsState.to = p.to;
    }

    updateActivePeriodBadge();
    loadAnalyticsTab(analyticsState.tab, false);
}

function updateActivePeriodBadge() {
    const el = document.getElementById('analyticsActivePeriod');
    if (!el) return;
    if (!analyticsState.from || !analyticsState.to) { el.textContent = ''; return; }
    const fmt = (d) => {
        const dd = d instanceof Date ? d : new Date(d);
        return dd.toLocaleDateString('ru-RU');
    };
    el.textContent = `Активный период: ${fmt(analyticsState.from)} — ${fmt(analyticsState.to)}`;
}

async function loadAnalyticsTab(tab, force) {
    if (!tab) return;
    if (!force && analyticsState.loaded[tab]) return;
    const pane = document.getElementById(`analyticsPane-${tab}`);
    if (!pane) return;
    pane.innerHTML = '<div class="analytics-loading">Загрузка...</div>';
    try {
        if (tab === 'overview')   await renderAnalyticsOverview(pane);
        if (tab === 'teachers')   await renderAnalyticsTeachers(pane);
        if (tab === 'managers')   await renderAnalyticsManagers(pane);
        if (tab === 'admins')     await renderAnalyticsAdmins(pane);
        if (tab === 'losses')     await renderAnalyticsLosses(pane);
        analyticsState.loaded[tab] = true;
    } catch (err) {
        console.error('Analytics load error:', err);
        pane.innerHTML = `<div class="analytics-error">Не удалось загрузить данные: ${err.message || err}</div>`;
    }
}

function renderBreakdownList(obj, labelMap) {
    const entries = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return '<span class="analytics-sub">—</span>';
    return entries.slice(0, 3).map(([k, v]) => {
        const label = labelMap ? (labelMap[k] || k) : k;
        return `<div class="analytics-breakdown-item"><span>${escapeAnalyticsHtml(label)}</span><span class="analytics-sub">${v}</span></div>`;
    }).join('');
}

// ---------- Overview ----------
async function renderAnalyticsOverview(pane) {
    const data = await analyticsFetch('overview');
    if (!data || !data.success) throw new Error(data?.error || 'Нет данных');

    const t = data.totals || {};
    const p = data.period_metrics || {};
    const conv = p.trialToMembershipConversion || { total: 0, converted: 0, percent: 0 };

    const lifespanHint = p.avgLifespanCohort != null
        ? `Когорта ушедших за период: ${p.avgLifespanCohort}`
        : 'По ученикам, ушедшим в выбранный период';

    pane.innerHTML = `
        <div class="analytics-section-title">Текущее состояние (на сейчас)</div>
        <div class="analytics-grid">
            ${analyticsCard('Действующие ученики', t.activeStudents ?? 0, 'Активные + не потерянные, с non-trial абонементом')}
            ${analyticsCard('Пробные прямо сейчас', t.trialStudents ?? 0, 'Ученики на активном пробном абонементе')}
            ${analyticsCard('Постоянные', t.regularStudents ?? 0, 'С активным non-trial абонементом')}
            ${analyticsCard('Потерянные', t.lostStudents ?? 0, `Без занятий более ${data.lostThresholdMonths || 3} мес.`)}
        </div>

        <div class="analytics-section-title">За выбранный период</div>
        <div class="analytics-grid">
            ${analyticsCard('Новые пробные', p.newTrialsInPeriod ?? 0, 'Куплено пробных абонементов в периоде')}
            ${analyticsCard('Конверсия пробный → абонемент', analyticsFormatPercent(conv.percent), `${conv.converted} из ${conv.total} (когорта пробных периода)`)}
            ${analyticsCard('Средний чек', analyticsFormatMoney(p.avgCheck), 'По completed-платежам за абонемент в периоде')}
            ${analyticsCard('Средняя продолжительность', `${p.avgLifespanMonths || 0} мес`, lifespanHint)}
        </div>

        <div class="analytics-section-title">Потери за период</div>
        <div class="analytics-grid">
            ${analyticsChurnCard('После пробного', p.churnAfterTrial, 'Пробные в периоде, не купившие non-trial за 30 дней')}
            ${analyticsChurnCard('После 1-го месяца', p.churnAfterMonth1, 'Не продлили в 45 дней после окончания 1-го абонемента')}
            ${analyticsChurnCard('После 2-го месяца', p.churnAfterMonth2, 'Не продлили в 45 дней после окончания 2-го абонемента')}
        </div>
    `;
}

function analyticsCard(title, value, hint) {
    return `
        <div class="analytics-card">
            <div class="analytics-card-title">${escapeAnalyticsHtml(title)}</div>
            <div class="analytics-card-value">${escapeAnalyticsHtml(String(value))}</div>
            ${hint ? `<div class="analytics-card-hint">${escapeAnalyticsHtml(hint)}</div>` : ''}
        </div>
    `;
}

function analyticsChurnCard(title, obj, hint) {
    const o = obj || { count: 0, total: 0, percent: 0 };
    return `
        <div class="analytics-card">
            <div class="analytics-card-title">${escapeAnalyticsHtml(title)}</div>
            <div class="analytics-card-value">${analyticsFormatPercent(o.percent)}</div>
            <div class="analytics-card-hint">${o.count} из ${o.total}${hint ? ' · ' + escapeAnalyticsHtml(hint) : ''}</div>
        </div>
    `;
}

function escapeAnalyticsHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ---------- Teachers ----------
async function renderAnalyticsTeachers(pane) {
    const data = await analyticsFetch('teachers');
    if (!data || !data.success) throw new Error(data?.error || 'Нет данных');
    const rows = data.teachers || [];
    if (rows.length === 0) {
        pane.innerHTML = '<div class="analytics-empty">Нет данных по преподавателям</div>';
        return;
    }
    pane.innerHTML = `
        <div class="analytics-note">Учеников / Потерянных — на сейчас. Остальные метрики — за выбранный период.</div>
        <div class="table-wrapper">
            <table class="admin-table analytics-table">
                <thead>
                    <tr>
                        <th>Преподаватель</th>
                        <th>Учеников</th>
                        <th>Потерянных</th>
                        <th>Конверсия пробный → абонемент (период)</th>
                        <th>Средний чек (период)</th>
                        <th>LTV (период)</th>
                        <th>Ср. продолжительность (когорта ушедших)</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr class="analytics-row" data-student-id="${r.id}">
                            <td>
                                <span class="analytics-name-link" onclick="viewStudent('${r.id}')">${escapeAnalyticsHtml(r.name)}</span>
                            </td>
                            <td>${r.studentsCount}</td>
                            <td>${r.lostCount}</td>
                            <td>${analyticsFormatPercent(r.trialConversion?.percent || 0)} <span class="analytics-sub">(${r.trialConversion?.converted || 0}/${r.trialConversion?.total || 0})</span></td>
                            <td>${analyticsFormatMoney(r.avgCheck)}</td>
                            <td>${analyticsFormatMoney(r.avgLtv)}</td>
                            <td>${r.avgLifespanMonths || 0} мес <span class="analytics-sub">(${r.avgLifespanCohort || 0})</span></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// ---------- Managers ----------
async function renderAnalyticsManagers(pane) {
    const data = await analyticsFetch('managers');
    if (!data || !data.success) throw new Error(data?.error || 'Нет данных');
    const rows = data.managers || [];
    if (rows.length === 0) {
        pane.innerHTML = '<div class="analytics-empty">Нет данных по менеджерам</div>';
        return;
    }
    pane.innerHTML = `
        <div class="table-wrapper">
            <table class="admin-table analytics-table">
                <thead>
                    <tr>
                        <th>Менеджер</th>
                        <th>Заявок обработано</th>
                        <th>Пробных продано</th>
                        <th>Абонементов продано</th>
                        <th>Доходимость после пробного</th>
                        <th>Конверсия в абонемент</th>
                        <th title="Потеря клиентов после 1-го абонемента (не продлили в течение 45 дней). Атрибуция — по автору первого абонемента.">Отток после 1-го мес.</th>
                        <th title="Потеря клиентов после 2-го абонемента. Атрибуция — по автору второго абонемента.">Отток после 2-го мес.</th>
                        <th>Потеряно</th>
                        <th>Топ возражений</th>
                        <th>Этап потери</th>
                        <th>Возвращено</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr class="analytics-row">
                            <td>
                                <span class="analytics-name-link" onclick="viewStudent('${r.id}')">${escapeAnalyticsHtml(r.name)}</span>
                            </td>
                            <td>${r.bookingsProcessed}</td>
                            <td>${r.trialsSold}</td>
                            <td>${r.membershipsSold}</td>
                            <td>${analyticsFormatPercent(r.trialRetention?.percent || 0)} <span class="analytics-sub">(${r.trialRetention?.count || 0}/${r.trialRetention?.total || 0})</span></td>
                            <td>${analyticsFormatPercent(r.postTrialConversion?.percent || 0)} <span class="analytics-sub">(${r.postTrialConversion?.converted || 0}/${r.postTrialConversion?.total || 0})</span></td>
                            <td>${analyticsFormatPercent(r.churnMonth1?.percent || 0)} <span class="analytics-sub">(${r.churnMonth1?.churned || 0}/${r.churnMonth1?.total || 0})</span></td>
                            <td>${analyticsFormatPercent(r.churnMonth2?.percent || 0)} <span class="analytics-sub">(${r.churnMonth2?.churned || 0}/${r.churnMonth2?.total || 0})</span></td>
                            <td>${r.lostCount || 0}</td>
                            <td class="analytics-breakdown">${renderBreakdownList(r.lossReasons)}</td>
                            <td class="analytics-breakdown">${renderBreakdownList(r.lossStages, LOSS_STAGE_LABELS)}</td>
                            <td>${r.recoveredCount || 0}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// ---------- Admins ----------
async function renderAnalyticsAdmins(pane) {
    const data = await analyticsFetch('admins');
    if (!data || !data.success) throw new Error(data?.error || 'Нет данных');
    const rows = data.admins || [];
    if (rows.length === 0) {
        pane.innerHTML = '<div class="analytics-empty">Нет данных по администраторам</div>';
        return;
    }
    pane.innerHTML = `
        <div class="table-wrapper">
            <table class="admin-table analytics-table">
                <thead>
                    <tr>
                        <th>Администратор</th>
                        <th>Роль</th>
                        <th>Пробных отработано</th>
                        <th>Абонементов продано</th>
                        <th>Продлений</th>
                        <th>Отток новых</th>
                        <th>Отток существующих</th>
                        <th title="Потеря клиентов после 1-го абонемента (не продлили в течение 45 дней).">Отток после 1-го мес.</th>
                        <th title="Потеря клиентов после 2-го абонемента.">Отток после 2-го мес.</th>
                        <th>Топ возражений</th>
                        <th>Этап потери</th>
                        <th>Возвращено</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr class="analytics-row">
                            <td>
                                <span class="analytics-name-link" onclick="viewStudent('${r.id}')">${escapeAnalyticsHtml(r.name)}</span>
                            </td>
                            <td>${r.role}</td>
                            <td>${r.trialsHandled}</td>
                            <td>${r.membershipsSold}</td>
                            <td>${r.renewals}</td>
                            <td>${analyticsFormatPercent(r.churnNewClients?.percent || 0)} <span class="analytics-sub">(${r.churnNewClients?.count || 0}/${r.churnNewClients?.total || 0})</span></td>
                            <td>${analyticsFormatPercent(r.churnExistingClients?.percent || 0)} <span class="analytics-sub">(${r.churnExistingClients?.count || 0}/${r.churnExistingClients?.total || 0})</span></td>
                            <td>${analyticsFormatPercent(r.churnMonth1?.percent || 0)} <span class="analytics-sub">(${r.churnMonth1?.churned || 0}/${r.churnMonth1?.total || 0})</span></td>
                            <td>${analyticsFormatPercent(r.churnMonth2?.percent || 0)} <span class="analytics-sub">(${r.churnMonth2?.churned || 0}/${r.churnMonth2?.total || 0})</span></td>
                            <td class="analytics-breakdown">${renderBreakdownList(r.lossReasons)}</td>
                            <td class="analytics-breakdown">${renderBreakdownList(r.lossStages, LOSS_STAGE_LABELS)}</td>
                            <td>${r.recoveredCount || 0}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// ---------- Losses / Recoveries ----------
async function renderAnalyticsLosses(pane) {
    const data = await analyticsFetch('losses');
    if (!data || !data.success) throw new Error(data?.error || 'Нет данных');

    const totals = data.totals || {};
    const byReason = data.byReason || {};
    const byStage  = data.byStage || {};
    const byUser   = data.recoveriesByUser || [];
    const recent   = data.recentRecoveries || [];

    const reasonsList = Object.entries(byReason).sort((a, b) => b[1] - a[1]);
    const stagesList  = Object.entries(byStage).sort((a, b) => b[1] - a[1]);

    pane.innerHTML = `
        <div class="analytics-section-title">Сводка за период</div>
        <div class="analytics-grid">
            ${analyticsCard('Всего потеряно', totals.lostCount || 0, 'Заявки в rejected / с зафиксированной потерей')}
            ${analyticsCard('Возвращено потеряшек', totals.recoveredCount || 0, 'Зафиксировано через действие «Вернуть»')}
        </div>

        <div class="analytics-section-title">Топ возражений</div>
        ${reasonsList.length === 0 ? '<div class="analytics-empty">Причины потерь пока не фиксировались</div>' : `
            <div class="analytics-bar-list">
                ${renderAnalyticsBars(reasonsList)}
            </div>
        `}

        <div class="analytics-section-title">Где теряем (этапы)</div>
        ${stagesList.length === 0 ? '<div class="analytics-empty">Нет данных по этапам</div>' : `
            <div class="analytics-bar-list">
                ${renderAnalyticsBars(stagesList, LOSS_STAGE_LABELS)}
            </div>
        `}

        <div class="analytics-section-title">Кто возвращал потеряшек</div>
        ${byUser.length === 0 ? '<div class="analytics-empty">Возвратов за период не зарегистрировано</div>' : `
            <div class="table-wrapper">
                <table class="admin-table analytics-table">
                    <thead>
                        <tr><th>Пользователь</th><th>Роль</th><th>Возвратов</th></tr>
                    </thead>
                    <tbody>
                        ${byUser.map(u => `
                            <tr>
                                <td><span class="analytics-name-link" onclick="viewStudent('${u.userId}')">${escapeAnalyticsHtml(u.name)}</span></td>
                                <td>${escapeAnalyticsHtml(u.role || '—')}</td>
                                <td>${u.count}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `}

        ${recent.length === 0 ? '' : `
            <div class="analytics-section-title">Последние возвраты</div>
            <div class="table-wrapper">
                <table class="admin-table analytics-table">
                    <thead>
                        <tr><th>Дата</th><th>Ученик</th><th>Телефон</th><th>Кем возвращён</th><th>Комментарий</th></tr>
                    </thead>
                    <tbody>
                        ${recent.map(r => `
                            <tr>
                                <td>${analyticsFmtDate(r.recoveredAt)}</td>
                                <td><span class="analytics-name-link" onclick="viewStudent('${r.studentId}')">${escapeAnalyticsHtml(r.studentName)}</span></td>
                                <td>${escapeAnalyticsHtml(r.phone || '—')}</td>
                                <td>${escapeAnalyticsHtml(r.recoveredByName)}</td>
                                <td>${escapeAnalyticsHtml(r.note || '—')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `}
    `;
}

function renderAnalyticsBars(entries, labelMap) {
    const max = Math.max(...entries.map(e => e[1]), 1);
    return entries.map(([k, v]) => {
        const label = labelMap ? (labelMap[k] || k) : k;
        const pct = Math.round((v / max) * 100);
        return `
            <div class="analytics-bar">
                <div class="analytics-bar-header">
                    <span>${escapeAnalyticsHtml(label)}</span>
                    <span class="analytics-sub">${v}</span>
                </div>
                <div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${pct}%"></div></div>
            </div>
        `;
    }).join('');
}
