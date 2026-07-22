const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { prisma } = require('../config/db');
const { normalizePaymentMethod } = require('../services/paymentMethods');
const {
    getTeacherRate,
    getRateLabel,
    isPayableClass,
    getFirstPaymentTeacherBonus,
} = require('../services/salaryPolicy');
const {
    parseMonthKey,
    monthKeyFromDate,
    buildMonthlyPayroll,
    buildPeriodPayroll,
} = require('../services/payroll');

function parsePeriodDate(value, endOfDay = false) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
    const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatSalaryPersonName(person, fallback = '') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function mapSalary(salary) {
    return {
        ...salary,
        _id: salary.id,
        teacher: salary.teacher ? { ...salary.teacher, _id: salary.teacher.id } : undefined,
        period: { start: salary.periodStart, end: salary.periodEnd }
    };
}

const SALARY_OPERATION_META = {
    payout: { label: 'Выдача зарплаты', cashCategory: 'salary', cashType: 'expense' },
    advance: { label: 'Выдача аванса', cashCategory: 'salary_advance', cashType: 'expense' },
    bonus: { label: 'Премия преподавателю', cashCategory: null, cashType: null },
    penalty: { label: 'Штраф преподавателя', cashCategory: null, cashType: null }
};

function mapSalaryOperation(operation) {
    return {
        ...operation,
        _id: operation.id,
        label: SALARY_OPERATION_META[operation.type]?.label || operation.type
    };
}

