const TRIAL_DURATION_MINUTES = 60;
const TRIAL_LESSON_PRICE = 2000;

function addMinutesToTime(time, minutes = TRIAL_DURATION_MINUTES) {
    const [hours, minutePart] = String(time).split(':').map(Number);
    const total = hours * 60 + minutePart + minutes;
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function trialClassData({ booking, teacher, room, local, actorId, depositPaid }) {
    const bookingFio = [booking.lastName, booking.name, booking.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ');

    return {
        groupId: null,
        teacherId: teacher.id,
        originalTeacherId: teacher.id,
        roomId: room.id,
        title: `Пробный урок — ${bookingFio}`.trim(),
        date: local.date,
        startTime: local.startTime,
        endTime: addMinutesToTime(local.startTime),
        duration: TRIAL_DURATION_MINUTES,
        price: TRIAL_LESSON_PRICE,
        status: 'scheduled',
        classType: 'trial',
        isPractice: false,
        individualStudentId: booking.convertedToStudentId || null,
        managerId: booking.processedById || actorId || null,
        createdById: actorId || null,
        notes: [
            `Направление: ${booking.direction}`,
            `Телефон: ${booking.phone}`,
            `Диагностический урок ${TRIAL_LESSON_PRICE} ₸: ${depositPaid ? 'оплачен' : 'не оплачен'}`,
        ].join('\n'),
    };
}

module.exports = { TRIAL_DURATION_MINUTES, TRIAL_LESSON_PRICE, addMinutesToTime, trialClassData };
