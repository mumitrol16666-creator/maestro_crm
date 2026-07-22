const PRESENT_ATTENDANCE = new Set(['present', 'late']);
const ABSENT_ATTENDANCE = new Set(['excused_absence', 'unexcused_absence', 'emergency_freeze']);
const { getTrialParticipantId } = require('./trialParticipant');
const { findTrialBookingForClass, isVirtualTrialClass } = require('./trialClass');

function uniqueStudentIds(values) {
    return [...new Set(values.filter(Boolean))];
}

async function loadLessonRosterState(db, classRecord) {
    let expectedStudentIds = [];

    if (classRecord.individualStudentId) {
        expectedStudentIds = [classRecord.individualStudentId];
    } else if (classRecord.groupId) {
        const memberships = await db.studentGroup.findMany({
            where: {
                groupId: classRecord.groupId,
                status: { in: ['active', 'Active'] },
            },
            select: { studentId: true },
        });
        expectedStudentIds = memberships.map((membership) => membership.studentId);
    }

    const attendees = await db.classAttendee.findMany({
        where: { classId: classRecord.id },
        select: {
            studentId: true,
            attendanceStatus: true,
        },
    });

    // Пробный, назначенный из заявки, ещё не имеет Student-карточки. Для
    // посещаемости используем стабильный виртуальный идентификатор класса;
    // он никогда не участвует в списаниях и не является id ученика.
    const trialBooking = classRecord.classType === 'trial'
        ? { id: 'class-type-trial' }
        : await findTrialBookingForClass(db, classRecord.id);
    const trialParticipantId = isVirtualTrialClass(classRecord, trialBooking)
        ? getTrialParticipantId(classRecord.id)
        : null;

    expectedStudentIds = uniqueStudentIds([
        ...expectedStudentIds,
        ...attendees.map((attendee) => attendee.studentId),
        ...(trialParticipantId ? [trialParticipantId] : []),
    ]);

    const attendanceByStudentId = new Map(
        attendees
            .map((attendee) => [
                attendee.studentId || trialParticipantId,
                attendee.attendanceStatus || 'unmarked',
            ])
            .filter(([studentId]) => studentId),
    );
    const unmarkedStudentIds = expectedStudentIds.filter((studentId) => {
        const status = attendanceByStudentId.get(studentId);
        return !status || status === 'unmarked';
    });
    const presentStudentIds = expectedStudentIds.filter((studentId) => (
        PRESENT_ATTENDANCE.has(attendanceByStudentId.get(studentId))
    ));
    const absentStudentIds = expectedStudentIds.filter((studentId) => (
        ABSENT_ATTENDANCE.has(attendanceByStudentId.get(studentId))
    ));

    return {
        expectedStudentIds,
        unmarkedStudentIds,
        presentStudentIds,
        absentStudentIds,
        allAbsent: expectedStudentIds.length > 0
            && unmarkedStudentIds.length === 0
            && absentStudentIds.length === expectedStudentIds.length,
    };
}

function validateLessonSubmission({ rosterState, topic, lessonSummary }) {
    if (!rosterState.expectedStudentIds.length) {
        return {
            success: false,
            error: 'В уроке не найден ученик. Обновите расписание или обратитесь к администратору.',
            code: 'LESSON_ROSTER_EMPTY',
        };
    }

    if (rosterState.unmarkedStudentIds.length) {
        return {
            success: false,
            error: `Отметьте посещаемость у всех учеников. Осталось: ${rosterState.unmarkedStudentIds.length}.`,
            code: 'LESSON_ATTENDANCE_INCOMPLETE',
        };
    }

    if (rosterState.allAbsent) {
        return {
            success: true,
            outcome: 'no_submission',
            requiresReport: false,
        };
    }

    if (!rosterState.presentStudentIds.length) {
        return {
            success: false,
            error: 'Проверьте отметки посещаемости перед отправкой.',
            code: 'LESSON_ATTENDANCE_INVALID',
        };
    }

    if (!topic?.trim()) {
        return {
            success: false,
            error: 'Укажите тему урока перед отправкой.',
            code: 'LESSON_TOPIC_REQUIRED',
        };
    }
    if (!lessonSummary?.trim()) {
        return {
            success: false,
            error: 'Заполните итог урока перед отправкой.',
            code: 'LESSON_SUMMARY_REQUIRED',
        };
    }

    return {
        success: true,
        outcome: 'held',
        requiresReport: true,
    };
}

module.exports = {
    loadLessonRosterState,
    validateLessonSubmission,
};
