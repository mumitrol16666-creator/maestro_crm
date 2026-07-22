const {
    normalizeTrialFunnelStage,
    isTrialBooking,
} = require('./trialFunnel');

const TRIAL_FUNNEL_ORDER = Object.freeze([
    'scheduled',
    'held',
    'analysis_ready',
    'contacted',
    'thinking',
    'sold',
]);

const TRIAL_FUNNEL_LABELS = Object.freeze({
    leads: 'Заявки на пробный',
    scheduled: 'Назначены',
    held: 'Проведены',
    analysis_ready: 'Анализ готов',
    contacted: 'Менеджер связался',
    thinking: 'Думают',
    sold: 'Купили обучение',
    rejected: 'Отказались',
    cancelled: 'Отменены',
    noShow: 'Не состоялись',
});

const STAGE_RANK = new Map(TRIAL_FUNNEL_ORDER.map((stage, index) => [stage, index]));

function percent(part, total) {
    return total ? Math.round((part / total) * 100) : 0;
}

function trialClassForBooking(booking, classesById) {
    if (!booking?.trialClassId) return null;
    if (classesById instanceof Map) return classesById.get(booking.trialClassId) || null;
    return classesById?.[booking.trialClassId] || null;
}

function classWasHeld(classItem) {
    if (!classItem) return false;
    if (['pending_admin_review', 'completed'].includes(classItem.status)) return true;
    if (classItem.teacherOutcomeHint === 'held') return true;
    return (classItem.attendees || []).some((attendee) => (
        attendee.attended === true
        || ['present', 'late'].includes(attendee.attendanceStatus)
    ));
}

function classHasAnalysis(classItem) {
    if (!classItem) return false;
    const analysis = classItem.trialAiAnalysis;
    return Boolean(
        classItem.trialReport
        && (
            analysis?.status === 'generated'
            || analysis?.generatedAt
        )
    );
}

function stageAtLeast(stage, target) {
    const rank = STAGE_RANK.get(stage);
    const targetRank = STAGE_RANK.get(target);
    return rank !== undefined && targetRank !== undefined && rank >= targetRank;
}

function getTrialMilestones(booking, classItem = null) {
    const explicitStage = normalizeTrialFunnelStage(booking?.trialFunnelStage);
    const sold = Boolean(
        booking?.status === 'sold'
        || booking?.convertedToStudentId
        || explicitStage === 'sold'
    );
    const rejected = booking?.status === 'rejected' || explicitStage === 'rejected';
    const cancelled = Boolean(classItem?.status === 'cancelled') && !rejected && !sold;
    const noShow = Boolean(
        classItem?.status === 'completed'
        && !classWasHeld(classItem)
        && ['not_held', 'no_submission'].includes(classItem.teacherOutcomeHint),
    );
    const scheduled = Boolean(
        booking?.trialScheduledAt
        || booking?.trialClassId
        || explicitStage
    );
    const held = classWasHeld(classItem)
        || ['held', 'analysis_ready', 'contacted', 'thinking', 'sold'].includes(explicitStage);
    const analysisReady = classHasAnalysis(classItem)
        || ['analysis_ready', 'contacted', 'thinking', 'sold'].includes(explicitStage);
    const contacted = ['contacted', 'thinking', 'sold'].includes(explicitStage);
    const thinking = booking?.status === 'thinking' || ['thinking', 'sold'].includes(explicitStage);

    return {
        scheduled,
        held,
        analysisReady,
        contacted,
        thinking,
        sold,
        rejected,
        cancelled,
        noShow,
    };
}

function getCurrentTrialStage(booking, classItem = null) {
    const explicitStage = normalizeTrialFunnelStage(booking?.trialFunnelStage);
    if (booking?.status === 'rejected' || explicitStage === 'rejected') return 'rejected';
    if (booking?.status === 'sold' || booking?.convertedToStudentId || explicitStage === 'sold') return 'sold';
    if (explicitStage) return explicitStage;
    if (classHasAnalysis(classItem)) return 'analysis_ready';
    if (classWasHeld(classItem)) return 'held';
    if (booking?.trialScheduledAt || booking?.trialClassId) return 'scheduled';
    return 'new';
}

