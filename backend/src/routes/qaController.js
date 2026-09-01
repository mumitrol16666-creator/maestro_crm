const express = require('express');
const { prisma } = require('../config/db');
const { requireQaController } = require('../middleware/qaControllerAuth');
const { assertQaEnvironment } = require('../services/qaEnvironment');
const {
    QaFixtureError,
    createQaLesson,
    cancelQaLesson,
    rescheduleQaLesson,
    substituteQaLessonTeacher,
    changeQaGroupRoster,
    resetQaRunFixtures,
    getQaControllerStatus,
} = require('../services/qaFixtureController');

const router = express.Router();

router.use(requireQaController);

function route(handler) {
    return async (req, res) => {
        try {
            const data = await handler(req);
            return res.json({ success: true, data });
        } catch (error) {
            if (error instanceof QaFixtureError) {
                return res.status(error.status).json({ success: false, code: error.code, error: error.message });
            }
            console.error('[qa-controller]', error);
            return res.status(500).json({ success: false, code: 'QA_CONTROLLER_ERROR', error: 'QA controller operation failed' });
        }
    };
}

router.get('/status', route(async () => ({
    environment: assertQaEnvironment(),
    fixtures: await getQaControllerStatus(prisma),
})));

router.post('/reset', route(async () => resetQaRunFixtures(prisma)));

router.post('/lessons', route(async (req) => createQaLesson(prisma, req.body || {})));

router.post('/lessons/:crmClassId/cancel', route(async (req) => (
    cancelQaLesson(prisma, req.params.crmClassId, req.body?.reason)
)));

router.patch('/lessons/:crmClassId/reschedule', route(async (req) => (
    rescheduleQaLesson(prisma, req.params.crmClassId, req.body || {})
)));

router.patch('/lessons/:crmClassId/substitute', route(async (req) => (
    substituteQaLessonTeacher(prisma, req.params.crmClassId, req.body?.teacherId)
)));

router.patch('/groups/QA-GROUP-1/roster', route(async (req) => (
    changeQaGroupRoster(prisma, req.body?.studentId, req.body?.state)
)));

module.exports = router;
