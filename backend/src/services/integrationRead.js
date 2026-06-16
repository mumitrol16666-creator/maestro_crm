const { prisma } = require('../config/db');

function parseDateRange(from, to) {
    const now = new Date();
    const start = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = to ? new Date(to) : new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return { error: 'Invalid from/to date' };
    }
    if (start > end) {
        return { error: 'from must be before to' };
    }
    return { start, end };
}

function mapTeacherRef(teacher) {
    if (!teacher) return null;
    return {
        crmTeacherId: teacher.id,
        name: `${teacher.name} ${teacher.lastName || ''}`.trim(),
    };
}

function mapStudentRef(student) {
    if (!student) return null;
    return {
        crmStudentId: student.id,
        appUserId: student.appUserId || null,
        name: `${student.name} ${student.lastName || ''}`.trim(),
        phone: student.phone,
    };
}

function mapClassSummary(cls) {
    return {
        crmClassId: cls.id,
        title: cls.title,
        date: cls.date,
        startTime: cls.startTime,
        endTime: cls.endTime,
        duration: cls.duration,
        status: cls.status,
        classType: cls.classType,
        isPractice: cls.isPractice,
        group: cls.group ? { crmGroupId: cls.group.id, name: cls.group.name } : null,
        teacher: mapTeacherRef(cls.teacher),
        room: cls.room ? { crmRoomId: cls.room.id, name: cls.room.name } : null,
        crmIndividualStudentId: cls.individualStudentId || null,
    };
}

function mapClassDetail(cls) {
    const published = cls.status === 'completed';
    return {
        ...mapClassSummary(cls),
        topic: cls.topic,
        lessonGoals: cls.lessonGoals,
        lessonSummary: cls.lessonSummary,
        homeworkDraft: cls.homeworkDraft,
        nextLessonFocus: cls.nextLessonFocus,
        materials: cls.materials,
        teacherComment: cls.teacherComment,
        teacherOutcomeHint: cls.teacherOutcomeHint,
        startedAt: cls.startedAt,
        finishedAt: cls.finishedAt,
        submittedAt: cls.submittedAt,
        reviewedAt: cls.reviewedAt,
        publishedTopic: published ? cls.topic : null,
        publishedHomework: published ? cls.homeworkDraft : null,
    };
}

function dedupeClassSummaries(classes) {
    const seenIds = new Set();
    const seenSignatures = new Set();

    return classes.filter((cls) => {
        if (cls.id) {
            if (seenIds.has(cls.id)) return false;
            seenIds.add(cls.id);
        }

        const signature = [
            cls.date instanceof Date ? cls.date.toISOString() : cls.date,
            cls.startTime,
            cls.endTime,
            cls.title,
            cls.teacherId,
            cls.groupId || cls.group?.id,
            cls.individualStudentId,
            cls.roomId || cls.room?.id,
        ].map((value) => String(value || '').trim()).join('|');

        if (signature.replace(/\|/g, '')) {
            if (seenSignatures.has(signature)) return false;
            seenSignatures.add(signature);
        }

        return true;
    });
}

async function getTeacherOfflineClasses(crmTeacherId, from, to) {
    const teacher = await prisma.student.findUnique({
        where: { id: crmTeacherId },
        select: { id: true, role: true, name: true, lastName: true },
    });

    if (!teacher) {
        return { success: false, error: 'Teacher not found', status: 404 };
    }
    if (teacher.role !== 'teacher') {
        return { success: false, error: 'CRM user is not a teacher', status: 400 };
    }

    const range = parseDateRange(from, to);
    if (range.error) {
        return { success: false, error: range.error };
    }

    const classes = await prisma.class.findMany({
        where: {
            teacherId: crmTeacherId,
            isPractice: false,
            status: { not: 'cancelled' },
            date: { gte: range.start, lte: range.end },
        },
        include: {
            group: { select: { id: true, name: true } },
            teacher: { select: { id: true, name: true, lastName: true } },
            room: { select: { id: true, name: true } },
            individualStudent: { select: { id: true, name: true, lastName: true } },
        },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });

    return {
        success: true,
        data: {
            crmTeacherId,
            teacher: mapTeacherRef(teacher),
            from: range.start.toISOString(),
            to: range.end.toISOString(),
            classes: dedupeClassSummaries(classes).map(mapClassSummary),
        },
    };
}

async function getClassCard(crmClassId) {
    const cls = await prisma.class.findUnique({
        where: { id: crmClassId },
        include: {
            group: { select: { id: true, name: true, direction: true } },
            teacher: { select: { id: true, name: true, lastName: true } },
            room: { select: { id: true, name: true } },
            individualStudent: {
                select: { id: true, name: true, lastName: true, phone: true, appUserId: true },
            },
        },
    });

    if (!cls) {
        return { success: false, error: 'Class not found', status: 404 };
    }

    return {
        success: true,
        data: {
            ...mapClassDetail(cls),
            groupDirection: cls.group?.direction || null,
            individualStudent: mapStudentRef(cls.individualStudent),
        },
    };
}

