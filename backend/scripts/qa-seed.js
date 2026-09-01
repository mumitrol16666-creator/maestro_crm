require('dotenv').config();
const bcrypt = require('bcryptjs');
const { prisma } = require('../src/config/db');
const { assertQaEnvironment } = require('../src/services/qaEnvironment');

const QA_PASSWORD = 'QaMaestro2026!';
const APP_IDS = {
    admin: '10000000-0000-4000-8000-000000000001',
    teacher1: '10000000-0000-4000-8000-000000000011',
    teacher2: '10000000-0000-4000-8000-000000000012',
    student1: '10000000-0000-4000-8000-000000000021',
    student2: '10000000-0000-4000-8000-000000000022',
    student3: '10000000-0000-4000-8000-000000000023',
    student4: '10000000-0000-4000-8000-000000000024',
};
const QA = {
    admin: 'QA-ADMIN-1',
    teacher1: 'QA-TEACHER-1',
    teacher2: 'QA-TEACHER-2',
    student1: 'QA-STUDENT-1',
    student2: 'QA-STUDENT-2',
    student3: 'QA-STUDENT-3',
    student4: 'QA-STUDENT-4',
    group1: 'QA-GROUP-1',
    directionGuitar: 'QA-DIRECTION-GUITAR',
    directionVocal: 'QA-DIRECTION-VOCAL',
    room1: 'QA-ROOM-1',
    individualPrevious: 'QA-CLASS-IND-PREVIOUS',
    individualEditable: 'QA-CLASS-IND-EDITABLE',
    individualUpcoming: 'QA-CLASS-IND-UPCOMING',
    individualOnlineUpcoming: 'QA-CLASS-IND-ONLINE-UPCOMING',
    groupPrevious: 'QA-CLASS-GROUP-PREVIOUS',
    groupEditable: 'QA-CLASS-GROUP-EDITABLE',
    groupUpcoming: 'QA-CLASS-GROUP-UPCOMING',
};

function dayOffset(offset) {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    // CRM stores lesson day in DateTime. Noon keeps the calendar date stable
    // when the API serializes it to UTC and the app reads it as a date-only value.
    date.setHours(12, 0, 0, 0);
    return date;
}

async function upsertPerson({ id, appUserId, name, lastName, phone, role, status = 'active', directions = [], assignedTeacherId = null }) {
    const password = await bcrypt.hash(QA_PASSWORD, 10);
    return prisma.student.upsert({
        where: { id },
        update: {
            appUserId,
            name,
            lastName,
            phone,
            phoneDigits: phone.replace(/\D/g, ''),
            email: `${id.toLowerCase()}@qa.maestro.local`,
            password,
            role,
            status,
            learningDirections: role === 'student' ? directions : [],
            teacherDirections: role === 'teacher' ? directions : [],
            externalLinkStatus: 'linked',
            linkedAt: new Date(),
            assignedTeacherId,
        },
        create: {
            id,
            appUserId,
            name,
            lastName,
            phone,
            phoneDigits: phone.replace(/\D/g, ''),
            email: `${id.toLowerCase()}@qa.maestro.local`,
            password,
            role,
            status,
            learningDirections: role === 'student' ? directions : [],
            teacherDirections: role === 'teacher' ? directions : [],
            externalLinkStatus: 'linked',
            linkedAt: new Date(),
            assignedTeacherId,
            registeredAt: dayOffset(-120),
        },
    });
}

