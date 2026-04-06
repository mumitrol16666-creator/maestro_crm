require('dotenv').config();
const { prisma } = require('./src/config/db');

async function check() {
  try {
    const count = await prisma.student.count();
    console.log(`Student count: ${count}`);
    const users = await prisma.student.findMany({
      take: 5,
      select: { phone: true, role: true, name: true }
    });
    console.log('Sample users:', users);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
