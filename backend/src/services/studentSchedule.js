const { prisma } = require('../config/db');
const {
    defaultRange,
    buildRecurringSlots,
    findRecurringConflicts,
    replaceFutureRecurringClasses,
    formatConflicts,
} = require('./regularScheduleAutomation');
const { normalizeLessonDuration } = require('../utils/duration');

const INDIVIDUAL_MEMBERSHIP_TYPES = new Set(['individual_package', 'individual_single', 'trial']);

function formatScheduleFio(person, fallback = '') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function isIndividualMembership(membership) {
    if (!membership) return false;
    return (
        INDIVIDUAL_MEMBERSHIP_TYPES.has(membership.type) ||
        membership.lessonFormat === 'individual' ||
        membership.lessonFormat === 'mixed'
    );
}

function mapScheduleItem(item, options = {}) {
    const defaultTeacherId = options.defaultTeacherId || null;
    const defaultTeacher = options.defaultTeacher || null;
    const collapseDefaultTeacher = Boolean(options.collapseDefaultTeacher);
    const storedTeacherId = item.teacherId || item.teacher?.id || null;
    const storedTeacherIsLegacyDefault = collapseDefaultTeacher && storedTeacherId && storedTeacherId === defaultTeacherId;
    const explicitTeacherId = storedTeacherIsLegacyDefault ? null : storedTeacherId;
    const effectiveTeacherId = explicitTeacherId || defaultTeacherId || null;
    const effectiveTeacher = explicitTeacherId
        ? item.teacher
        : defaultTeacher;

    return {
        id: item.id,
        dayOfWeek: item.dayOfWeek,
        time: item.time,
        duration: normalizeLessonDuration(item.duration),
        roomId: item.roomId || item.room?.id || null,
        room: item.room ? { id: item.room.id, name: item.room.name } : null,
        teacherId: explicitTeacherId,
        teacher: explicitTeacherId && item.teacher
            ? { id: item.teacher.id, name: formatScheduleFio(item.teacher) }
            : null,
        effectiveTeacherId,
        effectiveTeacher: effectiveTeacher
            ? { id: effectiveTeacher.id, name: formatScheduleFio(effectiveTeacher) }
            : null,
        isPractice: Boolean(item.isPractice),
    };
}

