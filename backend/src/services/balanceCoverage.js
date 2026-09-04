const DEFAULT_LESSON_CHARGES = Object.freeze({
    individual: 4000,
    group: 1200,
    theory: 1000,
});

function getLessonChargeAmount(classRecord) {
    const explicitPrice = Number(classRecord?.price || 0);
    if (Number.isFinite(explicitPrice) && explicitPrice > 0) return Math.round(explicitPrice);
    return DEFAULT_LESSON_CHARGES[classRecord?.classType] || null;
}

function isMembershipActiveOnDate(membership, lessonDate) {
    if (!membership || membership.status !== 'active') return false;

    const date = new Date(lessonDate);
    const startDate = new Date(membership.startDate);
    const endDate = new Date(membership.endDate);
    if ([date, startDate, endDate].some(value => Number.isNaN(value.getTime()))) return false;
    return startDate <= date && endDate >= date;
}

function membershipSupportsLesson(membership, lesson) {
    if (!isMembershipActiveOnDate(membership, lesson.date)) return false;

    if (lesson.classType === 'individual') {
        return membership.individualClassesRemaining === null
            ? ['individual', 'mixed'].includes(membership.lessonFormat)
            : ['individual', 'mixed'].includes(membership.lessonFormat)
                || Number(membership.individualClassesRemaining || 0) > 0;
    }

    if (lesson.classType === 'group') {
        if (membership.groupId && membership.groupId !== lesson.groupId) return false;
        return membership.groupClassesRemaining === null
            ? ['group', 'mixed'].includes(membership.lessonFormat)
            : ['group', 'mixed'].includes(membership.lessonFormat)
                || Number(membership.groupClassesRemaining || 0) > 0;
    }

    if (lesson.classType === 'theory') {
        return membership.theoryClassesRemaining === null
            ? true
            : ['group', 'mixed'].includes(membership.lessonFormat)
                || Number(membership.theoryClassesRemaining || 0) > 0;
    }

    return false;
}

function compareMembershipsNewestFirst(a, b) {
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
}

// Mirrors the membership priority used when a real lesson is approved.
function selectMembershipForLesson(memberships, lesson) {
    const eligible = memberships
        .filter(membership => isMembershipActiveOnDate(membership, lesson.date))
        .sort(compareMembershipsNewestFirst);

    if (lesson.chargedMembershipId) {
        const attached = eligible.find(membership => membership.id === lesson.chargedMembershipId);
        if (attached && membershipSupportsLesson(attached, lesson)) return attached;
    }

    if (lesson.classType === 'individual') {
        const preferred = eligible.find(membership =>
            ['individual', 'mixed'].includes(membership.lessonFormat)
            || ['individual_single', 'individual_package'].includes(membership.type)
        );
        if (preferred) return preferred;
    }

    if (lesson.classType === 'group') {
        const exactGroup = eligible.find(membership =>
            membership.groupId === lesson.groupId
            && ['group', 'mixed'].includes(membership.lessonFormat)
        );
        if (exactGroup) return exactGroup;

        const general = eligible.find(membership =>
            !membership.groupId && ['group', 'mixed'].includes(membership.lessonFormat)
        );
        if (general) return general;
    }

    if (lesson.classType === 'theory') {
        const preferred = eligible.find(membership =>
            ['group', 'mixed'].includes(membership.lessonFormat)
        );
        if (preferred) return preferred;
    }

    if (lesson.groupId) {
        const exactGroup = eligible.find(membership => membership.groupId === lesson.groupId);
        if (exactGroup) return exactGroup;

        const general = eligible.find(membership => !membership.groupId);
        if (general) return general;
    }

    return eligible.find(membership => membershipSupportsLesson(membership, lesson)) || null;
}

function compareLessons(a, b) {
    const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (dateDiff !== 0) return dateDiff;
    const timeDiff = String(a.startTime || '').localeCompare(String(b.startTime || ''));
    if (timeDiff !== 0) return timeDiff;
    return String(a.id || '').localeCompare(String(b.id || ''));
}

function getAqtobeDateKey(date) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Aqtobe', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function getLessonOccurrenceTime(lesson) {
    const lessonDate = new Date(lesson.date);
    if (Number.isNaN(lessonDate.getTime())) return null;
    const dateKey = lessonDate.toISOString().slice(0, 10);
    const time = /^\d{2}:\d{2}$/.test(String(lesson.startTime || '')) ? lesson.startTime : '00:00';
    const timestamp = Date.parse(`${dateKey}T${time}:00+05:00`);
    return Number.isNaN(timestamp) ? null : timestamp;
}