function parseOperationDate(value) {
    if (!value) return new Date();
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        return new Date(`${value}T12:00:00.000Z`);
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

// @route   POST /api/salary/calculate
// @desc    Рассчитать зарплату преподавателя
// @access  Private (Admin)
router.post('/calculate', authenticate, requireAdmin, async (req, res) => {
    try {
        const { teacherId, startDate, endDate } = req.body;
        
        // Валидация
        if (!teacherId || !startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: 'Необходимо указать преподавателя, дату начала и дату окончания'
            });
        }
        
        const start = parsePeriodDate(startDate);
        const end = parsePeriodDate(endDate, true);

        if (!start || !end) {
            return res.status(400).json({
                success: false,
                message: 'Даты должны быть указаны в формате ГГГГ-ММ-ДД'
            });
        }
        
        if (start > end) {
            return res.status(400).json({
                success: false,
                message: 'Дата начала не может быть позже даты окончания'
            });
        }
        
        // Находим преподавателя
        const teacher = await prisma.student.findUnique({ where: { id: teacherId } });
        if (!teacher || teacher.role !== 'teacher') {
            return res.status(404).json({
                success: false,
                message: 'Преподаватель не найден'
            });
        }
        
        console.log(`👨‍🏫 Рассчитываем зарплату для: ${formatSalaryPersonName(teacher)}`);
        console.log(`📅 Период: ${start.toISOString().split('T')[0]} - ${end.toISOString().split('T')[0]}`);
        
        // Находим уроки, закрытые администратором.
        // Финансы ученика не участвуют в расчёте зарплаты.
        let classes = await prisma.class.findMany({
            where: {
                teacherId,
                date: { gte: start, lte: end },
                status: { in: ['completed', 'cancelled'] }
            },
            include: {
                group: { select: { name: true, direction: true } },
                salaryRecords: {
                    where: {
                        totalEarnings: { gt: 0 },
                        salary: { status: { in: ['calculated', 'paid'] } }
                    },
                    select: { id: true, totalEarnings: true }
                },
                attendees: {
                    include: {
                        student: { select: { id: true, name: true, lastName: true, middleName: true } }
                    }
                }
            }
        });
        
        const trialClassIds = classes.map((classItem) => classItem.id);
        const trialBookings = trialClassIds.length
            ? await prisma.booking.findMany({
                where: { trialClassId: { in: trialClassIds } },
                select: {
                    id: true,
                    trialClassId: true,
                    depositPaid: true,
                    convertedToStudentId: true,
                },
            })
            : [];
        const trialBookingByClassId = new Map(
            trialBookings
                .filter((booking) => booking.trialClassId)
                .map((booking) => [booking.trialClassId, booking])
        );
        // Старые пробные могли сохраниться с classType=individual. Для
        // зарплаты и бонуса источник истины — связанная заявка.
        classes = classes.map((classItem) => trialBookingByClassId.has(classItem.id)
            ? { ...classItem, classType: 'trial' }
            : classItem);
        const convertedStudentIds = [...new Set(
            trialBookings
                .map((booking) => booking.convertedToStudentId)
                .filter(Boolean)
        )];
        const firstPayments = convertedStudentIds.length
            ? await prisma.payment.findMany({
                where: {
                    studentId: { in: convertedStudentIds },
                    status: 'completed',
                },
                select: {
                    id: true,
                    studentId: true,
                    amount: true,
                    paymentDate: true,
                    type: true,
                },
                orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }],
            })
            : [];
        const firstPaymentByStudentId = new Map();
        for (const payment of firstPayments) {
            if (!firstPaymentByStudentId.has(payment.studentId)) {
                firstPaymentByStudentId.set(payment.studentId, payment);
            }
        }
        const manualBonusInput = Math.max(0, Number(req.body.bonus) || 0);
        const manualFineInput = Math.max(0, Number(req.body.fine) || 0);
        const manualAdvanceInput = Math.max(0, Number(req.body.advance) || 0);
        const existingSalarySnapshots = await prisma.salary.findMany({
            where: {
                teacherId,
                status: { in: ['calculated', 'paid'] },
                periodStart: { lte: end },
                periodEnd: { gte: start },
            },
            select: {
                periodStart: true,
                periodEnd: true,
                calculatedAt: true,
            },
        });
        const rawPeriodOperations = await prisma.salaryOperation.findMany({
            where: {
                teacherId,
                type: { in: ['bonus', 'penalty', 'advance'] },
                date: { gte: start, lte: end },
                status: 'active',
            },
            select: {
                id: true,
                type: true,
                amount: true,
                date: true,
                description: true,
                notes: true,
                createdAt: true,
            },
            orderBy: { date: 'asc' },
        });
        const periodOperations = rawPeriodOperations.filter((operation) =>
            !String(operation.notes || '').includes('membershipTransaction:')
            && !existingSalarySnapshots.some((salary) =>
                operation.date >= salary.periodStart
                && operation.date <= salary.periodEnd
                && operation.createdAt <= salary.calculatedAt
            )
        );
        const operationTotals = periodOperations.reduce((acc, operation) => {
            if (operation.type === 'bonus') acc.bonus += operation.amount || 0;
            if (operation.type === 'penalty') acc.penalty += operation.amount || 0;
            if (operation.type === 'advance') acc.advance += operation.amount || 0;
            return acc;
        }, { bonus: 0, penalty: 0, advance: 0 });
        const hasManualOrBalanceAdjustments = Boolean(
            manualBonusInput
            || manualFineInput
            || manualAdvanceInput
            || operationTotals.bonus
            || operationTotals.penalty
            || operationTotals.advance
        );

        const alreadyCalculatedClasses = classes.filter((classItem) => classItem.salaryRecords.length > 0);
        const payableClasses = classes.filter((classItem) =>
            classItem.salaryRecords.length === 0
            && isPayableClass(classItem)
        );
        const skippedUnpaidTrialClasses = [];
        const skippedTrialClasses = classes.filter((classItem) =>
            classItem.classType === 'trial'
            && classItem.salaryRecords.length === 0
            && !isPayableClass(classItem)
        );
        const skippedExcusedClasses = classes.filter((classItem) =>
            classItem.classType !== 'trial'
            && classItem.salaryRecords.length === 0
            && !isPayableClass(classItem)
        );
        const missingRateLabels = Array.from(new Set(
            payableClasses
                .filter((classItem) => getTeacherRate(teacher, classItem) <= 0)
                .map(getRateLabel)
        ));

        console.log(`📚 Найдено подтверждённых занятий: ${classes.length}`);
        console.log(`📚 Уже включено в ведомости: ${alreadyCalculatedClasses.length}`);

        if (payableClasses.length === 0 && alreadyCalculatedClasses.length > 0 && !hasManualOrBalanceAdjustments) {
            const error = new Error('Один или несколько уроков уже включены в другую ведомость');
            error.code = 'SALARY_CLASS_ALREADY_CALCULATED';
            throw error;
        }
        
        if (payableClasses.length === 0 && !hasManualOrBalanceAdjustments) {
            return res.json({
                success: true,
                message: classes.length === 0
                    ? 'В указанном периоде не найдено проведённых занятий'
                    : skippedUnpaidTrialClasses.length === classes.length
                        ? 'В указанном периоде есть только неоплаченные пробные уроки.'
                        : skippedTrialClasses.length === classes.length
                        ? 'В указанном периоде есть только отменённые или не проведённые пробные занятия.'
                        : skippedExcusedClasses.length + skippedTrialClasses.length + skippedUnpaidTrialClasses.length === classes.length
                            ? 'В указанном периоде есть только отменённые, не проведённые или замороженные занятия.'
                            : 'Все оплачиваемые занятия за этот период уже включены в ведомости',
                data: {
                    teacher: { id: teacherId, name: formatSalaryPersonName(teacher) },
                    period: { start, end },
                    classes: [],
                    statistics: {
                        totalClasses: 0,
                        totalStudents: 0,
                        totalAttendedClasses: 0,
                        totalEarnings: 0,
                        teacherPercentage: 100,
                        teacherSalary: 0,
                        penaltyPoints: 0,
                        penaltyDeduction: 0,
                        skippedUnpaidTrials: skippedUnpaidTrialClasses.length,
                        skippedAlreadyCalculated: alreadyCalculatedClasses.length
                    }
                }
            });
        }

        if (missingRateLabels.length > 0) {
            return res.status(400).json({
                success: false,
                message: `В карточке преподавателя не указана ставка: ${missingRateLabels.join(', ')}. Откройте «Пользователи → Преподаватели», заполните цену за урок и повторите расчёт.`,
                data: {
                    teacher: {
                        id: teacherId,
                        name: formatSalaryPersonName(teacher)
                    },
                    missingRates: missingRateLabels,
                    confirmedClasses: classes.length,
                    alreadyCalculatedClasses: alreadyCalculatedClasses.length
                }
            });
        }
        
        // Обрабатываем каждое занятие отдельно
        const classesData = [];
        let totalAttendedClasses = 0;
        let totalEarnings = 0;
        let lessonPenaltyAmount = 0;
        
        for (const classItem of payableClasses) {
            console.log(`📚 Обрабатываем занятие: ${classItem.title} (${classItem.date.toISOString().split('T')[0]})`);
            
            const flatRate = getTeacherRate(teacher, classItem);
            const trialBooking = classItem.classType === 'trial'
                ? trialBookingByClassId.get(classItem.id)
                : null;
            const firstPayment = trialBooking?.convertedToStudentId
                ? firstPaymentByStudentId.get(trialBooking.convertedToStudentId)
                : null;
            const firstPaymentBonus = classItem.classType === 'trial'
                ? getFirstPaymentTeacherBonus(firstPayment?.amount)
                : 0;
            const classTotalEarnings = flatRate + firstPaymentBonus;
            const classPenaltyAmount = Math.max(0, Math.round(Number(classItem.teacherPenaltyAmount) || 0));
            const classData = {
                classId: classItem.id,
                className: classItem.title,
                classDate: classItem.date,
                groupName: classItem.group ? classItem.group.name : 'Без группы',
                classType: classItem.isPractice ? 'practice' : classItem.classType,
                rate: flatRate,
                firstPaymentBonus,
                firstPaymentAmount: firstPayment?.amount || 0,
                firstPaymentId: firstPayment?.id || null,
                depositPaid: classItem.classType === 'trial' ? Boolean(trialBooking?.depositPaid) : undefined,
                teacherPenaltyAmount: classPenaltyAmount,
                teacherPenaltyReason: classItem.teacherPenaltyReason || '',
                students: [],
                totalAttendedClasses: 0,
                totalEarnings: classTotalEarnings
            };
            
            // Обрабатываем посещаемость на этом занятии
            if (classItem.attendees && classItem.attendees.length > 0) {
                console.log(`👥 Обрабатываем посещаемость: ${classItem.attendees.length} записей`);
                
                for (const attendance of classItem.attendees.filter((item) => item.attended)) {
                    if (!attendance.student) continue;
                    
                    classData.students.push({
                        studentId: attendance.student.id,
                        studentName: formatSalaryPersonName(attendance.student),
                        payment: {
                            type: 'flat_rate',
                            rate: flatRate,
                            firstPaymentAmount: firstPayment?.amount || 0,
                            firstPaymentBonus,
                            firstPaymentId: firstPayment?.id || null,
                        },
                        attendedClasses: 1,
                        totalEarnings: 0
                    });
                    
                    classData.totalAttendedClasses += 1;
                    totalAttendedClasses += 1;
                }
            } else {
                console.log(`⚠️ Нет данных о посещаемости для занятия ${classItem.title}`);
            }
            
            // Добавляем занятие в список (учитель провел занятие, поэтому платим фикс)
            classesData.push(classData);
            totalEarnings += classData.totalEarnings;
            lessonPenaltyAmount += classPenaltyAmount;
        }
        
        console.log('📊 Итоговая статистика (Фикс. ставка):');
        console.log('📊 Занятий:', classesData.length);
        console.log('📊 Посещенные занятия:', totalAttendedClasses);
        console.log('📊 Сумма выплат преподавателю:', totalEarnings);

        const bonusAmount = operationTotals.bonus + manualBonusInput;
        const fineAmount = operationTotals.penalty + manualFineInput;
        const advanceAmount = operationTotals.advance + manualAdvanceInput;
        const totalPenaltyDeduction = fineAmount + lessonPenaltyAmount;
        const teacherSalary = totalEarnings + bonusAmount - totalPenaltyDeduction - advanceAmount;
        
        // Зарплата зависит от уроков, премий, штрафов и авансов.
        const finalSalary = Math.max(0, Math.round(teacherSalary));

        const salary = await prisma.$transaction(async (tx) => {
            // Один преподаватель рассчитывается последовательно.
            // Параллельный второй расчёт дождётся первого и увидит его SalaryClass.
            await tx.$queryRaw`
                SELECT id FROM "Student" WHERE id = ${teacherId} FOR UPDATE
            `;
            const duplicateClass = classesData.length
                ? await tx.salaryClass.findFirst({
                    where: {
                        classId: { in: classesData.map((item) => item.classId) },
                        totalEarnings: { gt: 0 },
                        salary: { status: { in: ['calculated', 'paid'] } }
                    },
                    select: { classId: true }
                })
                : null;
            if (duplicateClass) {
                const error = new Error('Один или несколько уроков уже включены в другую ведомость');
                error.code = 'SALARY_CLASS_ALREADY_CALCULATED';
                throw error;
            }

            return tx.salary.create({
                data: {
                    teacherId,
                    teacherName: formatSalaryPersonName(teacher),
                    periodStart: start,
                    periodEnd: end,
                    totalClasses: classesData.length,
                    totalStudents: classesData.reduce((sum, cls) => sum + cls.students.length, 0),
                    totalAttendedClasses,
                    totalEarnings: Math.round(totalEarnings),
                    teacherPercentage: 100,
                    teacherSalary: finalSalary,
                    penaltyPoints: 0,
                    penaltyDeduction: totalPenaltyDeduction,
                    bonus: bonusAmount,
                    advance: advanceAmount,
                    status: 'calculated',
                    classes: {
                        create: classesData.map((classData) => ({
                            classId: classData.classId,
                            className: classData.className,
                            classDate: classData.classDate,
                            groupName: classData.groupName,
                            totalAttendedClasses: classData.totalAttendedClasses,
                            totalEarnings: Math.round(classData.totalEarnings),
                            teacherPenaltyAmount: classData.teacherPenaltyAmount,
                            teacherPenaltyReason: classData.teacherPenaltyReason || null,
                            students: {
                                create: classData.students.map((student) => ({
                                    studentId: student.studentId,
                                    studentName: student.studentName,
                                    paymentData: student.payment,
                                    attendedClasses: student.attendedClasses,
                                    totalEarnings: 0
                                }))
                            }
                        }))
                    }
                }
            });
        }, { isolationLevel: 'ReadCommitted' });

        res.json({
            success: true,
            message: 'Зарплата успешно рассчитана',
            data: {
                salaryId: salary.id,
                teacher: { id: teacherId, name: formatSalaryPersonName(teacher) },
                period: { start, end },
                classes: classesData,
                statistics: {
                    totalClasses: classesData.length,
                    totalStudents: classesData.reduce((sum, cls) => sum + cls.students.length, 0),
                    totalAttendedClasses,
                    totalEarnings,
                    teacherPercentage: 100,
                    teacherSalary: finalSalary,
                    penaltyPoints: 0,
                    penaltyDeduction: totalPenaltyDeduction,
                    lessonPenaltyAmount,
                    manualPenaltyAmount: manualFineInput,
                    operationPenaltyAmount: operationTotals.penalty,
                    bonus: bonusAmount,
                    manualBonusAmount: manualBonusInput,
                    operationBonusAmount: operationTotals.bonus,
                    advance: advanceAmount,
                    manualAdvanceAmount: manualAdvanceInput,
                    operationAdvanceAmount: operationTotals.advance,
                    firstPaymentBonus: classesData.reduce((sum, cls) => sum + (cls.firstPaymentBonus || 0), 0),
                    skippedUnpaidTrials: skippedUnpaidTrialClasses.length,
                    operations: periodOperations.map(mapSalaryOperation),
                    skippedAlreadyCalculated: alreadyCalculatedClasses.length
                }
            }
        });
    } catch (error) {
        console.error('❌ Salary calculation error:', error);
        if (error.code === 'SALARY_CLASS_ALREADY_CALCULATED' || error.code === 'P2034') {
            return res.status(409).json({
                success: false,
                message: 'Часть уроков уже попала в другую ведомость. Обновите страницу и повторите расчёт.'
            });
        }
        res.status(500).json({ success: false, message: 'Ошибка при расчете зарплаты', error: error.message });
    }
});

