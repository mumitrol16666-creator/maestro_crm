const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { computeMembershipPrice } = require('./src/utils/pricing');
const { isStudentActive } = require('./src/utils/pricing'); // wait, isStudentActive is in utils/students.js probably, let's just see

async function test() {
    const student = await prisma.student.findFirst({
        where: { name: { contains: 'авыавыва' } }
    });
    if (!student) return console.log('Student not found');
    
    console.log('Student ID:', student.id);
    console.log('Created At:', student.createdAt);
    
    // Check if active
    const lastPayment = await prisma.payment.findFirst({
        where: { studentId: student.id },
        orderBy: { paymentDate: 'desc' }
    });
    console.log('Last Payment:', lastPayment ? lastPayment.paymentDate : 'None');
    
    // Let's call computeMembershipPrice
    const res = await computeMembershipPrice(null, 'monthly', { previewReferrerId: student.id });
    console.log('Price Preview Result:', res);
}
test().finally(() => prisma.$disconnect());
