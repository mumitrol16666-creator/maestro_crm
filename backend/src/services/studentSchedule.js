const { prisma } = require('../config/db');
const {
    defaultRange,
    buildRecurringSlots,
    findRecurringConflicts,
    replaceFutureRecurringClasses,
    formatConflicts,
} = require('./regularScheduleAutomation');

const INDIVIDUAL_MEMBERSHIP_TYPES = new Set(['individual_package', 'individual_single', 'trial']);

function mapScheduleItem(item) {
    return {
        id: item.id,
        dayOfWeek: item.dayOfWeek,
        time: item.time,
        duration: item.duration || 90,
        roomId: item.roomId || item.room?.id || null,
        room: item.room ? { id: item.room.id, name: item.room.name } : null,
        teacherId: item.teacherId || item.teacher?.id || null,
        teacher: item.teacher
            ? { id: item.teacher.id, name: `${item.teacher.name} ${item.teacher.lastName || ''}`.trim() }
            : null,
        isPractice: Boolean(item.isPractice),
    };
}

async function loadStudentWithScheduleContext(studentId) {
    return prisma.student.findUnique({
        where: { id: studentId },
        include: {
            assignedTeacher: { select: { id: true, name: true, lastName: true } },
            groups: {
                where: { status: 'active' },
                include: {
                    group: {
                        include: {
                            schedules: { include: { room: true } },
                            teacher: { select: { id: true, name: true, lastName: true } },
                        },
                    },
                },
            },
            activeMembership: {
                include: {
                    group: {
                        include: {
                            schedules: { include: { room: true } },
                            teacher: { select: { id: true, name: true, lastName: true } },
                        },
                    },
                },
            },
            memberships: {
                where: { status: 'active' },
                orderBy: { endDate: 'desc' },
            },
            schedules: {
                include: {
                    room: true,
                    teacher: { select: { id: true, name: true, lastName: true } },
                },
                orderBy: [{ dayOfWeek: 'asc' }, { time: 'asc' }],
            },
        },
    });
}

function pickPrimaryGroup(student) {
    if (student.activeMembership?.group) {
        return student.activeMembership.group;
    }

    const membershipGroupId = student.activeMembership?.groupId;
    if (membershipGroupId) {
        const linked = student.groups.find((entry) => entry.groupId === membershipGroupId);
        if (linked?.group) return linked.group;
    }

    const firstActive = student.groups.find((entry) => entry.status === 'active' && entry.group);
    return firstActive?.group || null;
}

function usesPersonalSchedule(student, primaryGroup) {
    const hasIndividualMembership = student.memberships?.some((membership) => INDIVIDUAL_MEMBERSHIP_TYPES.has(membership.type));
    if (hasIndividualMembership) {
        return true;
    }
    return !primaryGroup;
}

function normalizeIncomingSchedules(schedules) {
    if (!Array.isArray(schedules)) {
        return { ok: false, error: 'schedules must be an array' };
    }

    const normalized = schedules.map((item) => ({
        dayOfWeek: parseInt(item.dayOfWeek, 10),
        time: String(item.time || '').trim(),
        duration: parseInt(item.duration, 10) || 90,
        roomId: item.roomId || null,
        teacherId: item.teacherId || null,
        isPractice: Boolean(item.isPractice),
    }));

    for (const item of normalized) {
        if (!item.dayOfWeek || item.dayOfWeek < 1 || item.dayOfWeek > 7) {
            return { ok: false, error: 'dayOfWeek must be between 1 and 7' };
        }
        if (!item.time) {
            return { ok: false, error: 'time is required for each schedule item' };
        }
    }

    return { ok: true, schedules: normalized };
}

async function getStudentRegularSchedule(studentId) {
    const student = await loadStudentWithScheduleContext(studentId);
    if (!student) {
        return { success: false, error: 'Student not found', status: 404 };
    }

    const primaryGroup = pickPrimaryGroup(student);
    const personal = usesPersonalSchedule(student, primaryGroup);

    if (!personal && primaryGroup) {
        return {
            success: true,
            data: {
                source: 'group',
                groupId: primaryGroup.id,
                groupName: primaryGroup.name,
                teacherId: primaryGroup.teacherId,
                schedules: primaryGroup.schedules.map(mapScheduleItem),
            },
        };
    }

    return {
        success: true,
        data: {
            source: 'student',
            groupId: primaryGroup?.id || null,
            groupName: primaryGroup?.name || null,
            teacherId: student.assignedTeacherId || primaryGroup?.teacherId || null,
            schedules: student.schedules.map(mapScheduleItem),
        },
    };
}

