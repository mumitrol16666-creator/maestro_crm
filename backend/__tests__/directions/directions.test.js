const request = require('supertest');
const express = require('express');
const directionsRoutes = require('../../src/routes/directions');
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
app.use('/api/directions', directionsRoutes);

require('../setup');

describe('Directions API', () => {
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
    
    describe('GET /api/directions/public', () => {
        it('должен получить список направлений (публичный доступ)', async () => {
            const Direction = require('../../src/models/Direction');
            await Direction.create([
                { name: 'K-pop', description: 'Korean Pop', image: 'kpop.jpg', order: 1, level: 'beginner', minAge: 12 },
                { name: 'CHOREO', description: 'Choreography', image: 'choreo.jpg', order: 2, level: 'intermediate', minAge: 14 }
            ]);
            
            const response = await request(app)
                .get('/api/directions/public')
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.directions).toHaveLength(2);
        });
    });
    
    describe('GET /api/directions', () => {
        it('админ должен получить все направления', async () => {
            const Direction = require('../../src/models/Direction');
            await Direction.create([
                { name: 'K-pop', description: 'Test', image: 'test.jpg', order: 1, level: 'beginner', minAge: 12 },
                { name: 'Hip-Hop', description: 'Test2', image: 'test2.jpg', order: 2, level: 'advanced', minAge: 16, isActive: false }
            ]);
            
            const response = await request(app)
                .get('/api/directions')
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.directions).toHaveLength(2);
        });
    });
    
    describe('POST /api/directions', () => {
        it('super admin должен создать направление', async () => {
            const directionData = {
                name: 'Salsa',
                description: 'Latin dance',
                image: 'salsa.jpg',
                order: 3,
                level: 'beginner',
                minAge: 18
            };
            
            const response = await request(app)
                .post('/api/directions')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send(directionData)
                .expect(201);
            
            expect(response.body.success).toBe(true);
            expect(response.body.direction.name).toBe(directionData.name);
        });
    });
    
    describe('PATCH /api/directions/:id', () => {
        it('super admin должен обновить направление', async () => {
            const Direction = require('../../src/models/Direction');
            const direction = await Direction.create({
                name: 'Old',
                description: 'Old desc',
                image: 'old.jpg',
                order: 1,
                level: 'beginner',
                minAge: 12
            });
            
            const response = await request(app)
                .patch(`/api/directions/${direction._id}`)
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({ name: 'Updated', isActive: false })
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.direction.name).toBe('Updated');
        });
    });
    
    describe('DELETE /api/directions/:id', () => {
        it('super admin должен удалить направление', async () => {
            const Direction = require('../../src/models/Direction');
            const direction = await Direction.create({
                name: 'To Delete',
                description: 'Test',
                image: 'test.jpg',
                order: 10,
                level: 'beginner',
                minAge: 10
            });
            
            const response = await request(app)
                .delete(`/api/directions/${direction._id}`)
                .set('Authorization', `Bearer ${superAdminToken}`)
                .expect(200);
            
            expect(response.body.success).toBe(true);
        });
    });
});

