const express = require('express');
const router = express.Router();
const { authenticate, adminOnly } = require('../middleware/auth');

// @route   GET /api/payments
// @desc    Get all payments
// @access  Admin
router.get('/', authenticate, adminOnly, async (req, res) => {
    try {
        // TODO: Implement payments logic
        res.json({
            success: true,
            payments: []
        });
    } catch (error) {
        console.error('Fetch payments error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении оплат'
        });
    }
});

module.exports = router;

