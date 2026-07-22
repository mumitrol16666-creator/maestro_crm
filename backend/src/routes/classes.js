const express = require('express');
const router = express.Router();
const axios = require('axios');
const {
    Packer,
} = require('docx');
const { prisma } = require('../config/db');
const { authenticate, requireTeacherOrAdmin, requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const {
    deductMembershipForClass,
    refundAllDeductionsForClass,
    findMembershipForClass,
    membershipSupportsClass,
    useEmergencyFreezeForClass
} = require('../services/classMembership');
const { notify } = require('../services/notifications');
const { syncOfflineLessonEventToLearningPlatform } = require('../services/learningPlatformNotifications');
const { returnClassToTeacher, reopenClass, upsertClassAttendee } = require('../services/lessonLifecycle');
const { ensureTeacherScheduleColors } = require('../services/scheduleAppearance');
const {
    shouldChargeAttendance,
    isPresentAttendance,
    isEmergencyFreezeAttendance,
    isHeldAttendance,
    canApproveClass,
} = require('../services/lessonBillingPolicy');
const { timeToMinutes, intervalsOverlap } = require('../utils/timeOverlap');
const { normalizeLessonDuration } = require('../utils/duration');
const { buildTrialAnalysisDocument } = require('../services/trialAnalysisDocument');
const { syncClassPayrollSnapshot } = require('../services/payroll');
const {
    isClassEnded,
    isClassReportSubmittable,
    REPORT_SUBMISSION_LEAD_MINUTES,
} = require('../services/automation');
const { loadLessonRosterState, validateLessonSubmission } = require('../services/lessonSubmissionPolicy');
const { getTrialParticipantId, isTrialParticipantId } = require('../services/trialParticipant');
const { syncTrialPayment } = require('../services/trialPayment');
const { defaultTrialNextAction } = require('../services/trialFunnel');
const { findTrialBookingForClass, isTrialClass, isVirtualTrialClass } = require('../services/trialClass');

// In-memory store for schedule generation progress (per backend instance).
// Each entry lives for JOB_TTL_MS after completion and is then removed.
const generationJobs = new Map();
const JOB_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function syncOfflineClassEvent(event, classRecord, message = null, knownStudentIds = null) {
    if (!classRecord?.id) return;
    const studentIds = Array.isArray(knownStudentIds)
        ? knownStudentIds
        : (await prisma.classAttendee.findMany({
            where: { classId: classRecord.id },
            select: { studentId: true },
        })).map((attendee) => attendee.studentId).filter(Boolean);
    await syncOfflineLessonEventToLearningPlatform(
        event,
        classRecord,
        studentIds,
        message,
    ).catch((error) => console.error('[notifications] offline class sync failed:', error.message));
}

function formatCrmFio(person, fallback = '') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function deductionFailureText(reason) {
    const messages = {
        no_membership: 'нет подходящего абонемента',
        no_membership_selected: 'не выбран абонемент для списания',
        membership_not_available: 'выбранный абонемент недоступен',
        already_deducted: 'занятие уже было списано ранее',
        trial_or_practice: 'пробное или практическое занятие не списывается',
        no_billable_context: 'для урока не найден подходящий тип списания',
    };
    return messages[reason] || 'списание не выполнено';
}

function buildPostponeOutcome(student, outcome) {
    const studentName = formatCrmFio(student, 'Ученик');
    const reasonMessages = {
        no_membership: 'нет подходящего абонемента, заморозка и списание не применены',
        no_membership_selected: 'не выбран абонемент для списания',
        membership_not_available: 'выбранный абонемент недоступен',
        already_deducted: 'занятие уже было списано ранее',
        trial_or_practice: 'пробное или практическое занятие не списывается',
        no_billable_context: 'для урока не найден подходящий тип списания',
    };

    if (outcome.outcome === 'emergency_freeze_used') {
        return {
            ...outcome,
            studentName,
            message: `${studentName}: использована экстренная заморозка.`,
            severity: 'success',
        };
    }

    if (outcome.deducted) {
        const message = outcome.outcome === 'deducted_late'
            ? `${studentName}: экстренной заморозки нет, занятие списано как прогул.`
            : `${studentName}: занятие списано как прогул.`;
        return {
            ...outcome,
            studentName,
            message,
            severity: outcome.outcome === 'deducted_late' ? 'warning' : 'success',
        };
    }

    const reasonText = reasonMessages[outcome.reason] || deductionFailureText(outcome.reason);
    return {
        ...outcome,
        studentName,
        message: `${studentName}: списание не выполнено — ${reasonText}.`,
        severity: 'warning',
    };
}

function cleanTrialText(value, maxLength = 2000) {
    const text = String(value || '').trim();
    return text ? text.slice(0, maxLength) : '';
}

function cleanTrialEnum(value, allowed, fallback = '') {
    const text = String(value || '').trim();
    return allowed.includes(text) ? text : fallback;
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

function normalizeTrialReport(input, classRecord = {}, options = {}) {
    if (!input || typeof input !== 'object') return null;

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
            // «С кем пришёл» означает только сопровождение, а не присутствие
            // взрослого на самом уроке. Не сохраняем ложный факт attendance.
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
        // Коммерческий следующий шаг хранится для менеджера и не попадает в
        // поля обычного отчёта по уроку.
    ].filter(Boolean);

    return {
        topic: topicParts.join(' · ') || 'Пробный урок',
        lessonSummary: summaryParts.join('\n') || report.raw?.teacherFreeComment || 'Анкета пробного заполнена',
        homeworkDraft: facts.homeworkGiven || '',
        nextLessonFocus: nextParts.join('\n'),
        teacherComment: report.raw?.teacherFreeComment || '',
    };
}

function sanitizeFileName(value, fallback = 'maestro-trial-analysis') {
    return String(value || fallback)
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || fallback;
}

// Only pedagogical observations are allowed into the student-facing document.
// Commercial decisions, objections and internal notes stay in CRM for the
// manager and are deliberately not sent to the generator.
function buildParentFacingTrialReport(report = {}) {
    const profile = report.studentProfile || {};
    const facts = report.lessonFacts || {};
    const recommendation = report.recommendation || {};
    return {
        version: report.version || 2,
        studentProfile: {
            direction: cleanTrialText(profile.direction, 120),
            priorExperience: cleanTrialEnum(profile.priorExperience, ['none', 'basic', 'medium', 'strong', 'unknown'], 'unknown'),
            learningGoal: cleanTrialText(profile.goalFromStudent || profile.goalFromParent),
        },
        teacherAssessment: report.teacherAssessment || {},
        lessonFacts: {
            whatWasTested: cleanTrialText(facts.whatWasTested),
            whatWorkedWell: cleanTrialText(facts.whatWorkedWell),
            difficulties: cleanTrialText(facts.difficulties),
            reactionToTasks: cleanTrialText(facts.reactionToTasks),
            homeworkGiven: cleanTrialText(facts.homeworkGiven),
        },
        recommendation: {
            recommendedFormat: cleanTrialEnum(recommendation.recommendedFormat, ['group', 'individual', 'hybrid', 'undecided'], 'undecided'),
            recommendedFrequency: cleanTrialEnum(recommendation.recommendedFrequency, ['1_per_week', '2_per_week', '3_per_week', 'custom', 'undecided'], 'undecided'),
            recommendedLevel: cleanTrialEnum(recommendation.recommendedLevel, ['beginner', 'basic', 'intermediate', 'advanced'], 'beginner'),
            firstMonthFocus: cleanTrialText(recommendation.firstMonthFocus),
        },
    };
}

function isDirectOpenAiEndpoint(value) {
    try {
        const url = new URL(String(value || ''));
        return url.hostname === 'api.openai.com';
    } catch (_) {
        return false;
    }
}

function buildTrialAnalysisPayload(classRecord, report, trialBooking = null) {
    const student = classRecord.individualStudent || classRecord.attendees?.[0]?.student || null;
    const person = student || trialBooking;
    const studentName = formatCrmFio(person, 'Ученик');
    const teacherName = formatCrmFio(classRecord.teacher, 'Преподаватель');
    const derived = buildTrialReportDerivedFields(report);
    const lessonDate = classRecord.date ? new Date(classRecord.date) : new Date();
    const birthDate = person?.dateOfBirth ? new Date(person.dateOfBirth) : null;
    const hasValidBirthDate = birthDate && !Number.isNaN(birthDate.getTime());
    const age = hasValidBirthDate
        ? Math.max(0, lessonDate.getFullYear() - birthDate.getFullYear()
            - ((lessonDate.getMonth() < birthDate.getMonth()
                || (lessonDate.getMonth() === birthDate.getMonth() && lessonDate.getDate() < birthDate.getDate())) ? 1 : 0))
        : null;
    const audience = age !== null && age >= 18
        ? { type: 'adult_student', label: 'самому ученику' }
        : age !== null && age < 18
            ? { type: 'minor_student', label: 'ученику и его семье' }
            : { type: 'unknown_age', label: 'ученику и семье' };

    return {
        task: 'maestro_trial_lesson_analysis_docx',
        output: {
            format: 'docx',
            language: 'ru',
            fileName: `${sanitizeFileName(`Анализ пробного урока ${studentName}`)}.docx`,
        },
        template: {
            title: 'Анализ пробного урока',
            brand: 'Музыкальная школа Maestro',
            footer: 'Печать школы: Музыкальная школа Maestro',
            tone: 'уважительный, профессиональный, понятный ученику или семье',
            writingRules: [
                'Писать анализ для ученика или семьи; не предполагать, что ученик — ребёнок.',
                'Никогда не использовать формулировки «ваш ребёнок», «ребёнок показал» или «родитель присутствовал».',
                'Если ученик взрослый, обращаться нейтрально: «ученик», «ученица» или по имени; не писать о семье.',
                'Если возраст неизвестен, использовать нейтральные формулировки «ученик» и «на занятиях».',
                'Не придумывать факты, которых нет в оценках или комментариях.',
                'Оценки 1-5 показывать только в разделе навыков и интерпретировать мягко.',
                'Собрать короткий цельный педагогический отчёт: вывод, наблюдения, сильные стороны, навыки, зоны развития и рекомендации.',
                'Не повторять одну и ту же мысль в разных разделах; каждую фактическую деталь использовать один раз.',
                'Рекомендации должны объединять факты в конкретные учебные действия, а не пересказывать наблюдения.',
                'Не добавлять коммерческие решения, вероятность покупки, возражения, звонок менеджера, следующий шаг, комментарий для семьи или служебную заметку.',
                'Не делать вывод о присутствии взрослого на уроке: сопровождение до урока не означает присутствие на уроке.',
                'Внизу оставить место/строку под печать школы.',
            ],
        },
        audience,
        lesson: {
            id: classRecord.id,
            title: classRecord.title,
            date: classRecord.date,
            startTime: classRecord.startTime,
            endTime: classRecord.endTime,
            duration: classRecord.duration,
            room: classRecord.room?.name || null,
            direction: classRecord.group?.direction || student?.learningDirections?.[0] || trialBooking?.direction || classRecord.title || null,
            // Do not duplicate the same answers in both flattened lesson
            // fields and trialReport. The generator receives one source of
            // truth below.
            topic: classRecord.topic || derived.topic || 'Пробный урок',
            lessonSummary: null,
            homeworkDraft: null,
            nextLessonFocus: null,
            teacherComment: null,
        },
        student: person ? {
            id: student?.id || null,
            bookingId: trialBooking?.id || null,
            name: studentName,
            firstName: person.name || null,
            lastName: person.lastName || null,
            middleName: person.middleName || null,
            dateOfBirth: person.dateOfBirth || null,
            phone: person.phone || null,
            learningDirections: student?.learningDirections || [],
        } : null,
        teacher: classRecord.teacher ? {
            id: classRecord.teacher.id,
            name: teacherName,
            firstName: classRecord.teacher.name || null,
            lastName: classRecord.teacher.lastName || null,
            middleName: classRecord.teacher.middleName || null,
        } : null,
        trialReport: buildParentFacingTrialReport(report),
        generatedAt: new Date().toISOString(),
    };
}

function decodeAgentAnalysisResponse(response) {
    const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
    if (!contentType.includes('application/json')) {
        const error = new Error('Внешний агент вернул готовый DOCX вместо структурированного анализа. Такой файл не используется для отправки.');
        error.code = 'TRIAL_ANALYSIS_AGENT_LEGACY_DOCX';
        error.statusCode = 502;
        throw error;
    }

    let json;
    try {
        json = JSON.parse(Buffer.from(response.data || []).toString('utf8') || '{}');
    } catch (_) {
        const error = new Error('Внешний агент вернул некорректный JSON анализа');
        error.code = 'TRIAL_ANALYSIS_AGENT_INVALID_JSON';
        error.statusCode = 502;
        throw error;
    }

    const analysis = json.analysis || json.result?.analysis || json.data?.analysis || json.result || json.data;
    if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
        const error = new Error('Внешний агент не вернул структурированный анализ');
        error.code = 'TRIAL_ANALYSIS_AGENT_INVALID_OUTPUT';
        error.statusCode = 502;
        throw error;
    }
    return {
        analysis: normalizeTrialAnalysisModelOutput(JSON.stringify(analysis)),
        model: json.model || json.data?.model || null,
    };
}

function cleanDocxText(value, fallback = '') {
    return String(value ?? fallback)
        .replace(/\s+/g, ' ')
        .trim();
}

