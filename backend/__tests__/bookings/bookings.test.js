const request = require('supertest');
const express = require('express');
const bookingsRoutes = require('../../src/routes/bookings');
const { createTestUser, generateAuthToken } = require('../setup');

const app = express();
app.use(express.json());
app.use(async (req, res, next) => {
    // Middleware для тестов - добавляем пользователя в req
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
app.use('/api/bookings', bookingsRoutes);

require('../setup');

describe('Bookings API', () => {
    let adminToken;
    let adminUser;
    
    beforeEach(async () => {
        const { user } = await createTestUser('admin', {
            name: 'Admin User',
            phone: '+7 (700) 100-00-00'
        });
        adminUser = user;
        adminToken = generateAuthToken(user);
    });
    
    describe('POST /api/bookings/create-admin', () => {
        it('должен создать заявку от админа', async () => {
            const bookingData = {
                name: 'Тестовый Клиент',
                phone: '+7 (700) 123-45-67',
                direction: 'K-pop',
                source: 'WhatsApp'
            };
            
            const response = await request(app)
                .post('/api/bookings/create-admin')
                .set('Authorization', `Bearer ${adminToken}`)
                .send(bookingData)
                .expect(201);
            
            expect(response.body.success).toBe(true);
            expect(response.body.booking).toBeDefined();
            expect(response.body.booking.name).toBe(bookingData.name);
            expect(response.body.booking.phone).toBe(bookingData.phone);
            expect(response.body.booking.status).toBe('new');
        });
        
        it('не должен создать заявку без авторизации', async () => {
            const bookingData = {
                name: 'Тестовый Клиент',
                phone: '+7 (700) 123-45-67',
                direction: 'K-pop'
            };
            
            const response = await request(app)
                .post('/api/bookings/create-admin')
                .send(bookingData)
                .expect(401);
            
            expect(response.body.success).toBe(false);
        });
    });
    
    describe('GET /api/bookings', () => {
        it('должен получить список заявок', async () => {
            // Создаем несколько заявок
            const Booking = require('../../src/models/Booking');
            await Booking.create([
                { name: 'Клиент 1', phone: '+7 (700) 111-11-11', direction: 'K-pop', status: 'new' },
                { name: 'Клиент 2', phone: '+7 (700) 222-22-22', direction: 'CHOREO', status: 'processed' }
            ]);
            
            const response = await request(app)
                .get('/api/bookings')
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.bookings).toHaveLength(2);
        });
        
        it('должен фильтровать заявки по статусу', async () => {
            const Booking = require('../../src/models/Booking');
            await Booking.create([
                { name: 'Клиент 1', phone: '+7 (700) 111-11-11', direction: 'K-pop', status: 'new' },
                { name: 'Клиент 2', phone: '+7 (700) 222-22-22', direction: 'CHOREO', status: 'processed' },
                { name: 'Клиент 3', phone: '+7 (700) 333-33-33', direction: 'K-pop', status: 'new' }
            ]);
            
            const response = await request(app)
                .get('/api/bookings?status=new')
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.bookings).toHaveLength(2);
            expect(response.body.bookings.every(b => b.status === 'new')).toBe(true);
        });
    });
    
    describe('PATCH /api/bookings/:id/status', () => {
        it('должен изменить статус заявки', async () => {
            const Booking = require('../../src/models/Booking');
            const booking = await Booking.create({
                name: 'Клиент',
                phone: '+7 (700) 111-11-11',
                direction: 'K-pop',
                status: 'new'
            });
            
            const response = await request(app)
                .patch(`/api/bookings/${booking._id}/status`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ status: 'processed' })
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.booking.status).toBe('processed');
        });
    });
    
    describe('DELETE /api/bookings/:id', () => {
        it('должен удалить заявку', async () => {
            const Booking = require('../../src/models/Booking');
            const booking = await Booking.create({
                name: 'Клиент',
                phone: '+7 (700) 111-11-11',
                direction: 'K-pop',
                status: 'new'
            });
            
            const response = await request(app)
                .delete(`/api/bookings/${booking._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            
            // Проверяем что заявка удалена
            const deletedBooking = await Booking.findById(booking._id);
            expect(deletedBooking).toBeNull();
        });
    });
    
    describe('GET /api/bookings/:id', () => {
        it('должен получить детали заявки', async () => {
            const Booking = require('../../src/models/Booking');
            const booking = await Booking.create({
                name: 'Клиент',
                phone: '+7 (700) 111-11-11',
                direction: 'K-pop',
                status: 'new'
            });
            
            const response = await request(app)
                .get(`/api/bookings/${booking._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.booking.name).toBe('Клиент');
        });
    });
    
    describe('POST /api/bookings/:id/convert', () => {
        it('админ должен конвертировать заявку в ученика', async () => {
            const Group = require('../../src/models/Group');
            const group = await Group.create({
                name: 'Test Group',
                direction: 'K-pop',
                instructor: 'Teacher'
            });
            
            const Booking = require('../../src/models/Booking');
            const booking = await Booking.create({
                name: 'Новый Клиент',
                phone: '+7 (700) 555-55-55',
                direction: 'K-pop',
                status: 'new'
            });
            
            const response = await request(app)
                .post(`/api/bookings/${booking._id}/convert`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    gender: 'male',
                    groupId: group._id,
                    membershipType: 'trial'
                })
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.student).toBeDefined();
            expect(response.body.membership).toBeDefined();
        });
        
        it('не должен конвертировать без группы', async () => {
            const Booking = require('../../src/models/Booking');
            const booking = await Booking.create({
                name: 'Клиент',
                phone: '+7 (700) 666-66-66',
                direction: 'K-pop',
                status: 'new'
            });
            
            const response = await request(app)
                .post(`/api/bookings/${booking._id}/convert`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    gender: 'male',
                    membershipType: 'trial'
                })
                .expect(400);
            
            expect(response.body.success).toBe(false);
        });
        
        it('не должен конвертировать дважды', async () => {
            const Student = require('../../src/models/Student');
            const Group = require('../../src/models/Group');
            
            const group = await Group.create({
                name: 'Test Group 2',
                direction: 'K-pop',
                instructor: 'Teacher'
            });
            
            const student = await Student.create({
                name: 'Existing Student',
                phone: '+7 (700) 777-77-77',
                password: 'password123',
                role: 'student',
                gender: 'male'
            });
            
            const Booking = require('../../src/models/Booking');
            const booking = await Booking.create({
                name: 'Existing Student',
                phone: '+7 (700) 777-77-77',
                direction: 'K-pop',
                status: 'new',
                convertedToStudent: student._id
            });
            
            const response = await request(app)
                .post(`/api/bookings/${booking._id}/convert`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    gender: 'male',
                    groupId: group._id,
                    membershipType: 'trial'
                })
                .expect(400);
            
            expect(response.body.success).toBe(false);
        });
    });
    
    describe('POST /api/bookings (публичный)', () => {
        it('должен создать заявку с сайта', async () => {
            const response = await request(app)
                .post('/api/bookings')
                .send({
                    name: 'Клиент с Сайта',
                    phone: '+7 (700) 888-88-88',
                    direction: 'K-pop'
                })
                .expect(201);
            
            expect(response.body.success).toBe(true);
            expect(response.body.booking.source).toBe('Сайт');
        });
        
        it('валидация при создании без имени', async () => {
            const response = await request(app)
                .post('/api/bookings')
                .send({
                    phone: '+7 (700) 999-99-99',
                    direction: 'K-pop'
                })
                .expect(400);
            
            expect(response.body.errors).toBeDefined();
        });
    });
    
    describe('Дополнительные сценарии bookings', () => {
        it('изменение статуса на processed', async () => {
            const Booking = require('../../src/models/Booking');
            const booking = await Booking.create({
                name: 'Client',
                phone: '+7 (700) 111-22-33',
                direction: 'K-pop',
                status: 'new',
                source: 'Сайт'
            });
            
            const response = await request(app)
                .patch(`/api/bookings/${booking._id}/status`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ status: 'processed' })
                .expect(200);
            
            expect(response.body.booking.status).toBe('processed');
        });
        
        it('отклонение заявки', async () => {
            const Booking = require('../../src/models/Booking');
            const booking = await Booking.create({
                name: 'To Reject',
                phone: '+7 (700) 222-33-44',
                direction: 'K-pop',
                status: 'new'
            });
            
            const response = await request(app)
                .patch(`/api/bookings/${booking._id}/status`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ status: 'rejected' })
                .expect(200);
            
            expect(response.body.booking.status).toBe('rejected');
        });
    });
});

