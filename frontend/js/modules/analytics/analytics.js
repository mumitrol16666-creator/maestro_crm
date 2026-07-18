// =====================================================
// Аналитика (admin / super_admin)
// =====================================================

let analyticsState = {
    preset: 'thisMonth',
    from: null,
    to: null,
    tab: 'overview',
    loaded: { overview: false, teachers: false, managers: false, admins: false, losses: false, marketing: false, utilization: false },
};

const ANALYTICS_TABS = ['overview', 'teachers', 'managers', 'admins', 'losses', 'marketing', 'utilization'];

const ANALYTICS_FULL_REPORT_PROMPT = [
    'Роль: Ты — опытный финансовый аналитик и бизнес-консультант в сфере EdTech (музыкальные школы).',
    'Задача: Проанализируй входящий массив данных за текущий день, неделю и месяц, сопоставь их с историческими периодами.',
    'Никакой воды: не используй пустые мотивирующие фразы вроде "Давайте поднажмем", "Нужно больше стараться" или "Отличный результат".',
    'Глубокий контекст: сравни конверсию из пробного в оплату, средний чек, загрузку преподавателей и динамику месяц к месяцу/год к году.',
    'Фокус на аномалиях: подсвети просадки и резкие взлеты с возможными причинами, если они следуют из цифр.',
    'Прогноз и рекомендации: дай конкретные рекомендации по направлениям, кабинетам, преподавателям, дням недели и дожиму оплат.'
].join('\n');

const LOSS_STAGE_LABELS = {
    before_trial: 'До пробного',
    on_trial: 'На пробном',
    after_trial: 'После пробного',
    during_training: 'Во время обучения',
    after_month1: 'После 1-го месяца',
    after_month2: 'После 2-го месяца',
    '—': 'Не указано',
};

const ANALYTICS_BOOKING_STATUS_LABELS = {
    new: 'Новая',
    processed: 'В работе',
    trial: 'Пробный назначен',
    thinking: 'Провели пробный / Думают',
    sold: 'Оплачено',
    rejected: 'Потеряна',
};

function analyticsFormatMoney(n) {
    const v = Math.round(Number(n) || 0);
    return v.toLocaleString('ru-RU').replace(/\u00a0/g, ' ') + ' ₸';
}

function analyticsFormatPercent(n) {
    return `${Math.round(Number(n) || 0)}%`;
}

function analyticsFormatNumber(n) {
    return Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/\u00a0/g, ' ');
}

function analyticsClampPercent(n) {
    return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}

function analyticsMonthLabel(monthKey) {
    const [year, month] = String(monthKey || '').split('-').map(Number);
    const date = new Date(year || new Date().getFullYear(), (month || 1) - 1, 1);
    return date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

function analyticsPlanMonthKey() {
    const anchor = analyticsState.to || analyticsState.from || new Date();
    const date = anchor instanceof Date ? anchor : new Date(anchor);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

function analyticsMetricTrend(actual, projected, plan, money = false) {
    if (!plan) return 'План ещё не задан';
    const delta = Math.round((Number(projected) || 0) - (Number(plan) || 0));
    if (delta === 0) return 'Идём ровно в план';
    const value = money ? analyticsFormatMoney(Math.abs(delta)) : analyticsFormatNumber(Math.abs(delta));
    return delta > 0 ? `Прогноз выше плана на ${value}` : `Прогноз ниже плана на ${value}`;
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

async function analyticsFetch(path, extraParams = {}) {
    return analyticsFetchForPeriod(path, analyticsState.from, analyticsState.to, extraParams);
}

async function analyticsFetchForPeriod(path, from, to, extraParams = {}) {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from.toISOString());
    if (to)   qs.set('to',   to.toISOString());
    Object.entries(extraParams || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') qs.set(key, value);
    });
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
        const sendDailyReportBtn = document.getElementById('analyticsSendDailyReportBtn');
        const downloadMonthlyReportBtn = document.getElementById('analyticsDownloadMonthlyReportBtn');
        const downloadFullReportBtn = document.getElementById('analyticsDownloadFullReportBtn');

        const resetLoaded = () => {
            analyticsState.loaded = Object.fromEntries(ANALYTICS_TABS.map(tab => [tab, false]));
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
        sendDailyReportBtn?.addEventListener('click', sendAnalyticsDailyReport);
        downloadMonthlyReportBtn?.addEventListener('click', downloadAnalyticsMonthlyReport);
        downloadFullReportBtn?.addEventListener('click', downloadAnalyticsFullReport);

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

        analyticsInitChartTooltip(section);
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

async function sendAnalyticsDailyReport() {
    const button = document.getElementById('analyticsSendDailyReportBtn');
    const originalText = button?.textContent || 'Отправить ежедневный отчет';
    if (button?.disabled) return;

    if (button) {
        button.disabled = true;
        button.classList.add('is-sending');
        button.textContent = 'Отправляем...';
    }

    try {
        const token = getAuthToken();
        if (!token) {
            window.location.href = '/login.html';
            throw new Error('Нужно войти в систему заново');
        }

        const response = await fetch(`${API_URL}/analytics/daily-report/send`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ source: 'analytics' }),
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Не удалось отправить ежедневный отчёт');
        }

        const dateText = data.date ? ` за ${data.date}` : '';
        if (typeof toast !== 'undefined' && toast.success) {
            toast.success(`Ежедневный отчёт${dateText} отправлен в Telegram`);
        } else {
            alert(`Ежедневный отчёт${dateText} отправлен в Telegram`);
        }
    } catch (error) {
        console.error('Send daily analytics report error:', error);
        if (typeof toast !== 'undefined' && toast.error) {
            toast.error(error.message || 'Не удалось отправить ежедневный отчёт');
        } else {
            alert(error.message || 'Не удалось отправить ежедневный отчёт');
        }
    } finally {
        if (button) {
            button.disabled = false;
            button.classList.remove('is-sending');
            button.textContent = originalText.trim();
        }
    }
}

function analyticsEnsureExcel() {
    if (typeof XLSX !== 'undefined') return true;
    alert('Модуль Excel еще не загрузился');
    return false;
}

function analyticsActivePeriod() {
    if (!analyticsState.from || !analyticsState.to) {
        const period = analyticsComputePeriod(analyticsState.preset || 'thisMonth');
        analyticsState.from = period.from;
        analyticsState.to = period.to;
    }
    return { from: analyticsState.from, to: analyticsState.to };
}

function analyticsReportDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString().slice(0, 10);
}

function analyticsPeriodTitle({ from, to }) {
    return `${from.toLocaleDateString('ru-RU')} — ${to.toLocaleDateString('ru-RU')}`;
}

function analyticsPreviousPeriod({ from, to }) {
    const duration = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - duration);
    return { from: prevFrom, to: prevTo };
}

function analyticsSamePeriodLastYear({ from, to }) {
    const yearFrom = new Date(from);
    const yearTo = new Date(to);
    yearFrom.setFullYear(yearFrom.getFullYear() - 1);
    yearTo.setFullYear(yearTo.getFullYear() - 1);
    return { from: yearFrom, to: yearTo };
}

function analyticsAddJsonSheet(wb, rows, name) {
    const sheetRows = Array.isArray(rows) && rows.length ? rows : [{ Данные: 'Нет данных за период' }];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows), name.slice(0, 31));
}

function analyticsAddAoaSheet(wb, rows, name) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name.slice(0, 31));
}

function analyticsBuildSummaryRows(bundle, label = 'Текущий период') {
    const overview = bundle.overview?.period_metrics || {};
    const totals = bundle.overview?.totals || {};
    const marketing = bundle.marketing?.totals || {};
    const teacherRevenue = bundle.teacherRevenue || {};
    const utilization = bundle.utilization || {};
    const avgTeacherUtilization = (utilization.teachers || []).length
        ? Math.round((utilization.teachers || []).reduce((sum, row) => sum + (Number(row.utilizationPercent) || 0), 0) / utilization.teachers.length)
        : 0;

    return [
        ['Блок', 'Показатель', 'Значение'],
        [label, 'Активные ученики', totals.activeStudents || 0],
        [label, 'Пробные сейчас', totals.trialStudents || 0],
        [label, 'Потерянные ученики', totals.lostStudents || 0],
        [label, 'Новые пробные', overview.newTrialsInPeriod || 0],
        [label, 'Конверсия пробный → оплата', `${overview.trialToMembershipConversion?.percent || 0}%`],
        [label, 'Средний чек', overview.avgCheck || 0],
        [label, 'Продажи по первой оплате', marketing.sold || 0],
        [label, 'Заявки', marketing.leads || 0],
        [label, 'Общий доход преподавателей', teacherRevenue.grandTotal || 0],
        [label, 'Средняя загрузка преподавателей', `${avgTeacherUtilization}%`],
    ];
}

