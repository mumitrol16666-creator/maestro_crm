const { prisma } = require('../config/db');
const { OFFICIAL_DIRECTIONS, DEFAULT_LESSON_PRICING } = require('../config/officialCatalog');

async function replaceOfficialCatalog() {
    if (await prisma.membership.count() > 0) {
        throw new Error('Каталог используется в абонементах. Измените цены через интерфейс направлений.');
    }
    await prisma.membershipPlan.deleteMany();
    await prisma.directionPlan.deleteMany();
    await prisma.direction.deleteMany();

    for (const [order, name] of OFFICIAL_DIRECTIONS.entries()) {
        await prisma.direction.create({
            data: {
                name,
                description: `Занятия по направлению «${name}» в музыкальной школе Maestro`,
                minAge: 6,
                level: 'Все уровни',
                pricingTrial: 2000,
                pricingMonth: 27000,
                pricingThreeMonths: 81000,
                trialLessonPrice: DEFAULT_LESSON_PRICING.trial,
                individualLessonPrice: DEFAULT_LESSON_PRICING.individual,
                theoryLessonPrice: DEFAULT_LESSON_PRICING.theory,
                groupLessonPrice: DEFAULT_LESSON_PRICING.group,
                order,
            },
        });
    }

    const officialNames = new Set(OFFICIAL_DIRECTIONS);
    const people = await prisma.student.findMany({
        select: { id: true, learningDirections: true, teacherDirections: true },
    });
    for (const person of people) {
        const learningDirections = person.learningDirections.filter(name => officialNames.has(name));
        const teacherDirections = person.teacherDirections.filter(name => officialNames.has(name));
        if (
            learningDirections.length !== person.learningDirections.length
            || teacherDirections.length !== person.teacherDirections.length
        ) {
            await prisma.student.update({
                where: { id: person.id },
                data: { learningDirections, teacherDirections },
            });
        }
    }

    await prisma.group.updateMany({
        where: { direction: { notIn: OFFICIAL_DIRECTIONS } },
        data: { direction: 'Не указано' },
    });

    return {
        directions: OFFICIAL_DIRECTIONS.length,
        lessonPricing: DEFAULT_LESSON_PRICING,
    };
}

module.exports = { replaceOfficialCatalog };