async function loadStudentWithScheduleContext(studentId) {
    return prisma.student.findUnique({
        where: { id: studentId },
        include: {
            assignedTeacher: { select: { id: true, name: true, lastName: true, middleName: true } },
            groups: {
                where: { status: 'active' },
                include: {
                    group: {
                        include: {
                            schedules: { include: { room: true } },
                            teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                        },
                    },
                },
            },
            activeMembership: {
                include: {
                    group: {
                        include: {
                            schedules: { include: { room: true } },
                            teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
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
                    teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
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
    const hasIndividualMembership = student.memberships?.some(isIndividualMembership);
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
        duration: normalizeLessonDuration(item.duration),
        roomId: item.roomId || null,
        teacherId: item.teacherId ? String(item.teacherId).trim() : null,
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
    const individualMembership = student.memberships?.find(isIndividualMembership);
    const defaultIndividualTeacherId = student.assignedTeacherId || primaryGroup?.teacherId || null;
    const defaultIndividualTeacher = student.assignedTeacher || primaryGroup?.teacher || null;
    const mapIndividualScheduleItem = (item) => mapScheduleItem(item, {
        defaultTeacherId: defaultIndividualTeacherId,
        defaultTeacher: defaultIndividualTeacher,
        collapseDefaultTeacher: true,
    });

    return {
        success: true,
        data: {
            groupSchedule: primaryGroup
                ? {
                    groupId: primaryGroup.id,
                    groupName: primaryGroup.name,
                    teacherId: primaryGroup.teacherId,
                    schedules: primaryGroup.schedules.map(mapScheduleItem),
                }
                : null,
            individualSchedule: {
                enabled: Boolean(individualMembership || student.schedules.length),
                teacherId: defaultIndividualTeacherId,
                defaultTeacherId: defaultIndividualTeacherId,
                defaultTeacher: defaultIndividualTeacher
                    ? { id: defaultIndividualTeacher.id, name: formatScheduleFio(defaultIndividualTeacher) }
                    : null,
                schedules: student.schedules.map(mapIndividualScheduleItem),
            },
            hasIndividualMembership: Boolean(individualMembership),
            legacy: {
                source: usesPersonalSchedule(student, primaryGroup) ? 'student' : 'group',
                groupId: primaryGroup?.id || null,
                groupName: primaryGroup?.name || null,
                schedules: usesPersonalSchedule(student, primaryGroup)
                    ? student.schedules.map(mapIndividualScheduleItem)
                    : primaryGroup?.schedules.map(mapScheduleItem) || [],
            },
        },
    };
}

async function updateStudentRegularSchedule(studentId, schedulesInput, ignoreConflicts = false, scopeInput = null) {
    const parsed = normalizeIncomingSchedules(schedulesInput);
    if (!parsed.ok) {
        return { success: false, error: parsed.error, status: 400 };
    }

    const student = await loadStudentWithScheduleContext(studentId);
    if (!student) {
        return { success: false, error: 'Student not found', status: 404 };
    }

    const primaryGroup = pickPrimaryGroup(student);
    const scope = scopeInput === 'group' ? 'group' : scopeInput === 'individual' ? 'individual' : null;
    const personal = scope ? scope === 'individual' : usesPersonalSchedule(student, primaryGroup);
    if (!personal && !primaryGroup) {
        return { success: false, error: 'Ученик не состоит в активной группе', status: 400 };
    }
    const defaultTeacherId = personal
        ? student.assignedTeacherId || primaryGroup?.teacherId || null
        : primaryGroup?.teacherId || null;
    const individualMembership = student.memberships?.find(isIndividualMembership);
    if (personal) {
        const explicitTeacherIds = [...new Set(parsed.schedules.map(item => item.teacherId).filter(Boolean))];
        if (explicitTeacherIds.length) {
            const teachersCount = await prisma.student.count({
                where: { id: { in: explicitTeacherIds }, role: 'teacher', status: { not: 'inactive' } },
            });
            if (teachersCount !== explicitTeacherIds.length) {
                return { success: false, error: 'Один из выбранных преподавателей не найден или неактивен', status: 400 };
            }
        }
    }

    const generationSchedules = personal
        ? parsed.schedules
        : parsed.schedules.map(item => ({ ...item, teacherId: null }));
    const { startDate, endDate } = defaultRange(personal ? individualMembership?.endDate : null);
    const slots = buildRecurringSlots({
        schedules: generationSchedules,
        startDate,
        endDate,
        groupId: personal ? null : primaryGroup?.id,
        individualStudentId: personal ? studentId : null,
        defaultTeacherId,
        title: personal ? `Индивидуально · ${formatScheduleFio(student)}`.trim() : primaryGroup?.name,
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
                scope: 'group',
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
                teacherId: item.teacherId || null,
                isPractice: item.isPractice,
            },
        });
    }

    const updatedSchedules = await prisma.studentSchedule.findMany({
        where: { studentId },
        include: {
            room: true,
            teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
        },
        orderBy: [{ dayOfWeek: 'asc' }, { time: 'asc' }],
    });
    const generation = await replaceFutureRecurringClasses({ slots, individualStudentId: studentId });

    return {
        success: true,
        generation,
        data: {
            scope: 'individual',
            groupId: primaryGroup?.id || null,
            groupName: primaryGroup?.name || null,
            teacherId: defaultTeacherId,
            defaultTeacherId,
            defaultTeacher: student.assignedTeacher || primaryGroup?.teacher
                ? { id: (student.assignedTeacher || primaryGroup?.teacher).id, name: formatScheduleFio(student.assignedTeacher || primaryGroup?.teacher) }
                : null,
            schedules: updatedSchedules.map(item => mapScheduleItem(item, {
                defaultTeacherId,
                defaultTeacher: student.assignedTeacher || primaryGroup?.teacher || null,
                collapseDefaultTeacher: false,
            })),
        },
    };
}

module.exports = {
    getStudentRegularSchedule,
    updateStudentRegularSchedule,
};
