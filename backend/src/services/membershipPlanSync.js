const { prisma } = require('../config/db');
const { MEMBERSHIP_CONFIG } = require('../utils/pricing');

function billingModelForType(type, includedUnits = null) {
    if (includedUnits === 1 || ['trial', 'single_class', 'individual_single', 'single_lesson'].includes(type)) return 'per_class';
    if (type === 'monthly' || type === 'monthly_12') return 'subscription';
    return 'package';
}

function groupBindModeForType(type, lessonFormat = null) {
    if (lessonFormat === 'individual' || type.startsWith('individual_') || type === 'single_lesson') return 'none';
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
        groupBindMode: groupBindModeForType(type, plan.lessonFormat),
        billingModel: billingModelForType(type, plan.classes),
        unitType: 'class',
        includedUnits: plan.classes,
        price: plan.price,
        lessonFormat: plan.lessonFormat,
        durationMinutes: plan.durationMinutes,
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