// @route   GET /api/salary
// @desc    Получить список расчетов зарплаты
// @access  Private (Admin)
router.get('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const { teacher, status, page = 1, limit = 10 } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        
        const where = {};
        if (teacher) where.teacherId = teacher;
        if (status) where.status = status;
        
        const [salaries, total] = await Promise.all([
            prisma.salary.findMany({
                where,
                include: {
                    teacher: { select: { id: true, name: true, lastName: true, middleName: true } }
                },
                orderBy: { calculatedAt: 'desc' },
                take: limitNum,
                skip: (pageNum - 1) * limitNum
            }),
            prisma.salary.count({ where })
        ]);
        
        const mapped = salaries.map(mapSalary);
        
        res.json({
            success: true,
            data: { salaries: mapped },
            pagination: {
                current: pageNum,
                pages: Math.ceil(total / limitNum),
                total
            }
        });
    } catch (error) {
        console.error('❌ Get salaries error:', error);
        res.status(500).json({ success: false, message: 'Ошибка при получении списка зарплат', error: error.message });
    }
});

// @route   PUT /api/salary/:id/pay
// @desc    Отметить зарплату как выплаченную
// @access  Private (Admin)
router.put('/:id/pay', authenticate, requireAdmin, async (req, res) => {
    try {
        let paymentMethod;
        try {
            paymentMethod = normalizePaymentMethod(req.body.paymentMethod || 'cash');
        } catch (error) {
            return res.status(400).json({ success: false, message: error.message });
        }
        const salary = await prisma.salary.findUnique({ where: { id: req.params.id } });
        
        if (!salary) {
            return res.status(404).json({
                success: false,
                message: 'Расчет зарплаты не найден'
            });
        }
        
        if (salary.status === 'paid') {
            return res.status(400).json({
                success: false,
                message: 'Зарплата уже выплачена'
            });
        }
        
        const updatedSalary = await prisma.$transaction(async (tx) => {
            const paidAt = new Date();
            const claim = await tx.salary.updateMany({
                where: { id: req.params.id, status: 'calculated' },
                data: { status: 'paid', paidAt }
            });
            if (claim.count !== 1) {
                const error = new Error('Зарплата уже выплачена или недоступна для выплаты');
                error.code = 'SALARY_ALREADY_PAID';
                throw error;
            }

            let description = `Зарплата преподавателя: ${salary.teacherName}`;
            if (salary.bonus > 0 || salary.penaltyDeduction > 0 || salary.advance > 0) {
                description += ` (Уроки: ${salary.totalEarnings} ₸`;
                if (salary.bonus > 0) description += `, Премия: +${salary.bonus} ₸`;
                if (salary.penaltyDeduction > 0) description += `, Штраф: -${salary.penaltyDeduction} ₸`;
                if (salary.advance > 0) description += `, Аванс: -${salary.advance} ₸`;
                description += `)`;
            }

            await tx.cashTransaction.create({
                data: {
                    type: 'expense',
                    category: 'salary',
                    amount: salary.teacherSalary,
                    description: description.trim(),
                    date: new Date(),
                    createdById: req.user.id,
                    paymentMethod,
                }
            });

            return tx.salary.findUnique({ where: { id: req.params.id } });
        });
        
        console.log(`💰 Создан расход в кассе: ${salary.teacherSalary} тенге для ${salary.teacherName}`);
        
        res.json({
            success: true,
            message: 'Зарплата отмечена как выплаченная',
            data: { ...updatedSalary, _id: updatedSalary.id }
        });
    } catch (error) {
        console.error('❌ Pay salary error:', error);
        if (error.code === 'SALARY_ALREADY_PAID') {
            return res.status(409).json({ success: false, message: error.message });
        }
        res.status(500).json({ success: false, message: 'Ошибка при выплате зарплаты', error: error.message });
    }
});