async function main() {
    assertQaEnvironment();

    const [admin, teacher1, teacher2, student1, student2, student3, student4] = await Promise.all([
        upsertPerson({ id: QA.admin, appUserId: APP_IDS.admin, name: 'Анна', lastName: 'Администратор', phone: '+77000000001', role: 'admin' }),
        upsertPerson({ id: QA.teacher1, appUserId: APP_IDS.teacher1, name: 'Владислав', lastName: 'Сидоров', phone: '+77000000011', role: 'teacher', directions: ['Гитара'] }),
        upsertPerson({ id: QA.teacher2, appUserId: APP_IDS.teacher2, name: 'Джулия', lastName: 'Иващенко', phone: '+77000000012', role: 'teacher', directions: ['Гитара', 'Вокал'] }),
        upsertPerson({ id: QA.student1, appUserId: APP_IDS.student1, name: 'Камбар', lastName: 'Казыбаев', phone: '+77000000021', role: 'student', directions: ['Гитара'], assignedTeacherId: QA.teacher1 }),
        upsertPerson({ id: QA.student2, appUserId: APP_IDS.student2, name: 'Алина', lastName: 'Серикова', phone: '+77000000022', role: 'student', directions: ['Гитара'] }),
        upsertPerson({ id: QA.student3, appUserId: APP_IDS.student3, name: 'Максим', lastName: 'Ахметов', phone: '+77000000023', role: 'student', directions: ['Гитара'] }),
        upsertPerson({ id: QA.student4, appUserId: APP_IDS.student4, name: 'Архивный', lastName: 'Ученик', phone: '+77000000024', role: 'student', status: 'inactive', directions: ['Вокал'] }),
    ]);

    await prisma.direction.upsert({
        where: { name: 'Гитара' },
        update: { isActive: true },
        create: { id: QA.directionGuitar, name: 'Гитара', description: 'QA направление гитары', minAge: 6, level: 'Любой', pricingTrial: 2000, pricingMonth: 22000, pricingThreeMonths: 55000, createdById: admin.id },
    });
    await prisma.direction.upsert({
        where: { name: 'Вокал' },
        update: { isActive: true },
        create: { id: QA.directionVocal, name: 'Вокал', description: 'QA направление вокала', minAge: 6, level: 'Любой', pricingTrial: 2000, pricingMonth: 22000, pricingThreeMonths: 55000, createdById: admin.id },
    });

    const room = await prisma.room.upsert({
        where: { name: 'QA кабинет' },
        update: { isActive: true, color: '#C9A227' },
        create: { id: QA.room1, name: 'QA кабинет', color: '#C9A227' },
    });
    const group = await prisma.group.upsert({
        where: { id: QA.group1 },
        update: { name: 'QA Ансамбль', direction: 'Гитара', teacherId: teacher1.id, instructor: 'Сидоров Владислав', currentStudents: 3, isActive: true },
        create: { id: QA.group1, name: 'QA Ансамбль', direction: 'Гитара', teacherId: teacher1.id, instructor: 'Сидоров Владислав', currentStudents: 3, maxStudents: 8, isActive: true, color: '#C9A227' },
    });

    for (const student of [student1, student2, student3]) {
        await prisma.studentGroup.upsert({
            where: { studentId_groupId: { studentId: student.id, groupId: group.id } },
            update: { status: 'active' },
            create: { studentId: student.id, groupId: group.id, status: 'active', joinedAt: dayOffset(-90) },
        });
    }

    const memberships = [
        { id: 'QA-MEMBERSHIP-IND-1', studentId: student1.id, groupId: null, teacherId: teacher1.id, lessonFormat: 'individual', type: 'individual_package' },
        { id: 'QA-MEMBERSHIP-GROUP-1', studentId: student1.id, groupId: group.id, teacherId: teacher1.id, lessonFormat: 'group', type: 'monthly' },
        { id: 'QA-MEMBERSHIP-GROUP-2', studentId: student2.id, groupId: group.id, teacherId: teacher1.id, lessonFormat: 'group', type: 'monthly' },
        { id: 'QA-MEMBERSHIP-GROUP-3', studentId: student3.id, groupId: group.id, teacherId: teacher1.id, lessonFormat: 'group', type: 'monthly' },
    ];
    for (const membership of memberships) {
        await prisma.membership.upsert({
            where: { id: membership.id },
            update: { ...membership, status: 'active', classesRemaining: 6, classesUsed: 2, endDate: dayOffset(30) },
            create: {
                ...membership,
                totalClasses: 8,
                classesRemaining: 6,
                classesUsed: 2,
                startDate: dayOffset(-7),
                endDate: dayOffset(30),
                totalPrice: 22000,
                paidAmount: 22000,
                paymentStatus: 'paid',
                createdById: admin.id,
            },
        });
    }

    await prisma.class.deleteMany({
        where: {
            id: {
                in: [
                    QA.individualPrevious,
                    QA.individualEditable,
                    QA.individualUpcoming,
                    QA.individualOnlineUpcoming,
                    QA.groupPrevious,
                    QA.groupEditable,
                    QA.groupUpcoming,
                ],
            },
        },
    });

    const classes = await Promise.all([
        prisma.class.create({
            data: {
                id: QA.individualPrevious,
                teacherId: teacher1.id,
                originalTeacherId: teacher1.id,
                individualStudentId: student1.id,
                roomId: room.id,
                title: 'QA Индивидуальный урок',
                date: dayOffset(-3),
                startTime: '10:00', endTime: '11:00', duration: 60,
                status: 'completed', classType: 'individual',
                topic: 'Переходы между аккордами',
                lessonSummary: 'Ученик держит темп, переходы требуют закрепления.',
                homeworkDraft: 'Играть переходы Am-C-Dm-E под метроном 15 минут.',
                materials: [{ title: 'QA памятка по аккордам', url: '/qa/materials/chords.pdf', type: 'file' }],
                startedAt: dayOffset(-3), finishedAt: dayOffset(-3), submittedAt: dayOffset(-3), reviewedAt: dayOffset(-2),
                submittedById: teacher1.id, reviewedById: admin.id,
            },
        }),
        prisma.class.create({
            data: {
                id: QA.individualUpcoming,
                teacherId: teacher1.id,
                originalTeacherId: teacher1.id,
                individualStudentId: student1.id,
                roomId: room.id,
                title: 'QA Индивидуальный урок',
                date: dayOffset(2),
                startTime: '10:00', endTime: '10:45', duration: 45,
                status: 'scheduled', classType: 'individual',
            },
        }),
        prisma.class.create({
            data: {
                id: QA.individualEditable,
                teacherId: teacher1.id,
                originalTeacherId: teacher1.id,
                individualStudentId: student1.id,
                roomId: room.id,
                title: 'QA Урок для проверки отчёта',
                date: dayOffset(-9),
                startTime: '12:00', endTime: '13:00', duration: 60,
                status: 'completed', classType: 'individual',
                topic: 'Стабильный бой восьмыми',
                lessonSummary: 'Отдельная фикстура для проверки редактирования отчёта.',
                homeworkDraft: 'Подготовить бой восьмыми и показать на следующем уроке.',
                startedAt: dayOffset(-9), finishedAt: dayOffset(-9), submittedAt: dayOffset(-9), reviewedAt: dayOffset(-8),
                submittedById: teacher1.id, reviewedById: admin.id,
            },
        }),
        prisma.class.create({
            data: {
                id: QA.individualOnlineUpcoming,
                teacherId: teacher1.id,
                originalTeacherId: teacher1.id,
                individualStudentId: student1.id,
                roomId: null,
                deliveryFormat: 'online',
                meetingUrl: 'https://meet.example.test/qa-online-guitar',
                title: 'QA Онлайн-урок по гитаре',
                date: dayOffset(3),
                startTime: '16:00', endTime: '17:00', duration: 60,
                status: 'scheduled', classType: 'individual',
            },
        }),
        prisma.class.create({
            data: {
                id: QA.groupPrevious,
                groupId: group.id,
                teacherId: teacher1.id,
                originalTeacherId: teacher1.id,
                roomId: room.id,
                title: 'QA Групповой урок',
                date: dayOffset(-4),
                startTime: '18:00', endTime: '19:30', duration: 90,
                status: 'completed', classType: 'group',
                topic: 'Единый ритм группы',
                lessonSummary: 'Группа сыграла первую часть композиции.',
                homeworkDraft: 'Всем: повторить партию под метроном 80 BPM.',
                startedAt: dayOffset(-4), finishedAt: dayOffset(-4), submittedAt: dayOffset(-4), reviewedAt: dayOffset(-3),
                submittedById: teacher1.id, reviewedById: admin.id,
            },
        }),
        prisma.class.create({
            data: {
                id: QA.groupUpcoming,
                groupId: group.id,
                teacherId: teacher1.id,
                originalTeacherId: teacher1.id,
                roomId: room.id,
                title: 'QA Групповой урок',
                date: dayOffset(1),
                startTime: '18:00', endTime: '19:30', duration: 90,
                status: 'scheduled', classType: 'group',
            },
        }),
        prisma.class.create({
            data: {
                id: QA.groupEditable,
                groupId: group.id,
                teacherId: teacher1.id,
                originalTeacherId: teacher1.id,
                roomId: room.id,
                title: 'QA Групповой отчёт',
                date: dayOffset(-8),
                startTime: '17:00', endTime: '18:30', duration: 90,
                status: 'completed', classType: 'group',
                topic: 'Единый ритм группы',
                lessonSummary: 'Отдельная фикстура для проверки группового отчёта.',
                homeworkDraft: 'Подготовить общую партию под метроном и показать на уроке.',
                startedAt: dayOffset(-8), finishedAt: dayOffset(-8), submittedAt: dayOffset(-8), reviewedAt: dayOffset(-7),
                submittedById: teacher1.id, reviewedById: admin.id,
            },
        }),
    ]);

    await prisma.classAttendee.createMany({
        data: [
            { classId: QA.individualPrevious, studentId: student1.id, attended: true, attendanceStatus: 'present', homeworkStatus: 'partially_completed', homeworkCompletionPercent: 70, markedAt: dayOffset(-3) },
            { classId: QA.individualEditable, studentId: student1.id, attended: true, attendanceStatus: 'present', homeworkStatus: 'partially_completed', homeworkCompletionPercent: 70, markedAt: dayOffset(-9) },
            { classId: QA.individualUpcoming, studentId: student1.id, attendanceStatus: 'unmarked' },
            { classId: QA.individualOnlineUpcoming, studentId: student1.id, attendanceStatus: 'unmarked' },
            { classId: QA.groupPrevious, studentId: student1.id, attended: true, attendanceStatus: 'present', homeworkStatus: 'completed', homeworkCompletionPercent: 100, markedAt: dayOffset(-4) },
            { classId: QA.groupPrevious, studentId: student2.id, attended: true, attendanceStatus: 'present', homeworkStatus: 'partially_completed', homeworkCompletionPercent: 70, markedAt: dayOffset(-4) },
            { classId: QA.groupPrevious, studentId: student3.id, attended: false, attendanceStatus: 'unexcused_absence', homeworkStatus: 'not_completed', homeworkCompletionPercent: 0, markedAt: dayOffset(-4) },
            { classId: QA.groupEditable, studentId: student1.id, attended: true, attendanceStatus: 'present', homeworkStatus: 'completed', homeworkCompletionPercent: 100, markedAt: dayOffset(-8) },
            { classId: QA.groupEditable, studentId: student2.id, attended: true, attendanceStatus: 'present', homeworkStatus: 'partially_completed', homeworkCompletionPercent: 70, markedAt: dayOffset(-8) },
            { classId: QA.groupEditable, studentId: student3.id, attended: false, attendanceStatus: 'unexcused_absence', homeworkStatus: 'not_completed', homeworkCompletionPercent: 0, markedAt: dayOffset(-8) },
            { classId: QA.groupUpcoming, studentId: student1.id, attendanceStatus: 'unmarked' },
            { classId: QA.groupUpcoming, studentId: student2.id, attendanceStatus: 'unmarked' },
            { classId: QA.groupUpcoming, studentId: student3.id, attendanceStatus: 'unmarked' },
        ],
    });

    await prisma.activityLog.create({
        data: {
            userId: admin.id,
            action: 'qa_seed',
            entityType: 'QaFixtureSet',
            entityId: 'QA-SEED-V1',
            details: 'Детерминированный локальный QA-набор создан повторно.',
            metadata: { fixtures: Object.values(QA), classes: classes.map(item => item.id) },
        },
    });

    console.log('QA CRM seed complete.');
    console.table([admin, teacher1, teacher2, student1, student2, student3, student4].map(person => ({ id: person.id, role: person.role, status: person.status })));
    console.log(`Shared password: ${QA_PASSWORD}`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
