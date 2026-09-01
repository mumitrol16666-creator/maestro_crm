const { timeToMinutes, intervalsOverlap } = require('../utils/timeOverlap');

const SCHOOL_TIME_ZONE = process.env.SCHOOL_TIME_ZONE || 'Asia/Aqtobe';

function scheduleDateKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('Некорректная дата занятия');
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: SCHOOL_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date).reduce((result, part) => {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeScheduleDate(value) {
    return new Date(`${scheduleDateKey(value)}T00:00:00.000Z`);
}

function classScheduleLockKeys(slot) {
    const date = slot.date ? scheduleDateKey(slot.date) : null;
    const resources = [
        ['room', slot.roomId],
        ['teacher', slot.teacherId],
        ['group', slot.groupId],
        ['student', slot.individualStudentId],
    ];

    const datedKeys = resources
        .filter(([, id]) => Boolean(id))
        .map(([type, id]) => `class-schedule:${date}:${type}:${id}`);

    if (slot.bookingId) datedKeys.push(`class-schedule:booking:${slot.bookingId}`);
    if (slot.classId) datedKeys.push(`class-schedule:class:${slot.classId}`);
    return datedKeys;
}

async function acquireClassScheduleLocks(tx, slots) {
    const lockPriority = (key) => {
        if (key.startsWith('class-schedule:booking:')) return 0;
        if (key.startsWith('class-schedule:class:')) return 1;
        return 2;
    };
    const keys = [...new Set((slots || []).flatMap(classScheduleLockKeys))]
        .sort((first, second) => lockPriority(first) - lockPriority(second) || first.localeCompare(second));
    if (keys.length) {
        await tx.$queryRawUnsafe(
            `SELECT pg_advisory_xact_lock(hashtextextended(lock_key, 0)) IS NULL AS locked
             FROM unnest($1::text[]) WITH ORDINALITY AS locks(lock_key, lock_order)
             ORDER BY lock_order`,
            keys,
        );
    }
    return keys;
}

async function findClassScheduleConflict(db, {
    date,
    startTime,
    endTime,
    roomId,
    teacherId,
    groupId,
    individualStudentId,
    excludeClassId = null,
}) {
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

    const targetDateKey = scheduleDateKey(date);
    const normalizedDate = normalizeScheduleDate(date);
    const dateRangeStart = new Date(normalizedDate.getTime() - 24 * 60 * 60 * 1000);
    const dateRangeEnd = new Date(normalizedDate.getTime() + 24 * 60 * 60 * 1000);
    const candidates = await db.class.findMany({
        where: {
            id: excludeClassId ? { not: excludeClassId } : undefined,
            date: { gte: dateRangeStart, lt: dateRangeEnd },
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
            date: true,
            startTime: true,
            endTime: true,
        },
    });

    return candidates.find((candidate) => (
        scheduleDateKey(candidate.date) === targetDateKey
        && intervalsOverlap(
            startMinutes,
            endMinutes,
            timeToMinutes(candidate.startTime),
            timeToMinutes(candidate.endTime),
        )
    )) || null;
}

function classScheduleConflictError(conflict, message = 'Занятие пересекается с расписанием') {
    const error = new Error(message);
    error.code = 'CLASS_SCHEDULE_CONFLICT';
    error.conflict = conflict || null;
    return error;
}

module.exports = {
    scheduleDateKey,
    normalizeScheduleDate,
    classScheduleLockKeys,
    acquireClassScheduleLocks,
    findClassScheduleConflict,
    classScheduleConflictError,
};