async function getClassStudents(crmClassId) {
    const cls = await prisma.class.findUnique({
        where: { id: crmClassId },
        include: {
            group: { select: { id: true, name: true } },
            attendees: {
                include: {
                    student: {
                        select: { id: true, name: true, lastName: true, phone: true, appUserId: true },
                    },
                },
            },
            individualStudent: {
                select: { id: true, name: true, lastName: true, phone: true, appUserId: true },
            },
        },
    });

    if (!cls) {
        return { success: false, error: 'Class not found', status: 404 };
    }

    const attendeeByStudent = new Map();
    for (const row of cls.attendees) {
        if (row.studentId) attendeeByStudent.set(row.studentId, row);
    }

    let roster = [];

    if (cls.individualStudent) {
        const att = attendeeByStudent.get(cls.individualStudent.id);
        roster.push({
            ...mapStudentRef(cls.individualStudent),
            attended: att?.attended ?? null,
            attendanceStatus: att?.attendanceStatus ?? 'unmarked',
            teacherNote: att?.teacherNote ?? null,
            markedAt: att?.markedAt ?? null,
        });
    } else if (cls.groupId) {
        const groupStudents = await prisma.studentGroup.findMany({
            where: {
                groupId: cls.groupId,
                status: { in: ['active', 'Active'] },
            },
            include: {
                student: {
                    select: { id: true, name: true, lastName: true, phone: true, appUserId: true },
                },
            },
        });

        roster = groupStudents
            .filter((row) => row.student)
            .map((row) => {
                const att = attendeeByStudent.get(row.student.id);
                return {
                    ...mapStudentRef(row.student),
                    groupStatus: row.status,
                    attended: att?.attended ?? null,
                    attendanceStatus: att?.attendanceStatus ?? 'unmarked',
                    teacherNote: att?.teacherNote ?? null,
                    markedAt: att?.markedAt ?? null,
                };
            });
    }

    return {
        success: true,
        data: {
            crmClassId,
            group: cls.group ? { crmGroupId: cls.group.id, name: cls.group.name } : null,
            students: roster,
        },
    };
}

async function getStudentOfflineSummary(crmStudentId) {
    const student = await prisma.student.findUnique({
        where: { id: crmStudentId },
        include: {
            groups: {
                where: { status: { in: ['active', 'Active'] } },
                include: { group: { select: { id: true, name: true, instruments: true, schedules: true } } },
            },
            memberships: {
                where: { status: 'active' },
                orderBy: { createdAt: 'desc' },
                include: {
                    group: { select: { id: true, name: true, direction: true } },
                    teacher: { select: { id: true, name: true, lastName: true } },
                    plan: { select: { id: true, name: true } },
                },
            },
        },
    });

    if (!student) {
        return { success: false, error: 'Student not found', status: 404 };
    }
    if (student.role !== 'student') {
        return { success: false, error: 'CRM user is not a student', status: 400 };
    }

    const groupIds = student.groups.map((sg) => sg.groupId).filter(Boolean);

    const schoolLessons = await prisma.class.findMany({
        where: {
            isPractice: false,
            status: { not: 'cancelled' },
            OR: [
                { individualStudentId: crmStudentId },
                ...(groupIds.length ? [{ groupId: { in: groupIds } }] : []),
            ],
        },
        include: {
            teacher: { select: { id: true, name: true, lastName: true } },
            room: { select: { id: true, name: true } },
            group: { select: { id: true, name: true } },
            attendees: { where: { studentId: crmStudentId } },
        },
        orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
        take: 40,
    });

    const now = new Date();
    const lessons = schoolLessons.map((cls) => {
        const attendee = cls.attendees[0];
        const lessonDate = new Date(cls.date);
        const isPast =
            lessonDate < now ||
            (lessonDate.toDateString() === now.toDateString() &&
                cls.endTime <= `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`);

        const published = cls.status === 'completed';

        return {
            crmClassId: cls.id,
            title: cls.title,
            date: cls.date,
            startTime: cls.startTime,
            endTime: cls.endTime,
            status: cls.status,
            classType: cls.classType,
            groupName: cls.group?.name || null,
            teacherName: cls.teacher
                ? `${cls.teacher.name} ${cls.teacher.lastName || ''}`.trim()
                : null,
            roomName: cls.room?.name || null,
            topic: published ? cls.topic : null,
            lessonGoals: published ? cls.lessonGoals : null,
            lessonSummary: published ? cls.lessonSummary : null,
            homework: published ? cls.homeworkDraft : null,
            nextLessonFocus: published ? cls.nextLessonFocus : null,
            materials: published && Array.isArray(cls.materials) ? cls.materials : [],
            attended: attendee?.attended ?? null,
            isPast,
        };
    });

    let debtAmount = Math.max(0, -(student.accountBalance || 0));
    let classesRemainingTotal = 0;
    let totalPaidAmount = 0;
    student.memberships.forEach((m) => {
        classesRemainingTotal += m.classesRemaining;
        totalPaidAmount += m.paidAmount;
    });
    const currentMembership = student.memberships.find((m) => m.id === student.activeMembershipId)
        || student.memberships[0]
        || null;

    const mapMembership = (m) => ({
        crmMembershipId: m.id,
        type: m.type,
        planName: m.plan?.name || null,
        directionName: m.group?.direction || null,
        groupName: m.group?.name || 'Общий',
        teacherName: m.teacher ? `${m.teacher.name} ${m.teacher.lastName || ''}`.trim() : null,
        lessonFormat: m.lessonFormat,
        classesRemaining: m.classesRemaining,
        individualClassesRemaining: m.individualClassesRemaining,
        groupClassesRemaining: m.groupClassesRemaining,
        theoryClassesRemaining: m.theoryClassesRemaining,
        emergencyFreezesAvailable: m.emergencyFreezesAvailable,
        emergencyFreezesUsed: m.emergencyFreezesUsed,
        totalClasses: m.totalClasses,
        startDate: m.startDate,
        endDate: m.endDate,
        totalPriceKzt: m.totalPrice,
        paidAmountKzt: m.paidAmount,
        remainingAmountKzt: m.remainingAmount,
        paymentStatus: m.paymentStatus,
    });

    return {
        success: true,
        data: {
            crmStudentId: student.id,
            appUserId: student.appUserId,
            externalLinkStatus: student.externalLinkStatus,
            profile: {
                name: `${student.name} ${student.lastName}`.trim(),
                phone: student.phone,
                groups: student.groups.map((sg) => ({
                    crmGroupId: sg.group?.id,
                    name: sg.group?.name,
                    instruments: sg.group?.instruments || [],
                    schedules: sg.group?.schedules || [],
                })),
            },
            balanceSnapshot: {
                classesRemainingTotal,
                debtAmountKzt: debtAmount,
                accountBalanceKzt: student.accountBalance,
                totalPaidAmountKzt: totalPaidAmount,
                currentMembership: currentMembership ? mapMembership(currentMembership) : null,
                memberships: student.memberships.map(mapMembership),
            },
            upcomingLessons: lessons.filter((l) => !l.isPast && l.status === 'scheduled').slice(0, 10),
            lessonHistory: lessons.filter((l) => l.isPast || l.status !== 'scheduled').slice(0, 20),
        },
    };
}

