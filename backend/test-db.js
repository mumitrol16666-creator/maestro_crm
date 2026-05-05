const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const s = await prisma.student.findFirst({
    where: { lastName: 'Дмитриев' },
    include: { memberships: true, payments: true }
  });
  console.log(JSON.stringify(s, null, 2));
}
run();