// @route   GET /api/salary/statistics
// @desc    Получить статистику по зарплатам
// @access  Private (Admin)
router.get('/statistics', authenticate, requireAdmin, async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        
        let startDate, endDate;
        const now = new Date();
        
        switch (period) {
            case 'week':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                endDate = now;
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                break;
            case 'year':
                startDate = new Date(now.getFullYear(), 0, 1);
                endDate = new Date(now.getFullYear(), 11, 31);
                break;
            default:
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        }
        
        const [totalSalariesCount, paidTotal, pendingTotal, earningsTotal] = await Promise.all([
            prisma.salary.count({
                where: { calculatedAt: { gte: startDate, lte: endDate } }
            }),
            prisma.salary.aggregate({
                where: { calculatedAt: { gte: startDate, lte: endDate }, status: 'paid' },
                _sum: { teacherSalary: true }
            }),
            prisma.salary.aggregate({
                where: { calculatedAt: { gte: startDate, lte: endDate }, status: 'calculated' },
                _sum: { teacherSalary: true }
            }),
            prisma.salary.aggregate({
                where: { calculatedAt: { gte: startDate, lte: endDate } },
                _sum: { totalEarnings: true }
            })
        ]);
        
        res.json({
            success: true,
            data: {
                period,
                startDate,
                endDate,
                totalSalaries: totalSalariesCount,
                totalPaid: paidTotal._sum.teacherSalary || 0,
                totalPending: pendingTotal._sum.teacherSalary || 0,
                totalEarnings: earningsTotal._sum.totalEarnings || 0
            }
        });
    } catch (error) {
        console.error('❌ Get salary statistics error:', error);
        res.status(500).json({ success: false, message: 'Ошибка при получении статистики', error: error.message });
    }
});

