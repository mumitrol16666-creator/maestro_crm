const request = require('supertest');
const express = require('express');
const authRoutes = require('../../src/routes/auth');
const { createTestUser } = require('../setup');

// Настройка приложения для тестов
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

// Подключаем setup для БД
require('../setup');

describe('Auth API', () => {
    describe('POST /api/auth/register', () => {
        it('должен успешно зарегистрировать нового пользователя', async () => {
            const userData = {
                name: 'Новый Ученик',
                lastName: 'Тестов',
                phone: '+7 (700) 111-22-33',
                password: 'password123',
                gender: 'male'
            };
            
            const response = await request(app)
                .post('/api/auth/register')
                .send(userData)
                .expect(201);
            
            expect(response.body.success).toBe(true);
            expect(response.body.token).toBeDefined();
            expect(response.body.user).toBeDefined();
            expect(response.body.user.name).toBe(userData.name);
            expect(response.body.user.phone).toBe(userData.phone);
            expect(response.body.user.role).toBe('student');
        });
        
        it('не должен регистрировать пользователя без имени', async () => {
            const userData = {
                phone: '+7 (700) 111-22-33',
                password: 'password123',
                gender: 'male'
            };
            
            const response = await request(app)
                .post('/api/auth/register')
                .send(userData)
                .expect(400);
            
            expect(response.body.success).toBe(false);
        });
        
        it('не должен регистрировать пользователя с существующим телефоном', async () => {
            const phone = '+7 (700) 111-22-33';
            await createTestUser('student', { phone });
            
            const userData = {
                name: 'Другой Ученик',
                phone: phone,
                password: 'password123',
                gender: 'male'
            };
            
            const response = await request(app)
                .post('/api/auth/register')
                .send(userData)
                .expect(400);
            
            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('телефон');
        });
    });
    
    describe('POST /api/auth/login', () => {
        it('должен успешно авторизовать пользователя с правильными данными', async () => {
            const { user, password } = await createTestUser('student', {
                phone: '+7 (700) 222-33-44'
            });
            
            const response = await request(app)
                .post('/api/auth/login')
                .send({
                    phone: user.phone,
                    password: password
                })
                .expect(200);
            
            expect(response.body.success).toBe(true);
            expect(response.body.token).toBeDefined();
            expect(response.body.user._id).toBe(user._id.toString());
        });
        
        it('не должен авторизовать с неверным паролем', async () => {
            const { user } = await createTestUser('student', {
                phone: '+7 (700) 333-44-55'
            });
            
            const response = await request(app)
                .post('/api/auth/login')
                .send({
                    phone: user.phone,
                    password: 'wrongpassword'
                })
                .expect(401);
            
            expect(response.body.success).toBe(false);
        });
        
        it('не должен авторизовать несуществующего пользователя', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({
                    phone: '+7 (700) 999-99-99',
                    password: 'password123'
                })
                .expect(401);
            
            expect(response.body.success).toBe(false);
        });
    });
});

