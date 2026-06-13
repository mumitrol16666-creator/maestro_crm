// Создание супер-администратора (PostgreSQL / Prisma)
// Использование: node create-super-admin.js [телефон] [пароль]
// Пример: node create-super-admin.js 77001234567 Admin123

require('dotenv').config();
const { prisma } = require('./src/config/db');
const bcrypt = require('bcryptjs');

const phone = (process.argv[2] || '77001234567').replace(/\D/g, '');
const password = process.argv[3] || 'Admin123';
const displayPhone = phone.startsWith('7') ? `+${phone}` : `+7${phone}`;

async function createSuperAdmin() {
  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await prisma.student.upsert({
    where: { phone: displayPhone },
    update: {
      role: 'super_admin',
      password: hashedPassword,
      name: 'Администратор',
      status: 'active',
    },
    create: {
      name: 'Администратор',
      lastName: 'Maestro',
      phone: displayPhone,
      phoneDigits: phone,
      password: hashedPassword,
      role: 'super_admin',
      gender: 'male',
      status: 'active',
    },
  });

  console.log('✅ Супер-администратор готов');
  console.log(`   Телефон: ${user.phone}`);
  console.log(`   Пароль:  ${password}`);
  console.log('🔐 Смените пароль после первого входа');
}

createSuperAdmin()
  .catch((err) => {
    console.error('❌', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
