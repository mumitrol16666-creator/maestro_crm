function parseIsoDay(value, endOfDay = false) {
    const normalized = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
    const date = new Date(`${normalized}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) return null;
    return date;
}

function parseStudentPrintRange(from, to, now = new Date()) {
    const current = new Date(now);
    const defaultTo = current.toISOString().slice(0, 10);
    const defaultFromDate = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
    const defaultFrom = defaultFromDate.toISOString().slice(0, 10);
    const fromValue = String(from || defaultFrom);
    const toValue = String(to || defaultTo);
    const start = parseIsoDay(fromValue);
    const end = parseIsoDay(toValue, true);

    if (!start || !end) {
        const error = new Error('Укажите корректный период');
        error.statusCode = 400;
        throw error;
    }
    if (start > end) {
        const error = new Error('Начало периода не может быть позже окончания');
        error.statusCode = 400;
        throw error;
    }

    return { from: fromValue, to: toValue, start, end };
}

function formatPersonName(person, fallback = '') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function normalizeAttendanceStatus(attendance) {
    const status = String(attendance?.attendanceStatus || '').trim();
    if (status && status !== 'unmarked') return status;
    return attendance?.attended ? 'present' : 'unmarked';
}

function buildStudentAttendanceSummary(attendances = []) {
    const summary = {
        totalClasses: attendances.length,
        attendedCount: 0,
        presentCount: 0,
        lateCount: 0,
        excusedCount: 0,
        unexcusedCount: 0,
        freezeCount: 0,
        unmarkedCount: 0,
        missedCount: 0,
        attendanceRate: 0,
        chargedTotal: 0,
    };

    attendances.forEach(attendance => {
        const status = normalizeAttendanceStatus(attendance);
        if (status === 'present') summary.presentCount += 1;
        else if (status === 'late') summary.lateCount += 1;
        else if (status === 'excused_absence') summary.excusedCount += 1;
        else if (status === 'unexcused_absence') summary.unexcusedCount += 1;
        else if (status === 'emergency_freeze') summary.freezeCount += 1;
        else summary.unmarkedCount += 1;
        if (status === 'present' || status === 'late') summary.attendedCount += 1;
        summary.chargedTotal += Math.max(0, Number(attendance?.chargeAmount) || 0);
    });

    summary.missedCount = summary.excusedCount + summary.unexcusedCount + summary.freezeCount;
    const markedCount = summary.totalClasses - summary.unmarkedCount;
    summary.attendanceRate = markedCount > 0
        ? Math.round((summary.attendedCount / markedCount) * 100)
        : 0;
    return summary;
}

function dateOfEvent(event) {
    const date = new Date(event.date);
    return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function buildStudentFinancialStatement({
    payments = [],
    attendances = [],
    adjustments = [],
    currentBalance = 0,
    rangeEnd,
} = {}) {
    const events = [];

    payments.forEach(payment => {
        if (!['completed', 'refunded'].includes(payment?.status)) return;
        const isRefund = payment.status === 'refunded';
        events.push({
            id: `payment:${payment.id}`,
            date: payment.paymentDate,
            kind: isRefund ? 'refund' : 'payment',
            title: isRefund ? 'Возврат средств' : 'Оплата',
            description: payment.notes || payment.membership?.plan?.name || payment.membership?.group?.name || '',
            amount: (isRefund ? -1 : 1) * Math.max(0, Number(payment.amount) || 0),
            paymentMethod: payment.paymentMethod || '',
            sourceType: payment.type,
            managerName: formatPersonName(payment.manager),
        });
    });

    attendances.forEach(attendance => {
        const amount = Math.max(0, Number(attendance?.chargeAmount) || 0);
        if (!amount) return;
        events.push({
            id: `lesson:${attendance.id}`,
            date: attendance.class?.date,
            kind: 'lesson_charge',
            title: 'Списание за урок',
            description: attendance.class?.title || 'Занятие',
            amount: -amount,
            paymentMethod: '',
            classType: attendance.class?.classType || '',
            teacherName: formatPersonName(attendance.class?.teacher),
        });
    });

    adjustments.forEach(adjustment => {
        const metadata = adjustment?.metadata && typeof adjustment.metadata === 'object'
            ? adjustment.metadata
            : {};
        const amount = Number(metadata.amount);
        if (!Number.isFinite(amount) || amount === 0) return;
        events.push({
            id: `adjustment:${adjustment.id}`,
            date: adjustment.createdAt,
            kind: 'adjustment',
            title: 'Корректировка баланса',
            description: metadata.reason || adjustment.details || '',
            amount: Math.trunc(amount),
            paymentMethod: '',
        });
    });

    events.sort((left, right) => dateOfEvent(left) - dateOfEvent(right));
    const end = new Date(rangeEnd);
    const periodEvents = events.filter(event => dateOfEvent(event) <= end);
    const futureMovement = events
        .filter(event => dateOfEvent(event) > end)
        .reduce((sum, event) => sum + event.amount, 0);
    const movement = periodEvents.reduce((sum, event) => sum + event.amount, 0);
    const closingBalance = Number(currentBalance || 0) - futureMovement;
    const openingBalance = closingBalance - movement;
    let runningBalance = openingBalance;
    const mappedEvents = periodEvents.map(event => {
        runningBalance += event.amount;
        return { ...event, balanceAfter: runningBalance };
    });

    return {
        events: mappedEvents,
        summary: {
            openingBalance,
            income: mappedEvents.filter(event => event.amount > 0).reduce((sum, event) => sum + event.amount, 0),
            expenses: Math.abs(mappedEvents.filter(event => event.amount < 0).reduce((sum, event) => sum + event.amount, 0)),
            movement,
            closingBalance,
            currentBalance: Number(currentBalance || 0),
        },
    };
}

module.exports = {
    parseStudentPrintRange,
    normalizeAttendanceStatus,
    buildStudentAttendanceSummary,
    buildStudentFinancialStatement,
};
