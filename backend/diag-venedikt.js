// Диагностика данных Венедикта — через тот же адаптер, что и сервер
require('dotenv').config();
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    const student = await prisma.student.findFirst({
        where: { phone: '+77779202506' },
        include: {
            memberships: {
                include: { payments: true }
            },
            payments: true
        }
    });

    if (!student) {
        console.log('Студент с телефоном +77779202506 не найден');
        return;
    }

    console.log('=== СТУДЕНТ ===');
    console.log(`ID: ${student.id}`);
    console.log(`Имя: ${student.name} ${student.lastName}`);
    console.log(`activeMembershipId: ${student.activeMembershipId}`);
    console.log('');

    console.log('=== АБОНЕМЕНТЫ ===');
    for (const m of student.memberships) {
        console.log(`  ID: ${m.id}`);
        console.log(`  Тип: ${m.type}, Статус: ${m.status}`);
        console.log(`  totalPrice: ${m.totalPrice}`);
        console.log(`  paidAmount: ${m.paidAmount}`);
        console.log(`  remainingAmount: ${m.remainingAmount}`);
        console.log(`  paymentStatus: ${m.paymentStatus}`);
        console.log(`  Платежей к абонементу: ${m.payments.length}`);
        for (const p of m.payments) {
            console.log(`    - amount: ${p.amount}, type: ${p.type}, status: ${p.status}, dueDate: ${p.dueDate}, notes: ${p.notes}`);
        }
        console.log('');
    }

    console.log('=== ВСЕ ПЛАТЕЖИ СТУДЕНТА ===');
    for (const p of student.payments) {
        console.log(`  amount: ${p.amount}, type: ${p.type}, status: ${p.status}, membershipId: ${p.membershipId}, dueDate: ${p.dueDate}`);
    }

    // Подсчёт как в API payments
    const totalPaid = student.payments
        .filter(p => p.status === 'completed')
        .reduce((sum, p) => sum + p.amount, 0);

    const activeMemberships = student.memberships.filter(m =>
        m.status === 'active' && ['not_paid', 'partial'].includes(m.paymentStatus)
    );
    const totalRemaining = activeMemberships.reduce((sum, m) => sum + (m.remainingAmount || 0), 0);

    console.log('');
    console.log('=== РАСЧЁТ (как в API) ===');
    console.log(`totalPaid (сумма completed платежей): ${totalPaid}`);
    console.log(`totalRemaining (remainingAmount активных неоплаченных): ${totalRemaining}`);
    console.log(`Баланс: ${totalPaid - totalRemaining}`);
    console.log('');

    // Правильный расчёт — на основе фактических платежей
    for (const m of student.memberships.filter(m => m.status === 'active')) {
        const membershipPayments = m.payments.filter(p => p.status === 'completed');
        const actualPaid = membershipPayments.reduce((sum, p) => sum + p.amount, 0);
        const actualRemaining = m.totalPrice - actualPaid;
        console.log(`  Абонемент ${m.type}: totalPrice=${m.totalPrice}, фактически оплачено=${actualPaid}, фактический остаток=${actualRemaining}`);
        console.log(`    -> В БД: paidAmount=${m.paidAmount}, remainingAmount=${m.remainingAmount}, paymentStatus=${m.paymentStatus}`);
        if (m.paidAmount !== actualPaid || m.remainingAmount !== actualRemaining) {
            console.log(`    ❌ РАССИНХРОН! Нужно: paidAmount=${actualPaid}, remainingAmount=${actualRemaining}`);
        } else {
            console.log(`    ✅ Данные синхронны`);
        }
    }
}

main().catch(console.error).finally(() => { prisma.$disconnect(); pool.end(); });
