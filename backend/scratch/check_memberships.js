require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { prisma } = require('../src/config/db');

async function check() {
    try {
        await prisma.$connect();
        console.log("Fetching memberships with followUp info...");
        const memberships = await prisma.membership.findMany({
            where: {
                status: 'active',
                OR: [
                    { remainingAmount: { gt: 0 } },
                    { classesRemaining: { lte: 2 } }
                ]
            },
            include: {
                student: true
            }
        });
        console.log("Found active memberships matching criteria:", memberships.length);
        for (const m of memberships) {
            console.log(`Student: ${m.student.name} ${m.student.lastName}`);
            console.log(`  ID: ${m.id}`);
            console.log(`  followUpStatus: ${m.followUpStatus}`);
            console.log(`  followUpNote: ${m.followUpNote}`);
            console.log(`  followUpAt: ${m.followUpAt}`);
            console.log(`  paymentPromiseDate: ${m.paymentPromiseDate}`);
            console.log(`  remainingAmount: ${m.remainingAmount}`);
            console.log(`  classesRemaining: ${m.classesRemaining}`);
        }
    } catch (e) {
        console.error("Failed to query DB:", e);
    } finally {
        await prisma.$disconnect();
    }
}

check();
