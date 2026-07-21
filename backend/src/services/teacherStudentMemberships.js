const INDIVIDUAL_MEMBERSHIP_TYPES = new Set([
    'individual_single',
    'individual_package',
]);

function supportsIndividualLessons(membership) {
    return ['individual', 'mixed'].includes(membership.lessonFormat)
        || INDIVIDUAL_MEMBERSHIP_TYPES.has(membership.type);
}

function supportsGroupLessons(membership) {
    return ['group', 'mixed'].includes(membership.lessonFormat);
}

function membershipAppliesToTeacher(membership, context) {
    if (membership.teacherId === context.teacherId) return true;

    const teacherGroupIds = context.teacherGroupIds instanceof Set
        ? context.teacherGroupIds
        : new Set(context.teacherGroupIds || []);
    if (membership.groupId) return teacherGroupIds.has(membership.groupId);

    const teachesIndividual = Boolean(context.assignedDirectly || context.hasTeacherSchedule);
    if (teachesIndividual && supportsIndividualLessons(membership)) return true;

    return teacherGroupIds.size > 0 && supportsGroupLessons(membership);
}

function teacherVisibleMemberships(memberships, context) {
    return (memberships || []).filter((membership) => membershipAppliesToTeacher(membership, context));
}

module.exports = {
    membershipAppliesToTeacher,
    teacherVisibleMemberships,
    supportsIndividualLessons,
    supportsGroupLessons,
};
