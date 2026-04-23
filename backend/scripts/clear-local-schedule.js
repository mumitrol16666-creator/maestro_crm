/**
 * Очистка локальной БД: шаблоны группового расписания (GroupSchedule)
 * и все слоты календаря (Class) с посетителями.
 *
 * Запуск: node scripts/clear-local-schedule.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { prisma } = require('../src/config/db');

async function main() {
    await prisma.$connect();
    const out = await prisma.$transaction(async (tx) => {
        const unlinkedPayments = await tx.payment.updateMany({
            data: { relatedClassId: null },
            where: { relatedClassId: { not: null } },
        });
        const unlinkedMemTx = await tx.membershipTransaction.updateMany({
            data: { classId: null },
            where: { classId: { not: null } },
        });
        const unlinkedSalaryClass = await tx.salaryClass.updateMany({
            data: { classId: null },
            where: { classId: { not: null } },
        });
        // PracticeGroup, ClassAttendee — каскад с Class; предварительно сняты FK с платежей/зарплаты/транзакций
        const deletedClasses = await tx.class.deleteMany({});
        const deletedGroupSchedules = await tx.groupSchedule.deleteMany({});
        return {
            unlinkedPayments: unlinkedPayments.count,
            unlinkedMemTx: unlinkedMemTx.count,
            unlinkedSalaryClass: unlinkedSalaryClass.count,
            deletedClasses: deletedClasses.count,
            deletedGroupSchedules: deletedGroupSchedules.count,
        };
    });
    console.log('Готово:', out);
    await prisma.$disconnect();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
