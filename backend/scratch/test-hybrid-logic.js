require('dotenv').config();
const { prisma } = require('../src/config/db');
const { deductMembershipForClass, findMembershipForClass } = require('../src/services/classMembership');

async function test() {
    console.log('🧪 Starting Hybrid Logic Verification Test...');
    await prisma.$connect();

    // 1. Find a test student
    const student = await prisma.student.findFirst({ where: { role: 'student' } });
    if (!student) {
        console.error('❌ No student found! Please run the database seed first.');
        process.exit(1);
    }
    console.log(`👤 Using test student: ${student.name} ${student.lastName} (ID: ${student.id})`);

    // Clear any active memberships for this student to isolate our test
    await prisma.membership.updateMany({
        where: { studentId: student.id },
        data: { status: 'expired' }
    });

    // 2. Create a hybrid_2m membership
    console.log('💳 Creating a Hybrid 2-Month Membership...');
    const mPlan = await prisma.membershipPlan.findFirst({ where: { legacyType: 'hybrid_2m' } });
    if (!mPlan) {
        console.error('❌ Hybrid 2M Plan not found in database! Make sure plans are synced.');
        process.exit(1);
    }

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(startDate.getDate() + 60);

    const membership = await prisma.membership.create({
        data: {
            studentId: student.id,
            planId: mPlan.id,
            type: 'hybrid_2m',
            totalClasses: 20,
            classesRemaining: 20,
            startDate,
            endDate,
            status: 'active',
            individualClassesRemaining: 8,
            groupClassesRemaining: 8,
            theoryClassesRemaining: 4,
            emergencyFreezesAvailable: 2,
            emergencyFreezesUsed: 0,
            totalPrice: 50000,
            paidAmount: 50000,
            paymentStatus: 'paid'
        }
    });

    console.log('✅ Membership created:');
    console.log(`   - Classes: ${membership.classesRemaining}/${membership.totalClasses}`);
    console.log(`   - Individual: ${membership.individualClassesRemaining}`);
    console.log(`   - Group: ${membership.groupClassesRemaining}`);
    console.log(`   - Theory: ${membership.theoryClassesRemaining}`);
    console.log(`   - Emergency Freezes: ${membership.emergencyFreezesAvailable}`);

    // Create a group
    const group = await prisma.group.findFirst({ where: { isActive: true } });
    const teacher = await prisma.student.findFirst({ where: { role: 'teacher' } });
    const room = await prisma.room.findFirst();

    // Helper to simulate postpone logic
    async function simulatePostpone(classRecord, minutesDiff) {
        console.log(`\n⏳ Simulating postpone for class starting in ${minutesDiff} mins...`);
        const now = new Date();
        const isSameDay = new Date(classRecord.date).toDateString() === now.toDateString();

        if (isSameDay) {
            let attendee = await prisma.classAttendee.findFirst({
                where: { classId: classRecord.id, studentId: student.id }
            });

            if (minutesDiff < 30) {
                // Emergency cancellation
                const m = await findMembershipForClass(student.id, classRecord);
                if (m && m.emergencyFreezesAvailable !== null && m.emergencyFreezesAvailable > 0) {
                    console.log('👉 Freeze available! Consuming 1 emergency freeze...');
                    await prisma.membership.update({
                        where: { id: m.id },
                        data: {
                            emergencyFreezesAvailable: { decrement: 1 },
                            emergencyFreezesUsed: { increment: 1 }
                        }
                    });
                    if (!attendee) {
                        await prisma.classAttendee.create({
                            data: { classId: classRecord.id, studentId: student.id, attended: false, attendanceStatus: 'excused_absence', autoDeducted: false }
                        });
                    }
                    console.log('❄️ Emergency freeze consumed successfully.');
                } else {
                    console.log('👉 No freezes left! Deducting from membership...');
                    const res = await deductMembershipForClass(student.id, classRecord, 'test');
                    if (!attendee) {
                        await prisma.classAttendee.create({
                            data: { classId: classRecord.id, studentId: student.id, attended: false, attendanceStatus: 'unexcused_absence', autoDeducted: res.deducted }
                        });
                    }
                    console.log(`💸 Class deducted: ${res.deducted}`);
                }
            } else {
                // Regular same-day cancellation (>30 min)
                console.log('👉 Same-day cancel (>30 mins). Deducting from membership...');
                const res = await deductMembershipForClass(student.id, classRecord, 'test');
                if (!attendee) {
                    await prisma.classAttendee.create({
                        data: { classId: classRecord.id, studentId: student.id, attended: false, attendanceStatus: 'unexcused_absence', autoDeducted: res.deducted }
                    });
                }
                console.log(`💸 Class deducted: ${res.deducted}`);
            }
        }
    }

    // Test Case 1: Same day emergency cancel 1 (<30 mins) -> Should use freeze 1
    const class1 = await prisma.class.create({
        data: {
            groupId: group.id,
            teacherId: teacher.id,
            roomId: room.id,
            title: 'Test Group Lesson 1',
            date: new Date(),
            startTime: '18:00',
            endTime: '19:30',
            duration: 90,
            status: 'scheduled'
        }
    });

    await simulatePostpone(class1, 15); // 15 mins before start

    let updatedM = await prisma.membership.findUnique({ where: { id: membership.id } });
    console.log(`📊 Current State:`);
    console.log(`   - Group Classes Left: ${updatedM.groupClassesRemaining} (Expected: 8)`);
    console.log(`   - Freezes Left: ${updatedM.emergencyFreezesAvailable} (Expected: 1)`);
    console.log(`   - Freezes Used: ${updatedM.emergencyFreezesUsed} (Expected: 1)`);

    if (updatedM.groupClassesRemaining === 8 && updatedM.emergencyFreezesAvailable === 1) {
        console.log('✅ Test Case 1 Passed!');
    } else {
        console.error('❌ Test Case 1 Failed!');
    }

    // Test Case 2: Same day emergency cancel 2 (<30 mins) -> Should use freeze 2
    const class2 = await prisma.class.create({
        data: {
            groupId: group.id,
            teacherId: teacher.id,
            roomId: room.id,
            title: 'Test Group Lesson 2',
            date: new Date(),
            startTime: '18:00',
            endTime: '19:30',
            duration: 90,
            status: 'scheduled'
        }
    });

    await simulatePostpone(class2, 10); // 10 mins before start

    updatedM = await prisma.membership.findUnique({ where: { id: membership.id } });
    console.log(`\n📊 Current State:`);
    console.log(`   - Group Classes Left: ${updatedM.groupClassesRemaining} (Expected: 8)`);
    console.log(`   - Freezes Left: ${updatedM.emergencyFreezesAvailable} (Expected: 0)`);
    console.log(`   - Freezes Used: ${updatedM.emergencyFreezesUsed} (Expected: 2)`);

    if (updatedM.groupClassesRemaining === 8 && updatedM.emergencyFreezesAvailable === 0) {
        console.log('✅ Test Case 2 Passed!');
    } else {
        console.error('❌ Test Case 2 Failed!');
    }

    // Test Case 3: Same day emergency cancel 3 (<30 mins) -> Freezes exhausted -> Should deduct 1 group class
    const class3 = await prisma.class.create({
        data: {
            groupId: group.id,
            teacherId: teacher.id,
            roomId: room.id,
            title: 'Test Group Lesson 3',
            date: new Date(),
            startTime: '18:00',
            endTime: '19:30',
            duration: 90,
            status: 'scheduled'
        }
    });

    await simulatePostpone(class3, 5); // 5 mins before start

    updatedM = await prisma.membership.findUnique({ where: { id: membership.id } });
    console.log(`\n📊 Current State:`);
    console.log(`   - Group Classes Left: ${updatedM.groupClassesRemaining} (Expected: 7)`);
    console.log(`   - Freezes Left: ${updatedM.emergencyFreezesAvailable} (Expected: 0)`);

    if (updatedM.groupClassesRemaining === 7 && updatedM.emergencyFreezesAvailable === 0) {
        console.log('✅ Test Case 3 Passed!');
    } else {
        console.error('❌ Test Case 3 Failed!');
    }

    // Clean up created classes
    await prisma.classAttendee.deleteMany({ where: { classId: { in: [class1.id, class2.id, class3.id] } } });
    await prisma.class.deleteMany({ where: { id: { in: [class1.id, class2.id, class3.id] } } });
    await prisma.membership.delete({ where: { id: membership.id } });

    console.log('\n🏁 Hybrid logic verification tests completed!');
    await prisma.$disconnect();
}

test().catch(async (e) => {
    console.error('Test script crashed:', e);
    await prisma.$disconnect();
});
