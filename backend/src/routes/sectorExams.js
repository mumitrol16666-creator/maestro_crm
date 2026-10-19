const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { listPendingSectorExams, scheduleSectorExam } = require('../services/sectorExams');
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

router.post('/:examId/schedule', authenticate, requireAdmin, async (req, res) => {
    try {
        const { date, startTime, endTime, teacherId, roomId } = req.body || {};
        const result = await scheduleSectorExam({
            examId: req.params.examId,
            date, startTime, endTime, teacherId, roomId,
            actorId: req.user?.id || null,
        });
        if (!result.alreadyBooked) {
            notify('sector_exam.scheduled', { classRecord: result.class, exam: result.exam }).catch(() => {});
            req.app.get('io')?.emit('sector_exam_scheduled', { classId: result.class.id, sectorExamId: result.class.sectorExamId });
        }
        res.status(result.alreadyBooked ? 200 : 201).json({
            success: true,
            class: { ...result.class, _id: result.class.id },
            alreadyBooked: result.alreadyBooked,
            platformConfirmed: result.platformConfirmed ?? true,
        });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message, code: error.code });
        }
        console.error('Schedule sector exam error:', error);
        res.status(500).json({ success: false, error: 'Не удалось назначить экзамен' });
    }
});

module.exports = router;
