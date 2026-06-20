const { prisma } = require('../config/db');

const TEACHER_COLORS = [
    '#C58A45',
    '#3F8C78',
    '#5576B8',
    '#A15E78',
    '#7C6DB2',
    '#B5654A',
    '#4F8FA8',
    '#6F8D4E',
    '#9A6B3F',
    '#5F7C8A',
    '#8C5D9A',
    '#B07A59',
];

function hashString(value = '') {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) - hash) + value.charCodeAt(index);
        hash |= 0;
    }
    return Math.abs(hash);
}

function teacherColorForKey(value) {
    return TEACHER_COLORS[hashString(String(value || 'teacher')) % TEACHER_COLORS.length];
}

async function ensureTeacherScheduleColors() {
    const teachers = await prisma.student.findMany({
        where: { role: 'teacher' },
        select: { id: true, phone: true, teacherScheduleColor: true },
        orderBy: { createdAt: 'asc' },
    });

    const missing = teachers.filter(teacher => !teacher.teacherScheduleColor);
    if (!missing.length) return;
    const usedColors = new Set(teachers.map(teacher => teacher.teacherScheduleColor).filter(Boolean));

    await prisma.$transaction(
        missing.map((teacher, index) => {
            const available = TEACHER_COLORS.find(color => !usedColors.has(color));
            const color = available || TEACHER_COLORS[
                (hashString(teacher.phone || teacher.id) + index) % TEACHER_COLORS.length
            ];
            usedColors.add(color);
            return prisma.student.update({
                where: { id: teacher.id },
                data: { teacherScheduleColor: color },
            });
        }),
    );
}

async function nextTeacherScheduleColor(key) {
    const teachers = await prisma.student.findMany({
        where: { role: 'teacher', teacherScheduleColor: { not: null } },
        select: { teacherScheduleColor: true },
    });
    const used = new Set(teachers.map(item => item.teacherScheduleColor).filter(Boolean));
    return TEACHER_COLORS.find(color => !used.has(color)) || teacherColorForKey(key);
}

module.exports = {
    TEACHER_COLORS,
    teacherColorForKey,
    ensureTeacherScheduleColors,
    nextTeacherScheduleColor,
};
