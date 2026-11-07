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
            examId: randomUUID(), sessionId:randomUUID(), sessionTitle:'Экзамен сектора 1 · Гитара', crmStudentId: student.id, studentName: null, crmDirectionId: 'guitar',
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

    async function integration(path, {method='GET',body,system='learning-platform',token=process.env.INTEGRATION_SERVICE_SECRET}={}){
        const response=await fetch(`${baseUrl}/integration/v1${path}`,{method,headers:{Authorization:`Bearer ${token}`,'X-Integration-System':system,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
        return {status:response.status,body:await response.json()};
    }
    const book=(examIds,slot)=>integration('/sector-exams/book',{method:'POST',body:{examIds,...slot}});

    test('the app is the only assignment entry; old CRM booking endpoints are gone',async()=>{
        assert.equal((await request('/sector-exams/pending')).status,404);
        assert.equal((await request('/classes',{method:'POST',body:{classType:'exam',date:day(9),startTime:'10:00',endTime:'11:00'}})).body.code,'EXAM_SESSION_REQUIRED');
        assert.equal((await request('/sector-exams/book',{method:'POST',body:{}})).status,404);
        assert.equal((await request(`/sector-exams/${randomUUID()}/schedule`,{method:'POST',body:{}})).status,404);
        assert.equal((await integration('/exam-scheduling-options',{token:'wrong'})).status,401);
        assert.equal((await integration('/exam-scheduling-options',{system:'crm'})).status,403);
        const options=await integration('/exam-scheduling-options');
        assert.equal(options.status,200);assert.ok(options.body.data.teachers.some(row=>row.id===teacher.id));
        assert.ok(options.body.data.rooms.some(row=>row.id===room.id));
    });

    test('the whole six-pupil session books one free lesson, retries once, and cannot be split or extended',async()=>{
        const pupils=[student,classmate];
        for(let i=0;i<4;i++)pupils.push(await prisma.student.create({data:{name:`Ученик ${i+3}`,lastName:`Exam-${suffix}`,phone:randomUUID(),password:'fixture',role:'student',status:'active',learningDirections:['Гитара'],teacherDirections:[]}}));
        const sessionId=randomUUID();
        const exams=pupils.map(pupil=>pendingExam({crmStudentId:pupil.id,sessionId,sessionTitle:'Переход в квартеты'}));platform.pending=exams;
        const slot={date:day(0),startTime:'10:00',endTime:'11:30',teacherId:teacher.id,roomId:room.id};
        assert.equal((await book([exams[0].examId],slot)).body.code,'EXAM_SESSION_REQUIRED');
        assert.equal((await integration('/sector-exams/book',{method:'POST',system:'crm',body:{examIds:exams.map(e=>e.examId),...slot}})).status,403);
        const before=await prisma.student.findMany({where:{id:{in:pupils.map(p=>p.id)}},select:{id:true,accountBalance:true}});
        const booked=await book(exams.map(e=>e.examId),slot);
        assert.equal(booked.status,200,JSON.stringify(booked.body));
        const lesson=booked.body.data.class;
        assert.equal(lesson.classType,'exam');assert.equal(lesson.price,0);
        assert.equal((await request(`/classes/${lesson.id}`,{method:'PATCH',body:{classType:'individual'}})).body.code,'EXAM_SESSION_REQUIRED');
        assert.equal((await request(`/classes/${lesson.id}`,{method:'PATCH',body:{price:5000}})).body.code,'EXAM_SESSION_REQUIRED');assert.equal(lesson.title,'Переход в квартеты · 6 учеников');
        assert.equal(await prisma.classSectorExam.count({where:{classId:lesson.id}}),6);
        // 07.11 (P3): the exam lesson is in each pupil's schedule for the app («Следующий урок»).
        const { getStudentOfflineSummary } = require('../src/services/integrationRead');
        const summary = await getStudentOfflineSummary(pupils[2].id);
        const lessons = [...summary.data.upcomingLessons, ...summary.data.lessonHistory];
        assert.ok(lessons.some(row => row.crmClassId === lesson.id && row.classType === 'exam'), 'exam lesson in the pupil schedule');
        assert.equal((await book(exams.map(e=>e.examId),slot)).body.data.alreadyBooked,true);
        assert.equal((await book(exams.map(e=>e.examId),{...slot,startTime:'13:00',endTime:'14:30'})).body.code,'SECTOR_EXAM_ALREADY_BOOKED_DIFFERENT_SLOT');
        assert.equal((await request(`/sector-exams/classes/${lesson.id}/students`)).body.students.length,6);
        const options=await request(`/classes/${lesson.id}/billing-options?studentIds=${pupils.map(p=>p.id).join(',')}`);
        assert.ok(options.body.students.every(row=>!row.requiresMembershipSelection));
        const approved=await request(`/classes/${lesson.id}/approve`,{method:'POST',body:{topic:'Экзамен',lessonSummary:'Шесть учеников',billingDecisions:pupils.map(p=>({studentId:p.id,attendanceStatus:'present'}))}});
        assert.equal(approved.status,200,JSON.stringify(approved.body));
        assert.ok((await prisma.classAttendee.findMany({where:{classId:lesson.id}})).every(row=>!row.chargeAmount));
        assert.deepEqual(await prisma.student.findMany({where:{id:{in:pupils.map(p=>p.id)}},select:{id:true,accountBalance:true}}),before);
        const {getTeacherRate}=require('../src/services/salaryPolicy');
        assert.equal(getTeacherRate({salaryGroup:3000,salaryIndividual:5000,salaryOther:1000},lesson),3000);
    });

    test('calendar conflicts and a stale exam session refuse assignment without creating a lesson',async()=>{
        const first=pendingExam(),other=pendingExam({crmStudentId:classmate.id});platform.pending=[first,other];
        const slot={date:day(2),startTime:'12:00',endTime:'13:00',teacherId:teacher.id,roomId:room.id};
        assert.equal((await book([first.examId,other.examId],slot)).body.code,'EXAM_SESSION_REQUIRED');
        const booked=await book([first.examId],slot);assert.equal(booked.status,200,JSON.stringify(booked.body));
        const conflict=await book([other.examId],slot);assert.equal(conflict.status,409);assert.equal(conflict.body.code,'CLASS_SCHEDULE_CONFLICT');
        assert.equal((await book([randomUUID()],slot)).body.code,'SECTOR_EXAM_NOT_PENDING');
        assert.equal((await book(['invalid'],slot)).status,400);
        await prisma.student.update({where:{id:teacher.id},data:{status:'inactive'}});
        assert.equal((await book([other.examId],{...slot,startTime:'14:00',endTime:'15:00'})).body.code,'TEACHER_NOT_FOUND');
        await prisma.student.update({where:{id:teacher.id},data:{status:'active'}});
    });

    test('WhatsApp invitations preserve student/parent routing and point to the exam in the app',async()=>{
        const exam=pendingExam();platform.pending=[exam];
        const today=new Date();const date=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()+3)).toISOString().slice(0,10);
        const booked=await book([exam.examId],{date,startTime:'18:00',endTime:'19:00',teacherId:teacher.id,roomId:room.id});assert.equal(booked.status,200,JSON.stringify(booked.body));
        const reminders=await request('/admin/whatsapp-reminders');const mine=reminders.body.exam.filter(item=>item.classId===booked.body.data.class.id);
        assert.deepEqual(mine.map(item=>item.recipientAudience).sort(),['parent','student']);
        assert.match(mine.find(item=>item.recipientAudience==='parent').message,/^Здравствуйте, Руслан!/);
        const sent=await request('/admin/whatsapp-reminders/sent',{method:'POST',body:{kind:'exam',itemId:mine[0].id,studentId:student.id}});assert.equal(sent.status,200);
        assert.equal((await request('/admin/whatsapp-reminders')).body.exam.filter(item=>item.classId===booked.body.data.class.id).length,1);
    });
}