// @route   GET /api/salary/balances
// @desc    Сводка к выплате по преподавателям за период
// @access  Private (Admin)
router.get('/balances', authenticate, requireAdmin, async (req, res) => {
    try {
        const now = new Date();
        const defaultStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const defaultEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const defaultEnd = `${defaultEndDate.getFullYear()}-${String(defaultEndDate.getMonth() + 1).padStart(2, '0')}-${String(defaultEndDate.getDate()).padStart(2, '0')}`;
        const start = parsePeriodDate(req.query.startDate || defaultStart);
        const end = parsePeriodDate(req.query.endDate || defaultEnd, true);

        if (!start || !end || start > end) {
            return res.status(400).json({ success: false, message: 'Некорректный период отчета' });
        }

        const [teachers, salaries, operations] = await Promise.all([
            prisma.student.findMany({
                where: { role: 'teacher' },
                select: { id: true, name: true, lastName: true, middleName: true },
                orderBy: [{ lastName: 'asc' }, { name: 'asc' }]
            }),
            prisma.salary.findMany({
                where: {
                    status: { in: ['calculated', 'paid'] },
                    periodStart: { lte: end },
                    periodEnd: { gte: start }
                },
	                select: {
	                    teacherId: true,
	                    teacherName: true,
	                    teacherSalary: true,
	                    totalEarnings: true,
	                    bonus: true,
	                    penaltyDeduction: true,
	                    advance: true,
	                    periodStart: true,
	                    periodEnd: true,
	                    calculatedAt: true,
	                    status: true
	                }
	            }),
            prisma.salaryOperation.findMany({
                where: {
                    date: { gte: start, lte: end },
                    status: 'active',
                },
                select: {
                    teacherId: true,
                    teacherName: true,
                    type: true,
                    amount: true,
                    date: true,
                    notes: true,
                    createdAt: true,
                }
            })
        ]);

        const byTeacher = new Map();
        const ensureRow = (teacherId, teacherName) => {
            if (!byTeacher.has(teacherId)) {
                byTeacher.set(teacherId, {
                    teacherId,
                    teacherName,
                    accrued: 0,
                    lessonEarnings: 0,
                    paidByStatements: 0,
                    manualPayout: 0,
                    advances: 0,
                    bonuses: 0,
                    penalties: 0,
                    due: 0
                });
            }
            return byTeacher.get(teacherId);
        };

        for (const teacher of teachers) {
            ensureRow(teacher.id, formatSalaryPersonName(teacher));
        }

	        for (const salary of salaries) {
	            const row = ensureRow(salary.teacherId, salary.teacherName);
	            row.accrued += salary.totalEarnings || 0;
	            row.lessonEarnings += salary.totalEarnings || 0;
	            row.bonuses += salary.bonus || 0;
	            row.penalties += salary.penaltyDeduction || 0;
	            row.advances += salary.advance || 0;
	            if (salary.status === 'paid') {
	                row.paidByStatements += salary.teacherSalary || 0;
	            }
        }

        for (const operation of operations) {
            if (
                operation.type === 'bonus'
                && String(operation.notes || '').includes('membershipTransaction:')
            ) {
                continue;
            }
            const isAlreadySnapshotted = salaries.some((salary) =>
	                salary.teacherId === operation.teacherId
	                && operation.date >= salary.periodStart
	                && operation.date <= salary.periodEnd
	                && operation.createdAt <= salary.calculatedAt
	            );
	            if (isAlreadySnapshotted && ['bonus', 'penalty', 'advance'].includes(operation.type)) {
	                continue;
	            }
	            const row = ensureRow(operation.teacherId, operation.teacherName);
	            if (operation.type === 'payout') row.manualPayout += operation.amount || 0;
            if (operation.type === 'advance') row.advances += operation.amount || 0;
            if (operation.type === 'bonus') row.bonuses += operation.amount || 0;
            if (operation.type === 'penalty') row.penalties += operation.amount || 0;
        }

        const rows = Array.from(byTeacher.values()).map((row) => ({
            ...row,
            due: row.accrued + row.bonuses - row.penalties - row.paidByStatements - row.manualPayout - row.advances
        }));

        const totals = rows.reduce((acc, row) => {
            acc.accrued += row.accrued;
            acc.lessonEarnings += row.lessonEarnings;
            acc.paidByStatements += row.paidByStatements;
            acc.manualPayout += row.manualPayout;
            acc.advances += row.advances;
            acc.bonuses += row.bonuses;
            acc.penalties += row.penalties;
            acc.due += row.due;
            return acc;
        }, {
            accrued: 0,
            lessonEarnings: 0,
            paidByStatements: 0,
            manualPayout: 0,
            advances: 0,
            bonuses: 0,
            penalties: 0,
            due: 0
        });

        res.json({
            success: true,
            period: { start, end },
            totals,
            teachers: rows
        });
    } catch (error) {
        console.error('❌ Get salary balances error:', error);
        res.status(500).json({ success: false, message: 'Ошибка получения баланса зарплат', error: error.message });
    }
});

