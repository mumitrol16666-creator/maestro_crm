const test = require('node:test');
const assert = require('node:assert/strict');

const dbModulePath = require.resolve('../src/config/db');
require.cache[dbModulePath] = {
    id: dbModulePath, filename: dbModulePath, loaded: true, exports: { prisma: {} }, children: [], paths: [],
};

const {
    buildExamInvitationMessage, examLessonAt, sectorExamTitle, isSectorExamClass, examLessonTitle, studentExamTitle,
} = require('../src/services/sectorExams');
const { resolveStudentExamContacts } = require('../src/services/studentNotificationRouting');

test('the exam lesson time is sent to the platform as an Aqtobe instant', () => {
    assert.equal(examLessonAt(new Date('2026-10-21T00:00:00.000Z'), '12:00'), '2026-10-21T07:00:00.000Z');
    assert.equal(examLessonAt('2026-10-21', '09:30'), '2026-10-21T04:30:00.000Z');
});

test('the lesson title names the sector, a retake and the direction', () => {
    assert.equal(sectorExamTitle({ sectorSequence: 2, attempt: 1, directionTitle: 'Гитара' }), 'Экзамен сектора 2 · Гитара');
    assert.equal(sectorExamTitle({ sectorSequence: 2, attempt: 2, directionTitle: 'Гитара' }), 'Экзамен сектора 2, пересдача · Гитара');
    assert.equal(isSectorExamClass({ classType: 'exam' }), true);
    assert.equal(isSectorExamClass({ classType: 'individual' }), false);
});

test('the WhatsApp invitation speaks to the student or to the parent', () => {
    const base = { title: 'Экзамен сектора 1 · Гитара', date: new Date('2026-10-21T00:00:00.000Z'), startTime: '12:00', roomName: 'Синий' };
    const student = buildExamInvitationMessage({ ...base, audience: 'student', recipientName: 'Камбар' });
    assert.match(student, /^Здравствуйте, Камбар! Приглашаем вас на экзамен сектора 1 · Гитара: 21 октября в 12:00, кабинет «Синий»\./);
    assert.match(student, /бесплатный дополнительный урок/);
    const parent = buildExamInvitationMessage({ ...base, audience: 'parent', recipientName: 'Руслан', studentName: 'Камбар' });
    assert.match(parent, /^Здравствуйте, Руслан! Камбар приглашается на экзамен/);
});

test('an exam invitation goes once to the student and once to a parent', () => {
    const student = {
        name: 'Камбар', customerName: 'Камбар', phone: '+7 700 000 00 21', notifyLessons: true,
        additionalPhones: [
            { phone: '+7 700 000 00 31', label: 'Мама Айгуль', notifyLessons: false },
            { phone: '87000000021', label: 'Второй номер' },
        ],
    };
    const contacts = resolveStudentExamContacts(student);
    assert.deepEqual(contacts.map(contact => [contact.audience, contact.phone]), [
        ['student', '+7 700 000 00 21'],
        ['parent', '+7 700 000 00 31'],
    ]);
    // A student whose primary phone belongs to the parent: one parent contact, no duplicate.
    const child = { name: 'Алия', customerName: 'Ерлан', phone: '+77001112233', additionalPhones: [] };
    assert.deepEqual(resolveStudentExamContacts(child).map(contact => contact.audience), ['parent']);
});

test('avatars sent with http:// are upgraded to https, local ones are kept', () => {
    const { secureMediaAvatarUrl } = require('../src/routes/integration');
    assert.equal(secureMediaAvatarUrl('http://maestro.kz/api/v1/media/images/a.png'), 'https://maestro.kz/api/v1/media/images/a.png');
    assert.equal(secureMediaAvatarUrl('https://maestro.kz/api/v1/media/images/a.png'), 'https://maestro.kz/api/v1/media/images/a.png');
    assert.equal(secureMediaAvatarUrl('http://127.0.0.1:4001/api/v1/media/images/a.png'), 'http://127.0.0.1:4001/api/v1/media/images/a.png');
    assert.equal(secureMediaAvatarUrl('http://example.com/photo.png'), 'http://example.com/photo.png');
});

test('a group sector exam names the group, one lesson for its members reads as the group exam', () => {
    const exam = { sectorSequence: 3, attempt: 1, directionTitle: 'Гитара', crmGroupId: 'g1', groupName: 'Квартет' };
    assert.equal(sectorExamTitle(exam), 'Экзамен сектора группы 3 · Гитара · Квартет');
    const lesson = examLessonTitle([
        { ...exam, crmStudentId: 's1' }, { ...exam, crmStudentId: 's2' }, { ...exam, crmStudentId: 's3' },
    ]);
    assert.equal(lesson, 'Экзамен секторов · Гитара · 3 ученика');
    // The invitation of one member drops the head count.
    assert.equal(studentExamTitle(lesson), 'Экзамен сектора · Гитара');
    // Members of different groups share a generic exam lesson.
    assert.match(examLessonTitle([{ ...exam }, { ...exam, crmGroupId: 'g2' }]), /^Экзамен секторов · Гитара · 2 ученика$/);
});

test('a prepared exam session keeps its title in the CRM queue', () => {
    assert.equal(sectorExamTitle({sessionId:'session-1',sessionTitle:'Первый сектор ноябрь',directionTitle:'Гитара'}),'Первый сектор ноябрь · Гитара');
    assert.equal(examLessonTitle(Array.from({length:6},()=>({sessionId:'session-1',sessionTitle:'Переход в квартеты'}))),'Переход в квартеты · 6 учеников');
});


