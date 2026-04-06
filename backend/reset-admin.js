require('dotenv').config();
const { prisma } = require('./src/config/db');
const bcrypt = require('bcryptjs');

async function resetAdmin() {
  const phone = '77777777777';
  const newPassword = 'Admin';
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  
  const user = await prisma.student.upsert({
    where: { phone },
    update: { password: hashedPassword, role: 'super_admin', name: 'Admin' },
    create: {
      phone,
      password: hashedPassword,
      role: 'super_admin',
      name: 'Admin',
      lastName: 'System',
      phoneDigits: '77777777777'
    }
  });
  
  console.log(`✅ User ${phone} password reset to: ${newPassword}`);
}

resetAdmin().catch(console.error).finally(() => prisma.$disconnect());
