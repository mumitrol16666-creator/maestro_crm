require('dotenv').config();
const { prisma } = require('../src/config/db');

const applyChanges = process.argv.includes('--apply');

async function main() {
    const correctionRefs = await prisma.cashTransaction.findMany({
        where: {
            category: 'correction',
            relatedPaymentId: { not: null },
        },
        distinct: ['relatedPaymentId'],
        select: { relatedPaymentId: true },
    });

    let inspected = 0;
    let planned = 0;
    let updated = 0;
    let missingPayment = 0;
    let missingCashTransaction = 0;

    for (const ref of correctionRefs) {
        const paymentId = ref.relatedPaymentId;
        if (!paymentId) continue;
        inspected++;

        const payment = await prisma.payment.findUnique({
            where: { id: paymentId },
            select: { id: true, amount: true, paymentDate: true },
        });
        if (!payment) {
            missingPayment++;
            continue;
        }

        const paymentTransactions = await prisma.cashTransaction.findMany({
            where: { relatedPaymentId: paymentId, category: 'payment' },
            select: { id: true, amount: true, date: true },
        });
        if (!paymentTransactions.length) {
            missingCashTransaction++;
            continue;
        }

        for (const transaction of paymentTransactions) {
            const needsAmountSync = transaction.amount !== payment.amount;
            const needsDateSync = new Date(transaction.date).getTime() !== new Date(payment.paymentDate).getTime();
            if (!needsAmountSync && !needsDateSync) continue;

            planned++;
            console.log(
                `${applyChanges ? 'UPDATE' : 'DRY-RUN'} payment=${payment.id} cashTx=${transaction.id}: ` +
                `${transaction.amount} -> ${payment.amount}`,
            );

            if (applyChanges) {
                await prisma.cashTransaction.update({
                    where: { id: transaction.id },
                    data: {
                        amount: payment.amount,
                        date: payment.paymentDate,
                    },
                });
                updated++;
            }
        }
    }

    console.log(JSON.stringify({
        mode: applyChanges ? 'apply' : 'dry-run',
        inspectedPayments: inspected,
        plannedUpdates: planned,
        updated,
        missingPayment,
        missingCashTransaction,
    }, null, 2));
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
