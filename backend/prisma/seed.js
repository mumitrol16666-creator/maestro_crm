require('dotenv').config();
const { prisma } = require('../src/config/db');
const { fakerRU: faker } = require('@faker-js/faker');
const bcrypt = require('bcryptjs');

// const prisma = new PrismaClient();

async function main() {
    console.log('🔄 Starting database seeding...');

    // 1. Clear existing data (optional, but requested for "filling everything")
    // We clear in reverse order of dependencies
    console.log('🗑️ Clearing existing data...');
    await prisma.activityLog.deleteMany();
    await prisma.blogPost.deleteMany();
    await prisma.salaryClassStudent.deleteMany();
    await prisma.salaryClass.deleteMany();
    await prisma.salary.deleteMany();
    await prisma.freeze.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.membershipTransaction.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.classAttendee.deleteMany();
    await prisma.practiceGroup.deleteMany();
    await prisma.class.deleteMany();
    await prisma.groupSchedule.deleteMany();
    await prisma.studentGroup.deleteMany();
    await prisma.group.deleteMany();
    await prisma.room.deleteMany();
    await prisma.booking.deleteMany();
    // Preserving the main super_admin to avoid lockout if running on production (though this is for dev)
    await prisma.student.deleteMany({
        where: {
            role: { not: 'super_admin' }
        }
    });

    const hashedPassword = await bcrypt.hash('test123456', 10);

    // 2. Create Rooms
    console.log('🏠 Creating rooms...');
    const rooms = await Promise.all([
        prisma.room.create({ data: { name: 'Кабинет 1', color: '#C9A227' } }),
        prisma.room.create({ data: { name: 'Кабинет 2', color: '#2C2416' } }),
        prisma.room.create({ data: { name: 'Зал ансамбля', color: '#4d97eb' } }),
        prisma.room.create({ data: { name: 'Индивидуальный кабинет', color: '#8B7355' } }),
    ]);

    // 3. Ensure Directions
    console.log('🎨 Creating directions...');
    const directionNames = [
        'Гитара', 'Электрогитара', 'Басгитара', 'Вокал', 'Фортепиано', 'Укулеле'
    ];
    
    // We use upsert for directions as they might be core config
    const directions = await Promise.all(directionNames.map(name => 
        prisma.direction.upsert({
            where: { name },
            update: {},
            create: {
                name,
                description: `Занятия по направлению «${name}» в музыкальной школе Maestro`,
                minAge: faker.number.int({ min: 6, max: 18 }),
                level: 'Любой',
                pricingTrial: 2000,
                pricingMonth: 22000,
                pricingThreeMonths: 55000,
                order: faker.number.int({ min: 0, max: 10 })
            }
        })
    ));

    // 4. Create Staff
    console.log('👥 Creating staff...');
    
    // Managers
    const managers = await Promise.all(Array.from({ length: 3 }).map((_, i) => 
        prisma.student.create({
            data: {
                name: faker.person.firstName(),
                lastName: faker.person.lastName(),
                phone: `+7701100000${i}`,
                phoneDigits: `7701100000${i}`,
                password: hashedPassword,
                role: 'sales_manager',
                gender: faker.helpers.arrayElement(['male', 'female']),
                status: 'active'
            }
        })
    ));

    // Teachers
    const teachers = await Promise.all(Array.from({ length: 10 }).map((_, i) => 
        prisma.student.create({
            data: {
                name: faker.person.firstName(),
                lastName: faker.person.lastName(),
                phone: `+7701200000${i}`,
                phoneDigits: `7701200000${i}`,
                password: hashedPassword,
                role: 'teacher',
                gender: faker.helpers.arrayElement(['male', 'female']),
                status: 'active',
                teacherDirections: [faker.helpers.arrayElement(directionNames)],
                teacherBio: faker.lorem.paragraph(),
                teacherDisplayOrder: i
            }
        })
    ));

    // 5. Create Students
    console.log('🎓 Creating students...');
    const students = await Promise.all(Array.from({ length: 100 }).map((_, i) => 
        prisma.student.create({
            data: {
                name: faker.person.firstName(),
                lastName: faker.person.lastName(),
                phone: `+7707${faker.string.numeric(7)}`,
                password: hashedPassword,
                role: 'student',
                gender: faker.helpers.arrayElement(['male', 'female']),
                status: 'active',
                registeredAt: faker.date.past({ years: 1 })
            }
        })
    ));

    // 6. Create Groups
    console.log('👯 Creating groups...');
    const groupLevels = ['beginner', 'intermediate', 'advanced'];
    const groups = await Promise.all(Array.from({ length: 20 }).map((_, i) => {
        const direction = faker.helpers.arrayElement(directions);
        const teacher = faker.helpers.arrayElement(teachers);
        return prisma.group.create({
            data: {
                name: `${direction.name} - ${faker.helpers.arrayElement(['Утро', 'День', 'Вечер'])}`,
                direction: direction.name,
                level: faker.helpers.arrayElement(groupLevels),
                instructor: `${teacher.name} ${teacher.lastName}`,
                teacherId: teacher.id,
                maxStudents: 15,
                isActive: true,
                description: `Группа по направлению ${direction.name}`
            }
        });
    }));

    // 7. Create Group Schedules
    console.log('📅 Creating schedules...');
    for (const group of groups) {
        // 2-3 days a week
        const days = faker.helpers.arrayElements([1, 2, 3, 4, 5, 6], faker.number.int({ min: 2, max: 3 }));
        const time = faker.helpers.arrayElement(['10:00', '14:00', '18:00', '19:30', '21:00']);
        const room = faker.helpers.arrayElement(rooms);
        
        for (const day of days) {
            await prisma.groupSchedule.create({
                data: {
                    groupId: group.id,
                    dayOfWeek: day,
                    time,
                    duration: 90,
                    roomId: room.id
                }
            });
        }
    }

    // 8. Assign Students to Groups and Create Memberships
    console.log('📝 Assigning students and creating memberships...');
    for (const student of students) {
        // Assign to 1-2 random groups
        const myGroups = faker.helpers.arrayElements(groups, faker.number.int({ min: 1, max: 2 }));
        
        for (const group of myGroups) {
            await prisma.studentGroup.create({
                data: {
                    studentId: student.id,
                    groupId: group.id,
                    joinedAt: student.registeredAt
                }
            });

            // Create membership
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 14); // 2 weeks ago
            const endDate = new Date(startDate);
            endDate.setMonth(endDate.getMonth() + 1);

            await prisma.membership.create({
                data: {
                    studentId: student.id,
                    groupId: group.id,
                    type: 'monthly',
                    totalClasses: 8,
                    classesRemaining: faker.number.int({ min: 0, max: 8 }),
                    classesUsed: faker.number.int({ min: 0, max: 8 }),
                    startDate,
                    endDate,
                    status: 'active',
                    totalPrice: 22000,
                    paidAmount: 22000,
                    paymentStatus: 'paid',
                    createdById: faker.helpers.arrayElement(managers).id
                }
            });
        }
    }

    // 9. Generate Classes for the month
    console.log('⏰ Generating classes and attendance...');
    const now = new Date();
    const startDate = new Date();
    startDate.setDate(now.getDate() - 14); // 2 weeks back
    const endDate = new Date();
    endDate.setDate(now.getDate() + 14); // 2 weeks forward

    const schedules = await prisma.groupSchedule.findMany({ include: { group: true, room: true } });

    for (const schedule of schedules) {
        let currentDate = new Date(startDate);
        while (currentDate <= endDate) {
            if (currentDate.getDay() === (schedule.dayOfWeek % 7)) {
                const classDate = new Date(currentDate);
                const [hours, minutes] = schedule.time.split(':');
                classDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);

                const isPast = classDate < now;

                const danceClass = await prisma.class.create({
                    data: {
                        groupId: schedule.groupId,
                        teacherId: schedule.group.teacherId,
                        roomId: schedule.roomId,
                        title: `${schedule.group.name} - Занятие`,
                        date: classDate,
                        startTime: schedule.time,
                        endTime: '21:00', // simplified
                        duration: 90,
                        status: isPast ? 'completed' : 'scheduled',
                        backgroundColor: schedule.room?.color || '#eb4d77'
                    }
                });

                if (isPast) {
                    // Add random attendance
                    const studentsInGroup = await prisma.studentGroup.findMany({
                        where: { groupId: schedule.groupId }
                    });
                    
                    for (const { studentId } of studentsInGroup) {
                        if (faker.datatype.boolean(0.8)) { // 80% attendance
                            await prisma.classAttendee.create({
                                data: {
                                    classId: danceClass.id,
                                    studentId: studentId,
                                    attended: true,
                                    markedAt: classDate
                                }
                            });
                        }
                    }
                }
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }

    // 10. Generate Bookings
    console.log('📞 Generating bookings...');
    const bookingStatuses = ['new', 'processed', 'trial', 'sold', 'rejected'];
    for (let i = 0; i < 50; i++) {
        await prisma.booking.create({
            data: {
                name: faker.person.firstName(),
                lastName: faker.person.lastName(),
                phone: `+7777${faker.string.numeric(7)}`,
                direction: faker.helpers.arrayElement(directionNames),
                status: faker.helpers.arrayElement(bookingStatuses),
                notes: faker.lorem.sentence(),
                source: faker.helpers.arrayElement(['Сайт', 'Instagram', 'WhatsApp', 'Звонок']),
                createdAt: faker.date.recent({ days: 30 })
            }
        });
    }

    // 11. Generate Blog Posts
    console.log('📰 Generating blog posts...');
    const superAdmin = await prisma.student.findFirst({ where: { role: 'super_admin' } });
    if (superAdmin) {
        for (let i = 1; i <= 5; i++) {
            const title = faker.lorem.sentence();
            await prisma.blogPost.create({
                data: {
                    title,
                    slug: faker.helpers.slugify(title).toLowerCase() + '-' + i,
                    excerpt: faker.lorem.paragraph(),
                    content: `<p>${faker.lorem.paragraphs(3)}</p>`,
                    category: faker.helpers.arrayElement(['news', 'tips', 'stories', 'events']),
                    authorId: superAdmin.id,
                    status: 'published',
                    publishedAt: new Date()
                }
            });
        }
    }

    console.log('\n✅ Seeding completed successfully!');
    console.log(`📊 Summary:`);
    console.log(`   - Rooms: ${rooms.length}`);
    console.log(`   - Staff: ${managers.length} Managers, ${teachers.length} Teachers`);
    console.log(`   - Students: ${students.length}`);
    console.log(`   - Groups: ${groups.length}`);
}

main()
    .catch((e) => {
        console.error('❌ Seeding error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
