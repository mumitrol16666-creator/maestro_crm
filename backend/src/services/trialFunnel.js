const TRIAL_FUNNEL_STAGES = Object.freeze([
    'scheduled',
    'held',
    'analysis_ready',
    'contacted',
    'thinking',
    'sold',
    'rejected',
]);

const TRIAL_FUNNEL_STAGE_LABELS = Object.freeze({
    scheduled: 'Пробный назначен',
    held: 'Проведён',
    analysis_ready: 'Анализ готов',
    contacted: 'Менеджер связался',
    thinking: 'Думают',
    sold: 'Купили',
    rejected: 'Отказались',
});

const TRIAL_FUNNEL_NEXT_ACTIONS = Object.freeze([
    { value: 'attend_trial', label: 'Провести пробный' },
    { value: 'prepare_analysis', label: 'Подготовить анализ' },
    { value: 'contact_family', label: 'Связаться с семьёй' },
    { value: 'follow_up', label: 'Повторно связаться' },
    { value: 'await_payment', label: 'Ожидать оплату' },
    { value: 'schedule_second_trial', label: 'Назначить второй пробный' },
    { value: 'none', label: 'Действий нет' },
]);

const NEXT_ACTION_VALUES = new Set(TRIAL_FUNNEL_NEXT_ACTIONS.map(item => item.value));

function normalizeTrialFunnelStage(value) {
    const normalized = String(value || '').trim();
    return TRIAL_FUNNEL_STAGES.includes(normalized) ? normalized : null;
}

function normalizeTrialNextAction(value) {
    if (value === undefined || value === null || value === '') return null;
    const normalized = String(value).trim();
    return NEXT_ACTION_VALUES.has(normalized) ? normalized : null;
}

function parseTrialNextActionAt(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

function isTrialBooking(booking) {
    return Boolean(booking && (
        booking.requestType === 'trial'
        || booking.trialClassId
        || booking.trialScheduledAt
        || booking.trialFunnelStage
    ));
}

function deriveTrialFunnelStage(booking) {
    if (!isTrialBooking(booking)) return null;
    const explicit = normalizeTrialFunnelStage(booking.trialFunnelStage);
    if (explicit) return explicit;
    if (booking.status === 'rejected') return 'rejected';
    if (booking.status === 'sold' || booking.convertedToStudentId) return 'sold';
    if (booking.status === 'thinking') return 'thinking';
    if (booking.trialScheduledAt || booking.status === 'trial') return 'scheduled';
    return null;
}

function defaultTrialNextAction(stage) {
    return ({
        scheduled: 'attend_trial',
        held: 'prepare_analysis',
        analysis_ready: 'contact_family',
        contacted: 'follow_up',
        thinking: 'follow_up',
        sold: 'none',
        rejected: 'none',
    })[stage] || null;
}

function trialFunnelPayload({ stage, nextAction, nextActionAt, lastContactAt, note }) {
    const normalizedStage = normalizeTrialFunnelStage(stage);
    const normalizedNextAction = normalizeTrialNextAction(nextAction);
    const parsedNextActionAt = parseTrialNextActionAt(nextActionAt);
    const parsedLastContactAt = parseTrialNextActionAt(lastContactAt);
    if (stage !== undefined && !normalizedStage) {
        const error = new Error('Неверный этап воронки пробного');
        error.code = 'TRIAL_FUNNEL_STAGE_INVALID';
        throw error;
    }
    if (nextAction !== undefined && nextAction !== null && nextAction !== '' && !normalizedNextAction) {
        const error = new Error('Неверное следующее действие');
        error.code = 'TRIAL_FUNNEL_ACTION_INVALID';
        throw error;
    }
    if (nextActionAt !== undefined && parsedNextActionAt === undefined) {
        const error = new Error('Некорректный срок следующего действия');
        error.code = 'TRIAL_FUNNEL_DATE_INVALID';
        throw error;
    }
    if (lastContactAt !== undefined && parsedLastContactAt === undefined) {
        const error = new Error('Некорректная дата контакта');
        error.code = 'TRIAL_FUNNEL_DATE_INVALID';
        throw error;
    }
    return {
        ...(stage !== undefined ? { trialFunnelStage: normalizedStage } : {}),
        ...(nextAction !== undefined ? { trialNextAction: normalizedNextAction } : {}),
        ...(nextActionAt !== undefined ? { trialNextActionAt: parsedNextActionAt } : {}),
        ...(lastContactAt !== undefined ? { trialLastContactAt: parsedLastContactAt } : {}),
        ...(note !== undefined ? { trialFunnelNote: String(note || '').trim().slice(0, 2000) || null } : {}),
    };
}

module.exports = {
    TRIAL_FUNNEL_STAGES,
    TRIAL_FUNNEL_STAGE_LABELS,
    TRIAL_FUNNEL_NEXT_ACTIONS,
    normalizeTrialFunnelStage,
    normalizeTrialNextAction,
    parseTrialNextActionAt,
    isTrialBooking,
    deriveTrialFunnelStage,
    defaultTrialNextAction,
    trialFunnelPayload,
};
