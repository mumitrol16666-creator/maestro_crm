const {
    getTeacherRate,
    getFirstPaymentTeacherBonus,
    isPayableClass,
} = require('./salaryPolicy');

function formatPersonName(person, fallback = '') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function parseMonthKey(value) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;
    return `${year}-${String(month).padStart(2, '0')}`;
}

function getMonthRange(monthKey) {
    const normalized = parseMonthKey(monthKey);
    if (!normalized) return null;
    const [year, month] = normalized.split('-').map(Number);
    return {
        key: normalized,
        start: new Date(Date.UTC(year, month - 1, 1)),
        end: new Date(Date.UTC(year, month, 1)),
    };
}

function monthKeyFromDate(value = new Date()) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function roundMoney(value) {
    return Math.max(0, Math.round(Number(value) || 0));
}

function getLegacyFirstPaymentBonus(salaryRecords) {
    for (const salaryRecord of salaryRecords || []) {
        for (const student of salaryRecord.students || []) {
            const paymentData = student.paymentData || {};
            const bonus = roundMoney(paymentData.firstPaymentBonus);
            if (bonus > 0) {
                return {
                    amount: bonus,
                    paymentId: paymentData.firstPaymentId || null,
                    paymentAmount: roundMoney(paymentData.firstPaymentAmount),
                };
            }
        }
    }
    return { amount: 0, paymentId: null, paymentAmount: 0 };
}

async function syncClassPayrollSnapshot(db, classId, options = {}) {
    const classItem = await db.class.findUnique({
        where: { id: classId },
        include: {
            teacher: {
                select: {
                    id: true,
                    role: true,
                    salaryIndividual: true,
                    salaryGroup: true,
                    salaryTrial: true,
                    salaryOther: true,
                },
            },
            attendees: {
                select: { attendanceStatus: true, attended: true },
            },
            salaryRecords: {
                where: {
                    totalEarnings: { gt: 0 },
                    salary: { status: { in: ['calculated', 'paid'] } },
                },
                select: {
                    totalEarnings: true,
                    students: { select: { paymentData: true } },
                },
                orderBy: { id: 'asc' },
            },
        },
    });
    if (!classItem) return null;

    const calculatedAt = new Date();
    const payable = isPayableClass(classItem);
    if (!payable) {
        return db.class.update({
            where: { id: classId },
            data: {
                teacherBaseEarning: 0,
                teacherEarningStatus: ['completed', 'cancelled'].includes(classItem.status)
                    ? 'not_payable'
                    : 'pending',
                teacherEarningCalculatedAt: ['completed', 'cancelled'].includes(classItem.status)
                    ? calculatedAt
                    : null,
            },
        });
    }

    const legacyRecord = classItem.salaryRecords[0];
    const legacyBonus = getLegacyFirstPaymentBonus(classItem.salaryRecords);
    const legacyBase = legacyRecord
        ? Math.max(0, roundMoney(legacyRecord.totalEarnings) - legacyBonus.amount)
        : null;
    const currentRate = roundMoney(getTeacherRate(classItem.teacher || {}, classItem));
    const canRepairMissingRate = classItem.teacherEarningStatus === 'missing_rate' && currentRate > 0;
    const rate = classItem.teacherRateSnapshot !== null && !canRepairMissingRate
        ? roundMoney(classItem.teacherRateSnapshot)
        : legacyBase !== null
            ? legacyBase
            : currentRate;
    const hasTeacher = Boolean(classItem.teacherId && classItem.teacher?.role === 'teacher');
    const status = hasTeacher && rate > 0 ? 'active' : 'missing_rate';

    const data = {
        teacherRateSnapshot: rate,
        teacherBaseEarning: status === 'active' ? rate : 0,
        teacherEarningStatus: status,
        teacherEarningCalculatedAt: calculatedAt,
    };

    if (
        options.restoreLegacyBonus
        && legacyBonus.amount > 0
        && !classItem.teacherFirstPaymentId
    ) {
        data.teacherFirstPaymentBonus = legacyBonus.amount;
        data.teacherFirstPaymentId = legacyBonus.paymentId;
        data.teacherFirstPaymentAmount = legacyBonus.paymentAmount;
        data.teacherFirstPaymentBonusDate = classItem.date;
    }

    return db.class.update({ where: { id: classId }, data });
}

