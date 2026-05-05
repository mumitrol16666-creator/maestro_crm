require('dotenv').config();
const { prisma, connectDB } = require('./src/config/db');

async function main() {
  try {
    console.log('Testing connection...');
    await connectDB();
    
    console.log('Fetching students count...');
    const studentsCount = await prisma.student.count();
    console.log(`Students count: ${studentsCount}`);
    
    console.log('Fetching tables...');
    const tables = await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    console.log('Tables in public schema:', tables.map(t => t.table_name).join(', '));
  } catch (error) {
    console.error('Error during DB check:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
