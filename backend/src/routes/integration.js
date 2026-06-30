const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { getTeacherRate, isPayableClass } = require('../services/salaryPolicy');
const { requireIntegrationAuth } = require('../middleware/integrationAuth');
const { createIntegrationAuditMiddleware } = require('../services/integrationJournal');
const { buildCrmIntegrationSnapshot } = require('../services/integrationReconciliation');
const { getLinkStatus, linkUsers, syncFromApp, createSsoToken, getCrmProfileByPhone } = require('../services/userLink');
const {
    getTeacherOfflineClasses,
    getTeacherStudents,
    getClassCard,
    getClassStudents,
    getStudentOfflineSummary,
    getStudentFreezeStatus,
    getPendingReviewClasses,
    getAdminOfflineClasses,
} = require('../services/integrationRead');

function formatIntegrationFio(person, fallback = '') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}
const {
    teacherStart,
    teacherFinish,
    teacherSubmit,
    teacherMarkNotHeld,
    teacherWithdraw,
    teacherSetAttendance,
    adminSetAttendance,
    adminApproveClass,
    returnClassToTeacher,
    reopenClass,
} = require('../services/integrationWrite');
const { createAppOnlineLessonBooking } = require('../services/integrationBooking');

router.use(requireIntegrationAuth);
router.use(createIntegrationAuditMiddleware());

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

