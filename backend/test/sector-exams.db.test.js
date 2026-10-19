const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');

// Plan 1.11: booking a sector exam from the platform's queue as a free lesson, and approving it.
if (!process.env.TEST_DATABASE_URL) {
    test('sector exam PostgreSQL HTTP suite', { skip: 'TEST_DATABASE_URL не задан' }, () => {});
} else {
    const database = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)
        && /(?:test|qa)/i.test(database.pathname), 'Use a dedicated local QA/test database');
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'sector-exam-local-qa-secret';
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.TELEGRAM_BOT_TOKEN = '';
    process.env.TELEGRAM_CHAT_ID = '';
    process.env.INTEGRATION_SERVICE_SECRET = 'sector-exam-integration-secret';

    const jwt = require('jsonwebtoken');
    const app = require('../src/server');
    const { prisma } = require('../src/config/db');
    const suffix = randomUUID().slice(0, 8);
    const platform = { pending: [], scheduled: [] };
    let platformServer;
    let baseUrl;
    let admin;
    let teacher;
    let student;
    let classmate;
    let room;

    const digits = (pad) => suffix.replace(/\D/g, '').padEnd(7, pad).slice(0, 7);
    const day = (offset) => {
        const date = new Date(Date.UTC(2099, 0, 10 + offset));
        return date.toISOString().slice(0, 10);
    };

    async function request(path, { method = 'GET', body } = {}) {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '10m' })}`,
                'Content-Type': 'application/json',
                'X-Idempotency-Key': randomUUID(),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
    }

    function pendingExam(overrides = {}) {
        return {
            examId: randomUUID(), crmStudentId: student.id, studentName: null, crmDirectionId: 'guitar',
            directionTitle: 'Гитара', sectorSequence: 1, attempt: 1, itemsCount: 3, sentForScheduleAt: new Date().toISOString(),
            ...overrides,
        };
    }

    test.before(async () => {
        // A stand-in for the learning platform's integration routes.
        const fake = express();
        fake.use(express.json());
        fake.get('/api/integration/v1/sector-exams/awaiting-schedule', (req, res) => {
            assert.equal(req.get('X-Integration-System'), 'crm');
            res.json({ success: true, data: { exams: platform.pending } });
        });
        fake.post('/api/integration/v1/sector-exams/:examId/schedule', (req, res) => {
            platform.scheduled.push({ examId: req.params.examId, ...req.body });
            platform.pending = platform.pending.filter(exam => exam.examId !== req.params.examId);
            res.json({ success: true, data: { examId: req.params.examId, status: 'scheduled' } });
        });
        fake.use((req, res) => res.status(404).json({ success: false }));
        platformServer = await new Promise(resolve => {
            const server = fake.listen(0, '127.0.0.1', () => resolve(server));
        });
        process.env.LEARNING_PLATFORM_API_URL = `http://127.0.0.1:${platformServer.address().port}`;

        await prisma.$connect();
        admin = await prisma.student.create({ data: {
            name: 'Exam QA', lastName: `admin-${suffix}`, phone: `qa-exam-admin-${suffix}`, password: 'local-test-only',
            role: 'super_admin', learningDirections: [], teacherDirections: [],
        } });
        teacher = await prisma.student.create({ data: {
            name: 'Exam QA', lastName: `teacher-${suffix}`, phone: `qa-exam-teacher-${suffix}`, password: 'local-test-only',
            role: 'teacher', learningDirections: [], teacherDirections: ['Гитара'],
        } });
        student = await prisma.student.create({ data: {
            name: 'Камбар', lastName: `Exam-${suffix}`, customerName: 'Камбар', phone: `+7701${digits('1')}`,
            password: 'local-test-only', role: 'student', status: 'active', learningDirections: ['Гитара'], teacherDirections: [],
            accountBalance: 10000,
            additionalPhones: { create: [{ phone: `+7702${digits('2')}`, phoneDigits: `7702${digits('2')}`, label: 'Папа Руслан' }] },
        } });
        classmate = await prisma.student.create({ data: {
            name: 'Алия', lastName: `Exam-${suffix}`, customerName: 'Алия', phone: `+7703${digits('3')}`,
            password: 'local-test-only', role: 'student', status: 'active', learningDirections: ['Гитара'], teacherDirections: [],
            accountBalance: 5000,
        } });
        room = await prisma.room.create({ data: { name: `Exam room ${suffix}` } });
        await new Promise(resolve => app.httpServer.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${app.httpServer.address().port}/api`;
    });

    test.after(async () => {
        if (app.httpServer.listening) await new Promise(resolve => app.httpServer.close(resolve));
        await new Promise(resolve => platformServer.close(resolve));
        await prisma.$disconnect();
    });

    test('an admin books a pending exam in a free slot as a free exam lesson, once', async () => {
        const exam = pendingExam();
        platform.pending = [exam];
        const queue = await request('/sector-exams/pending');
        assert.equal(queue.status, 200, JSON.stringify(queue.body));
        assert.equal(queue.body.available, true);
        assert.equal(queue.body.exams[0].title, 'Экзамен сектора 1 · Гитара');
        assert.equal(queue.body.exams[0].studentName, `Exam-${suffix} Камбар`);

        const slot = { date: day(0), startTime: '12:00', endTime: '13:00', teacherId: teacher.id, roomId: room.id };
        const missingRoom = await request(`/sector-exams/${exam.examId}/schedule`, { method: 'POST', body: { ...slot, roomId: null } });
        assert.equal(missingRoom.status, 400);

        const booked = await request(`/sector-exams/${exam.examId}/schedule`, { method: 'POST', body: slot });
        assert.equal(booked.status, 201, JSON.stringify(booked.body));
        const lesson = await prisma.class.findUnique({ where: { id: booked.body.class.id } });
        assert.equal(lesson.classType, 'exam');
        assert.equal(lesson.price, 0);
        assert.deepEqual(
            (await prisma.classSectorExam.findMany({ where: { classId: lesson.id } })).map(row => [row.sectorExamId, row.studentId]),
            [[exam.examId, student.id]],
        );
        assert.deepEqual(platform.scheduled.at(-1), {
            examId: exam.examId, crmClassId: lesson.id, lessonAt: `${day(0)}T07:00:00.000Z`, crmTeacherId: teacher.id,
        });

        // The same exam is not booked twice; the call re-sends the confirmation instead.
        platform.pending = [exam];
        const again = await request(`/sector-exams/${exam.examId}/schedule`, { method: 'POST', body: { ...slot, startTime: '15:00', endTime: '16:00' } });
        assert.equal(again.status, 200);
        assert.equal(again.body.alreadyBooked, true);
        assert.equal(await prisma.classSectorExam.count({ where: { sectorExamId: exam.examId } }), 1);
        const filtered = await request('/sector-exams/pending');
        assert.equal(filtered.body.exams.length, 0, 'a booked exam leaves the queue even before the platform catches up');
    });

    test('the slot must be free and the exam must still be waiting', async () => {
        const exam = pendingExam();
        platform.pending = [exam];
        await prisma.class.create({ data: {
            teacherId: teacher.id, originalTeacherId: teacher.id, roomId: room.id, title: `Busy ${suffix}`,
            date: new Date(`${day(1)}T00:00:00.000Z`), startTime: '12:30', endTime: '13:15', duration: 45,
            status: 'scheduled', classType: 'individual',
        } });
        const busy = await request(`/sector-exams/${exam.examId}/schedule`, { method: 'POST', body: {
            date: day(1), startTime: '12:00', endTime: '13:00', teacherId: teacher.id, roomId: room.id,
        } });
        assert.equal(busy.status, 409);
        assert.equal(busy.body.code, 'CLASS_SCHEDULE_CONFLICT');

        const gone = await request(`/sector-exams/${randomUUID()}/schedule`, { method: 'POST', body: {
            date: day(2), startTime: '12:00', endTime: '13:00', teacherId: teacher.id, roomId: room.id,
        } });
        assert.equal(gone.status, 409);
        assert.equal(gone.body.code, 'SECTOR_EXAM_NOT_PENDING');
    });

    test('approving an exam lesson keeps attendance and charges nothing', async () => {
        const exam = pendingExam();
        platform.pending = [exam];
        const booked = await request(`/sector-exams/${exam.examId}/schedule`, { method: 'POST', body: {
            date: day(3), startTime: '10:00', endTime: '11:00', teacherId: teacher.id, roomId: room.id,
        } });
        assert.equal(booked.status, 201, JSON.stringify(booked.body));
        const classId = booked.body.class.id;
        const options = await request(`/classes/${classId}/billing-options?studentIds=${student.id}`);
        assert.equal(options.status, 200, JSON.stringify(options.body));
        assert.equal(options.body.students.every(item => item.requiresMembershipSelection === false), true);

        const before = (await prisma.student.findUnique({ where: { id: student.id } })).accountBalance;
        const approved = await request(`/classes/${classId}/approve`, { method: 'POST', body: {
            topic: 'Экзамен сектора', lessonSummary: 'Ученик сдал экзамен',
            billingDecisions: [{ studentId: student.id, attendanceStatus: 'present' }],
        } });
        assert.equal(approved.status, 200, JSON.stringify(approved.body));
        const attendee = await prisma.classAttendee.findFirst({ where: { classId, studentId: student.id } });
        assert.equal(attendee.attended, true);
        assert.ok(!attendee.chargeAmount, 'no charge on an exam lesson');
        assert.equal((await prisma.student.findUnique({ where: { id: student.id } })).accountBalance, before);
        assert.equal((await prisma.class.findUnique({ where: { id: classId } })).status, 'completed');
    });

    test('the WhatsApp queue offers the invitation to the student and to the parent', async () => {
        const exam = pendingExam();
        platform.pending = [exam];
        const today = new Date();
        const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 3)).toISOString().slice(0, 10);
        const booked = await request(`/sector-exams/${exam.examId}/schedule`, { method: 'POST', body: {
            date, startTime: '18:00', endTime: '19:00', teacherId: teacher.id, roomId: room.id,
        } });
        assert.equal(booked.status, 201, JSON.stringify(booked.body));
        const reminders = await request('/admin/whatsapp-reminders');
        assert.equal(reminders.status, 200, JSON.stringify(reminders.body));
        const mine = reminders.body.exam.filter(item => item.classId === booked.body.class.id);
        assert.deepEqual(mine.map(item => item.recipientAudience).sort(), ['parent', 'student']);
        assert.match(mine.find(item => item.recipientAudience === 'parent').message, /^Здравствуйте, Руслан! Камбар приглашается на экзамен сектора 1/);

        const sent = await request('/admin/whatsapp-reminders/sent', { method: 'POST', body: { kind: 'exam', itemId: mine[0].id, studentId: student.id } });
        assert.equal(sent.status, 200, JSON.stringify(sent.body));
        const after = await request('/admin/whatsapp-reminders');
        assert.equal(after.body.exam.filter(item => item.classId === booked.body.class.id).length, 1);
    });

    test('several students sit one exam lesson; more can join it; the teacher is paid once', async () => {
        const first = pendingExam();
        const second = pendingExam({ crmStudentId: classmate.id, examId: randomUUID() });
        platform.pending = [first, second];
        const booked = await request('/sector-exams/book', { method: 'POST', body: {
            examIds: [first.examId, second.examId], date: day(5), startTime: '11:00', endTime: '12:00', teacherId: teacher.id, roomId: room.id,
        } });
        assert.equal(booked.status, 201, JSON.stringify(booked.body));
        assert.equal(booked.body.booked, 2);
        const classId = booked.body.class.id;
        const lesson = await prisma.class.findUnique({ where: { id: classId } });
        assert.equal(lesson.title, 'Экзамен секторов · Гитара · 2 ученика');
        assert.equal(lesson.individualStudentId, null);
        assert.deepEqual(platform.scheduled.slice(-2).map(item => [item.examId, item.crmClassId]).sort(), [[first.examId, classId], [second.examId, classId]].sort());

        const { getClassStudents } = require('../src/services/integrationRead');
        const roster = await getClassStudents(classId);
        assert.deepEqual(roster.data.students.map(item => item.crmStudentId).sort(), [student.id, classmate.id].sort());
        const attendanceList = await request(`/sector-exams/classes/${classId}/students`);
        assert.equal(attendanceList.body.students.length, 2);

        // A third student joins the booked lesson at its time, teacher and room.
        const third = await prisma.student.create({ data: {
            name: 'Ерлан', lastName: `Exam-${suffix}`, phone: `+7704${digits('4')}`, password: 'local-test-only',
            role: 'student', status: 'active', learningDirections: ['Гитара'], teacherDirections: [],
        } });
        const late = pendingExam({ crmStudentId: third.id, examId: randomUUID() });
        platform.pending = [late];
        const joined = await request('/sector-exams/book', { method: 'POST', body: { examIds: [late.examId], classId } });
        assert.equal(joined.status, 201, JSON.stringify(joined.body));
        assert.equal(joined.body.addedToExisting, true);
        assert.equal(joined.body.class.title, 'Экзамен секторов · Гитара · 3 ученика');
        assert.equal(await prisma.class.count({ where: { classType: 'exam', date: new Date(`${day(5)}T00:00:00.000Z`), teacherId: teacher.id } }), 1);

        // A student already in this exam lesson cannot be booked into another one at the same time.
        const clash = pendingExam({ crmStudentId: third.id, examId: randomUUID() });
        platform.pending = [clash];
        const otherTeacher = await prisma.student.create({ data: {
            name: 'Exam QA', lastName: `teacher2-${suffix}`, phone: `qa-exam-teacher2-${suffix}`, password: 'local-test-only',
            role: 'teacher', learningDirections: [], teacherDirections: ['Гитара'],
        } });
        const otherRoom = await prisma.room.create({ data: { name: `Exam room 2 ${suffix}` } });
        const busy = await request('/sector-exams/book', { method: 'POST', body: {
            examIds: [clash.examId], date: day(5), startTime: '11:30', endTime: '12:30', teacherId: otherTeacher.id, roomId: otherRoom.id,
        } });
        assert.equal(busy.status, 409);
        assert.match(busy.body.error, /^Exam-.+ Ерлан: Время занято/);

        // Approval: attendance for everyone, no charge, one lesson for the teacher's pay.
        const approved = await request(`/classes/${classId}/approve`, { method: 'POST', body: {
            topic: 'Экзамен секторов', lessonSummary: 'Трое сдавали экзамен',
            billingDecisions: [student.id, classmate.id, third.id].map(id => ({ studentId: id, attendanceStatus: 'present' })),
        } });
        assert.equal(approved.status, 200, JSON.stringify(approved.body));
        const attendees = await prisma.classAttendee.findMany({ where: { classId } });
        assert.equal(attendees.length, 3);
        assert.ok(attendees.every(row => !row.chargeAmount));
        const { getTeacherRate } = require('../src/services/salaryPolicy');
        assert.equal(getTeacherRate({ salaryGroup: 3000, salaryIndividual: 5000, salaryOther: 1000 }, lesson), 3000);
    });
}