async function getStudentFreezeStatus(crmStudentId, date) {
    const student = await prisma.student.findUnique({
        where: { id: crmStudentId },
        select: { id: true, role: true },
    });

    if (!student) {
        return { success: false, error: 'Student not found', status: 404 };
    }
    if (student.role !== 'student') {
        return { success: false, error: 'CRM user is not a student', status: 400 };
    }

    const targetDate = date ? new Date(date) : new Date();
    if (isNaN(targetDate.getTime())) {
        return { success: false, error: 'Invalid date' };
    }

    const activeFreeze = await prisma.freeze.findFirst({
        where: {
            studentId: crmStudentId,
            status: 'active',
            startDate: { lte: targetDate },
            endDate: { gte: targetDate },
        },
        orderBy: { startDate: 'desc' },
        include: {
            membership: { select: { id: true, type: true, classesRemaining: true } },
        },
    });

    const pendingFreeze = await prisma.freeze.findFirst({
        where: { studentId: crmStudentId, status: 'pending' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, type: true, startDate: true, endDate: true, status: true },
    });

    return {
        success: true,
        data: {
            crmStudentId,
            date: targetDate.toISOString(),
            isFrozen: Boolean(activeFreeze),
            activeFreeze: activeFreeze
                ? {
                      crmFreezeId: activeFreeze.id,
                      type: activeFreeze.type,
                      startDate: activeFreeze.startDate,
                      endDate: activeFreeze.endDate,
                      frozenClasses: activeFreeze.frozenClasses,
                      membership: activeFreeze.membership,
                  }
                : null,
            pendingFreeze: pendingFreeze || null,
        },
    };
}

async function getPendingReviewClasses() {
    const classes = await prisma.class.findMany({
        where: {
            isPractice: false,
            status: 'pending_admin_review',
        },
        include: {
            group: { select: { id: true, name: true } },
            teacher: { select: { id: true, name: true, lastName: true } },
            room: { select: { id: true, name: true } },
            individualStudent: { select: { id: true, name: true, lastName: true } },
        },
        orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
        take: 100,
    });

    return {
        success: true,
        data: {
            classes: dedupeClassSummaries(classes).map(mapClassDetail),
        },
    };
}

module.exports = {
    getTeacherOfflineClasses,
    getClassCard,
    getClassStudents,
    getStudentOfflineSummary,
    getStudentFreezeStatus,
    getPendingReviewClasses,
    mapClassDetail,
};
