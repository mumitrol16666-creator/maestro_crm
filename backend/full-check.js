require('dotenv').config();
const { prisma } = require('./src/config/db');

async function check() {
  try {
    const studentCount = await prisma.student.count();
    const groupCount = await prisma.group.count();
    const classCount = await prisma.class.count();
    const directionCount = await prisma.direction.count();
    const rolePermissionsCount = await prisma.rolePermissions.count();

    console.log({
      studentCount,
      groupCount,
      classCount,
      directionCount,
      rolePermissionsCount
    });

  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
