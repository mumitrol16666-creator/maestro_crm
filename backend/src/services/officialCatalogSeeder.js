const { prisma } = require('../config/db');
const { OFFICIAL_DIRECTIONS, OFFICIAL_TARIFFS } = require('../config/officialCatalog');
const { syncAllMembershipPlans } = require('./membershipPlanSync');

async function replaceOfficialCatalog() {
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
                pricingTrial: 4500,
                pricingMonth: 32000,
                pricingThreeMonths: 90000,
                order,
                plans: {
                    create: OFFICIAL_TARIFFS.map(tariff => ({
                        label: tariff.label,
                        type: tariff.type,
                        classes: tariff.classes,
                        days: tariff.days,
                        price: tariff.price,
                        lessonFormat: tariff.lessonFormat,
                        durationMinutes: tariff.durationMinutes,
                        individualClasses: tariff.individualClasses ?? null,
                        groupClasses: tariff.groupClasses ?? null,
                        theoryClasses: tariff.theoryClasses ?? null,
                        order: tariff.order,
                        isActive: tariff.isActive,
                    })),
                },
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

    const result = await syncAllMembershipPlans();
    return {
        directions: OFFICIAL_DIRECTIONS.length,
        tariffsPerDirection: OFFICIAL_TARIFFS.length,
        ...result,
    };
}

module.exports = { replaceOfficialCatalog };