async function analyticsFetchReportBundle(period, scope = 'full') {
    const core = [
        analyticsFetchForPeriod('overview', period.from, period.to),
        analyticsFetchForPeriod('teachers', period.from, period.to),
        analyticsFetchForPeriod('teacher-revenue', period.from, period.to),
        analyticsFetchForPeriod('marketing', period.from, period.to),
        analyticsFetchForPeriod('utilization', period.from, period.to),
    ];
    if (scope === 'full') {
        core.push(
            analyticsFetchForPeriod('operations-dashboard', period.from, period.to),
            analyticsFetchForPeriod('managers', period.from, period.to),
            analyticsFetchForPeriod('admins', period.from, period.to),
            analyticsFetchForPeriod('losses', period.from, period.to),
        );
    }
    const [
        overview,
        teachers,
        teacherRevenue,
        marketing,
        utilization,
        operations,
        managers,
        admins,
        losses,
    ] = await Promise.all(core);

    return { overview, teachers, teacherRevenue, marketing, utilization, operations, managers, admins, losses };
}

function analyticsAppendCurrentSheets(wb, bundle) {
    const teacherRevenueMap = new Map((bundle.teacherRevenue?.teachers || []).map(row => [row.id, row]));
    analyticsAddAoaSheet(wb, analyticsBuildSummaryRows(bundle), 'Сводка');
    analyticsAddJsonSheet(wb, (bundle.teachers?.teachers || []).map(row => {
        const revenue = teacherRevenueMap.get(row.id) || {};
        return {
            Преподаватель: row.name,
            Ученики: row.studentsCount || 0,
            Потерянные: row.lostCount || 0,
            Средний_чек: row.avgCheck || 0,
            LTV: row.avgLtv || 0,
            Проведено_занятий: revenue.totalClasses || 0,
            Доход_школы: revenue.totalRevenue || 0,
        };
    }), 'Преподаватели');
    analyticsAddJsonSheet(wb, (bundle.teacherRevenue?.teachers || []).flatMap(row =>
        (row.students || []).map(student => ({
            Преподаватель: row.name,
            Ученик: student.name,
            Занятий: student.classCount || 0,
            Доход: student.revenue || 0,
        }))
    ), 'Доход детали');
    analyticsAddJsonSheet(wb, (bundle.marketing?.sources || []).map(row => ({
        Канал: analyticsMarketingAttributionLabel(row),
        Источник: analyticsMarketingText(row.source),
        Тип: analyticsMarketingText(row.medium),
        Кампания: analyticsMarketingText(row.campaign),
        Посетители: row.visitors || 0,
        Переходы_по_кнопкам: row.ctaClicks || 0,
        Просмотры_формы: row.formViews || 0,
        Заявки: row.leads || 0,
        Продажи_первая_оплата: row.sold || 0,
        Визит_в_заявку: `${row.visitToLeadRate || 0}%`,
        Заявка_в_продажу: `${row.leadToSaleRate || 0}%`,
    })), 'Реклама');
    analyticsAddJsonSheet(wb, bundle.managers?.managers || [], 'Менеджеры');
    analyticsAddJsonSheet(wb, bundle.admins?.admins || [], 'Админы');
    analyticsAddJsonSheet(wb, (bundle.utilization?.teachers || []).map(row => ({
        Преподаватель: row.name,
        Загрузка: `${row.utilizationPercent || 0}%`,
        Запланировано_часов: row.scheduledHours || 0,
        Проведено_часов: row.completedHours || 0,
        Отменено_часов: row.cancelledHours || 0,
    })), 'Загрузка преподов');
    analyticsAddJsonSheet(wb, (bundle.utilization?.rooms || []).map(row => ({
        Кабинет: row.name,
        Загрузка: `${row.utilizationPercent || 0}%`,
        Занято_часов: row.occupiedHours || 0,
        Свободно_часов: row.freeHours || 0,
    })), 'Загрузка кабинетов');
    analyticsAddJsonSheet(wb, bundle.losses?.recentLosses || [], 'Потери');
}

async function runAnalyticsReportButton(buttonId, busyText, callback) {
    const button = document.getElementById(buttonId);
    const originalText = button?.textContent || '';
    if (button?.disabled) return;
    if (button) {
        button.disabled = true;
        button.textContent = busyText;
    }
    try {
        await callback();
    } catch (error) {
        console.error('Analytics report export error:', error);
        if (typeof toast !== 'undefined' && toast.error) {
            toast.error(error.message || 'Не удалось сформировать отчет');
        } else {
            alert(error.message || 'Не удалось сформировать отчет');
        }
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = originalText.trim();
        }
    }
}

async function downloadAnalyticsMonthlyReport() {
    if (!analyticsEnsureExcel()) return;
    await runAnalyticsReportButton('analyticsDownloadMonthlyReportBtn', 'Собираем...', async () => {
        const period = analyticsActivePeriod();
        const bundle = await analyticsFetchReportBundle(period, 'full');
        const wb = XLSX.utils.book_new();
        analyticsAddAoaSheet(wb, [
            ['Месячный отчет Maestro'],
            ['Период', analyticsPeriodTitle(period)],
            ['Сформирован', new Date().toLocaleString('ru-RU')],
        ], 'Обложка');
        analyticsAppendCurrentSheets(wb, bundle);
        XLSX.writeFile(wb, `maestro-month-report-${analyticsReportDateKey(period.from)}-${analyticsReportDateKey(period.to)}.xlsx`);
    });
}

