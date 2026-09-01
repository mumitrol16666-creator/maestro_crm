const QA_ADMIN_ID = 'QA-ADMIN-1';
const QA_ROOM_ID = 'QA-ROOM-1';
const QA_GROUP_ID = 'QA-GROUP-1';
const QA_TEACHER_IDS = new Set(['QA-TEACHER-1', 'QA-TEACHER-2']);
const QA_STUDENT_IDS = new Set(['QA-STUDENT-1', 'QA-STUDENT-2', 'QA-STUDENT-3', 'QA-STUDENT-4']);
const QA_ACTIVE_STUDENT_IDS = ['QA-STUDENT-1', 'QA-STUDENT-2', 'QA-STUDENT-3'];
const DYNAMIC_CLASS_PREFIX = 'QA-RUN-CLASS-';

async function sendOfflineLessonEvent(...args) {
    const { syncOfflineLessonEventToLearningPlatform } = require('./learningPlatformNotifications');
    return syncOfflineLessonEventToLearningPlatform(...args);
}

class QaFixtureError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

function normalizeScenarioId(value) {
    const normalized = String(value || '').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{0,47}$/.test(normalized)) {
        throw new QaFixtureError(400, 'QA_SCENARIO_ID_INVALID', 'scenarioId must contain only A-Z, 0-9 and hyphens');
    }
    return normalized;
}

function qaClassId(scenarioId) {
    return `${DYNAMIC_CLASS_PREFIX}${normalizeScenarioId(scenarioId)}`;
}

function assertDynamicClassId(classId) {
    const normalized = String(classId || '').trim().toUpperCase();
    if (!normalized.startsWith(DYNAMIC_CLASS_PREFIX) || !/^[A-Z0-9-]+$/.test(normalized)) {
        throw new QaFixtureError(400, 'QA_CLASS_ID_FORBIDDEN', `Only ${DYNAMIC_CLASS_PREFIX}* lessons may be changed`);
    }
    return normalized;
}

function parseQaDate(value) {
    const raw = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        throw new QaFixtureError(400, 'QA_DATE_INVALID', 'date must use YYYY-MM-DD');
    }
    const date = new Date(`${raw}T12:00:00+05:00`);
    if (Number.isNaN(date.getTime())) {
        throw new QaFixtureError(400, 'QA_DATE_INVALID', 'date is invalid');
    }
    return date;
}

function parseQaTime(value, fieldName) {
    const raw = String(value || '').trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
        throw new QaFixtureError(400, 'QA_TIME_INVALID', `${fieldName} must use HH:MM`);
    }
    return raw;
}

function minutesOfDay(value) {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
}

function parseSchedule(input) {
    const date = parseQaDate(input.date);
    const startTime = parseQaTime(input.startTime, 'startTime');
    const endTime = parseQaTime(input.endTime, 'endTime');
    const duration = minutesOfDay(endTime) - minutesOfDay(startTime);
    if (duration <= 0 || duration > 240) {
        throw new QaFixtureError(400, 'QA_DURATION_INVALID', 'lesson duration must be between 1 and 240 minutes');
    }
    return { date, startTime, endTime, duration };
}

function ensureAllowedFixtureId(value, allowed, label) {
    const id = String(value || '').trim().toUpperCase();
    if (!allowed.has(id)) {
        throw new QaFixtureError(400, 'QA_FIXTURE_ID_FORBIDDEN', `${label} is not an allowed QA fixture`);
    }
    return id;
}

function serializeQaClass(classRecord) {
    return {
        crmClassId: classRecord.id,
        title: classRecord.title,
        classType: classRecord.classType,
        status: classRecord.status,
        date: classRecord.date.toISOString(),
        startTime: classRecord.startTime,
        endTime: classRecord.endTime,
        teacherId: classRecord.teacherId,
        originalTeacherId: classRecord.originalTeacherId,
        groupId: classRecord.groupId,
        individualStudentId: classRecord.individualStudentId,
    };
}