function normalizeAttribution(booking = {}) {
    const attribution = booking.attribution && typeof booking.attribution === 'object'
        ? booking.attribution
        : {};
    const source = attribution.utm_source || attribution.source || booking.source || 'direct';
    const medium = attribution.utm_medium || attribution.medium || booking.medium || 'none';
    const campaign = attribution.utm_campaign || attribution.campaign || booking.campaign || 'no_campaign';
    return {
        source: String(source || 'direct'),
        medium: String(medium || 'none'),
        campaign: String(campaign || 'no_campaign'),
        key: `${source || 'direct'} / ${medium || 'none'} / ${campaign || 'no_campaign'}`,
    };
}

function normalizeTrialQuiz(booking = {}) {
    const attribution = booking.attribution && typeof booking.attribution === 'object'
        ? booking.attribution
        : {};
    const quiz = attribution.trialQuiz && typeof attribution.trialQuiz === 'object'
        ? attribution.trialQuiz
        : {};
    const clean = (value, fallback = 'Не указано') => {
        const result = String(value || '').trim();
        return result ? result.slice(0, 120) : fallback;
    };
    return {
        audience: clean(quiz.audience),
        direction: clean(quiz.direction || booking.direction),
        format: clean(quiz.format),
        experience: clean(quiz.experience),
        goal: clean(quiz.goal),
    };
}

function emptyQuizRow(key) {
    return {
        key,
        label: key,
        leads: 0,
        scheduled: 0,
        held: 0,
        sold: 0,
        rejected: 0,
        leadToSold: 0,
    };
}

const QUIZ_DIMENSION_LABELS = Object.freeze({
    format: {
        group: 'В группе',
        individual: 'Индивидуально',
        unsure: 'Пока не знаю',
    },
    experience: {
        first: 'Первый раз',
        some: 'Немного занимались',
        confident: 'Уже играет',
    },
    goal: {
        interest: 'Разжечь интерес',
        skill: 'Поставить базу',
        performance: 'Сцена и уверенность',
    },
    direction: {
        'Не определился': 'Не определился — нужна помощь',
    },
});

function emptySourceRow(booking) {
    const attribution = normalizeAttribution(booking);
    return {
        key: attribution.key,
        source: attribution.source,
        medium: attribution.medium,
        campaign: attribution.campaign,
        leads: 0,
        scheduled: 0,
        held: 0,
        analysisReady: 0,
        contacted: 0,
        thinking: 0,
        sold: 0,
        rejected: 0,
        cancelled: 0,
        noShow: 0,
        diagnosticPaid: 0,
        diagnosticRevenue: 0,
    };
}

