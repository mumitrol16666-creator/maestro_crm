require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { prisma } = require('../src/config/db');

async function test() {
    try {
        console.log("Connecting...");
        await prisma.$connect();
        console.log("Fetching directions...");
        const directions = await prisma.direction.findMany({
            include: {
                plans: {
                    orderBy: { order: 'asc' }
                }
            },
            orderBy: [{ order: 'asc' }, { name: 'asc' }]
        });
        console.log("Directions count:", directions.length);
        console.log("First direction:", directions[0]);
    } catch (e) {
        console.error("Test failed:", e);
    } finally {
        await prisma.$disconnect();
    }
}

test();
