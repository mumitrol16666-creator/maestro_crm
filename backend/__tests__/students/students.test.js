const request = require('supertest');
const express = require('express');
const studentsRoutes = require('../../src/routes/students');
const { createTestUser, generateAuthToken } = require('../setup');

// Регистрируем модели для populate
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
app.use('/api/students', studentsRoutes);

require('../setup');

describe('Students API', () => {
    let adminToken;
    let studentToken;
    let adminUser;
    let studentUser;
    
    beforeEach(async () => {
        const admin = await createTestUser('admin', {
            name: 'Admin',
            phone: '+7 (700) 100-00-00'
        });
        adminUser = admin.user;
        adminToken = generateAuthToken(admin.user);
        
        const student = await createTestUser('student', {
            name: 'Test Student',
            phone: '+7 (700) 200-00-00'
        });
        studentUser = student.user;
        studentToken = generateAuthToken(student.user);
    });
    
    describe('GET /api/students', () => {
        it('должен получить список всех студентов для админа', async () => {
            // Создаем дополнительных студентов
            await createTestUser('student', { name: 'Student 2', phone: '+7 (700) 201-00-00' });
            await createTestUser('student', { name: 'Student 3', phone: '+7 (700) 202-00-00' });
            
            const response = await request(app)
                .get('/api/students')
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.students).toBeDefined();
            // Должно быть минимум 3 студента
            const students = response.body.students.filter(s => s.role === 'student');
            expect(students.length).toBeGreaterThanOrEqual(3);
        });
        
        it('должен фильтровать по роли', async () => {
            await createTestUser('teacher', { name: 'Teacher', phone: '+7 (700) 300-00-00' });
            
            const response = await request(app)
                .get('/api/students?role=teacher')
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            const teachers = response.body.students;
            expect(teachers.every(s => s.role === 'teacher')).toBe(true);
        });
        
        it('должен искать по имени или телефону', async () => {
            await createTestUser('student', { name: 'Иван Петров', phone: '+7 (700) 400-00-00' });
            
            const response = await request(app)
                .get('/api/students?search=Иван')
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.students.some(s => s.name.includes('Иван'))).toBe(true);
        });
    });
    
    describe('GET /api/students/:id', () => {
        it('должен получить данные конкретного студента', async () => {
            const response = await request(app)
                .get(`/api/students/${studentUser._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.student._id).toBe(studentUser._id.toString());
            expect(response.body.student.name).toBe(studentUser.name);
        });
        
        it('студент должен получить свои собственные данные', async () => {
            const response = await request(app)
                .get(`/api/students/${studentUser._id}`)
                .set('Authorization', `Bearer ${studentToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.student._id).toBe(studentUser._id.toString());
        });
        
        it('должен вернуть 404 для несуществующего студента', async () => {
            const fakeId = '507f1f77bcf86cd799439011';
            
            const response = await request(app)
                .get(`/api/students/${fakeId}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(404);
            
            expect(response.body.success).toBe(false);
        });
    });
    
    describe('GET /api/students/:id/stats', () => {
        it('должен получить статистику студента', async () => {
            const response = await request(app)
                .get(`/api/students/${studentUser._id}/stats`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.stats).toBeDefined();
            expect(response.body.stats).toHaveProperty('attendanceRate');
            expect(response.body.stats).toHaveProperty('totalClasses');
        });
    });
    
    describe('DELETE /api/students/:id', () => {
        it('админ должен удалить студента', async () => {
            const { user: studentToDelete } = await createTestUser('student', {
                name: 'To Delete',
                phone: '+7 (700) 999-99-99'
            });
            
            const response = await request(app)
                .delete(`/api/students/${studentToDelete._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            
            // Проверяем что студент удален
            const Student = require('../../src/models/Student');
            const deleted = await Student.findById(studentToDelete._id);
            expect(deleted).toBeNull();
        });
    });
    
    describe('PATCH /api/students/:id', () => {
        it('админ должен обновить данные студента', async () => {
            const updates = {
                name: 'Обновленное Имя',
                email: 'newemail@test.com'
            };
            
            const response = await request(app)
                .patch(`/api/students/${studentUser._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send(updates)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.student.name).toBe('Обновленное Имя');
        });
        
        it('студент должен обновить свои данные', async () => {
            const response = await request(app)
                .patch(`/api/students/${studentUser._id}`)
                .set('Authorization', `Bearer ${studentToken}`)
                .send({ email: 'student@test.com' })
                .expect(200);
            
            expect(response.body.success).toBe(true);
        });
    });
    
    describe('POST /api/students/stats/batch-light', () => {
        it('админ должен получить легкую статистику для нескольких студентов', async () => {
            const { user: student2 } = await createTestUser('student', {
                name: 'Student 2',
                phone: '+7 (700) 777-00-00'
            });
            
            const response = await request(app)
                .post('/api/students/stats/batch-light')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ studentIds: [studentUser._id, student2._id] })
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.stats).toBeDefined();
        });
    });
    
    

    describe('GET /api/students/teachers/public', () => {
        it('должен получить список преподавателей (публичный доступ)', async () => {
            await createTestUser('teacher', {
                name: 'Public Teacher',
                phone: '+7 (700) 888-00-00'
            });
            
            const response = await request(app)
                .get('/api/students/teachers/public')
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.teachers).toBeDefined();
        });
    });
    
    describe('Дополнительные сценарии students', () => {
        it('поиск по части имени', async () => {
            const response = await request(app)
                .get('/api/students?search=Test')
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
        });
        
        it('поиск по части телефона', async () => {
            const response = await request(app)
                .get('/api/students?search=700')
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
        });
        
        it('обновление с пустым email', async () => {
            const response = await request(app)
                .patch(`/api/students/${studentUser._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ email: '' })
                .expect(200);
            
            expect(response.body.success).toBe(true);
        });
        
        it('студент не может обновить чужой профиль', async () => {
            const otherStudent = await createTestUser('student', {
                name: 'Other',
                phone: '+7 (700) 999-00-00'
            });
            
            const response = await request(app)
                .patch(`/api/students/${otherStudent.user._id}`)
                .set('Authorization', `Bearer ${studentToken}`)
                .send({ name: 'Hacked' })
                .expect(403);
            
            expect(response.body.success).toBe(false);
        });
    });
});

