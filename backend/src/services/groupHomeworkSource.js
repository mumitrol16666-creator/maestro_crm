function selectPreviousGroupHomework(classes) {
    const sourceLesson = classes.find((item) => item.homeworkDraft?.trim());
    if (!sourceLesson) return null;

    return {
        crmClassId: sourceLesson.id,
        date: sourceLesson.date,
        title: sourceLesson.title,
        topic: sourceLesson.topic,
        homework: sourceLesson.homeworkDraft.trim(),
        nextLessonFocus: sourceLesson.nextLessonFocus,
    };
}

module.exports = { selectPreviousGroupHomework };