async function requireQaPerson(prisma, id, role) {
    const person = await prisma.student.findFirst({ where: { id, role, status: 'active' } });
    if (!person) {
        throw new QaFixtureError(409, 'QA_FIXTURES_NOT_SEEDED', `${id} is missing; run the QA seed first`);
    }
    return person;
}

async function requireQaRoom(prisma) {
    const room = await prisma.room.findUnique({ where: { id: QA_ROOM_ID } });
    if (!room) {
        throw new QaFixtureError(409, 'QA_FIXTURES_NOT_SEEDED', `${QA_ROOM_ID} is missing; run the QA seed first`);
    }
    return room;
}

async function getDynamicClass(prisma, classId) {
    const id = assertDynamicClassId(classId);
    const classRecord = await prisma.class.findUnique({
        where: { id },
        include: { attendees: { select: { studentId: true } } },
    });
    if (!classRecord) {
        throw new QaFixtureError(404, 'QA_CLASS_NOT_FOUND', 'QA lesson not found');
    }
    return classRecord;
}

async function writeQaActivity(prisma, action, classRecord, metadata = {}) {
    await prisma.activityLog.create({
        data: {
            userId: QA_ADMIN_ID,
            action,
            entityType: 'QaLessonFixture',
            entityId: classRecord.id,
            details: `${action}: ${classRecord.title}`,
            metadata: { source: 'qa-fixture-controller', ...metadata },
        },
    });
}

async function createQaLesson(prisma, input) {
    const classType = input.classType === 'group' ? 'group' : 'individual';
    const id = qaClassId(input.scenarioId);
    const schedule = parseSchedule(input);
    const teacherId = ensureAllowedFixtureId(input.teacherId || 'QA-TEACHER-1', QA_TEACHER_IDS, 'teacherId');
    await Promise.all([requireQaPerson(prisma, teacherId, 'teacher'), requireQaRoom(prisma)]);

    const existing = await prisma.class.findUnique({ where: { id } });
    if (existing) {
        const same = existing.classType === classType
            && existing.teacherId === teacherId
            && existing.startTime === schedule.startTime
            && existing.endTime === schedule.endTime
            && existing.date.getTime() === schedule.date.getTime();
        if (!same || existing.status !== 'scheduled') {
            throw new QaFixtureError(409, 'QA_CLASS_ALREADY_EXISTS', 'Scenario lesson already exists with different data or state');
        }
        return { created: false, idempotent: true, class: serializeQaClass(existing) };
    }

    let groupId = null;
    let individualStudentId = null;
    let attendeeIds = [];
    let title = String(input.title || '').trim();

    if (classType === 'group') {
        groupId = String(input.groupId || QA_GROUP_ID).trim().toUpperCase();
        if (groupId !== QA_GROUP_ID) {
            throw new QaFixtureError(400, 'QA_FIXTURE_ID_FORBIDDEN', 'groupId is not an allowed QA fixture');
        }
        const group = await prisma.group.findFirst({ where: { id: groupId, isActive: true } });
        if (!group) {
            throw new QaFixtureError(409, 'QA_FIXTURES_NOT_SEEDED', `${groupId} is missing; run the QA seed first`);
        }
        const memberships = await prisma.studentGroup.findMany({
            where: { groupId, status: 'active', student: { status: 'active' } },
            select: { studentId: true },
            orderBy: { studentId: 'asc' },
        });
        attendeeIds = memberships.map((item) => item.studentId).filter((studentId) => QA_STUDENT_IDS.has(studentId));
        if (attendeeIds.length === 0) {
            throw new QaFixtureError(409, 'QA_GROUP_EMPTY', 'QA group has no active students');
        }
        title ||= 'QA Групповой урок';
    } else {
        individualStudentId = ensureAllowedFixtureId(input.studentId || 'QA-STUDENT-1', QA_STUDENT_IDS, 'studentId');
        await requireQaPerson(prisma, individualStudentId, 'student');
        attendeeIds = [individualStudentId];
        title ||= 'QA Индивидуальный урок';
    }

    const classRecord = await prisma.$transaction(async (tx) => {
        const created = await tx.class.create({
            data: {
                id,
                groupId,
                teacherId,
                originalTeacherId: teacherId,
                roomId: QA_ROOM_ID,
                title: title.slice(0, 200),
                ...schedule,
                status: 'scheduled',
                classType,
                individualStudentId,
                createdById: QA_ADMIN_ID,
                notes: 'Created by the local QA fixture controller.',
            },
        });
        await tx.classAttendee.createMany({
            data: attendeeIds.map((studentId) => ({
                classId: created.id,
                studentId,
                attendanceStatus: 'unmarked',
            })),
        });
        await writeQaActivity(tx, 'qa_lesson_created', created, { attendeeIds });
        return created;
    });

    return { created: true, idempotent: false, class: serializeQaClass(classRecord) };
}

