/**
 * Replaces local CRM business data with old CRM exports.
 * Existing admin/super_admin accounts are preserved when present.
 *
 * Usage:
 * node scripts/import-old-crm-customers.js customers.json employees.json groups.json
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { prisma } = require('../src/config/db');
const {
    defaultRange,
    buildRecurringSlots,
    replaceFutureRecurringClasses
} = require('../src/services/regularScheduleAutomation');

const [customersPath, employeesPath, groupsPath] = process.argv.slice(2);
if (!customersPath || !employeesPath || !groupsPath) {
    throw new Error('Укажите JSON-файлы учеников, преподавателей и групп');
}

const readJson = file => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const clean = input => input === null || input === undefined || input === '' ? null : input;
const splitComma = input => String(input || '').split(',').map(value => value.trim()).filter(Boolean);
const normalizeName = input => String(input || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru');

function parseDate(input) {
    if (!input) return null;
    const text = String(input).trim();
    const ruDate = text.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    const parsed = ruDate
        ? new Date(`${ruDate[3]}-${ruDate[2]}-${ruDate[1]}T00:00:00.000Z`)
        : new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function splitName(fullName) {
    const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    return { lastName: parts.shift() || 'Без фамилии', name: parts.join(' ') || 'Без имени' };
}

function splitPhones(input) {
    return String(input || '').split(/[,;\n]+/).map(phone => {
        const digits = phone.replace(/\D/g, '');
        return digits ? { phone: `+${digits}`, phoneDigits: digits } : null;
    }).filter(Boolean);
}

function gender(input) {
    return input === 'Женщина' ? 'female' : input === 'Мужчина' ? 'male' : null;
}

function groupLevel(input) {
    const text = String(input || '').toLocaleLowerCase('ru');
    if (text.includes('4 уровень') || text.includes('12 мес')) return 'advanced';
    if (text.includes('2 уровень') || text.includes('3 уровень') || text.includes('6-12')) return 'intermediate';
    return 'beginner';
}

function buildStudentNotes(row) {
    const fields = [
        ['ID в старой CRM', 'ID'],
        ['Заказчик / родитель', 'Заказчик'],
        ['Источник', 'Источник'],
        ['Предмет', 'Предмет'],
        ['Уровень', 'Уровень'],
        ['Ответственный педагог', 'Отв. педагог'],
        ['Активные абонементы из старой CRM', 'Активные абонементы'],
        ['Общий остаток денег из старой CRM', 'Общий остаток (деньги)'],
        ['Бонусный счёт из старой CRM', 'Бонусный счет'],
        ['Общий остаток уроков из старой CRM', 'Общий остаток (уроки)'],
        ['Дата истечения оплаты из старой CRM', 'Дата истечения оплаты'],
        ['Дата последнего посещения из старой CRM', 'Дата посл. посещения'],
        ['Дата следующего посещения из старой CRM', 'Дата след. посещения'],
        ['Примечание из старой CRM', 'Примечание']
    ];
    return fields
        .filter(([, key]) => clean(row[key]) !== null)
        .map(([label, key]) => `${label}: ${row[key]}`)
        .join('\n');
}

function scheduleRows(groupRow) {
    const dayMap = { 'Пн': 1, 'Вт': 2, 'Ср': 3, 'Чт': 4, 'Пт': 5, 'Сб': 6, 'Вс': 7 };
    const days = splitComma(groupRow['Дни расписания']);
    const starts = splitComma(groupRow['Время начала']);
    const ends = splitComma(groupRow['Время окончания']);
    const rooms = splitComma(groupRow['Аудитории']);

    return days.map((day, index) => {
        const start = starts[index] || starts[0];
        const end = ends[index] || ends[0];
        if (!dayMap[day] || !start) return null;

        let duration = 60;
        if (end) {
            const [sh, sm] = start.split(':').map(Number);
            const [eh, em] = end.split(':').map(Number);
            duration = Math.max(1, (eh * 60 + em) - (sh * 60 + sm));
        }
        return { dayOfWeek: dayMap[day], time: start, duration, roomName: rooms[index] || rooms[0] || null };
    }).filter(Boolean);
}

async function clearBusinessDataPreservingAdmins() {
    const admins = await prisma.student.findMany({
        where: { role: { in: ['admin', 'super_admin'] } },
        select: {
            id: true, name: true, lastName: true, phone: true, phoneDigits: true, email: true,
            password: true, dateOfBirth: true, gender: true, role: true, status: true, notes: true,
            registeredAt: true, offerAccepted: true, offerAcceptedAt: true,
            teacherDirections: true, teacherBio: true, teacherPhoto: true, teacherDisplayOrder: true,
            createdAt: true, updatedAt: true
        }
    });

    const tables = await prisma.$queryRaw`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    if (tables.length) {
        const quoted = tables.map(({ tablename }) => `"${String(tablename).replaceAll('"', '""')}"`).join(', ');
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
    }

    for (const admin of admins) {
        await prisma.student.create({ data: admin });
    }
    return admins.length;
}

async function main() {
    const customers = readJson(customersPath);
    const employees = readJson(employeesPath);
    const groupRows = readJson(groupsPath);
    const preservedAdmins = await clearBusinessDataPreservingAdmins();

    const passwordHash = await bcrypt.hash(`old-crm-import-${Date.now()}`, 10);
    const phoneCounts = new Map();
    customers.forEach(row => splitPhones(row['Телефон']).forEach(phone => {
        phoneCounts.set(phone.phoneDigits, (phoneCounts.get(phone.phoneDigits) || 0) + 1);
    }));

    const teacherByName = new Map();
    for (const row of employees) {
        const fullName = row['ФИО'];
        const { name, lastName } = splitName(fullName);
        const phone = splitPhones(row['Контакты'])[0] || {
            phone: `oldcrm-teacher-${row.ID}`,
            phoneDigits: `oldcrmteacher${row.ID}`
        };
        const directions = [...new Set(customers
            .filter(customer => splitComma(customer['Отв. педагог']).some(item => normalizeName(item) === normalizeName(fullName)))
            .flatMap(customer => splitComma(customer['Предмет'])))];
        const teacher = await prisma.student.create({
            data: {
                name, lastName, phone: phone.phone, phoneDigits: phone.phoneDigits, password: passwordHash,
                dateOfBirth: parseDate(row['Дата рождения']), gender: gender(row['Пол']),
                role: 'teacher', status: 'active', notes: clean(row['Примечание']),
                teacherDirections: directions
            }
        });
        teacherByName.set(normalizeName(fullName), teacher);
    }

    const studentByName = new Map();
    let temporaryPrimaryPhones = 0;
    let additionalPhoneCount = 0;
    for (const row of customers) {
        const phones = splitPhones(row['Телефон']);
        const primary = phones.find(phone => phoneCounts.get(phone.phoneDigits) === 1) || {
            phone: `oldcrm-${row.ID}`,
            phoneDigits: `oldcrm${row.ID}`
        };
        if (primary.phone.startsWith('oldcrm-')) temporaryPrimaryPhones += 1;
        const additionalPhones = phones.filter(phone => phone.phoneDigits !== primary.phoneDigits).map(phone => ({
            ...phone,
            label: phoneCounts.get(phone.phoneDigits) > 1 ? 'Общий семейный номер' : 'Дополнительный'
        }));
        additionalPhoneCount += additionalPhones.length;

        const fullName = row['ФИО'];
        const { name, lastName } = splitName(fullName);
        const teacherName = splitComma(row['Отв. педагог'])[0];
        const assignedTeacher = teacherByName.get(normalizeName(teacherName));
        const student = await prisma.student.create({
            data: {
                name, lastName, phone: primary.phone, phoneDigits: primary.phoneDigits, password: passwordHash,
                dateOfBirth: parseDate(row['Дата рождения']), gender: gender(row['Пол']),
                role: 'student', status: row['Статус обучения'] === 'Активен' ? 'active' : 'inactive',
                oldCrmId: String(row.ID),
                customerName: clean(row['Заказчик']),
                customerType: clean(row['Тип заказчика']),
                acquisitionSource: clean(row['Источник']),
                learningDirections: splitComma(row['Предмет']),
                learningLevel: clean(row['Уровень']),
                notes: buildStudentNotes(row), registeredAt: parseDate(row['Добавлен']) || new Date(),
                assignedTeacherId: assignedTeacher?.id || null,
                additionalPhones: { create: additionalPhones }
            }
        });
        studentByName.set(normalizeName(fullName), student);
    }

    const roomByName = new Map();
    const groupByName = new Map();
    let scheduleCount = 0;
    let classCount = 0;
    let membershipCount = 0;
    const unmatchedTeachers = new Set();

    for (const row of groupRows) {
        const teacherName = clean(row['Отв. педагог']);
        const teacher = teacherByName.get(normalizeName(teacherName));
        if (teacherName && !teacher) unmatchedTeachers.add(teacherName);
        const customersInGroup = splitComma(row['Клиенты']);
        const firstCustomer = studentByName.get(normalizeName(customersInGroup[0]));
        const sourceCustomer = customers.find(customer => normalizeName(customer['ФИО']) === normalizeName(customersInGroup[0]));
        const direction = splitComma(sourceCustomer?.['Предмет'])[0] || 'Не указано';
        const group = await prisma.group.create({
            data: {
                name: row['Название'], direction, level: groupLevel(row['Уровень знаний']),
                instructor: teacherName || 'Не назначен', teacherId: teacher?.id || null,
                maxStudents: Math.max(15, Number(row['Кол-во клиентов']) || 0),
                currentStudents: 0, isActive: row['Статус'] !== 'Архив',
                description: [clean(row['Описание']), teacherName && !teacher ? `Преподаватель из старой CRM: ${teacherName}` : null]
                    .filter(Boolean).join('\n') || null
            }
        });
        groupByName.set(normalizeName(row['Название']), group);

        for (const customerName of customersInGroup) {
            const student = studentByName.get(normalizeName(customerName));
            if (!student) continue;
            await prisma.studentGroup.create({ data: { studentId: student.id, groupId: group.id, status: 'active' } });
            membershipCount += 1;
        }
        await prisma.group.update({ where: { id: group.id }, data: { currentStudents: membershipCount } });
        membershipCount = 0;

        const importedSchedules = [];
        for (const schedule of scheduleRows(row)) {
            let roomId = null;
            if (schedule.roomName) {
                let room = roomByName.get(normalizeName(schedule.roomName));
                if (!room) {
                    room = await prisma.room.create({ data: { name: schedule.roomName } });
                    roomByName.set(normalizeName(schedule.roomName), room);
                }
                roomId = room.id;
            }
            await prisma.groupSchedule.create({
                data: {
                    groupId: group.id, dayOfWeek: schedule.dayOfWeek, time: schedule.time,
                    duration: schedule.duration, roomId
                }
            });
            importedSchedules.push({
                dayOfWeek: schedule.dayOfWeek,
                time: schedule.time,
                duration: schedule.duration,
                roomId,
                teacherId: teacher?.id || null,
                isPractice: false
            });
            scheduleCount += 1;
        }

        if (importedSchedules.length) {
            const { startDate, endDate } = defaultRange();
            const slots = buildRecurringSlots({
                schedules: importedSchedules,
                startDate,
                endDate,
                groupId: group.id,
                defaultTeacherId: teacher?.id || null,
                title: group.name,
                classType: 'group'
            });
            const generation = await replaceFutureRecurringClasses({ slots, groupId: group.id });
            classCount += generation.created;
        }
    }

    console.log(JSON.stringify({
        preservedAdmins,
        students: studentByName.size,
        teachers: teacherByName.size,
        groups: groupByName.size,
        groupSchedules: scheduleCount,
        generatedClasses: classCount,
        rooms: roomByName.size,
        additionalPhones: additionalPhoneCount,
        temporaryPrimaryPhones,
        unmatchedTeachers: [...unmatchedTeachers]
    }, null, 2));
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
