const axios = require('axios');
const { prisma } = require('../config/db');
const { executeOutboundIntegration } = require('./integrationJournal');
const {
    acquireClassScheduleLocks,
    findClassScheduleConflict,
    normalizeScheduleDate,
    scheduleDateKey,
} = require('./classScheduleGuard');
const { normalizeLessonDuration } = require('../utils/duration');

/**
 * Plan 1.11: the sector exam in CRM. The learning platform keeps the exam (its checklist and
 * the teacher's marks); CRM books it as a free extra lesson of type "exam" in a free slot and
 * tells the platform the lesson and its time. Approval of an exam lesson charges nothing.
 */

const EXAM_COLOR = '#2563eb';

function learningPlatformBaseUrl() {
    return (process.env.LEARNING_PLATFORM_API_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
}

function integrationHeaders() {
    return {
        Authorization: `Bearer ${process.env.INTEGRATION_SERVICE_SECRET}`,
        'X-Integration-System': 'crm',
        Accept: 'application/json',
    };
}

function isSectorExamClass(classRecord) {
    return classRecord?.classType === 'exam';
}

function sectorExamTitle(exam) {
    const sector = exam?.sectorSequence ? `сектора ${exam.sectorSequence}` : 'сектора';
    const retake = exam?.attempt > 1 ? ', пересдача' : '';
    const direction = exam?.directionTitle ? ` · ${exam.directionTitle}` : '';
    return `Экзамен ${sector}${retake}${direction}`;
}

/** The lesson's start as an instant: CRM keeps the date and a local Aqtobe time (UTC+5). */
function examLessonAt(date, startTime) {
    return new Date(`${scheduleDateKey(date)}T${startTime}:00+05:00`).toISOString();
}

function minutes(time) {
    const [hours, mins] = String(time || '').split(':').map(Number);
    return hours * 60 + mins;
}

async function defaultFetchPending() {
    const response = await axios({
        url: `${learningPlatformBaseUrl()}/api/integration/v1/sector-exams/awaiting-schedule`,
        method: 'GET',
        headers: integrationHeaders(),
        timeout: 10000,
    });
    return response.data?.data?.exams || [];
}

async function defaultConfirmSchedule(classRecord) {
    return executeOutboundIntegration({
        operation: 'sector-exams.schedule',
        url: `${learningPlatformBaseUrl()}/api/integration/v1/sector-exams/${encodeURIComponent(classRecord.sectorExamId)}/schedule`,
        method: 'POST',
        payload: {
            crmClassId: classRecord.id,
            lessonAt: examLessonAt(classRecord.date, classRecord.startTime),
            crmTeacherId: classRecord.teacherId || null,
        },
        entityType: 'Class',
        entityId: classRecord.id,
    });
}

/**
 * Exams waiting for a lesson. When the platform cannot be reached the list is empty and
 * `available` is false, so screens say so instead of claiming nothing is waiting.
 */
async function listPendingSectorExams(deps = {}) {
    const fetchPending = deps.fetchPending || defaultFetchPending;
    const db = deps.db || prisma;
    let exams;
    try {
        exams = await fetchPending();
    } catch (error) {
        return { available: false, exams: [], error: 'Платформа обучения не ответила. Повторите позже.' };
    }
    const studentIds = [...new Set(exams.map((exam) => exam.crmStudentId).filter(Boolean))];
    const students = studentIds.length
        ? await db.student.findMany({
            where: { id: { in: studentIds } },
            select: { id: true, name: true, lastName: true, assignedTeacherId: true },
        })
        : [];
    const byId = new Map(students.map((student) => [student.id, student]));
    // Booked here but not yet confirmed by the platform: keep them out of the queue.
    const booked = exams.length
        ? await db.class.findMany({
            where: { sectorExamId: { in: exams.map((exam) => exam.examId) }, status: { not: 'cancelled' } },
            select: { sectorExamId: true },
        })
        : [];
    const bookedIds = new Set(booked.map((row) => row.sectorExamId));
    return {
        available: true,
        exams: exams
            .filter((exam) => !bookedIds.has(exam.examId))
            .map((exam) => {
                const student = byId.get(exam.crmStudentId);
                return {
                    ...exam,
                    studentName: exam.studentName
                        || [student?.lastName, student?.name].filter(Boolean).join(' ')
                        || 'Ученик',
                    knownStudent: Boolean(student),
                    suggestedTeacherId: student?.assignedTeacherId || null,
                    title: sectorExamTitle(exam),
                };
            }),
    };
}

function scheduleError(message, status = 400, code = 'SECTOR_EXAM_SCHEDULE_INVALID', extra = {}) {
    return Object.assign(new Error(message), { statusCode: status, code, ...extra });
}

/**
 * Books the exam in a free slot. Repeating the call for an exam already booked here re-sends
 * the confirmation to the platform instead of booking a second lesson.
 */
async function scheduleSectorExam(input, deps = {}) {
    const db = deps.db || prisma;
    const confirmSchedule = deps.confirmSchedule || defaultConfirmSchedule;
    const { examId, date, startTime, endTime, teacherId, roomId, actorId } = input;
    if (!examId || !date || !startTime || !endTime) {
        throw scheduleError('Выберите экзамен, дату и время');
    }
    const duration = minutes(endTime) - minutes(startTime);
    if (!Number.isFinite(duration) || duration <= 0) {
        throw scheduleError('Время окончания должно быть позже времени начала');
    }
    if (!teacherId) throw scheduleError('Выберите преподавателя экзамена');
    if (!roomId) throw scheduleError('Выберите кабинет: экзамен проходит в школе');

    const existing = await db.class.findFirst({ where: { sectorExamId: examId, status: { not: 'cancelled' } } });
    if (existing) {
        await confirmSchedule(existing).catch(() => null);
        return { class: existing, alreadyBooked: true };
    }

    const pending = await (deps.fetchPending || defaultFetchPending)().catch(() => {
        throw scheduleError('Платформа обучения не ответила. Повторите позже.', 502, 'LEARNING_PLATFORM_UNAVAILABLE');
    });
    const exam = pending.find((item) => item.examId === examId);
    if (!exam) {
        throw scheduleError('Экзамен уже назначен или отменён. Обновите список.', 409, 'SECTOR_EXAM_NOT_PENDING');
    }
    const [student, teacher, room] = await Promise.all([
        db.student.findUnique({ where: { id: exam.crmStudentId }, select: { id: true, role: true } }),
        db.student.findUnique({ where: { id: teacherId }, select: { id: true, role: true } }),
        db.room.findUnique({ where: { id: roomId }, select: { id: true } }),
    ]);
    if (!student) throw scheduleError('Ученик экзамена не найден в CRM', 404, 'STUDENT_NOT_FOUND');
    if (!teacher || teacher.role !== 'teacher') throw scheduleError('Преподаватель не найден', 404, 'TEACHER_NOT_FOUND');
    if (!room) throw scheduleError('Кабинет не найден', 404, 'ROOM_NOT_FOUND');

    const classData = {
        teacherId,
        originalTeacherId: teacherId,
        roomId,
        deliveryFormat: 'offline',
        individualStudentId: student.id,
        title: sectorExamTitle(exam),
        date: normalizeScheduleDate(date),
        startTime,
        endTime,
        duration: normalizeLessonDuration(duration),
        status: 'scheduled',
        backgroundColor: EXAM_COLOR,
        notes: 'Бесплатный экзаменационный урок. Список проверки и отметки — в платформе обучения.',
        classType: 'exam',
        price: 0,
        sectorExamId: examId,
        createdById: actorId || null,
    };

    const created = await db.$transaction(async (tx) => {
        await acquireClassScheduleLocks(tx, [classData]);
        const conflict = await findClassScheduleConflict(tx, classData);
        if (conflict) {
            throw scheduleError(`Время занято: ${conflict.title || 'занятие'} ${conflict.startTime}–${conflict.endTime}`, 409, 'CLASS_SCHEDULE_CONFLICT', { conflict });
        }
        const row = await tx.class.create({ data: classData });
        await tx.activityLog.create({
            data: {
                userId: actorId || 'system',
                action: 'sector_exam_scheduled',
                entityType: 'Class',
                entityId: row.id,
                details: `Назначен ${row.title}`,
                metadata: { classId: row.id, sectorExamId: examId, crmStudentId: student.id, date: scheduleDateKey(date), startTime, endTime },
            },
        });
        return row;
    }).catch((error) => {
        if (error?.code === 'P2002') throw scheduleError('Этот экзамен уже назначен', 409, 'SECTOR_EXAM_ALREADY_BOOKED');
        throw error;
    });

    // The platform notifies the student, parents and teacher. A failed call stays in the
    // integration log for a retry; the booking is kept and the next call re-sends it.
    let platformConfirmed = true;
    try {
        await confirmSchedule(created);
    } catch {
        platformConfirmed = false;
    }
    return { class: created, exam, platformConfirmed, alreadyBooked: false };
}

function formatDayMonth(date) {
    const [, month, day] = scheduleDateKey(date).split('-');
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    return `${Number(day)} ${months[Number(month) - 1]}`;
}

/** WhatsApp invitation to the exam, worded for the student or for a parent. */
function buildExamInvitationMessage({ audience, recipientName, studentName, title, date, startTime, roomName }) {
    const greeting = recipientName ? `Здравствуйте, ${recipientName}!` : 'Здравствуйте!';
    const when = `${formatDayMonth(date)} в ${startTime}`;
    const where = roomName ? `, кабинет «${roomName}»` : '';
    const examName = String(title || 'Экзамен сектора').replace(/^Экзамен/, 'экзамен');
    const lead = audience === 'parent'
        ? `${studentName ? `${studentName} приглашается` : 'Приглашаем ученика'} на ${examName}`
        : `Приглашаем вас на ${examName}`;
    return [
        `${greeting} ${lead}: ${when}${where}.`,
        'Экзамен проходит в школе, это бесплатный дополнительный урок. Что проверит преподаватель, видно в приложении Maestro в разделе «Сектор».',
        'Пожалуйста, подтвердите, что получится прийти 🙏',
    ].join('\n\n');
}

module.exports = {
    buildExamInvitationMessage,
    examLessonAt,
    isSectorExamClass,
    listPendingSectorExams,
    scheduleSectorExam,
    sectorExamTitle,
};