const TRIAL_ANALYSIS_PROMPT_VERSION = 'parent-safe-v3';
const PARENT_ANALYSIS_INTERNAL_PATTERN = /(менеджер|служебн|следующ(?:ий|его) шаг|покуп|продаж|абонемент|возражен|готовност[ьи].*(?:куп|оплат)|связать.*(?:менеджер|семь[еёй])|оплат(?:а|ить)|цен[аеыу]|стоимост|конверси|касс[аеуы]|реб[её]нок|родител)/i;

function isParentAnalysisInternalText(value) {
    return PARENT_ANALYSIS_INTERNAL_PATTERN.test(cleanDocxText(value));
}

function parentSafeText(value, fallback = '') {
    const text = cleanDocxText(value, fallback);
    return text && !isParentAnalysisInternalText(text) ? text : '';
}

function parentSafeArray(value, limit = 8) {
    return asTextArray(value)
        .map(item => parentSafeText(item))
        .filter(Boolean)
        .slice(0, limit);
}

function asTextArray(value) {
    if (Array.isArray(value)) {
        return value
            .map(item => typeof item === 'string' ? item : (item?.comment || item?.text || item?.value || ''))
            .map(item => cleanDocxText(item))
            .filter(Boolean)
            .slice(0, 12);
    }
    const text = cleanDocxText(value);
    return text ? [text] : [];
}

function scoreText(label, value) {
    const score = Number(value);
    return Number.isFinite(score) ? `${label}: ${score}/5` : '';
}

function parseOpenAiJsonContent(content) {
    const raw = String(content || '').trim();
    if (!raw) return {};
    const unwrapped = raw
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/i, '')
        .trim();
    try {
        return JSON.parse(unwrapped);
    } catch (_) {
        const start = unwrapped.indexOf('{');
        const end = unwrapped.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(unwrapped.slice(start, end + 1));
            } catch (__) {}
        }
    }
    return { summary: unwrapped };
}

function normalizeTrialAnalysisModelOutput(content) {
    const parsed = parseOpenAiJsonContent(content);
    return {
        title: parentSafeText(parsed.title, 'Анализ пробного урока') || 'Анализ пробного урока',
        summary: parentSafeText(parsed.summary || parsed.intro || parsed.parentSummary),
        observations: parentSafeArray(parsed.observations || parsed.teacherObservations, 5),
        strengths: parentSafeArray(parsed.strengths, 5),
        growthAreas: parentSafeArray(parsed.growthAreas || parsed.difficulties, 4),
        skills: Array.isArray(parsed.skills)
            ? parsed.skills.map(item => {
                if (typeof item === 'string') return cleanDocxText(item);
                const name = cleanDocxText(item?.name || item?.skill || 'Навык');
                const comment = cleanDocxText(item?.comment || item?.text || item?.value);
                return comment ? `${name}: ${comment}` : name;
            }).map(item => parentSafeText(item)).filter(Boolean).slice(0, 8)
            : parentSafeArray(parsed.skills, 8),
        recommendations: parentSafeArray(parsed.recommendations, 5),
        firstMonthPlan: parentSafeArray(parsed.firstMonthPlan || parsed.firstMonthFocus, 3),
        // Эти поля поддерживаются только для совместимости со старыми
        // ответами агента, но никогда не попадают в документ для отправки.
        nextStep: '',
        parentMessage: '',
        managerNote: '',
    };
}

function buildTrialAnalysisMessages(payload) {
    return [
        {
            role: 'system',
            content: [
                `Ты методист музыкальной школы Maestro. Версия промпта: ${TRIAL_ANALYSIS_PROMPT_VERSION}.`,
                'Создай только педагогический анализ пробного урока для ученика или семьи на русском языке.',
                'Не пиши для менеджера, администратора или отдела продаж и не упоминай внутреннюю работу школы.',
                'Не выдумывай факты и не повышай оценки: опирайся только на переданный JSON.',
                'Верни только валидный JSON без markdown, комментариев и дополнительных ключей.',
            ].join(' '),
        },
        {
            role: 'user',
            content: JSON.stringify({
                instruction: 'Сформируй короткий цельный текст для Word-документа анализа пробного урока. Документ будет сразу отправлен получателю.',
                outputSchema: {
                    title: 'string',
                    summary: 'string',
                    observations: ['string'],
                    strengths: ['string'],
                    growthAreas: ['string'],
                    skills: [{ name: 'string', comment: 'string' }],
                    recommendations: ['string'],
                    firstMonthPlan: ['string'],
                },
                qualityRules: [
                    'Главный вывод — 2–3 предложения, только общее понимание урока; не копируй туда списки наблюдений.',
                    'Наблюдения — 2–4 конкретных факта урока без повторения главного вывода.',
                    'Сильные стороны — только 1–3 наиболее заметные стороны, не дублируй ими навыки.',
                    'Навыки — 3–6 конкретных музыкальных наблюдений; оценку объясняй словами, а не только цифрой.',
                    'Зоны развития — 1–3 конкретных педагогических направления, не переписывай трудности дословно.',
                    'Рекомендации — 2–3 практических шага для обучения, собранных из всех фактов; не пересказывай предыдущие разделы.',
                    'План первого месяца указывай только если он добавляет конкретную последовательность; иначе верни пустой список.',
                    'Если факта нет, пропусти его. Не заполняй документ общими похвалами ради объёма.',
                    'Никогда не добавляй: менеджера, звонок, продажу, покупку, абонемент, цену, оплату, возражения, готовность купить, следующий шаг, комментарий для семьи, служебную заметку.',
                    'Не делай вывод о присутствии взрослого: сопровождение до урока не означает присутствие на уроке.',
                ],
                rules: payload.template?.writingRules || [],
                payload,
            }),
        },
    ];
}

async function generateTrialAnalysisWithOpenAi(payload) {
    if (!process.env.OPENAI_API_KEY) {
        const error = new Error('OPENAI_API_KEY не настроен. Добавьте ключ OpenAI в .env или укажите TRIAL_ANALYSIS_AGENT_URL.');
        error.statusCode = 503;
        throw error;
    }

    const model = String(
        process.env.TRIAL_ANALYSIS_OPENAI_MODEL
        || process.env.EVENING_REPORT_AI_MODEL
        || 'gpt-4o-mini'
    ).trim();

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model,
        temperature: 0.35,
        response_format: { type: 'json_object' },
        messages: buildTrialAnalysisMessages(payload),
    }, {
        timeout: Number(process.env.TRIAL_ANALYSIS_OPENAI_TIMEOUT_MS || process.env.TRIAL_ANALYSIS_AGENT_TIMEOUT_MS || 90000),
        headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
        },
        validateStatus: () => true,
    });

    if (response.status >= 400) {
        const message = response.data?.error?.message || response.data?.message || `OpenAI вернул ошибку ${response.status}`;
        const error = new Error(message);
        error.statusCode = response.status === 429 ? 429 : 502;
        throw error;
    }

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) {
        const error = new Error('OpenAI вернул пустой анализ пробного урока');
        error.statusCode = 502;
        throw error;
    }

    return { analysis: normalizeTrialAnalysisModelOutput(content), model };
}

function fallbackTrialAnalysis(payload) {
    const report = payload.trialReport || {};
    const facts = report.lessonFacts || {};
    const assessment = report.teacherAssessment || {};
    const recommendation = report.recommendation || {};
    return {
        title: 'Анализ пробного урока',
        summary: payload.lesson?.lessonSummary || facts.whatWorkedWell || 'Пробный урок проведён, анкета педагога заполнена.',
        observations: [
            facts.whatWasTested ? `Проверяли: ${facts.whatWasTested}` : '',
            facts.reactionToTasks ? `Реакция на задания: ${facts.reactionToTasks}` : '',
        ].filter(Boolean),
        strengths: [],
        growthAreas: [facts.difficulties].filter(Boolean),
        skills: [
            scoreText('Интерес', assessment.interestLevel),
            scoreText('Контакт', assessment.contactLevel),
            scoreText('Фокус', assessment.focusLevel),
            scoreText('Ритм', assessment.rhythm),
            scoreText('Слух', assessment.hearing),
            scoreText('Координация', assessment.coordination),
            scoreText('Память', assessment.memory),
            scoreText('Техника', assessment.techniqueBase),
        ].filter(Boolean),
        recommendations: [
            recommendation.recommendedFormat && recommendation.recommendedFormat !== 'undecided' ? `Формат: ${trialDerivedLabel('recommendedFormat', recommendation.recommendedFormat)}` : '',
            recommendation.recommendedFrequency && recommendation.recommendedFrequency !== 'undecided' ? `Частота: ${trialDerivedLabel('recommendedFrequency', recommendation.recommendedFrequency)}` : '',
            recommendation.firstMonthFocus ? `Фокус первого месяца: ${recommendation.firstMonthFocus}` : '',
        ].filter(Boolean),
        firstMonthPlan: [recommendation.firstMonthFocus].filter(Boolean),
        nextStep: '',
        parentMessage: '',
        managerNote: '',
    };
}

function mergeTrialAnalysis(fallback, generated = {}) {
    const pickText = (key) => parentSafeText(generated[key]) || parentSafeText(fallback[key]) || '';
    const pickArray = (key) => {
        const generatedItems = parentSafeArray(generated[key], 8);
        return generatedItems.length ? generatedItems : parentSafeArray(fallback[key], 8);
    };

    return {
        title: pickText('title') || 'Анализ пробного урока',
        summary: pickText('summary'),
        observations: pickArray('observations'),
        strengths: pickArray('strengths'),
        growthAreas: pickArray('growthAreas'),
        skills: pickArray('skills'),
        recommendations: pickArray('recommendations'),
        firstMonthPlan: pickArray('firstMonthPlan'),
        nextStep: '',
        parentMessage: '',
        managerNote: '',
    };
}

function buildTrialAnalysisDocx(payload, modelAnalysis = {}) {
    const fallback = fallbackTrialAnalysis(payload);
    const analysis = mergeTrialAnalysis(fallback, modelAnalysis);
    const studentName = payload.student?.name || 'Ученик';
    const fileName = sanitizeFileName(payload.output?.fileName || `Анализ пробного урока ${studentName}.docx`);
    const scoreItems = fallback.skills;
    return buildTrialAnalysisDocument({ payload, analysis, scoreItems, fileName });
}

async function generateInternalTrialAnalysisDocx(payload) {
    const { analysis, model } = await generateTrialAnalysisWithOpenAi(payload);
    const { doc, fileName } = buildTrialAnalysisDocx(payload, analysis);
    const buffer = await Packer.toBuffer(doc);
    return {
        buffer,
        fileName,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        source: 'openai_internal',
        model,
    };
}

async function requestAgentTrialAnalysis(agentUrl, payload) {
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    };
    if (process.env.TRIAL_ANALYSIS_AGENT_API_KEY) {
        headers.Authorization = `Bearer ${process.env.TRIAL_ANALYSIS_AGENT_API_KEY}`;
    }

    const response = await axios.post(agentUrl, {
        ...payload,
        output: {
            ...payload.output,
            // The agent may analyse the data, but CRM owns the student-facing
            // document layout and must never accept an arbitrary DOCX.
            format: 'json',
        },
        promptVersion: TRIAL_ANALYSIS_PROMPT_VERSION,
    }, {
        headers,
        responseType: 'arraybuffer',
        timeout: Number(process.env.TRIAL_ANALYSIS_AGENT_TIMEOUT_MS) || 90000,
        validateStatus: () => true,
    });

    if (response.status >= 400) {
        let message = `AI-agent вернул ошибку ${response.status}`;
        try {
            const parsed = JSON.parse(Buffer.from(response.data || []).toString('utf8') || '{}');
            message = parsed.error || parsed.message || message;
        } catch (_) {}
        const error = new Error(message);
        error.statusCode = 502;
        throw error;
    }

    return decodeAgentAnalysisResponse(response);
}

async function generateLocalFallbackTrialAnalysisDocx(payload) {
    const { doc, fileName } = buildTrialAnalysisDocx(payload, {});
    const buffer = await Packer.toBuffer(doc);
    return {
        buffer,
        fileName,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        source: 'local_fallback',
        model: null,
    };
}

async function generateParentTrialAnalysisDocx(payload, agentUrl) {
    if (agentUrl) {
        try {
            const result = await requestAgentTrialAnalysis(agentUrl, payload);
            const { doc, fileName } = buildTrialAnalysisDocx(payload, result.analysis);
            const buffer = await Packer.toBuffer(doc);
            return {
                buffer,
                fileName,
                contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                source: 'agent_structured',
                model: result.model || null,
            };
        } catch (error) {
            // A legacy agent that returns a ready DOCX must not bypass the
            // parent-safe CRM template. Continue with the verified generators.
            console.warn('[trial-analysis] structured agent unavailable:', error.message);
        }
    }

    if (process.env.OPENAI_API_KEY) {
        try {
            return await generateInternalTrialAnalysisDocx(payload);
        } catch (error) {
            console.warn('[trial-analysis] internal OpenAI generation unavailable:', error.message);
        }
    }

    return generateLocalFallbackTrialAnalysisDocx(payload);
}

function buildClassConflictReason(existingConflict, { roomId, teacherId, groupId, individualStudentId }) {
    if (roomId && existingConflict.roomId === roomId) {
        return 'Этот кабинет уже занят в выбранное время';
    }
    if (teacherId && existingConflict.teacherId === teacherId) {
        return 'Преподаватель уже занят в выбранное время';
    }
    if (groupId && existingConflict.groupId === groupId) {
        return 'Для этой группы уже есть занятие в выбранное время';
    }
    if (individualStudentId && existingConflict.individualStudentId === individualStudentId) {
        return 'У этого ученика уже есть занятие в выбранное время';
    }
    return 'Занятие пересекается с уже существующим уроком';
}

