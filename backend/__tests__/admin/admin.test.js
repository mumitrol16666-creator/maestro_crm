const request = require('supertest');
const express = require('express');
const adminRoutes = require('../../src/routes/admin');
const { createTestUser, generateAuthToken } = require('../setup');

// Регистрируем модели
require('../../src/models/Group');
require('../../src/models/Booking');

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
            return res.status(401).json({ success: false, error: 'Недействительный токен' });
        }
    }
    next();
});
app.use('/api/admin', adminRoutes);

require('../setup');

describe('Admin API', () => {
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
    
    describe('GET /api/admin/stats', () => {
        it('админ должен получить статистику', async () => {
            // Создаем тестовые данные
            await createTestUser('student', { name: 'Student 1', phone: '+7 (700) 300-00-00' });
            await createTestUser('student', { name: 'Student 2', phone: '+7 (700) 301-00-00' });
            
            const Group = require('../../src/models/Group');
            await Group.create({
                name: 'Test Group',
                direction: 'K-pop',
                instructor: 'Teacher'
            });
            
            const response = await request(app)
                .get('/api/admin/stats')
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.stats).toBeDefined();
            expect(response.body.stats).toHaveProperty('totalStudents');
            expect(response.body.stats).toHaveProperty('totalGroups');
        });
        
        it('преподаватель не должен получить статистику', async () => {
            const response = await request(app)
                .get('/api/admin/stats')
                .set('Authorization', `Bearer ${teacherToken}`)
                .expect(403);
            
            expect(response.body.success).toBe(false);
        });
    });
    
});


