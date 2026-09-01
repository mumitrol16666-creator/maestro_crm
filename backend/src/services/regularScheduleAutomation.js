const { prisma } = require('../config/db');
const { normalizeLessonDuration } = require('../utils/duration');
const {
    acquireClassScheduleLocks,
    classScheduleConflictError,
    normalizeScheduleDate,
    scheduleDateKey,
} = require('./classScheduleGuard');

const AUTO_NOTE = 'Автоматически из регулярного расписания';
const AUTO_NOTES = [AUTO_NOTE, 'Сгенерировано', 'Сгенерировано из абонемента'];

function endTime(startTime, duration) {
    const [hours, minutes] = startTime.split(':').map(Number);
    const total = (hours * 60) + minutes + normalizeLessonDuration(duration);
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function dateKey(value) {
    return scheduleDateKey(value);
}

function defaultRange(endDateInput) {
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = endDateInput ? new Date(endDateInput) : new Date(startDate);
    if (!endDateInput) endDate.setDate(endDate.getDate() + 90);
    endDate.setHours(23, 59, 59, 999);
    return { startDate, endDate };
}

function buildRecurringSlots({
    schedules, startDate, endDate, groupId = null, individualStudentId = null,
    defaultTeacherId = null, title, classType, backgroundColor = '#eb4d77', createdById = null,
}) {
    const slots = [];
    for (const schedule of schedules.filter((item) => !item.isPractice)) {
        const cursor = new Date(startDate);
        while (cursor <= endDate) {
            const dayOfWeek = cursor.getDay() === 0 ? 7 : cursor.getDay();
            if (dayOfWeek === schedule.dayOfWeek) {
                slots.push({
                    groupId,
                    individualStudentId,
                    teacherId: schedule.teacherId || defaultTeacherId || null,
                    roomId: schedule.roomId || null,
                    title,
                    date: normalizeScheduleDate(cursor),
                    startTime: schedule.time,
                    endTime: endTime(schedule.time, schedule.duration),
                    duration: normalizeLessonDuration(schedule.duration),
                    status: 'scheduled',
                    isRecurring: true,
                    recurringFreq: 'weekly',
                    recurringDays: [schedule.dayOfWeek],
                    recurringEndDate: endDate,
                    classType,
                    backgroundColor,
                    notes: AUTO_NOTE,
                    createdById,
                });
            }
            cursor.setDate(cursor.getDate() + 1);
        }
    }
    return slots;
}

function timesOverlap(first, second) {
    return first.startTime < second.endTime && first.endTime > second.startTime;
}

async function findRecurringConflicts(
    slots,
    {
        excludeGroupId = null,
        excludeStudentId = null,
        excludeClassIds = [],
        limit = 12,
    } = {},
    db = prisma,
) {
    if (!slots.length) return [];
    const roomIds = [...new Set(slots.map((slot) => slot.roomId).filter(Boolean))];
    const teacherIds = [...new Set(slots.map((slot) => slot.teacherId).filter(Boolean))];
    const groupIds = [...new Set(slots.map((slot) => slot.groupId).filter(Boolean))];
    const studentIds = [...new Set(slots.map((slot) => slot.individualStudentId).filter(Boolean))];
    const dates = slots.map((slot) => slot.date);
    const existing = await db.class.findMany({
        where: {
            ...(excludeClassIds.length ? { id: { notIn: excludeClassIds } } : {}),
            status: { not: 'cancelled' },
            date: { gte: new Date(Math.min(...dates)), lte: new Date(Math.max(...dates)) },
            OR: [
                ...(roomIds.length ? [{ roomId: { in: roomIds } }] : []),
                ...(teacherIds.length ? [{ teacherId: { in: teacherIds } }] : []),
                ...(groupIds.length ? [{ groupId: { in: groupIds } }] : []),
                ...(studentIds.length ? [{ individualStudentId: { in: studentIds } }] : []),
            ],
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
            notes: true,
            room: { select: { name: true } },
            teacher: { select: { name: true, lastName: true, middleName: true } },
        },
    });

    const conflicts = [];
    const previousSlotsByDate = new Map();
    const existingByDate = new Map();
    for (const item of existing) {
        const key = dateKey(item.date);
        const items = existingByDate.get(key) || [];
        items.push(item);
        existingByDate.set(key, items);
    }

    for (let index = 0; index < slots.length; index += 1) {
        const slot = slots[index];
        const slotDateKey = dateKey(slot.date);
        const previousSlots = previousSlotsByDate.get(slotDateKey) || [];
        const internal = previousSlots.find(({ slot: other }) => timesOverlap(slot, other)
            && ((slot.roomId && slot.roomId === other.roomId)
                || (slot.teacherId && slot.teacherId === other.teacherId)
                || (slot.groupId && slot.groupId === other.groupId)
                || (slot.individualStudentId && slot.individualStudentId === other.individualStudentId)));
        if (internal) {
            const other = internal.slot;
            let reason = 'Ученику указаны два занятия на одно время';
            if (slot.roomId && slot.roomId === internal.roomId) reason = 'Кабинет указан сразу для двух занятий';
            else if (slot.teacherId && slot.teacherId === internal.teacherId) reason = 'Преподаватель указан сразу для двух занятий';
            else if (slot.groupId && slot.groupId === internal.groupId) reason = 'Группе указаны два занятия на одно время';
            conflicts.push({
                slotIndex: index,
                conflictingSlotIndex: internal.slotIndex,
                scope: 'batch',
                date: slot.date, startTime: slot.startTime, endTime: slot.endTime,
                reason,
            });
        }

        for (const item of existingByDate.get(slotDateKey) || []) {
            const isOwnAutoClass = AUTO_NOTES.includes(item.notes)
                && ((excludeGroupId && item.groupId === excludeGroupId)
                    || (excludeStudentId && item.individualStudentId === excludeStudentId));
            if (isOwnAutoClass || !timesOverlap(slot, item)) continue;
            if (slot.roomId && slot.roomId === item.roomId) {
                conflicts.push({
                    slotIndex: index,
                    scope: 'existing',
                    classId: item.id,
                    title: item.title,
                    date: slot.date, startTime: slot.startTime, endTime: slot.endTime,
                    reason: `Кабинет «${item.room?.name || 'без названия'}» занят: ${item.title}`,
                });
            }
            if (slot.teacherId && slot.teacherId === item.teacherId) {
                const teacherName = item.teacher
                    ? [item.teacher.lastName, item.teacher.name, item.teacher.middleName].filter(Boolean).join(' ').trim()
                    : 'Преподаватель';
                conflicts.push({
                    slotIndex: index,
                    scope: 'existing',
                    classId: item.id,
                    title: item.title,
                    date: slot.date, startTime: slot.startTime, endTime: slot.endTime,
                    reason: `${teacherName} уже ведёт: ${item.title}`,
                });
            }
            if (slot.groupId && slot.groupId === item.groupId) {
                conflicts.push({
                    slotIndex: index,
                    scope: 'existing',
                    classId: item.id,
                    title: item.title,
                    date: slot.date, startTime: slot.startTime, endTime: slot.endTime,
                    reason: `У группы уже есть занятие: ${item.title}`,
                });
            }
            if (slot.individualStudentId && slot.individualStudentId === item.individualStudentId) {
                conflicts.push({
                    slotIndex: index,
                    scope: 'existing',
                    classId: item.id,
                    title: item.title,
                    date: slot.date, startTime: slot.startTime, endTime: slot.endTime,
                    reason: `У ученика уже есть занятие: ${item.title}`,
                });
            }
        }

        previousSlots.push({ slot, slotIndex: index });
        previousSlotsByDate.set(slotDateKey, previousSlots);
    }

    return limit === null ? conflicts : conflicts.slice(0, Math.max(0, limit));
}

function availableRecurringSlotIndexes(slots, conflicts) {
    const blocked = new Set(
        conflicts
            .filter((conflict) => conflict.scope === 'existing')
            .map((conflict) => conflict.slotIndex),
    );
    const batchConflictsBySlot = new Map();
    for (const conflict of conflicts) {
        if (conflict.scope !== 'batch') continue;
        const items = batchConflictsBySlot.get(conflict.slotIndex) || [];
        items.push(conflict);
        batchConflictsBySlot.set(conflict.slotIndex, items);
    }

    for (let index = 0; index < slots.length; index += 1) {
        if (blocked.has(index)) continue;
        const conflictsWithAcceptedSlots = (batchConflictsBySlot.get(index) || [])
            .some((conflict) => !blocked.has(conflict.conflictingSlotIndex));
        if (conflictsWithAcceptedSlots) blocked.add(index);
    }

    return slots.map((_slot, index) => index).filter((index) => !blocked.has(index));
}

async function replaceFutureRecurringClasses({
    slots,
    groupId = null,
    individualStudentId = null,
    allowConflicts = false,
    transaction = null,
}) {
    const today = normalizeScheduleDate(new Date());
    const owner = groupId ? { groupId } : { individualStudentId };
    const replace = async (tx) => {
        const existingAutoClasses = await tx.class.findMany({
            where: { ...owner, date: { gte: today }, status: 'scheduled', notes: { in: AUTO_NOTES } },
        });
        await acquireClassScheduleLocks(tx, [...existingAutoClasses, ...slots]);

        const deleted = await tx.class.deleteMany({
            where: { ...owner, date: { gte: today }, status: 'scheduled', notes: { in: AUTO_NOTES } },
        });

        const remaining = await tx.class.findMany({
            where: { ...owner, date: { gte: today }, status: { not: 'cancelled' } },
        });

        const filteredSlots = slots.filter(slot => {
            const slotDateStr = new Date(slot.date).toISOString().slice(0, 10);
            return !remaining.some(rem => {
                const remDateStr = new Date(rem.date).toISOString().slice(0, 10);
                return remDateStr === slotDateStr && rem.startTime === slot.startTime;
            });
        });

        if (!allowConflicts) {
            const conflicts = await findRecurringConflicts(filteredSlots, {
                excludeGroupId: groupId,
                excludeStudentId: individualStudentId,
            }, tx);
            if (conflicts.length) {
                const conflict = conflicts[0];
                throw classScheduleConflictError(
                    conflict,
                    `Не удалось обновить расписание: ${conflict.startTime}–${conflict.endTime} уже занято`,
                );
            }
        }

        const created = filteredSlots.length
            ? await tx.class.createMany({ data: filteredSlots })
            : { count: 0 };
        return { created: created.count, replaced: deleted.count };
    };

    if (transaction) {
        return replace(transaction);
    }
    return prisma.$transaction(replace, { timeout: 30000 });
}

function formatConflicts(conflicts) {
    const unique = [];
    const seen = new Set();
    for (const item of conflicts) {
        const dow = new Date(item.date).getDay();
        const key = `${item.reason}|${item.startTime}|${item.endTime}|${dow}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(item);
    }
    return unique.map((item) => {
        const {
            slotIndex: _slotIndex,
            conflictingSlotIndex: _conflictingSlotIndex,
            scope: _scope,
            ...publicItem
        } = item;
        return {
            ...publicItem,
            date: dateKey(item.date),
            message: `${new Date(item.date).toLocaleDateString('ru-RU')} ${item.startTime}–${item.endTime}: ${item.reason}`,
        };
    });
}

module.exports = {
    defaultRange,
    buildRecurringSlots,
    findRecurringConflicts,
    availableRecurringSlotIndexes,
    replaceFutureRecurringClasses,
    formatConflicts,
};
