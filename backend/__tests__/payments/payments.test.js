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
            await Payment.create({
                student: studentUser._id,
                amount: 3000,
                method: 'card',
                createdBy: adminToken
            });
            
            const response = await request(app)
                .get('/api/payments')
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.payments).toBeDefined();
        });
    });
});

