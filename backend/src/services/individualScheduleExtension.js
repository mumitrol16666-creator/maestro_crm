const { prisma } = require('../config/db');
const { loadStudentWithScheduleContext } = require('./studentSchedule');
const { isRateCard } = require('./rateCards');
const { isIndividualMembership, individualScheduleRange } = require('./individualSchedulePolicy');
const { acquireClassScheduleLocks, scheduleDateKey } = require('./classScheduleGuard');
const { buildRecurringSlots, findRecurringConflicts, availableRecurringSlotIndexes, formatConflicts } = require('./regularScheduleAutomation');

async function extendStudentIndividualSchedule(studentId, { db = null, now = new Date(), dryRun = false } = {}) {
    if (!db) return prisma.$transaction(async tx => {
        if (dryRun) await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return extendStudentIndividualSchedule(studentId, { db: tx, now, dryRun });
    }, { timeout: 30000 });
    if (!dryRun) await db.$queryRaw`SELECT id FROM "Student" WHERE id = ${studentId} FOR UPDATE`;
    const student = await loadStudentWithScheduleContext(studentId, db);
    const empty = reason => ({ created: 0, reason, conflicts: [] });
    if (!student || student.status !== 'active') return empty('inactive_student');
    const cards = student.memberships.filter(m => isRateCard(m) && isIndividualMembership(m));
    if (cards.length !== 1) return empty(cards.length ? 'ambiguous_rate' : 'no_individual_rate');
    const schedules = student.schedules.filter(s => !s.isPractice);
    if (!schedules.length) return empty('no_schedule');
    const teacherId = student.assignedTeacherId || student.groups[0]?.group?.teacherId;
    if (schedules.some(s => !s.roomId || !(s.teacherId || teacherId))) return empty('incomplete_schedule');
    const teacherIds = [...new Set(schedules.map(s => s.teacherId || teacherId))];
    const activeTeacherCount = await db.student.count({ where: { id: { in: teacherIds }, role: 'teacher', status: { not: 'inactive' } } });
    if (activeTeacherCount !== teacherIds.length || schedules.some(s => s.room?.isActive === false)) return empty('inactive_teacher_or_room');
    const { startDate, endDate } = individualScheduleRange(cards[0], now);
    if (startDate > endDate) return empty('outside_validity');

    // Extend only beyond the previous generated horizon. Moving or cancelling a
    // lesson within that horizon must never cause the original slot to reappear.
    let through = student.individualScheduleGeneratedThrough;
    if (!through) {
        const previous = await db.class.findFirst({
            where: { individualStudentId: studentId, isRecurring: true,
                recurringEndDate: { lt: new Date('2101-01-01') } },
            // A later schedule edit can shorten the generated period. Taking
            // the maximum across older batches would skip newly missing weeks.
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { recurringEndDate: true },
        });
        through = previous?.recurringEndDate;
    }
    if (through) {
        const after = new Date(`${new Date(through).toISOString().slice(0, 10)}T00:00:00.000Z`);
        after.setUTCDate(after.getUTCDate() + 1);
        if (after > startDate) startDate.setTime(after.getTime());
    }
    if (startDate > endDate) return empty('already_generated');
    const slots = buildRecurringSlots({ schedules, startDate, endDate,
        individualStudentId: studentId, defaultTeacherId: teacherId,
        title: `Индивидуально · ${[student.lastName, student.name, student.middleName].filter(Boolean).join(' ')}`,
        classType: 'individual',
    }).filter(s => Date.parse(`${s.date.toISOString().slice(0, 10)}T${s.startTime}:00+05:00`) > now.getTime());
    if (!dryRun) await acquireClassScheduleLocks(db, slots);
    const existing = await db.class.findMany({
        where: { individualStudentId: studentId, date: { gte: startDate, lte: endDate } },
        select: { date: true, startTime: true },
    });
    const occupied = new Set(existing.map(c => `${scheduleDateKey(c.date)}|${c.startTime}`));
    const pending = slots.filter(s => !occupied.has(`${scheduleDateKey(s.date)}|${s.startTime}`));
    const conflicts = await findRecurringConflicts(pending, { limit: null }, db);
    const available = new Set(availableRecurringSlotIndexes(pending, conflicts));
    const rows = pending.filter((_slot, index) => available.has(index));
    if (dryRun) return { created: 0, planned: rows.length, conflicts: formatConflicts(conflicts), startDate, endDate, reason: 'preview' };
    const created = rows.length ? (await db.class.createMany({ data: rows })).count : 0;
    let generatedThrough = endDate;
    if (conflicts.length) {
        generatedThrough = new Date(Math.min(...conflicts.map(c => new Date(c.date).getTime())));
        generatedThrough.setUTCDate(generatedThrough.getUTCDate() - 1);
    }
    await db.student.update({ where: { id: studentId }, data: { individualScheduleGeneratedThrough: generatedThrough } });
    return { created, conflicts: formatConflicts(conflicts), generatedThrough, reason: conflicts.length ? 'conflicts' : 'extended' };
}

async function extendIndividualSchedules() {
    const students = await prisma.student.findMany({
        where: { role: 'student', status: 'active', schedules: { some: { isPractice: false } },
            memberships: { some: { status: 'active', billingModel: 'rate_card' } } },
        select: { id: true }, orderBy: { id: 'asc' },
    });
    const result = { students: students.length, created: 0, conflicts: 0, errors: 0 };
    for (const student of students) {
        try {
            const extended = await extendStudentIndividualSchedule(student.id);
            result.created += extended.created;
            result.conflicts += extended.conflicts.length;
        } catch (error) {
            result.errors++;
            console.error('Individual schedule extension failed:', student.id, error.message);
        }
    }
    return result;
}

module.exports = { extendStudentIndividualSchedule, extendIndividualSchedules };