async function findClassTimeConflict({ date, startTime, endTime, roomId, teacherId, groupId, individualStudentId }) {
    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);
    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || endMinutes <= startMinutes) {
        return null;
    }

    const conflictConditions = [];
    if (roomId) conflictConditions.push({ roomId });
    if (teacherId) conflictConditions.push({ teacherId });
    if (groupId) conflictConditions.push({ groupId });
    if (individualStudentId) conflictConditions.push({ individualStudentId });
    if (!conflictConditions.length) return null;

    const candidates = await prisma.class.findMany({
        where: {
            date,
            status: { not: 'cancelled' },
            OR: conflictConditions,
        },
        select: {
            id: true,
            title: true,
            roomId: true,
            teacherId: true,
            groupId: true,
            individualStudentId: true,
            startTime: true,
            endTime: true,
        },
    });

    return candidates.find((candidate) => {
        const candidateStart = timeToMinutes(candidate.startTime);
        const candidateEnd = timeToMinutes(candidate.endTime);
        return intervalsOverlap(startMinutes, endMinutes, candidateStart, candidateEnd);
    }) || null;
}

function scheduleJobCleanup(jobId) {
    setTimeout(() => generationJobs.delete(jobId), JOB_TTL_MS);
}

function createJobId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function logLessonAction(userId, action, classRecord, metadata = {}, tx) {
    if (!userId || !classRecord?.id) return;
    const db = tx || prisma;
    try {
        await db.activityLog.create({
            data: {
                userId,
                action,
                entityType: 'Class',
                entityId: classRecord.id,
                details: metadata.details || `${action}: ${classRecord.title}`,
                metadata: {
                    classId: classRecord.id,
                    title: classRecord.title,
                    date: classRecord.date,
                    startTime: classRecord.startTime,
                    endTime: classRecord.endTime,
                    ...metadata
                }
            }
        });
    } catch (error) {
        console.error('Lesson action log error:', error);
    }
}


// @route   GET /api/classes
router.get('/', authenticate, async (req, res) => {
    try {
        const { start, end, roomId, teacherId, subject, classType, status } = req.query;
        const includeParticipants = req.query.includeParticipants === 'true';
        let where = {};
        if (start && end) {
            const startDate = new Date(start);
            const endDate = new Date(end);
            if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
                where.date = { gte: startDate, lte: endDate };
            }
        }
        if (roomId && roomId !== 'all') where.roomId = roomId;
        if (req.query.roomIds) {
            const ids = String(req.query.roomIds).split(',').map(s => s.trim()).filter(Boolean);
            if (ids.length) where.roomId = { in: ids };
        }
        if (teacherId) where.teacherId = teacherId;
        if (classType && classType !== 'all') {
            if (classType === 'practice') {
                where.isPractice = true;
            } else if (classType === 'trial') {
                const linkedTrialClasses = await prisma.booking.findMany({
                    where: { trialClassId: { not: null } },
                    select: { trialClassId: true },
                });
                where.isPractice = false;
                where.AND = [{
                    OR: [
                        { classType: 'trial' },
                        { id: { in: linkedTrialClasses.map((item) => item.trialClassId).filter(Boolean) } },
                    ],
                }];
            } else {
                where.classType = classType;
                where.isPractice = false;
            }
        }
        if (status && status !== 'all') where.status = status;
        if (subject && subject !== 'all') {
            where.OR = [
                { group: { is: { direction: subject } } },
                { individualStudent: { is: { learningDirections: { has: subject } } } },
                { practiceGroups: { some: { direction: subject } } },
                { title: subject },
            ];
        }

        await ensureTeacherScheduleColors();

        const classes = await prisma.class.findMany({
            where,
            include: {
                group: {
                    select: {
                        id: true,
                        name: true,
                        direction: true,
                        currentStudents: true,
                        ...(includeParticipants ? { students: {
                            where: { status: 'active' },
                            select: {
                                student: {
                                    select: {
                                        id: true,
                                        name: true,
                                        lastName: true,
                                        middleName: true,
                                    },
                                },
                            },
                            orderBy: { joinedAt: 'asc' },
                        } } : {}),
                    },
                },
                teacher: {
                    select: {
                        id: true,
                        name: true,
                        lastName: true,
                        middleName: true,
                        teacherScheduleColor: true,
                        teacherWeeklyHours: true,
                    },
                },
                originalTeacher: {
                    select: {
                        id: true,
                        name: true,
                        lastName: true,
                        middleName: true,
                        teacherScheduleColor: true,
                    },
                },
                room: {
                    select: {
                        id: true,
                        name: true,
                        color: true,
                        workingStart: true,
                        workingEnd: true,
                    },
                },
                individualStudent: {
                    select: {
                        id: true,
                        name: true,
                        lastName: true,
                        middleName: true,
                        dateOfBirth: true,
                        learningDirections: true,
                    },
                },
                practiceGroups: { select: { id: true, name: true, direction: true } },
                attendees: includeParticipants ? {
                    include: {
                        student: {
                            select: {
                                id: true,
                                name: true,
                                lastName: true,
                                middleName: true,
                            },
                        },
                    },
                } : true,
            },
            orderBy: [{ date: 'asc' }, { startTime: 'asc' }]
        });

        const [teacherOptions, roomOptions, directionOptions] = await Promise.all([
            prisma.student.findMany({
                where: { role: 'teacher', status: 'active' },
                select: { id: true, name: true, lastName: true, middleName: true, teacherScheduleColor: true },
                orderBy: [{ name: 'asc' }, { lastName: 'asc' }],
            }),
            prisma.room.findMany({
                where: { isActive: true },
                select: { id: true, name: true },
                orderBy: { name: 'asc' },
            }),
            prisma.direction.findMany({
                where: { isActive: true },
                select: { name: true },
                orderBy: { name: 'asc' },
            }),
        ]);
        // Связь заявки — источник истины для старых пробных строк, даже если
        // у самой Class исторически сохранён неверный classType.
        const trialClassIds = classes.map(cls => cls.id);
        const trialBookings = trialClassIds.length
            ? await prisma.booking.findMany({
                where: { trialClassId: { in: trialClassIds } },
                select: {
                    id: true,
                    trialClassId: true,
                    name: true,
                    lastName: true,
                    middleName: true,
                    depositPaid: true,
                    status: true,
                    convertedToStudentId: true,
                    cashTransactions: {
                        where: { category: 'trial_payment', type: 'income' },
                        select: { paymentMethod: true, date: true },
                        take: 1,
                    },
                },
            })
            : [];
        const trialBookingByClassId = new Map(
            trialBookings
                .filter(booking => booking.trialClassId)
                .map(booking => [booking.trialClassId, booking])
        );

        const mapped = classes.map(cls => {
            const trialBooking = trialBookingByClassId.get(cls.id) || null;
            const lessonSubject = cls.group?.direction
                || cls.individualStudent?.learningDirections?.[0]
                || cls.practiceGroups?.[0]?.direction
                || cls.title;
            const teacherColor = cls.teacher?.teacherScheduleColor || '#6B7280';
            const audience = cls.individualStudent
                ? {
                    type: 'student',
                    id: cls.individualStudent.id,
                    name: formatCrmFio(cls.individualStudent),
                    dateOfBirth: cls.individualStudent.dateOfBirth,
                }
                : cls.group
                    ? { type: 'group', id: cls.group.id, name: cls.group.name }
                    : { type: cls.isPractice ? 'practice' : 'none', id: null, name: cls.isPractice ? 'Открытая практика' : 'Не указано' };

            return {
                ...cls,
                _id: cls.id,
                backgroundColor: teacherColor,
                teacherColor,
                lessonSubject,
                lessonType: cls.isPractice ? 'practice' : (trialBooking ? 'trial' : cls.classType),
                classType: trialBooking ? 'trial' : cls.classType,
                needsConfirmation: cls.status === 'pending_admin_review',
                audience,
                depositPaid: Boolean(trialBooking?.depositPaid),
                trialPaymentMethod: trialBooking?.cashTransactions?.[0]?.paymentMethod || null,
                trialPaymentDate: trialBooking?.cashTransactions?.[0]?.date || null,
                trialBooking: trialBooking
                    ? {
                        ...trialBooking,
                        _id: trialBooking.id,
                    }
                    : null,
                group: cls.group ? { ...cls.group, _id: cls.group.id } : null,
                teacher: cls.teacher ? { ...cls.teacher, _id: cls.teacher.id } : null,
                originalTeacher: cls.originalTeacher ? { ...cls.originalTeacher, _id: cls.originalTeacher.id } : null,
                room: cls.room ? { ...cls.room, _id: cls.room.id } : null,
                individualStudent: cls.individualStudent ? { ...cls.individualStudent, _id: cls.individualStudent.id } : null,
                attendees: (cls.attendees || []).map(a => ({
                    ...a,
                    _id: a.id,
                    student: a.studentId,
                    studentDetails: a.student ? { ...a.student, _id: a.student.id } : null,
                })),
                groupName: cls.group ? cls.group.name : (cls.isPractice ? 'Практика' : 'Индивидуально'),
                teacherName: formatCrmFio(cls.teacher, 'Не назначен')
            };
        });

        const filters = {
            teachers: teacherOptions.map(item => ({
                id: item.id,
                name: formatCrmFio(item),
                color: item.teacherScheduleColor || '#6B7280',
            })),
            rooms: roomOptions,
            subjects: [...new Set([
                ...directionOptions.map(item => item.name),
                ...mapped.map(item => item.lessonSubject).filter(Boolean),
            ])].sort((a, b) => a.localeCompare(b, 'ru')),
        };

        res.json({ success: true, classes: mapped, filters });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Ошибка получения' });
    }
});


