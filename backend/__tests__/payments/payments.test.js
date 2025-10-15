const request = require('supertest');
const express = require('express');
const paymentsRoutes = require('../../src/routes/payments');
const { createTestUser, generateAuthToken } = require('../setup');

const app = express();
app.use(express.json());
app.use(async (req, res, next) => {
    if (req.headers.authorization) {
        const token = req.headers.authorization.replace('Bearer ', '');
        const jwt = require('jsonwebtoken');
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test-secret-key');
            const Student = require('../../src/models/Student');
            const userId = decoded.userId || decoded.id;
            req.user = await Student.findById(userId).select('-password');
        } catch (error) {
            return res.status(401).json({ error: 'Недействительный токен' });
        }
    }
    next();
});
app.use('/api/payments', paymentsRoutes);

require('../setup');

describe('Payments API', () => {
    let adminToken;
    let studentUser;
    
    beforeEach(async () => {
        const admin = await createTestUser('admin', {
            name: 'Admin',
            phone: '+7 (700) 100-00-00'
        });
        adminToken = generateAuthToken(admin.user);
        
        const student = await createTestUser('student', {
            name: 'Student',
            phone: '+7 (700) 200-00-00'
        });
        studentUser = student.user;
    });
    
    

    describe('GET /api/payments', () => {
        it('админ должен получить список платежей', async () => {
            const Payment = require('../../src/models/Payment');
            const Membership = require('../../src/models/Membership');
            const Group = require('../../src/models/Group');
            
            // Создать группу для абонемента
            const group = await Group.create({
                name: 'Test Group',
                direction: 'K-pop',
                instructor: 'Teacher Name',
                students: [studentUser._id],
                isActive: true
            });
            
            // Создать абонемент
            const membership = await Membership.create({
                student: studentUser._id,
                group: group._id,
                type: 'monthly',
                totalClasses: 8,
                classesRemaining: 8,
                startDate: new Date(),
                endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                totalPrice: 22000,
                paidAmount: 0,
                remainingAmount: 22000,
                paymentStatus: 'not_paid'
            });
            
            // Создать платеж
            const admin = await createTestUser('admin', { name: 'Admin Manager', phone: '+7 (700) 111-11-11' });
            
            await Payment.create({
                student: studentUser._id,
                manager: admin.user._id,
                amount: 3000,
                type: 'membership_advance',
                paymentDate: new Date(),
                membership: membership._id,
                status: 'pending'
            });
            
            const response = await request(app)
                .get('/api/payments')
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.payments).toBeDefined();
            expect(Array.isArray(response.body.payments)).toBe(true);
        });
    });
});

