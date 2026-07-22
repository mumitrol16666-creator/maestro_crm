function normalizePhoneDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

function normalizeNamePart(value) {
    return String(value || '').trim().toLocaleLowerCase('ru-RU');
}

function isSamePerson(booking, student) {
    if (!booking || !student) return false;
    const bookingPhone = normalizePhoneDigits(booking.phoneDigits || booking.phone);
    const studentPhone = normalizePhoneDigits(student.phoneDigits || student.phone);
    return Boolean(bookingPhone)
        && bookingPhone === studentPhone
        && normalizeNamePart(booking.name) === normalizeNamePart(student.name)
        && normalizeNamePart(booking.lastName) === normalizeNamePart(student.lastName);
}

function convertedBookingData(studentId, actorId, convertedAt = new Date()) {
    return {
        convertedToStudentId: studentId,
        convertedAt,
        processedAt: convertedAt,
        status: 'sold',
        lossReason: null,
        lossStage: null,
        lostAt: null,
        ...(actorId ? { convertedById: actorId, processedById: actorId } : {}),
    };
}

function bookingQueueWhere(status) {
    return {
        convertedToStudentId: null,
        status: status || { notIn: ['sold', 'rejected'] },
    };
}

async function linkOpenBookingsForStudent(prisma, student, actorId = null) {
    const digits = normalizePhoneDigits(student?.phoneDigits || student?.phone);
    if (
        !student?.id
        || (student.role && student.role !== 'student')
        || (student.status && student.status !== 'active')
        || !digits
        || !student?.name
        || !student?.lastName
    ) {
        return { count: 0, bookingIds: [] };
    }

    const candidates = await prisma.booking.findMany({
        where: {
            convertedToStudentId: null,
            OR: [
                { phoneDigits: digits },
                { phone: student.phone },
            ],
        },
        select: {
            id: true,
            name: true,
            lastName: true,
            phone: true,
            phoneDigits: true,
            requestType: true,
            trialClassId: true,
            trialScheduledAt: true,
        },
        orderBy: { createdAt: 'desc' },
    });
    const bookingIds = candidates
        .filter(booking => isSamePerson(booking, student))
        .map(booking => booking.id);
    if (!bookingIds.length) return { count: 0, bookingIds: [] };

    const result = await prisma.booking.updateMany({
        where: { id: { in: bookingIds }, convertedToStudentId: null },
        data: convertedBookingData(student.id, actorId),
    });
    const trialBookingIds = candidates
        .filter(booking => bookingIds.includes(booking.id)
            && (booking.requestType === 'trial' || booking.trialClassId || booking.trialScheduledAt))
        .map(booking => booking.id);
    if (trialBookingIds.length) {
        await prisma.booking.updateMany({
            where: { id: { in: trialBookingIds }, requestType: 'trial' },
            data: {
                trialFunnelStage: 'sold',
                trialNextAction: 'none',
                trialNextActionAt: null,
            },
        });
    }
    return { count: result.count, bookingIds };
}

async function closeBookingForStudent(prisma, bookingId, studentId, actorId = null, bookingContext = null) {
    const booking = bookingContext || await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { requestType: true, trialClassId: true, trialScheduledAt: true },
    });
    return prisma.booking.update({
        where: { id: bookingId },
        data: {
            ...convertedBookingData(studentId, actorId),
            ...(booking?.requestType === 'trial' || booking?.trialClassId || booking?.trialScheduledAt
                ? {
                    trialFunnelStage: 'sold',
                    trialNextAction: 'none',
                    trialNextActionAt: null,
                }
                : {}),
        },
    });
}

async function linkBookingToExistingStudent(prisma, booking, actorId = null) {
    const digits = normalizePhoneDigits(booking?.phoneDigits || booking?.phone);
    if (!booking?.id || !digits || !booking?.name || !booking?.lastName) {
        return { linked: false, booking, student: null };
    }
    const candidates = await prisma.student.findMany({
        where: {
            role: 'student',
            status: 'active',
            OR: [
                { phoneDigits: digits },
                { phone: booking.phone },
            ],
        },
        select: {
            id: true,
            name: true,
            lastName: true,
            phone: true,
            phoneDigits: true,
        },
        orderBy: { createdAt: 'asc' },
    });
    const student = candidates.find(candidate => isSamePerson(booking, candidate));
    if (!student) return { linked: false, booking, student: null };

    const updated = await closeBookingForStudent(prisma, booking.id, student.id, actorId, booking);
    return { linked: true, booking: updated, student };
}

module.exports = {
    normalizePhoneDigits,
    isSamePerson,
    convertedBookingData,
    bookingQueueWhere,
    linkOpenBookingsForStudent,
    closeBookingForStudent,
    linkBookingToExistingStudent,
};