async function syncFirstPaymentBonusForStudent(db, studentId) {
    if (!studentId) return null;

    const [firstPayment, bookings, fallbackTrial] = await Promise.all([
        db.payment.findFirst({
            where: { studentId, status: 'completed' },
            orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }],
            select: { id: true, amount: true, paymentDate: true },
        }),
        db.booking.findMany({
            where: {
                convertedToStudentId: studentId,
                trialClassId: { not: null },
            },
            orderBy: [
                { convertedAt: 'desc' },
                { trialScheduledAt: 'desc' },
                { createdAt: 'desc' },
            ],
            select: { trialClassId: true },
        }),
        db.class.findFirst({
            where: {
                individualStudentId: studentId,
                classType: 'trial',
                teacherId: { not: null },
            },
            orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
            select: { id: true },
        }),
    ]);

    const candidateIds = [...new Set([
        ...bookings.map(booking => booking.trialClassId),
        fallbackTrial?.id,
    ].filter(Boolean))];

    if (candidateIds.length === 0) return null;

    const sourceClassId = bookings[0]?.trialClassId || fallbackTrial?.id;
    const sourceClass = await db.class.findUnique({
        where: { id: sourceClassId },
        select: {
            id: true,
            teacherFirstPaymentBonus: true,
            teacherFirstPaymentId: true,
            teacherFirstPaymentAmount: true,
            teacherFirstPaymentBonusDate: true,
        },
    });
    const otherCandidateIds = candidateIds.filter(id => id !== sourceClassId);
    if (otherCandidateIds.length > 0) {
        await db.class.updateMany({
            where: {
                id: { in: otherCandidateIds },
                OR: [
                    { teacherFirstPaymentId: { not: null } },
                    { teacherFirstPaymentBonus: { gt: 0 } },
                ],
            },
            data: {
                teacherFirstPaymentBonus: 0,
                teacherFirstPaymentId: null,
                teacherFirstPaymentAmount: 0,
                teacherFirstPaymentBonusDate: null,
            },
        });
    }

    if (!firstPayment) {
        if (
            sourceClass
            && sourceClass.teacherFirstPaymentBonus === 0
            && sourceClass.teacherFirstPaymentId === null
            && sourceClass.teacherFirstPaymentAmount === 0
            && sourceClass.teacherFirstPaymentBonusDate === null
        ) {
            return sourceClass;
        }
        return db.class.update({
            where: { id: sourceClassId },
            data: {
                teacherFirstPaymentBonus: 0,
                teacherFirstPaymentId: null,
                teacherFirstPaymentAmount: 0,
                teacherFirstPaymentBonusDate: null,
            },
        });
    }

    const amount = getFirstPaymentTeacherBonus(firstPayment.amount);
    if (
        sourceClass
        && sourceClass.teacherFirstPaymentBonus === amount
        && sourceClass.teacherFirstPaymentId === firstPayment.id
        && sourceClass.teacherFirstPaymentAmount === roundMoney(firstPayment.amount)
        && sourceClass.teacherFirstPaymentBonusDate?.getTime() === firstPayment.paymentDate.getTime()
    ) {
        return sourceClass;
    }

    return db.class.update({
        where: { id: sourceClassId },
        data: {
            teacherFirstPaymentBonus: amount,
            teacherFirstPaymentId: firstPayment.id,
            teacherFirstPaymentAmount: roundMoney(firstPayment.amount),
            teacherFirstPaymentBonusDate: firstPayment.paymentDate,
        },
    });
}

async function ensurePayrollSnapshotsForPeriod(db, start, end) {
    const classes = await db.class.findMany({
        where: {
            date: { gte: start, lt: end },
            status: { in: ['completed', 'cancelled'] },
            OR: [
                { teacherEarningCalculatedAt: null },
                { teacherEarningStatus: 'pending' },
                { teacherEarningStatus: 'missing_rate' },
            ],
        },
        select: { id: true },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });

    for (const classItem of classes) {
        await syncClassPayrollSnapshot(db, classItem.id, { restoreLegacyBonus: true });
    }

    const paymentStudents = await db.payment.findMany({
        where: {
            status: 'completed',
            paymentDate: { gte: start, lt: end },
        },
        select: { studentId: true },
        distinct: ['studentId'],
    });
    for (const payment of paymentStudents) {
        await syncFirstPaymentBonusForStudent(db, payment.studentId);
    }
    return classes.length;
}

async function voidLegacyMembershipBonuses(db) {
    return db.salaryOperation.updateMany({
        where: {
            type: 'bonus',
            status: 'active',
            notes: { contains: 'membershipTransaction:' },
        },
        data: {
            status: 'voided',
            voidedAt: new Date(),
            voidReason: 'Автоматически отменено: бонусы за покупку и продление абонемента больше не начисляются',
        },
    });
}

function getPayrollStatus(row) {
    if (row.anomalies > 0) return 'attention';
    if (row.due <= 0 && row.paid > 0) return 'paid';
    if (row.paid > 0 && row.due > 0) return 'partial';
    if (row.due > 0) return 'unpaid';
    return 'accruing';
}

