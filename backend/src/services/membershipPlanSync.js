const { prisma } = require('../config/db');
const { MEMBERSHIP_CONFIG } = require('../utils/pricing');

function billingModelForType(type) {
    if (['trial', 'single_class', 'individual_single'].includes(type)) return 'per_class';
    if (type === 'monthly' || type === 'monthly_12') return 'subscription';
    return 'package';
}

function groupBindModeForType(type) {
    if (type.startsWith('individual_')) return 'none';
    if (type === 'single_class') return 'optional';
    return 'required';
}

function planPayloadFromDirectionPlan(plan) {
    const type = plan.type;
    const config = MEMBERSHIP_CONFIG[type] || {};
    return {
        name: plan.label,
        directionId: plan.directionId,
        directionPlanId: plan.id,
        legacyType: type,
        groupBindMode: groupBindModeForType(type),
        billingModel: billingModelForType(type),
        unitType: 'class',
        includedUnits: plan.classes,
        price: plan.price,
        validityModel: 'fixed_days',
        validityDays: plan.days,
        freezePolicy: { maxFreezes: config.freezes ?? 1 },
        isVisible: plan.isActive,
        status: plan.isActive ? 'active' : 'archived',
        sortOrder: plan.order,
        individualClasses: config.individualClasses ?? null,
        groupClasses: config.groupClasses ?? null,
        theoryClasses: config.theoryClasses ?? null,
        emergencyFreezes: config.emergencyFreezes ?? null,
    };
}

function planPayloadFromGlobalType(type, config) {
    const labels = {
        trial: 'Пробный урок',
        single_class: 'Разовое занятие',
        monthly: 'Месячный (8 занятий)',
        monthly_12: 'Месячный (12 занятий)',
        quarterly: 'Квартальный',
        individual_single: 'Индивидуальное занятие',
        individual_package: 'Пакет индивидуальных',
        hybrid_1m: 'Гибридный формат на 1 месяц',
        hybrid_2m: 'Гибридный формат на 2 месяца',
    };
    return {
        name: labels[type] || type,
        directionId: null,
        directionPlanId: null,
        legacyType: type,
        groupBindMode: groupBindModeForType(type),
        billingModel: billingModelForType(type),
        unitType: 'class',
        includedUnits: config.classes,
        price: config.price,
        validityModel: 'fixed_days',
        validityDays: config.days,
        freezePolicy: { maxFreezes: config.freezes ?? 0 },
        isVisible: true,
        status: 'active',
        sortOrder: 0,
        individualClasses: config.individualClasses ?? null,
        groupClasses: config.groupClasses ?? null,
        theoryClasses: config.theoryClasses ?? null,
        emergencyFreezes: config.emergencyFreezes ?? null,
    };
}

async function upsertMembershipPlan(where, data) {
    const existing = await prisma.membershipPlan.findFirst({ where });
    if (existing) {
        return prisma.membershipPlan.update({
            where: { id: existing.id },
            data,
        });
    }
    return prisma.membershipPlan.create({ data });
}

async function syncAllMembershipPlans() {
    const directionPlans = await prisma.directionPlan.findMany({
        include: { direction: { select: { id: true, name: true } } },
    });

    let synced = 0;
    for (const plan of directionPlans) {
        await upsertMembershipPlan(
            {
                OR: [
                    { directionPlanId: plan.id },
                    { directionId: plan.directionId, legacyType: plan.type },
                ],
            },
            planPayloadFromDirectionPlan(plan),
        );
        synced += 1;
    }

    for (const [type, config] of Object.entries(MEMBERSHIP_CONFIG)) {
        await upsertMembershipPlan(
            { directionId: null, legacyType: type },
            planPayloadFromGlobalType(type, config),
        );
        synced += 1;
    }

    return { synced };
}

async function resolveMembershipPlanId({ groupId, type, directionPlanId }) {
    if (!type) return null;

    if (directionPlanId) {
        const directionPlan = await prisma.membershipPlan.findFirst({
            where: { directionPlanId, status: 'active' },
            select: { id: true },
        });
        if (directionPlan) return directionPlan.id;
    }

    if (groupId) {
        const group = await prisma.group.findUnique({
            where: { id: groupId },
            select: { direction: true },
        });
        if (group?.direction) {
            const direction = await prisma.direction.findUnique({
                where: { name: group.direction },
                select: { id: true },
            });
            if (direction) {
                const plan = await prisma.membershipPlan.findFirst({
                    where: {
                        directionId: direction.id,
                        legacyType: type,
                        status: 'active',
                    },
                    select: { id: true },
                });
                if (plan) return plan.id;
            }
        }
    }

    const globalPlan = await prisma.membershipPlan.findFirst({
        where: { directionId: null, legacyType: type, status: 'active' },
        select: { id: true },
    });
    return globalPlan?.id ?? null;
}

module.exports = {
    syncAllMembershipPlans,
    resolveMembershipPlanId,
    billingModelForType,
    groupBindModeForType,
};
