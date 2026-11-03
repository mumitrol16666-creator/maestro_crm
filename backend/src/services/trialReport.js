function cleanTrialText(value, maxLength = 2000) {
    if (value === null || value === undefined) return '';
    return String(value).trim().slice(0, maxLength);
}

function cleanTrialEnum(value, allowed, fallback = '') {
    const normalized = cleanTrialText(value, 80);
    return allowed.includes(normalized) ? normalized : fallback;
}

function cleanTrialScore(value) {
    const score = Number(value);
    if (!Number.isFinite(score)) return null;
    return Math.min(5, Math.max(1, Math.round(score)));
}

function cleanTrialStringArray(value, allowed = []) {
    const source = Array.isArray(value) ? value : [];
    return source
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .filter(item => !allowed.length || allowed.includes(item))
        .slice(0, 12);
}

const TRIAL_DERIVED_LABELS = {
    recommendedFormat: {
        individual: 'Индивидуально',
        group: 'В группе',
        hybrid: 'Смешанный формат',
        mixed: 'Смешанный формат',
        online: 'Онлайн',
        offline: 'Офлайн',
    },
    recommendedFrequency: {
        '1_per_week': '1 раз в неделю',
        '2_per_week': '2 раза в неделю',
        '3_per_week': '3 раза в неделю',
        custom: 'Индивидуальный график',
        flexible: 'Гибко',
    },
    nextStep: {
        sell_membership: 'Предложить абонемент',
        second_trial: 'Назначить второй пробный',
        manager_call: 'Связаться менеджеру',
        reject: 'Не продолжать',
        wait: 'Подождать решения',
    },
    priorExperience: {
        none: 'без опыта',
        little: 'небольшой опыт',
        regular: 'занимался регулярно',
    },
};

function trialDerivedLabel(group, value) {
    return TRIAL_DERIVED_LABELS[group]?.[value] || value;
}


/* ---------- Trial report v3 (03.11.2026, document 23 §8) ----------
 * Built on the school methodology «Работа с учеником» p.48: four diagnostic blocks
 * with a level each, and the parent report of p.25 (one skill, one difficulty, one
 * home action). Attendance is the fact of starting the lesson, not a field.
 * Manager fields are not part of the teacher's report: whatever was saved before
 * stays under `manager` until step 3 moves it to the booking card. */
const TRIAL_DIAGNOSTIC_BLOCKS = ['instrument', 'hearingPulse', 'movement', 'learnability'];
const TRIAL_DIAGNOSTIC_LEVELS = ['not_yet', 'with_hint', 'independent'];
const TRIAL_DIAGNOSTIC_LABELS = {
    instrument: 'Инструмент',
    hearingPulse: 'Слух и пульс',
    movement: 'Движение',
    learnability: 'Обучаемость',
};
const TRIAL_LEVEL_LABELS = {
    not_yet: 'пока не получилось',
    with_hint: 'с подсказкой',
    independent: 'сам',
};

function isTrialReportV3(report) {
    return Boolean(report && typeof report === 'object'
        && (Number(report.version) === 3 || (report.diagnostics && typeof report.diagnostics === 'object')));
}

function cleanTrialPlanStep(step) {
    if (!step || typeof step !== 'object') return null;
    const number = Math.round(Number(step.number));
    const title = cleanTrialText(step.title, 255);
    if (!title || !Number.isFinite(number) || number < 0 || number > 999) return null;
    return {
        templateId: cleanTrialText(step.templateId, 64) || null,
        number,
        title,
        direction: cleanTrialText(step.direction, 120) || null,
        topics: (Array.isArray(step.topics) ? step.topics : [])
            .map(topic => cleanTrialText(topic, 300))
            .filter(Boolean)
            .slice(0, 12),
    };
}

/** Manager fields saved by an older report, kept apart from the teacher's v3 report. */
function extractTrialManagerFields(existing) {
    if (!existing || typeof existing !== 'object') return null;
    if (isTrialReportV3(existing)) return existing.manager || null;
    const profile = existing.studentProfile || {};
    const facts = existing.lessonFacts || {};
    const recommendation = existing.recommendation || {};
    const sales = existing.salesSignals || {};
    const raw = existing.raw || {};
    const manager = {
        motivation: profile.motivation && profile.motivation !== 'unclear' ? profile.motivation : null,
        goalFromParent: cleanTrialText(profile.goalFromParent) || null,
        parentReaction: cleanTrialText(facts.parentReaction) || null,
        // 'manager_call' is the v2 form default, not a manager's choice.
        nextStep: recommendation.nextStep && recommendation.nextStep !== 'manager_call' ? recommendation.nextStep : null,
        buyProbability: cleanTrialScore(sales.buyProbability),
        priceSensitivity: sales.priceSensitivity && sales.priceSensitivity !== 'unknown' ? sales.priceSensitivity : null,
        scheduleFit: sales.scheduleFit && sales.scheduleFit !== 'unknown' ? sales.scheduleFit : null,
        parentObjections: cleanTrialStringArray(sales.parentObjections),
        teacherSalesComment: cleanTrialText(sales.teacherSalesComment) || null,
        adminComment: cleanTrialText(raw.adminComment) || null,
    };
    const filled = Object.values(manager).some(value => Array.isArray(value) ? value.length : Boolean(value));
    return filled ? manager : null;
}

