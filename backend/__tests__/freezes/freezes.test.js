const request = require('supertest');
const express = require('express');
const freezesRoutes = require('../../src/routes/freezes');
const { createTestUser, generateAuthToken } = require('../setup');

// Регистрируем модели
require('../../src/models/Group');
require('../../src/models/Membership');

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
app.use('/api/freezes', freezesRoutes);

require('../setup');

describe('Freezes API', () => {
    let adminToken;
    let studentToken;
    let studentUser;
    let membershipId;
    let groupId;
    
    beforeEach(async () => {
        const admin = await createTestUser('admin', {
            name: 'Admin',
            phone: '+7 (700) 100-00-00'
        });
        adminToken = generateAuthToken(admin.user);
        
        const student = await createTestUser('student', {
            name: 'Student',
            phone: '+7 (700) 200-00-00',
            gender: 'female'
        });
        studentUser = student.user;
        studentToken = generateAuthToken(student.user);
        
        // Создаем группу
        const Group = require('../../src/models/Group');
        const group = await Group.create({
            name: 'Test Group',
            direction: 'K-pop',
            instructor: 'Teacher'
        });
        groupId = group._id;
        
        // Создаем абонемент
        const Membership = require('../../src/models/Membership');
        const membership = await Membership.create({
            student: studentUser._id,
            group: groupId,
            type: 'monthly',
            totalClasses: 8,
            classesRemaining: 5,
            status: 'active',
            startDate: new Date(),
            endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            freezesAvailable: 2,
            freezesUsed: 0
        });
        membershipId = membership._id;
        
        // Обновляем студента
        const Student = require('../../src/models/Student');
        await Student.findByIdAndUpdate(studentUser._id, {
            activeMembership: membershipId,
            groups: [{
                groupId: groupId,
                status: 'active',
                joinedAt: new Date()
            }]
        });
    });
    
    describe('POST /api/freezes', () => {
        it('не должен создать заморозку без абонемента', async () => {
            const { user: noMembershipStudent } = await createTestUser('student', {
                name: 'No Membership',
                phone: '+7 (700) 999-00-00'
            });
            const token = generateAuthToken(noMembershipStudent);
            
            const response = await request(app)
                .post('/api/freezes')
                .set('Authorization', `Bearer ${token}`)
                .send({ cycles: 1 })
                .expect(400);
            
            expect(response.body.success).toBe(false);
        });
    });
    
    describe('GET /api/freezes', () => {
        it('должен получить список заморозок (требует авторизации)', async () => {
            const response = await request(app)
                .get('/api/freezes')
                .set('Authorization', `Bearer ${studentToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.freezes).toBeDefined();
        });
    });
});