// @route   GET /api/salary/monthly
// @desc    Помесячный реестр начислений и выплат
// @access  Private (Admin)
router.get('/monthly', authenticate, requireAdmin, async (req, res) => {
    try {
        const month = parseMonthKey(req.query.month) || monthKeyFromDate();
        const data = await buildMonthlyPayroll(prisma, month, req.query.teacherId || null);
        res.json({ success: true, ...data });
    } catch (error) {
        console.error('❌ Get monthly payroll error:', error);
        if (error.code === 'INVALID_MONTH') {
            return res.status(400).json({ success: false, message: error.message });
        }
        res.status(500).json({
            success: false,
            message: 'Ошибка получения зарплаты за месяц',
            error: error.message,
        });
    }
});

// @route   GET /api/salary/report
// @desc    Реестр начислений и выплат за произвольный период
// @access  Private (Admin)
router.get('/report', authenticate, requireAdmin, async (req, res) => {
    try {
        const start = parsePeriodDate(req.query.startDate);
        const inclusiveEnd = parsePeriodDate(req.query.endDate, true);
        const end = inclusiveEnd ? new Date(inclusiveEnd.getTime() + 1) : null;
        if (!start || !end || start >= end) {
            return res.status(400).json({ success: false, message: 'Укажите корректный период' });
        }
        if (end.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1000) {
            return res.status(400).json({ success: false, message: 'Период не может быть больше одного года' });
        }
        const data = await buildPeriodPayroll(prisma, start, end, req.query.teacherId || null);
        res.json({ success: true, ...data });
    } catch (error) {
        console.error('❌ Get payroll period report error:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка получения зарплаты за период',
            error: error.message,
        });
    }
});

// @route   GET /api/salary/operations
// @desc    Получить ручные операции по зарплате
// @access  Private (Admin)
router.get('/operations', authenticate, requireAdmin, async (req, res) => {
    try {
        const { teacherId, type, periodKey, status = 'active', page = 1, limit = 20 } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);

        const where = {};
        if (teacherId) where.teacherId = teacherId;
        if (type && SALARY_OPERATION_META[type]) where.type = type;
        if (periodKey) {
            const normalizedPeriodKey = parseMonthKey(periodKey);
            if (!normalizedPeriodKey) {
                return res.status(400).json({ success: false, message: 'Некорректный месяц операции' });
            }
            where.periodKey = normalizedPeriodKey;
        }
        if (status !== 'all') where.status = status === 'voided' ? 'voided' : 'active';

        const [operations, total] = await Promise.all([
            prisma.salaryOperation.findMany({
                where,
                orderBy: { date: 'desc' },
                skip: (pageNum - 1) * limitNum,
                take: limitNum
            }),
            prisma.salaryOperation.count({ where })
        ]);

        res.json({
            success: true,
            operations: operations.map(mapSalaryOperation),
            pagination: {
                current: pageNum,
                pages: Math.ceil(total / limitNum),
                total
            }
        });
    } catch (error) {
        console.error('❌ Get salary operations error:', error);
        res.status(500).json({ success: false, message: 'Ошибка получения операций зарплаты', error: error.message });
    }
});

