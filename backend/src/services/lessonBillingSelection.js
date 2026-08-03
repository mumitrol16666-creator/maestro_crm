function uniqueIds(values) {
    return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
}

function resolveGroupBillingSelection(memberships, allowedPlanIds) {
    const availableMemberships = Array.isArray(memberships) ? memberships : [];
    const allowedIds = uniqueIds(allowedPlanIds);

    if (allowedIds.length === 0) {
        return {
            state: 'group_tariffs_not_configured',
            suggestedMembershipId: null,
            allowedMembershipIds: [],
            message: 'Для группы не настроен список тарифов. Выберите тариф вручную.',
        };
    }

    const allowedIdSet = new Set(allowedIds);
    const matches = availableMemberships.filter((membership) => (
        membership.planId && allowedIdSet.has(String(membership.planId))
    ));

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
