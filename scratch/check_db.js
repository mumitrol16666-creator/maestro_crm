const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const usersCount = await prisma.user.count();
    console.log(`Users count: ${usersCount}`);
    
    const tables = await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    console.log('Tables in public schema:', tables);
  } catch (error) {
    console.error('Error connecting to DB:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