// @route   POST /api/classes
// Create a new class (single or recurring).
// Body: { classType?, groupId?, roomId?, teacherId?, bookingId?, individualStudentId?, date, startTime, endTime, notes?, isRecurring?, recurringRule? }
router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const {
            groupId, roomId, teacherId, date, startTime, endTime,
            notes, isRecurring, recurringRule, individualStudentId, classType: requestedClassType, bookingId
        } = req.body;

        if (!date || !startTime || !endTime) {
            return res.status(400).json({ success: false, error: 'Дата, время начала и окончания обязательны' });
        }

        // Resolve special group types
        let resolvedGroupId = null;
        let classType = 'group';
        let title = 'Занятие';
        let backgroundColor = '#eb4d77';
        let linkedBooking = null;

        if (requestedClassType && ['group', 'individual', 'trial', 'rent', 'theory'].includes(requestedClassType)) {
            classType = requestedClassType;
        }

        if (groupId === 'special_rent') {
            classType = 'rent';
            title = 'Аренда зала';
        } else if (groupId === 'special_individual') {
            classType = 'individual';
            title = 'Индивидуальное занятие';
        } else if (classType === 'trial') {
            title = 'Пробный урок';
            if (bookingId) {
                linkedBooking = await prisma.booking.findUnique({
                    where: { id: bookingId },
                    select: {
                        id: true,
                        name: true,
                        lastName: true,
                        middleName: true,
                        direction: true,
                        phone: true,
                        status: true,
                        convertedToStudentId: true
                    }
                });
                if (!linkedBooking) {
                    return res.status(404).json({ success: false, error: 'Заявка не найдена' });
                }
                title = `Пробный урок — ${[linkedBooking.lastName, linkedBooking.name, linkedBooking.middleName].filter(Boolean).join(' ')}`.trim();
            }
        } else if (classType === 'individual') {
            title = 'Индивидуальное занятие';
        } else if (groupId) {
            resolvedGroupId = groupId;
            const group = await prisma.group.findUnique({ where: { id: groupId }, select: { name: true, teacherId: true, color: true } });
            if (group) {
                title = group.name;
                if (group.color) backgroundColor = group.color;
            }
        }

        // Get room color (if group color not set)
        if (roomId && (!resolvedGroupId || backgroundColor === '#eb4d77')) {
            const room = await prisma.room.findUnique({ where: { id: roomId }, select: { color: true } });
            if (room?.color) backgroundColor = room.color;
        }

        // Determine teacher: explicit > group default
        let resolvedTeacherId = teacherId || null;
        if (!resolvedTeacherId && resolvedGroupId) {
            const group = await prisma.group.findUnique({ where: { id: resolvedGroupId }, select: { teacherId: true } });
            if (group?.teacherId) resolvedTeacherId = group.teacherId;
        }

        if ((classType === 'individual' || classType === 'trial') && individualStudentId) {
            const student = await prisma.student.findUnique({
                where: { id: individualStudentId },
                select: { id: true, name: true, lastName: true, middleName: true }
            });
            if (!student) {
                return res.status(404).json({ success: false, error: 'Ученик не найден' });
            }
            const studentName = [student.lastName, student.name, student.middleName].filter(Boolean).join(' ');
            if (classType === 'individual') {
                title = `Индивидуально — ${studentName}`;
            } else if (!linkedBooking) {
                title = `Пробный урок — ${studentName}`;
            }
        }

        if (classType === 'group' && !resolvedGroupId) {
            return res.status(400).json({ success: false, error: 'Для группового урока выберите группу' });
        }
        if (classType === 'individual' && !individualStudentId) {
            return res.status(400).json({ success: false, error: 'Для индивидуального урока выберите ученика' });
        }
        if (classType === 'trial' && !individualStudentId && !linkedBooking) {
            return res.status(400).json({ success: false, error: 'Для пробного урока выберите ученика или заявку' });
        }

        // Calculate duration
        const [sh, sm] = startTime.split(':').map(Number);
        const [eh, em] = endTime.split(':').map(Number);
        const duration = (eh * 60 + em) - (sh * 60 + sm);
        if (!Number.isFinite(duration) || duration <= 0) {
            return res.status(400).json({ success: false, error: 'Время окончания должно быть позже времени начала' });
        }

        const classDate = new Date(date);

        // Check conflicts for single class by overlapping time, not only exact start.
        if (!isRecurring) {
            const existingConflict = await findClassTimeConflict({
                date: classDate,
                startTime,
                endTime,
                roomId,
                teacherId: resolvedTeacherId,
                groupId: resolvedGroupId,
                individualStudentId: (classType === 'individual' || classType === 'trial') ? individualStudentId : null,
            });

            if (existingConflict) {
                const conflictReason = buildClassConflictReason(existingConflict, {
                    roomId,
                    teacherId: resolvedTeacherId,
                    groupId: resolvedGroupId,
                    individualStudentId: (classType === 'individual' || classType === 'trial') ? individualStudentId : null,
                });

                try {
                    await prisma.activityLog.create({
                        data: {
                            userId: req.user?.id || 'system',
                            action: 'class_creation_blocked_conflict',
                            entityType: 'Class',
                            details: `Создание занятия заблокировано: ${conflictReason}`,
                            metadata: {
                                roomId,
                                teacherId: resolvedTeacherId,
                                groupId: resolvedGroupId,
                                individualStudentId,
                                conflictClassId: existingConflict.id,
                                date: classDate,
                                startTime,
                                endTime
                            }
                        }
                    });
                } catch (e) {
                    console.error('Failed to log class creation conflict:', e);
                }

                return res.status(400).json({
                    success: false,
                    error: `${conflictReason}: ${existingConflict.startTime}–${existingConflict.endTime}`,
                    conflict: {
                        classId: existingConflict.id,
                        title: existingConflict.title,
                        startTime: existingConflict.startTime,
                        endTime: existingConflict.endTime,
                    },
                });
            }
        }

        // Handle recurring classes
        if (isRecurring && recurringRule) {
            const { daysOfWeek = [], endDate: recurringEndStr } = recurringRule;
            const startDate = new Date(date);
            startDate.setHours(0, 0, 0, 0);
            const recurringEnd = recurringEndStr ? new Date(recurringEndStr) : new Date(startDate);
            if (!recurringEndStr) recurringEnd.setMonth(recurringEnd.getMonth() + 1);
            recurringEnd.setHours(23, 59, 59, 999);

            const classesToCreate = [];
            const cursor = new Date(startDate);
            while (cursor <= recurringEnd) {
                const dow = cursor.getDay() === 0 ? 7 : cursor.getDay();
                if (daysOfWeek.includes(dow)) {
                    classesToCreate.push({
                        groupId: resolvedGroupId,
                        teacherId: resolvedTeacherId,
                        originalTeacherId: resolvedTeacherId,
                        roomId: roomId || null,
                        title,
                        date: new Date(cursor),
                        startTime,
                        endTime,
                        duration: normalizeLessonDuration(duration),
                        status: 'scheduled',
                        backgroundColor,
                        notes: notes || null,
                        isRecurring: true,
                        recurringFreq: 'weekly',
                        recurringDays: daysOfWeek,
                        recurringEndDate: recurringEnd,
                        classType,
                        createdById: req.user?.id || null
                    });
                }
                cursor.setDate(cursor.getDate() + 1);
            }

            if (classesToCreate.length === 0) {
                return res.status(400).json({ success: false, error: 'Нет дней для создания занятий в указанном диапазоне' });
            }

            for (const classToCreate of classesToCreate) {
                const existingConflict = await findClassTimeConflict({
                    date: classToCreate.date,
                    startTime: classToCreate.startTime,
                    endTime: classToCreate.endTime,
                    roomId: classToCreate.roomId,
                    teacherId: classToCreate.teacherId,
                    groupId: classToCreate.groupId,
                    individualStudentId: classToCreate.individualStudentId || null,
                });
                if (existingConflict) {
                    const conflictReason = buildClassConflictReason(existingConflict, {
                        roomId: classToCreate.roomId,
                        teacherId: classToCreate.teacherId,
                        groupId: classToCreate.groupId,
                        individualStudentId: classToCreate.individualStudentId || null,
                    });
                    return res.status(400).json({
                        success: false,
                        error: `${conflictReason}: ${classToCreate.date.toLocaleDateString('ru-RU')} ${existingConflict.startTime}–${existingConflict.endTime}`,
                        conflict: {
                            classId: existingConflict.id,
                            title: existingConflict.title,
                            startTime: existingConflict.startTime,
                            endTime: existingConflict.endTime,
                        },
                    });
                }
            }

            await prisma.class.createMany({
                data: classesToCreate,
                skipDuplicates: true
            });

            // Fetch created classes to return them with relations
            const created = await prisma.class.findMany({
                where: {
                    createdById: req.user?.id,
                    isRecurring: true,
                    date: { gte: startDate, lte: recurringEnd }
                },
                include: {
                    group: { select: { id: true, name: true } },
                    teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                    room: { select: { id: true, name: true, color: true } }
                },
                orderBy: { date: 'asc' }
            });

            const mapped = created.map(cls => ({
                ...cls,
                _id: cls.id,
                group: cls.group ? { ...cls.group, _id: cls.group.id } : null,
                teacher: cls.teacher ? { ...cls.teacher, _id: cls.teacher.id } : null,
                room: cls.room ? { ...cls.room, _id: cls.room.id } : null
            }));

            return res.status(201).json({ success: true, classes: mapped, count: mapped.length });
        }

        // Single class creation
        const created = await prisma.class.create({
            data: {
                groupId: resolvedGroupId,
                teacherId: resolvedTeacherId,
                originalTeacherId: resolvedTeacherId,
                roomId: roomId || null,
                individualStudentId: (classType === 'individual' || classType === 'trial') && individualStudentId ? individualStudentId : null,
                title,
                date: classDate,
                startTime,
                endTime,
                duration: normalizeLessonDuration(duration),
                status: 'scheduled',
                backgroundColor,
                notes: notes || null,
                classType,
                createdById: req.user?.id || null
            },
            include: {
                group: { select: { id: true, name: true } },
                teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                originalTeacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                reviewedBy: { select: { id: true, name: true, lastName: true, middleName: true } },
                room: { select: { id: true, name: true, color: true } },
                individualStudent: { select: { id: true, name: true, lastName: true, middleName: true, dateOfBirth: true } },
                attendees: {
                    include: {
                        student: { select: { id: true, name: true, lastName: true, middleName: true, dateOfBirth: true, phone: true } }
                    }
                }
            }
        });

        if (linkedBooking) {
            const teacher = resolvedTeacherId
                ? await prisma.student.findUnique({ where: { id: resolvedTeacherId }, select: { name: true, lastName: true, middleName: true } })
                : null;
            const room = roomId
                ? await prisma.room.findUnique({ where: { id: roomId }, select: { name: true } })
                : null;
            await prisma.booking.update({
                where: { id: linkedBooking.id },
                data: {
                    trialClassId: created.id,
                    trialTeacherId: resolvedTeacherId,
                    trialTeacherName: formatCrmFio(teacher) || null,
                    trialRoomId: roomId || null,
                    trialRoomName: room?.name || null,
                    trialScheduledAt: new Date(`${date}T${startTime}:00`),
                    status: linkedBooking.convertedToStudentId || ['sold', 'rejected'].includes(linkedBooking.status)
                        ? linkedBooking.status
                        : 'trial',
                    processedById: req.user?.id || null,
                    processedAt: new Date()
                }
            });
        }

        const mapped = {
            ...created,
            _id: created.id,
            group: created.group ? { ...created.group, _id: created.group.id } : null,
            teacher: created.teacher ? { ...created.teacher, _id: created.teacher.id } : null,
            originalTeacher: created.originalTeacher ? { ...created.originalTeacher, _id: created.originalTeacher.id } : null,
            room: created.room ? { ...created.room, _id: created.room.id } : null,
            individualStudent: created.individualStudent ? { ...created.individualStudent, _id: created.individualStudent.id } : null
        };

        await logLessonAction(req.user?.id, 'class_created', created);
        res.status(201).json({ success: true, class: mapped });
    } catch (error) {
        console.error('Create class error:', error);
        if (error.code === 'P2002') {
            try {
                await prisma.activityLog.create({
                    data: {
                        userId: req.user?.id || 'system',
                        action: 'class_creation_blocked_db_unique',
                        entityType: 'Class',
                        details: 'Создание занятия заблокировано уникальным ограничением БД',
                        metadata: { target: error.meta?.target || null }
                    }
                });
            } catch (e) {
                console.error('Failed to log DB unique constraint conflict:', e);
            }
            return res.status(400).json({
                success: false,
                error: 'Данное время для кабинета, преподавателя или группы/ученика уже занято.'
            });
        }
        res.status(500).json({ success: false, error: 'Ошибка создания занятия' });
    }
});

// @route   POST /api/classes/bulk-delete
// Массовая отмена занятий за период. Доступно только super_admin.
// Body: { startDate, endDate, roomId?, onlyGenerated? (default true) }
router.post('/bulk-delete', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { startDate: startDateInput, endDate: endDateInput, roomId, onlyGenerated = true } = req.body;
        if (!startDateInput || !endDateInput) {
            return res.status(400).json({ success: false, error: 'Укажите startDate и endDate' });
        }

        const startDate = new Date(startDateInput);
        const endDate = new Date(endDateInput);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return res.status(400).json({ success: false, error: 'Некорректный формат дат' });
        }
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(0, 0, 0, 0);
        if (endDate < startDate) {
            return res.status(400).json({ success: false, error: 'Дата окончания раньше даты начала' });
        }
        // endDate включительно — двигаем на начало следующего дня
        endDate.setDate(endDate.getDate() + 1);

        const spanDays = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24));
        if (spanDays > 365) {
            return res.status(400).json({ success: false, error: 'Максимальный диапазон — 365 дней' });
        }

        const where = {
            date: { gte: startDate, lt: endDate },
            status: { notIn: ['completed', 'pending_admin_review'] }
        };
        if (roomId && roomId !== 'all') where.roomId = roomId;
        // По умолчанию удаляем только автосгенерированные — защищаем ручные занятия.
        if (onlyGenerated) where.notes = 'Сгенерировано';

        const classesToCancel = await prisma.class.findMany({
            where,
            select: { id: true, teacherId: true, title: true, date: true, startTime: true },
        });
        // Сначала считаем, сколько будем отменять (для аудита в ответе).
        const toCancelCount = await prisma.class.count({ where });
        const { count } = await prisma.class.updateMany({
            where,
            data: {
                status: 'cancelled',
                notes: onlyGenerated
                    ? 'Сгенерировано. Массово отменено администратором.'
                    : 'Массово отменено администратором.'
            }
        });

        await Promise.all(classesToCancel.map((classRecord) => syncOfflineClassEvent('cancelled', classRecord)));

        return res.json({
            success: true,
            cancelled: count,
            matched: toCancelCount,
            range: {
                start: startDate.toISOString(),
                end: new Date(endDate.getTime() - 1).toISOString()
            },
            filters: { roomId: roomId || null, onlyGenerated: !!onlyGenerated }
        });
    } catch (error) {
        console.error('Bulk delete classes error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка массового удаления' });
    }
});

// @route   DELETE /api/classes/:id
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const classRecord = await prisma.class.findUnique({
            where: { id },
            select: { id: true, status: true, teacherId: true, title: true, date: true, startTime: true }
        });
        if (!classRecord) return res.status(404).json({ success: false, error: 'Занятие не найдено' });

        if (['completed', 'pending_admin_review'].includes(classRecord.status)) {
            return res.status(400).json({ success: false, error: 'Проведённый урок нельзя удалить. Используйте откат/возврат, чтобы сохранить историю.' });
        }
        await prisma.class.update({ where: { id }, data: { status: 'cancelled' } });
        await syncOfflineClassEvent('cancelled', classRecord);
        res.json({ success: true, message: 'Занятие отменено' });
    } catch (error) {
        console.error('Delete class error:', error);
        if (error.code === 'P2025') return res.status(404).json({ success: false, error: 'Занятие не найдено' });
        res.status(500).json({ success: false, error: 'Ошибка удаления' });
    }
});

// @route   GET /api/classes/pending-review/count
router.get('/pending-review/count', authenticate, requireAdmin, async (req, res) => {
    try {
        const count = await prisma.class.count({
            where: {
                isPractice: false,
                status: 'pending_admin_review'
            }
        });
        res.json({ success: true, count });
    } catch (error) {
        console.error('Pending review count error:', error);
        res.status(500).json({ success: false, error: 'Failed to count pending review' });
    }
});

// @route   GET /api/classes/pending-review
router.get('/pending-review', authenticate, requireAdmin, async (req, res) => {
    try {
        const classes = await prisma.class.findMany({
            where: {
                isPractice: false,
                status: 'pending_admin_review'
            },
            include: {
                group: { select: { id: true, name: true } },
                teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                originalTeacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                room: { select: { id: true, name: true } },
                individualStudent: { select: { id: true, name: true, lastName: true, middleName: true, dateOfBirth: true } },
                attendees: true
            },
            orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
            take: 100
        });

        res.json({
            success: true,
            classes: classes.map(cls => ({ ...cls, _id: cls.id }))
        });
    } catch (error) {
        console.error('Pending review list error:', error);
        res.status(500).json({ success: false, error: 'Failed to list pending review' });
    }
});

