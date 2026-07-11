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

function normalizeTrialReport(input, classRecord = {}) {
    if (!input || typeof input !== 'object') return null;

    const attendance = input.attendance || {};
    const studentProfile = input.studentProfile || {};
    const teacherAssessment = input.teacherAssessment || {};
    const lessonFacts = input.lessonFacts || {};
    const recommendation = input.recommendation || {};
    const salesSignals = input.salesSignals || {};
    const raw = input.raw || {};

    return {
        version: 1,
        classId: classRecord.id || null,
        classType: 'trial',
        capturedAt: input.capturedAt || new Date().toISOString(),
        attendance: {
            outcome: cleanTrialEnum(attendance.outcome, ['attended', 'no_show', 'late', 'rescheduled'], 'attended'),
            arrivedWith: cleanTrialEnum(attendance.arrivedWith, ['parent', 'alone', 'other', 'unknown'], 'unknown'),
            parentPresent: Boolean(attendance.parentPresent),
            durationFactMinutes: Math.max(0, Math.min(240, Math.round(Number(attendance.durationFactMinutes) || Number(classRecord.duration) || 0))),
        },
        studentProfile: {
            direction: cleanTrialText(studentProfile.direction, 120),
            priorExperience: cleanTrialEnum(studentProfile.priorExperience, ['none', 'basic', 'medium', 'strong', 'unknown'], 'unknown'),
            motivation: cleanTrialEnum(studentProfile.motivation, ['parent', 'student', 'both', 'unclear'], 'unclear'),
            goalFromParent: cleanTrialText(studentProfile.goalFromParent),
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
            parentReaction: cleanTrialText(lessonFacts.parentReaction),
            homeworkGiven: cleanTrialText(lessonFacts.homeworkGiven),
        },
        recommendation: {
            recommendedFormat: cleanTrialEnum(recommendation.recommendedFormat, ['group', 'individual', 'hybrid', 'undecided'], 'undecided'),
            recommendedFrequency: cleanTrialEnum(recommendation.recommendedFrequency, ['1_per_week', '2_per_week', '3_per_week', 'custom', 'undecided'], 'undecided'),
            recommendedLevel: cleanTrialEnum(recommendation.recommendedLevel, ['beginner', 'basic', 'intermediate', 'advanced'], 'beginner'),
            firstMonthFocus: cleanTrialText(recommendation.firstMonthFocus),
            nextStep: cleanTrialEnum(recommendation.nextStep, ['sell_membership', 'second_trial', 'manager_call', 'reject', 'wait'], 'manager_call'),
        },
        salesSignals: {
            buyProbability: cleanTrialScore(salesSignals.buyProbability),
            priceSensitivity: cleanTrialEnum(salesSignals.priceSensitivity, ['low', 'medium', 'high', 'unknown'], 'unknown'),
            scheduleFit: cleanTrialEnum(salesSignals.scheduleFit, ['good', 'medium', 'bad', 'unknown'], 'unknown'),
            parentObjections: cleanTrialStringArray(salesSignals.parentObjections, ['price', 'schedule', 'distance', 'format', 'teacher', 'child_interest', 'thinking', 'other']),
            teacherSalesComment: cleanTrialText(salesSignals.teacherSalesComment),
        },
        raw: {
            teacherFreeComment: cleanTrialText(raw.teacherFreeComment),
            adminComment: cleanTrialText(raw.adminComment),
        }
    };
}

function buildTrialReportDerivedFields(report) {
    if (!report) return {};
    const facts = report.lessonFacts || {};
    const recommendation = report.recommendation || {};
    const assessment = report.teacherAssessment || {};
    const sales = report.salesSignals || {};
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
        sales.buyProbability ? `Вероятность покупки: ${sales.buyProbability}/5` : '',
    ].filter(Boolean);

    const nextParts = [
        recommendation.recommendedFormat && recommendation.recommendedFormat !== 'undecided' ? `Формат: ${trialDerivedLabel('recommendedFormat', recommendation.recommendedFormat)}` : '',
        recommendation.recommendedFrequency && recommendation.recommendedFrequency !== 'undecided' ? `Частота: ${trialDerivedLabel('recommendedFrequency', recommendation.recommendedFrequency)}` : '',
        recommendation.firstMonthFocus ? `Фокус: ${recommendation.firstMonthFocus}` : '',
        recommendation.nextStep ? `Следующий шаг: ${trialDerivedLabel('nextStep', recommendation.nextStep)}` : '',
    ].filter(Boolean);

    return {
        topic: topicParts.join(' · ') || 'Пробный урок',
        lessonSummary: summaryParts.join('\n') || report.raw?.teacherFreeComment || 'Анкета пробного заполнена',
        homeworkDraft: facts.homeworkGiven || '',
        nextLessonFocus: nextParts.join('\n'),
        teacherComment: sales.teacherSalesComment || report.raw?.teacherFreeComment || '',
    };
}

module.exports = {
    normalizeTrialReport,
    buildTrialReportDerivedFields,
};
