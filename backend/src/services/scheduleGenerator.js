const { prisma } = require('../config/db');

function dayKey(groupId, date) {
    const d = new Date(date);
    return `${groupId}|${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function resolveRoomId(schedules) {
    const fromSchedule = schedules.find((s) => s.roomId)?.roomId;
    if (fromSchedule) return fromSchedule;

    const room = await prisma.room.findFirst({
        where: { isActive: true },
        orderBy: { name: 'asc' },
    });
    return room?.id || null;
}

/**
 * Создаёт групповые занятия по регулярному расписанию группы на указанный период.
 * Пропускает даты, где у группы уже есть хотя бы одно занятие.
 */
async function generateClassesForGroupInRange({ groupId, startDate, endDate, createdById }) {
    const group = await prisma.group.findUnique({
        where: { id: groupId },
        include: {
            schedules: {
                where: { isPractice: false },
            },
        },
    });

    if (!group || !group.schedules?.length || !group.teacherId) {
        return { created: 0, skipped: 0, reason: 'no_schedule_or_teacher' };
    }

    const defaultRoomId = await resolveRoomId(group.schedules);
    if (!defaultRoomId) {
        return { created: 0, skipped: 0, reason: 'no_room' };
    }

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const spanDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
    if (spanDays > 180) {
        end.setTime(start.getTime());
        end.setDate(end.getDate() + 180);
        end.setHours(23, 59, 59, 999);
    }

    const planned = [];
    const endExclusive = new Date(end);
    endExclusive.setDate(endExclusive.getDate() + 1);
    endExclusive.setHours(0, 0, 0, 0);

    for (const scheduleItem of group.schedules) {
        const { dayOfWeek, time, duration } = scheduleItem;
        if (!time) continue;

        const cursor = new Date(start);
        while (cursor < endExclusive) {
            const dow = cursor.getDay() === 0 ? 7 : cursor.getDay();
            if (dow === dayOfWeek) {
                const [hh, mm] = time.split(':');
                const endAt = new Date(cursor);
                endAt.setHours(parseInt(hh, 10), parseInt(mm, 10), 0, 0);
                endAt.setMinutes(endAt.getMinutes() + (duration || 90));
                const endTimeStr = `${String(endAt.getHours()).padStart(2, '0')}:${String(endAt.getMinutes()).padStart(2, '0')}`;

                planned.push({
                    groupId: group.id,
                    teacherId: group.teacherId,
                    roomId: scheduleItem.roomId || defaultRoomId,
                    title: group.name,
                    date: new Date(cursor),
                    startTime: time,
                    endTime: endTimeStr,
                    duration: duration || 90,
                    backgroundColor: group.color || '#eb4d77',
                    createdById: createdById || null,
                });
            }
            cursor.setDate(cursor.getDate() + 1);
        }
    }

    if (planned.length === 0) {
        return { created: 0, skipped: 0, reason: 'no_slots' };
    }

    const existing = await prisma.class.findMany({
        where: {
            groupId,
            date: { gte: start, lte: end },
        },
        select: { groupId: true, date: true },
    });
    const existingDaysSet = new Set(existing.map((e) => dayKey(e.groupId, e.date)));
    const toCreate = planned.filter((p) => !existingDaysSet.has(dayKey(p.groupId, p.date)));

    if (toCreate.length === 0) {
        return { created: 0, skipped: planned.length };
    }

    await prisma.class.createMany({
        data: toCreate.map((p) => ({
            groupId: p.groupId,
            teacherId: p.teacherId,
            roomId: p.roomId,
            title: p.title,
            date: p.date,
            startTime: p.startTime,
            endTime: p.endTime,
            duration: p.duration,
            status: 'scheduled',
            backgroundColor: p.backgroundColor,
            notes: 'Сгенерировано из абонемента',
            createdById: p.createdById,
        })),
    });

    return { created: toCreate.length, skipped: planned.length - toCreate.length };
}

module.exports = {
    generateClassesForGroupInRange,
    dayKey,
};
