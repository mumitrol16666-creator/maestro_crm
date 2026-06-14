const express = require('express');
const router = express.Router();
const { requireIntegrationAuth } = require('../middleware/integrationAuth');
const { getLinkStatus, linkUsers, syncFromApp, createSsoToken, getCrmProfileByPhone } = require('../services/userLink');
const {
    getTeacherOfflineClasses,
    getClassCard,
    getClassStudents,
    getStudentOfflineSummary,
    getStudentFreezeStatus,
    getPendingReviewClasses,
} = require('../services/integrationRead');
const {
    teacherStart,
    teacherFinish,
    teacherSubmit,
    teacherMarkNotHeld,
    teacherSetAttendance,
    adminSetAttendance,
    adminApproveClass,
} = require('../services/integrationWrite');
const { createAppOnlineLessonBooking } = require('../services/integrationBooking');

router.use(requireIntegrationAuth);

// POST /api/integration/v1/bookings/online-lesson
router.post('/bookings/online-lesson', async (req, res) => {
    try {
        const result = await createAppOnlineLessonBooking(req.body || {});
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.status(201).json(result);
    } catch (error) {
        console.error('[integration] online lesson booking error:', error);
        return res.status(500).json({ success: false, error: 'Failed to create online lesson booking' });
    }
});

// POST /api/integration/v1/users/link
router.post('/users/link', async (req, res) => {
    try {
        const { phone, crmStudentId, crmTeacherId, appUserId, initiatedBy } = req.body || {};
        const crmUserId = crmStudentId || crmTeacherId;
        if (!phone && !crmUserId) {
            return res.status(400).json({ success: false, error: 'phone or crmStudentId/crmTeacherId is required' });
        }

        const result = await linkUsers({ phone, crmStudentId: crmUserId, appUserId, initiatedBy });
        if (!result.success) {
            const status = result.status === 'conflict' ? 409 : 400;
            return res.status(status).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] link error:', error);
        return res.status(500).json({ success: false, error: 'Link failed' });
    }
});

// POST /api/integration/v1/users/sync-from-app
router.post('/users/sync-from-app', async (req, res) => {
    try {
        const { appUserId, phone, firstName, lastName, email } = req.body || {};
        const result = await syncFromApp({ appUserId, phone, firstName, lastName, email });
        if (!result.success) {
            const status = result.status === 'conflict' ? 409 : 400;
            return res.status(status).json(result);
        }
        return res.status(result.data.created ? 201 : 200).json(result);
    } catch (error) {
        console.error('[integration] sync-from-app error:', error);
        return res.status(500).json({ success: false, error: 'Sync failed' });
    }
});

// GET /api/integration/v1/users/crm-lookup/:phone
router.get('/users/crm-lookup/:phone', async (req, res) => {
    try {
        const result = await getCrmProfileByPhone(req.params.phone);
        if (!result.success) {
            return res.status(400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] crm-lookup error:', error);
        return res.status(500).json({ success: false, error: 'CRM lookup failed' });
    }
});

// GET /api/integration/v1/users/link-status/:phone
router.get('/users/link-status/:phone', async (req, res) => {
    try {
        const result = await getLinkStatus(req.params.phone);
        if (!result.success) {
            return res.status(400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] link-status error:', error);
        return res.status(500).json({ success: false, error: 'Status check failed' });
    }
});

// POST /api/integration/v1/auth/sso-token
router.post('/auth/sso-token', async (req, res) => {
    try {
        const { crmStudentId } = req.body || {};
        if (!crmStudentId) {
            return res.status(400).json({ success: false, error: 'crmStudentId is required' });
        }

        const result = await createSsoToken(crmStudentId);
        if (!result.success) {
            return res.status(400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] sso-token error:', error);
        return res.status(500).json({ success: false, error: 'SSO token failed' });
    }
});

// GET /api/integration/v1/teachers/:crmTeacherId/offline-classes?from=&to=
router.get('/teachers/:crmTeacherId/offline-classes', async (req, res) => {
    try {
        const result = await getTeacherOfflineClasses(
            req.params.crmTeacherId,
            req.query.from,
            req.query.to,
        );
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] teacher offline-classes error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load teacher schedule' });
    }
});

// GET /api/integration/v1/classes/pending-review
router.get('/classes/pending-review', async (req, res) => {
    try {
        const result = await getPendingReviewClasses();
        return res.json(result);
    } catch (error) {
        console.error('[integration] pending-review error:', error);
        return res.status(500).json({ success: false, error: 'Failed to list pending review classes' });
    }
});

// GET /api/integration/v1/classes/:crmClassId
router.get('/classes/:crmClassId', async (req, res) => {
    try {
        const result = await getClassCard(req.params.crmClassId);
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] class card error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load class' });
    }
});

// GET /api/integration/v1/classes/:crmClassId/students
router.get('/classes/:crmClassId/students', async (req, res) => {
    try {
        const result = await getClassStudents(req.params.crmClassId);
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] class students error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load class students' });
    }
});

