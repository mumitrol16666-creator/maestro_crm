require('dotenv').config();
const { prisma } = require('./src/config/db');

async function syncAll() {
    console.log('Fetching all groups...');
    const groups = await prisma.group.findMany();
    
    console.log(`Found ${groups.length} groups. Syncing class colors...`);
    
    for (const group of groups) {
        if (group.color) {
            const { count } = await prisma.class.updateMany({
                where: { groupId: group.id },
                data: { backgroundColor: group.color }
            });
            console.log(`Group: ${group.name} | Color: ${group.color} | Updated Classes: ${count}`);
        }
    }
    
    console.log('\nSync completed.');
    await prisma.$disconnect();
}

syncAll();
