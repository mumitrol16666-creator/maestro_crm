// Изменение роли пользователя (PostgreSQL / Prisma)
// Использование: node make-admin.js [телефон] [роль]
// Пример: node make-admin.js 77001234567 super_admin

require('dotenv').config();
const { prisma } = require('./src/config/db');

const phoneArg = process.argv[2];
const role = process.argv[3] || 'super_admin';

const VALID_ROLES = ['student', 'sales_manager', 'teacher', 'admin', 'super_admin'];

function normalizePhone(input) {
  const digits = input.replace(/\D/g, '');
  if (!digits) return null;
  const normalized = digits.startsWith('7') ? digits : `7${digits}`;
  return `+${normalized}`;
}

async function changeRole() {
  if (!phoneArg) {
    console.error('❌ Укажите телефон: node make-admin.js 77001234567 super_admin');
    process.exit(1);
  }

  if (!VALID_ROLES.includes(role)) {
    console.error(`❌ Недопустимая роль. Доступно: ${VALID_ROLES.join(', ')}`);
    process.exit(1);
  }

  const phone = normalizePhone(phoneArg);
  const user = await prisma.student.findFirst({
    where: {
      OR: [{ phone }, { phoneDigits: phone.replace(/\D/g, '') }],
    },
  });

  if (!user) {
    console.error(`❌ Пользователь с телефоном ${phone} не найден`);
    process.exit(1);
  }

  await prisma.student.update({
    where: { id: user.id },
    data: { role },
  });

  console.log(`✅ ${user.name} (${user.phone}) → роль "${role}"`);
}

changeRole()
  .catch((err) => {
    console.error('❌', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