function buildTrialAnalytics(bookings = [], classesById = new Map()) {
    const trials = bookings.filter(isTrialBooking);
    const counts = {
        leads: trials.length,
        scheduled: 0,
        held: 0,
        analysisReady: 0,
        contacted: 0,
        thinking: 0,
        sold: 0,
        rejected: 0,
        cancelled: 0,
        noShow: 0,
    };
    const currentStages = Object.fromEntries([
        'new', ...TRIAL_FUNNEL_ORDER, 'rejected', 'cancelled', 'noShow',
    ].map((stage) => [stage, 0]));
    const bySource = new Map();
    const byDimension = {
        audience: new Map(),
        direction: new Map(),
        format: new Map(),
        experience: new Map(),
        goal: new Map(),
    };

    const addQuizDimension = (dimension, value, milestones) => {
        const map = byDimension[dimension];
        if (!map) return;
        const key = String(value || 'Не указано').trim() || 'Не указано';
        if (!map.has(key)) {
            const row = emptyQuizRow(key);
            row.label = QUIZ_DIMENSION_LABELS[dimension]?.[key] || key;
            map.set(key, row);
        }
        const row = map.get(key);
        row.leads += 1;
        if (milestones.scheduled) row.scheduled += 1;
        if (milestones.held) row.held += 1;
        if (milestones.sold) row.sold += 1;
        if (milestones.rejected) row.rejected += 1;
    };

    for (const booking of trials) {
        const classItem = trialClassForBooking(booking, classesById);
        const milestones = getTrialMilestones(booking, classItem);
        const currentStage = getCurrentTrialStage(booking, classItem);
        currentStages[currentStage] = (currentStages[currentStage] || 0) + 1;

        for (const key of ['scheduled', 'held', 'analysisReady', 'contacted', 'thinking', 'sold', 'rejected', 'cancelled', 'noShow']) {
            if (milestones[key]) counts[key] += 1;
        }

        const attribution = normalizeAttribution(booking);
        if (!bySource.has(attribution.key)) bySource.set(attribution.key, emptySourceRow(booking));
        const sourceRow = bySource.get(attribution.key);
        sourceRow.leads += 1;
        for (const key of ['scheduled', 'held', 'analysisReady', 'contacted', 'thinking', 'sold', 'rejected', 'cancelled', 'noShow']) {
            if (milestones[key]) sourceRow[key] += 1;
        }

        const quiz = normalizeTrialQuiz(booking);
        for (const dimension of Object.keys(byDimension)) {
            addQuizDimension(dimension, quiz[dimension], milestones);
        }

        const trialPayment = (booking.cashTransactions || []).find((item) => (
            item.type === 'income' && item.category === 'trial_payment'
        ));
        if (trialPayment) {
            sourceRow.diagnosticPaid += 1;
            sourceRow.diagnosticRevenue += Math.max(0, Number(trialPayment.amount) || 0);
        }
    }

    const conversion = {
        leadToScheduled: percent(counts.scheduled, counts.leads),
        scheduledToHeld: percent(counts.held, counts.scheduled),
        heldToAnalysis: percent(counts.analysisReady, counts.held),
        analysisToContacted: percent(counts.contacted, counts.analysisReady),
        contactedToSold: percent(counts.sold, counts.contacted),
        heldToSold: percent(counts.sold, counts.held),
        leadToSold: percent(counts.sold, counts.leads),
    };

    const awaitingDecision = Math.max(0, counts.held - counts.sold - counts.rejected);
    const dimensions = Object.fromEntries(Object.entries(byDimension).map(([dimension, rows]) => [
        dimension,
        Array.from(rows.values())
            .map((row) => ({ ...row, leadToSold: percent(row.sold, row.leads) }))
            .sort((a, b) => b.leads - a.leads || b.sold - a.sold || a.label.localeCompare(b.label, 'ru')),
    ]));

    return {
        labels: TRIAL_FUNNEL_LABELS,
        counts: { ...counts, awaitingDecision },
        conversion,
        currentStages,
        stages: [
            { key: 'leads', label: TRIAL_FUNNEL_LABELS.leads, value: counts.leads },
            ...TRIAL_FUNNEL_ORDER.map((key) => ({
                key,
                label: TRIAL_FUNNEL_LABELS[key],
                value: counts[key === 'analysis_ready' ? 'analysisReady' : key],
            })),
            { key: 'rejected', label: TRIAL_FUNNEL_LABELS.rejected, value: counts.rejected },
        ],
        dimensions,
        sources: Array.from(bySource.values())
            .map((row) => ({
                ...row,
                leadToSold: percent(row.sold, row.leads),
                heldToSold: percent(row.sold, row.held),
            }))
            .sort((a, b) => b.leads - a.leads || b.sold - a.sold),
    };
}

module.exports = {
    TRIAL_FUNNEL_ORDER,
    TRIAL_FUNNEL_LABELS,
    classWasHeld,
    classHasAnalysis,
    getTrialMilestones,
    getCurrentTrialStage,
    normalizeAttribution,
    normalizeTrialQuiz,
    buildTrialAnalytics,
};
