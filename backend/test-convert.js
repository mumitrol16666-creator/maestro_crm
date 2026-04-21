require('dotenv').config();
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    let booking = await prisma.booking.findFirst({ where: { status: "new" } });
    if (!booking) {
        console.log("Создаю временную заявку для теста...");
        booking = await prisma.booking.create({ data: { name: 'TestName', phone: '+799', status: 'new' } });
    }

    const group = await prisma.group.findFirst({ where: { isActive: true } });
    if (!group) return console.log("No active groups to test");

    const manager = await prisma.user.findFirst({ where: { role: 'admin' } });
    
    // Simulate booking route
    const req = {
        params: { id: booking.id },
        user: { id: manager.id },
        body: {
            gender: "male",
            groupId: group.id,
            membershipType: "monthly",
            totalPrice: 22000,
            paymentType: "later",
            advanceDueDate: "2026-05-01" // This is what frontend sends
        }
    };

        const { gender, groupId, membershipType, totalPrice, paymentType, advanceAmount, advanceDueDate } = req.body;
        console.log("Validating gender, groupId, membershipType:", !!gender, !!groupId, !!membershipType);

        const groupDb = await prisma.group.findUnique({ where: { id: groupId } });
        console.log("Group DB found:", !!groupDb);

        const hashedPassword = 'dummy_hash';

        let totalClasses, daysToAdd;
        switch (membershipType) {
            case 'monthly': totalClasses = 8; daysToAdd = 30; break;
            default: totalClasses = 1; daysToAdd = 30;
        }

        let startDate = new Date();
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + daysToAdd);
        const price = totalPrice || 0;
        const freezesAvailable = 1;

        console.log("Ready to start transaction for booking", booking.id);

        const result = await prisma.$transaction(async (tx) => {
            console.log("tx.student.create...");
            const student = await tx.student.create({
                data: { name: booking.name, lastName: booking.lastName, phone: booking.phone, password: hashedPassword, gender: 'male', role: 'student' }
            });

            console.log("tx.studentGroup.create...");
            await tx.studentGroup.create({ data: { studentId: student.id, groupId: groupDb.id, status: 'active' } });

            console.log("tx.membership.create...");
            const membership = await tx.membership.create({
                data: {
                    studentId: student.id, groupId: groupDb.id, type: membershipType, totalClasses, classesRemaining: totalClasses,
                    startDate, endDate, freezesAvailable, createdById: req.user.id, bookingId: booking.id, source: 'booking',
                    totalPrice: price, paidAmount: 0, remainingAmount: price, paymentStatus: 'not_paid'
                }
            });

            let payment = null;
            const hasPayment = paymentType && paymentType !== 'later' && price > 0;
            const hasDueDateForLater = paymentType === 'later' && (advanceDueDate || price > 0);

            console.log("Payment flags:", { hasPayment, hasDueDateForLater });

            if (hasPayment || hasDueDateForLater) {
                let pType = 'membership_advance';
                const payAmount = paymentType === 'later' ? 0 : price;

                const paymentData = {
                    studentId: student.id, managerId: req.user.id, amount: payAmount, type: pType,
                    membershipId: membership.id, bookingId: booking.id, status: 'completed', commissionStatus: 'pending',
                    isFirstMembershipForManager: true,
                    notes: `Конвертация из заявки`
                };

                if (advanceDueDate) {
                    paymentData.dueDate = new Date(advanceDueDate);
                }

                console.log("tx.payment.create with data:", paymentData);
                payment = await tx.payment.create({ data: paymentData });

                console.log("tx.membership.update...");
                const paidAmt = payAmount;
                await tx.membership.update({
                    where: { id: membership.id },
                    data: { paidAmount: paidAmt, remainingAmount: price - paidAmt, paymentStatus: paidAmt >= price ? 'paid' : (paidAmt > 0 ? 'partial' : 'not_paid') }
                });
            }

            console.log("tx.student.update...");
            await tx.student.update({ where: { id: student.id }, data: { activeMembershipId: membership.id } });
            
            console.log("tx.group.update...");
            await tx.group.update({ where: { id: groupDb.id }, data: { currentStudents: { increment: 1 } } });
            
            console.log("tx.booking.update...");
            await tx.booking.update({
                where: { id: booking.id },
                data: { convertedToStudentId: student.id, groupId: groupDb.id, status: 'sold', processedAt: new Date(), processedById: req.user.id }
            });

            return { student, membership, payment };
        });

        console.log("Success! Transaction finished.");

  } catch(e) {
    console.error("RUNTIME ERROR:", e);
  } finally {
    await prisma.$disconnect();
    pool.end();
  }
}
run();