test('a retry preserves its single booked lesson, reports failed confirmation, and refuses a different appointment', async () => {
    const { bookSectorExams } = require('../src/services/sectorExams');
    const booked = {id:'lesson',date:new Date('2026-11-20'),startTime:'10:00',endTime:'11:00',teacherId:'teacher',roomId:'room'};
    const db = {classSectorExam:{findMany:async()=>['e1','e2','e3','e4','e5','e6'].map(id=>({sectorExamId:id,classId:'lesson',class:booked}))}};
    const input={examIds:['e1','e2','e3','e4','e5','e6'],date:'2026-11-20',startTime:'10:00',endTime:'11:00',teacherId:'teacher',roomId:'room'};
    let calls=0;
    const result=await bookSectorExams(input,{db,confirmSchedule:async()=>{calls++;}});
    assert.equal(result.class.id,'lesson');assert.equal(result.alreadyBooked,true);assert.equal(calls,6);
    assert.equal((await bookSectorExams(input,{db,confirmSchedule:async()=>{throw Error('unavailable');}})).platformConfirmed,false);
    await assert.rejects(bookSectorExams({...input,startTime:'12:00'},{db}),error=>error.code==='SECTOR_EXAM_ALREADY_BOOKED_DIFFERENT_SLOT');
});

test('pupils booked into different lessons are not silently combined on a retry',async()=>{
    const {bookSectorExams}=require('../src/services/sectorExams');
    const db={classSectorExam:{findMany:async()=>[{classId:'a',sectorExamId:'e1',class:{id:'a'}},{classId:'b',sectorExamId:'e2',class:{id:'b'}}]}};
    await assert.rejects(bookSectorExams({examIds:['e1','e2']},{db}),error=>error.code==='SECTOR_EXAM_ALREADY_BOOKED');
});

test('07.11: a session exam is named by its title in the invitation, the Telegram list has no empty dashes', () => {
    assert.equal(studentExamTitle('Переход в квартеты · 4 ученика'), 'Экзамен «Переход в квартеты»');
    const message = buildExamInvitationMessage({ audience: 'student', recipientName: 'Камбар', title: 'Переход в квартеты · 4 ученика', date: '2026-11-12', startTime: '16:00', roomName: 'Большой' });
    assert.match(message, /Приглашаем вас на экзамен «Переход в квартеты»: 12 ноября в 16:00/);
    assert.doesNotMatch(message, /учени/);
    const { formatSectorExamScheduledMessage } = require('../src/services/notifications');
    const text = formatSectorExamScheduledMessage({ title: 'Переход в квартеты · 2 ученика', date: '2026-11-12', startTime: '16:00', endTime: '17:00' }, [{ studentName: 'Аруна Б.' }, { studentName: 'Ерлан К.', title: '' }]);
    assert.match(text, /• Аруна Б\.\n• Ерлан К\./);
});

test('07.11: a one-pupil session exam is named by its title too; old titles stay', () => {
    assert.equal(studentExamTitle('Первый сектор ноябрь · Гитара'), 'Экзамен «Первый сектор ноябрь»');
    assert.equal(studentExamTitle('Экзамен сектора · Гитара'), 'Экзамен сектора · Гитара');
});

test('07.11: an exam the platform refused (sector closed early) leaves the lesson, an empty lesson is cancelled', async () => {
    const { bookSectorExams } = require('../src/services/sectorExams');
    const booked = { id: 'lesson', date: new Date('2026-11-20'), startTime: '10:00', endTime: '11:00', teacherId: 'teacher', roomId: 'room' };
    const refusal = Object.assign(new Error('409'), { response: { status: 409, data: { error: { code: 'SECTOR_EXAM_NOT_SCHEDULABLE' } } } });
    const state = { rows: ['e1', 'e2'], status: 'scheduled' };
    const tx = {
        classSectorExam: {
            deleteMany: async ({ where }) => { state.rows = state.rows.filter((id) => !where.sectorExamId.in.includes(id)); },
            count: async () => state.rows.length,
        },
        class: { update: async ({ data }) => { state.status = data.status; } },
    };
    const db = {
        classSectorExam: { findMany: async () => state.rows.map((id) => ({ sectorExamId: id, classId: 'lesson', class: booked })) },
        $transaction: async (fn) => fn(tx),
    };
    const input = { examIds: ['e1', 'e2'] };
    // One pupil's sector was closed: only that exam leaves, the lesson stays for the other.
    const partial = await bookSectorExams(input, { db, confirmSchedule: async (_, id) => { if (id === 'e1') throw refusal; } });
    assert.deepEqual(partial.refusedExamIds, ['e1']);
    assert.equal(partial.platformConfirmed, true);
    assert.deepEqual(state.rows, ['e2']);
    assert.equal(state.status, 'scheduled');
    // The last exam refused too: the lesson is cancelled and the administrator is told why.
    await assert.rejects(
        bookSectorExams({ examIds: ['e2'] }, { db, confirmSchedule: async () => { throw refusal; } }),
        (error) => error.code === 'SECTOR_EXAM_NOT_PENDING' && /сектор закрыт/.test(error.message),
    );
    assert.equal(state.status, 'cancelled');
    // An unavailable platform is not a refusal: the booking is kept for a retry.
    state.rows = ['e3']; state.status = 'scheduled';
    const kept = await bookSectorExams({ examIds: ['e3'] }, { db, confirmSchedule: async () => { throw new Error('unavailable'); } });
    assert.equal(kept.platformConfirmed, false);
    assert.equal(state.status, 'scheduled');
});