async function buildPayrollRegister(db, range, teacherId = null) {
    await voidLegacyMembershipBonuses(db);
    await ensurePayrollSnapshotsForPeriod(db, range.start, range.end);

    const teacherWhere = {
        role: 'teacher',
        ...(teacherId ? { id: teacherId } : {}),
    };
    const operationWhere = range.key
        ? {
            OR: [
                { periodKey: range.key },
                {
                    periodKey: null,
                    date: { gte: range.start, lt: range.end },
                },
            ],
        }
        : { date: { gte: range.start, lt: range.end } };
    const [teachers, classes, operations, legacyPaidSalaries] = await Promise.all([
        db.student.findMany({
            where: teacherWhere,
            select: {
                id: true,
                name: true,
                lastName: true,
                middleName: true,
                status: true,
            },
            orderBy: [{ lastName: 'asc' }, { name: 'asc' }],
        }),
        db.class.findMany({
            where: {
                ...(teacherId ? { teacherId } : {}),
                OR: [
                    { date: { gte: range.start, lt: range.end } },
                    { teacherFirstPaymentBonusDate: { gte: range.start, lt: range.end } },
                ],
            },
            select: {
                id: true,
                teacherId: true,
                title: true,
                date: true,
                startTime: true,
                classType: true,
                isPractice: true,
                status: true,
                teacherRateSnapshot: true,
                teacherBaseEarning: true,
                teacherFirstPaymentBonus: true,
                teacherFirstPaymentId: true,
                teacherFirstPaymentAmount: true,
                teacherFirstPaymentBonusDate: true,
                teacherEarningStatus: true,
                teacherPenaltyAmount: true,
                teacherPenaltyReason: true,
                group: { select: { name: true } },
                individualStudent: {
                    select: { name: true, lastName: true, middleName: true },
                },
            },
            orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
        }),
        db.salaryOperation.findMany({
            where: {
                ...(teacherId ? { teacherId } : {}),
                status: 'active',
                ...operationWhere,
            },
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        }),
        db.salary.findMany({
            where: {
                ...(teacherId ? { teacherId } : {}),
                status: 'paid',
                periodStart: { lt: range.end },
                periodEnd: { gte: range.start },
            },
            select: {
                id: true,
                teacherId: true,
                teacherName: true,
                teacherSalary: true,
                paidAt: true,
                periodStart: true,
                periodEnd: true,
            },
        }),
    ]);

    const rows = new Map();
    const ensureRow = (id, name = 'Преподаватель') => {
        if (!rows.has(id)) {
            rows.set(id, {
                teacherId: id,
                teacherName: name,
                lessons: 0,
                lessonEarnings: 0,
                firstPaymentBonuses: 0,
                manualBonuses: 0,
                bonuses: 0,
                lessonPenalties: 0,
                manualPenalties: 0,
                penalties: 0,
                paid: 0,
                payouts: 0,
                advances: 0,
                due: 0,
                anomalies: 0,
                status: 'accruing',
                timeline: [],
            });
        }
        return rows.get(id);
    };

    for (const teacher of teachers) {
        ensureRow(teacher.id, formatPersonName(teacher));
    }

    for (const classItem of classes) {
        if (!classItem.teacherId) continue;
        const row = ensureRow(classItem.teacherId);
        const classInPeriod = classItem.date >= range.start && classItem.date < range.end;
        const bonusInPeriod = classItem.teacherFirstPaymentBonusDate
            && classItem.teacherFirstPaymentBonusDate >= range.start
            && classItem.teacherFirstPaymentBonusDate < range.end;

        if (classInPeriod && classItem.teacherEarningStatus === 'active') {
            row.lessons += 1;
            row.lessonEarnings += roundMoney(classItem.teacherBaseEarning);
            row.timeline.push({
                id: classItem.id,
                sourceType: 'lesson',
                date: classItem.date,
                time: classItem.startTime,
                label: classItem.title,
                detail: classItem.group?.name
                    || formatPersonName(classItem.individualStudent)
                    || 'Урок',
                classType: classItem.isPractice ? 'practice' : classItem.classType,
                amount: roundMoney(classItem.teacherBaseEarning),
                rate: roundMoney(classItem.teacherRateSnapshot),
                deletable: false,
            });
        } else if (
            classInPeriod
            && ['completed', 'cancelled'].includes(classItem.status)
            && classItem.teacherEarningStatus === 'missing_rate'
        ) {
            row.anomalies += 1;
            row.timeline.push({
                id: classItem.id,
                sourceType: 'anomaly',
                date: classItem.date,
                time: classItem.startTime,
                label: classItem.title,
                detail: 'Не указана ставка преподавателя',
                amount: 0,
                deletable: false,
            });
        }

        if (classInPeriod && roundMoney(classItem.teacherPenaltyAmount) > 0) {
            const amount = roundMoney(classItem.teacherPenaltyAmount);
            row.lessonPenalties += amount;
            row.timeline.push({
                id: `${classItem.id}:penalty`,
                sourceType: 'lesson_penalty',
                date: classItem.date,
                time: classItem.startTime,
                label: 'Штраф по уроку',
                detail: classItem.teacherPenaltyReason || classItem.title,
                amount: -amount,
                deletable: false,
            });
        }

        if (
            bonusInPeriod
            && classItem.teacherEarningStatus === 'active'
            && roundMoney(classItem.teacherFirstPaymentBonus) > 0
        ) {
            const amount = roundMoney(classItem.teacherFirstPaymentBonus);
            row.firstPaymentBonuses += amount;
            row.timeline.push({
                id: classItem.teacherFirstPaymentId || `${classItem.id}:first-payment`,
                sourceType: 'first_payment_bonus',
                date: classItem.teacherFirstPaymentBonusDate,
                label: 'Бонус за первый платеж',
                detail: `Первый платеж ${roundMoney(classItem.teacherFirstPaymentAmount)} ₸`,
                amount,
                sourceId: classItem.teacherFirstPaymentId,
                deletable: false,
            });
        }
    }

    for (const operation of operations) {
        if (
            operation.type === 'bonus'
            && String(operation.notes || '').includes('membershipTransaction:')
        ) {
            continue;
        }
        const row = ensureRow(operation.teacherId, operation.teacherName);
        if (operation.type === 'bonus') row.manualBonuses += roundMoney(operation.amount);
        if (operation.type === 'penalty') row.manualPenalties += roundMoney(operation.amount);
        if (operation.type === 'payout') row.payouts += roundMoney(operation.amount);
        if (operation.type === 'advance') row.advances += roundMoney(operation.amount);
        const sign = ['penalty', 'payout', 'advance'].includes(operation.type) ? -1 : 1;
        row.timeline.push({
            id: operation.id,
            sourceType: operation.type,
            date: operation.date,
            label: operation.description,
            detail: operation.notes || '',
            amount: sign * roundMoney(operation.amount),
            deletable: true,
        });
    }

    for (const salary of legacyPaidSalaries) {
        if (range.key && monthKeyFromDate(salary.periodStart) !== range.key) continue;
        const row = ensureRow(salary.teacherId, salary.teacherName);
        row.payouts += roundMoney(salary.teacherSalary);
        row.timeline.push({
            id: salary.id,
            sourceType: 'legacy_payout',
            date: salary.paidAt || salary.periodEnd,
            label: 'Выплата по старой ведомости',
            detail: 'Сохранено для совместимости с прежним учетом',
            amount: -roundMoney(salary.teacherSalary),
            deletable: false,
        });
    }

    for (const row of rows.values()) {
        row.bonuses = row.firstPaymentBonuses + row.manualBonuses;
        row.penalties = row.lessonPenalties + row.manualPenalties;
        row.paid = row.payouts + row.advances;
        row.due = Math.max(
            0,
            row.lessonEarnings + row.bonuses - row.penalties - row.paid,
        );
        row.status = getPayrollStatus(row);
        row.timeline.sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    const teacherRows = Array.from(rows.values());
    const totals = teacherRows.reduce((acc, row) => {
        acc.teachers += 1;
        acc.lessons += row.lessons;
        acc.lessonEarnings += row.lessonEarnings;
        acc.bonuses += row.bonuses;
        acc.penalties += row.penalties;
        acc.paid += row.paid;
        acc.due += row.due;
        acc.anomalies += row.anomalies;
        return acc;
    }, {
        teachers: 0,
        lessons: 0,
        lessonEarnings: 0,
        bonuses: 0,
        penalties: 0,
        paid: 0,
        due: 0,
        anomalies: 0,
    });

    return {
        period: { month: range.key, start: range.start, end: range.end },
        totals,
        teachers: teacherRows,
    };
}

async function buildMonthlyPayroll(db, monthKey, teacherId = null) {
    const range = getMonthRange(monthKey);
    if (!range) {
        const error = new Error('Месяц должен быть указан в формате ГГГГ-ММ');
        error.code = 'INVALID_MONTH';
        throw error;
    }
    return buildPayrollRegister(db, range, teacherId);
}

async function buildPeriodPayroll(db, start, end, teacherId = null) {
    if (!(start instanceof Date) || !(end instanceof Date) || start >= end) {
        const error = new Error('Некорректный период зарплаты');
        error.code = 'INVALID_PERIOD';
        throw error;
    }
    return buildPayrollRegister(db, { key: null, start, end }, teacherId);
}

module.exports = {
    parseMonthKey,
    getMonthRange,
    monthKeyFromDate,
    syncClassPayrollSnapshot,
    syncFirstPaymentBonusForStudent,
    ensurePayrollSnapshotsForPeriod,
    voidLegacyMembershipBonuses,
    buildMonthlyPayroll,
    buildPeriodPayroll,
};