async function downloadAnalyticsFullReport() {
    if (!analyticsEnsureExcel()) return;
    await runAnalyticsReportButton('analyticsDownloadFullReportBtn', 'Собираем...', async () => {
        const period = analyticsActivePeriod();
        const previous = analyticsPreviousPeriod(period);
        const lastYear = analyticsSamePeriodLastYear(period);
        const [currentBundle, previousBundle, lastYearBundle] = await Promise.all([
            analyticsFetchReportBundle(period, 'full'),
            analyticsFetchReportBundle(previous, 'compare'),
            analyticsFetchReportBundle(lastYear, 'compare'),
        ]);

        const wb = XLSX.utils.book_new();
        analyticsAddAoaSheet(wb, [
            ['Полный отчет Maestro'],
            ['Период', analyticsPeriodTitle(period)],
            ['Прошлый период', analyticsPeriodTitle(previous)],
            ['Год к году', analyticsPeriodTitle(lastYear)],
            ['Сформирован', new Date().toLocaleString('ru-RU')],
            [],
            ['ИИ-инструкция'],
            ...ANALYTICS_FULL_REPORT_PROMPT.split('\n').map(line => [line]),
        ], 'ИИ-инструкция');
        analyticsAppendCurrentSheets(wb, currentBundle);
        analyticsAddAoaSheet(wb, analyticsBuildSummaryRows(previousBundle, 'Прошлый период'), 'Сравнение прошлый период');
        analyticsAddAoaSheet(wb, analyticsBuildSummaryRows(lastYearBundle, 'Год к году'), 'Сравнение год к году');
        XLSX.writeFile(wb, `maestro-full-report-${analyticsReportDateKey(period.from)}-${analyticsReportDateKey(period.to)}.xlsx`);
    });
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
        if (tab === 'marketing')  await renderAnalyticsMarketing(pane);
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

function analyticsFullDateLabel(value) {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())
        ? String(value ?? '')
        : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function analyticsTooltipAttrs({ title, label, value, meta, color }) {
    return [
        'data-analytics-tooltip="1"',
        `data-tooltip-title="${escapeAnalyticsHtml(title || '')}"`,
        `data-tooltip-label="${escapeAnalyticsHtml(label || '')}"`,
        `data-tooltip-value="${escapeAnalyticsHtml(String(value ?? ''))}"`,
        `data-tooltip-meta="${escapeAnalyticsHtml(meta || '')}"`,
        `data-tooltip-color="${escapeAnalyticsHtml(color || '#d7ad4a')}"`,
        'tabindex="0"',
    ].join(' ');
}

function analyticsPolarToCartesian(cx, cy, radius, angleDegrees) {
    const angleRadians = angleDegrees * Math.PI / 180;
    return {
        x: cx + radius * Math.cos(angleRadians),
        y: cy + radius * Math.sin(angleRadians),
    };
}

function analyticsDonutSlicePath(cx, cy, outerRadius, innerRadius, startPercent, endPercent) {
    const safeEndPercent = Math.min(endPercent, 99.999);
    const startAngle = startPercent / 100 * 360 - 90;
    const endAngle = safeEndPercent / 100 * 360 - 90;
    const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
    const outerStart = analyticsPolarToCartesian(cx, cy, outerRadius, startAngle);
    const outerEnd = analyticsPolarToCartesian(cx, cy, outerRadius, endAngle);
    const innerEnd = analyticsPolarToCartesian(cx, cy, innerRadius, endAngle);
    const innerStart = analyticsPolarToCartesian(cx, cy, innerRadius, startAngle);

    return [
        `M ${outerStart.x} ${outerStart.y}`,
        `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x} ${outerEnd.y}`,
        `L ${innerEnd.x} ${innerEnd.y}`,
        `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${innerStart.x} ${innerStart.y}`,
        'Z',
    ].join(' ');
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
        const dots = (item.values || []).map((value, index) => {
            const displayValue = options.money ? analyticsFormatMoney(value) : analyticsFormatNumber(value);
            return `<circle class="analytics-tooltip-target analytics-line-dot" cx="${x(index)}" cy="${y(value)}" r="4" fill="${color}"
                ${analyticsTooltipAttrs({
                    title: item.name,
                    label: analyticsFullDateLabel(labels[index]),
                    value: displayValue,
                    meta: title,
                    color,
                })}></circle>`;
        }).join('');
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
            const displayValue = options.money ? analyticsFormatMoney(value) : analyticsFormatNumber(value);
            return `<rect class="analytics-tooltip-target analytics-bar-rect" x="${xx}" y="${pad.top + plotHeight - barHeight}" width="${barWidth * .84}" height="${Math.max(barHeight, value ? 3 : 0)}" rx="2" fill="${color}"
                ${analyticsTooltipAttrs({
                    title: item.name,
                    label: analyticsFullDateLabel(label),
                    value: displayValue,
                    meta: title,
                    color,
                })}></rect>`;
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
        const color = ANALYTICS_CHART_COLORS[index % ANALYTICS_CHART_COLORS.length];
        const percent = Math.round(Number(item.value) / total * 100);
        return `
            <path class="analytics-tooltip-target analytics-donut-slice" d="${analyticsDonutSlicePath(110, 110, 96, 58, start, cursor)}" fill="${color}"
                ${analyticsTooltipAttrs({
                    title: item.label,
                    label: title,
                    value: analyticsFormatNumber(item.value),
                    meta: `${percent}% от всех заявок`,
                    color,
                })}></path>
        `;
    });
    return analyticsChartCard(title, `
        <div class="analytics-donut-layout">
            <div class="analytics-donut">
                <svg class="analytics-donut-svg" viewBox="0 0 220 220" aria-label="${escapeAnalyticsHtml(title)}">
                    ${segments.join('')}
                </svg>
                <div><strong>${total}</strong><span>заявок</span></div>
            </div>
            <div class="analytics-donut-legend">
                ${nonEmpty.map((item, index) => {
                    const color = ANALYTICS_CHART_COLORS[index % ANALYTICS_CHART_COLORS.length];
                    const percent = Math.round(Number(item.value) / total * 100);
                    return `<div class="analytics-tooltip-target" ${analyticsTooltipAttrs({
                        title: item.label,
                        label: title,
                        value: analyticsFormatNumber(item.value),
                        meta: `${percent}% от всех заявок`,
                        color,
                    })}>
                    <i style="background:${color}"></i>
                    <span>${escapeAnalyticsHtml(item.label)}</span>
                    <strong>${item.value}</strong>
                </div>`;
                }).join('')}
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
                        <div class="analytics-manager-bar is-processed" style="width:${item.processed / maximum * 100}%"
                            ${analyticsTooltipAttrs({
                                title: 'Обработано заявок',
                                label: item.name,
                                value: analyticsFormatNumber(item.processed),
                                meta: `Конверсия в оплату: ${analyticsFormatPercent(item.conversionPercent)}`,
                                color: '#74b7f2',
                            })}><span>${item.processed}</span></div>
                        <div class="analytics-manager-bar is-paid" style="width:${item.paid / maximum * 100}%"
                            ${analyticsTooltipAttrs({
                                title: 'Оплачено',
                                label: item.name,
                                value: analyticsFormatNumber(item.paid),
                                meta: `Конверсия в оплату: ${analyticsFormatPercent(item.conversionPercent)}`,
                                color: '#7edc74',
                            })}><span>${item.paid}</span></div>
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

function analyticsSectionHeader(title, subtitle = '', badge = '', id = '') {
    const badgeLabels = {
        Live: 'В работе',
        Now: 'Сейчас',
        Period: 'Период',
        Funnel: 'Воронка',
        Risk: 'Риск',
        Team: 'Команда',
        Sales: 'Продажи',
        Ops: 'Операции',
        Recovery: 'Возврат',
        Summary: 'Сводка',
        Recent: 'Свежие',
        Reasons: 'Причины',
        Stages: 'Этапы',
        Marketing: 'Реклама',
        Channels: 'Каналы',
        Leads: 'Лиды',
        Revenue: 'Доход',
        Capacity: 'Загрузка',
    };
    const badgeText = badgeLabels[badge] || badge;
    return `
        <div class="analytics-section-head" ${id ? `id="${escapeAnalyticsHtml(id)}"` : ''}>
            <div>
                <span class="analytics-eyebrow">Аналитика Maestro</span>
                <h3>${escapeAnalyticsHtml(title)}</h3>
                ${subtitle ? `<p>${escapeAnalyticsHtml(subtitle)}</p>` : ''}
            </div>
            ${badgeText ? `<span class="analytics-section-badge">${escapeAnalyticsHtml(badgeText)}</span>` : ''}
        </div>
    `;
}

function analyticsDashboardMetric(label, value, hint) {
    return `
        <div class="analytics-dashboard-metric">
            <span>${escapeAnalyticsHtml(label)}</span>
            <strong>${escapeAnalyticsHtml(String(value))}</strong>
            ${hint ? `<small>${escapeAnalyticsHtml(hint)}</small>` : ''}
        </div>
    `;
}

function analyticsQuickNav(items) {
    if (!items?.length) return '';
    return `
        <nav class="analytics-quick-nav" aria-label="Быстрая навигация по аналитике">
            ${items.map(item => {
                const safeId = String(item.id || '').replace(/[^\w-]/g, '');
                return `
                    <button type="button" onclick="analyticsScrollTo('${safeId}')">
                        <span>${escapeAnalyticsHtml(item.icon || '•')}</span>
                        <strong>${escapeAnalyticsHtml(item.label)}</strong>
                        ${item.hint ? `<small>${escapeAnalyticsHtml(item.hint)}</small>` : ''}
                    </button>
                `;
            }).join('')}
        </nav>
    `;
}

function analyticsPercentTone(value) {
    const percent = Number(value) || 0;
    if (percent >= 85) return 'is-high';
    if (percent >= 60) return 'is-good';
    if (percent >= 35) return 'is-mid';
    return 'is-low';
}

function renderOperationsDashboard(data) {
    const labels = data.labels || [];
    const totalIncome = (data.finance?.income || []).reduce((sum, value) => sum + (Number(value) || 0), 0);
    const totalRealization = (data.revenueVsRealization?.realization || []).reduce((sum, value) => sum + (Number(value) || 0), 0);
    const totalLessons = Object.values(data.lessons || {})
        .flat()
        .reduce((sum, value) => sum + (Number(value) || 0), 0);
    const funnelTotal = (data.funnel || []).reduce((sum, item) => sum + (Number(item.value) || 0), 0);

    return `
        <section class="analytics-premium-section analytics-premium-section--operations">
            ${analyticsSectionHeader('Операционный дашборд', 'Деньги, уроки, реализация и воронка продаж в одном управленческом экране.', 'Live', 'analyticsOperationsDashboard')}
            <div class="analytics-dashboard-strip">
                ${analyticsDashboardMetric('Поступления', analyticsFormatMoney(totalIncome), 'по кассе за период')}
                ${analyticsDashboardMetric('Реализация уроков', analyticsFormatMoney(totalRealization), 'по проведённым занятиям')}
                ${analyticsDashboardMetric('Уроков', analyticsFormatNumber(totalLessons), 'все типы занятий')}
                ${analyticsDashboardMetric('Заявок в воронке', analyticsFormatNumber(funnelTotal), 'по текущим статусам')}
            </div>
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
        </section>
    `;
}

function analyticsPlanCard({ kind, title, actual, plan, pace, money }) {
    const pct = analyticsClampPercent(pace?.percent || 0);
    const displayActual = money ? analyticsFormatMoney(actual) : analyticsFormatNumber(actual);
    const displayPlan = money ? analyticsFormatMoney(plan) : analyticsFormatNumber(plan);
    const displayRemaining = money ? analyticsFormatMoney(pace?.remaining || 0) : analyticsFormatNumber(pace?.remaining || 0);
    const displayDaily = money ? analyticsFormatMoney(pace?.dailyRequired || 0) : analyticsFormatNumber(pace?.dailyRequired || 0);
    const displayProjected = money ? analyticsFormatMoney(pace?.projected || 0) : analyticsFormatNumber(pace?.projected || 0);
    const isConfigured = Number(plan) > 0;

    return `
        <article class="analytics-plan-card analytics-plan-card--${kind}">
            <div class="analytics-plan-card__top">
                <span>${escapeAnalyticsHtml(title)}</span>
                <strong>${isConfigured ? analyticsFormatPercent(pct) : '—'}</strong>
            </div>
            <div class="analytics-plan-card__value">${displayActual}</div>
            <div class="analytics-plan-card__sub">План: ${displayPlan}</div>
            <div class="analytics-plan-progress" aria-label="${escapeAnalyticsHtml(title)} ${pct}%">
                <div style="width:${pct}%"></div>
            </div>
            <div class="analytics-plan-card__meta">
                <span>Осталось: ${displayRemaining}</span>
                <span>В день: ${displayDaily}</span>
                <span>Прогноз: ${displayProjected}</span>
            </div>
            <div class="analytics-plan-card__hint">${escapeAnalyticsHtml(analyticsMetricTrend(actual, pace?.projected || 0, plan, money))}</div>
        </article>
    `;
}

function analyticsInsightCard(icon, title, text, actionLabel, action) {
    return `
        <button class="analytics-insight-card" type="button" onclick="${action}">
            <span>${icon}</span>
            <strong>${escapeAnalyticsHtml(title)}</strong>
            <small>${escapeAnalyticsHtml(text)}</small>
            <em>${escapeAnalyticsHtml(actionLabel)} →</em>
        </button>
    `;
}

function renderAnalyticsOwnerHero({ data, plan }) {
    const totals = data.totals || {};
    const period = data.period_metrics || {};
    const revenueActual = plan?.actual?.revenue || 0;
    const bookingsActual = plan?.actual?.bookings || 0;
    const revenuePlan = plan?.plan?.revenuePlan || 0;
    const bookingsPlan = plan?.plan?.bookingsPlan || 0;
    const monthKey = plan?.month || analyticsPlanMonthKey();
    const planConfigured = plan?.plan?.isConfigured;
    const funnel = period.trialFunnel || {};
    const convPercent = period.trialToMembershipConversion?.percent || 0;
    const insights = [];

    if (!planConfigured || (!revenuePlan && !bookingsPlan)) {
        insights.push(analyticsInsightCard('🎯', 'Задай план', 'Пока план месяца пустой — аналитика не может подсказать темп.', 'Заполнить', `openAnalyticsPlanModal('${monthKey}', ${revenuePlan}, ${bookingsPlan})`));
    }
    if (revenuePlan && (plan?.pace?.revenue?.remaining || 0) > 0) {
        insights.push(analyticsInsightCard('💰', 'Дожать выручку', `До плана осталось ${analyticsFormatMoney(plan.pace.revenue.remaining)}.`, 'Смотреть финансы', `analyticsScrollTo('analyticsOperationsDashboard')`));
    }
    if (bookingsPlan && (plan?.pace?.bookings?.remaining || 0) > 0) {
        insights.push(analyticsInsightCard('📩', 'Нужны заявки', `До плана осталось ${analyticsFormatNumber(plan.pace.bookings.remaining)} заявок.`, 'Смотреть воронку', `analyticsScrollTo('analyticsTrialFunnel')`));
    }
    if ((funnel.awaitingDecision || 0) > 0) {
        insights.push(analyticsInsightCard('⏳', 'Ждут решения', `${funnel.awaitingDecision} ученик(ов) после пробного ещё думают.`, 'К потерям', `analyticsSwitchTab('losses')`));
    }
    if (insights.length === 0) {
        insights.push(analyticsInsightCard('✨', 'Темп хороший', 'Критичных сигналов по плану за выбранный месяц нет.', 'Смотреть графики', `analyticsScrollTo('analyticsOperationsDashboard')`));
    }

    return `
        <section class="analytics-owner-hero">
            <div class="analytics-owner-hero__header">
                <div>
                    <span class="analytics-eyebrow">Пульт владельца</span>
                    <h2>План / факт · ${escapeAnalyticsHtml(analyticsMonthLabel(monthKey))}</h2>
                    <p>Показывает темп месяца по деньгам и заявкам. Остальные блоки ниже — без изменения бизнес-логики.</p>
                </div>
                <button class="admin-btn btn-primary analytics-plan-edit-btn" type="button"
                    onclick="openAnalyticsPlanModal('${monthKey}', ${revenuePlan}, ${bookingsPlan})">
                    Настроить план
                </button>
            </div>

            <div class="analytics-owner-hero__grid">
                ${analyticsPlanCard({
                    kind: 'revenue',
                    title: 'Выручка месяца',
                    actual: revenueActual,
                    plan: revenuePlan,
                    pace: plan?.pace?.revenue || {},
                    money: true,
                })}
                ${analyticsPlanCard({
                    kind: 'bookings',
                    title: 'Заявки месяца',
                    actual: bookingsActual,
                    plan: bookingsPlan,
                    pace: plan?.pace?.bookings || {},
                    money: false,
                })}
                <article class="analytics-pulse-card">
                    <span class="analytics-eyebrow">Состояние школы</span>
                    <div class="analytics-pulse-grid">
                        <div><strong>${analyticsFormatNumber(totals.activeStudents || 0)}</strong><span>активных</span></div>
                        <div><strong>${analyticsFormatNumber(period.newTrialsInPeriod || 0)}</strong><span>новых пробных</span></div>
                        <div><strong>${analyticsFormatPercent(convPercent)}</strong><span>пробный → оплата</span></div>
                        <div><strong>${analyticsFormatNumber(totals.lostStudents || 0)}</strong><span>потерянных</span></div>
                    </div>
                </article>
            </div>

            <div class="analytics-insight-rail">
                ${insights.slice(0, 4).join('')}
            </div>
        </section>
    `;
}

// ---------- Overview ----------
async function renderAnalyticsOverview(pane) {
    const planMonth = analyticsPlanMonthKey();
    const [data, operations, plan] = await Promise.all([
        analyticsFetch('overview'),
        analyticsFetch('operations-dashboard'),
        analyticsFetch('plan', { month: planMonth }),
    ]);
    if (!data || !data.success) throw new Error(data?.error || 'Нет данных');
    if (!operations || !operations.success) throw new Error(operations?.error || 'Нет данных для графиков');
    if (!plan || !plan.success) throw new Error(plan?.error || 'Нет данных по плану');

    const t = data.totals || {};
    const p = data.period_metrics || {};
    const conv = p.trialToMembershipConversion || { total: 0, converted: 0, percent: 0 };
    const funnel = p.trialFunnel || { trials: 0, attended: 0, converted: 0, closed: 0, lostAfterTrial: 0, awaitingDecision: 0 };

    const lifespanHint = p.avgLifespanCohort != null
        ? `Когорта ушедших за период: ${p.avgLifespanCohort}`
        : 'По ученикам, ушедшим в выбранный период';

    pane.innerHTML = `
        ${renderAnalyticsOwnerHero({ data, plan })}
        ${analyticsQuickNav([
            { id: 'analyticsOperationsDashboard', icon: '₸', label: 'Деньги', hint: 'графики и воронка' },
            { id: 'analyticsCurrentState', icon: '●', label: 'Состояние', hint: 'ученики сейчас' },
            { id: 'analyticsPeriodMetrics', icon: '↗', label: 'Период', hint: 'конверсия и чек' },
            { id: 'analyticsTrialFunnel', icon: '⤴', label: 'Воронка', hint: 'пробный → оплата' },
            { id: 'analyticsChurnSection', icon: '!', label: 'Отток', hint: 'где теряем' },
            { id: 'analyticsFreezeLossSection', icon: '⚑', label: 'Заморозки', hint: 'упущенная прибыль' },
        ])}
        <div class="analytics-note">
            Метрики разделены на «состояние сейчас» и когорты выбранного периода. Незавершённые окна решения не считаются потерями.
        </div>
        ${renderOperationsDashboard(operations)}
        ${analyticsSectionHeader('Текущее состояние', 'Живая картина школы на текущий момент: активные, пробные, постоянные и потерянные.', 'Now', 'analyticsCurrentState')}
        <div class="analytics-grid">
            ${analyticsCard('Действующие ученики', t.activeStudents ?? 0, 'Уникальные ученики с активным пробным или обычным абонементом')}
            ${analyticsCard('Пробные прямо сейчас', t.trialStudents ?? 0, 'Открытые заявки на пробный урок')}
            ${analyticsCard('Постоянные', t.regularStudents ?? 0, 'То же ядро: активные non-trial абонементы')}
            ${analyticsCard('Потерянные', t.lostStudents ?? 0, `Без оплат более ${data.lostThresholdMonths || 3} мес.`)}
        </div>

        ${analyticsSectionHeader('За выбранный период', 'Ключевые метрики периода: пробные, конверсия, средний чек и средняя жизнь ученика.', 'Period', 'analyticsPeriodMetrics')}
        <div class="analytics-grid">
            ${analyticsCard('Новые пробные', p.newTrialsInPeriod ?? 0, 'Куплено пробных абонементов в периоде')}
            ${analyticsCard('Конверсия пробный → оплата', analyticsFormatPercent(conv.percent), `${conv.converted} из ${conv.total} (деньги поступили на баланс)`)}
            ${analyticsCard('Средний чек', analyticsFormatMoney(p.avgCheck), 'По completed-платежам за абонемент в периоде')}
            ${analyticsCard('Средняя продолжительность', `${p.avgLifespanMonths || 0} мес`, lifespanHint)}
        </div>

        ${analyticsSectionHeader('Воронка пробного', 'Путь ученика от пробного до оплаты — где доходим, где теряем, где ждём решения.', 'Funnel', 'analyticsTrialFunnel')}
        ${analyticsFunnel(funnel)}

        ${analyticsSectionHeader('Потери за период', 'Контрольные точки оттока после пробного, первого и второго месяца.', 'Churn', 'analyticsChurnSection')}
        <div class="analytics-grid">
            ${analyticsChurnCard('После пробного', p.churnAfterTrial, 'Только завершившие 14-дневное окно или явно отклонённые после пробного')}
            ${analyticsChurnCard('После 1-го месяца', p.churnAfterMonth1, 'Не продлили в 45 дней после окончания 1-го абонемента')}
            ${analyticsChurnCard('После 2-го месяца', p.churnAfterMonth2, 'Не продлили в 45 дней после окончания 2-го абонемента')}
        </div>

        ${analyticsSectionHeader('Упущенная прибыль', 'Экстренные заморозки: сколько уроков не состоялось, сколько выплатили и сколько школа недополучила.', 'Risk', 'analyticsFreezeLossSection')}
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

function analyticsGetTooltipEl() {
    let tooltip = document.getElementById('analyticsChartTooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'analyticsChartTooltip';
        tooltip.className = 'analytics-chart-tooltip';
        tooltip.setAttribute('role', 'status');
        tooltip.setAttribute('aria-live', 'polite');
        document.body.appendChild(tooltip);
    }
    return tooltip;
}

function analyticsPositionTooltip(tooltip, x, y) {
    const gap = 16;
    const edge = 12;
    const rect = tooltip.getBoundingClientRect();
    let left = x + gap;
    let top = y + gap;

    if (left + rect.width + edge > window.innerWidth) {
        left = x - rect.width - gap;
    }
    if (top + rect.height + edge > window.innerHeight) {
        top = y - rect.height - gap;
    }

    tooltip.style.transform = `translate3d(${Math.max(edge, left)}px, ${Math.max(edge, top)}px, 0)`;
}

function analyticsShowChartTooltip(target, event) {
    if (!target?.dataset?.analyticsTooltip) return;
    const tooltip = analyticsGetTooltipEl();
    const color = target.dataset.tooltipColor || '#d7ad4a';
    const title = target.dataset.tooltipTitle || '';
    const label = target.dataset.tooltipLabel || '';
    const value = target.dataset.tooltipValue || '';
    const meta = target.dataset.tooltipMeta || '';

    tooltip.innerHTML = `
        <div class="analytics-chart-tooltip__top">
            <i style="background:${escapeAnalyticsHtml(color)}"></i>
            <span>${escapeAnalyticsHtml(label)}</span>
        </div>
        <strong>${escapeAnalyticsHtml(value)}</strong>
        <small>${escapeAnalyticsHtml(title)}</small>
        ${meta ? `<em>${escapeAnalyticsHtml(meta)}</em>` : ''}
    `;
    tooltip.classList.add('is-visible');

    if (event?.clientX != null && event?.clientY != null) {
        analyticsPositionTooltip(tooltip, event.clientX, event.clientY);
    } else {
        const rect = target.getBoundingClientRect();
        analyticsPositionTooltip(tooltip, rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
}

function analyticsHideChartTooltip() {
    const tooltip = document.getElementById('analyticsChartTooltip');
    if (!tooltip) return;
    tooltip.classList.remove('is-visible');
}

function analyticsInitChartTooltip(section) {
    if (!section || section.dataset.tooltipInited) return;
    section.dataset.tooltipInited = '1';

    section.addEventListener('pointermove', (event) => {
        const target = event.target?.closest?.('[data-analytics-tooltip]');
        if (!target || !section.contains(target)) {
            analyticsHideChartTooltip();
            return;
        }
        analyticsShowChartTooltip(target, event);
    });
    section.addEventListener('pointerleave', analyticsHideChartTooltip);
    section.addEventListener('focusin', (event) => {
        const target = event.target?.closest?.('[data-analytics-tooltip]');
        if (target && section.contains(target)) {
            analyticsShowChartTooltip(target);
        }
    });
    section.addEventListener('focusout', analyticsHideChartTooltip);
    window.addEventListener('scroll', analyticsHideChartTooltip, { passive: true });
    window.addEventListener('resize', analyticsHideChartTooltip);
}

function analyticsScrollTo(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function analyticsSwitchTab(tab) {
    const btn = document.querySelector(`.analytics-tab[data-analytics-tab="${tab}"]`);
    if (!btn) return;
    btn.click();
    setTimeout(() => {
        const pane = document.getElementById(`analyticsPane-${tab}`);
        pane?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
}

function analyticsPlanInputValue(value) {
    const number = Math.round(Number(value) || 0);
    return number > 0 ? String(number) : '';
}

function closeAnalyticsPlanModal() {
    const modal = document.getElementById('analyticsPlanModal');
    if (!modal) return;
    modal.classList.remove('show');
    setTimeout(() => modal.remove(), 180);
}

function openAnalyticsPlanModal(month, revenuePlan = 0, bookingsPlan = 0) {
    closeAnalyticsPlanModal();
    const modal = document.createElement('div');
    modal.className = 'modal analytics-plan-modal show';
    modal.id = 'analyticsPlanModal';
    modal.innerHTML = `
        <div class="modal-overlay" onclick="closeAnalyticsPlanModal()"></div>
        <div class="modal-content analytics-plan-modal__content">
            <button class="modal-close" type="button" onclick="closeAnalyticsPlanModal()">×</button>
            <h2 class="modal-title">ПЛАН МЕСЯЦА</h2>
            <p class="analytics-plan-modal__lead">Задай ориентиры на ${escapeAnalyticsHtml(analyticsMonthLabel(month))}. Факт считается автоматически по CRM.</p>
            <form id="analyticsPlanForm" class="admin-form">
                <input type="hidden" id="analyticsPlanMonth" value="${escapeAnalyticsHtml(month)}">
                <div class="form-group">
                    <label for="analyticsRevenuePlanInput">План выручки, ₸</label>
                    <input type="number" class="admin-input" id="analyticsRevenuePlanInput" min="0" step="1000"
                        placeholder="Например, 8000000" value="${analyticsPlanInputValue(revenuePlan)}">
                </div>
                <div class="form-group">
                    <label for="analyticsBookingsPlanInput">План заявок</label>
                    <input type="number" class="admin-input" id="analyticsBookingsPlanInput" min="0" step="1"
                        placeholder="Например, 120" value="${analyticsPlanInputValue(bookingsPlan)}">
                </div>
                <div class="analytics-plan-modal__preview">
                    <span>Подсказка</span>
                    <p>План можно менять в течение месяца. История факта не меняется — меняются только целевые ориентиры.</p>
                </div>
                <button type="submit" class="modal-submit">СОХРАНИТЬ ПЛАН</button>
            </form>
        </div>
    `;
    document.body.appendChild(modal);
    const form = document.getElementById('analyticsPlanForm');
    form?.addEventListener('submit', saveAnalyticsPlan);
    setTimeout(() => document.getElementById('analyticsRevenuePlanInput')?.focus(), 60);
}

async function saveAnalyticsPlan(event) {
    event?.preventDefault();
    const month = document.getElementById('analyticsPlanMonth')?.value || analyticsPlanMonthKey();
    const revenuePlan = document.getElementById('analyticsRevenuePlanInput')?.value || 0;
    const bookingsPlan = document.getElementById('analyticsBookingsPlanInput')?.value || 0;
    const submit = document.querySelector('#analyticsPlanForm .modal-submit');
    const originalText = submit?.textContent || 'СОХРАНИТЬ ПЛАН';
    if (submit) {
        submit.disabled = true;
        submit.textContent = 'СОХРАНЯЮ...';
    }

    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/analytics/plan?month=${encodeURIComponent(month)}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ month, revenuePlan, bookingsPlan }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Не удалось сохранить план');
        }
        closeAnalyticsPlanModal();
        analyticsState.loaded.overview = false;
        await loadAnalyticsTab('overview', true);
        if (typeof toast !== 'undefined' && toast.success) {
            toast.success('План месяца сохранён');
        }
    } catch (error) {
        console.error('Save analytics plan error:', error);
        if (typeof toast !== 'undefined' && toast.error) {
            toast.error(error.message || 'Не удалось сохранить план');
        } else {
            alert(error.message || 'Не удалось сохранить план');
        }
    } finally {
        if (submit) {
            submit.disabled = false;
            submit.textContent = originalText;
        }
    }
}

// ---------- Teachers ----------
async function renderAnalyticsTeachers(pane) {
    const [data, revenueData] = await Promise.all([
        analyticsFetch('teachers'),
        analyticsFetch('teacher-revenue'),
    ]);
    if (!data || !data.success) throw new Error(data?.error || 'Нет данных');
    if (!revenueData || !revenueData.success) throw new Error(revenueData?.error || 'Нет данных по доходам');
    const rows = data.teachers || [];
    const revenueRows = revenueData.teachers || [];
    if (rows.length === 0 && revenueRows.length === 0) {
        pane.innerHTML = '<div class="analytics-empty">Нет данных по преподавателям</div>';
        return;
    }
    const totalStudents = rows.reduce((sum, row) => sum + (Number(row.studentsCount) || 0), 0);
    const totalLost = rows.reduce((sum, row) => sum + (Number(row.lostCount) || 0), 0);
    pane.innerHTML = `
        ${analyticsSectionHeader('Преподаватели', 'Удержание, активная база и финансовый вклад преподавателей за выбранный период.', 'Team')}
        <div class="analytics-dashboard-strip analytics-dashboard-strip--compact">
            ${analyticsDashboardMetric('Преподавателей', analyticsFormatNumber(rows.length), 'в таблице')}
            ${analyticsDashboardMetric('Активных учеников', analyticsFormatNumber(totalStudents), 'по группам')}
            ${analyticsDashboardMetric('Потерянных', analyticsFormatNumber(totalLost), 'по последним оплатам')}
        </div>
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
        ${renderAnalyticsTeacherRevenueSection(revenueData)}
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
    const processed = rows.reduce((sum, row) => sum + (Number(row.bookingsProcessed) || 0), 0);
    const trialsSold = rows.reduce((sum, row) => sum + (Number(row.trialsSold) || 0), 0);
    const membershipsSold = rows.reduce((sum, row) => sum + (Number(row.membershipsSold) || 0), 0);
    const recovered = rows.reduce((sum, row) => sum + (Number(row.recoveredCount) || 0), 0);
    pane.innerHTML = `
        ${analyticsSectionHeader('Менеджеры', 'Продажи, пробные, конверсия после пробного и возврат потерянных клиентов.', 'Sales')}
        <div class="analytics-dashboard-strip analytics-dashboard-strip--compact">
            ${analyticsDashboardMetric('Обработано заявок', analyticsFormatNumber(processed), 'за период')}
            ${analyticsDashboardMetric('Пробных продано', analyticsFormatNumber(trialsSold), 'по trial-заявкам')}
            ${analyticsDashboardMetric('Абонементов', analyticsFormatNumber(membershipsSold), 'non-trial')}
            ${analyticsDashboardMetric('Возвращено', analyticsFormatNumber(recovered), 'потеряшек')}
        </div>
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
    const membershipsSold = rows.reduce((sum, row) => sum + (Number(row.membershipsSold) || 0), 0);
    const renewals = rows.reduce((sum, row) => sum + (Number(row.renewals) || 0), 0);
    const trialsHandled = rows.reduce((sum, row) => sum + (Number(row.trialsHandled) || 0), 0);
    pane.innerHTML = `
        ${analyticsSectionHeader('Администраторы', 'Продажи, продления и качество удержания по администраторам.', 'Ops')}
        <div class="analytics-dashboard-strip analytics-dashboard-strip--compact">
            ${analyticsDashboardMetric('Пробных отработано', analyticsFormatNumber(trialsHandled), 'за период')}
            ${analyticsDashboardMetric('Абонементов', analyticsFormatNumber(membershipsSold), 'создано')}
            ${analyticsDashboardMetric('Продлений', analyticsFormatNumber(renewals), 'renewal')}
        </div>
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
        ${analyticsSectionHeader('Потери и возвраты', 'Кто и почему потерялся, на каком этапе это случилось и кого удалось вернуть.', 'Recovery')}
        <div class="analytics-dashboard-strip analytics-dashboard-strip--compact">
            ${analyticsDashboardMetric('Потеряно', analyticsFormatNumber(totals.lostCount || 0), 'клиентов')}
            ${analyticsDashboardMetric('Завершили обучение', analyticsFormatNumber(totals.departedStudentsCount || 0), 'учеников')}
            ${analyticsDashboardMetric('После пробного', analyticsFormatNumber(totals.afterTrialLostCount || 0), 'явный этап')}
            ${analyticsDashboardMetric('Возвращено', analyticsFormatNumber(totals.recoveredCount || 0), 'за период')}
        </div>
        ${analyticsSectionHeader('Сводка за период', 'Короткая управленческая выжимка по потерям и возвратам.', 'Summary')}
        <div class="analytics-grid">
            ${analyticsCard('Всего потеряно', totals.lostCount || 0, 'Заявки и завершившие обучение')}
            ${analyticsCard('Бывшие ученики', totals.departedStudentsCount || 0, 'Завершили обучение в выбранном периоде')}
            ${analyticsCard('После пробного', totals.afterTrialLostCount || 0, 'Явно зафиксированный этап потери')}
            ${analyticsCard('Возвращено потеряшек', totals.recoveredCount || 0, 'Зафиксировано через действие «Вернуть»')}
        </div>

        ${analyticsSectionHeader('Последние потери', 'Заявки и ученики, по которым зафиксирована причина ухода в выбранном периоде.', 'Recent')}
        ${analyticsRecentLossCards(recentLosses)}

        ${analyticsSectionHeader('Топ возражений', 'Причины, которые чаще всего мешают продаже или продлению.', 'Reasons')}
        ${reasonsList.length === 0 ? '<div class="analytics-empty">Причины потерь пока не фиксировались</div>' : `
            <div class="analytics-bar-list">
                ${renderAnalyticsBars(reasonsList)}
            </div>
        `}

        ${analyticsSectionHeader('Где теряем', 'Этапы воронки, на которых клиенты чаще всего выпадают.', 'Stages')}
        ${stagesList.length === 0 ? '<div class="analytics-empty">Нет данных по этапам</div>' : `
            <div class="analytics-bar-list">
                ${renderAnalyticsBars(stagesList, LOSS_STAGE_LABELS)}
            </div>
        `}

        ${analyticsSectionHeader('Кто возвращал потеряшек', 'Команда, которая возвращала учеников в выбранный период.', 'Team')}
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
            ${analyticsSectionHeader('Последние возвраты', 'Свежие успешные возвраты с комментарием ответственного.', 'Recent')}
            ${analyticsRecoveryCards(recent)}
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

function analyticsRecentLossCards(items) {
    if (!items?.length) {
        return '<div class="analytics-empty">Потерь за период не зарегистрировано</div>';
    }
    return `
        <div class="analytics-action-list">
            ${items.map(item => `
                <article class="analytics-action-card analytics-action-card--loss">
                    <div class="analytics-action-card__top">
                        <span>${analyticsFmtDate(item.lostAt) || '—'}</span>
                        <em>${escapeAnalyticsHtml(LOSS_STAGE_LABELS[item.stage] || item.stage || 'Этап не указан')}</em>
                    </div>
                    <strong>${escapeAnalyticsHtml(item.name || 'Без имени')}</strong>
                    <p>${escapeAnalyticsHtml(item.reason || 'Причина не указана')}</p>
                    <div class="analytics-action-card__meta">
                        <span>${escapeAnalyticsHtml(item.phone || 'телефон не указан')}</span>
                        <span>${escapeAnalyticsHtml(item.processedByName || 'ответственный не указан')}</span>
                    </div>
                </article>
            `).join('')}
        </div>
    `;
}

function analyticsRecoveryCards(items) {
    if (!items?.length) return '';
    return `
        <div class="analytics-action-list analytics-action-list--recoveries">
            ${items.map(item => `
                <article class="analytics-action-card analytics-action-card--recovery">
                    <div class="analytics-action-card__top">
                        <span>${analyticsFmtDate(item.recoveredAt) || '—'}</span>
                        <em>Вернули</em>
                    </div>
                    <button type="button" onclick="viewStudent('${item.studentId}')">${escapeAnalyticsHtml(item.studentName || 'Ученик')}</button>
                    <p>${escapeAnalyticsHtml(item.note || 'Комментарий не указан')}</p>
                    <div class="analytics-action-card__meta">
                        <span>${escapeAnalyticsHtml(item.phone || 'телефон не указан')}</span>
                        <span>${escapeAnalyticsHtml(item.recoveredByName || 'ответственный не указан')}</span>
                    </div>
                </article>
            `).join('')}
        </div>
    `;
}

function analyticsMarketingText(value) {
    const normalized = String(value || '').trim();
    const labels = {
        direct: 'Прямой',
        none: 'Без типа',
        no_campaign: 'Без кампании',
    };
    return labels[normalized] || normalized || '—';
}

function analyticsMarketingAttributionLabel(row = {}) {
    return [
        analyticsMarketingText(row.source),
        analyticsMarketingText(row.medium),
        analyticsMarketingText(row.campaign),
    ].join(' / ');
}

function analyticsMetaPlaceholders() {
    const cards = [
        {
            title: 'WhatsApp Business',
            text: 'Здесь появятся переписки, рассылки, открываемость сообщений и скорость ответов менеджеров после подключения Meta WhatsApp Business API.',
            metrics: ['Переписки', 'Рассылки', 'Скорость ответа'],
        },
        {
            title: 'Facebook Ads',
            text: 'Здесь появятся расход, клики, CTR, CPC и лиды по рекламным кампаниям после прохождения верификации Meta.',
            metrics: ['Расход', 'Клики', 'Лиды'],
        },
    ];
    return `
        ${analyticsSectionHeader('Meta-аналитика', 'Заготовки под будущую интеграцию WhatsApp Business API и Facebook Ads.', 'Реклама')}
        <div class="analytics-dashboard-strip analytics-dashboard-strip--compact">
            ${cards.map(card => `
                <div class="analytics-dashboard-metric analytics-dashboard-metric--placeholder">
                    <span>${escapeAnalyticsHtml(card.title)}</span>
                    <strong>Ожидает подключение</strong>
                    <small>${escapeAnalyticsHtml(card.text)}</small>
                    <div class="analytics-placeholder-tags">
                        ${card.metrics.map(metric => `<em>${escapeAnalyticsHtml(metric)}</em>`).join('')}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

async function renderAnalyticsMarketing(pane) {
    const data = await analyticsFetch('marketing');
    if (!data || !data.success) throw new Error(data?.error || 'Нет данных');

    const totals = data.totals || {};
    const funnel = data.funnel || [];
    const sources = data.sources || [];
    const recentLeads = data.recentLeads || [];
    const maxFunnelValue = Math.max(...funnel.map(item => Number(item.value) || 0), 1);

    pane.innerHTML = `
        ${analyticsSectionHeader('Реклама', 'UTM-метки, визиты, клики, заявки и продажи по первой оплате.', 'Marketing')}
        <div class="analytics-dashboard-strip analytics-dashboard-strip--compact">
            ${analyticsDashboardMetric('Посетители', analyticsFormatNumber(totals.visitors || 0), 'уникальные посетители')}
            ${analyticsDashboardMetric('Заявки', analyticsFormatNumber(totals.leads || 0), `${analyticsFormatPercent(totals.visitToLeadRate || 0)} из визитов`)}
            ${analyticsDashboardMetric('Продажи', analyticsFormatNumber(totals.sold || 0), `${analyticsFormatPercent(totals.leadToSaleRate || 0)} по первой оплате`)}
        </div>

        ${analyticsSectionHeader('Воронка сайта', 'Где люди доходят до формы и где отваливаются до заявки.', 'Funnel')}
        <div class="analytics-bar-list">
            ${funnel.map(item => {
                const value = Number(item.value) || 0;
                const pct = Math.round(value / maxFunnelValue * 100);
                return `
                    <div class="analytics-bar">
                        <div class="analytics-bar-header">
                            <span>${escapeAnalyticsHtml(item.name)}</span>
                            <span class="analytics-sub">${analyticsFormatNumber(value)}</span>
                        </div>
                        <div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${pct}%"></div></div>
                    </div>
                `;
            }).join('')}
        </div>

        ${analyticsSectionHeader('Источники и кампании', 'Срез источник / тип / кампания. «Прямой» означает, что UTM-метки или переход не были определены.', 'Channels')}
        ${sources.length === 0 ? '<div class="analytics-empty">Маркетинговые события за период ещё не записывались</div>' : `
            <div class="table-wrapper">
                <table class="admin-table analytics-table">
                    <thead>
                        <tr>
                            <th>Канал</th>
                            <th>Визиты</th>
                            <th>Кнопки</th>
                            <th>Форма</th>
                            <th>Заявки</th>
                            <th>Первые оплаты</th>
                            <th>Визит → заявка</th>
                            <th>Заявка → продажа</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sources.map(row => `
                            <tr>
                                <td>
                                    <strong>${escapeAnalyticsHtml(analyticsMarketingAttributionLabel(row))}</strong>
                                    <div class="analytics-sub">${escapeAnalyticsHtml(analyticsMarketingText(row.source))} · ${escapeAnalyticsHtml(analyticsMarketingText(row.medium))}</div>
                                </td>
                                <td>${analyticsFormatNumber(row.visitors || 0)}</td>
                                <td>${analyticsFormatNumber(row.ctaClicks || 0)}</td>
                                <td>${analyticsFormatNumber(row.formViews || 0)}</td>
                                <td>${analyticsFormatNumber(row.leads || 0)}</td>
                                <td>${analyticsFormatNumber(row.sold || 0)}</td>
                                <td>${analyticsFormatPercent(row.visitToLeadRate || 0)}</td>
                                <td>${analyticsFormatPercent(row.leadToSaleRate || 0)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `}

        ${analyticsSectionHeader('Последние рекламные заявки', 'Свежие лиды с источником и кампанией.', 'Leads')}
        ${recentLeads.length === 0 ? '<div class="analytics-empty">Заявок за период нет</div>' : `
            <div class="table-wrapper">
                <table class="admin-table analytics-table">
                    <thead>
                        <tr><th>Дата</th><th>Клиент</th><th>Телефон</th><th>Источник</th><th>Кампания</th><th>Статус</th></tr>
                    </thead>
                    <tbody>
                        ${recentLeads.map(lead => `
                            <tr>
                                <td>${analyticsFmtDate(lead.createdAt)}</td>
                                <td>${escapeAnalyticsHtml(lead.name || '—')}</td>
                                <td>${escapeAnalyticsHtml(lead.phone || '—')}</td>
                                <td>${escapeAnalyticsHtml(analyticsMarketingText(lead.source))}</td>
                                <td>${escapeAnalyticsHtml(analyticsMarketingText(lead.campaign))}</td>
                                <td>${escapeAnalyticsHtml(ANALYTICS_BOOKING_STATUS_LABELS[lead.status] || lead.status || '—')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `}

        ${analyticsMetaPlaceholders()}
    `;
}

function analyticsTeacherRevenuePodium(rows, grandTotal) {
    const top = [...(rows || [])]
        .sort((a, b) => (Number(b.totalRevenue) || 0) - (Number(a.totalRevenue) || 0))
        .slice(0, 3);
    if (!top.length) return '';

    return `
        <div class="analytics-podium">
            ${top.map((row, index) => {
                const revenue = Number(row.totalRevenue) || 0;
                const share = grandTotal > 0 ? Math.round(revenue / grandTotal * 100) : 0;
                return `
                    <article class="analytics-podium-card is-rank-${index + 1}">
                        <div class="analytics-podium-card__rank">#${index + 1}</div>
                        <strong>${escapeAnalyticsHtml(row.name)}</strong>
                        <span>${analyticsFormatMoney(revenue)}</span>
                        <div class="analytics-podium-card__bar"><i style="width:${analyticsClampPercent(share)}%"></i></div>
                        <small>${analyticsFormatNumber(row.totalClasses || 0)} занятий · ${analyticsFormatNumber(row.studentsCount || 0)} учеников · ${share}% дохода</small>
                    </article>
                `;
            }).join('')}
        </div>
    `;
}

function analyticsUtilizationHighlights(rows, type) {
    const top = [...(rows || [])]
        .sort((a, b) => (Number(b.utilizationPercent) || 0) - (Number(a.utilizationPercent) || 0))
        .slice(0, 4);
    if (!top.length) return '';

    return `
        <div class="analytics-utilization-grid">
            ${top.map(row => {
                const percent = analyticsClampPercent(row.utilizationPercent || 0);
                const isTeacher = type === 'teacher';
                const title = escapeAnalyticsHtml(row.name || (isTeacher ? 'Преподаватель' : 'Кабинет'));
                const action = isTeacher ? `openUserModal('${row.id}')` : `openScheduleForRoom('${row.id}')`;
                const meta = isTeacher
                    ? `${analyticsFormatNumber(row.completedHours || 0)} ч проведено · ${analyticsFormatNumber(row.cancelledHours || 0)} ч отменено`
                    : `${analyticsFormatNumber(row.occupiedHours || 0)} ч занято · ${analyticsFormatNumber(row.freeHours || 0)} ч свободно`;
                const sub = isTeacher
                    ? `План ${analyticsFormatNumber(row.scheduledHours || 0)} ч · норма ${analyticsFormatNumber(row.periodNormHours || 0)} ч`
                    : `${escapeAnalyticsHtml(row.workingStart || '—')}–${escapeAnalyticsHtml(row.workingEnd || '—')} · доступно ${analyticsFormatNumber(row.availableHours || 0)} ч`;

                return `
                    <article class="analytics-utilization-card ${analyticsPercentTone(percent)}">
                        <div class="analytics-utilization-card__top">
                            <button type="button" onclick="${action}">
                                ${isTeacher ? `<span class="teacher-color-dot" style="background:${escapeAnalyticsHtml(row.color || '#6B7280')}"></span>` : '<span class="analytics-room-dot"></span>'}
                                ${title}
                            </button>
                            <strong>${analyticsFormatPercent(percent)}</strong>
                        </div>
                        <div class="analytics-utilization-card__track"><i style="width:${percent}%"></i></div>
                        <p>${escapeAnalyticsHtml(meta)}</p>
                        <small>${sub}</small>
                    </article>
                `;
            }).join('')}
        </div>
    `;
}

function renderAnalyticsTeacherRevenueSection(data) {
    const rows = data.teachers || [];
    const grandTotal = data.grandTotal || 0;

    if (rows.length === 0) {
        return '<div class="analytics-empty">Нет данных по доходам преподавателей за период</div>';
    }
    const avgRevenue = rows.length ? grandTotal / rows.length : 0;

    return `
        ${analyticsSectionHeader('Доход по преподавателям', 'Фактическая реализация только по занятиям, подтверждённым администратором.', 'Revenue')}
        <div class="analytics-dashboard-strip analytics-dashboard-strip--compact">
            ${analyticsDashboardMetric('Общий доход', analyticsFormatMoney(grandTotal), 'сумма по всем преподавателям')}
            ${analyticsDashboardMetric('Преподавателей', analyticsFormatNumber(rows.length), 'с подтверждёнными занятиями')}
            ${analyticsDashboardMetric('Среднее на преподавателя', analyticsFormatMoney(avgRevenue), 'по реализации периода')}
        </div>
        ${analyticsTeacherRevenuePodium(rows, grandTotal)}
        <div class="analytics-note">Расчёт: стоимость абонемента / кол-во занятий в абонементе × подтверждённые занятия по каждому ученику.</div>

        <div class="table-wrapper">
            <table class="admin-table analytics-table">
                <thead>
                    <tr>
                        <th>Преподаватель</th>
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

// ---------- Teacher Revenue ----------
async function renderAnalyticsTeacherRevenue(pane) {
    const data = await analyticsFetch('teacher-revenue');
    if (!data || !data.success) throw new Error(data?.error || 'Нет данных');
    pane.innerHTML = renderAnalyticsTeacherRevenueSection(data);
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
    const avgTeacherUtilization = teachers.length
        ? Math.round(teachers.reduce((sum, row) => sum + (Number(row.utilizationPercent) || 0), 0) / teachers.length)
        : 0;
    const avgRoomUtilization = rooms.length
        ? Math.round(rooms.reduce((sum, row) => sum + (Number(row.utilizationPercent) || 0), 0) / rooms.length)
        : 0;
    const utilizationBar = (value) => `
        <div class="utilization-progress">
            <div class="utilization-progress__fill" style="width:${Math.min(100, Math.max(0, value || 0))}%"></div>
        </div>
    `;

    pane.innerHTML = `
        ${analyticsSectionHeader('Загрузка расписания', 'Насколько заняты преподаватели и кабинеты в выбранном периоде.', 'Capacity')}
        <div class="analytics-dashboard-strip analytics-dashboard-strip--compact">
            ${analyticsDashboardMetric('Преподавателей', analyticsFormatNumber(teachers.length), 'в расчёте')}
            ${analyticsDashboardMetric('Средняя загрузка', analyticsFormatPercent(avgTeacherUtilization), 'по преподавателям')}
            ${analyticsDashboardMetric('Кабинетов', analyticsFormatNumber(rooms.length), 'активных')}
            ${analyticsDashboardMetric('Загрузка кабинетов', analyticsFormatPercent(avgRoomUtilization), 'средняя')}
        </div>
        ${analyticsSectionHeader('Загруженность преподавателей', 'План, факт, отмены и процент занятости по каждому преподавателю.', 'Teachers')}
        <div class="analytics-note">Плановые часы считаются по расписанию без отменённых уроков. Норма пересчитывается на выбранный период.</div>
        ${teachers.length ? analyticsUtilizationHighlights(teachers, 'teacher') : ''}
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

        ${analyticsSectionHeader('Загруженность кабинетов', 'Свободные и занятые часы по каждому кабинету.', 'Rooms')}
        <div class="analytics-note">Доступное время рассчитывается по рабочему диапазону каждого кабинета.</div>
        ${rooms.length ? analyticsUtilizationHighlights(rooms, 'room') : ''}
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
