const { prisma } = require('../config/db');
const { resolveStudentNotificationContact } = require('./studentNotificationRouting');
const { estimateLessonsFromBalance } = require('../utils/membershipBalance');
const { teacherVisibleMemberships } = require('./teacherStudentMemberships');

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

function formatCrmPersonName(person, fallback = '') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function mapTeacherRef(teacher) {
    if (!teacher) return null;
    return {
        crmTeacherId: teacher.id,
        name: formatCrmPersonName(teacher),
    };
}

function mapStudentRef(student) {
    if (!student) return null;
    return {
        crmStudentId: student.id,
        appUserId: student.appUserId || null,
        name: formatCrmPersonName(student),
        firstName: student.name || '',
        lastName: student.lastName || '',
        middleName: student.middleName || '',
        dateOfBirth: student.dateOfBirth || null,
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
        startedAt: cls.startedAt,
        finishedAt: cls.finishedAt,
        submittedAt: cls.submittedAt,
        reviewedAt: cls.reviewedAt,
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
        trialReport: cls.trialReport || null,
        trialAiAnalysis: cls.trialAiAnalysis || null,
        startedAt: cls.startedAt,
        finishedAt: cls.finishedAt,
        submittedAt: cls.submittedAt,
        reviewedAt: cls.reviewedAt,
        publishedTopic: published ? cls.topic : null,
        publishedHomework: published ? cls.homeworkDraft : null,
    };
}

function buildExpectedPaymentOverview(students, thresholdKzt = 4000, visibleLimit = 12) {
    const items = students
        .map((student) => {
            const accountBalanceKzt = Number(student.accountBalance || 0);
            const expectedTopUpKzt = Math.max(0, thresholdKzt - accountBalanceKzt);
            const membership = student.memberships?.[0] || null;
            return {
                crmStudentId: student.id,
                name: formatCrmPersonName(student, 'Ученик'),
                phone: student.phone || '',
                accountBalanceKzt,
                expectedTopUpKzt,
                hasDebt: accountBalanceKzt < 0,
                direction: membership?.group?.direction
                    || student.learningDirections?.[0]
                    || null,
                planName: membership?.plan?.name || null,
            };
        })
        .filter((item) => item.expectedTopUpKzt > 0)
        .sort((left, right) => (
            left.accountBalanceKzt - right.accountBalanceKzt
            || left.name.localeCompare(right.name, 'ru')
        ));

    return {
        thresholdKzt,
        count: items.length,
        debtCount: items.filter((item) => item.hasDebt).length,
        expectedRevenueKzt: items.reduce((sum, item) => sum + item.expectedTopUpKzt, 0),
        students: items.slice(0, visibleLimit),
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

const STUDENT_LESSON_INCLUDE = {
    teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
    room: { select: { id: true, name: true } },
    group: { select: { id: true, name: true } },
    attendees: {
        select: {
            attended: true,
            attendanceStatus: true,
        },
    },
};

function getDayBounds(date = new Date()) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return { start, end };
}

function localDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getStudentClassWhere(crmStudentId, groupIds, dateFilter) {
    return {
        isPractice: false,
        status: { not: 'cancelled' },
        date: dateFilter,
        OR: [
            { individualStudentId: crmStudentId },
            ...(groupIds.length ? [{ groupId: { in: groupIds } }] : []),
        ],
    };
}

function isLessonPast(cls, now = new Date()) {
    const { start: todayStart } = getDayBounds(now);
    const lessonDay = new Date(cls.date);
    lessonDay.setHours(0, 0, 0, 0);

    if (lessonDay < todayStart) return true;
    if (lessonDay > todayStart) return false;

    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    return cls.endTime <= currentTime;
}

function mapStudentLesson(cls, now = new Date()) {
    const attendee = cls.attendees[0];
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
        teacherName: formatCrmPersonName(cls.teacher) || null,
        roomName: cls.room?.name || null,
        topic: published ? cls.topic : null,
        lessonGoals: published ? cls.lessonGoals : null,
        lessonSummary: published ? cls.lessonSummary : null,
        homework: published ? cls.homeworkDraft : null,
        nextLessonFocus: published ? cls.nextLessonFocus : null,
        materials: published && Array.isArray(cls.materials) ? cls.materials : [],
        attended: attendee?.attended ?? null,
        isPast: isLessonPast(cls, now),
    };
}

