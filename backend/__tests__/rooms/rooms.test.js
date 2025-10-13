const request = require('supertest');
const express = require('express');
const roomsRoutes = require('../../src/routes/rooms');
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
app.use('/api/rooms', roomsRoutes);

require('../setup');

describe('Rooms API', () => {
    let adminToken;
    let superAdminToken;
    
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
        adminToken = generateAuthToken(admin.user);
    });
    
    describe('GET /api/rooms', () => {
        it('админ должен получить список залов', async () => {
            const Room = require('../../src/models/Room');
            await Room.create([
                { name: 'Зал 1', capacity: 20, color: '#ff5733' },
                { name: 'Зал 2', capacity: 15, color: '#33ff57' }
            ]);
            
            const response = await request(app)
                .get('/api/rooms')
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.rooms).toHaveLength(2);
        });
    });
    
    describe('POST /api/rooms', () => {
        it('админ должен создать зал', async () => {
            const roomData = {
                name: 'Большой зал',
                capacity: 25,
                color: '#3498db'
            };
            
            const response = await request(app)
                .post('/api/rooms')
                .set('Authorization', `Bearer ${adminToken}`)
                .send(roomData)
                .expect(201);
            
            expect(response.body.success).toBe(true);
            expect(response.body.room.name).toBe(roomData.name);
        });
        
        it('не должен создать зал без названия', async () => {
            const response = await request(app)
                .post('/api/rooms')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ capacity: 20 })
                .expect(400);
            
            expect(response.body.success).toBe(false);
        });
    });
    
    describe('PATCH /api/rooms/:id', () => {
        it('админ должен обновить зал', async () => {
            const Room = require('../../src/models/Room');
            const room = await Room.create({
                name: 'Old Name',
                capacity: 20,
                color: '#ff0000'
            });
            
            const response = await request(app)
                .patch(`/api/rooms/${room._id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ name: 'New Name' })
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.room.name).toBe('New Name');
        });
    });
    
    describe('DELETE /api/rooms/:id', () => {
        it('super admin должен удалить зал', async () => {
            const Room = require('../../src/models/Room');
            const room = await Room.create({
                name: 'To Delete',
                capacity: 15,
                color: '#000000'
            });
            
            const response = await request(app)
                .delete(`/api/rooms/${room._id}`)
                .set('Authorization', `Bearer ${superAdminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            
            const deleted = await Room.findById(room._id);
            expect(deleted).toBeNull();
        });
    });
});