async function cancelQaLesson(prisma, classId, reason) {
    const current = await getDynamicClass(prisma, classId);
    if (current.status === 'cancelled') {
        return { idempotent: true, class: serializeQaClass(current) };
    }
    if (['completed', 'pending_admin_review'].includes(current.status)) {
        throw new QaFixtureError(409, 'QA_CLASS_CLOSED', 'A submitted or completed lesson cannot be cancelled');
    }
    const updated = await prisma.$transaction(async (tx) => {
        const classRecord = await tx.class.update({
            where: { id: current.id },
            data: { status: 'cancelled', notes: String(reason || 'Отменено QA-контроллером').slice(0, 2000) },
        });
        await writeQaActivity(tx, 'qa_lesson_cancelled', classRecord, { reason: reason || null });
        return classRecord;
    });
    await sendOfflineLessonEvent('cancelled', updated, current.attendees.map((item) => item.studentId).filter(Boolean));
    return { idempotent: false, class: serializeQaClass(updated) };
}

async function rescheduleQaLesson(prisma, classId, input) {
    const current = await getDynamicClass(prisma, classId);
    if (current.status !== 'scheduled') {
        throw new QaFixtureError(409, 'QA_CLASS_NOT_SCHEDULED', 'Only a scheduled QA lesson may be rescheduled');
    }
    const schedule = parseSchedule(input);
    const unchanged = current.date.getTime() === schedule.date.getTime()
        && current.startTime === schedule.startTime
        && current.endTime === schedule.endTime;
    if (unchanged) {
        return { idempotent: true, class: serializeQaClass(current) };
    }
    const updated = await prisma.$transaction(async (tx) => {
        const classRecord = await tx.class.update({ where: { id: current.id }, data: schedule });
        await writeQaActivity(tx, 'qa_lesson_rescheduled', classRecord, {
            previous: { date: current.date, startTime: current.startTime, endTime: current.endTime },
        });
        return classRecord;
    });
    await sendOfflineLessonEvent('rescheduled', updated, current.attendees.map((item) => item.studentId).filter(Boolean));
    return { idempotent: false, class: serializeQaClass(updated) };
}

async function substituteQaLessonTeacher(prisma, classId, teacherId) {
    const current = await getDynamicClass(prisma, classId);
    if (current.status !== 'scheduled') {
        throw new QaFixtureError(409, 'QA_CLASS_NOT_SCHEDULED', 'Only a scheduled QA lesson may receive a substitute');
    }
    const nextTeacherId = ensureAllowedFixtureId(teacherId, QA_TEACHER_IDS, 'teacherId');
    await requireQaPerson(prisma, nextTeacherId, 'teacher');
    if (current.teacherId === nextTeacherId) {
        return { idempotent: true, class: serializeQaClass(current) };
    }
    const updated = await prisma.$transaction(async (tx) => {
        const classRecord = await tx.class.update({
            where: { id: current.id },
            data: {
                teacherId: nextTeacherId,
                originalTeacherId: current.originalTeacherId || current.teacherId || nextTeacherId,
            },
        });
        await writeQaActivity(tx, 'qa_lesson_substitute_assigned', classRecord, {
            previousTeacherId: current.teacherId,
            substituteTeacherId: nextTeacherId,
            scope: 'single_lesson',
        });
        return classRecord;
    });
    await sendOfflineLessonEvent(
        'rescheduled',
        updated,
        current.attendees.map((item) => item.studentId).filter(Boolean),
        'На урок назначен разовый преподаватель на замену.',
    );
    return { idempotent: false, class: serializeQaClass(updated) };
}

