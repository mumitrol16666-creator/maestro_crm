// ОТКАТ: Восстановление абонементов, у которых НЕТ платежей, к оригинальным значениям
// + Фикс абонементов, у которых ЕСТЬ платежи, по фактическим суммам
require('dotenv').config();
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    const memberships = await prisma.membership.findMany({
        where: { status: 'active' },
        include: { payments: true }
    });

    let fixedWithPayments = 0;
    let restoredWithoutPayments = 0;

    for (const m of memberships) {
        const completedPayments = m.payments.filter(p => p.status === 'completed');

        if (completedPayments.length === 0) {
            // Нет платежей — у этих абонементов оригинальные данные были правильные
            // Они из миграции с MongoDB, totalPrice = paidAmount (были оплачены)
            // Восстанавливаем: если totalPrice > 0 и сейчас remaining = totalPrice, значит мы сломали
            if (m.remainingAmount === m.totalPrice && m.totalPrice > 0) {
                console.log(`🔄 Восстанавливаю ${m.id} (${m.type}): totalPrice=${m.totalPrice} → paid=${m.totalPrice}, remaining=0, status=paid`);
                await prisma.membership.update({
                    where: { id: m.id },
                    data: {
                        paidAmount: m.totalPrice,
                        remainingAmount: 0,
                        paymentStatus: 'paid'
                    }
                });
                restoredWithoutPayments++;
            }
        } else {
            // Есть платежи — считаем по факту
            const actualPaid = completedPayments.reduce((sum, p) => sum + p.amount, 0);
            const actualRemaining = Math.max(0, m.totalPrice - actualPaid);
            let correctStatus = 'not_paid';
            if (actualRemaining <= 0) correctStatus = 'paid';
            else if (actualPaid > 0) correctStatus = 'partial';

            if (m.paidAmount !== actualPaid || m.remainingAmount !== actualRemaining || m.paymentStatus !== correctStatus) {
                console.log(`✅ Фикс по платежам ${m.id} (${m.type}): paid=${m.paidAmount}→${actualPaid}, remaining=${m.remainingAmount}→${actualRemaining}, status=${m.paymentStatus}→${correctStatus}`);
                await prisma.membership.update({
                    where: { id: m.id },
                    data: {
                        paidAmount: actualPaid,
                        remainingAmount: actualRemaining,
                        paymentStatus: correctStatus
                    }
                });
                fixedWithPayments++;
            }
        }
    }

    console.log(`\nИтого: проверено ${memberships.length}`);
    console.log(`  Восстановлено (без платежей, из миграции): ${restoredWithoutPayments}`);
    console.log(`  Исправлено (по фактическим платежам): ${fixedWithPayments}`);
}

main().catch(console.error).finally(() => { prisma.$disconnect(); pool.end(); });