// @route   POST /api/salary/operations
// @desc    Создать ручную операцию по зарплате
// @access  Private (Admin)
router.post('/operations', authenticate, requireAdmin, async (req, res) => {
    try {
        const { teacherId, type, amount, date, description, notes } = req.body;
        const meta = SALARY_OPERATION_META[type];
        const parsedAmount = Math.round(Number(amount) || 0);
        const operationDate = parseOperationDate(date);
        const periodKey = parseMonthKey(req.body.periodKey)
            || monthKeyFromDate(operationDate);

        if (!teacherId) {
            return res.status(400).json({ success: false, message: 'Выберите преподавателя' });
        }
        if (!meta) {
            return res.status(400).json({ success: false, message: 'Некорректный тип операции' });
        }
        if (parsedAmount <= 0) {
            return res.status(400).json({ success: false, message: 'Сумма должна быть больше 0' });
        }
        if (!operationDate) {
            return res.status(400).json({ success: false, message: 'Некорректная дата операции' });
        }
        if (!periodKey) {
            return res.status(400).json({ success: false, message: 'Выберите месяц зарплаты' });
        }
        let paymentMethod = null;
        if (meta.cashCategory && meta.cashType) {
            try {
                paymentMethod = normalizePaymentMethod(req.body.paymentMethod || 'cash');
            } catch (error) {
                return res.status(400).json({ success: false, message: error.message });
            }
        }

        const teacher = await prisma.student.findUnique({
            where: { id: teacherId },
            select: { id: true, name: true, lastName: true, middleName: true, role: true }
        });
        if (!teacher || teacher.role !== 'teacher') {
            return res.status(404).json({ success: false, message: 'Преподаватель не найден' });
        }

        const teacherName = formatSalaryPersonName(teacher);
        const cleanDescription = String(description || '').trim();
        if (['bonus', 'penalty'].includes(type) && !cleanDescription) {
            return res.status(400).json({
                success: false,
                message: type === 'bonus'
                    ? 'Укажите причину премии'
                    : 'Укажите причину штрафа',
            });
        }
        const finalDescription = cleanDescription || `${meta.label}: ${teacherName}`;

        const operation = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`
                SELECT id FROM "Student" WHERE id = ${teacherId} FOR UPDATE
            `;
            if (type === 'payout') {
                const payroll = await buildMonthlyPayroll(tx, periodKey, teacherId);
                const due = payroll.teachers[0]?.due || 0;
                if (parsedAmount > due) {
                    const error = new Error(`Сумма превышает остаток к выплате ${due.toLocaleString('ru-RU')} ₸`);
                    error.code = 'SALARY_OPERATION_EXCEEDS_DUE';
                    throw error;
                }
            }

            let cashTransaction = null;
            if (meta.cashCategory && meta.cashType) {
                cashTransaction = await tx.cashTransaction.create({
                    data: {
                        type: meta.cashType,
                        category: meta.cashCategory,
                        amount: parsedAmount,
                        description: finalDescription,
                        date: operationDate,
                        notes: notes || '',
                        createdById: req.user.id,
                        paymentMethod,
                    }
                });
            }

            const created = await tx.salaryOperation.create({
                data: {
                    teacherId,
                    teacherName,
                    type,
                    amount: parsedAmount,
                    date: operationDate,
                    description: finalDescription,
                    notes: notes || '',
                    cashTransactionId: cashTransaction?.id || null,
                    createdById: req.user.id,
                    periodKey,
                }
            });

            await tx.activityLog.create({
                data: {
                    userId: req.user.id,
                    action: `salary_${type}`,
                    entityType: 'SalaryOperation',
                    entityId: created.id,
                    details: `${meta.label}: ${teacherName} — ${parsedAmount} ₸`,
                    metadata: {
                        teacherId,
                        teacherName,
                        type,
                        amount: parsedAmount,
                        periodKey,
                        cashTransactionId: cashTransaction?.id || null
                    }
                }
            });

            return created;
        });

        res.status(201).json({
            success: true,
            operation: mapSalaryOperation(operation),
            message: meta.cashCategory
                ? `${meta.label} создана и отражена в кассе`
                : `${meta.label} создан без движения по кассе`
        });
    } catch (error) {
        console.error('❌ Create salary operation error:', error);
        if (error.code === 'SALARY_OPERATION_EXCEEDS_DUE') {
            return res.status(409).json({ success: false, message: error.message });
        }
        res.status(500).json({ success: false, message: 'Ошибка создания операции зарплаты', error: error.message });
    }
});