async function getTeacherOfflineClasses(crmTeacherId, from, to) {
    const teacher = await prisma.student.findUnique({
        where: { id: crmTeacherId },
        select: { id: true, role: true, name: true, lastName: true, middleName: true },
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
            teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
            room: { select: { id: true, name: true } },
            individualStudent: { select: { id: true, name: true, lastName: true, middleName: true, dateOfBirth: true } },
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

async function getTeacherStudents(crmTeacherId) {
    const teacher = await prisma.student.findUnique({
        where: { id: crmTeacherId },
        select: {
            id: true,
            role: true,
            name: true,
            lastName: true,
            middleName: true,
            teacherDirections: true,
        },
    });

    if (!teacher) {
        return { success: false, error: 'Teacher not found', status: 404 };
    }
    if (teacher.role !== 'teacher') {
        return { success: false, error: 'CRM user is not a teacher', status: 400 };
    }

    const students = await prisma.student.findMany({
        where: {
            role: 'student',
            status: 'active',
            OR: [
                { assignedTeacherId: crmTeacherId },
                {
                    groups: {
                        some: {
                            status: { in: ['active', 'Active'] },
                            group: { teacherId: crmTeacherId, isActive: true },
                        },
                    },
                },
                { schedules: { some: { teacherId: crmTeacherId, isPractice: false } } },
                { memberships: { some: { teacherId: crmTeacherId, status: 'active' } } },
            ],
        },
        select: {
            id: true,
            appUserId: true,
            externalLinkStatus: true,
            name: true,
            lastName: true,
            middleName: true,
            dateOfBirth: true,
            phone: true,
            studentAvatar: true,
            learningDirections: true,
            learningLevel: true,
            assignedTeacherId: true,
            accountBalance: true,
            groups: {
                where: {
                    status: { in: ['active', 'Active'] },
                    group: { teacherId: crmTeacherId, isActive: true },
                },
                select: {
                    group: {
                        select: {
                            id: true,
                            name: true,
                            direction: true,
                            level: true,
                        },
                    },
                },
            },
            schedules: {
                where: { teacherId: crmTeacherId, isPractice: false },
                select: {
                    id: true,
                    dayOfWeek: true,
                    time: true,
                    duration: true,
                },
                orderBy: [{ dayOfWeek: 'asc' }, { time: 'asc' }],
            },
            memberships: {
                where: { status: 'active' },
                select: {
                    id: true,
                    type: true,
                    teacherId: true,
                    groupId: true,
                    lessonFormat: true,
                    totalPrice: true,
                    totalClasses: true,
                    classesRemaining: true,
                    endDate: true,
                    plan: { select: { name: true, price: true, includedUnits: true } },
                    group: { select: { id: true, name: true, direction: true } },
                },
                orderBy: { createdAt: 'desc' },
            },
        },
        orderBy: [{ name: 'asc' }, { lastName: 'asc' }],
    });

    const attendanceRows = students.length
        ? await prisma.classAttendee.findMany({
              where: {
                  studentId: { in: students.map((student) => student.id) },
                  class: {
                      teacherId: crmTeacherId,
                      isPractice: false,
                      status: { in: ['pending_admin_review', 'completed'] },
                  },
              },
              select: {
                  studentId: true,
                  attended: true,
                  attendanceStatus: true,
                  chargeAmount: true,
                  chargeSource: true,
                  class: {
                      select: {
                          id: true,
                          title: true,
                          date: true,
                          startTime: true,
                          status: true,
                      },
                  },
              },
              orderBy: [{ class: { date: 'desc' } }, { markedAt: 'desc' }],
          })
        : [];

    const attendanceByStudent = new Map();
    for (const row of attendanceRows) {
        const history = attendanceByStudent.get(row.studentId) || [];
        if (history.length >= 5) continue;
        history.push({
            crmClassId: row.class.id,
            title: row.class.title,
            date: row.class.date,
            startTime: row.class.startTime,
            classStatus: row.class.status,
            attended: row.attended,
            attendanceStatus: row.attendanceStatus,
            chargeAmount: row.chargeAmount,
            chargeSource: row.chargeSource,
        });
        attendanceByStudent.set(row.studentId, history);
    }

    return {
        success: true,
        data: {
            crmTeacherId,
            teacher: {
                ...mapTeacherRef(teacher),
                directions: teacher.teacherDirections || [],
            },
            students: students.map((student) => {
                const teacherMemberships = teacherVisibleMemberships(student.memberships, {
                    teacherId: crmTeacherId,
                    teacherGroupIds: student.groups.map((row) => row.group?.id).filter(Boolean),
                    assignedDirectly: student.assignedTeacherId === crmTeacherId,
                    hasTeacherSchedule: student.schedules.length > 0,
                });
                const directions = new Set(student.learningDirections || []);
                for (const row of student.groups) {
                    if (row.group?.direction) directions.add(row.group.direction);
                }
                for (const membership of teacherMemberships) {
                    if (membership.group?.direction) directions.add(membership.group.direction);
                }

                return {
                    crmStudentId: student.id,
                    appUserId: student.appUserId || null,
                    externalLinkStatus: student.externalLinkStatus || null,
                    name: [student.lastName, student.name, student.middleName].filter(Boolean).join(' ').trim(),
                    firstName: student.name,
                    lastName: student.lastName || '',
                    middleName: student.middleName || '',
                    dateOfBirth: student.dateOfBirth || null,
                    phone: student.phone,
                    avatarUrl: student.studentAvatar || null,
                    learningLevel: student.learningLevel || null,
                    accountBalance: student.accountBalance,
                    directions: [...directions].filter(Boolean),
                    assignedDirectly: student.assignedTeacherId === crmTeacherId,
                    groups: student.groups
                        .filter((row) => row.group)
                        .map((row) => ({
                            crmGroupId: row.group.id,
                            name: row.group.name,
                            direction: row.group.direction,
                            level: row.group.level,
                        })),
                    schedules: student.schedules,
                    attendanceHistory: attendanceByStudent.get(student.id) || [],
                    memberships: teacherMemberships.map((membership) => {
                        const estimate = estimateLessonsFromBalance(student.accountBalance, membership);
                        return {
                            crmMembershipId: membership.id,
                            type: membership.type,
                            planName: membership.plan?.name || null,
                            lessonFormat: membership.lessonFormat,
                            lessonPrice: estimate.lessonPrice,
                            classesRemaining: estimate.estimatedLessonsRemaining ?? membership.classesRemaining,
                            endDate: membership.endDate,
                            group: membership.group
                                ? {
                                      crmGroupId: membership.group.id,
                                      name: membership.group.name,
                                      direction: membership.group.direction,
                                  }
                                : null,
                        };
                    }),
                };
            }),
        },
    };
}

async function getClassCard(crmClassId) {
    const cls = await prisma.class.findUnique({
        where: { id: crmClassId },
        include: {
            group: { select: { id: true, name: true, direction: true } },
            teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
            room: { select: { id: true, name: true } },
            individualStudent: {
                select: { id: true, name: true, lastName: true, middleName: true, dateOfBirth: true, phone: true, appUserId: true },
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
    const studentContactSelect = {
        id: true,
        name: true,
        lastName: true,
        middleName: true,
        dateOfBirth: true,
        phone: true,
        appUserId: true,
        customerName: true,
        notifyHomework: true,
        notifyLessons: true,
        notifyPayments: true,
        additionalPhones: {
            orderBy: { createdAt: 'asc' },
            select: {
                phone: true,
                label: true,
                notifyHomework: true,
                notifyLessons: true,
                notifyPayments: true,
            },
        },
    };
    const cls = await prisma.class.findUnique({
        where: { id: crmClassId },
        include: {
            group: { select: { id: true, name: true } },
            attendees: {
                include: {
                    student: {
                        select: studentContactSelect,
                    },
                },
            },
            individualStudent: {
                select: studentContactSelect,
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
            homeworkRecipient: resolveStudentNotificationContact(cls.individualStudent, 'homework'),
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
                    select: studentContactSelect,
                },
            },
        });

        roster = groupStudents
            .filter((row) => row.student)
            .map((row) => {
                const att = attendeeByStudent.get(row.student.id);
                return {
                    ...mapStudentRef(row.student),
                    homeworkRecipient: resolveStudentNotificationContact(row.student, 'homework'),
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
    const now = new Date();
    const { start: todayStart } = getDayBounds(now);

    const student = await prisma.student.findUnique({
        where: { id: crmStudentId },
        select: {
            id: true,
            role: true,
            appUserId: true,
            externalLinkStatus: true,
            name: true,
            lastName: true,
            middleName: true,
            dateOfBirth: true,
            phone: true,
            accountBalance: true,
            activeMembershipId: true,
            groups: {
                where: { status: { in: ['active', 'Active'] } },
                select: {
                    groupId: true,
                    group: { select: { id: true, name: true, instruments: true, schedules: true } },
                },
            },
            memberships: {
                where: { status: 'active' },
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    type: true,
                    lessonFormat: true,
                    classesRemaining: true,
                    individualClassesRemaining: true,
                    groupClassesRemaining: true,
                    theoryClassesRemaining: true,
                    emergencyFreezesAvailable: true,
                    emergencyFreezesUsed: true,
                    totalClasses: true,
                    startDate: true,
                    endDate: true,
                    totalPrice: true,
                    paidAmount: true,
                    remainingAmount: true,
                    paymentStatus: true,
                    group: { select: { id: true, name: true, direction: true } },
                    teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
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

    const [upcomingClasses, historyClasses] = await Promise.all([
        prisma.class.findMany({
            where: getStudentClassWhere(crmStudentId, groupIds, { gte: todayStart }),
            include: {
                ...STUDENT_LESSON_INCLUDE,
                attendees: {
                    where: { studentId: crmStudentId },
                    ...STUDENT_LESSON_INCLUDE.attendees,
                },
            },
            orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
            take: 16,
        }),
        prisma.class.findMany({
            where: getStudentClassWhere(crmStudentId, groupIds, { lt: todayStart }),
            include: {
                ...STUDENT_LESSON_INCLUDE,
                attendees: {
                    where: { studentId: crmStudentId },
                    ...STUDENT_LESSON_INCLUDE.attendees,
                },
            },
            orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
            take: 20,
        }),
    ]);

    const todayHistory = upcomingClasses.filter((cls) => isLessonPast(cls, now) || cls.status !== 'scheduled');
    const upcomingLessons = upcomingClasses
        .filter((cls) => !isLessonPast(cls, now) && cls.status === 'scheduled')
        .slice(0, 10)
        .map((cls) => mapStudentLesson(cls, now));
    const lessonHistory = [...todayHistory, ...historyClasses]
        .slice(0, 20)
        .map((cls) => mapStudentLesson(cls, now));

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
        teacherName: formatCrmPersonName(m.teacher) || null,
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
                name: [student.lastName, student.name, student.middleName].filter(Boolean).join(' ').trim(),
                firstName: student.name,
                lastName: student.lastName || '',
                middleName: student.middleName || '',
                dateOfBirth: student.dateOfBirth || null,
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
            upcomingLessons,
            lessonHistory,
        },
    };
}

async function getStudentTeachers(crmStudentId) {
    const personSelect = {
        id: true,
        appUserId: true,
        role: true,
        status: true,
        name: true,
        lastName: true,
        middleName: true,
        teacherDirections: true,
    };
    const student = await prisma.student.findUnique({
        where: { id: crmStudentId },
        select: {
            id: true,
            role: true,
            status: true,
            assignedTeacher: { select: personSelect },
            groups: {
                where: {
                    status: { in: ['active', 'Active'] },
                    group: { isActive: true },
                },
                select: {
                    group: {
                        select: {
                            direction: true,
                            teacher: { select: personSelect },
                        },
                    },
                },
            },
            schedules: {
                where: { isPractice: false, teacherId: { not: null } },
                select: { teacher: { select: personSelect } },
            },
            memberships: {
                where: { status: 'active', teacherId: { not: null } },
                select: {
                    group: { select: { direction: true } },
                    teacher: { select: personSelect },
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
    if (student.status !== 'active') {
        return { success: true, data: { crmStudentId, teachers: [] } };
    }

    const teachers = new Map();
    const addTeacher = (teacher, source, direction) => {
        if (!teacher || teacher.role !== 'teacher' || teacher.status !== 'active') return;
        const current = teachers.get(teacher.id) || {
            crmTeacherId: teacher.id,
            appUserId: teacher.appUserId || null,
            name: formatCrmPersonName(teacher),
            directions: new Set(teacher.teacherDirections || []),
            sources: new Set(),
        };
        current.sources.add(source);
        if (direction) current.directions.add(direction);
        teachers.set(teacher.id, current);
    };

    addTeacher(student.assignedTeacher, 'assigned', null);
    student.groups.forEach((row) => addTeacher(row.group?.teacher, 'group', row.group?.direction));
    student.schedules.forEach((row) => addTeacher(row.teacher, 'schedule', null));
    student.memberships.forEach((row) => addTeacher(row.teacher, 'membership', row.group?.direction));

    return {
        success: true,
        data: {
            crmStudentId,
            teachers: [...teachers.values()].map((teacher) => ({
                ...teacher,
                directions: [...teacher.directions],
                sources: [...teacher.sources],
            })),
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
            teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
            room: { select: { id: true, name: true } },
            individualStudent: { select: { id: true, name: true, lastName: true, middleName: true, dateOfBirth: true } },
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

async function getAdminOfflineClasses() {
    const from = new Date();
    from.setDate(from.getDate() - 60);
    from.setHours(0, 0, 0, 0);
    const to = new Date();
    to.setDate(to.getDate() + 90);
    to.setHours(23, 59, 59, 999);

    const classes = await prisma.class.findMany({
        where: {
            isPractice: false,
            date: { gte: from, lte: to },
        },
        include: {
            group: { select: { id: true, name: true } },
            teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
            room: { select: { id: true, name: true } },
            individualStudent: { select: { id: true, name: true, lastName: true, middleName: true, dateOfBirth: true } },
        },
        orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
        take: 500,
    });

    return {
        success: true,
        data: {
            from: from.toISOString(),
            to: to.toISOString(),
            classes: dedupeClassSummaries(classes).map(mapClassDetail),
        },
    };
}

async function getManagementDayOverview(now = new Date()) {
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const paymentThresholdKzt = 4000;

    const [
        classes,
        paymentStudents,
        pendingReviewCount,
        overdueReportsCount,
        newBookingsCount,
    ] = await Promise.all([
        prisma.class.findMany({
            where: {
                isPractice: false,
                date: { gte: todayStart, lt: tomorrowStart },
            },
            select: {
                id: true,
                title: true,
                date: true,
                startTime: true,
                endTime: true,
                duration: true,
                status: true,
                classType: true,
                isPractice: true,
                startedAt: true,
                finishedAt: true,
                submittedAt: true,
                reviewedAt: true,
                teacherOutcomeHint: true,
                teacherId: true,
                groupId: true,
                roomId: true,
                individualStudentId: true,
                group: { select: { id: true, name: true } },
                teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                room: { select: { id: true, name: true } },
                individualStudent: {
                    select: { id: true, name: true, lastName: true, middleName: true },
                },
            },
            orderBy: [{ startTime: 'asc' }, { title: 'asc' }],
        }),
        prisma.student.findMany({
            where: {
                role: 'student',
                status: 'active',
                accountBalance: { lt: paymentThresholdKzt },
            },
            select: {
                id: true,
                name: true,
                lastName: true,
                middleName: true,
                phone: true,
                accountBalance: true,
                learningDirections: true,
                memberships: {
                    where: { status: 'active' },
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: {
                        group: { select: { direction: true } },
                        plan: { select: { name: true } },
                    },
                },
            },
            orderBy: [{ accountBalance: 'asc' }, { lastName: 'asc' }, { name: 'asc' }],
        }),
        prisma.class.count({
            where: { isPractice: false, status: 'pending_admin_review' },
        }),
        prisma.class.count({
            where: {
                isPractice: false,
                status: { in: ['not_filled', 'scheduled', 'started'] },
                OR: [
                    { date: { lt: todayStart } },
                    {
                        date: { gte: todayStart, lt: tomorrowStart },
                        endTime: { lt: currentTime },
                    },
                ],
            },
        }),
        prisma.booking.count({
            where: { status: 'new', convertedToStudentId: null },
        }),
    ]);

    const lessons = dedupeClassSummaries(classes);
    const activeLessons = lessons.filter((lesson) => lesson.status !== 'cancelled');
    const lessonIsPast = (lesson) => lesson.endTime < currentTime;
    const lessonSummary = {
        total: activeLessons.length,
        upcoming: activeLessons.filter((lesson) => lesson.status === 'scheduled' && !lessonIsPast(lesson)).length,
        inProgress: activeLessons.filter((lesson) => lesson.status === 'started' && !lessonIsPast(lesson)).length,
        awaitingReport: activeLessons.filter((lesson) => (
            lesson.status === 'not_filled'
            || (['scheduled', 'started'].includes(lesson.status) && lessonIsPast(lesson))
        )).length,
        pendingReview: activeLessons.filter((lesson) => lesson.status === 'pending_admin_review').length,
        completed: activeLessons.filter((lesson) => lesson.status === 'completed').length,
        cancelled: lessons.filter((lesson) => lesson.status === 'cancelled').length,
        notHeld: lessons.filter((lesson) => lesson.teacherOutcomeHint === 'not_held').length,
    };

    return {
        success: true,
        data: {
            date: localDateKey(todayStart),
            generatedAt: now.toISOString(),
            lessons: {
                summary: lessonSummary,
                items: lessons.map((lesson) => ({
                    ...mapClassSummary(lesson),
                    audienceName: lesson.group?.name
                        || formatCrmPersonName(lesson.individualStudent, 'Индивидуальный урок'),
                    teacherOutcomeHint: lesson.teacherOutcomeHint || null,
                })),
            },
            payments: buildExpectedPaymentOverview(paymentStudents, paymentThresholdKzt),
            attention: {
                pendingReview: pendingReviewCount,
                overdueReports: overdueReportsCount,
                newBookings: newBookingsCount,
                total: pendingReviewCount + overdueReportsCount + newBookingsCount,
            },
        },
    };
}

module.exports = {
    getTeacherOfflineClasses,
    getTeacherStudents,
    getClassCard,
    getClassStudents,
    getStudentOfflineSummary,
    getStudentTeachers,
    getStudentFreezeStatus,
    getPendingReviewClasses,
    getAdminOfflineClasses,
    getManagementDayOverview,
    buildExpectedPaymentOverview,
    mapClassDetail,
};
