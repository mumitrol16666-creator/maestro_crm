function uniqueIds(values) {
    return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
}

function resolveGroupBillingSelection(memberships, allowedPlans) {
    const availableMemberships = Array.isArray(memberships) ? memberships : [];
    const normalizedPlans = (Array.isArray(allowedPlans) ? allowedPlans : []).map(plan => (
        typeof plan === 'string' ? { id: plan, legacyType: null } : plan
    ));
    const allowedIds = uniqueIds(normalizedPlans.map(plan => plan?.id));
    const allowedTypes = new Set(uniqueIds(normalizedPlans.map(plan => plan?.legacyType)));

    if (allowedIds.length === 0) {
        return {
            state: 'group_tariffs_not_configured',
            suggestedMembershipId: null,
            allowedMembershipIds: [],
            message: 'Для группы не настроен список тарифов. Выберите тариф вручную.',
        };
    }

    const allowedIdSet = new Set(allowedIds);
    const matches = availableMemberships.filter((membership) => {
        if (membership.planId && allowedIdSet.has(String(membership.planId))) return true;
        const membershipType = String(membership.type || membership.planType || '');
        if (allowedTypes.has(membershipType)) return true;
        return allowedTypes.has('hybrid_1')
            && ['hybrid_1m', 'hybrid_2m', 'hybrid_3m', 'hybrid_6m', 'hybrid_10m'].includes(membershipType);
    });

    if (matches.length === 1) {
        return {
            state: 'automatic',
            suggestedMembershipId: matches[0].id,
            allowedMembershipIds: matches.map((membership) => membership.id),
            message: '',
        };
    }

    if (matches.length > 1) {
        return {
            state: 'multiple_matches',
            suggestedMembershipId: null,
            allowedMembershipIds: matches.map((membership) => membership.id),
            message: 'Найдено несколько подходящих тарифов. Выберите тариф для списания.',
        };
    }

    return {
        state: 'no_match',
        suggestedMembershipId: null,
        allowedMembershipIds: [],
        message: availableMemberships.length
            ? 'Подходящий тариф из списка группы не найден. Выберите тариф вручную.'
            : 'У ученика нет активного тарифа на дату урока.',
    };
}

module.exports = {
    resolveGroupBillingSelection,
};
