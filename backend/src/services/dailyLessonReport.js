const { getMembershipLessonPrice } = require('../utils/membershipBalance');

const REPORTABLE_CLASS_TYPES = new Set(['group', 'individual', 'trial', 'theory']);
const AWAITING_REPORT_STATUSES = new Set(['scheduled', 'started', 'not_filled']);
const FALLBACK_LESSON_REVENUE = {
    group: 1200,
    individual: 4000,
    trial: 2000,
    theory: 1200,
};

function membershipMatchesClass(membership, classItem) {
    if (!membership) return false;
    if (classItem.classType === 'group' || classItem.classType === 'theory') {
        if (classItem.groupId && membership.groupId) return membership.groupId === classItem.groupId;
        return ['group', 'mixed'].includes(membership.lessonFormat);
    }
    if (classItem.classType === 'individual') {
        return ['individual', 'mixed'].includes(membership.lessonFormat);
    }
    return classItem.classType === 'trial' && membership.type === 'trial';
}

function fallbackLessonRevenue(classItem) {
    const explicit = Number(classItem?.price || 0);
    if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
    return FALLBACK_LESSON_REVENUE[classItem?.classType] || 0;
}

function expectedStudentRevenue(student, classItem) {
    const fallback = fallbackLessonRevenue(classItem);
    const memberships = Array.isArray(student?.memberships) ? student.memberships : [];
    const membership = memberships.find(item => membershipMatchesClass(item, classItem));
    return getMembershipLessonPrice(membership, fallback);
}

function collectClassParticipants(classItem) {
    const participants = new Map();
    const attendeeChargeByStudent = new Map();

    for (const attendee of classItem.attendees || []) {
        const studentId = attendee.studentId || attendee.student?.id;
        if (!studentId) continue;
        const chargeAmount = Math.max(0, Number(attendee.chargeAmount) || 0);
        attendeeChargeByStudent.set(
            studentId,
            Math.max(attendeeChargeByStudent.get(studentId) || 0, chargeAmount),
        );
        if (attendee.student) participants.set(studentId, attendee.student);
    }

    if (classItem.individualStudent?.id) {
        participants.set(classItem.individualStudent.id, classItem.individualStudent);
    }
    for (const item of classItem.group?.students || []) {
        if (item.student?.id && !participants.has(item.student.id)) {
            participants.set(item.student.id, item.student);
        }
    }

    return { participants, attendeeChargeByStudent };
}

function estimateCancelledClassRevenue(classItem) {
    if (classItem.status !== 'cancelled') return 0;

    const { participants, attendeeChargeByStudent } = collectClassParticipants(classItem);
    if (participants.size > 0) {
        let lostRevenue = 0;
        for (const [studentId, student] of participants) {
            const expected = expectedStudentRevenue(student, classItem);
            const alreadyCharged = attendeeChargeByStudent.get(studentId) || 0;
            lostRevenue += Math.max(0, expected - alreadyCharged);
        }
        return lostRevenue;
    }

    const chargedWithoutStudent = (classItem.attendees || [])
        .reduce((sum, attendee) => sum + Math.max(0, Number(attendee.chargeAmount) || 0), 0);
    const fallbackParticipants = ['individual', 'trial'].includes(classItem.classType)
        ? 1
        : Math.max(0, Number(classItem.group?.currentStudents) || 0);
    return Math.max(0, fallbackLessonRevenue(classItem) * fallbackParticipants - chargedWithoutStudent);
}

function summarizeDailyLessons(classes = []) {
    const rows = classes.filter(classItem => (
        !classItem.isPractice && REPORTABLE_CLASS_TYPES.has(classItem.classType)
    ));
    const cancelledRows = rows.filter(classItem => classItem.status === 'cancelled');

    return {
        scheduled: rows.length,
        active: rows.length - cancelledRows.length,
        completed: rows.filter(classItem => classItem.status === 'completed').length,
        pendingReview: rows.filter(classItem => classItem.status === 'pending_admin_review').length,
        awaitingReport: rows.filter(classItem => AWAITING_REPORT_STATUSES.has(classItem.status)).length,
        notFilled: rows.filter(classItem => classItem.status === 'not_filled').length,
        cancelled: cancelledRows.length,
        cancelledLostRevenue: cancelledRows.reduce(
            (sum, classItem) => sum + estimateCancelledClassRevenue(classItem),
            0,
        ),
    };
}

module.exports = {
    AWAITING_REPORT_STATUSES,
    FALLBACK_LESSON_REVENUE,
    REPORTABLE_CLASS_TYPES,
    estimateCancelledClassRevenue,
    summarizeDailyLessons,
};