// @route   GET /api/classes/pending-attendance/count
router.get('/pending-attendance/count', authenticate, async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Получаем текущее время в формате "HH:MM" (по местному времени Астаны/Алматы если нужно, но toTimeString() даст локальное время сервера)
        // Лучше использовать дату и время относительно начала дня.
        // Чтобы избежать проблем с таймзонами, мы просто сравним время.
        
        const now = new Date();
        const currentHours = now.getHours().toString().padStart(2, '0');
        const currentMinutes = now.getMinutes().toString().padStart(2, '0');
        const currentTimeString = `${currentHours}:${currentMinutes}`;

        const count = await prisma.class.count({
            where: {
                isPractice: false,
                noOneAttended: false,
                status: { in: ['scheduled', 'started', 'not_filled'] },
                // Считаем «отмеченным» только если есть хоть один ученик с attended: true
                // Если все attended: false — занятие снова «не отмечено»
                attendees: {
                    none: { attended: true }
                },
                // Занятие должно иметь либо группу, либо индивидуального ученика
                OR: [
                    { 
                        groupId: { not: null },
                        date: { lt: today }
                    },
                    { 
                        groupId: { not: null },
                        date: today, 
                        endTime: { lt: currentTimeString }
                    },
                    { 
                        individualStudentId: { not: null },
                        date: { lt: today }
                    },
                    { 
                        individualStudentId: { not: null },
                        date: today, 
                        endTime: { lt: currentTimeString }
                    }
                ]
            }
        });

        res.json({ success: true, count });
    } catch (error) {
        console.error('Pending attendance count error:', error);
        res.status(500).json({ success: false, error: 'Failed to count pending attendance' });
    }
});

// @route   GET /api/classes/:id
// Get a single class by ID (placed after specific routes to avoid shadowing)
router.get('/:id', authenticate, async (req, res) => {
    try {
        const cls = await prisma.class.findUnique({
            where: { id: req.params.id },
            include: {
                group: { select: { id: true, name: true, currentStudents: true } },
                teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                originalTeacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                reviewedBy: { select: { id: true, name: true, lastName: true, middleName: true } },
                room: { select: { id: true, name: true, color: true } },
                individualStudent: { select: { id: true, name: true, lastName: true, middleName: true, dateOfBirth: true } },
                attendees: {
                    include: {
                        student: { select: { id: true, name: true, lastName: true, middleName: true, dateOfBirth: true, phone: true } }
                    }
                }
            }
        });

        if (!cls) {
            return res.status(404).json({ success: false, error: 'Занятие не найдено' });
        }

        const trialBooking = await prisma.booking.findUnique({
            where: { trialClassId: cls.id },
            select: {
                id: true,
                name: true,
                lastName: true,
                middleName: true,
                phone: true,
                direction: true,
                status: true,
                depositPaid: true,
                convertedToStudentId: true,
                cashTransactions: {
                    where: { category: 'trial_payment', type: 'income' },
                    select: { paymentMethod: true, date: true },
                    take: 1,
                },
            },
        });

        const mapped = {
            ...cls,
            classType: trialBooking ? 'trial' : cls.classType,
            _id: cls.id,
            group: cls.group ? { ...cls.group, _id: cls.group.id } : null,
            teacher: cls.teacher ? { ...cls.teacher, _id: cls.teacher.id } : null,
            originalTeacher: cls.originalTeacher ? { ...cls.originalTeacher, _id: cls.originalTeacher.id } : null,
            reviewedBy: cls.reviewedBy ? { ...cls.reviewedBy, _id: cls.reviewedBy.id } : null,
            room: cls.room ? { ...cls.room, _id: cls.room.id } : null,
            individualStudent: cls.individualStudent ? { ...cls.individualStudent, _id: cls.individualStudent.id } : null,
            attendees: (cls.attendees || []).map(attendee => ({
                ...attendee,
                _id: attendee.id,
                student: attendee.studentId,
                studentDetails: attendee.student ? { ...attendee.student, _id: attendee.student.id } : null
            })),
            trialBooking: trialBooking ? { ...trialBooking, _id: trialBooking.id } : null,
            depositPaid: Boolean(trialBooking?.depositPaid),
            trialPaymentMethod: trialBooking?.cashTransactions?.[0]?.paymentMethod || null,
            trialPaymentDate: trialBooking?.cashTransactions?.[0]?.date || null,
            trialParticipant: trialBooking && !cls.individualStudentId
                ? {
                    id: getTrialParticipantId(cls.id),
                    _id: getTrialParticipantId(cls.id),
                    name: trialBooking.name,
                    lastName: trialBooking.lastName,
                    middleName: trialBooking.middleName,
                    phone: trialBooking.phone,
                    direction: trialBooking.direction,
                    bookingId: trialBooking.id,
                    isLead: true,
                }
                : null,
        };

        res.json({ success: true, class: mapped });
    } catch (error) {
        console.error('Get class by ID error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения занятия' });
    }
});