// GET /api/integration/v1/students/:crmStudentId/offline-summary
router.get('/students/:crmStudentId/offline-summary', async (req, res) => {
    try {
        const result = await getStudentOfflineSummary(req.params.crmStudentId);
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] offline-summary error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load student summary' });
    }
});

// GET /api/integration/v1/students/:crmStudentId/freeze-status?date=
router.get('/students/:crmStudentId/freeze-status', async (req, res) => {
    try {
        const result = await getStudentFreezeStatus(req.params.crmStudentId, req.query.date);
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] freeze-status error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load freeze status' });
    }
});

// POST /api/integration/v1/classes/:crmClassId/teacher-start
router.post('/classes/:crmClassId/teacher-start', async (req, res) => {
    try {
        const { crmTeacherId } = req.body || {};
        const result = await teacherStart(req.params.crmClassId, { crmTeacherId });
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] teacher-start error:', error);
        return res.status(500).json({ success: false, error: 'Failed to start class' });
    }
});

// POST /api/integration/v1/classes/:crmClassId/teacher-finish
router.post('/classes/:crmClassId/teacher-finish', async (req, res) => {
    try {
        const { crmTeacherId, comment } = req.body || {};
        const result = await teacherFinish(req.params.crmClassId, { crmTeacherId, comment });
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] teacher-finish error:', error);
        return res.status(500).json({ success: false, error: 'Failed to finish class' });
    }
});

// POST /api/integration/v1/classes/:crmClassId/teacher-submit
router.post('/classes/:crmClassId/teacher-submit', async (req, res) => {
    try {
        const result = await teacherSubmit(req.params.crmClassId, req.body || {});
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] teacher-submit error:', error);
        return res.status(500).json({ success: false, error: 'Failed to submit class review' });
    }
});

// POST /api/integration/v1/classes/:crmClassId/teacher-mark-not-held
router.post('/classes/:crmClassId/teacher-mark-not-held', async (req, res) => {
    try {
        const { crmTeacherId, comment } = req.body || {};
        const result = await teacherMarkNotHeld(req.params.crmClassId, { crmTeacherId, comment });
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] teacher-mark-not-held error:', error);
        return res.status(500).json({ success: false, error: 'Failed to mark class as not held' });
    }
});

// POST /api/integration/v1/classes/:crmClassId/teacher-attendance
router.post('/classes/:crmClassId/teacher-attendance', async (req, res) => {
    try {
        const { crmTeacherId, studentId, attended, attendanceStatus, teacherNote } = req.body || {};
        const result = await teacherSetAttendance(req.params.crmClassId, {
            crmTeacherId,
            studentId,
            attended: Boolean(attended),
            attendanceStatus,
            teacherNote,
        });
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] teacher-attendance error:', error);
        return res.status(500).json({ success: false, error: 'Failed to save attendance' });
    }
});

// POST /api/integration/v1/classes/:crmClassId/admin-attendance
router.post('/classes/:crmClassId/admin-attendance', async (req, res) => {
    try {
        const { studentId, attended, attendanceStatus, teacherNote } = req.body || {};
        const result = await adminSetAttendance(req.params.crmClassId, {
            studentId,
            attended: Boolean(attended),
            attendanceStatus,
            teacherNote,
        });
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] admin-attendance error:', error);
        return res.status(500).json({ success: false, error: 'Failed to save attendance' });
    }
});

// POST /api/integration/v1/classes/:crmClassId/approve
router.post('/classes/:crmClassId/approve', async (req, res) => {
    try {
        const result = await adminApproveClass(req.params.crmClassId, req.body || {});
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] approve class error:', error);
        return res.status(500).json({ success: false, error: 'Failed to approve class' });
    }
});

module.exports = router;
