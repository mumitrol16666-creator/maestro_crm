const request = require('supertest');
const express = require('express');
const permissionsRoutes = require('../../src/routes/permissions');
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
app.use('/api/permissions', permissionsRoutes);

require('../setup');

describe('Permissions API', () => {
    let adminToken;
    let teacherToken;
    
    beforeEach(async () => {
        const admin = await createTestUser('admin', {
            name: 'Admin',
            phone: '+7 (700) 100-00-00'
        });
        adminToken = generateAuthToken(admin.user);
        
        const teacher = await createTestUser('teacher', {
            name: 'Teacher',
            phone: '+7 (700) 200-00-00'
        });
        teacherToken = generateAuthToken(teacher.user);
    });
    
    describe('GET /api/permissions', () => {
        it('должен получить список прав (авторизованный доступ)', async () => {
            const response = await request(app)
                .get('/api/permissions')
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.permissions).toBeDefined();
        });
        
        it('преподаватель должен получить свои права', async () => {
            const response = await request(app)
                .get('/api/permissions')
                .set('Authorization', `Bearer ${teacherToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
        });
    });
});

