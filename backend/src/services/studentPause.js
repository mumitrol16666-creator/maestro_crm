const { prisma } = require('../config/db');

/**
 * Возвращает в активные временно приостановленных учеников, чей срок уже
 * закончился. Бессрочные паузы (pausedUntil = null) сюда не попадают.
 */
async function restoreExpiredStudentPauses() {
    const now = new Date();
    const students = await prisma.student.findMany({
        where: {
            role: 'student',
            status: 'inactive',
            lostAt: null,
            pausedUntil: { lte: now },
        },
        select: { id: true },
    });

    let restored = 0;
    for (const student of students) {
        await prisma.$transaction(async tx => {
            const current = await tx.student.findFirst({
                where: {
                    id: student.id,
                    role: 'student',
                    status: 'inactive',
                    lostAt: null,
                    pausedUntil: { lte: now },
                },
                select: { id: true },
            });
            if (!current) return;

            const frozenGroups = await tx.studentGroup.findMany({
                where: { studentId: student.id, status: 'frozen' },
                select: { groupId: true },
            });
            const groupIds = [...new Set(frozenGroups.map(item => item.groupId).filter(Boolean))];
            await tx.studentGroup.updateMany({
                where: { studentId: student.id, status: 'frozen' },
                data: { status: 'active' },
            });
            for (const groupId of groupIds) {
                const currentStudents = await tx.studentGroup.count({ where: { groupId, status: 'active' } });
                await tx.group.update({ where: { id: groupId }, data: { currentStudents } });
            }
            await tx.student.update({
                where: { id: student.id },
                data: { status: 'active', pausedUntil: null },
            });
            restored += 1;
        });
    }

    return { restored };
}

module.exports = { restoreExpiredStudentPauses };