function calculateBalanceCoverage({ balance, memberships = [], lessons = [], now = null }) {
    let remainingBalance = Math.max(0, Math.round(Number(balance || 0)));
    const nowTimestamp = now ? new Date(now).getTime() : null;
    const scheduledLessons = lessons
        .filter(lesson => ['individual', 'group', 'theory'].includes(lesson.classType))
        .filter(lesson => {
            if (!Number.isFinite(nowTimestamp) || lesson.status === 'started') return true;
            const occurrenceTime = getLessonOccurrenceTime(lesson);
            return occurrenceTime == null || occurrenceTime >= nowTimestamp;
        })
        .sort(compareLessons);
    const breakdown = { individual: 0, group: 0, theory: 0 };
    let coveredLessons = 0;
    let stopReason = null;
    let nextLesson = null;

    for (const lesson of scheduledLessons) {
        const chargeAmount = getLessonChargeAmount(lesson);
        const membership = selectMembershipForLesson(memberships, lesson);

        if (!chargeAmount) {
            stopReason = 'price_unavailable';
            nextLesson = lesson;
            break;
        }
        if (!membership) {
            stopReason = 'membership_unavailable';
            nextLesson = { ...lesson, chargeAmount };
            break;
        }
        if (remainingBalance < chargeAmount) {
            stopReason = 'insufficient_balance';
            nextLesson = { ...lesson, chargeAmount, membershipId: membership.id };
            break;
        }

        remainingBalance -= chargeAmount;
        coveredLessons += 1;
        breakdown[lesson.classType] += 1;
    }

    if (scheduledLessons.length === 0) stopReason = 'no_schedule';
    else if (!stopReason) stopReason = 'all_scheduled_covered';

    return {
        coveredLessons,
        scheduledLessons: scheduledLessons.length,
        remainingBalance,
        stopReason,
        nextLesson: nextLesson ? {
            id: nextLesson.id || null,
            date: nextLesson.date,
            startTime: nextLesson.startTime || null,
            classType: nextLesson.classType,
            chargeAmount: nextLesson.chargeAmount || getLessonChargeAmount(nextLesson),
        } : null,
        breakdown,
    };
}

async function loadBalanceCoverageForStudents(db, students) {
    const studentIds = students.map(student => student.id).filter(Boolean);
    if (studentIds.length === 0) return {};

    const activeStudentsByGroup = new Map();
    for (const student of students) {
        for (const studentGroup of student.groups || []) {
            if (!['active', 'Active'].includes(studentGroup.status) || !studentGroup.groupId) continue;
            if (!activeStudentsByGroup.has(studentGroup.groupId)) {
                activeStudentsByGroup.set(studentGroup.groupId, new Set());
            }
            activeStudentsByGroup.get(studentGroup.groupId).add(student.id);
        }
    }

    const groupIds = [...activeStudentsByGroup.keys()];
    const participationFilters = [
        { individualStudentId: { in: studentIds } },
        { attendees: { some: { studentId: { in: studentIds } } } },
    ];
    if (groupIds.length > 0) participationFilters.push({ groupId: { in: groupIds } });

    const now = new Date();
    const today = new Date(`${getAqtobeDateKey(now)}T00:00:00.000Z`);
    const upcomingClasses = await db.class.findMany({
        where: {
            date: { gte: today },
            status: { in: ['scheduled', 'started'] },
            isPractice: false,
            classType: { in: ['individual', 'group', 'theory'] },
            OR: participationFilters,
        },
        select: {
            id: true, date: true, startTime: true, classType: true, groupId: true,
            individualStudentId: true, price: true, status: true,
            attendees: {
                where: { studentId: { in: studentIds } },
                select: { studentId: true, chargedMembershipId: true },
            },
        },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
    });

    const lessonsByStudent = new Map(studentIds.map(id => [id, []]));
    for (const classRecord of upcomingClasses) {
        const participantIds = new Set();
        if (classRecord.individualStudentId && lessonsByStudent.has(classRecord.individualStudentId)) {
            participantIds.add(classRecord.individualStudentId);
        }
        if (classRecord.groupId && activeStudentsByGroup.has(classRecord.groupId)) {
            for (const studentId of activeStudentsByGroup.get(classRecord.groupId)) participantIds.add(studentId);
        }
        for (const attendee of classRecord.attendees || []) {
            if (attendee.studentId && lessonsByStudent.has(attendee.studentId)) participantIds.add(attendee.studentId);
        }

        for (const studentId of participantIds) {
            const attendee = (classRecord.attendees || []).find(item => item.studentId === studentId);
            lessonsByStudent.get(studentId).push({
                ...classRecord,
                attendees: undefined,
                chargedMembershipId: attendee?.chargedMembershipId || null,
            });
        }
    }

    return Object.fromEntries(students.map(student => [
        student.id,
        calculateBalanceCoverage({
            balance: student.accountBalance,
            memberships: student.memberships || [],
            lessons: lessonsByStudent.get(student.id) || [],
            now,
        }),
    ]));
}

async function loadBalanceCoverageForMembershipRows(db, membershipRows) {
    const studentsById = new Map();
    for (const membership of membershipRows || []) {
        const student = membership.student;
        if (!student?.id) continue;
        if (!studentsById.has(student.id)) {
            studentsById.set(student.id, {
                ...student,
                memberships: [],
                groups: [],
            });
        }
        studentsById.get(student.id).memberships.push(membership);
    }

    const students = [...studentsById.values()];
    if (students.length === 0) return {};

    const groupRows = await db.studentGroup.findMany({
        where: {
            studentId: { in: students.map(student => student.id) },
            status: { in: ['active', 'Active'] },
        },
        select: { studentId: true, groupId: true, status: true },
    });
    for (const row of groupRows) {
        const student = studentsById.get(row.studentId);
        if (student) student.groups.push(row);
    }

    return loadBalanceCoverageForStudents(db, students);
}

module.exports = {
    DEFAULT_LESSON_CHARGES,
    getLessonChargeAmount,
    membershipSupportsLesson,
    selectMembershipForLesson,
    calculateBalanceCoverage,
    loadBalanceCoverageForStudents,
    loadBalanceCoverageForMembershipRows,
    getLessonOccurrenceTime,
};