async function changeQaGroupRoster(prisma, studentId, state) {
    const id = ensureAllowedFixtureId(studentId, QA_STUDENT_IDS, 'studentId');
    if (!['active', 'left'].includes(state)) {
        throw new QaFixtureError(400, 'QA_ROSTER_STATE_INVALID', 'state must be active or left');
    }
    if (state === 'active') await requireQaPerson(prisma, id, 'student');

    await prisma.$transaction(async (tx) => {
        const membership = await tx.studentGroup.findUnique({
            where: { studentId_groupId: { studentId: id, groupId: QA_GROUP_ID } },
        });
        if (membership) {
            await tx.studentGroup.update({ where: { id: membership.id }, data: { status: state } });
        } else if (state === 'active') {
            await tx.studentGroup.create({ data: { studentId: id, groupId: QA_GROUP_ID, status: 'active' } });
        }

        const lessons = await tx.class.findMany({
            where: { id: { startsWith: DYNAMIC_CLASS_PREFIX }, groupId: QA_GROUP_ID, status: 'scheduled' },
            select: { id: true },
        });
        for (const lesson of lessons) {
            const attendee = await tx.classAttendee.findFirst({ where: { classId: lesson.id, studentId: id } });
            if (state === 'active' && !attendee) {
                await tx.classAttendee.create({ data: { classId: lesson.id, studentId: id, attendanceStatus: 'unmarked' } });
            }
            if (state === 'left' && attendee) {
                await tx.classAttendee.delete({ where: { id: attendee.id } });
            }
        }
    });
    return { groupId: QA_GROUP_ID, studentId: id, state };
}

async function resetQaRunFixtures(prisma) {
    const classes = await prisma.class.findMany({
        where: { id: { startsWith: DYNAMIC_CLASS_PREFIX } },
        select: { id: true },
    });
    const classIds = classes.map((item) => item.id);
    await prisma.$transaction(async (tx) => {
        if (classIds.length > 0) {
            await tx.class.deleteMany({ where: { id: { in: classIds } } });
            await tx.activityLog.deleteMany({ where: { entityId: { in: classIds }, entityType: 'QaLessonFixture' } });
        }
        for (const studentId of QA_ACTIVE_STUDENT_IDS) {
            await tx.studentGroup.upsert({
                where: { studentId_groupId: { studentId, groupId: QA_GROUP_ID } },
                update: { status: 'active' },
                create: { studentId, groupId: QA_GROUP_ID, status: 'active' },
            });
        }
    });
    return { deletedLessons: classIds.length, restoredRoster: QA_ACTIVE_STUDENT_IDS.length };
}

async function getQaControllerStatus(prisma) {
    const [people, groups, dynamicClasses] = await Promise.all([
        prisma.student.count({ where: { id: { startsWith: 'QA-' } } }),
        prisma.group.count({ where: { id: { startsWith: 'QA-' } } }),
        prisma.class.findMany({
            where: { id: { startsWith: DYNAMIC_CLASS_PREFIX } },
            orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
        }),
    ]);
    return {
        fixtureVersion: 'QA-SEED-V1',
        people,
        groups,
        dynamicLessons: dynamicClasses.map(serializeQaClass),
    };
}

module.exports = {
    DYNAMIC_CLASS_PREFIX,
    QaFixtureError,
    normalizeScenarioId,
    qaClassId,
    assertDynamicClassId,
    parseSchedule,
    createQaLesson,
    cancelQaLesson,
    rescheduleQaLesson,
    substituteQaLessonTeacher,
    changeQaGroupRoster,
    resetQaRunFixtures,
    getQaControllerStatus,
};
