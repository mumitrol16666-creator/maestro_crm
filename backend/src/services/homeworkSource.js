function classStartTimestamp(cls) {
    const day = cls?.date instanceof Date
        ? cls.date.toISOString().slice(0, 10)
        : String(cls?.date || '').slice(0, 10);
    return `${day}T${String(cls?.startTime || '00:00').slice(0, 5)}`;
}

function validateReviewedHomeworkClass(currentClass, sourceClass, studentId) {
    if (!sourceClass) return 'Исходный урок домашнего задания не найден';
    if (sourceClass.id === currentClass.id) return 'Нельзя проверить домашнее задание текущего урока';
    if (sourceClass.status !== 'completed') return 'Исходный урок домашнего задания ещё не завершён';
    if (!String(sourceClass.homeworkDraft || '').trim()) return 'В исходном уроке нет домашнего задания';
    if (classStartTimestamp(sourceClass) >= classStartTimestamp(currentClass)) {
        return 'Исходный урок должен быть раньше текущего занятия';
    }

    const belongsToStudent = Boolean(studentId) && (
        sourceClass.individualStudentId === studentId
        || sourceClass.attendees?.some((attendee) => attendee.studentId === studentId)
    );
    const belongsToCurrentGroup = Boolean(
        sourceClass.groupId
        && currentClass.groupId
        && sourceClass.groupId === currentClass.groupId
    );
    if (!belongsToStudent && !belongsToCurrentGroup) {
        return 'Исходный урок не относится к этому ученику или группе';
    }

    return null;
}

module.exports = { validateReviewedHomeworkClass };
