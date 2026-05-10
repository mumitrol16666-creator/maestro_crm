require('dotenv').config();
const { prisma } = require('./src/config/db');

async function fix() {
    const groupId = 'cmo2m31ut003ctauye0tjwyr5'; // CHOREO - Утро
    const color = '#e32400';

    console.log(`Updating classes for group ${groupId} to color ${color}...`);
    const { count } = await prisma.class.updateMany({
        where: { groupId: groupId },
        data: { backgroundColor: color }
    });

    console.log(`Updated ${count} classes.`);
    await prisma.$disconnect();
}

fix();
