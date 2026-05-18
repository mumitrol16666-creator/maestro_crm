require('dotenv').config({ path: './.env' });
const { prisma } = require('./src/config/db');
const { computeMembershipPrice } = require('./src/utils/pricing');

async function main() {
    try {
        // Create an active student A (the referrer)
        const studentA = await prisma.student.create({
            data: {
                name: 'Referrer A',
                lastName: '',
                password: 'password',
                phone: '12345678901',
                gender: 'male',
                role: 'student'
            }
        });

        // Make A active by giving them a payment
        await prisma.payment.create({
            data: {
                studentId: studentA.id,
                amount: 1000,
                type: 'membership_full',
                status: 'completed',
                paymentDate: new Date()
            }
        });

        // Create an active student B (referred by A)
        const studentB = await prisma.student.create({
            data: {
                name: 'Referred B',
                lastName: '',
                password: 'password',
                phone: '12345678902',
                gender: 'male',
                role: 'student',
                referredByStudentId: studentA.id
            }
        });

        // Make B active by giving them a payment
        await prisma.payment.create({
            data: {
                studentId: studentB.id,
                amount: 1000,
                type: 'membership_full',
                status: 'completed',
                paymentDate: new Date()
            }
        });

        // Test B's price (extending B's membership)
        const pricingB = await computeMembershipPrice(studentB.id, 'monthly');
        console.log('Pricing for B (referred by A):', pricingB);

        // Test A's price (extending A's membership)
        const pricingA = await computeMembershipPrice(studentA.id, 'monthly');
        console.log('Pricing for A (referrer):', pricingA);

        // Cleanup
        await prisma.payment.deleteMany({ where: { studentId: { in: [studentA.id, studentB.id] } } });
        await prisma.student.deleteMany({ where: { id: { in: [studentA.id, studentB.id] } } });
    } catch (err) {
        console.error(err);
    } finally {
        await prisma.$disconnect();
    }
}

main();
