const {
    getTeacherRate,
    getFirstPaymentTeacherBonus,
    isPayableClass,
} = require('./salaryPolicy');

const STAFF_PAYROLL_ROLES = ['teacher', 'sales_manager', 'staff', 'admin', 'super_admin'];

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

function calculateFixedSalaryForRange(monthlySalary, rangeStart, rangeEnd, employmentStartDate = null) {
    const salary = roundMoney(monthlySalary);
    if (salary <= 0) return 0;

    const employmentStart = employmentStartDate ? new Date(employmentStartDate) : rangeStart;
    if (Number.isNaN(employmentStart.getTime()) || employmentStart >= rangeEnd) return 0;

    const effectiveStart = employmentStart > rangeStart ? employmentStart : rangeStart;
    let cursor = new Date(Date.UTC(
        effectiveStart.getUTCFullYear(),
        effectiveStart.getUTCMonth(),
        1,
    ));
    let total = 0;

    while (cursor < rangeEnd) {
        const monthEnd = new Date(Date.UTC(
            cursor.getUTCFullYear(),
            cursor.getUTCMonth() + 1,
            1,
        ));
        const overlapStart = effectiveStart > cursor ? effectiveStart : cursor;
        const overlapEnd = rangeEnd < monthEnd ? rangeEnd : monthEnd;
        if (overlapStart < overlapEnd) {
            const daysInMonth = Math.round((monthEnd - cursor) / 86400000);
            const overlapDays = Math.max(0, Math.ceil((overlapEnd - overlapStart) / 86400000));
            total += salary * (overlapDays / daysInMonth);
        }
        cursor = monthEnd;
    }

    return roundMoney(total);
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

    const linkedTrialBooking = classItem.classType === 'trial'
        ? { id: 'class-type-trial' }
        : db.booking?.findUnique
            ? await db.booking.findUnique({
                where: { trialClassId: classItem.id },
                select: { id: true },
            })
            : null;
    if (linkedTrialBooking) classItem.classType = 'trial';

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

async function buildPayrollRegister(db, range, employeeId = null) {
    await voidLegacyMembershipBonuses(db);
    await ensurePayrollSnapshotsForPeriod(db, range.start, range.end);

    const employeeWhere = {
        role: { in: STAFF_PAYROLL_ROLES },
        ...(employeeId ? { id: employeeId } : {}),
        OR: [
            { role: 'teacher' },
            { payrollEnabled: true },
            { monthlySalary: { gt: 0 } },
            { salesCommissionPercent: { gt: 0 } },
        ],
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
    const employees = await db.student.findMany({
        where: employeeWhere,
        select: {
            id: true,
            name: true,
            lastName: true,
            middleName: true,
            role: true,
            status: true,
            staffPosition: true,
            payrollEnabled: true,
            monthlySalary: true,
            salesCommissionPercent: true,
            employmentStartDate: true,
        },
        orderBy: [{ lastName: 'asc' }, { name: 'asc' }],
    });
    const employeeIds = employees.map(employee => employee.id);
    const [classes, operations, legacyPaidSalaries, payments] = await Promise.all([
        db.class.findMany({
            where: {
                ...(employeeId ? { teacherId: employeeId } : {}),
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
                ...(employeeId ? { teacherId: employeeId } : {}),
                status: 'active',
                ...operationWhere,
            },
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        }),
        db.salary.findMany({
            where: {
                ...(employeeId ? { teacherId: employeeId } : {}),
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
        employeeIds.length > 0
            ? db.payment.findMany({
                where: {
                    paymentDate: { gte: range.start, lt: range.end },
                    status: { in: ['completed', 'refunded'] },
                    OR: [
                        { managerId: { in: employeeIds } },
                        {
                            status: 'refunded',
                            relatedPayment: { is: { managerId: { in: employeeIds } } },
                        },
                    ],
                },
                select: {
                    id: true,
                    managerId: true,
                    amount: true,
                    status: true,
                    paymentDate: true,
                    relatedPayment: { select: { managerId: true } },
                },
                orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }],
            })
            : [],
    ]);

    const rows = new Map();
    const ensureRow = (id, name = 'Сотрудник', employee = null) => {
        if (!rows.has(id)) {
            rows.set(id, {
                employeeId: id,
                employeeName: name,
                teacherId: id,
                teacherName: name,
                role: employee?.role || null,
                position: employee?.staffPosition || (employee?.role === 'teacher' ? 'Преподаватель' : 'Сотрудник'),
                lessons: 0,
                lessonEarnings: 0,
                fixedSalary: 0,
                salesBase: 0,
                salesCommissionPercent: roundMoney(employee?.salesCommissionPercent),
                salesCommission: 0,
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

    for (const employee of employees) {
        const row = ensureRow(employee.id, formatPersonName(employee), employee);
        row.fixedSalary = calculateFixedSalaryForRange(
            employee.monthlySalary,
            range.start,
            range.end,
            employee.employmentStartDate,
        );
        if (row.fixedSalary > 0) {
            row.timeline.push({
                id: `${employee.id}:${range.key || range.start.toISOString()}:fixed-salary`,
                sourceType: 'fixed_salary',
                date: employee.employmentStartDate && employee.employmentStartDate > range.start
                    ? employee.employmentStartDate
                    : range.start,
                label: 'Оклад',
                detail: employee.staffPosition || 'Месячный оклад',
                amount: row.fixedSalary,
                deletable: false,
            });
        }
    }

    for (const payment of payments) {
        const ownerId = payment.status === 'refunded'
            ? payment.relatedPayment?.managerId || payment.managerId
            : payment.managerId;
        const row = rows.get(ownerId);
        if (!row || row.salesCommissionPercent <= 0) continue;
        row.salesBase += payment.status === 'refunded'
            ? -roundMoney(payment.amount)
            : roundMoney(payment.amount);
    }

    for (const row of rows.values()) {
        row.salesBase = Math.max(0, row.salesBase);
        row.salesCommission = roundMoney(
            row.salesBase * (row.salesCommissionPercent / 100),
        );
        if (row.salesCommission > 0) {
            row.timeline.push({
                id: `${row.employeeId}:${range.key || range.start.toISOString()}:sales-commission`,
                sourceType: 'sales_commission',
                date: new Date(range.end.getTime() - 1),
                label: `Процент от продаж — ${row.salesCommissionPercent}%`,
                detail: `Продажи за период: ${row.salesBase} ₸`,
                amount: row.salesCommission,
                deletable: false,
            });
        }
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
            row.fixedSalary
                + row.lessonEarnings
                + row.salesCommission
                + row.bonuses
                - row.penalties
                - row.paid,
        );
        row.status = getPayrollStatus(row);
        row.timeline.sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    const employeeRows = Array.from(rows.values());
    const totals = employeeRows.reduce((acc, row) => {
        acc.employees += 1;
        if (row.role === 'teacher') acc.teachers += 1;
        acc.lessons += row.lessons;
        acc.fixedSalary += row.fixedSalary;
        acc.lessonEarnings += row.lessonEarnings;
        acc.salesBase += row.salesBase;
        acc.salesCommission += row.salesCommission;
        acc.bonuses += row.bonuses;
        acc.penalties += row.penalties;
        acc.paid += row.paid;
        acc.due += row.due;
        acc.anomalies += row.anomalies;
        return acc;
    }, {
        employees: 0,
        teachers: 0,
        lessons: 0,
        fixedSalary: 0,
        lessonEarnings: 0,
        salesBase: 0,
        salesCommission: 0,
        bonuses: 0,
        penalties: 0,
        paid: 0,
        due: 0,
        anomalies: 0,
    });

    return {
        period: { month: range.key, start: range.start, end: range.end },
        totals,
        employees: employeeRows,
        teachers: employeeRows,
    };
}

async function buildMonthlyPayroll(db, monthKey, employeeId = null) {
    const range = getMonthRange(monthKey);
    if (!range) {
        const error = new Error('Месяц должен быть указан в формате ГГГГ-ММ');
        error.code = 'INVALID_MONTH';
        throw error;
    }
    return buildPayrollRegister(db, range, employeeId);
}

async function buildPeriodPayroll(db, start, end, employeeId = null) {
    if (!(start instanceof Date) || !(end instanceof Date) || start >= end) {
        const error = new Error('Некорректный период зарплаты');
        error.code = 'INVALID_PERIOD';
        throw error;
    }
    return buildPayrollRegister(db, { key: null, start, end }, employeeId);
}

module.exports = {
    STAFF_PAYROLL_ROLES,
    parseMonthKey,
    getMonthRange,
    monthKeyFromDate,
    calculateFixedSalaryForRange,
    syncClassPayrollSnapshot,
    syncFirstPaymentBonusForStudent,
    ensurePayrollSnapshotsForPeriod,
    voidLegacyMembershipBonuses,
    buildMonthlyPayroll,
    buildPeriodPayroll,
};