function normalizeTrialReportV3(input, classRecord = {}) {
    const attendance = input.attendance || {};
    const profile = input.studentProfile || {};
    const diagnostics = input.diagnostics || {};
    const facts = input.lessonFacts || {};
    const recommendation = input.recommendation || {};
    const raw = input.raw || {};
    const existing = classRecord?.trialReport && typeof classRecord.trialReport === 'object'
        ? classRecord.trialReport
        : null;

    const normalizedDiagnostics = {};
    for (const block of TRIAL_DIAGNOSTIC_BLOCKS) {
        const value = diagnostics[block] || {};
        normalizedDiagnostics[block] = {
            level: cleanTrialEnum(value.level, TRIAL_DIAGNOSTIC_LEVELS, '') || null,
            note: cleanTrialText(value.note, 500),
        };
    }
    const startStep = cleanTrialPlanStep(recommendation.startStep);
    const plan = (Array.isArray(recommendation.plan) ? recommendation.plan : [])
        .map(cleanTrialPlanStep)
        .filter(Boolean)
        .slice(0, 3);

    return {
        version: 3,
        classId: classRecord.id || null,
        classType: 'trial',
        capturedAt: input.capturedAt || new Date().toISOString(),
        attendance: {
            arrivedWith: cleanTrialEnum(attendance.arrivedWith, ['adult', 'alone', 'unknown'], 'unknown'),
        },
        studentProfile: {
            direction: cleanTrialText(profile.direction, 120),
            priorExperience: cleanTrialEnum(profile.priorExperience, ['none', 'basic', 'medium', 'strong', 'unknown'], 'unknown'),
            goalAndSong: cleanTrialText(profile.goalAndSong, 1000),
        },
        diagnostics: normalizedDiagnostics,
        lessonFacts: {
            achieved: cleanTrialText(facts.achieved, 1000),
            difficulty: cleanTrialText(facts.difficulty, 1000),
            homeAction: cleanTrialText(facts.homeAction, 1000),
        },
        recommendation: {
            startStep: startStep ? { templateId: startStep.templateId, number: startStep.number, title: startStep.title, direction: startStep.direction } : null,
            plan,
            recommendedFormat: cleanTrialEnum(recommendation.recommendedFormat, ['group', 'individual', 'hybrid', 'undecided'], 'undecided'),
            recommendedFrequency: cleanTrialEnum(recommendation.recommendedFrequency, ['1_per_week', '2_per_week', '3_per_week', 'custom', 'undecided'], 'undecided'),
        },
        raw: {
            teacherNote: cleanTrialText(raw.teacherNote, 2000),
        },
        manager: extractTrialManagerFields(existing),
    };
}

function buildTrialReportV3DerivedFields(report) {
    const facts = report.lessonFacts || {};
    const recommendation = report.recommendation || {};
    const diagnostics = report.diagnostics || {};
    const levels = TRIAL_DIAGNOSTIC_BLOCKS
        .filter(block => diagnostics[block]?.level)
        .map(block => `${TRIAL_DIAGNOSTIC_LABELS[block]} — ${TRIAL_LEVEL_LABELS[diagnostics[block].level]}`);
    const summary = [
        facts.achieved ? `Получилось: ${facts.achieved}` : '',
        facts.difficulty ? `Поработаем: ${facts.difficulty}` : '',
        facts.homeAction ? `Дома: ${facts.homeAction}` : '',
        levels.length ? `Диагностика: ${levels.join('; ')}` : '',
    ].filter(Boolean);
    const start = recommendation.startStep;
    const next = [
        start ? `Начинаем со ступени ${start.number} «${start.title}»` : '',
        recommendation.recommendedFormat && recommendation.recommendedFormat !== 'undecided' ? `Формат: ${trialDerivedLabel('recommendedFormat', recommendation.recommendedFormat)}` : '',
        recommendation.recommendedFrequency && recommendation.recommendedFrequency !== 'undecided' ? `Частота: ${trialDerivedLabel('recommendedFrequency', recommendation.recommendedFrequency)}` : '',
    ].filter(Boolean);
    return {
        topic: 'Пробный урок · диагностика',
        lessonSummary: summary.join('\n') || report.raw?.teacherNote || 'Анкета пробного заполнена',
        // LEARN-042: what was given home stays in the diagnostic report, it is not the lesson homework.
        homeworkDraft: '',
        nextLessonFocus: next.join('\n'),
        teacherComment: report.raw?.teacherNote || '',
    };
}

