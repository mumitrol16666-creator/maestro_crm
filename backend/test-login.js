require('dotenv').config();
const { prisma } = require('./src/config/db');
const bcrypt = require('bcryptjs');

async function testLogin() {
  const phone = '77777777777';
  const password = '123456'; // Default from create-super-admin.js
  
  const user = await prisma.student.findUnique({ where: { phone } });
  if (!user) {
    console.log('User not found');
    return;
  }
  
  const matches = await bcrypt.compare(password, user.password);
  console.log(`Login ${phone} with password ${password}: ${matches ? 'Success' : 'Failed'}`);
  console.log('User structure:', user);
}

testLogin().catch(console.error).finally(() => prisma.$disconnect());
