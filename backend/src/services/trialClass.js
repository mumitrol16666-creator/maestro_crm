function isTrialClass(classRecord, trialBooking = null) {
    return Boolean(classRecord?.classType === 'trial' || trialBooking);
}

function isVirtualTrialClass(classRecord, trialBooking = null) {
    return isTrialClass(classRecord, trialBooking)
        && !classRecord?.individualStudentId
        && !classRecord?.groupId;
}

async function findTrialBookingForClass(db, classId, select = { id: true }) {
    if (!db?.booking || !classId) return null;
    return db.booking.findUnique({
        where: { trialClassId: classId },
        select,
    });
}

module.exports = {
    isTrialClass,
    isVirtualTrialClass,
    findTrialBookingForClass,
};
