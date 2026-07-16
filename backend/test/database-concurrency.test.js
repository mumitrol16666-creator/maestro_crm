const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_DATABASE_URL) {
    test('PostgreSQL P0 concurrency suite', { skip: 'TEST_DATABASE_URL не задан' }, () => {});
} else {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'maestro-p0-test-secret';
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

    const jwt = require('jsonwebtoken');
    const app = require('../src/server');
    const { prisma } = require('../src/config/db');
    const {
        validatePaymentCreateResponse,
        validateClassApproveResponse,
        validateIntegrationClassResponse,
        validateIntegrationLogListResponse,
        validateReconciliationResponse,
    } = require('../src/services/apiContracts');

    let httpServer;
    let baseUrl;
    let admin;
    let teacher;
    let student;
    const TEST_PAYMENT_METHOD = 'cash';

    function tokenFor(user) {
        return jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '10m' });
    }

    async function request(path, {
        method = 'GET',
        body,
        token = tokenFor(admin),
        key = `${Date.now()}-${Math.random()}`,
    } = {}) {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-Idempotency-Key': key,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const payload = await response.json();
        return { status: response.status, payload };
    }

    async function createUser(role, suffix, extra = {}) {
        return prisma.student.create({
            data: {
                name: role,
                lastName: suffix,
                phone: `+7700${suffix.padStart(7, '0')}`,
                phoneDigits: `7700${suffix.padStart(7, '0')}`,
                password: 'test-password',
                role,
                learningDirections: [],
                teacherDirections: [],
                ...extra,
            },
        });
    }

    async function resetData() {
        const tables = await prisma.$queryRaw`
            SELECT tablename FROM pg_tables WHERE schemaname = 'public'
        `;
        for (const { tablename } of tables) {
            if (tablename === '_prisma_migrations') continue;
            await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE`);
        }
        admin = await createUser('super_admin', '1');
        teacher = await createUser('teacher', '2', {
            salaryIndividual: 5000,
            salaryGroup: 3000,
            salaryOther: 1500,
            appUserId: 'app-teacher-2',
            externalLinkStatus: 'linked',
        });
        student = await createUser('student', '3');
    }

    test.before(async () => {
        await prisma.$connect();
        httpServer = app.httpServer;
        await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
        const address = httpServer.address();
        baseUrl = `http://127.0.0.1:${address.port}/api`;
    });

    test.beforeEach(resetData);

    test.after(async () => {
        await new Promise((resolve) => httpServer.close(resolve));
        await prisma.$disconnect();
    });

    test('двойное создание платежа с одним ключом пополняет баланс один раз', async () => {
        const token = tokenFor(admin);
        const body = { studentId: student.id, amount: 4000, type: 'membership_full', paymentMethod: TEST_PAYMENT_METHOD };
        const key = 'same-payment-click';
        const results = await Promise.all([
            request('/payments', { method: 'POST', body, token, key }),
            request('/payments', { method: 'POST', body, token, key }),
        ]);

        assert.equal(results.filter((item) => item.status === 201).length, 1);
        assert.equal(results.filter((item) => item.status === 409).length, 1);
        validatePaymentCreateResponse(results.find((item) => item.status === 201).payload);
        assert.equal(await prisma.payment.count({ where: { studentId: student.id } }), 1);
        const freshStudent = await prisma.student.findUnique({ where: { id: student.id } });
        assert.equal(freshStudent.accountBalance, 4000);
    });

    test('роль преподавателя не может создавать, менять, удалять платежи или делать возврат', async () => {
        const teacherToken = tokenFor(teacher);
        const payment = await prisma.payment.create({
            data: {
                studentId: student.id,
                managerId: admin.id,
                amount: 4000,
                type: 'membership_full',
                status: 'completed',
                paymentMethod: TEST_PAYMENT_METHOD,
            },
        });
        await prisma.student.update({
            where: { id: student.id },
            data: { accountBalance: 4000 },
        });

        const attempts = await Promise.all([
            request('/payments', {
                method: 'POST',
                body: { studentId: student.id, amount: 4000, type: 'membership_full', paymentMethod: TEST_PAYMENT_METHOD },
                token: teacherToken,
                key: 'teacher-create-payment',
            }),
            request(`/payments/${payment.id}`, {
                method: 'PATCH',
                body: { amount: 5000, paymentMethod: TEST_PAYMENT_METHOD },
                token: teacherToken,
                key: 'teacher-edit-payment',
            }),
            request('/payments/refund', {
                method: 'POST',
                body: { studentId: student.id, amount: 1000, paymentMethod: TEST_PAYMENT_METHOD, originalPaymentId: payment.id },
                token: teacherToken,
                key: 'teacher-refund-payment',
            }),
            request(`/payments/${payment.id}`, {
                method: 'DELETE',
                token: teacherToken,
                key: 'teacher-delete-payment',
            }),
        ]);

        assert.deepEqual(attempts.map((item) => item.status), [403, 403, 403, 403]);
        const [freshPayment, freshStudent] = await Promise.all([
            prisma.payment.findUnique({ where: { id: payment.id } }),
            prisma.student.findUnique({ where: { id: student.id } }),
        ]);
        assert.equal(freshPayment.amount, 4000);
        assert.equal(freshStudent.accountBalance, 4000);
        assert.equal(await prisma.payment.count({ where: { studentId: student.id } }), 1);
    });

    test('два параллельных исправления платежа не складывают разницы', async () => {
        const payment = await prisma.payment.create({
            data: {
                studentId: student.id,
                managerId: admin.id,
                amount: 4000,
                type: 'membership_full',
                status: 'completed',
                paymentMethod: TEST_PAYMENT_METHOD,
            },
        });
        await prisma.student.update({
            where: { id: student.id },
            data: { accountBalance: 4000 },
        });

        const results = await Promise.all([
            request(`/payments/${payment.id}`, {
                method: 'PATCH',
                body: { amount: 5000, paymentMethod: TEST_PAYMENT_METHOD },
                key: 'edit-payment-a',
            }),
            request(`/payments/${payment.id}`, {
                method: 'PATCH',
                body: { amount: 6000, paymentMethod: TEST_PAYMENT_METHOD },
                key: 'edit-payment-b',
            }),
        ]);
        assert.equal(results.filter((item) => item.status === 200).length, 2);
        const [freshPayment, freshStudent] = await Promise.all([
            prisma.payment.findUnique({ where: { id: payment.id } }),
            prisma.student.findUnique({ where: { id: student.id } }),
        ]);
        assert.equal(freshStudent.accountBalance, freshPayment.amount);
        assert.ok([5000, 6000].includes(freshPayment.amount));
    });

    test('два полных возврата одного платежа создают только один возврат и один расход', async () => {
        const payment = await prisma.payment.create({
            data: {
                studentId: student.id,
                managerId: admin.id,
                amount: 4000,
                type: 'membership_full',
                status: 'completed',
                paymentMethod: TEST_PAYMENT_METHOD,
            },
        });
        await prisma.student.update({
            where: { id: student.id },
            data: { accountBalance: 4000 },
        });
        const body = {
            studentId: student.id,
            amount: 4000,
            paymentMethod: TEST_PAYMENT_METHOD,
            reason: 'Тест параллельного возврата',
            originalPaymentId: payment.id,
        };
        const results = await Promise.all([
            request('/payments/refund', { method: 'POST', body, key: 'refund-a' }),
            request('/payments/refund', { method: 'POST', body, key: 'refund-b' }),
        ]);
        assert.equal(results.filter((item) => item.status === 201).length, 1);
        assert.equal(results.filter((item) => item.status === 400).length, 1);
        assert.equal(await prisma.payment.count({
            where: { relatedPaymentId: payment.id, status: 'refunded' },
        }), 1);
        assert.equal(await prisma.cashTransaction.count({ where: { category: 'refund' } }), 1);
        const freshStudent = await prisma.student.findUnique({ where: { id: student.id } });
        assert.equal(freshStudent.accountBalance, 0);
    });

    test('двойное подтверждение урока списывает деньги и фиксирует тариф один раз', async () => {
        const membership = await prisma.membership.create({
            data: {
                studentId: student.id,
                lessonFormat: 'individual',
                type: 'individual_package',
                totalClasses: 8,
                classesRemaining: 8,
                startDate: new Date('2026-06-01T00:00:00Z'),
                endDate: new Date('2026-07-01T00:00:00Z'),
                totalPrice: 32000,
            },
        });
        const lesson = await prisma.class.create({
            data: {
                teacherId: teacher.id,
                individualStudentId: student.id,
                title: 'P0 индивидуальный урок',
                date: new Date('2026-06-20T00:00:00Z'),
                startTime: '15:00',
                endTime: '16:00',
                duration: 60,
                status: 'pending_admin_review',
                classType: 'individual',
                topic: 'Тема',
                lessonSummary: 'Итог',
            },
        });
        const body = {
            billingDecisions: [{
                studentId: student.id,
                attendanceStatus: 'present',
                amount: 4000,
                membershipId: membership.id,
            }],
        };
        const results = await Promise.all([
            request(`/classes/${lesson.id}/approve`, { method: 'POST', body, key: 'approve-a' }),
            request(`/classes/${lesson.id}/approve`, { method: 'POST', body, key: 'approve-b' }),
        ]);
        assert.equal(results.filter((item) => item.status === 200).length, 1);
        assert.equal(results.filter((item) => item.status === 409).length, 1);
        validateClassApproveResponse(results.find((item) => item.status === 200).payload);
        const [freshStudent, freshMembership] = await Promise.all([
            prisma.student.findUnique({ where: { id: student.id } }),
            prisma.membership.findUnique({ where: { id: membership.id } }),
        ]);
        assert.equal(freshStudent.accountBalance, -4000);
        assert.equal(freshMembership.classesRemaining, 8);
        assert.equal(await prisma.membershipTransaction.count({
            where: { classId: lesson.id, type: 'manual_deduct' },
        }), 1);
        assert.equal(await prisma.classAttendee.count({
            where: { classId: lesson.id, studentId: student.id },
        }), 1);
    });

    test('двойная отметка посещаемости не создаёт двух участников урока', async () => {
        const lesson = await prisma.class.create({
            data: {
                teacherId: teacher.id,
                individualStudentId: student.id,
                title: 'P0 посещаемость',
                date: new Date('2026-06-20T00:00:00Z'),
                startTime: '15:00',
                endTime: '16:00',
                duration: 60,
                status: 'started',
                classType: 'individual',
            },
        });
        const body = {
            studentId: student.id,
            attended: true,
            attendanceStatus: 'present',
        };
        const results = await Promise.all([
            request(`/classes/${lesson.id}/attendance`, { method: 'POST', body, key: 'attendance-a' }),
            request(`/classes/${lesson.id}/attendance`, { method: 'POST', body, key: 'attendance-b' }),
        ]);
        assert.equal(results.filter((item) => item.status === 200).length, 2);
        assert.equal(await prisma.classAttendee.count({
            where: { classId: lesson.id, studentId: student.id },
        }), 1);
    });

    test('две ведомости не могут забрать один и тот же урок', async () => {
        const lesson = await prisma.class.create({
            data: {
                teacherId: teacher.id,
                title: 'P0 зарплата',
                date: new Date('2026-06-20T00:00:00Z'),
                startTime: '15:00',
                endTime: '16:00',
                duration: 60,
                status: 'completed',
                classType: 'individual',
                topic: 'Тема',
                lessonSummary: 'Итог',
            },
        });
        await prisma.classAttendee.create({
            data: {
                classId: lesson.id,
                studentId: student.id,
                attended: true,
                attendanceStatus: 'present',
            },
        });
        const token = tokenFor(admin);
        const body = { teacherId: teacher.id, startDate: '2026-06-01', endDate: '2026-06-30' };
        const results = await Promise.all([
            request('/salary/calculate', { method: 'POST', body, token, key: 'salary-a' }),
            request('/salary/calculate', { method: 'POST', body, token, key: 'salary-b' }),
        ]);
        assert.equal(results.filter((item) => item.status === 200).length, 1);
        assert.equal(results.filter((item) => item.status === 409).length, 1);
        assert.equal(await prisma.salary.count({ where: { teacherId: teacher.id } }), 1);
        assert.equal(await prisma.salaryClass.count({ where: { classId: lesson.id } }), 1);
        const salary = await prisma.salary.findFirst({ where: { teacherId: teacher.id } });
        assert.equal(salary.teacherSalary, 5000);
    });

    test('двойная выплата зарплаты создаёт один расход кассы', async () => {
        const salary = await prisma.salary.create({
            data: {
                teacherId: teacher.id,
                teacherName: 'teacher 2',
                periodStart: new Date('2026-06-01T00:00:00Z'),
                periodEnd: new Date('2026-06-30T23:59:59Z'),
                totalClasses: 1,
                totalStudents: 1,
                totalAttendedClasses: 1,
                totalEarnings: 5000,
                teacherPercentage: 100,
                teacherSalary: 5000,
                status: 'calculated',
            },
        });
        const results = await Promise.all([
            request(`/salary/${salary.id}/pay`, { method: 'PUT', body: {}, key: 'salary-pay-a' }),
            request(`/salary/${salary.id}/pay`, { method: 'PUT', body: {}, key: 'salary-pay-b' }),
        ]);
        assert.equal(results.filter((item) => item.status === 200).length, 1);
        assert.equal(results.filter((item) => item.status === 409).length, 1);
        assert.equal(await prisma.cashTransaction.count({
            where: { category: 'salary', amount: 5000 },
        }), 1);
    });

    test('двойное одобрение заморозки компенсирует занятия один раз', async () => {
        const membership = await prisma.membership.create({
            data: {
                studentId: student.id,
                lessonFormat: 'group',
                type: 'monthly',
                totalClasses: 8,
                classesRemaining: 3,
                startDate: new Date('2026-06-01T00:00:00Z'),
                endDate: new Date('2026-07-01T00:00:00Z'),
                freezesAvailable: 1,
                freezesUsed: 0,
            },
        });
        const freeze = await prisma.freeze.create({
            data: {
                studentId: student.id,
                membershipId: membership.id,
                type: 'admin',
                frozenClasses: 2,
                classesUsed: 0,
                startDate: new Date('2026-06-20T00:00:00Z'),
                endDate: new Date('2026-06-21T00:00:00Z'),
                createdById: admin.id,
                status: 'pending',
            },
        });
        const results = await Promise.all([
            request(`/freezes/${freeze.id}/approve`, { method: 'PATCH', body: {}, key: 'freeze-a' }),
            request(`/freezes/${freeze.id}/approve`, { method: 'PATCH', body: {}, key: 'freeze-b' }),
        ]);
        assert.equal(results.filter((item) => item.status === 200).length, 1);
        assert.equal(results.filter((item) => item.status === 409).length, 1);
        const freshMembership = await prisma.membership.findUnique({ where: { id: membership.id } });
        assert.equal(freshMembership.freezesUsed, 1);
        assert.equal(freshMembership.classesRemaining, 5);
        assert.equal(await prisma.membershipTransaction.count({ where: { freezeId: freeze.id } }), 1);
    });

    test('параллельное назначение пробного создаёт один 30-минутный диагностический урок', async () => {
        const room = await prisma.room.create({
            data: { name: 'P0 кабинет', isActive: true },
        });
        const booking = await prisma.booking.create({
            data: {
                name: 'Пробный',
                lastName: 'Ученик',
                phone: '+77000000099',
                phoneDigits: '77000000099',
                direction: 'Вокал',
                status: 'processed',
            },
        });
        const body = {
            teacherId: teacher.id,
            roomId: room.id,
            scheduledAt: '2026-06-25T10:00:00+05:00',
            depositPaid: true,
        };
        const results = await Promise.all([
            request(`/bookings/${booking.id}/trial-details`, { method: 'PATCH', body, key: 'trial-a' }),
            request(`/bookings/${booking.id}/trial-details`, { method: 'PATCH', body, key: 'trial-b' }),
        ]);
        assert.equal(results.filter((item) => item.status === 200).length, 2);
        const freshBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
        assert.ok(freshBooking.trialClassId);
        const lessons = await prisma.class.findMany({
            where: { classType: 'trial', teacherId: teacher.id, roomId: room.id },
        });
        assert.equal(lessons.length, 1);
        const lesson = lessons[0];
        assert.equal(lesson.id, freshBooking.trialClassId);
        assert.equal(lesson.classType, 'trial');
        assert.equal(lesson.duration, 30);
        assert.equal(lesson.endTime, '10:30');
        assert.equal(lesson.price, 2000);
    });

    test('integration API пишет журнал, отдаёт contract-ответы и доступен только по service-token', async () => {
        process.env.INTEGRATION_SERVICE_SECRET = 'integration-secret';
        const lesson = await prisma.class.create({
            data: {
                teacherId: teacher.id,
                individualStudentId: student.id,
                title: 'Контракт интеграции',
                date: new Date('2026-06-20T00:00:00Z'),
                startTime: '15:00',
                endTime: '16:00',
                duration: 60,
                status: 'scheduled',
                classType: 'individual',
            },
        });

        const noToken = await fetch(`${baseUrl}/integration/v1/classes/${lesson.id}`, {
            headers: { 'X-Integration-System': 'learning-platform' },
        });
        assert.equal(noToken.status, 401);

        const response = await fetch(`${baseUrl}/integration/v1/classes/${lesson.id}`, {
            headers: {
                Authorization: 'Bearer integration-secret',
                'X-Integration-System': 'learning-platform',
            },
        });
        const payload = await response.json();
        assert.equal(response.status, 200);
        validateIntegrationClassResponse(payload);

        const logsResponse = await request('/integration-logs', { method: 'GET', key: 'integration-logs-list' });
        assert.equal(logsResponse.status, 200);
        validateIntegrationLogListResponse(logsResponse.payload);
        assert.ok(logsResponse.payload.logs.some((log) => log.path.includes(`/classes/${lesson.id}`)));
    });

    test('повтор неудачной исходящей интеграции доступен только администратору', async () => {
        const log = await prisma.integrationLog.create({
            data: {
                direction: 'outbound',
                system: 'learning-platform',
                operation: 'users.link',
                method: 'POST',
                path: 'http://127.0.0.1:9/unavailable',
                status: 'failed',
                requestBody: { crmStudentId: student.id },
                errorMessage: 'connect ECONNREFUSED',
                attempts: 1,
                retryable: true,
            },
        });
        const teacherResult = await request(`/integration-logs/${log.id}/retry`, {
            method: 'POST',
            token: tokenFor(teacher),
            key: 'teacher-retry-integration',
        });
        assert.equal(teacherResult.status, 403);

        const adminResult = await request(`/integration-logs/${log.id}/retry`, {
            method: 'POST',
            key: 'admin-retry-integration',
        });
        assert.ok([502, 500].includes(adminResult.status));
        const freshLog = await prisma.integrationLog.findUnique({ where: { id: log.id } });
        assert.equal(freshLog.attempts, 2);
        assert.equal(freshLog.status, 'failed');
    });

    test('сверка CRM ↔ приложение возвращает summary даже когда приложение недоступно', async () => {
        process.env.INTEGRATION_SERVICE_SECRET = 'integration-secret';
        process.env.LEARNING_PLATFORM_API_URL = 'http://127.0.0.1:9';
        const result = await request('/integration-logs/reconciliation/summary', {
            method: 'GET',
            key: 'reconciliation-summary',
        });
        assert.equal(result.status, 200);
        validateReconciliationResponse(result.payload);
        assert.equal(result.payload.data.appAvailable, false);
        assert.ok(result.payload.data.issues.some((item) => item.type === 'app_snapshot_unavailable'));
    });

    test('платёж с уже оформленным возвратом нельзя удалить', async () => {
        const payment = await prisma.payment.create({
            data: {
                studentId: student.id,
                managerId: admin.id,
                amount: 4000,
                type: 'membership_full',
                status: 'completed',
                paymentMethod: TEST_PAYMENT_METHOD,
            },
        });
        await prisma.payment.create({
            data: {
                studentId: student.id,
                managerId: admin.id,
                amount: 1000,
                type: 'membership_full',
                status: 'refunded',
                relatedPaymentId: payment.id,
                paymentMethod: TEST_PAYMENT_METHOD,
            },
        });
        await prisma.student.update({
            where: { id: student.id },
            data: { accountBalance: 3000 },
        });
        const result = await request(`/payments/${payment.id}`, {
            method: 'DELETE',
            key: 'delete-refunded-payment',
        });
        assert.equal(result.status, 409);
        assert.ok(await prisma.payment.findUnique({ where: { id: payment.id } }));
        const freshStudent = await prisma.student.findUnique({ where: { id: student.id } });
        assert.equal(freshStudent.accountBalance, 3000);
    });
}
