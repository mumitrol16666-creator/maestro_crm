require('dotenv').config();
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    const phone = "+77779202506";
    const student = await prisma.student.findFirst({
        where: { phone },
        include: {
            memberships: {
                orderBy: { createdAt: 'desc' }
            },
            payments: {
                orderBy: { paymentDate: 'desc' }
            }
        }
    });

    if (!student) {
        console.log("Student not found");
        return;
    }

    console.log("=== STUDENT INFO ===");
    console.log(`ID: ${student.id}`);
    console.log(`Name: ${student.name} ${student.lastName || ''}`);
    console.log(`Registration: ${student.createdAt}`);

    console.log("\n=== MEMBERSHIPS ===");
    student.memberships.forEach((m, i) => {
        console.log(`[${i+1}] ID: ${m.id}`);
        console.log(`    Type: ${m.type}, Status: ${m.status}`);
        console.log(`    Total Price: ${m.totalPrice}, Paid: ${m.paidAmount}, Remaining: ${m.remainingAmount}`);
        console.log(`    Payment Status: ${m.paymentStatus}`);
    });

    console.log("\n=== PAYMENTS ===");
    student.payments.forEach((p, i) => {
        console.log(`[${i+1}] ID: ${p.id}, Amount: ${p.amount}, Type: ${p.type}, Status: ${p.status}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(() => {
        prisma.$disconnect();
        pool.end();
    });
