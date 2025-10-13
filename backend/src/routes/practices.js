const express = require('express');
const router = express.Router();
const { authenticate, requireTeacherOrAdmin } = require('../middleware/auth');

// @route   GET /api/practices
// @desc    Get all practices
// @access  Teacher/Admin
router.get('/', authenticate, requireTeacherOrAdmin, async (req, res) => {
    try {
        // TODO: Implement practices logic
        res.json({
            success: true,
            practices: []
        });
    } catch (error) {
        console.error('Fetch practices error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении практик'
        });
    }
});

module.exports = router;

