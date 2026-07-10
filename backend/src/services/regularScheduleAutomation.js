const { prisma } = require('../config/db');
const { normalizeLessonDuration } = require('../utils/duration');

const AUTO_NOTE = 'Автоматически из регулярного расписания';
const AUTO_NOTES = [AUTO_NOTE, 'Сгенерировано', 'Сгенерировано из абонемента'];

function endTime(startTime, duration) {
    const [hours, minutes] = startTime.split(':').map(Number);
    const total = (hours * 60) + minutes + normalizeLessonDuration(duration);
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function dateKey(value) {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
                    date: new Date(cursor),
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

function slotsOverlap(first, second) {
    return dateKey(first.date) === dateKey(second.date)
        && first.startTime < second.endTime
        && first.endTime > second.startTime;
}

async function findRecurringConflicts(slots, { excludeGroupId = null, excludeStudentId = null } = {}) {
    if (!slots.length) return [];
    const roomIds = [...new Set(slots.map((slot) => slot.roomId).filter(Boolean))];
    const teacherIds = [...new Set(slots.map((slot) => slot.teacherId).filter(Boolean))];
    const dates = slots.map((slot) => slot.date);
    const existing = await prisma.class.findMany({
        where: {
            status: { not: 'cancelled' },
            date: { gte: new Date(Math.min(...dates)), lte: new Date(Math.max(...dates)) },
            OR: [
                ...(roomIds.length ? [{ roomId: { in: roomIds } }] : []),
                ...(teacherIds.length ? [{ teacherId: { in: teacherIds } }] : []),
            ],
        },
        include: {
            room: { select: { name: true } },
            teacher: { select: { name: true, lastName: true, middleName: true } },
        },
    });

    const conflicts = [];
    for (let index = 0; index < slots.length; index += 1) {
        const slot = slots[index];
        const internal = slots.slice(0, index).find((other) => slotsOverlap(slot, other)
            && ((slot.roomId && slot.roomId === other.roomId) || (slot.teacherId && slot.teacherId === other.teacherId)));
        if (internal) {
            conflicts.push({
                date: slot.date, startTime: slot.startTime, endTime: slot.endTime,
                reason: slot.roomId === internal.roomId ? 'Кабинет указан сразу для двух занятий' : 'Преподаватель указан сразу для двух занятий',
            });
        }

        for (const item of existing) {
            const isOwnAutoClass = AUTO_NOTES.includes(item.notes)
                && ((excludeGroupId && item.groupId === excludeGroupId)
                    || (excludeStudentId && item.individualStudentId === excludeStudentId));
            if (isOwnAutoClass || !slotsOverlap(slot, item)) continue;
            if (slot.roomId && slot.roomId === item.roomId) {
                conflicts.push({
                    date: slot.date, startTime: slot.startTime, endTime: slot.endTime,
                    reason: `Кабинет «${item.room?.name || 'без названия'}» занят: ${item.title}`,
                });
            }
            if (slot.teacherId && slot.teacherId === item.teacherId) {
                const teacherName = item.teacher
                    ? [item.teacher.lastName, item.teacher.name, item.teacher.middleName].filter(Boolean).join(' ').trim()
                    : 'Преподаватель';
                conflicts.push({
                    date: slot.date, startTime: slot.startTime, endTime: slot.endTime,
                    reason: `${teacherName} уже ведёт: ${item.title}`,
                });
            }
        }
    }

    return conflicts.slice(0, 12);
}

async function replaceFutureRecurringClasses({ slots, groupId = null, individualStudentId = null }) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const owner = groupId ? { groupId } : { individualStudentId };
    return prisma.$transaction(async (tx) => {
        const deleted = await tx.class.deleteMany({
            where: { ...owner, date: { gte: today }, status: 'scheduled', notes: { in: AUTO_NOTES } },
        });

        const remaining = await tx.class.findMany({
            where: { ...owner, date: { gte: today } },
        });

        const filteredSlots = slots.filter(slot => {
            const slotDateStr = new Date(slot.date).toISOString().slice(0, 10);
            return !remaining.some(rem => {
                const remDateStr = new Date(rem.date).toISOString().slice(0, 10);
                return remDateStr === slotDateStr && rem.startTime === slot.startTime;
            });
        });

        if (filteredSlots.length) await tx.class.createMany({ data: filteredSlots });
        return { created: filteredSlots.length, replaced: deleted.count };
    });
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
    return unique.map((item) => ({
        ...item,
        date: dateKey(item.date),
        message: `${new Date(item.date).toLocaleDateString('ru-RU')} ${item.startTime}–${item.endTime}: ${item.reason}`,
    }));
}

module.exports = {
    defaultRange,
    buildRecurringSlots,
    findRecurringConflicts,
    replaceFutureRecurringClasses,
    formatConflicts,
};
