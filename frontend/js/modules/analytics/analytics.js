// =====================================================
// Аналитика (admin / super_admin)
// =====================================================

let analyticsState = {
    preset: 'thisMonth',
    from: null,
    to: null,
    tab: 'overview',
    loaded: { overview: false, teachers: false, managers: false, admins: false, losses: false, teacherRevenue: false, utilization: false },
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
    const token = getAuthToken();
    if (!token) {
        window.location.href = '/login.html';
        throw new Error('Нужно войти в систему заново');
    }
    const resp = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (resp.status === 401) {
        // Сессия истекла — очищаем данные и перенаправляем на логин
        localStorage.removeItem('token');
        localStorage.removeItem('authToken');
        localStorage.removeItem('isLoggedIn');
        localStorage.removeItem('userId');
        localStorage.removeItem('userName');
        localStorage.removeItem('userRole');
        localStorage.removeItem('userPhone');
        const message = 'Ваша сессия истекла. Пожалуйста, войдите в систему заново.';
        if (typeof toast !== 'undefined' && toast.warning) {
            toast.warning(message, 4000);
        } else {
            alert(message);
        }
        setTimeout(() => { window.location.href = '/login.html'; }, 1500);
        throw new Error('Сессия истекла');
    }
    if (!resp.ok) {
        await resp.text().catch(() => '');
        throw new Error('Не удалось получить данные. Обновите страницу и попробуйте снова.');
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
            analyticsState.loaded = { overview: false, teachers: false, managers: false, admins: false, losses: false, teacherRevenue: false, utilization: false };
        };

        const applyPeriod = () => {
            const v = presetSel.value;
            analyticsState.preset = v;
            if (v === 'custom') {
                const f = fromInp.value ? new Date(`${fromInp.value}T00:00:00`) : null;
                const t = toInp.value ? new Date(`${toInp.value}T23:59:59.999`) : null;
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
        if (tab === 'teacherRevenue') await renderAnalyticsTeacherRevenue(pane);
        if (tab === 'utilization') await renderAnalyticsUtilization(pane);
        analyticsState.loaded[tab] = true;
    } catch (err) {
        console.error('Analytics load error:', err);
        pane.innerHTML = '<div class="analytics-error">Не удалось загрузить данные. Обновите страницу и попробуйте снова.</div>';
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

const ANALYTICS_CHART_COLORS = ['#74b7f2', '#e6b85c', '#7edc74', '#e87979', '#a78bfa', '#57c7c2'];

function analyticsCompactNumber(value) {
    const number = Number(value) || 0;
    if (Math.abs(number) >= 1000000) return `${Math.round(number / 100000) / 10}м`;
    if (Math.abs(number) >= 1000) return `${Math.round(number / 100) / 10}к`;
    return String(Math.round(number));
}

function analyticsChartLabel(value) {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())
        ? String(value)
        : date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

function analyticsLineChart(title, labels, series, options = {}) {
    const width = 760;
    const height = 260;
    const pad = { left: 54, right: 18, top: 20, bottom: 42 };
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const allValues = series.flatMap(item => item.values || []);
    const maximum = Math.max(1, ...allValues.map(value => Number(value) || 0));
    const x = index => pad.left + (labels.length <= 1 ? plotWidth / 2 : index * plotWidth / (labels.length - 1));
    const y = value => pad.top + plotHeight - ((Number(value) || 0) / maximum) * plotHeight;
    const labelStep = Math.max(1, Math.ceil(labels.length / 10));

    const grid = [0, .25, .5, .75, 1].map(ratio => {
        const yy = pad.top + plotHeight - plotHeight * ratio;
        return `
            <line x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}" class="analytics-svg-grid"/>
            <text x="${pad.left - 8}" y="${yy + 4}" text-anchor="end" class="analytics-svg-label">${analyticsCompactNumber(maximum * ratio)}</text>
        `;
    }).join('');
    const paths = series.map((item, seriesIndex) => {
        const color = item.color || ANALYTICS_CHART_COLORS[seriesIndex % ANALYTICS_CHART_COLORS.length];
        const points = (item.values || []).map((value, index) => `${x(index)},${y(value)}`).join(' ');
        const dots = (item.values || []).map((value, index) =>
            `<circle cx="${x(index)}" cy="${y(value)}" r="3" fill="${color}"><title>${escapeAnalyticsHtml(item.name)}: ${options.money ? analyticsFormatMoney(value) : value}</title></circle>`
        ).join('');
        return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
    }).join('');
    const xLabels = labels.map((label, index) => (
        index % labelStep === 0 || index === labels.length - 1
            ? `<text x="${x(index)}" y="${height - 14}" text-anchor="middle" class="analytics-svg-label">${analyticsChartLabel(label)}</text>`
            : ''
    )).join('');

    return analyticsChartCard(title, `
        <div class="analytics-chart-scroll">
            <svg class="analytics-svg-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAnalyticsHtml(title)}">
                ${grid}${paths}${xLabels}
            </svg>
        </div>
        ${analyticsChartLegend(series)}
    `);
}

function analyticsBarChart(title, labels, series, options = {}) {
    const width = 760;
    const height = 260;
    const pad = { left: 54, right: 18, top: 20, bottom: 42 };
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const maximum = Math.max(1, ...series.flatMap(item => item.values || []).map(value => Number(value) || 0));
    const groupWidth = plotWidth / Math.max(labels.length, 1);
    const barWidth = Math.max(2, Math.min(18, groupWidth / Math.max(series.length + 1, 2)));
    const labelStep = Math.max(1, Math.ceil(labels.length / 10));

    const grid = [0, .25, .5, .75, 1].map(ratio => {
        const yy = pad.top + plotHeight - plotHeight * ratio;
        return `<line x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}" class="analytics-svg-grid"/>
            <text x="${pad.left - 8}" y="${yy + 4}" text-anchor="end" class="analytics-svg-label">${analyticsCompactNumber(maximum * ratio)}</text>`;
    }).join('');
    const bars = labels.map((label, index) => {
        const center = pad.left + groupWidth * index + groupWidth / 2;
        return series.map((item, seriesIndex) => {
            const value = Number(item.values?.[index]) || 0;
            const barHeight = value / maximum * plotHeight;
            const xx = center + (seriesIndex - (series.length - 1) / 2) * barWidth - barWidth * .42;
            const color = item.color || ANALYTICS_CHART_COLORS[seriesIndex % ANALYTICS_CHART_COLORS.length];
            return `<rect x="${xx}" y="${pad.top + plotHeight - barHeight}" width="${barWidth * .84}" height="${barHeight}" rx="2" fill="${color}">
                <title>${escapeAnalyticsHtml(item.name)}: ${options.money ? analyticsFormatMoney(value) : value}</title>
            </rect>`;
        }).join('');
    }).join('');
    const xLabels = labels.map((label, index) => (
        index % labelStep === 0 || index === labels.length - 1
            ? `<text x="${pad.left + groupWidth * index + groupWidth / 2}" y="${height - 14}" text-anchor="middle" class="analytics-svg-label">${analyticsChartLabel(label)}</text>`
            : ''
    )).join('');

    return analyticsChartCard(title, `
        <div class="analytics-chart-scroll">
            <svg class="analytics-svg-chart" viewBox="0 0 ${width} ${height}">${grid}${bars}${xLabels}</svg>
        </div>
        ${analyticsChartLegend(series)}
    `);
}

function analyticsChartLegend(series) {
    return `<div class="analytics-chart-legend">${series.map((item, index) => `
        <span><i style="background:${item.color || ANALYTICS_CHART_COLORS[index % ANALYTICS_CHART_COLORS.length]}"></i>${escapeAnalyticsHtml(item.name)}</span>
    `).join('')}</div>`;
}

function analyticsChartCard(title, content, extraClass = '') {
    return `<article class="analytics-chart-card ${extraClass}">
        <h3>${escapeAnalyticsHtml(title)}</h3>
        ${content}
    </article>`;
}

function analyticsDonutChart(title, rows) {
    const nonEmpty = (rows || []).filter(item => Number(item.value) > 0);
    const total = nonEmpty.reduce((sum, item) => sum + Number(item.value || 0), 0);
    if (!total) {
        return analyticsChartCard(title, '<div class="analytics-empty">Нет заявок за выбранный период</div>');
    }
    let cursor = 0;
    const segments = nonEmpty.map((item, index) => {
        const start = cursor;
        cursor += Number(item.value) / total * 100;
        return `${ANALYTICS_CHART_COLORS[index % ANALYTICS_CHART_COLORS.length]} ${start}% ${cursor}%`;
    });
    return analyticsChartCard(title, `
        <div class="analytics-donut-layout">
            <div class="analytics-donut" style="background:conic-gradient(${segments.join(',')})">
                <div><strong>${total}</strong><span>заявок</span></div>
            </div>
            <div class="analytics-donut-legend">
                ${nonEmpty.map((item, index) => `<div>
                    <i style="background:${ANALYTICS_CHART_COLORS[index % ANALYTICS_CHART_COLORS.length]}"></i>
                    <span>${escapeAnalyticsHtml(item.label)}</span>
                    <strong>${item.value}</strong>
                </div>`).join('')}
            </div>
        </div>
    `);
}

function analyticsManagersChart(rows) {
    if (!rows?.length) {
        return analyticsChartCard('Эффективность менеджеров', '<div class="analytics-empty">Нет данных по менеджерам</div>', 'analytics-chart-card--wide');
    }
    const maximum = Math.max(1, ...rows.flatMap(item => [item.processed, item.paid]));
    return analyticsChartCard('Эффективность менеджеров', `
        <div class="analytics-manager-bars">
            ${rows.map(item => `
                <div class="analytics-manager-row">
                    <div class="analytics-manager-name"><strong>${escapeAnalyticsHtml(item.name)}</strong><span>${item.conversionPercent}% в оплату</span></div>
                    <div class="analytics-manager-track">
                        <div class="analytics-manager-bar is-processed" style="width:${item.processed / maximum * 100}%"><span>${item.processed}</span></div>
                        <div class="analytics-manager-bar is-paid" style="width:${item.paid / maximum * 100}%"><span>${item.paid}</span></div>
                    </div>
                </div>
            `).join('')}
        </div>
        ${analyticsChartLegend([
            { name: 'Обработано', color: '#74b7f2' },
            { name: 'Оплачено', color: '#7edc74' },
        ])}
    `, 'analytics-chart-card--wide');
}

function renderOperationsDashboard(data) {
    const labels = data.labels || [];
    return `
        <div class="analytics-section-title">Операционный дашборд</div>
        <div class="analytics-charts-grid">
            ${analyticsLineChart('Финансы', labels, [
                { name: 'Поступления', values: data.finance?.income || [], color: '#74b7f2' },
                { name: 'Чистый поток', values: data.finance?.net || [], color: '#e6b85c' },
            ], { money: true })}
            ${analyticsLineChart('Проведённые уроки', labels, [
                { name: 'Индивидуальные', values: data.lessons?.individual || [], color: '#d7d7dc' },
                { name: 'Групповые', values: data.lessons?.group || [], color: '#f0a15a' },
                { name: 'Теория', values: data.lessons?.theory || [], color: '#74b7f2' },
                { name: 'Пробные', values: data.lessons?.trial || [], color: '#7edc74' },
            ])}
            ${analyticsBarChart('Доходы vs реализация', labels, [
                { name: 'Доходы', values: data.revenueVsRealization?.income || [], color: '#74b7f2' },
                { name: 'Реализация уроков', values: data.revenueVsRealization?.realization || [], color: '#d7d7dc' },
            ], { money: true })}
            ${analyticsDonutChart('Состояние воронки продаж', data.funnel)}
            ${analyticsManagersChart(data.managers)}
        </div>
    `;
}

// ---------- Overview ----------
async function renderAnalyticsOverview(pane) {
    const [data, operations] = await Promise.all([
        analyticsFetch('overview'),
        analyticsFetch('operations-dashboard'),
    ]);
    if (!data || !data.success) throw new Error(data?.error || 'Нет данных');
    if (!operations || !operations.success) throw new Error(operations?.error || 'Нет данных для графиков');

    const t = data.totals || {};
    const p = data.period_metrics || {};
    const conv = p.trialToMembershipConversion || { total: 0, converted: 0, percent: 0 };
    const funnel = p.trialFunnel || { trials: 0, attended: 0, converted: 0, closed: 0, lostAfterTrial: 0, awaitingDecision: 0 };

    const lifespanHint = p.avgLifespanCohort != null
        ? `Когорта ушедших за период: ${p.avgLifespanCohort}`
        : 'По ученикам, ушедшим в выбранный период';

    pane.innerHTML = `
        <div class="analytics-note">
            Метрики разделены на «состояние сейчас» и когорты выбранного периода. Незавершённые окна решения не считаются потерями.
        </div>
        ${renderOperationsDashboard(operations)}
        <div class="analytics-section-title">Текущее состояние (на сейчас)</div>
        <div class="analytics-grid">
            ${analyticsCard('Действующие ученики', t.activeStudents ?? 0, 'Уникальные ученики с активным пробным или обычным абонементом')}
            ${analyticsCard('Пробные прямо сейчас', t.trialStudents ?? 0, 'Открытые заявки на пробный урок')}
            ${analyticsCard('Постоянные', t.regularStudents ?? 0, 'То же ядро: активные non-trial абонементы')}
            ${analyticsCard('Потерянные', t.lostStudents ?? 0, `Без оплат более ${data.lostThresholdMonths || 3} мес.`)}
        </div>

        <div class="analytics-section-title">За выбранный период</div>
        <div class="analytics-grid">
            ${analyticsCard('Новые пробные', p.newTrialsInPeriod ?? 0, 'Куплено пробных абонементов в периоде')}
            ${analyticsCard('Конверсия пробный → оплата', analyticsFormatPercent(conv.percent), `${conv.converted} из ${conv.total} (деньги поступили на баланс)`)}
            ${analyticsCard('Средний чек', analyticsFormatMoney(p.avgCheck), 'По completed-платежам за абонемент в периоде')}
            ${analyticsCard('Средняя продолжительность', `${p.avgLifespanMonths || 0} мес`, lifespanHint)}
        </div>

        <div class="analytics-section-title">Воронка пробного</div>
        ${analyticsFunnel(funnel)}

        <div class="analytics-section-title">Потери за период</div>
        <div class="analytics-grid">
            ${analyticsChurnCard('После пробного', p.churnAfterTrial, 'Только завершившие 14-дневное окно или явно отклонённые после пробного')}
            ${analyticsChurnCard('После 1-го месяца', p.churnAfterMonth1, 'Не продлили в 45 дней после окончания 1-го абонемента')}
            ${analyticsChurnCard('После 2-го месяца', p.churnAfterMonth2, 'Не продлили в 45 дней после окончания 2-го абонемента')}
        </div>

        <div class="analytics-section-title">Упущенная прибыль (из-за экстренных заморозок)</div>
        <div class="analytics-grid">
            ${analyticsCard('Всего заморозок', p.frozenClassesCount ?? 0, 'Количество занятий, отмененных по экстренной заморозке')}
            ${analyticsCard('Выплачено преподавателям', analyticsFormatMoney(p.frozenClassesTeacherPayouts ?? 0), 'Зарплата преподавателям за замороженные занятия')}
            ${analyticsCard('Упущенная выручка', analyticsFormatMoney(p.frozenClassesLostRevenue ?? 0), 'Стоимость занятий, которые не были проведены')}
            ${analyticsCard('Общий убыток школы', analyticsFormatMoney(p.frozenClassesLostProfit ?? 0), 'Сумма выплаченной ЗП и упущенной стоимости занятий')}
        </div>
    `;
}

function analyticsFunnel(funnel) {
    const steps = [
        ['Пробные', funnel.trials || 0],
        ['Посетили', funnel.attended || 0],
        ['Закрыты оплатой', (funnel.closed ?? funnel.converted) || 0],
        ['Потеряны после пробного', funnel.lostAfterTrial || 0],
        ['Ждём решения', funnel.awaitingDecision || 0],
    ];
    const max = Math.max(...steps.map(([, value]) => value), 1);
    return `
        <div class="analytics-funnel">
            ${steps.map(([label, value], index) => `
                <div class="analytics-funnel-step">
                    <div class="analytics-funnel-head">
                        <span>${escapeAnalyticsHtml(label)}</span>
                        <strong>${value}</strong>
                    </div>
                    <div class="analytics-funnel-track">
                        <div class="analytics-funnel-fill analytics-funnel-fill-${index}" style="width:${Math.max(value ? 8 : 0, Math.round(value / max * 100))}%"></div>
                    </div>
                </div>
            `).join('')}
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
    const awaiting = Number(o.awaiting || 0);
    return `
        <div class="analytics-card">
            <div class="analytics-card-title">${escapeAnalyticsHtml(title)}</div>
            <div class="analytics-card-value">${analyticsFormatPercent(o.percent)}</div>
            <div class="analytics-card-hint">${o.count} из ${o.total}${hint ? ' · ' + escapeAnalyticsHtml(hint) : ''}</div>
            ${awaiting ? `<div class="analytics-card-meta">Ещё ожидают решения: ${awaiting}</div>` : ''}
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
                        <th>Средний чек(период)</th>
                        <th>LTV(период)</th>
                        <th>Ср. продолжительность(когорта ушедших)</th>
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
                        <th>После пробного закрыто</th>
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
                            <td>${analyticsFormatPercent(r.postTrialConversion?.percent || 0)} <span class="analytics-sub">(${(r.postTrialConversion?.closed ?? r.postTrialConversion?.converted) || 0}/${r.postTrialConversion?.total || 0})</span></td>
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
    const recentLosses = data.recentLosses || [];

    const reasonsList = Object.entries(byReason).sort((a, b) => b[1] - a[1]);
    const stagesList  = Object.entries(byStage).sort((a, b) => b[1] - a[1]);

    pane.innerHTML = `
        <div class="analytics-section-title">Сводка за период</div>
        <div class="analytics-grid">
            ${analyticsCard('Всего потеряно', totals.lostCount || 0, 'Заявки в rejected / с зафиксированной потерей')}
            ${analyticsCard('После пробного', totals.afterTrialLostCount || 0, 'Явно зафиксированный этап потери')}
            ${analyticsCard('Возвращено потеряшек', totals.recoveredCount || 0, 'Зафиксировано через действие «Вернуть»')}
        </div>

        <div class="analytics-section-title">Последние потерянные заявки</div>
        ${recentLosses.length === 0 ? '<div class="analytics-empty">Потерь за период не зарегистрировано</div>' : `
            <div class="table-wrapper">
                <table class="admin-table analytics-table">
                    <thead>
                        <tr><th>Дата</th><th>Клиент</th><th>Телефон</th><th>Этап</th><th>Причина</th><th>Ответственный</th></tr>
                    </thead>
                    <tbody>
                        ${recentLosses.map(item => `
                            <tr>
                                <td>${analyticsFmtDate(item.lostAt)}</td>
                                <td>${escapeAnalyticsHtml(item.name)}</td>
                                <td>${escapeAnalyticsHtml(item.phone || '—')}</td>
                                <td><span class="analytics-stage-badge">${escapeAnalyticsHtml(LOSS_STAGE_LABELS[item.stage] || item.stage)}</span></td>
                                <td>${escapeAnalyticsHtml(item.reason)}</td>
                                <td>${escapeAnalyticsHtml(item.processedByName)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `}

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

// ---------- Teacher Revenue ----------
async function renderAnalyticsTeacherRevenue(pane) {
    const data = await analyticsFetch('teacher-revenue');
    if (!data || !data.success) throw new Error(data?.error || 'Нет данных');
    const rows = data.teachers || [];
    const grandTotal = data.grandTotal || 0;

    if (rows.length === 0) {
        pane.innerHTML = '<div class="analytics-empty">Нет данных по доходам тренеров за период</div>';
        return;
    }

    pane.innerHTML = `
        <div class="analytics-section-title">Доход по тренерам за период</div>
        <div class="analytics-note">Расчёт: стоимость абонемента / кол-во занятий в абонементе × кол-во проведённых занятий по каждому ученику.</div>
        <div class="analytics-grid">
            ${analyticsCard('Общий доход', analyticsFormatMoney(grandTotal), 'Сумма по всем тренерам за период')}
            ${analyticsCard('Тренеров', rows.length, 'С проведёнными занятиями за период')}
        </div>

        <div class="table-wrapper">
            <table class="admin-table analytics-table">
                <thead>
                    <tr>
                        <th>Тренер</th>
                        <th>Занятий проведено</th>
                        <th>Учеников</th>
                        <th>Доход</th>
                        <th>Детали</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr class="analytics-row">
                            <td>${escapeAnalyticsHtml(r.name)}</td>
                            <td>${r.totalClasses}</td>
                            <td>${r.studentsCount}</td>
                            <td><strong>${analyticsFormatMoney(r.totalRevenue)}</strong></td>
                            <td>
                                <button class="admin-btn btn-secondary" style="font-size: 0.8em; padding: 4px 10px;"
                                    onclick="toggleTeacherRevenueDetails('${r.id}')">Показать</button>
                            </td>
                        </tr>
                        <tr class="analytics-details-row" id="teacherRevenueDetails-${r.id}" style="display: none;">
                            <td colspan="5">
                                <div class="analytics-details-inner">
                                    <table class="admin-table" style="margin: 0; font-size: 0.9em;">
                                        <thead>
                                            <tr>
                                                <th>Ученик</th>
                                                <th>Занятий</th>
                                                <th>Доход</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${(r.students || []).map(s => `
                                                <tr>
                                                    <td>${escapeAnalyticsHtml(s.name)}</td>
                                                    <td>${s.classCount}</td>
                                                    <td>${analyticsFormatMoney(s.revenue)}</td>
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function toggleTeacherRevenueDetails(teacherId) {
    const row = document.getElementById(`teacherRevenueDetails-${teacherId}`);
    if (!row) return;
    const isHidden = row.style.display === 'none';
    row.style.display = isHidden ? '' : 'none';
    // Обновим текст кнопки
    const btn = row.previousElementSibling?.querySelector('button');
    if (btn) btn.textContent = isHidden ? 'Скрыть' : 'Показать';
}

async function renderAnalyticsUtilization(pane) {
    const data = await analyticsFetch('utilization');
    const teachers = data.teachers || [];
    const rooms = data.rooms || [];
    const utilizationBar = (value) => `
        <div class="utilization-progress">
            <div class="utilization-progress__fill" style="width:${Math.min(100, Math.max(0, value || 0))}%"></div>
        </div>
    `;

    pane.innerHTML = `
        <div class="analytics-section-title">Загруженность преподавателей</div>
        <div class="analytics-note">Плановые часы считаются по расписанию без отменённых уроков. Норма пересчитывается на выбранный период.</div>
        ${teachers.length ? `
            <div class="table-wrapper">
                <table class="admin-table analytics-table utilization-table">
                    <thead><tr>
                        <th>Преподаватель</th>
                        <th>Норма</th>
                        <th>Запланировано</th>
                        <th>Проведено</th>
                        <th>Отменено</th>
                        <th>Загрузка</th>
                    </tr></thead>
                    <tbody>
                        ${teachers.map(row => `
                            <tr>
                                <td>
                                    <button class="analytics-entity-link" onclick="openUserModal('${row.id}')">
                                        <span class="teacher-color-dot" style="background:${escapeAnalyticsHtml(row.color || '#6B7280')}"></span>
                                        ${escapeAnalyticsHtml(row.name)}
                                    </button>
                                </td>
                                <td>${row.weeklyNormHours} ч/нед <span class="analytics-sub">(${row.periodNormHours} ч за период)</span></td>
                                <td>${row.scheduledHours} ч</td>
                                <td>${row.completedHours} ч</td>
                                <td>${row.cancelledHours} ч</td>
                                <td><strong>${row.utilizationPercent}%</strong>${utilizationBar(row.utilizationPercent)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        ` : '<div class="analytics-empty">Нет преподавателей для расчёта</div>'}

        <div class="analytics-section-title">Загруженность кабинетов</div>
        <div class="analytics-note">Доступное время рассчитывается по рабочему диапазону каждого кабинета.</div>
        ${rooms.length ? `
            <div class="table-wrapper">
                <table class="admin-table analytics-table utilization-table">
                    <thead><tr>
                        <th>Кабинет</th>
                        <th>Рабочее время</th>
                        <th>Доступно</th>
                        <th>Занято</th>
                        <th>Свободно</th>
                        <th>Загрузка</th>
                    </tr></thead>
                    <tbody>
                        ${rooms.map(row => `
                            <tr>
                                <td><button class="analytics-entity-link" onclick="openScheduleForRoom('${row.id}')">${escapeAnalyticsHtml(row.name)}</button></td>
                                <td>${row.workingStart}–${row.workingEnd}</td>
                                <td>${row.availableHours} ч</td>
                                <td>${row.occupiedHours} ч</td>
                                <td>${row.freeHours} ч</td>
                                <td><strong>${row.utilizationPercent}%</strong>${utilizationBar(row.utilizationPercent)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        ` : '<div class="analytics-empty">Нет кабинетов для расчёта</div>'}
    `;
}