async function updateStudentRegularSchedule(studentId, schedulesInput, ignoreConflicts = false) {
    const parsed = normalizeIncomingSchedules(schedulesInput);
    if (!parsed.ok) {
        return { success: false, error: parsed.error, status: 400 };
    }

    const student = await loadStudentWithScheduleContext(studentId);
    if (!student) {
        return { success: false, error: 'Student not found', status: 404 };
    }

    const primaryGroup = pickPrimaryGroup(student);
    const personal = usesPersonalSchedule(student, primaryGroup);
    const defaultTeacherId = student.assignedTeacherId || primaryGroup?.teacherId || null;
    const individualMembership = student.memberships?.find((membership) => INDIVIDUAL_MEMBERSHIP_TYPES.has(membership.type));
    const { startDate, endDate } = defaultRange(personal ? individualMembership?.endDate : null);
    const slots = buildRecurringSlots({
        schedules: parsed.schedules,
        startDate,
        endDate,
        groupId: personal ? null : primaryGroup?.id,
        individualStudentId: personal ? studentId : null,
        defaultTeacherId,
        title: personal ? `Индивидуально · ${student.name} ${student.lastName || ''}`.trim() : primaryGroup?.name,
        classType: personal ? 'individual' : 'group',
        backgroundColor: primaryGroup?.color || '#eb4d77',
    });

    if (parsed.schedules.some((item) => !item.roomId)) {
        return { success: false, error: 'Выберите кабинет для каждого регулярного занятия', status: 400 };
    }
    if (slots.some((slot) => !slot.teacherId)) {
        return { success: false, error: 'Сначала закрепите преподавателя за учеником или группой', status: 400 };
    }
    if (!ignoreConflicts) {
        const conflicts = await findRecurringConflicts(slots, {
            excludeGroupId: personal ? null : primaryGroup?.id,
            excludeStudentId: personal ? studentId : null,
        });
        if (conflicts.length) {
            return {
                success: false,
                error: 'Расписание пересекается с существующими занятиями',
                conflicts: formatConflicts(conflicts),
                status: 409,
            };
        }
    }

    if (!personal && primaryGroup) {
        await prisma.groupSchedule.deleteMany({ where: { groupId: primaryGroup.id } });
        for (const item of parsed.schedules) {
            await prisma.groupSchedule.create({
                data: {
                    groupId: primaryGroup.id,
                    dayOfWeek: item.dayOfWeek,
                    time: item.time,
                    duration: item.duration,
                    roomId: item.roomId,
                    isPractice: item.isPractice,
                },
            });
        }

        const updatedGroup = await prisma.group.findUnique({
            where: { id: primaryGroup.id },
            include: { schedules: { include: { room: true } } },
        });
        const generation = await replaceFutureRecurringClasses({ slots, groupId: primaryGroup.id });

        return {
            success: true,
            generation,
            data: {
                source: 'group',
                groupId: updatedGroup.id,
                groupName: updatedGroup.name,
                schedules: updatedGroup.schedules.map(mapScheduleItem),
            },
        };
    }

    await prisma.studentSchedule.deleteMany({ where: { studentId } });
    for (const item of parsed.schedules) {
        await prisma.studentSchedule.create({
            data: {
                studentId,
                dayOfWeek: item.dayOfWeek,
                time: item.time,
                duration: item.duration,
                roomId: item.roomId,
                teacherId: item.teacherId || defaultTeacherId,
                isPractice: item.isPractice,
            },
        });
    }

    const updatedSchedules = await prisma.studentSchedule.findMany({
        where: { studentId },
        include: {
            room: true,
            teacher: { select: { id: true, name: true, lastName: true } },
        },
        orderBy: [{ dayOfWeek: 'asc' }, { time: 'asc' }],
    });
    const generation = await replaceFutureRecurringClasses({ slots, individualStudentId: studentId });

    return {
        success: true,
        generation,
        data: {
            source: 'student',
            groupId: primaryGroup?.id || null,
            groupName: primaryGroup?.name || null,
            teacherId: defaultTeacherId,
            schedules: updatedSchedules.map(mapScheduleItem),
        },
    };
}

module.exports = {
    getStudentRegularSchedule,
    updateStudentRegularSchedule,
};