// @route   DELETE /api/salary/operations/:id
// @desc    Аннулировать ручную операцию и связанное движение кассы
// @access  Private (Admin)
router.delete('/operations/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const reason = String(req.body?.reason || '').trim() || 'Аннулировано администратором';
        const operation = await prisma.$transaction(async (tx) => {
            const locked = await tx.$queryRaw`
                SELECT * FROM "SalaryOperation" WHERE id = ${req.params.id} FOR UPDATE
            `;
            const current = locked[0];
            if (!current) {
                const error = new Error('Операция не найдена');
                error.code = 'SALARY_OPERATION_NOT_FOUND';
                throw error;
            }
            if (current.status !== 'active') {
                const error = new Error('Операция уже аннулирована');
                error.code = 'SALARY_OPERATION_ALREADY_VOIDED';
                throw error;
            }

            if (current.cashTransactionId) {
                await tx.cashTransaction.deleteMany({
                    where: { id: current.cashTransactionId },
                });
            }

            const updated = await tx.salaryOperation.update({
                where: { id: current.id },
                data: {
                    status: 'voided',
                    voidedAt: new Date(),
                    voidedById: req.user.id,
                    voidReason: reason,
                },
            });

            await tx.activityLog.create({
                data: {
                    userId: req.user.id,
                    action: 'salary_operation_voided',
                    entityType: 'SalaryOperation',
                    entityId: updated.id,
                    details: `Аннулирована операция «${updated.description}» на ${updated.amount} ₸. Причина: ${reason}`,
                    metadata: {
                        teacherId: updated.teacherId,
                        type: updated.type,
                        amount: updated.amount,
                        periodKey: updated.periodKey,
                        cashTransactionId: updated.cashTransactionId,
                        reason,
                    },
                },
            });

            return updated;
        });

        res.json({
            success: true,
            operation: mapSalaryOperation(operation),
            message: 'Операция аннулирована',
        });
    } catch (error) {
        console.error('❌ Void salary operation error:', error);
        if (error.code === 'SALARY_OPERATION_NOT_FOUND') {
            return res.status(404).json({ success: false, message: error.message });
        }
        if (error.code === 'SALARY_OPERATION_ALREADY_VOIDED') {
            return res.status(409).json({ success: false, message: error.message });
        }
        res.status(500).json({
            success: false,
            message: 'Не удалось аннулировать операцию',
            error: error.message,
        });
    }
});

// @route   GET /api/salary/:id
// @desc    Получить ведомость с детализацией по занятиям
// @access  Private (Admin)
router.get('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const salary = await prisma.salary.findUnique({
            where: { id: req.params.id },
            include: {
                teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                classes: {
                    orderBy: [{ classDate: 'asc' }, { className: 'asc' }],
                    include: { students: true }
                }
            }
        });

        if (!salary) {
            return res.status(404).json({ success: false, message: 'Расчёт зарплаты не найден' });
        }

        const periodOperations = await prisma.salaryOperation.findMany({
            where: {
                teacherId: salary.teacherId,
                type: { in: ['bonus', 'penalty', 'advance'] },
                date: { gte: salary.periodStart, lte: salary.periodEnd },
                createdAt: { lte: salary.calculatedAt },
            },
            orderBy: { date: 'asc' },
        });
        const operationTotals = periodOperations.reduce((acc, operation) => {
            if (operation.type === 'bonus') acc.bonus += operation.amount || 0;
            if (operation.type === 'penalty') acc.penalty += operation.amount || 0;
            if (operation.type === 'advance') acc.advance += operation.amount || 0;
            return acc;
        }, { bonus: 0, penalty: 0, advance: 0 });
        const lessonPenaltyAmount = salary.classes.reduce(
            (sum, classItem) => sum + (classItem.teacherPenaltyAmount || 0),
            0
        );

        const mapped = mapSalary(salary);
        return res.json({
            success: true,
            data: {
                ...mapped,
                teacher: {
                    id: salary.teacherId,
                    name: salary.teacherName
                },
                classes: salary.classes.map((classItem) => ({
                    ...classItem,
                    students: classItem.students.map((student) => ({
                        ...student,
                        payment: student.paymentData
                    }))
                })),
                operations: periodOperations.map(mapSalaryOperation),
                statistics: {
                    totalClasses: salary.totalClasses,
                    totalStudents: salary.totalStudents,
                    totalAttendedClasses: salary.totalAttendedClasses,
                    totalEarnings: salary.totalEarnings,
                    teacherPercentage: salary.teacherPercentage,
                    teacherSalary: salary.teacherSalary,
                    penaltyPoints: salary.penaltyPoints,
                    penaltyDeduction: salary.penaltyDeduction,
                    bonus: salary.bonus,
                    advance: salary.advance,
                    lessonPenaltyAmount,
                    operationBonusAmount: operationTotals.bonus,
                    operationPenaltyAmount: operationTotals.penalty,
                    operationAdvanceAmount: operationTotals.advance,
                    manualBonusAmount: Math.max(0, (salary.bonus || 0) - operationTotals.bonus),
                    manualPenaltyAmount: Math.max(0, (salary.penaltyDeduction || 0) - lessonPenaltyAmount - operationTotals.penalty),
                    manualAdvanceAmount: Math.max(0, (salary.advance || 0) - operationTotals.advance),
                    firstPaymentBonus: salary.classes.reduce((sum, classItem) => {
                        const classStudents = classItem.students || [];
                        const fromStudent = classStudents.find((student) => student.paymentData?.firstPaymentBonus > 0);
                        return sum + (fromStudent?.paymentData?.firstPaymentBonus || 0);
                    }, 0)
                }
            }
        });
    } catch (error) {
        console.error('❌ Get salary details error:', error);
        return res.status(500).json({ success: false, message: 'Ошибка при получении ведомости', error: error.message });
    }
});

module.exports = router;