// @route   POST /api/classes/generate-from-schedule
// Starts async generation and returns a jobId so the client can poll real progress.
router.post('/generate-from-schedule', authenticate, requireAdmin, async (req, res) => {
    try {
        const { period, roomId, startDate: startDateInput, endDate: endDateInput } = req.body;
        if (!period || !roomId) return res.status(400).json({ success: false, error: 'Параметры обязательны' });

        // Prevent parallel generation for the same room
        const activeJob = Array.from(generationJobs.values()).find(j => j.roomId === roomId && !j.done);
        if (activeJob) {
            try {
                await prisma.activityLog.create({
                    data: {
                        userId: req.user?.id || 'system',
                        action: 'schedule_generation_blocked_active_job',
                        entityType: 'Class',
                        details: `Генерация расписания для зала заблокирована: уже выполняется активная задача`,
                        metadata: { roomId }
                    }
                });
            } catch (e) {
                console.error('Failed to log active job conflict:', e);
            }
            return res.status(409).json({
                success: false,
                error: 'Генерация расписания для этого зала уже выполняется другим администратором или вкладкой.'
            });
        }

        const selectedRoom = await prisma.room.findUnique({ where: { id: roomId } });
        if (!selectedRoom) return res.status(400).json({ success: false, error: 'Зал не найден' });

        const groups = await prisma.group.findMany({
            where: { isActive: true },
            include: { schedules: true }
        });

        // Диапазон генерации: week / month — от сегодня, custom — от указанных дат.
        let startDate;
        let endDate;
        if (period === 'custom') {
            if (!startDateInput || !endDateInput) {
                return res.status(400).json({ success: false, error: 'Укажите startDate и endDate' });
            }
            startDate = new Date(startDateInput);
            endDate = new Date(endDateInput);
            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                return res.status(400).json({ success: false, error: 'Некорректный формат дат' });
            }
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(0, 0, 0, 0);
            if (endDate < startDate) {
                return res.status(400).json({ success: false, error: 'Дата окончания раньше даты начала' });
            }
            // Включаем endDate в диапазон (до начала следующего дня)
            endDate.setDate(endDate.getDate() + 1);
            const spanDays = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24));
            if (spanDays > 180) {
                return res.status(400).json({ success: false, error: 'Максимальный диапазон — 180 дней' });
            }
        } else {
            startDate = new Date();
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(startDate);
            if (period === 'week') endDate.setDate(endDate.getDate() + 7);
            else endDate.setDate(endDate.getDate() + 30);
        }

        // 1. Plan: build the full list of slots the schedules would produce in the range.
        const planned = [];
        for (const group of groups) {
            if (!group.schedules || !group.teacherId) continue;
            for (const scheduleItem of group.schedules) {
                const { dayOfWeek, time, duration } = scheduleItem;
                if (!time) continue;
                const cursor = new Date(startDate);
                while (cursor < endDate) {
                    const dow = cursor.getDay() === 0 ? 7 : cursor.getDay();
                    if (dow === dayOfWeek) {
                        const [hh, mm] = time.split(':');
                        const endAt = new Date(cursor);
                        endAt.setHours(parseInt(hh), parseInt(mm), 0, 0);
                        const normalizedDuration = normalizeLessonDuration(duration);
                        endAt.setMinutes(endAt.getMinutes() + normalizedDuration);
                        const endTimeStr = `${String(endAt.getHours()).padStart(2, '0')}:${String(endAt.getMinutes()).padStart(2, '0')}`;
                        planned.push({
                            groupId: group.id,
                            groupName: group.name,
                            teacherId: group.teacherId,
                            roomId,
                            title: group.name,
                            date: new Date(cursor),
                            startTime: time,
                            endTime: endTimeStr,
                            duration: normalizedDuration,
                            backgroundColor: group.color || selectedRoom.color || '#eb4d77'
                        });
                    }
                    cursor.setDate(cursor.getDate() + 1);
                }
            }
        }

        // 2. One-shot query for existing classes in the range.
        //    Важно: если в этот день у группы уже есть хотя бы одно занятие —
        //    НИЧЕГО не создаём для этой группы на эту дату, чтобы не задеть
        //    уже введённую посещаемость или руками смещённое время.
        const groupIds = groups.map(g => g.id);
        const existing = groupIds.length > 0
            ? await prisma.class.findMany({
                where: {
                    groupId: { in: groupIds },
                    date: { gte: startDate, lt: endDate }
                },
                select: { groupId: true, date: true, startTime: true }
            })
            : [];

        // Ключ по дню (не по времени): один класс на дату блокирует все слоты
        // этой же группы в тот же день.
        const dayKey = (groupId, date) => {
            const d = new Date(date);
            return `${groupId}|${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };
        const existingDaysSet = new Set(existing.map(e => dayKey(e.groupId, e.date)));

        const toCreate = planned.filter(p => !existingDaysSet.has(dayKey(p.groupId, p.date)));
        const skippedInitial = planned.length - toCreate.length;

        // 3. Register a job so the client can poll /generation-progress/:jobId.
        const jobId = createJobId();
        const job = {
            jobId,
            period,
            roomId,
            total: planned.length,
            toCreate: toCreate.length,
            processed: skippedInitial, // already-skipped count as processed
            created: 0,
            skipped: skippedInitial,
            done: toCreate.length === 0,
            error: null,
            createdClasses: [],
            skippedClasses: [],
            message: '',
            startedAt: Date.now(),
            finishedAt: toCreate.length === 0 ? Date.now() : null
        };
        generationJobs.set(jobId, job);

        // 4. Log the generation start
        try {
            await prisma.activityLog.create({
                data: {
                    userId: req.user?.id || 'system',
                    action: 'schedule_generation_started',
                    entityType: 'Class',
                    details: `Запущена генерация расписания для кабинета ${selectedRoom.name} (${periodText})`,
                    metadata: { period, roomId, startDate, endDate }
                }
            });
        } catch (e) {
            console.error('Failed to log schedule generation start:', e);
        }

        // 5. Respond immediately so the client can start polling.
        res.json({
            success: true,
            jobId,
            total: planned.length,
            toCreate: toCreate.length,
            skipped: skippedInitial
        });

        if (toCreate.length === 0) {
            job.message = 'Все занятия на выбранный период уже созданы';
            scheduleJobCleanup(jobId);
            return;
        }

        // 5. Run generation in background, batched for steady progress updates.
        const BATCH_SIZE = 10;
        (async () => {
            try {
                for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
                    const batch = toCreate.slice(i, i + BATCH_SIZE);
                    await prisma.class.createMany({
                        data: batch.map(p => ({
                            groupId: p.groupId,
                            teacherId: p.teacherId,
                            originalTeacherId: p.teacherId,
                            roomId: p.roomId,
                            title: p.title,
                            date: p.date,
                            startTime: p.startTime,
                            endTime: p.endTime,
                            duration: p.duration,
                            status: 'scheduled',
                            backgroundColor: p.backgroundColor,
                            notes: 'Сгенерировано'
                        })),
                        skipDuplicates: true
                    });
                    job.created += batch.length;
                    job.processed += batch.length;
                    for (const p of batch) {
                        job.createdClasses.push({ group: p.groupName, date: p.date, startTime: p.startTime });
                    }
                }
                job.message = `Создано занятий: ${job.created}`;
                
                // Log schedule generation completed
                try {
                    await prisma.activityLog.create({
                        data: {
                            userId: req.user?.id || 'system',
                            action: 'schedule_generation_completed',
                            entityType: 'Class',
                            details: `Успешно сгенерировано занятий: ${job.created} (пропущено дубликатов: ${job.skipped})`,
                            metadata: { jobId, created: job.created, skipped: job.skipped }
                        }
                    });
                } catch (e) {
                    console.error('Failed to log schedule generation completion:', e);
                }
            } catch (err) {
                console.error('Generate-from-schedule error:', err);
                job.error = err?.message || 'Ошибка генерации';
                
                try {
                    await prisma.activityLog.create({
                        data: {
                            userId: req.user?.id || 'system',
                            action: 'schedule_generation_failed',
                            entityType: 'Class',
                            details: `Генерация расписания завершилась ошибкой: ${job.error}`,
                            metadata: { jobId, error: job.error }
                        }
                    });
                } catch (e) {
                    console.error('Failed to log schedule generation failure:', e);
                }
            } finally {
                job.done = true;
                job.finishedAt = Date.now();
                scheduleJobCleanup(jobId);
            }
        })();
    } catch (error) {
        console.error('Generate-from-schedule init error:', error);
        res.status(500).json({ success: false, error: 'Ошибка генерации' });
    }
});

// @route   GET /api/classes/generation-progress/:jobId
// Returns the live progress of a background generation job.
router.get('/generation-progress/:jobId', authenticate, requireAdmin, (req, res) => {
    const job = generationJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Задача не найдена' });
    res.json({
        success: true,
        jobId: job.jobId,
        total: job.total,
        toCreate: job.toCreate,
        processed: job.processed,
        created: job.created,
        skipped: job.skipped,
        done: job.done,
        error: job.error,
        message: job.message,
        details: {
            createdClasses: job.createdClasses,
            skippedClasses: job.skippedClasses
        }
    });
});

// @route   PATCH /api/classes/:id
// Update class fields (e.g. teacherId, status, title, etc.)
router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const allowedFields = [
            'teacherId', 'roomId', 'title', 'date', 'startTime', 'endTime',
            'duration', 'status', 'notes', 'backgroundColor', 'isPractice',
            'classType', 'individualStudentId', 'price', 'managerId',
            'teacherPenaltyAmount', 'teacherPenaltyReason'
        ];

        const data = {};
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                if (field === 'date') {
                    data[field] = new Date(req.body[field]);
                } else if (field === 'teacherPenaltyAmount') {
                    data[field] = Math.max(0, Math.round(Number(req.body[field]) || 0));
                } else if (field === 'teacherPenaltyReason') {
                    data[field] = String(req.body[field] || '').trim() || null;
                } else {
                    data[field] = req.body[field];
                }
            }
        }
        const hasDepositPaidUpdate = req.body.depositPaid !== undefined;
        const nextDepositPaid = Boolean(req.body.depositPaid);
        const trialPaymentMethod = req.body.trialPaymentMethod || req.body.paymentMethod || null;

        if (Object.keys(data).length === 0 && !hasDepositPaidUpdate) {
            return res.status(400).json({ success: false, error: 'Нет данных для обновления' });
        }

        const current = await prisma.class.findUnique({
            where: { id },
            include: { attendees: { select: { studentId: true } } },
        });
        if (!current) return res.status(404).json({ success: false, error: 'Занятие не найдено' });
        const currentTrialBooking = current.classType === 'trial'
            ? { id: 'class-type-trial' }
            : await findTrialBookingForClass(prisma, current.id);
        if (hasDepositPaidUpdate && !isTrialClass(current, currentTrialBooking)) {
            return res.status(400).json({ success: false, error: 'Оплату диагностического урока можно отметить только у пробного занятия' });
        }
        if (
            current.status === 'completed'
            && ['teacherId', 'date', 'startTime', 'endTime', 'roomId', 'classType', 'isPractice', 'individualStudentId']
                .some(field => data[field] !== undefined)
        ) {
            return res.status(400).json({ success: false, error: 'Проведённый урок закрыт. Для исправлений используйте отдельное действие.' });
        }
        if (data.teacherId !== undefined && data.teacherId !== current.teacherId && !current.originalTeacherId) {
            data.originalTeacherId = current.teacherId || data.teacherId || null;
        }

        const updated = await prisma.$transaction(async (tx) => {
            const classUpdate = Object.keys(data).length > 0
                ? await tx.class.update({
                    where: { id },
                    data,
                    include: {
                        group: { select: { id: true, name: true } },
                        teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                        originalTeacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                        room: { select: { id: true, name: true, color: true } }
                    }
                })
                : await tx.class.findUnique({
                    where: { id },
                    include: {
                        group: { select: { id: true, name: true } },
                        teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                        originalTeacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                        room: { select: { id: true, name: true, color: true } }
                    }
                });

            if (hasDepositPaidUpdate) {
                const linkedBooking = await tx.booking.findUnique({
                    where: { trialClassId: id },
                });
                if (!linkedBooking) {
                    const error = new Error('Для этого пробного занятия не найдена связанная заявка');
                    error.code = 'TRIAL_BOOKING_NOT_FOUND';
                    throw error;
                }
                await syncTrialPayment(tx, linkedBooking, {
                    paid: nextDepositPaid,
                    actorId: req.user.id,
                    paymentMethod: trialPaymentMethod,
                });
                await tx.booking.update({
                    where: { id: linkedBooking.id },
                    data: { depositPaid: nextDepositPaid },
                });
            }

            if (['completed', 'cancelled'].includes(classUpdate.status)) {
                await syncClassPayrollSnapshot(tx, id);
            }

            return classUpdate;
        });

        if (data.teacherId !== undefined && data.teacherId !== current.teacherId) {
            logLessonAction(req.user?.id, 'teacher_replaced', updated, {
                details: `Замена преподавателя: ${updated.title}`,
                oldTeacherId: current.teacherId,
                newTeacherId: data.teacherId,
                originalTeacherId: updated.originalTeacherId
            }).catch(() => {});
        }

        if (updated.status === 'cancelled' && current.status !== 'cancelled') {
            await syncOfflineClassEvent('cancelled', updated);
        } else if (
            current.status !== 'cancelled'
            && ['date', 'startTime', 'endTime', 'roomId', 'teacherId'].some((field) => data[field] !== undefined)
        ) {
            await syncOfflineClassEvent('rescheduled', updated);
        }

        res.json({
            success: true,
            class: {
                ...updated,
                _id: updated.id,
                ...(hasDepositPaidUpdate ? { depositPaid: nextDepositPaid } : {})
            }
        });
    } catch (error) {
        console.error('Update class error:', error);
        if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message });
        if (error.code === 'TRIAL_BOOKING_NOT_FOUND') return res.status(404).json({ success: false, error: error.message });
        if (error.code === 'P2025') return res.status(404).json({ success: false, error: 'Занятие не найдено' });
        res.status(500).json({ success: false, error: 'Ошибка обновления занятия' });
    }
});

// @route   POST /api/classes/:id/attendance
// Отметка посещаемости без списания. Списание — только при подтверждении админом (POST /approve).
router.post('/:id/attendance', authenticate, requireAdmin, async (req, res) => {
    try {
        const classId = req.params.id;
        const { studentId, attended, attendanceStatus } = req.body;

        const allowedStatuses = ['unmarked', 'present', 'late', 'excused_absence', 'unexcused_absence', 'emergency_freeze'];
        const normalizedStatus = allowedStatuses.includes(attendanceStatus)
            ? attendanceStatus
            : (attended ? 'present' : 'excused_absence');
        const isPresent = ['present', 'late'].includes(normalizedStatus);
        const attendee = await prisma.$transaction(async (tx) => {
            const lockedClasses = await tx.$queryRaw`
                SELECT * FROM "Class" WHERE id = ${classId} FOR UPDATE
            `;
            const classRecord = lockedClasses[0];
            if (!classRecord) {
                const error = new Error('Занятие не найдено');
                error.code = 'CLASS_NOT_FOUND';
                throw error;
            }
            if (classRecord.status === 'completed' || classRecord.status === 'cancelled') {
                const error = new Error('Занятие уже закрыто');
                error.code = 'CLASS_CLOSED';
                throw error;
            }

            const trialBooking = classRecord.classType === 'trial'
                ? { id: 'class-type-trial' }
                : await findTrialBookingForClass(tx, classRecord.id);
            const isVirtualTrial = isVirtualTrialClass(classRecord, trialBooking);
            if (!studentId && !isVirtualTrial) {
                const error = new Error('studentId обязателен');
                error.code = 'STUDENT_REQUIRED';
                throw error;
            }
            if (isVirtualTrial && studentId && !isTrialParticipantId(studentId, classId)) {
                const error = new Error('Для пробного без карточки ученика используйте участника заявки');
                error.code = 'TRIAL_PARTICIPANT_REQUIRED';
                throw error;
            }
            const normalizedStudentId = isVirtualTrial ? null : studentId;

            const saved = await upsertClassAttendee(classId, normalizedStudentId, {
                attended: isPresent,
                attendanceStatus: normalizedStatus,
                autoDeducted: false,
                markedAt: normalizedStatus === 'unmarked' ? null : new Date()
            }, tx);

            const updateData = {};
            if (
                isPresent
                && (classRecord.noOneAttended || ['not_held', 'no_submission'].includes(classRecord.teacherOutcomeHint))
            ) {
                updateData.noOneAttended = false;
                updateData.teacherOutcomeHint = 'held';
            }
            if (Object.keys(updateData).length > 0) {
                await tx.class.update({ where: { id: classId }, data: updateData });
            }
            return saved;
        });

        const isVirtualTrial = !attendee?.studentId;
        res.json({
            success: true,
            attendee: attendee
                ? {
                    ...attendee,
                    studentId: isVirtualTrial ? getTrialParticipantId(classId) : attendee.studentId,
                    _id: attendee.id,
                }
                : null,
        });
    } catch (error) {
        console.error('Save attendance error:', error);
        if (error.code === 'CLASS_NOT_FOUND') {
            return res.status(404).json({ success: false, error: error.message });
        }
        if (error.code === 'CLASS_CLOSED') {
            return res.status(409).json({ success: false, error: error.message });
        }
        if (error.code === 'STUDENT_REQUIRED' || error.code === 'TRIAL_PARTICIPANT_REQUIRED') {
            return res.status(400).json({ success: false, error: error.message });
        }
        res.status(500).json({ success: false, error: 'Ошибка сохранения посещаемости' });
    }
});

// @route   POST /api/classes/:id/start
router.post('/:id/start', authenticate, requireAdmin, async (req, res) => {
    try {
        const classRecord = await prisma.class.findUnique({ where: { id: req.params.id } });
        if (!classRecord) {
            return res.status(404).json({ success: false, error: 'Занятие не найдено' });
        }
        if (classRecord.status !== 'scheduled') {
            return res.status(400).json({ success: false, error: 'Урок уже начат или закрыт' });
        }

        const updated = await prisma.class.update({
            where: { id: req.params.id },
            data: { status: 'started' }
        });

        res.json({ success: true, class: { ...updated, _id: updated.id } });
    } catch (error) {
        console.error('Start class error:', error);
        res.status(500).json({ success: false, error: 'Ошибка начала урока' });
    }
});

// @route   POST /api/classes/:id/submit-review
// Преподаватель отправляет тему/ДЗ на подтверждение админу (без списания).
router.post('/:id/submit-review', authenticate, requireTeacherOrAdmin, async (req, res) => {
    try {
        const {
            topic, lessonGoals, lessonSummary, homeworkDraft, nextLessonFocus,
            materials, teacherComment, teacherOutcomeHint, trialReport,
            teacherPenaltyAmount, teacherPenaltyReason
        } = req.body;
        const classRecord = await prisma.class.findUnique({ where: { id: req.params.id } });
        if (!classRecord) {
            return res.status(404).json({ success: false, error: 'Занятие не найдено' });
        }

        if (req.user?.role === 'teacher' && classRecord.teacherId !== req.user.id) {
            return res.status(403).json({ success: false, error: 'Можно отправить отчёт только по своему уроку' });
        }

        if (['completed', 'cancelled'].includes(classRecord.status)) {
            return res.status(400).json({ success: false, error: 'Занятие уже закрыто' });
        }

        const trialBooking = classRecord.classType === 'trial'
            ? { id: 'class-type-trial' }
            : await findTrialBookingForClass(prisma, classRecord.id);
        const isTrial = isTrialClass(classRecord, trialBooking);
        const normalizedTrialReport = isTrial && trialReport !== undefined
            ? normalizeTrialReport(trialReport, classRecord, { teacherOnly: req.user?.role === 'teacher' })
            : null;
        const trialDerived = normalizedTrialReport ? buildTrialReportDerivedFields(normalizedTrialReport) : {};
        const finalTopic = topic ?? trialDerived.topic ?? classRecord.topic;
        const finalSummary = lessonSummary ?? trialDerived.lessonSummary ?? classRecord.lessonSummary;
        const rosterState = await loadLessonRosterState(prisma, classRecord);
        const submission = validateLessonSubmission({
            rosterState,
            topic: finalTopic,
            lessonSummary: finalSummary,
        });
        if (!submission.success) {
            return res.status(400).json({
                success: false,
                error: submission.error,
                code: submission.code,
            });
        }

        if (req.user?.role === 'teacher' && submission.requiresReport && !isClassReportSubmittable(classRecord)) {
            return res.status(400).json({
                success: false,
                error: `Полный отчёт можно отправить за ${REPORT_SUBMISSION_LEAD_MINUTES} минут до окончания урока`,
                code: 'REPORT_SUBMISSION_TOO_EARLY',
            });
        }
        if (req.user?.role === 'teacher' && !submission.requiresReport && !isClassEnded(classRecord)) {
            return res.status(400).json({
                success: false,
                error: 'Передать отметку об отсутствии можно после окончания урока',
                code: 'ATTENDANCE_SUBMISSION_TOO_EARLY',
            });
        }

        const updated = await prisma.class.update({
            where: { id: req.params.id },
            data: {
                topic: submission.requiresReport ? finalTopic : null,
                lessonGoals: submission.requiresReport ? (lessonGoals ?? classRecord.lessonGoals) : null,
                lessonSummary: submission.requiresReport ? finalSummary : null,
                homeworkDraft: submission.requiresReport
                    ? (homeworkDraft ?? trialDerived.homeworkDraft ?? classRecord.homeworkDraft)
                    : null,
                nextLessonFocus: submission.requiresReport
                    ? (nextLessonFocus ?? trialDerived.nextLessonFocus ?? classRecord.nextLessonFocus)
                    : null,
                materials: submission.requiresReport ? (materials ?? classRecord.materials) : undefined,
                teacherComment: teacherComment ?? trialDerived.teacherComment ?? classRecord.teacherComment,
                trialReport: submission.requiresReport ? (normalizedTrialReport || classRecord.trialReport) : undefined,
                teacherOutcomeHint: submission.outcome,
                teacherPenaltyAmount: teacherPenaltyAmount !== undefined
                    ? Math.max(0, Math.round(Number(teacherPenaltyAmount) || 0))
                    : classRecord.teacherPenaltyAmount,
                teacherPenaltyReason: teacherPenaltyReason !== undefined
                    ? (String(teacherPenaltyReason || '').trim() || null)
                    : classRecord.teacherPenaltyReason,
                submittedAt: new Date(),
                submittedById: req.user.id,
                status: 'pending_admin_review'
            }
        });

        await logLessonAction(req.user?.id, 'lesson_submitted_for_review', updated, {
            details: `Урок отправлен на подтверждение: ${updated.title}`,
            teacherOutcomeHint: submission.outcome,
            hasTrialReport: Boolean(updated.trialReport)
        });
        notify('lesson.pending_review', { classRecord: updated }).catch(() => {});

        res.json({ success: true, class: { ...updated, _id: updated.id } });
    } catch (error) {
        console.error('Submit review error:', error);
        res.status(500).json({ success: false, error: 'Ошибка отправки на подтверждение' });
    }
});

// @route   POST /api/classes/:id/approve
// Админ подтверждает урок и списывает занятия с абонементов (только админ).
router.post('/:id/approve', authenticate, requireAdmin, async (req, res) => {
    try {
        const {
            deduct = true, topic, lessonGoals, lessonSummary, homeworkDraft,
            nextLessonFocus, materials, teacherComment, trialReport, billingDecisions = [],
            teacherPenaltyAmount, teacherPenaltyReason, depositPaid, trialPaymentMethod
        } = req.body;
        const classId = req.params.id;
        const decisions = Array.isArray(billingDecisions) ? billingDecisions : [];
        const result = await prisma.$transaction(async (tx) => {
            const lockedClasses = await tx.$queryRaw`
                SELECT * FROM "Class" WHERE id = ${classId} FOR UPDATE
            `;
            const classRecord = lockedClasses[0];

            const approval = canApproveClass(classRecord);
            if (!approval.allowed) {
                return { errorStatus: approval.status, errorMessage: approval.reason };
            }

            const trialBooking = classRecord.classType === 'trial'
                ? { id: 'class-type-trial' }
                : await findTrialBookingForClass(tx, classRecord.id);
            const isTrial = isTrialClass(classRecord, trialBooking);
            const normalizedTrialReport = isTrial && trialReport !== undefined
                ? normalizeTrialReport(trialReport, classRecord)
                : null;
            const trialDerived = normalizedTrialReport
                ? buildTrialReportDerivedFields(normalizedTrialReport)
                : (isTrial && classRecord.trialReport ? buildTrialReportDerivedFields(classRecord.trialReport) : {});
            const finalTopic = topic !== undefined ? topic : (trialDerived.topic || classRecord.topic);
            const finalSummary = lessonSummary !== undefined ? lessonSummary : (trialDerived.lessonSummary || classRecord.lessonSummary);
            if (
                !['not_held', 'no_submission'].includes(classRecord.teacherOutcomeHint)
                && (!finalTopic?.trim() || !finalSummary?.trim())
            ) {
                return { errorStatus: 400, errorMessage: 'Для подтверждения заполните тему и итог урока' };
            }

            const deductions = [];
            const existingAttendees = await tx.classAttendee.findMany({ where: { classId } });
            const virtualTrialHeld = isVirtualTrialClass(classRecord, trialBooking)
                && existingAttendees.some(attendee => !attendee.studentId && isHeldAttendance(attendee.attendanceStatus));
            const hasHeldStudents = decisions.some(d => isHeldAttendance(d.attendanceStatus)) || virtualTrialHeld;

            if (!classRecord.isPractice && deduct) {
                // Виртуальный участник пробного хранит факт посещения заявки.
                // Его нельзя удалять и превращать в обычного ученика при подтверждении.
                const keepVirtualTrialAttendee = isVirtualTrialClass(classRecord, trialBooking);
                if (!keepVirtualTrialAttendee) {
                    await tx.classAttendee.deleteMany({ where: { classId } });
                }

                for (const decision of decisions) {
                    const studentId = decision.studentId;
                    if (!studentId) continue;
                    if (keepVirtualTrialAttendee && isTrialParticipantId(studentId, classId)) continue;
                    const status = decision.attendanceStatus || 'present';
                    const isPresent = isPresentAttendance(status);

                    const attendee = await tx.classAttendee.create({
                        data: {
                            classId,
                            studentId,
                            attended: isPresent,
                            attendanceStatus: status,
                            markedAt: new Date()
                        }
                    });

                    const shouldCharge = shouldChargeAttendance(status);
                    const shouldUseFreeze = isEmergencyFreezeAttendance(status);
                    if (shouldUseFreeze) {
                        const membershipId = decision.membershipId || null;
                        const freezeResult = await useEmergencyFreezeForClass(
                            studentId,
                            classRecord,
                            req.user.id,
                            tx,
                            membershipId
                        );
                        if (!freezeResult.frozen) {
                            const error = new Error(`Не удалось списать заморозку ученика ${studentId}: ${freezeResult.reason}`);
                            error.statusCode = 400;
                            throw error;
                        }
                        await tx.classAttendee.update({
                            where: { id: attendee.id },
                            data: {
                                chargeAmount: 0,
                                chargedMembershipId: freezeResult.membershipId,
                                chargeSource: 'emergency_freeze',
                                autoDeducted: false
                            }
                        });
                        deductions.push({
                            studentId,
                            amount: 0,
                            balanceAfter: null,
                            debtCreated: false,
                            freezeUsed: true,
                            ...freezeResult
                        });
                    }
                    if (shouldCharge) {
                        const amount = Math.max(0, Math.round(Number(decision.amount) || 0));
                        const membershipId = decision.membershipId || null;
                        let result = { deducted: false, reason: 'no_membership_selected' };

                        if (membershipId) {
                            result = await deductMembershipForClass(
                                studentId,
                                classRecord,
                                req.user.id,
                                tx,
                                membershipId
                            );
                            if (!result.deducted) {
                                const student = await tx.student.findUnique({
                                    where: { id: studentId },
                                    select: { name: true, lastName: true, middleName: true },
                                });
                                const error = new Error(`${formatCrmFio(student, 'Ученик')}: не удалось списать выбранный абонемент — ${deductionFailureText(result.reason)}.`);
                                error.statusCode = 400;
                                throw error;
                            }
                        }

                        let balanceAfter = 0;
                        if (amount > 0) {
                            const student = await tx.student.update({
                                where: { id: studentId },
                                data: { accountBalance: { decrement: amount } },
                                select: { accountBalance: true }
                            });
                            balanceAfter = student.accountBalance;
                        } else {
                            const student = await tx.student.findUnique({
                                where: { id: studentId },
                                select: { accountBalance: true }
                            });
                            balanceAfter = student?.accountBalance || 0;
                        }

                        await tx.classAttendee.update({
                            where: { id: attendee.id },
                            data: {
                                chargeAmount: amount,
                                chargedMembershipId: membershipId,
                                chargeSource: membershipId ? 'membership' : 'balance_only',
                                autoDeducted: Boolean(result.deducted)
                            }
                        });

                        deductions.push({
                            studentId,
                            amount,
                            balanceAfter,
                            debtCreated: balanceAfter < 0,
                            ...result
                        });
                    }
                }
            }

            const updatePayload = {
                status: 'completed',
                reviewedAt: new Date(),
                reviewedById: req.user.id,
                autoDeductionDone: deductions.some(d => d.deducted),
                noOneAttended: classRecord.isPractice ? false : !hasHeldStudents
            };

            if (topic !== undefined || trialDerived.topic) updatePayload.topic = topic !== undefined ? topic : trialDerived.topic;
            if (lessonGoals !== undefined) updatePayload.lessonGoals = lessonGoals;
            if (lessonSummary !== undefined || trialDerived.lessonSummary) updatePayload.lessonSummary = lessonSummary !== undefined ? lessonSummary : trialDerived.lessonSummary;
            if (homeworkDraft !== undefined || trialDerived.homeworkDraft) updatePayload.homeworkDraft = homeworkDraft !== undefined ? homeworkDraft : trialDerived.homeworkDraft;
            if (nextLessonFocus !== undefined || trialDerived.nextLessonFocus) updatePayload.nextLessonFocus = nextLessonFocus !== undefined ? nextLessonFocus : trialDerived.nextLessonFocus;
            if (materials !== undefined) updatePayload.materials = materials;
            if (teacherComment !== undefined || trialDerived.teacherComment) updatePayload.teacherComment = teacherComment !== undefined ? teacherComment : trialDerived.teacherComment;
            if (normalizedTrialReport) updatePayload.trialReport = normalizedTrialReport;
            if (teacherPenaltyAmount !== undefined) {
                updatePayload.teacherPenaltyAmount = Math.max(0, Math.round(Number(teacherPenaltyAmount) || 0));
            }
            if (teacherPenaltyReason !== undefined) {
                updatePayload.teacherPenaltyReason = String(teacherPenaltyReason || '').trim() || null;
            }

            const updated = await tx.class.update({
                where: { id: classId },
                data: updatePayload
            });

            if (isTrial) {
                const linkedBooking = trialBooking?.id === 'class-type-trial'
                    ? await findTrialBookingForClass(tx, updated.id)
                    : trialBooking;
                if (linkedBooking) {
                    const nextDepositPaid = depositPaid !== undefined
                        ? Boolean(depositPaid)
                        : Boolean(linkedBooking.depositPaid);
                    await syncTrialPayment(tx, linkedBooking, {
                        paid: nextDepositPaid,
                        actorId: req.user.id,
                        paymentMethod: trialPaymentMethod,
                    });
                    await tx.booking.update({
                        where: { id: linkedBooking.id },
                        data: {
                            status: ['trial', 'thinking', 'processed', 'new'].includes(linkedBooking.status)
                                ? 'thinking'
                                : linkedBooking.status,
                            trialFunnelStage: 'held',
                            trialNextAction: defaultTrialNextAction('held'),
                            trialNextActionAt: new Date(),
                            ...(depositPaid !== undefined ? { depositPaid: nextDepositPaid } : {}),
                            trialManagerId: linkedBooking.trialManagerId || (req.user.isDemoUser ? null : req.user.id),
                            processedById: req.user.id,
                            processedAt: new Date(),
                        },
                    });
                }
            }

            await syncClassPayrollSnapshot(tx, updated.id);

            return { updated, deductions };
        });

        if (result.errorStatus) {
            return res.status(result.errorStatus).json({ success: false, error: result.errorMessage });
        }

        await logLessonAction(req.user?.id, 'lesson_approved', result.updated, {
            details: `Урок подтверждён: ${result.updated.title}`,
            deductions: result.deductions
        });
        notify('lesson.approved', {
            classRecord: result.updated,
            deductions: result.deductions
        }).catch(() => {});

        res.json({
            success: true,
            class: { ...result.updated, _id: result.updated.id },
            deductions: result.deductions
        });
    } catch (error) {
        console.error('Approve class error:', error);
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message });
        }
        res.status(500).json({ success: false, error: 'Ошибка подтверждения урока' });
    }
});

// @route   POST /api/classes/:id/trial-analysis
// Generate and download a student-facing DOCX analysis for a trial lesson.
router.post('/:id/trial-analysis', authenticate, requireAdmin, async (req, res) => {
    try {
        const agentUrl = String(process.env.TRIAL_ANALYSIS_AGENT_URL || '').trim();
        if (agentUrl && isDirectOpenAiEndpoint(agentUrl)) {
            return res.status(503).json({
                success: false,
                error: 'TRIAL_ANALYSIS_AGENT_URL должен указывать на отдельный агент, который принимает CRM JSON и возвращает структурированный JSON анализа. Нельзя указывать прямой endpoint OpenAI API.'
            });
        }

        const classRecord = await prisma.class.findUnique({
            where: { id: req.params.id },
            include: {
                group: { select: { id: true, name: true, direction: true } },
                teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                room: { select: { id: true, name: true } },
                individualStudent: {
                    select: {
                        id: true,
                        name: true,
                        lastName: true,
                        middleName: true,
                        dateOfBirth: true,
                        phone: true,
                        learningDirections: true,
                    }
                },
                attendees: {
                    include: {
                        student: {
                            select: {
                                id: true,
                                name: true,
                                lastName: true,
                                middleName: true,
                                dateOfBirth: true,
                                phone: true,
                                learningDirections: true,
                            }
                        }
                    }
                }
            }
        });

        if (!classRecord) {
            return res.status(404).json({ success: false, error: 'Занятие не найдено' });
        }
        const trialBooking = await prisma.booking.findUnique({
            where: { trialClassId: classRecord.id },
            select: {
                id: true,
                name: true,
                lastName: true,
                middleName: true,
                phone: true,
                dateOfBirth: true,
                direction: true,
            },
        });
        if (!isTrialClass(classRecord, trialBooking)) {
            return res.status(400).json({ success: false, error: 'AI-анализ доступен только для пробного урока' });
        }

        const normalizedTrialReport = req.body?.trialReport
            ? normalizeTrialReport(req.body.trialReport, classRecord)
            : classRecord.trialReport;
        if (!normalizedTrialReport) {
            return res.status(400).json({ success: false, error: 'Заполните анкету пробного урока перед скачиванием анализа' });
        }

        const payload = buildTrialAnalysisPayload(classRecord, normalizedTrialReport, trialBooking);
        const docx = await generateParentTrialAnalysisDocx(payload, agentUrl);
        if (!docx.buffer?.length) {
            return res.status(502).json({ success: false, error: 'AI-анализ вернул пустой Word-файл' });
        }

        await prisma.class.update({
            where: { id: classRecord.id },
            data: {
                trialReport: normalizedTrialReport,
                trialAiAnalysis: {
                    generatedAt: new Date().toISOString(),
                    fileName: docx.fileName,
                    agentConfigured: Boolean(agentUrl),
                    source: docx.source || 'local_fallback',
                    model: docx.model || null,
                    promptVersion: TRIAL_ANALYSIS_PROMPT_VERSION,
                    documentTemplate: 'crm_parent_safe',
                    status: 'generated',
                }
            }
        });

        const linkedBooking = await prisma.booking.findUnique({ where: { trialClassId: classRecord.id } });
        if (linkedBooking && linkedBooking.status !== 'sold' && linkedBooking.status !== 'rejected') {
            await prisma.booking.update({
                where: { id: linkedBooking.id },
                data: {
                    trialFunnelStage: 'analysis_ready',
                    trialNextAction: defaultTrialNextAction('analysis_ready'),
                    trialNextActionAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                    trialManagerId: linkedBooking.trialManagerId || (req.user.isDemoUser ? null : req.user.id),
                },
            });
        }

        res.setHeader('Content-Type', docx.contentType);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(docx.fileName)}`);
        res.setHeader('Content-Length', docx.buffer.length);
        return res.send(docx.buffer);
    } catch (error) {
        console.error('Trial analysis generation error:', error);
        res.status(error.statusCode || 500).json({
            success: false,
            error: error.message || 'Не удалось сформировать анализ пробного урока'
        });
    }
});