/**
 * Normalize the diagnostic report while keeping teacher observations separate
 * from manager/sales metadata. A teacher may submit before the manager has
 * completed the commercial follow-up, so empty teacher form defaults must not
 * erase existing manager fields.
 */
function normalizeTrialReport(input, classRecord = {}, options = {}) {
    if (!input || typeof input !== 'object') return null;
    if (isTrialReportV3(input)) return normalizeTrialReportV3(input, classRecord);
    // A v3 report from the app is never overwritten by an older form (the CRM
    // lesson modal still collects v2): the saved report stays as it is.
    if (isTrialReportV3(classRecord?.trialReport)) return classRecord.trialReport;

    const attendance = input.attendance || {};
    const studentProfile = input.studentProfile || {};
    const teacherAssessment = input.teacherAssessment || {};
    const lessonFacts = input.lessonFacts || {};
    const recommendation = input.recommendation || {};
    const salesSignals = input.salesSignals || {};
    const raw = input.raw || {};

    const existing = classRecord?.trialReport && typeof classRecord.trialReport === 'object'
        ? classRecord.trialReport
        : {};
    const teacherOnly = Boolean(options.teacherOnly);
    const existingProfile = existing.studentProfile || {};
    const existingLessonFacts = existing.lessonFacts || {};
    const existingRecommendation = existing.recommendation || {};
    const existingSalesSignals = existing.salesSignals || {};
    const existingRaw = existing.raw || {};

    return {
        version: 2,
        classId: classRecord.id || null,
        classType: 'trial',
        capturedAt: input.capturedAt || new Date().toISOString(),
        attendance: {
            outcome: cleanTrialEnum(attendance.outcome, ['attended', 'no_show', 'late', 'rescheduled'], 'attended'),
            arrivedWith: cleanTrialEnum(attendance.arrivedWith, ['parent', 'alone', 'other', 'unknown'], 'unknown'),
            // Accompaniment is not attendance. Keep the legacy field only for
            // API compatibility and never use it in a parent-facing document.
            parentAccompanied: Boolean(attendance.parentAccompanied),
            parentPresent: false,
            durationFactMinutes: Math.max(0, Math.min(240, Math.round(Number(attendance.durationFactMinutes) || Number(classRecord.duration) || 0))),
        },
        studentProfile: {
            direction: cleanTrialText(studentProfile.direction, 120),
            priorExperience: cleanTrialEnum(studentProfile.priorExperience, ['none', 'basic', 'medium', 'strong', 'unknown'], 'unknown'),
            motivation: cleanTrialEnum(
                teacherOnly ? (existingProfile.motivation ?? studentProfile.motivation) : studentProfile.motivation,
                ['parent', 'student', 'both', 'unclear'],
                'unclear',
            ),
            goalFromParent: cleanTrialText(teacherOnly ? (existingProfile.goalFromParent ?? studentProfile.goalFromParent) : studentProfile.goalFromParent),
            goalFromStudent: cleanTrialText(studentProfile.goalFromStudent),
        },
        teacherAssessment: {
            interestLevel: cleanTrialScore(teacherAssessment.interestLevel),
            contactLevel: cleanTrialScore(teacherAssessment.contactLevel),
            focusLevel: cleanTrialScore(teacherAssessment.focusLevel),
            rhythm: cleanTrialScore(teacherAssessment.rhythm),
            hearing: cleanTrialScore(teacherAssessment.hearing),
            coordination: cleanTrialScore(teacherAssessment.coordination),
            memory: cleanTrialScore(teacherAssessment.memory),
            techniqueBase: cleanTrialScore(teacherAssessment.techniqueBase),
            emotionalReadiness: cleanTrialScore(teacherAssessment.emotionalReadiness),
        },
        lessonFacts: {
            whatWasTested: cleanTrialText(lessonFacts.whatWasTested),
            whatWorkedWell: cleanTrialText(lessonFacts.whatWorkedWell),
            difficulties: cleanTrialText(lessonFacts.difficulties),
            reactionToTasks: cleanTrialText(lessonFacts.reactionToTasks),
            parentReaction: cleanTrialText(teacherOnly ? (existingLessonFacts.parentReaction ?? lessonFacts.parentReaction) : lessonFacts.parentReaction),
            homeworkGiven: cleanTrialText(lessonFacts.homeworkGiven),
        },
        recommendation: {
            recommendedFormat: cleanTrialEnum(recommendation.recommendedFormat, ['group', 'individual', 'hybrid', 'undecided'], 'undecided'),
            recommendedFrequency: cleanTrialEnum(recommendation.recommendedFrequency, ['1_per_week', '2_per_week', '3_per_week', 'custom', 'undecided'], 'undecided'),
            recommendedLevel: cleanTrialEnum(recommendation.recommendedLevel, ['beginner', 'basic', 'intermediate', 'advanced'], 'beginner'),
            firstMonthFocus: cleanTrialText(recommendation.firstMonthFocus),
            nextStep: cleanTrialEnum(
                teacherOnly ? (existingRecommendation.nextStep ?? recommendation.nextStep) : recommendation.nextStep,
                ['sell_membership', 'second_trial', 'manager_call', 'reject', 'wait'],
                'manager_call',
            ),
        },
        salesSignals: {
            buyProbability: cleanTrialScore(teacherOnly ? existingSalesSignals.buyProbability : salesSignals.buyProbability),
            priceSensitivity: cleanTrialEnum(
                teacherOnly ? (existingSalesSignals.priceSensitivity ?? salesSignals.priceSensitivity) : salesSignals.priceSensitivity,
                ['low', 'medium', 'high', 'unknown'],
                'unknown',
            ),
            scheduleFit: cleanTrialEnum(
                teacherOnly ? (existingSalesSignals.scheduleFit ?? salesSignals.scheduleFit) : salesSignals.scheduleFit,
                ['good', 'medium', 'bad', 'unknown'],
                'unknown',
            ),
            parentObjections: cleanTrialStringArray(
                teacherOnly ? (existingSalesSignals.parentObjections ?? salesSignals.parentObjections) : salesSignals.parentObjections,
                ['price', 'schedule', 'distance', 'format', 'teacher', 'child_interest', 'thinking', 'other'],
            ),
            teacherSalesComment: cleanTrialText(
                teacherOnly ? (existingSalesSignals.teacherSalesComment ?? salesSignals.teacherSalesComment) : salesSignals.teacherSalesComment,
            ),
        },
        raw: {
            teacherFreeComment: cleanTrialText(raw.teacherFreeComment),
            adminComment: cleanTrialText(teacherOnly ? existingRaw.adminComment : raw.adminComment),
        }
    };
}

