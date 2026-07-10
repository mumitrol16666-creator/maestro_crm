const DEFAULT_LESSON_DURATION_MINUTES = 60;

function normalizeLessonDuration(value, fallback = DEFAULT_LESSON_DURATION_MINUTES) {
    const duration = parseInt(value, 10);
    if (Number.isFinite(duration) && duration > 0) return duration;
    return fallback;
}

module.exports = {
    DEFAULT_LESSON_DURATION_MINUTES,
    normalizeLessonDuration,
};