router.post('/:id/return-to-teacher', authenticate, requireAdmin, async (req, res) => {
    try {
        const result = await returnClassToTeacher(req.params.id, req.user.id, req.body?.reason);
        if (!result.success) return res.status(result.status || 400).json(result);
        return res.json(result);
    } catch (error) {
        console.error('Return class to teacher error:', error);
        return res.status(500).json({ success: false, error: 'Не удалось вернуть урок преподавателю' });
    }
});

router.post('/:id/reopen', authenticate, requireAdmin, async (req, res) => {
    try {
        const result = await reopenClass(req.params.id, req.user.id, req.body?.reason);
        if (!result.success) return res.status(result.status || 400).json(result);
        return res.json(result);
    } catch (error) {
        console.error('Reopen class error:', error);
        return res.status(500).json({ success: false, error: 'Не удалось открыть урок повторно' });
    }
});

// @route   GET /api/classes/:id/billing-options
// Варианты списания по каждому присутствовавшему ученику перед подтверждением.
router.get('/:id/billing-options', authenticate, requireAdmin, async (req, res) => {
    try {
        const requestedStudentIds = String(req.query.studentIds || '')
            .split(',')
            .map(id => id.trim())
            .filter(Boolean);

        const classRecord = await prisma.class.findUnique({ where: { id: req.params.id } });
        if (!classRecord) return res.status(404).json({ success: false, error: 'Занятие не найдено' });

        const membershipDateFilter = {
            status: 'active',
            startDate: { lte: classRecord.date },
            endDate: { gte: classRecord.date },
        };

        const classAttendees = await prisma.classAttendee.findMany({
            where: { classId: classRecord.id, attended: true, studentId: { not: null } },
            include: {
                student: {
                    select: {
                        id: true, name: true, lastName: true, middleName: true, dateOfBirth: true, accountBalance: true,
                        memberships: {
                            where: membershipDateFilter,
                            include: {
                                plan: { select: { name: true } },
                                group: { select: { name: true } },
                            },
                            orderBy: { createdAt: 'desc' },
                        },
                    },
                },
            },
        });

        const requestedStudents = requestedStudentIds.length
            ? await prisma.student.findMany({
                where: { id: { in: requestedStudentIds }, role: 'student' },
                select: {
                    id: true, name: true, lastName: true, dateOfBirth: true, accountBalance: true,
                    middleName: true,
                    memberships: {
                        where: membershipDateFilter,
                        include: {
                            plan: { select: { name: true } },
                            group: { select: { name: true } }
                        },
                        orderBy: { createdAt: 'desc' }
                    }
                }
            })
            : [];
        const requestedStudentById = new Map(requestedStudents.map(student => [student.id, student]));

        const fallbackPrice = classRecord.price > 0
            ? classRecord.price
            : (classRecord.classType === 'individual' ? 4000 : classRecord.classType === 'group' ? 1200 : 1000);

        const studentRecords = requestedStudentIds.length
            ? requestedStudentIds.map(id => requestedStudentById.get(id)).filter(Boolean)
            : classAttendees.map(attendee => attendee.student);

        const students = studentRecords.map(student => {
            const memberships = student.memberships
                .filter(membership => membershipSupportsClass(membership, classRecord))
                .map(membership => ({
                    id: membership.id,
                    name: membership.plan?.name || membership.type,
                    groupName: membership.group?.name || 'Общий',
                    classesRemaining: membership.classesRemaining,
                    lessonPrice: membership.totalClasses > 0
                        ? Math.round(membership.totalPrice / membership.totalClasses)
                        : fallbackPrice
                }));
            return {
                studentId: student.id,
                name: formatCrmFio(student),
                dateOfBirth: student.dateOfBirth,
                accountBalance: student.accountBalance,
                memberships,
                suggestedMembershipId: memberships[0]?.id || null,
                suggestedAmount: memberships[0]?.lessonPrice || fallbackPrice
            };
        });

        return res.json({ success: true, students });
    } catch (error) {
        console.error('Billing options error:', error);
        return res.status(500).json({ success: false, error: 'Не удалось подготовить списания' });
    }
});

