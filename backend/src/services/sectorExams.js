const axios = require('axios');
const { learningPlatformSecret } = require('./learningPlatformAuth');
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
        Authorization: `Bearer ${learningPlatformSecret()}`,
        'X-Integration-System': 'crm',
        Accept: 'application/json',
    };
}

function isSectorExamClass(classRecord) {
    return classRecord?.classType === 'exam';
}

function sectorExamTitle(exam) {
    if (exam?.sessionTitle) return `${exam.sessionTitle}${exam.directionTitle ? ` · ${exam.directionTitle}` : ""}`;
    // Plan 1.13: a group sector exam is one exam per member; the title names the group.
    const group = exam?.crmGroupId ? 'группы ' : '';
    const sector = exam?.sectorSequence ? `сектора ${group}${exam.sectorSequence}` : `сектора ${group}`.trim();
    const retake = exam?.attempt > 1 ? ', пересдача' : '';
    const direction = exam?.directionTitle ? ` · ${exam.directionTitle}` : '';
    const groupName = exam?.groupName ? ` · ${exam.groupName}` : '';
    return `Экзамен ${sector}${retake}${direction}${groupName}`;
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

async function defaultConfirmSchedule(classRecord, sectorExamId) {
    return executeOutboundIntegration({
        operation: 'sector-exams.schedule',
        url: `${learningPlatformBaseUrl()}/api/integration/v1/sector-exams/${encodeURIComponent(sectorExamId)}/schedule`,
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

function scheduleError(message, status = 400, code = 'SECTOR_EXAM_SCHEDULE_INVALID', extra = {}) {
    return Object.assign(new Error(message), { statusCode: status, code, ...extra });
}

/** Title of an exam lesson: the exam's own for one student, a count for several. */
function examLessonTitle(exams) {
    if (exams.length === 1) return sectorExamTitle(exams[0]);
    const directions = [...new Set(exams.map((exam) => exam.directionTitle).filter(Boolean))];
    const count = exams.length;
    const students = count % 10 === 1 && count % 100 !== 11 ? 'ученик'
        : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? 'ученика' : 'учеников';
    if (exams[0].sessionId && exams[0].sessionTitle && exams.every(exam => exam.sessionId === exams[0].sessionId)) {
        return `${exams[0].sessionTitle} · ${count} ${students}`;
    }
    return `Экзамен секторов${directions.length === 1 ? ` · ${directions[0]}` : ''} · ${count} ${students}`;
}

/** A student already sits another lesson at this time: their individual lessons and other exam lessons. */
async function findStudentConflict(tx, slot, studentId, excludeClassId) {
    const individual = await findClassScheduleConflict(tx, {
        date: slot.date, startTime: slot.startTime, endTime: slot.endTime,
        individualStudentId: studentId, excludeClassId,
    });
    if (individual) return individual;
    const rows = await tx.classSectorExam.findMany({
        where: {
            studentId,
            class: {
                status: { not: 'cancelled' },
                date: slot.date,
                ...(excludeClassId ? { id: { not: excludeClassId } } : {}),
            },
        },
        select: { class: { select: { id: true, title: true, startTime: true, endTime: true } } },
    });
    return rows.map((row) => row.class).find((other) => (
        minutes(other.startTime) < minutes(slot.endTime) && minutes(slot.startTime) < minutes(other.endTime)
    )) || null;
}

function conflictError(conflict, who = '') {
    return scheduleError(
        `${who}Время занято: ${conflict.title || 'занятие'} ${conflict.startTime}–${conflict.endTime}`,
        409, 'CLASS_SCHEDULE_CONFLICT', { conflict },
    );
}

/**
 * Books one or several pending exams into one free exam lesson, or adds them to an exam lesson
 * already booked (`classId`). The teacher is paid once for the lesson, however many students sit it.
 * Exams already booked here are confirmed to the platform again instead of being booked twice.
 */
async function bookSectorExams(input, deps = {}) {
    const db = deps.db || prisma;
    const confirmSchedule = deps.confirmSchedule || defaultConfirmSchedule;
    const examIds = [...new Set((input.examIds || []).filter(Boolean))];
    if (!examIds.length) throw scheduleError('Выберите хотя бы один экзамен');
    if (examIds.length > 20) throw scheduleError('Не больше 20 экзаменов в одном уроке');

    const already = await db.classSectorExam.findMany({
        where: { sectorExamId: { in: examIds }, class: { status: { not: 'cancelled' } } },
        include: { class: true },
    });
    if (already.length === examIds.length && already.every((row) => row.classId === already[0].classId)) {
        const booked = already[0].class;
        const differentSlot = (
            (input.date && scheduleDateKey(booked.date) !== scheduleDateKey(normalizeScheduleDate(input.date)))
            || (input.startTime && input.startTime !== booked.startTime)
            || (input.endTime && input.endTime !== booked.endTime)
            || (input.teacherId && input.teacherId !== booked.teacherId)
            || (input.roomId && input.roomId !== booked.roomId)
        );
        if (differentSlot) throw scheduleError('Этот экзамен уже назначен на другое время. Измените его в расписании CRM.',409,'SECTOR_EXAM_ALREADY_BOOKED_DIFFERENT_SLOT');
        const confirmations = await Promise.allSettled(already.map((row) => confirmSchedule(row.class, row.sectorExamId)));
        return { class: booked, exams: [], alreadyBooked: true, platformConfirmed: confirmations.every(result => result.status === 'fulfilled') };
    }
    if (already.length) {
        throw scheduleError('Часть экзаменов уже назначена. Обновите список.', 409, 'SECTOR_EXAM_ALREADY_BOOKED');
    }

    const pending = await (deps.fetchPending || defaultFetchPending)().catch(() => {
        throw scheduleError('Платформа обучения не ответила. Повторите позже.', 502, 'LEARNING_PLATFORM_UNAVAILABLE');
    });
    const exams = examIds.map((examId) => pending.find((item) => item.examId === examId));
    if (exams.some((exam) => !exam)) {
        throw scheduleError('Экзамен уже назначен или отменён. Обновите список.', 409, 'SECTOR_EXAM_NOT_PENDING');
    }
    const sessionId=exams[0].sessionId;
    const allSessionExams=pending.filter(exam=>exam.sessionId===sessionId);
    if (!sessionId || exams.some(exam=>exam.sessionId!==sessionId) || allSessionExams.length!==examIds.length) {
        throw scheduleError('Назначайте весь состав одного экзамена из приложения',409,'EXAM_SESSION_REQUIRED');
    }
    const studentIds = exams.map((exam) => exam.crmStudentId);
    if (new Set(studentIds).size !== studentIds.length) {
        throw scheduleError('У одного ученика в уроке может быть только один экзамен', 400, 'SECTOR_EXAM_STUDENT_TWICE');
    }
    const students = await db.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, name: true, lastName: true } });
    if (students.length !== studentIds.length) throw scheduleError('Ученик экзамена не найден в CRM', 404, 'STUDENT_NOT_FOUND');

    let slot;
    {
        const { date, startTime, endTime, teacherId, roomId } = input;
        if (!date || !startTime || !endTime) throw scheduleError('Выберите дату и время экзамена');
        const duration = minutes(endTime) - minutes(startTime);
        if (!Number.isFinite(duration) || duration <= 0) throw scheduleError('Время окончания должно быть позже времени начала');
        if (!teacherId) throw scheduleError('Выберите преподавателя экзамена');
        if (!roomId) throw scheduleError('Выберите кабинет: экзамен проходит в школе');
        const [teacher, room] = await Promise.all([
            db.student.findUnique({ where: { id: teacherId }, select: { id: true, role: true, status:true } }),
            db.room.findUnique({ where: { id: roomId }, select: { id: true, isActive:true } }),
        ]);
        if (!teacher || teacher.role !== 'teacher' || teacher.status !== 'active') throw scheduleError('Преподаватель не найден', 404, 'TEACHER_NOT_FOUND');
        if (!room || !room.isActive) throw scheduleError('Кабинет не найден', 404, 'ROOM_NOT_FOUND');
        slot = {
            teacherId,
            originalTeacherId: teacherId,
            roomId,
            deliveryFormat: 'offline',
            individualStudentId: null,
            date: normalizeScheduleDate(date),
            startTime,
            endTime,
            duration: normalizeLessonDuration(duration),
            status: 'scheduled',
            backgroundColor: EXAM_COLOR,
            notes: 'Бесплатный экзаменационный урок. Список проверки и отметки — в платформе обучения.',
            classType: 'exam',
            price: 0,
            createdById: input.actorId || null,
        };
    }

    const lesson = await db.$transaction(async (tx) => {
        await acquireClassScheduleLocks(tx, [
            { ...slot, classId: null, individualStudentId: null },
            ...studentIds.map((studentId) => ({ date: slot.date, individualStudentId: studentId })),
        ]);
        const conflict = await findClassScheduleConflict(tx, { ...slot, individualStudentId: null });
        if (conflict) throw conflictError(conflict);
        for (const student of students) {
            const conflict = await findStudentConflict(tx, slot, student.id, null);
            if (conflict) throw conflictError(conflict, `${[student.lastName, student.name].filter(Boolean).join(' ')}: `);
        }
        const row = await tx.class.create({ data: { ...slot, title: examLessonTitle(exams) } });
        await tx.classSectorExam.createMany({
            data: exams.map((exam) => ({ classId: row.id, sectorExamId: exam.examId, studentId: exam.crmStudentId })),
        });
        // App coordinators may not have a CRM staff card. The integration journal and
        // platform audit retain their action; never invent a CRM user for its FK.
        if (input.actorId) await tx.activityLog.create({
            data: {
                userId: input.actorId,
                action: 'sector_exam_scheduled',
                entityType: 'Class',
                entityId: row.id,
                details: `Назначен ${row.title}`,
                metadata: {
                    classId: row.id,
                    sectorExamIds: examIds,
                    crmStudentIds: studentIds,
                    date: scheduleDateKey(slot.date),
                    startTime: slot.startTime,
                    endTime: slot.endTime,
                },
            },
        });
        return row;
    }).catch((error) => {
        if (error?.code === 'P2002') throw scheduleError('Этот экзамен уже назначен', 409, 'SECTOR_EXAM_ALREADY_BOOKED');
        throw error;
    });

    // The platform notifies each student, their parents and the teacher. A failed call stays in
    // the integration log for a retry; the booking is kept and the next call re-sends it.
    const results = await Promise.allSettled(exams.map((exam) => confirmSchedule(lesson, exam.examId)));
    return {
        class: lesson,
        exams: exams.map((exam, index) => ({
            ...exam,
            studentName: exam.studentName || [students[index]?.lastName, students[index]?.name].filter(Boolean).join(' '),
        })),
        platformConfirmed: results.every((result) => result.status === 'fulfilled'),
        alreadyBooked: false,

    };
}

/** Students of an exam lesson for the attendance screen, in the shape of a group roster. */
async function listExamLessonStudents(classId, deps = {}) {
    const db = deps.db || prisma;
    const rows = await db.classSectorExam.findMany({
        where: { classId },
        orderBy: { createdAt: 'asc' },
        include: {
            student: {
                select: {
                    id: true, name: true, lastName: true, middleName: true, dateOfBirth: true, phone: true, accountBalance: true,
                    additionalPhones: { orderBy: { createdAt: 'asc' }, select: { phone: true } },
                },
            },
        },
    });
    return rows.map((row) => ({ ...row.student, _id: row.student.id, sectorExamId: row.sectorExamId, activeMembership: null, debtAmount: 0 }));
}

function formatDayMonth(date) {
    const [, month, day] = scheduleDateKey(date).split('-');
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    return `${Number(day)} ${months[Number(month) - 1]}`;
}

/** How one student's invitation names the exam: a shared lesson's title counts students instead. */
function studentExamTitle(lessonTitle) {
    const title = String(lessonTitle || '');
    const group = title.match(/^(Экзамен сектора группы(?: \d+)?(?: · .+?)?) · \d+ учени/);
    if (group) return group[1];
    const shared = title.match(/^Экзамен секторов(?: · (.+?))? · \d+ учени/);
    if (!shared) return lessonTitle || 'Экзамен сектора';
    return shared[1] ? `Экзамен сектора · ${shared[1]}` : 'Экзамен сектора';
}

/** WhatsApp invitation to the exam, worded for the student or for a parent. */
function buildExamInvitationMessage({ audience, recipientName, studentName, title, date, startTime, roomName }) {
    const greeting = recipientName ? `Здравствуйте, ${recipientName}!` : 'Здравствуйте!';
    const when = `${formatDayMonth(date)} в ${startTime}`;
    const where = roomName ? `, кабинет «${roomName}»` : '';
    const examName = studentExamTitle(title).replace(/^Экзамен/, 'экзамен');
    const lead = audience === 'parent'
        ? `${studentName ? `${studentName} приглашается` : 'Приглашаем ученика'} на ${examName}`
        : `Приглашаем вас на ${examName}`;
    return [
        `${greeting} ${lead}: ${when}${where}.`,
        'Экзамен проходит в школе, это бесплатный дополнительный урок. Что проверит преподаватель, видно на странице назначенного экзамена в приложении Maestro.',
        'Пожалуйста, подтвердите, что получится прийти 🙏',
    ].join('\n\n');
}

module.exports = {
    studentExamTitle,
    bookSectorExams,
    examLessonTitle,
    listExamLessonStudents,
    buildExamInvitationMessage,
    examLessonAt,
    isSectorExamClass,
    sectorExamTitle,
};