function buildTrialReportDerivedFields(report) {
    if (!report) return {};
    if (isTrialReportV3(report)) return buildTrialReportV3DerivedFields(report);
    const facts = report.lessonFacts || {};
    const recommendation = report.recommendation || {};
    const assessment = report.teacherAssessment || {};
    const profile = report.studentProfile || {};

    const topicParts = [
        'Пробный урок',
        profile.direction ? `направление: ${profile.direction}` : '',
        profile.priorExperience && profile.priorExperience !== 'unknown' ? `опыт: ${trialDerivedLabel('priorExperience', profile.priorExperience)}` : '',
    ].filter(Boolean);

    const summaryParts = [
        facts.whatWasTested ? `Проверили: ${facts.whatWasTested}` : '',
        facts.whatWorkedWell ? `Получилось: ${facts.whatWorkedWell}` : '',
        facts.difficulties ? `Трудности: ${facts.difficulties}` : '',
        assessment.interestLevel ? `Интерес: ${assessment.interestLevel}/5` : '',
        assessment.contactLevel ? `Контакт: ${assessment.contactLevel}/5` : '',
    ].filter(Boolean);

    const nextParts = [
        recommendation.recommendedFormat && recommendation.recommendedFormat !== 'undecided' ? `Формат: ${trialDerivedLabel('recommendedFormat', recommendation.recommendedFormat)}` : '',
        recommendation.recommendedFrequency && recommendation.recommendedFrequency !== 'undecided' ? `Частота: ${trialDerivedLabel('recommendedFrequency', recommendation.recommendedFrequency)}` : '',
        recommendation.firstMonthFocus ? `Фокус: ${recommendation.firstMonthFocus}` : '',
    ].filter(Boolean);

    return {
        topic: topicParts.join(' · ') || 'Пробный урок',
        lessonSummary: summaryParts.join('\n') || report.raw?.teacherFreeComment || 'Анкета пробного заполнена',
        // LEARN-042 (decision 03.11, document 23): «Дали домой» stays in the
        // diagnostic report and is not shown to the student as lesson homework.
        homeworkDraft: '',
        nextLessonFocus: nextParts.join('\n'),
        teacherComment: report.raw?.teacherFreeComment || '',
    };
}

module.exports = {
    normalizeTrialReport,
    buildTrialReportDerivedFields,
    isTrialReportV3,
    cleanTrialText,
    cleanTrialEnum,
    cleanTrialScore,
    trialDerivedLabel,
    TRIAL_DIAGNOSTIC_BLOCKS,
    TRIAL_DIAGNOSTIC_LABELS,
    TRIAL_LEVEL_LABELS,
};
