const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();
const secret = process.env.JWT_SECRET || 'secret';

async function run() {
  const admin = await prisma.student.findFirst({ where: { role: 'super_admin' } });
  if (!admin) return console.log('No admin');
  
  const token = jwt.sign({ id: admin.id, role: admin.role }, secret);
  console.log(token);
}
run();
