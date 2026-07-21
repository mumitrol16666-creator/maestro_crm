const TRIAL_PARTICIPANT_PREFIX = 'trial:';

function getTrialParticipantId(classId) {
    return `${TRIAL_PARTICIPANT_PREFIX}${classId}`;
}

function isTrialParticipantId(value, classId) {
    if (!value) return false;
    const normalized = String(value);
    return classId
        ? normalized === getTrialParticipantId(classId)
        : normalized.startsWith(TRIAL_PARTICIPANT_PREFIX);
}

module.exports = { TRIAL_PARTICIPANT_PREFIX, getTrialParticipantId, isTrialParticipantId };