// @route   POST /api/classes/:id/mark-no-one-attended
// Сигнал «никто не пришёл» → на подтверждение админу (без автосписания).
router.post('/:id/mark-no-one-attended', authenticate, requireTeacherOrAdmin, async (req, res) => {
    try {
        const classId = req.params.id;

        const classRecord = await prisma.class.findUnique({ where: { id: classId } });
        if (!classRecord) {
            return res.status(404).json({ success: false, error: 'Занятие не найдено' });
        }
        if (['completed', 'cancelled'].includes(classRecord.status)) {
            return res.status(400).json({ success: false, error: 'Урок уже закрыт' });
        }

        await refundAllDeductionsForClass(
            classRecord,
            req.user.id,
            null,
            `Возврат (никто не пришёл): ${classRecord.title}`
        );

        await prisma.classAttendee.deleteMany({ where: { classId } });

        const updated = await prisma.class.update({
            where: { id: classId },
            data: {
                noOneAttended: true,
                teacherOutcomeHint: 'not_held',
                status: 'pending_admin_review',
                submittedAt: new Date(),
                submittedById: req.user.id
            }
        });

        await logLessonAction(req.user?.id, 'lesson_no_one_attended', updated, {
            details: `Никто не пришёл: ${updated.title}`
        });

        res.json({
            success: true,
            message: 'Отправлено на подтверждение: никто не пришёл',
            class: { ...updated, _id: updated.id }
        });
    } catch (error) {
        console.error('Mark no-one-attended error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при отметке' });
    }
});

// @route   POST /api/classes/:id/postpone
// @route   POST /api/classes/:id/postpone
router.post('/:id/postpone', authenticate, requireTeacherOrAdmin, async (req, res) => {
    try {
        const classId = req.params.id;

        const result = await prisma.$transaction(async (tx) => {
            // Lock the Class row for update
            const classRecords = await tx.$queryRaw`
                SELECT * FROM "Class" WHERE id = ${classId} FOR UPDATE
            `;
            const classRecord = classRecords[0];

            if (!classRecord) {
                return { errorStatus: 404, errorMessage: 'Занятие не найдено' };
            }
            if (['completed', 'cancelled'].includes(classRecord.status)) {
                return { errorStatus: 400, errorMessage: 'Урок уже закрыт' };
            }

            const studentsToProcess = [];
            if (classRecord.classType === 'individual' && classRecord.individualStudentId) {
                studentsToProcess.push(classRecord.individualStudentId);
            } else {
                const attendees = await tx.classAttendee.findMany({ where: { classId } });
                attendees.forEach(a => {
                    if (a.studentId) studentsToProcess.push(a.studentId);
                });
            }
            const uniqueStudentIds = [...new Set(studentsToProcess)];
            const studentsById = new Map(
                (await tx.student.findMany({
                    where: { id: { in: uniqueStudentIds } },
                    select: { id: true, name: true, lastName: true, middleName: true },
                })).map(student => [student.id, student])
            );

            const now = new Date();
            const classDate = new Date(classRecord.date);
            const isSameDay = classDate.toDateString() === now.toDateString();

            const [hours, minutes] = classRecord.startTime.split(':');
            const classStartDateTime = new Date(classRecord.date);
            classStartDateTime.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);

            const diffMinutes = (classStartDateTime - now) / (60 * 1000);
            const outcomes = [];

            if (isSameDay) {
                for (const studentId of studentsToProcess) {
                    let attendee = await tx.classAttendee.findFirst({
                        where: { classId, studentId }
                    });

                    if (diffMinutes < 30) {
                        // Экстренная отмена
                        const membership = await findMembershipForClass(studentId, classRecord, tx);
                        if (membership && membership.emergencyFreezesAvailable !== null && membership.emergencyFreezesAvailable > 0) {
                            // Используем экстренную заморозку
                            await tx.membership.update({
                                where: { id: membership.id },
                                data: {
                                    emergencyFreezesAvailable: { decrement: 1 },
                                    emergencyFreezesUsed: { increment: 1 }
                                }
                            });
                            await tx.membershipTransaction.create({
                                data: {
                                    membershipId: membership.id,
                                    type: 'freeze_used',
                                    amount: 0,
                                    reason: `Экстренная заморозка (отмена <30 мин): ${classRecord.title}`,
                                    classId: classRecord.id,
                                    addedById: req.user.id
                                }
                            });

                            if (!attendee) {
                                attendee = await tx.classAttendee.create({
                                    data: { classId, studentId, attended: false, attendanceStatus: 'emergency_freeze', autoDeducted: false }
                                });
                            } else {
                                await tx.classAttendee.update({
                                    where: { id: attendee.id },
                                    data: { attended: false, attendanceStatus: 'emergency_freeze', autoDeducted: false }
                                });
                            }
                            outcomes.push(buildPostponeOutcome(studentsById.get(studentId), {
                                studentId,
                                outcome: 'emergency_freeze_used',
                                membershipId: membership.id,
                            }));
                        } else {
                            // Списание (прогул)
                            const resDeduct = await deductMembershipForClass(studentId, classRecord, req.user.id, tx);
                            if (!attendee) {
                                attendee = await tx.classAttendee.create({
                                    data: { classId, studentId, attended: false, attendanceStatus: 'unexcused_absence', autoDeducted: resDeduct.deducted }
                                });
                            } else {
                                await tx.classAttendee.update({
                                    where: { id: attendee.id },
                                    data: { attended: false, attendanceStatus: 'unexcused_absence', autoDeducted: resDeduct.deducted }
                                });
                            }
                            outcomes.push(buildPostponeOutcome(studentsById.get(studentId), {
                                studentId,
                                outcome: 'deducted_late',
                                ...resDeduct,
                            }));
                        }
                    } else {
                        // Обычная отмена день-в-день: списание (прогул)
                        const resDeduct = await deductMembershipForClass(studentId, classRecord, req.user.id, tx);
                        if (!attendee) {
                            attendee = await tx.classAttendee.create({
                                data: { classId, studentId, attended: false, attendanceStatus: 'unexcused_absence', autoDeducted: resDeduct.deducted }
                            });
                        } else {
                            await tx.classAttendee.update({
                                where: { id: attendee.id },
                                data: { attended: false, attendanceStatus: 'unexcused_absence', autoDeducted: resDeduct.deducted }
                            });
                        }
                        outcomes.push(buildPostponeOutcome(studentsById.get(studentId), {
                            studentId,
                            outcome: 'deducted_same_day',
                            ...resDeduct,
                        }));
                    }
                }
            } else {
                // Отмена заранее: возврат
                await refundAllDeductionsForClass(
                    classRecord,
                    req.user.id,
                    tx,
                    `Возврат (занятие перенесено заранее): ${classRecord.title}`
                );
                await tx.classAttendee.deleteMany({ where: { classId } });
                outcomes.push({ outcome: 'free_cancellation_refunded' });
            }

            const updated = await tx.class.update({
                where: { id: classId },
                data: {
                    status: 'cancelled',
                    noOneAttended: false
                }
            });

            await logLessonAction(req.user?.id, 'lesson_postponed', updated, {
                details: `Занятие перенесено: ${updated.title}`,
                outcomes
            }, tx);

            return {
                success: true,
                updated,
                outcomes,
                eventClass: { ...classRecord, ...updated },
                studentIds: uniqueStudentIds,
            };
        });

        if (result.errorStatus) {
            return res.status(result.errorStatus).json({ success: false, error: result.errorMessage });
        }

        await syncOfflineClassEvent('rescheduled', result.eventClass, null, result.studentIds);

        res.json({
            success: true,
            message: 'Занятие перенесено',
            class: { ...result.updated, _id: result.updated.id },
            outcomes: result.outcomes
        });
    } catch (error) {
        console.error('Postpone class error:', error);
        res.status(500).json({ success: false, error: 'Ошибка при переносе занятия' });
    }
});

// Expose pure analysis helpers for contract tests without creating a second
// generator implementation. Express ignores these properties on the router.
router.buildTrialAnalysisPayload = buildTrialAnalysisPayload;
router.buildTrialAnalysisMessages = buildTrialAnalysisMessages;
router.normalizeTrialAnalysisModelOutput = normalizeTrialAnalysisModelOutput;
router.buildTrialAnalysisDocx = buildTrialAnalysisDocx;
router.TRIAL_ANALYSIS_PROMPT_VERSION = TRIAL_ANALYSIS_PROMPT_VERSION;

module.exports = router;
