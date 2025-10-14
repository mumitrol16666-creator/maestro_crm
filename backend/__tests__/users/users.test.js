const request = require('supertest');
const express = require('express');
const usersRoutes = require('../../src/routes/users');
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
app.use('/api/users', usersRoutes);

require('../setup');

describe('Users API', () => {
    let adminToken;
    let superAdminToken;
    let adminUser;
    
    beforeEach(async () => {
        const superAdmin = await createTestUser('super_admin', {
            name: 'Super Admin',
            phone: '+7 (700) 000-00-00'
        });
        superAdminToken = generateAuthToken(superAdmin.user);
        
        const admin = await createTestUser('admin', {
            name: 'Admin',
            phone: '+7 (700) 100-00-00'
        });
        adminUser = admin.user;
        adminToken = generateAuthToken(admin.user);
    });
    
    describe('POST /api/users/teachers', () => {
        it('админ должен создать преподавателя', async () => {
            const teacherData = {
                name: 'Иван',
                lastName: 'Иванов',
                phone: '+7 (700) 111-22-33',
                direction: 'K-pop',
                gender: 'male'
            };
            
            const response = await request(app)
                .post('/api/users/teachers')
                .set('Authorization', `Bearer ${adminToken}`)
                .send(teacherData)
                .expect(201);
            
            expect(response.body.success).toBe(true);
            expect(response.body.teacher).toBeDefined();
            expect(response.body.teacher.name).toBe(teacherData.name);
            expect(response.body.teacher.role).toBe('teacher');
            expect(response.body.generatedPassword).toBeDefined();
        });
        
        it('не должен создать преподавателя без обязательных полей', async () => {
            const response = await request(app)
                .post('/api/users/teachers')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ name: 'Test' })
                .expect(400);
            
            expect(response.body.success).toBe(false);
        });
        
        it('не должен создать преподавателя с существующим телефоном', async () => {
            const phone = '+7 (700) 222-33-44';
            await createTestUser('teacher', { phone });
            
            const response = await request(app)
                .post('/api/users/teachers')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    name: 'New Teacher',
                    phone: phone,
                    direction: 'K-pop',
                    gender: 'male'
                })
                .expect(400);
            
            expect(response.body.success).toBe(false);
        });
    });
    
    describe('POST /api/users/sales-managers', () => {
        it('админ должен создать менеджера', async () => {
            const managerData = {
                name: 'Мария',
                lastName: 'Петрова',
                phone: '+7 (700) 333-44-55',
                gender: 'female'
            };
            
            const response = await request(app)
                .post('/api/users/sales-managers')
                .set('Authorization', `Bearer ${adminToken}`)
                .send(managerData)
                .expect(201);
            
            expect(response.body.success).toBe(true);
            expect(response.body.manager).toBeDefined();
            expect(response.body.manager.role).toBe('sales_manager');
        });
    });
    
    describe('POST /api/users/:id/reset-password', () => {
        it('админ должен сбросить пароль пользователя', async () => {
            const { user: teacher } = await createTestUser('teacher', {
                name: 'Teacher',
                phone: '+7 (700) 444-55-66'
            });
            
            const response = await request(app)
                .post(`/api/users/${teacher._id}/reset-password`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.newPassword).toBeDefined();
        });
    });
    
    describe('DELETE /api/users/teachers/:id', () => {
        it('super admin должен удалить преподавателя', async () => {
            const { user: teacher } = await createTestUser('teacher', {
                name: 'To Delete',
                phone: '+7 (700) 555-66-77'
            });
            
            const response = await request(app)
                .delete(`/api/users/teachers/${teacher._id}`)
                .set('Authorization', `Bearer ${superAdminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            
            const Student = require('../../src/models/Student');
            const deleted = await Student.findById(teacher._id);
            expect(deleted).toBeNull();
        });
        
        it('обычный админ не может удалить преподавателя', async () => {
            const { user: teacher } = await createTestUser('teacher', {
                name: 'Teacher',
                phone: '+7 (700) 666-77-88'
            });
            
            const response = await request(app)
                .delete(`/api/users/teachers/${teacher._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(403);
            
            expect(response.body.success).toBe(false);
        });
    });
    
    describe('DELETE /api/users/sales-managers/:id', () => {
        it('админ должен удалить менеджера', async () => {
            const { user: manager } = await createTestUser('sales_manager', {
                name: 'Manager To Delete',
                phone: '+7 (700) 666-77-88'
            });
            
            const response = await request(app)
                .delete(`/api/users/sales-managers/${manager._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
        });
    });
});

