const request = require('supertest');
const express = require('express');
const groupsRoutes = require('../../src/routes/groups');
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
            return res.status(401).json({ success: false, error: 'Недействительный токен' });
        }
    }
    next();
});
app.use('/api/groups', groupsRoutes);

require('../setup');

describe('Groups API', () => {
    let adminToken;
    let teacherToken;
    let studentToken;
    let studentUser;
    
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
        
        const student = await createTestUser('student', {
            name: 'Student',
            phone: '+7 (700) 300-00-00'
        });
        studentUser = student.user;
        studentToken = generateAuthToken(student.user);
    });
    
    describe('POST /api/groups', () => {
        it('админ должен создать группу', async () => {
            const groupData = {
                name: 'K-pop Начинающие',
                direction: 'K-pop',
                instructor: 'Преподаватель Иван',
                schedule: [
                    { dayOfWeek: 1, time: '18:00', duration: 90 },
                    { dayOfWeek: 3, time: '18:00', duration: 90 }
                ],
                isActive: true
            };
            
            const response = await request(app)
                .post('/api/groups')
                .set('Authorization', `Bearer ${adminToken}`)
                .send(groupData)
                .expect(201);
            
            expect(response.body.success).toBe(true);
            expect(response.body.group.name).toBe(groupData.name);
            expect(response.body.group.direction).toBe(groupData.direction);
            expect(response.body.group.schedule).toHaveLength(2);
        });
        
        it('не должен создать группу без обязательных полей', async () => {
            const groupData = {
                name: 'K-pop Начинающие'
                // Отсутствуют direction и instructor
            };
            
            const response = await request(app)
                .post('/api/groups')
                .set('Authorization', `Bearer ${adminToken}`)
                .send(groupData)
                .expect(400);
            
            expect(response.body.success).toBe(false);
        });
        
        it('студент не должен создать группу', async () => {
            const groupData = {
                name: 'Test Group',
                direction: 'K-pop',
                instructor: 'Teacher'
            };
            
            const response = await request(app)
                .post('/api/groups')
                .set('Authorization', `Bearer ${studentToken}`)
                .send(groupData)
                .expect(403);
        });
    });
    
    describe('GET /api/groups', () => {
        it('должен получить список всех групп (публичный доступ)', async () => {
            const Group = require('../../src/models/Group');
            await Group.create([
                { name: 'Group 1', direction: 'K-pop', instructor: 'Teacher 1' },
                { name: 'Group 2', direction: 'CHOREO', instructor: 'Teacher 2' }
            ]);
            
            const response = await request(app)
                .get('/api/groups')
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.groups).toHaveLength(2);
        });
        
        it('должен фильтровать по направлению', async () => {
            const Group = require('../../src/models/Group');
            await Group.create([
                { name: 'Group 1', direction: 'K-pop', instructor: 'Teacher 1' },
                { name: 'Group 2', direction: 'CHOREO', instructor: 'Teacher 2' },
                { name: 'Group 3', direction: 'K-pop', instructor: 'Teacher 3' }
            ]);
            
            const response = await request(app)
                .get('/api/groups?direction=K-pop')
                .expect(200);
            
            expect(response.body.groups).toHaveLength(2);
            expect(response.body.groups.every(g => g.direction === 'K-pop')).toBe(true);
        });
    });
    
    describe('PATCH /api/groups/:id', () => {
        it('админ должен обновить группу', async () => {
            const Group = require('../../src/models/Group');
            const group = await Group.create({
                name: 'Old Name',
                direction: 'K-pop',
                instructor: 'Teacher'
            });
            
            const updates = {
                name: 'New Name',
                isActive: false
            };
            
            const response = await request(app)
                .patch(`/api/groups/${group._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send(updates)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.group.name).toBe('New Name');
            expect(response.body.group.isActive).toBe(false);
        });
    });
    
    describe('DELETE /api/groups/:id', () => {
        it('админ должен удалить пустую группу', async () => {
            const Group = require('../../src/models/Group');
            const group = await Group.create({
                name: 'To Delete',
                direction: 'K-pop',
                instructor: 'Teacher',
                currentStudents: 0
            });
            
            const response = await request(app)
                .delete(`/api/groups/${group._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            
            const deleted = await Group.findById(group._id);
            expect(deleted).toBeNull();
        });
    });
    
    describe('POST /api/groups/:id/students/:studentId', () => {
        it('админ должен добавить студента в группу', async () => {
            const Group = require('../../src/models/Group');
            const group = await Group.create({
                name: 'Test Group',
                direction: 'K-pop',
                instructor: 'Teacher'
            });
            
            const response = await request(app)
                .post(`/api/groups/${group._id}/students/${studentUser._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            
            // Проверяем что студент добавлен
            const updatedGroup = await Group.findById(group._id);
            expect(updatedGroup.currentStudents).toBe(1);
        });
        
        it('не должен добавить студента дважды', async () => {
            const Group = require('../../src/models/Group');
            const group = await Group.create({
                name: 'Test Group',
                direction: 'K-pop',
                instructor: 'Teacher'
            });
            
            // Добавляем первый раз
            await request(app)
                .post(`/api/groups/${group._id}/students/${studentUser._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            // Пытаемся добавить второй раз
            const response = await request(app)
                .post(`/api/groups/${group._id}/students/${studentUser._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(400);
            
            expect(response.body.success).toBe(false);
        });
    });
    
    describe('DELETE /api/groups/:id/students/:studentId', () => {
        it('админ должен удалить студента из группы', async () => {
            const Group = require('../../src/models/Group');
            const group = await Group.create({
                name: 'Test Group',
                direction: 'K-pop',
                instructor: 'Teacher'
            });
            
            // Сначала добавляем студента
            await request(app)
                .post(`/api/groups/${group._id}/students/${studentUser._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            // Теперь удаляем
            const response = await request(app)
                .delete(`/api/groups/${group._id}/students/${studentUser._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
        });
    });
    
    describe('GET /api/groups/schedule/weekly', () => {
        it('должен получить недельное расписание (публичный доступ)', async () => {
            const Group = require('../../src/models/Group');
            await Group.create({
                name: 'Active Group',
                direction: 'K-pop',
                instructor: 'Teacher',
                schedule: [
                    { dayOfWeek: 1, time: '18:00', duration: 90 },
                    { dayOfWeek: 3, time: '19:00', duration: 90 }
                ],
                isActive: true
            });
            
            const response = await request(app)
                .get('/api/groups/schedule/weekly')
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.schedule).toBeDefined();
        });
    });
    
    describe('GET /api/groups/:id/students', () => {
        it('админ должен получить список студентов группы', async () => {
            const Group = require('../../src/models/Group');
            const group = await Group.create({
                name: 'Test Group',
                direction: 'K-pop',
                instructor: 'Teacher'
            });
            
            const response = await request(app)
                .get(`/api/groups/${group._id}/students`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.students).toBeDefined();
        });
    });
});

