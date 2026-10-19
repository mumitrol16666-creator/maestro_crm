const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { bookSectorExams, listExamLessonStudents, listPendingSectorExams } = require('../services/sectorExams');
const { notify } = require('../services/notifications');

/** Plan 1.11: the queue of sector exams from the learning platform and booking them in the schedule. */
const router = express.Router();

router.get('/pending', authenticate, requireAdmin, async (req, res) => {
    try {
        const result = await listPendingSectorExams();
        res.json({ success: true, ...result, count: result.exams.length });
    } catch (error) {
        console.error('Pending sector exams error:', error);
        res.status(500).json({ success: false, error: 'Не удалось получить экзамены, ожидающие назначения' });
    }
});

async function book(req, res, examIds) {
    try {
        const { date, startTime, endTime, teacherId, roomId, classId } = req.body || {};
        const result = await bookSectorExams({
            examIds, classId: classId || null,
            date, startTime, endTime, teacherId, roomId,
            actorId: req.user?.id || null,
        });
        if (!result.alreadyBooked) {
            notify('sector_exam.scheduled', { classRecord: result.class, exams: result.exams, added: result.addedToExisting }).catch(() => {});
            req.app.get('io')?.emit('sector_exam_scheduled', { classId: result.class.id });
        }
        res.status(result.alreadyBooked ? 200 : 201).json({
            success: true,
            class: { ...result.class, _id: result.class.id },
            booked: result.exams.length,
            alreadyBooked: result.alreadyBooked,
            addedToExisting: Boolean(result.addedToExisting),
            platformConfirmed: result.platformConfirmed ?? true,
        });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message, code: error.code });
        }
        console.error('Book sector exams error:', error);
        res.status(500).json({ success: false, error: 'Не удалось назначить экзамен' });
    }
}

// One or several exams into a new exam lesson, or into an exam lesson already booked (classId).
router.post('/book', authenticate, requireAdmin, (req, res) => book(req, res, req.body?.examIds || []));
router.post('/:examId/schedule', authenticate, requireAdmin, (req, res) => book(req, res, [req.params.examId]));

router.get('/classes/:classId/students', authenticate, requireAdmin, async (req, res) => {
    try {
        res.json({ success: true, students: await listExamLessonStudents(req.params.classId) });
    } catch (error) {
        console.error('Exam lesson students error:', error);
        res.status(500).json({ success: false, error: 'Не удалось загрузить учеников экзамена' });
    }
});

module.exports = router;
