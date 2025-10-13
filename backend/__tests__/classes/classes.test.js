const request = require('supertest');
const express = require('express');
const classesRoutes = require('../../src/routes/classes');
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
app.use('/api/classes', classesRoutes);

require('../setup');

describe('Classes API', () => {
    let adminToken;
    let teacherToken;
    let teacherUser;
    let groupId;
    
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
        teacherUser = teacher.user;
        teacherToken = generateAuthToken(teacher.user);
        
        // Создаем тестовую группу
        const Group = require('../../src/models/Group');
        const group = await Group.create({
            name: 'Test Group',
            direction: 'K-pop',
            instructor: 'Teacher Name',
            teacher: teacherUser._id
        });
        groupId = group._id;
    });
    
    describe('POST /api/classes', () => {
        it('преподаватель должен создать занятие', async () => {
            const classData = {
                groupId: groupId,
                date: '2025-10-20',
                startTime: '18:00',
                endTime: '19:30',
                notes: 'Тестовое занятие'
            };
            
            const response = await request(app)
                .post('/api/classes')
                .set('Authorization', `Bearer ${teacherToken}`)
                .send(classData)
                .expect(201);
            
            expect(response.body.success).toBe(true);
            expect(response.body.class).toBeDefined();
            expect(response.body.class.title).toContain('K-pop');
        });
        
        it('админ должен создать занятие со специальным преподавателем', async () => {
            const anotherTeacher = await createTestUser('teacher', {
                name: 'Another Teacher',
                phone: '+7 (700) 300-00-00'
            });
            
            const classData = {
                groupId: groupId,
                teacherId: anotherTeacher.user._id,
                date: '2025-10-20',
                startTime: '18:00',
                endTime: '19:30'
            };
            
            const response = await request(app)
                .post('/api/classes')
                .set('Authorization', `Bearer ${adminToken}`)
                .send(classData)
                .expect(201);
            
            expect(response.body.success).toBe(true);
            expect(response.body.class.teacher).toBe(anotherTeacher.user._id.toString());
        });
        
        it('не должен создать занятие без обязательных полей', async () => {
            const classData = {
                groupId: groupId
                // Отсутствуют date, startTime, endTime
            };
            
            const response = await request(app)
                .post('/api/classes')
                .set('Authorization', `Bearer ${teacherToken}`)
                .send(classData)
                .expect(400);
            
            expect(response.body.success).toBe(false);
        });
    });
    
    describe('GET /api/classes', () => {
        it('должен получить список занятий', async () => {
            const Class = require('../../src/models/Class');
            await Class.create({
                group: groupId,
                teacher: teacherUser._id,
                title: 'K-pop (Teacher)',
                date: new Date('2025-10-20'),
                startTime: '18:00',
                endTime: '19:30'
            });
            
            const response = await request(app)
                .get('/api/classes?start=2025-10-01&end=2025-10-31')
                .set('Authorization', `Bearer ${teacherToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.classes).toBeDefined();
            expect(response.body.classes.length).toBeGreaterThan(0);
        });
        
        it('преподаватель должен видеть только свои занятия', async () => {
            const Class = require('../../src/models/Class');
            const anotherTeacher = await createTestUser('teacher', {
                name: 'Another Teacher',
                phone: '+7 (700) 400-00-00'
            });
            
            // Создаем занятие для текущего преподавателя
            await Class.create({
                group: groupId,
                teacher: teacherUser._id,
                title: 'My Class',
                date: new Date('2025-10-20'),
                startTime: '18:00',
                endTime: '19:30'
            });
            
            // Создаем занятие для другого преподавателя
            await Class.create({
                group: groupId,
                teacher: anotherTeacher.user._id,
                title: 'Not My Class',
                date: new Date('2025-10-21'),
                startTime: '18:00',
                endTime: '19:30'
            });
            
            const response = await request(app)
                .get(`/api/classes?start=2025-10-01&end=2025-10-31&teacherId=${teacherUser._id}`)
                .set('Authorization', `Bearer ${teacherToken}`)
                .expect(200);
            
            expect(response.body.classes).toHaveLength(1);
            expect(response.body.classes[0].teacher._id).toBe(teacherUser._id.toString());
        });
    });
    
    describe('POST /api/classes/:id/attendance', () => {
        it('должен отметить посещаемость студента', async () => {
            const Class = require('../../src/models/Class');
            const { user: student } = await createTestUser('student', {
                name: 'Student',
                phone: '+7 (700) 500-00-00'
            });
            
            const classObj = await Class.create({
                group: groupId,
                teacher: teacherUser._id,
                title: 'K-pop (Teacher)',
                date: new Date('2025-10-20'),
                startTime: '18:00',
                endTime: '19:30'
            });
            
            const response = await request(app)
                .post(`/api/classes/${classObj._id}/attendance`)
                .set('Authorization', `Bearer ${teacherToken}`)
                .send({
                    studentId: student._id,
                    attended: true
                })
                .expect(200);
            
            expect(response.body.success).toBe(true);
            
            // Проверяем что посещаемость сохранилась
            const updatedClass = await Class.findById(classObj._id);
            expect(updatedClass.attendees).toHaveLength(1);
            expect(updatedClass.attendees[0].student.toString()).toBe(student._id.toString());
            expect(updatedClass.attendees[0].attended).toBe(true);
        });
    });
    
    describe('DELETE /api/classes/:id', () => {
        it('админ должен удалить занятие', async () => {
            const Class = require('../../src/models/Class');
            const classObj = await Class.create({
                group: groupId,
                teacher: teacherUser._id,
                title: 'To Delete',
                date: new Date('2025-10-20'),
                startTime: '18:00',
                endTime: '19:30'
            });
            
            const response = await request(app)
                .delete(`/api/classes/${classObj._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            
            const deleted = await Class.findById(classObj._id);
            expect(deleted).toBeNull();
        });
    });
    
    describe('PATCH /api/classes/:id', () => {
        it('преподаватель должен обновить занятие', async () => {
            const Class = require('../../src/models/Class');
            const classObj = await Class.create({
                group: groupId,
                teacher: teacherUser._id,
                title: 'Old Title',
                date: new Date('2025-10-20'),
                startTime: '18:00',
                endTime: '19:30'
            });
            
            const response = await request(app)
                .patch(`/api/classes/${classObj._id}`)
                .set('Authorization', `Bearer ${teacherToken}`)
                .send({ notes: 'Updated notes' })
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.class.notes).toBe('Updated notes');
        });
    });
    
    describe('GET /api/classes/pending-attendance/count', () => {
        it('должен получить количество занятий с незаполненной посещаемостью', async () => {
            const Class = require('../../src/models/Class');
            const pastDate = new Date();
            pastDate.setDate(pastDate.getDate() - 2);
            
            await Class.create({
                group: groupId,
                teacher: teacherUser._id,
                title: 'Past Class',
                date: pastDate,
                startTime: '18:00',
                endTime: '19:30'
            });
            
            const response = await request(app)
                .get('/api/classes/pending-attendance/count')
                .set('Authorization', `Bearer ${teacherToken}`)
                .expect(200);
            
            expect(response.body.count).toBeDefined();
            expect(typeof response.body.count).toBe('number');
        });
    });
    
    describe('Дополнительные сценарии classes', () => {
        it('создание с заметками', async () => {
            const response = await request(app)
                .post('/api/classes')
                .set('Authorization', `Bearer ${teacherToken}`)
                .send({
                    groupId,
                    date: '2025-10-28',
                    startTime: '18:00',
                    endTime: '19:30',
                    notes: 'Важные заметки'
                })
                .expect(201);
            
            expect(response.body.class.notes).toBe('Важные заметки');
        });
        
        it('обновление времени занятия', async () => {
            const Class = require('../../src/models/Class');
            const classObj = await Class.create({
                group: groupId,
                teacher: teacherUser._id,
                title: 'Test',
                date: new Date('2025-10-29'),
                startTime: '18:00',
                endTime: '19:30'
            });
            
            const response = await request(app)
                .patch(`/api/classes/${classObj._id}`)
                .set('Authorization', `Bearer ${teacherToken}`)
                .send({ startTime: '19:00', endTime: '20:30' })
                .expect(200);
            
            expect(response.body.success).toBe(true);
        });
        
        it('попытка удалить занятие с посещаемостью', async () => {
            const Class = require('../../src/models/Class');
            const classObj = await Class.create({
                group: groupId,
                teacher: teacherUser._id,
                title: 'With Attendance',
                date: new Date('2025-10-30'),
                startTime: '18:00',
                endTime: '19:30',
                attendees: [{
                    student: teacherUser._id,
                    attended: true
                }]
            });
            
            const response = await request(app)
                .delete(`/api/classes/${classObj._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
        });
    });
});


