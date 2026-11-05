const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { listExamLessonStudents } = require('../services/sectorExams');
// CRM retains calendar attendance; all preparation and assignment uses the app's session.
const router = express.Router();

router.get('/classes/:classId/students', authenticate, requireAdmin, async (req, res) => {
    try {
        res.json({ success: true, students: await listExamLessonStudents(req.params.classId) });
    } catch (error) {
        console.error('Exam lesson students error:', error);
        res.status(500).json({ success: false, error: 'Не удалось загрузить учеников экзамена' });
    }
});

module.exports = router;
