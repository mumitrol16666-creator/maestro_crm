require('dotenv').config();
const { prisma } = require('./src/config/db');

async function check() {
    const classes = await prisma.class.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { group: true, room: true }
    });

    console.log('--- Last 10 Classes ---');
    classes.forEach(c => {
        console.log(`Class: ${c.title}`);
        console.log(`  Group: ${c.group?.name} (${c.groupId})`);
        console.log(`  Color (Class): ${c.backgroundColor}`);
        console.log(`  Color (Group): ${c.group?.color}`);
        console.log(`  Color (Room): ${c.room?.color}`);
        console.log('---');
    });

    const groups = await prisma.group.findMany();
    console.log('\n--- All Groups ---');
    groups.forEach(g => {
        console.log(`Group: ${g.name} (${g.id}) | Color: ${g.color}`);
    });

    await prisma.$disconnect();
}

check();