// POST /api/integration/v1/bookings/:externalSourceId/app-status
router.post('/bookings/:externalSourceId/app-status', async (req, res) => {
    try {
        const appStatus = String(req.body?.status || '').trim();
        const allowed = ['new', 'assigned', 'scheduled', 'completed', 'cancelled', 'no_show'];
        if (!allowed.includes(appStatus)) {
            return res.status(400).json({ success: false, error: 'Invalid app status' });
        }
        const booking = await prisma.booking.update({
            where: { externalSourceId: req.params.externalSourceId },
            data: { appStatus },
        });
        return res.json({ success: true, data: { crmBookingId: booking.id, appStatus: booking.appStatus } });
    } catch (error) {
        console.error('[integration] app booking status error:', error);
        return res.status(error.code === 'P2025' ? 404 : 500).json({
            success: false,
            error: error.code === 'P2025' ? 'Booking not found' : 'Failed to update booking status',
        });
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
        const { appUserId, phone, firstName, lastName, middleName, dateOfBirth, email } = req.body || {};
        const result = await syncFromApp({ appUserId, phone, firstName, lastName, middleName, dateOfBirth, email });
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

// GET /api/integration/v1/teachers/:crmTeacherId/salary-summary
router.get('/teachers/:crmTeacherId/salary-summary', async (req, res) => {
    try {
        const { crmTeacherId } = req.params;
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        const teacher = await prisma.student.findUnique({ where: { id: crmTeacherId } });
        if (!teacher || teacher.role !== 'teacher') {
            return res.status(404).json({ success: false, error: 'Teacher not found' });
        }

        const salaries = await prisma.salary.findMany({
            where: {
                teacherId: crmTeacherId,
                periodStart: { gte: startOfMonth },
                status: { in: ['calculated', 'paid'] }
            }
        });

        let calculatedSalary = 0;
        let paidSalary = 0;
        let monthlyBonus = 0;
        let monthlyFine = 0;
        let monthlyAdvance = 0;

        for (const sal of salaries) {
            if (sal.status === 'paid') {
                paidSalary += sal.teacherSalary;
            } else if (sal.status === 'calculated') {
                calculatedSalary += sal.teacherSalary;
            }
            monthlyBonus += sal.bonus;
            monthlyFine += sal.penaltyDeduction;
            monthlyAdvance += sal.advance;
        }

        const classes = await prisma.class.findMany({
            where: {
                teacherId: crmTeacherId,
                date: { gte: startOfMonth, lte: endOfMonth },
                status: { in: ['completed', 'cancelled'] },
                salaryRecords: { none: {} }
            },
            include: {
                attendees: true
            }
        });

        let currentMonthPendingEarnings = 0;
        let pendingLessonsCount = 0;

        for (const cls of classes) {
            if (isPayableClass(cls)) {
                currentMonthPendingEarnings += getTeacherRate(teacher, cls);
                pendingLessonsCount++;
            }
        }

        return res.json({
            success: true,
            data: {
                teacherName: formatIntegrationFio(teacher),
                periodName: now.toLocaleString('ru-RU', { month: 'long', year: 'numeric' }),
                calculatedSalary,
                paidSalary,
                pendingSalary: currentMonthPendingEarnings,
                monthlyBonus,
                monthlyFine,
                monthlyAdvance,
                pendingLessonsCount,
                rates: {
                    individual: teacher.salaryIndividual || 0,
                    group: teacher.salaryGroup || 0,
                    other: teacher.salaryOther || 0
                }
            }
        });
    } catch (error) {
        console.error('[integration] teacher salary-summary error:', error);
        return res.status(500).json({ success: false, error: 'Failed to compute salary summary' });
    }
});

// GET /api/integration/v1/teachers/:crmTeacherId/students
router.get('/teachers/:crmTeacherId/students', async (req, res) => {
    try {
        const result = await getTeacherStudents(req.params.crmTeacherId);
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] teacher students error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load teacher students' });
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

router.get('/classes/admin-agenda', async (req, res) => {
    try {
        const result = await getAdminOfflineClasses();
        return res.json(result);
    } catch (error) {
        console.error('[integration] admin agenda error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load admin class agenda' });
    }
});

// GET /api/integration/v1/reconciliation/snapshot
// Snapshot для сверки со стороны приложения. Только service-token.
router.get('/reconciliation/snapshot', async (req, res) => {
    try {
        const snapshot = await buildCrmIntegrationSnapshot();
        return res.json({ success: true, data: snapshot });
    } catch (error) {
        console.error('[integration] reconciliation snapshot error:', error);
        return res.status(500).json({ success: false, error: 'Failed to build reconciliation snapshot' });
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

// POST /api/integration/v1/students/:crmStudentId/avatar
router.post('/students/:crmStudentId/avatar', async (req, res) => {
    try {
        let avatarUrl = String(req.body?.avatarUrl || '').trim();
        if (!avatarUrl || avatarUrl.length > 512) {
            return res.status(400).json({ success: false, error: 'avatarUrl is required' });
        }
        if (!/^https?:\/\//i.test(avatarUrl)) {
            return res.status(400).json({ success: false, error: 'avatarUrl must be absolute URL' });
        }
        avatarUrl = avatarUrl.replace(/^http:\/\/maestro-school\.duckdns\.org/i, 'https://maestro-school.duckdns.org');

        const existing = await prisma.student.findUnique({
            where: { id: req.params.crmStudentId },
            select: { id: true, role: true },
        });
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Student not found' });
        }
        if (existing.role !== 'student') {
            return res.status(400).json({ success: false, error: 'CRM user is not a student' });
        }

        const student = await prisma.student.update({
            where: { id: req.params.crmStudentId },
            data: { studentAvatar: avatarUrl },
            select: { id: true, studentAvatar: true },
        });

        return res.json({
            success: true,
            data: {
                crmStudentId: student.id,
                studentAvatar: student.studentAvatar,
            },
        });
    } catch (error) {
        console.error('[integration] student avatar error:', error);
        return res.status(error.code === 'P2025' ? 404 : 500).json({
            success: false,
            error: error.code === 'P2025' ? 'Student not found' : 'Failed to update student avatar',
        });
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

router.post('/classes/:crmClassId/teacher-withdraw', async (req, res) => {
    try {
        const { crmTeacherId, reason } = req.body || {};
        const result = await teacherWithdraw(req.params.crmClassId, { crmTeacherId, reason });
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('[integration] teacher-withdraw error:', error);
        return res.status(500).json({ success: false, error: 'Failed to withdraw class review' });
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

router.post('/classes/:crmClassId/return-to-teacher', async (req, res) => {
    try {
        const result = await returnClassToTeacher(
            req.params.crmClassId,
            req.body?.crmAdminId || req.body?.actorId,
            req.body?.reason,
        );
        if (!result.success) return res.status(result.status || 400).json(result);
        return res.json(result);
    } catch (error) {
        console.error('[integration] return class error:', error);
        return res.status(500).json({ success: false, error: 'Failed to return class to teacher' });
    }
});

router.post('/classes/:crmClassId/reopen', async (req, res) => {
    try {
        const result = await reopenClass(
            req.params.crmClassId,
            req.body?.crmAdminId || req.body?.actorId,
            req.body?.reason,
        );
        if (!result.success) return res.status(result.status || 400).json(result);
        return res.json(result);
    } catch (error) {
        console.error('[integration] reopen class error:', error);
        return res.status(500).json({ success: false, error: 'Failed to reopen class' });
    }
});

module.exports = router;
