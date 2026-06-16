require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { prisma } = require('../src/config/db');

async function check() {
    try {
        await prisma.$connect();
        const testUser = await prisma.student.findFirst();
        if (!testUser) {
            console.log("No users found in database!");
            return;
        }
        console.log("Creating test ActivityLog with userId:", testUser.id);
        const log = await prisma.activityLog.create({
            data: {
                userId: testUser.id,
                action: 'test',
                entityType: 'Test',
                entityId: 'test-id',
                details: 'This is a test log entry'
            }
        });
        console.log("Created log successfully:", log);
        const count = await prisma.activityLog.count();
        console.log("Total activity logs in database:", count);
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

check();
