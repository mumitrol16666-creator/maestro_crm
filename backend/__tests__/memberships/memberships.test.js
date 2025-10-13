const request = require('supertest');
const express = require('express');
const membershipsRoutes = require('../../src/routes/memberships');
const { createTestUser, generateAuthToken } = require('../setup');

// Регистрируем модели для populate
require('../../src/models/Group');
require('../../src/models/Freeze');

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
app.use('/api/memberships', membershipsRoutes);

require('../setup');

describe('Memberships API', () => {
    let adminToken;
    let studentToken;
    let studentUser;
    let groupId;
    
    beforeEach(async () => {
        const admin = await createTestUser('admin', {
            name: 'Admin',
            phone: '+7 (700) 100-00-00'
        });
        adminToken = generateAuthToken(admin.user);
        
        const student = await createTestUser('student', {
            name: 'Test Student',
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
        
        // Добавляем студента в группу
        const Student = require('../../src/models/Student');
        await Student.findByIdAndUpdate(studentUser._id, {
            $push: {
                groups: {
                    groupId: groupId,
                    status: 'active',
                    joinedAt: new Date()
                }
            }
        });
    });
    
    describe('POST /api/memberships', () => {
        it('админ должен создать пробный абонемент', async () => {
            const membershipData = {
                studentId: studentUser._id,
                groupId: groupId,
                type: 'trial'
            };
            
            const response = await request(app)
                .post('/api/memberships')
                .set('Authorization', `Bearer ${adminToken}`)
                .send(membershipData)
                .expect(201);
            
            expect(response.body.success).toBe(true);
            expect(response.body.membership).toBeDefined();
            expect(response.body.membership.type).toBe('trial');
            expect(response.body.membership.totalClasses).toBe(1);
            expect(response.body.membership.classesRemaining).toBe(1);
        });
        
        it('должен создать месячный абонемент', async () => {
            const membershipData = {
                studentId: studentUser._id,
                groupId: groupId,
                type: 'monthly'
            };
            
            const response = await request(app)
                .post('/api/memberships')
                .set('Authorization', `Bearer ${adminToken}`)
                .send(membershipData)
                .expect(201);
            
            expect(response.body.membership.type).toBe('monthly');
            expect(response.body.membership.totalClasses).toBe(8);
            expect(response.body.membership.classesRemaining).toBe(8);
        });
        
        it('должен создать квартальный абонемент', async () => {
            const membershipData = {
                studentId: studentUser._id,
                groupId: groupId,
                type: 'quarterly'
            };
            
            const response = await request(app)
                .post('/api/memberships')
                .set('Authorization', `Bearer ${adminToken}`)
                .send(membershipData)
                .expect(201);
            
            expect(response.body.membership.type).toBe('quarterly');
            expect(response.body.membership.totalClasses).toBe(24);
            expect(response.body.membership.classesRemaining).toBe(24);
        });
        
        it('не должен создать абонемент для студента без группы', async () => {
            const { user: noGroupStudent } = await createTestUser('student', {
                name: 'No Group Student',
                phone: '+7 (700) 999-00-00'
            });
            
            const membershipData = {
                studentId: noGroupStudent._id,
                groupId: groupId,
                type: 'monthly'
            };
            
            const response = await request(app)
                .post('/api/memberships')
                .set('Authorization', `Bearer ${adminToken}`)
                .send(membershipData)
                .expect(400);
            
            expect(response.body.success).toBe(false);
        });
    });
    
    describe('GET /api/memberships/student/:studentId', () => {
        it('должен получить абонементы студента', async () => {
            const Membership = require('../../src/models/Membership');
            await Membership.create({
                student: studentUser._id,
                group: groupId,
                type: 'monthly',
                totalClasses: 8,
                classesRemaining: 5,
                status: 'active',
                startDate: new Date(),
                endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // +30 дней
            });
            
            const response = await request(app)
                .get(`/api/memberships/student/${studentUser._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.memberships).toHaveLength(1);
            expect(response.body.memberships[0].type).toBe('monthly');
        });
        
        it('студент должен видеть свои абонементы', async () => {
            const Membership = require('../../src/models/Membership');
            await Membership.create({
                student: studentUser._id,
                group: groupId,
                type: 'monthly',
                totalClasses: 8,
                classesRemaining: 5,
                status: 'active',
                startDate: new Date(),
                endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            });
            
            const response = await request(app)
                .get(`/api/memberships/student/${studentUser._id}`)
                .set('Authorization', `Bearer ${studentToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.memberships).toHaveLength(1);
        });
    });
    
    describe('PATCH /api/memberships/:id/add-classes', () => {
        it('админ должен добавить занятия к абонементу', async () => {
            const Membership = require('../../src/models/Membership');
            const membership = await Membership.create({
                student: studentUser._id,
                group: groupId,
                type: 'monthly',
                totalClasses: 8,
                classesRemaining: 2,
                status: 'active',
                startDate: new Date(),
                endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            });
            
            const response = await request(app)
                .patch(`/api/memberships/${membership._id}/add-classes`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    amount: 3,
                    reason: 'Компенсация'
                })
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.membership.classesRemaining).toBe(5); // 2 + 3
            expect(response.body.membership.totalClasses).toBe(11); // 8 + 3
        });
    });
    
    describe('GET /api/memberships/:id', () => {
        it('админ должен получить детали абонемента', async () => {
            const Membership = require('../../src/models/Membership');
            const membership = await Membership.create({
                student: studentUser._id,
                group: groupId,
                type: 'monthly',
                totalClasses: 8,
                classesRemaining: 5,
                status: 'active',
                startDate: new Date(),
                endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            });
            
            const response = await request(app)
                .get(`/api/memberships/${membership._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.membership).toBeDefined();
        });
    });
    
    describe('Дополнительные сценарии memberships', () => {
        it('продление существующего monthly на monthly', async () => {
            const Membership = require('../../src/models/Membership');
            const existing = await Membership.create({
                student: studentUser._id,
                group: groupId,
                type: 'monthly',
                totalClasses: 8,
                classesRemaining: 2,
                status: 'active',
                startDate: new Date(),
                endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            });
            
            // Обновляем активный абонемент
            const Student = require('../../src/models/Student');
            await Student.findByIdAndUpdate(studentUser._id, {
                activeMembership: existing._id
            });
            
            // Создаем новый - должен продлить существующий
            const response = await request(app)
                .post('/api/memberships')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    studentId: studentUser._id,
                    groupId,
                    type: 'monthly'
                })
                .expect(201);
            
            expect(response.body.membership.classesRemaining).toBe(10); // 2 + 8
        });
        
        it('добавление 1 занятия', async () => {
            const Membership = require('../../src/models/Membership');
            const membership = await Membership.create({
                student: studentUser._id,
                group: groupId,
                type: 'trial',
                totalClasses: 1,
                classesRemaining: 1,
                status: 'active',
                startDate: new Date(),
                endDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000)
            });
            
            const response = await request(app)
                .patch(`/api/memberships/${membership._id}/add-classes`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ amount: 1, reason: 'Тест' })
                .expect(200);
            
            expect(response.body.membership.classesRemaining).toBe(2);
        });
        
        it('студент получает только свои абонементы', async () => {
            const Membership = require('../../src/models/Membership');
            await Membership.create({
                student: studentUser._id,
                group: groupId,
                type: 'monthly',
                totalClasses: 8,
                classesRemaining: 5,
                status: 'active',
                startDate: new Date(),
                endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            });
            
            const response = await request(app)
                .get(`/api/memberships/student/${studentUser._id}`)
                .set('Authorization', `Bearer ${studentToken}`)
                .expect(200);
            
            expect(response.body.memberships.length).toBeGreaterThan(0);
        });
    });
});


