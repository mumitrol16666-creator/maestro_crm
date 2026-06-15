require('dotenv').config();
const { prisma } = require('../src/config/db');

async function main() {
    const students = await prisma.student.findMany({
        where: { role: 'student', accountBalanceInitializedAt: null },
        select: { id: true }
    });

    for (const student of students) {
        const [payments, charges] = await Promise.all([
            prisma.payment.aggregate({
                where: { studentId: student.id, status: 'completed' },
                _sum: { amount: true }
            }),
            prisma.classAttendee.aggregate({
                where: { studentId: student.id },
                _sum: { chargeAmount: true }
            })
        ]);

        const balance = (payments._sum.amount || 0) - (charges._sum.chargeAmount || 0);
        await prisma.student.update({
            where: { id: student.id },
            data: {
                accountBalance: balance,
                accountBalanceInitializedAt: new Date()
            }
        });
    }

    console.log(`Initialized independent balances for ${students.length} students`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
