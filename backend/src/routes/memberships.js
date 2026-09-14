const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { computeMembershipPrice, membershipLessonPrice, resolveMembershipPurchaseDates } = require('../utils/pricing');
const { autoRecoverStudent } = require('../utils/recovery');
const { generateClassesForGroupInRange } = require('../services/scheduleGenerator');
const { createFreezeForMembership } = require('../services/freezeService');
const { buildMembershipEdit } = require('../services/membershipEditPolicy');

const DETACHED_MEMBERSHIP_PAYMENT_STATUS = 'detached';
const MEMBERSHIP_TEACHER_ATTRIBUTION_SKIP_TYPES = new Set(['trial', 'single_class', 'individual_single', 'single_lesson']);

function formatPersonName(person, fallback = '') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function shouldAttributeMembershipTeacher(type) {
    return !MEMBERSHIP_TEACHER_ATTRIBUTION_SKIP_TYPES.has(type);
}

async function resolveMembershipTeacherAttribution({ studentId, student, groupId }) {
    const trialClass = await prisma.class.findFirst({
        where: {
            individualStudentId: studentId,
            classType: 'trial',
            teacherId: { not: null },
        },
        orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
        select: { teacherId: true, id: true },
    });
    if (trialClass?.teacherId) {
        return { teacherId: trialClass.teacherId, source: 'trial_class', sourceId: trialClass.id };
    }

    const booking = await prisma.booking.findFirst({
        where: {
            convertedToStudentId: studentId,
            trialTeacherId: { not: null },
        },
        orderBy: [{ trialScheduledAt: 'desc' }, { updatedAt: 'desc' }],
        select: { trialTeacherId: true, id: true },
    });
    if (booking?.trialTeacherId) {
        return { teacherId: booking.trialTeacherId, source: 'trial_booking', sourceId: booking.id };
    }

    if (groupId) {
        const group = await prisma.group.findUnique({
            where: { id: groupId },
            select: { teacherId: true },
        });
        if (group?.teacherId) {
            return { teacherId: group.teacherId, source: 'group', sourceId: groupId };
        }
    }

    if (student?.assignedTeacherId) {
        return { teacherId: student.assignedTeacherId, source: 'assigned_teacher', sourceId: studentId };
    }

    return { teacherId: null, source: 'none', sourceId: null };
}

// =====================================================
// GET /api/memberships/student/:studentId
// Получить ВСЕ абонементы ученика (для профиля)
// =====================================================
router.get('/student/:studentId', authenticate, requireAdmin, async (req, res) => {
    try {
        const { studentId } = req.params;

        const memberships = await prisma.membership.findMany({
            where: { studentId, status: { not: 'deleted' } },
            orderBy: { createdAt: 'desc' },
            include: {
                group: { select: { id: true, name: true, schedules: true } },
                direction: { select: { id: true, name: true } },
                teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                plan: {
                    select: {
                        id: true, name: true,
                        directionPlanId: true, legacyType: true, lessonFormat: true,
                        includedUnits: true, price: true, validityDays: true, emergencyFreezes: true,
                        individualClasses: true, groupClasses: true, theoryClasses: true,
                        direction: { select: { id: true, name: true } }
                    }
                },
                createdBy: { select: { name: true, lastName: true, middleName: true } },
                payments: {
                    orderBy: { paymentDate: 'desc' },
                    select: {
                        id: true, amount: true, type: true,
                        paymentDate: true, status: true, dueDate: true,
                        notes: true, paymentMethod: true,
                        basePrice: true, discountPercent: true,
                        discountReferralPercent: true,
                        discountFamilyPercent: true,
                        discountConcessionPercent: true
                    }
                },
                transactions: {
                    orderBy: { date: 'desc' },
                    take: 20
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        const mapped = memberships.map(m => ({
            ...m,
            _id: m.id,
            // Фронтенд ожидает groupId как объект (legacy Mongoose populate)
            groupId: m.group ? { ...m.group, _id: m.group.id } : null
        }));

        res.json({ success: true, memberships: mapped });
    } catch (error) {
        console.error('Get student memberships error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения абонементов' });
    }
});

// =====================================================
// DELETE /api/memberships/:id
// Полностью удалить ошибочно созданный абонемент.
// Платежи сохраняются, но отвязываются от абонемента.
// =====================================================
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const membershipId = req.params.id;
        const membership = await prisma.membership.findUnique({
            where: { id: membershipId },
            select: {
                id: true,
                studentId: true,
                plan: { select: { name: true } },
                type: true,
            },
        });
        if (!membership) {
            return res.status(404).json({ success: false, error: 'Абонемент не найден' });
        }

        const replacementMembership = await prisma.$transaction(async (tx) => {
            // Маркируем абонемент как удалённый (мягкое удаление для истории)
            await tx.membership.update({
                where: { id: membershipId },
                data: { status: 'deleted' }
            });

            await tx.student.updateMany({
                where: { activeMembershipId: membershipId },
                data: { activeMembershipId: null },
            });

            const replacement = await tx.membership.findFirst({
                where: {
                    studentId: membership.studentId,
                    status: 'active',
                },
                orderBy: { createdAt: 'desc' },
                select: { id: true },
            });
            if (replacement) {
                await tx.student.update({
                    where: { id: membership.studentId },
                    data: { activeMembershipId: replacement.id },
                });
            }
            return replacement;
        });

        res.json({
            success: true,
            message: `Абонемент «${membership.plan?.name || membership.type}» удалён`,
            replacementMembershipId: replacementMembership?.id || null,
        });
    } catch (error) {
        console.error('Delete membership error:', error);
        res.status(500).json({ success: false, error: 'Не удалось удалить абонемент' });
    }
});

// Цена считается только из фиксированного состава основной программы или пробного урока.
router.get('/price-preview', authenticate, async (req, res) => {
    try {
        const { directionId, lessonFormat, programMonths, additionalDiscountType, additionalDiscountValue, additionalDiscountReason } = req.query;
        const breakdown = await computeMembershipPrice({
            directionId,
            lessonFormat,
            programMonths,
            additionalDiscountType, additionalDiscountValue, additionalDiscountReason,
        });
        res.json({ success: true, ...breakdown });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message || 'Ошибка расчёта цены' });
    }
});

router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const {
            studentId,
            directionId,
            groupId,
            lessonFormat,
            programMonths,
            startDate,
            endDate,
            freezesAvailable,
            forceNew,
            renewalMembershipId: requestedRenewalId,
            renewMembershipId,
            initialFreezeStartDate,
            initialFreezeEndDate,
            initialFreezeReason,
            additionalDiscountType, additionalDiscountValue, additionalDiscountReason,
        } = req.body;

        const renewalMembershipId = renewMembershipId || requestedRenewalId;
        if (!studentId || !directionId) {
            return res.status(400).json({ success: false, error: 'Выберите ученика и направление' });
        }

        const expectedFormat = String(lessonFormat || '').trim().toLowerCase();
        if (!['trial', 'program', 'individual'].includes(expectedFormat)) {
            return res.status(400).json({ success: false, error: 'Выберите пробный урок, основную программу или индивидуальные уроки' });
        }

        const [student, direction] = await Promise.all([
            prisma.student.findUnique({ where: { id: studentId } }),
            prisma.direction.findUnique({ where: { id: directionId } }),
        ]);
        if (!student) return res.status(404).json({ success: false, error: 'Ученик не найден' });
        if (!direction?.isActive) return res.status(400).json({ success: false, error: 'Направление не найдено или отключено' });

        const finalGroupId = expectedFormat === 'program' ? (groupId || null) : null;
        if (finalGroupId) {
            const selectedGroup = await prisma.group.findUnique({
                where: { id: finalGroupId },
                select: { direction: true, isActive: true },
            });
            if (!selectedGroup?.isActive || ![direction.name, 'Ансамбль'].includes(selectedGroup.direction)) {
                return res.status(400).json({ success: false, error: 'Группа не относится к выбранному направлению' });
            }
        }

        const pricing = await computeMembershipPrice({
            directionId,
            lessonFormat: expectedFormat,
            programMonths,
            additionalDiscountType, additionalDiscountValue, additionalDiscountReason,
        });
        const price = pricing.totalPrice;
        const newClasses = pricing.lessonCount;
        const extensionDays = pricing.validityDays;

        let calculatedFreezes = 0;
        if (freezesAvailable !== undefined && freezesAvailable !== null && freezesAvailable !== '') {
            const overrideFreezes = Number(freezesAvailable);
            if (!Number.isInteger(overrideFreezes) || overrideFreezes < 0 || overrideFreezes > 24) {
                return res.status(400).json({ success: false, error: 'Количество заморозок должно быть от 0 до 24' });
            }
            calculatedFreezes = overrideFreezes;
        }

        const hasInitialFreeze = Boolean(initialFreezeStartDate || initialFreezeEndDate);
        if (hasInitialFreeze && (!initialFreezeStartDate || !initialFreezeEndDate)) {
            return res.status(400).json({
                success: false,
                error: 'Для заморозки при создании укажите дату начала и дату окончания',
            });
        }
        if (hasInitialFreeze) {
            const initialStart = new Date(initialFreezeStartDate);
            const initialEnd = new Date(initialFreezeEndDate);
            if (Number.isNaN(initialStart.getTime()) || Number.isNaN(initialEnd.getTime()) || initialEnd < initialStart) {
                return res.status(400).json({
                    success: false,
                    error: 'Период заморозки указан некорректно',
                });
            }
        }


        const teacherAttribution = shouldAttributeMembershipTeacher(expectedFormat)
            ? await resolveMembershipTeacherAttribution({ studentId, student, groupId: finalGroupId })
            : { teacherId: null, source: 'not_eligible', sourceId: null };

        if (renewalMembershipId && expectedFormat === 'trial') {
            return res.status(400).json({ success: false, error: 'Пробный абонемент нельзя продлить' });
        }
        if (renewalMembershipId && forceNew) {
            return res.status(400).json({ success: false, error: 'Продление и новый абонемент нельзя выбрать одновременно' });
        }

        // A purchase owns its prices, balances and dates. Renewals are linked records,
        // so buying 50k after 27k cannot reprice lessons that were already purchased.
        const result = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM "Student" WHERE id = ${studentId} FOR UPDATE`;
            let priorMembership = null;
            if (renewalMembershipId) {
                priorMembership = await tx.membership.findUnique({
                    where: { id: renewalMembershipId },
                    include: { plan: { select: { directionId: true } } },
                });
                if (!priorMembership
                    || priorMembership.studentId !== studentId
                    || ((priorMembership.directionId || priorMembership.plan?.directionId)
                        && (priorMembership.directionId || priorMembership.plan?.directionId) !== directionId)
                    || priorMembership.groupId !== finalGroupId
                    || ['trial', 'single_class', 'individual_single', 'single_lesson'].includes(priorMembership.type)
                    || priorMembership.lessonFormat === 'trial'
                    || !['active', 'expired'].includes(priorMembership.status)) {
                    throw new Error('Выбранный абонемент не подходит для продления. Обновите карточку ученика');
                }
                const successor = await tx.membership.findFirst({
                    where: { previousMembershipId: priorMembership.id, status: { not: 'deleted' } },
                    select: { id: true },
                });
                if (successor) throw new Error('Этот абонемент уже продлён. Выберите последний абонемент в цепочке');
            } else if (['program', 'individual'].includes(expectedFormat) && !forceNew) {
                priorMembership = await tx.membership.findFirst({
                    where: {
                        studentId,
                        directionId,
                        groupId: finalGroupId,
                        lessonFormat: expectedFormat,
                        status: 'active',
                        nextMemberships: { none: { status: { not: 'deleted' } } },
                    },
                    orderBy: [{ endDate: 'desc' }, { createdAt: 'desc' }],
                });
            }

            const now = new Date();
            const { start, end } = resolveMembershipPurchaseDates({
                previousMembership: priorMembership,
                startDate,
                endDate,
                validityDays: extensionDays,
                now,
            });
            const membership = await tx.membership.create({
                data: {
                    studentId,
                    directionId,
                    groupId: finalGroupId,
                    planId: null,
                    teacherId: priorMembership?.teacherId || teacherAttribution.teacherId || null,
                    lessonFormat: expectedFormat,
                    type: expectedFormat,
                    lessonPrice: Math.round(price / newClasses),
                    individualLessonPrice: pricing.componentPrices.individual,
                    theoryLessonPrice: pricing.componentPrices.theory,
                    groupLessonPrice: pricing.componentPrices.group,
                    programMonths: ['program', 'individual'].includes(expectedFormat) ? pricing.programMonths : null,
                    additionalDiscountType: pricing.additionalDiscountType,
                    additionalDiscountBasisPoints: pricing.additionalDiscountBasisPoints ?? null,
                    additionalDiscountAmount: pricing.additionalDiscountAmount,
                    additionalDiscountReason: pricing.additionalDiscountReason || null,
                    individualBudgetTotal: ['program', 'individual'].includes(expectedFormat) ? pricing.componentTotals.individual : null,
                    individualBudgetRemaining: ['program', 'individual'].includes(expectedFormat) ? pricing.componentTotals.individual : null,
                    totalClasses: newClasses,
                    classesRemaining: newClasses,
                    classesUsed: 0,
                    individualClassesRemaining: pricing.lessonCounts.individual,
                    theoryClassesRemaining: pricing.lessonCounts.theory,
                    groupClassesRemaining: pricing.lessonCounts.group,
                    startDate: start,
                    endDate: end,
                    activatedAt: now,
                    totalPrice: price,
                    paidAmount: 0,
                    remainingAmount: 0,
                    paymentStatus: DETACHED_MEMBERSHIP_PAYMENT_STATUS,
                    freezesAvailable: calculatedFreezes,
                    freezesUsed: 0,
                    emergencyFreezesAvailable: pricing.emergencyFreezesAvailable ?? 0,
                    emergencyFreezesUsed: 0,
                    status: 'active',
                    createdById: req.user.id,
                    previousMembershipId: priorMembership?.id || null,
                    source: priorMembership ? 'renewal' : 'manual',
                    basePrice: pricing.basePrice,
                    discountPercent: 0,
                    discountReferralPercent: 0,
                    discountFamilyPercent: 0,
                    discountConcessionPercent: 0,
                    discountManualPercent: 0,
                },
            });

            await tx.membershipTransaction.create({
                data: {
                    membershipId: membership.id,
                    type: 'initial',
                    amount: newClasses,
                    balanceAfter: newClasses,
                    reason: `${priorMembership ? 'Продление' : 'Новое обучение'}: ${newClasses} занятий, ${extensionDays} дней`
                        + (pricing.additionalDiscountAmount > 0 ? `; дополнительная скидка ${pricing.additionalDiscountAmount} ₸ только на индивидуальные: ${pricing.additionalDiscountReason}` : ''),
                    addedById: req.user.id,
                },
            });
            // Keep the currently valid purchase selected until the renewal begins.
            if (!priorMembership || start <= now || !student.activeMembershipId) {
                await tx.student.update({
                    where: { id: studentId },
                    data: { activeMembershipId: membership.id },
                });
            }
            await autoRecoverStudent(studentId, req.user.id, {
                source: 'new_membership',
                note: `Новое обучение (${expectedFormat})`,
                tx,
            });
            return { membership, isExtension: Boolean(priorMembership), start, end };
        });
        const { membership, isExtension, start: scheduleRangeStart, end: scheduleRangeEnd } = result;

        let scheduleGeneration = null;
        if (expectedFormat === 'program' && finalGroupId && scheduleRangeStart && scheduleRangeEnd) {
            try {
                scheduleGeneration = await generateClassesForGroupInRange({
                    groupId: finalGroupId,
                    startDate: scheduleRangeStart,
                    endDate: scheduleRangeEnd,
                    createdById: req.user.id,
                });
            } catch (scheduleErr) {
                console.error('Auto schedule generation failed:', scheduleErr);
                scheduleGeneration = { created: 0, skipped: 0, error: scheduleErr.message };
            }
        }

        let initialFreeze = null;
        let initialFreezeError = null;
        if (hasInitialFreeze) {
            try {
                initialFreeze = await createFreezeForMembership({
                    membershipId: membership.id,
                    type: 'regular',
                    startDate: initialFreezeStartDate,
                    endDate: initialFreezeEndDate,
                    reason: initialFreezeReason || 'Заморозка при создании абонемента',
                    createdById: req.user.id,
                });
            } catch (freezeError) {
                initialFreezeError = freezeError.message || 'Не удалось создать заморозку';
                console.error('Initial membership freeze failed:', freezeError);
            }
        }


        res.status(201).json({
            success: true,
            membership: { ...membership, _id: membership.id },
            isExtension,
            teacherAttribution,
            scheduleGeneration,
            initialFreeze: initialFreeze ? { ...initialFreeze, _id: initialFreeze.id } : null,
            initialFreezeError,
            message: isExtension
                ? `Обучение продлено: +${newClasses} занятий`
                : `Обучение оформлено: ${newClasses} занятий`,
        });
    } catch (error) {
        console.error('Create/extend membership error:', error);
        res.status(400).json({ success: false, error: error.message || 'Ошибка оформления обучения' });
    }
});



// =====================================================
// PATCH /api/memberships/:id/add-classes
// Вручную добавить занятия к абонементу
router.patch('/:id/add-classes', authenticate, requireAdmin, async (req, res) => {
    try {
        const { amount, reason, lessonType } = req.body;
        const qty = Number(amount);
        if (!Number.isInteger(qty) || qty <= 0) {
            return res.status(400).json({ success: false, error: 'Количество занятий должно быть положительным целым числом' });
        }

        const updated = await prisma.$transaction(async (tx) => {
            const locked = await tx.$queryRaw`SELECT * FROM "Membership" WHERE id = ${req.params.id} FOR UPDATE`;
            const membership = locked[0];
            if (!membership) throw Object.assign(new Error('Абонемент не найден'), { statusCode: 404 });

            const allowedLessonTypes = ['individual', 'theory', 'group'];
            const normalizedLessonType = allowedLessonTypes.includes(lessonType)
                ? lessonType
                : (allowedLessonTypes.includes(membership.lessonFormat) ? membership.lessonFormat : null);
            if (!normalizedLessonType) {
                throw Object.assign(new Error('Выберите вид добавляемого занятия'), { statusCode: 400 });
            }

            const componentBalanceField = {
                individual: 'individualClassesRemaining',
                theory: 'theoryClassesRemaining',
                group: 'groupClassesRemaining',
            }[normalizedLessonType];
            const lessonPrice = membershipLessonPrice(membership, normalizedLessonType);
            if (lessonPrice < 0 || (lessonPrice === 0 && !['program', 'individual'].includes(membership.lessonFormat))) {
                throw Object.assign(new Error('В абонементе не задана цена выбранного занятия'), { statusCode: 400 });
            }
            const newTotalClasses = membership.totalClasses + qty;
            const newTotalPrice = membership.totalPrice + (lessonPrice * qty);
            const updateData = {
                totalClasses: newTotalClasses,
                classesRemaining: membership.classesRemaining + qty,
                lessonPrice: Math.round(newTotalPrice / newTotalClasses),
                totalPrice: newTotalPrice,
                basePrice: Number(membership.basePrice || membership.totalPrice || 0) + (lessonPrice * qty),
            };
            if (membership[componentBalanceField] !== null) {
                updateData[componentBalanceField] = Number(membership[componentBalanceField] || 0) + qty;
            }

            if (normalizedLessonType === 'individual' && membership.individualBudgetRemaining != null) {
                updateData.individualBudgetRemaining = { increment: lessonPrice * qty };
            }
            const updated = await tx.membership.update({
                where: { id: req.params.id },
                data: updateData,
            });

            await tx.membershipTransaction.create({
                data: {
                    membershipId: membership.id,
                    type: 'extension',
                    amount: qty,
                    chargeAmount: lessonPrice * qty,
                    reason: `${reason || 'Ручное добавление занятий'} (${normalizedLessonType}, ${lessonPrice} ₸/зан.)`,
                    addedById: req.user.id
                }
            });

            return updated;

        });

        res.json({ success: true, membership: { ...updated, _id: updated.id } });
    } catch (error) {
        console.error('Add classes error:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.statusCode ? error.message : 'Ошибка добавления занятий' });
    }
});

// =====================================================
// PATCH /api/memberships/:id/remove-classes
// Вручную списать занятия с абонемента
// =====================================================
router.patch('/:id/remove-classes', authenticate, requireAdmin, async (req, res) => {
    try {
        const { amount, reason, lessonType } = req.body;
        const qty = Number(amount);
        if (!Number.isInteger(qty) || qty <= 0) {
            return res.status(400).json({ success: false, error: 'Количество занятий должно быть положительным целым числом' });
        }

        const updated = await prisma.$transaction(async (tx) => {
            const locked = await tx.$queryRaw`SELECT * FROM "Membership" WHERE id = ${req.params.id} FOR UPDATE`;
            const membership = locked[0];
            if (!membership) throw Object.assign(new Error('Абонемент не найден'), { statusCode: 404 });

            const allowedLessonTypes = ['individual', 'theory', 'group'];
            const normalizedLessonType = allowedLessonTypes.includes(lessonType)
                ? lessonType
                : (allowedLessonTypes.includes(membership.lessonFormat) ? membership.lessonFormat : null);
            if (!normalizedLessonType) {
                throw Object.assign(new Error('Выберите вид списываемого занятия'), { statusCode: 400 });
            }
            const componentBalanceField = {
                individual: 'individualClassesRemaining',
                theory: 'theoryClassesRemaining',
                group: 'groupClassesRemaining',
            }[normalizedLessonType];
            const componentBalance = membership[componentBalanceField];
            if (qty > membership.classesRemaining || (componentBalance !== null && qty > componentBalance)) {
                throw Object.assign(new Error('Нельзя списать больше доступного остатка этого вида занятий'), { statusCode: 400 });
            }

            const newRemaining = membership.classesRemaining - qty;
            const newUsed = membership.classesUsed + qty;
            const updateData = {
                classesRemaining: newRemaining,
                classesUsed: newUsed,
                status: newRemaining === 0 ? 'expired' : 'active',
            };
            if (componentBalance !== null) {
                updateData[componentBalanceField] = componentBalance - qty;
            }

            let removedBudget = null;
            if (normalizedLessonType === 'individual' && membership.individualBudgetRemaining != null) {
                const count = membership.individualClassesRemaining;
                const budget = membership.individualBudgetRemaining;
                removedBudget = Math.floor(budget / count) * qty + Math.max(0, qty - (count - (budget % count)));
                updateData.individualBudgetRemaining = { decrement: removedBudget };
            }
            const updated = await tx.membership.update({
                where: { id: req.params.id },
                data: updateData,
            });

            await tx.membershipTransaction.create({
                data: {
                    membershipId: membership.id,
                    type: 'manual_deduct',
                    amount: qty,
                    chargeAmount: removedBudget,
                    reason: `${reason || 'Ручное списание занятий'} (${normalizedLessonType})`,
                    addedById: req.user.id
                }
            });

            return updated;

        });

        res.json({ success: true, membership: { ...updated, _id: updated.id } });
    } catch (error) {
        console.error('Remove classes error:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.statusCode ? error.message : 'Ошибка списания занятий' });
    }
});

// =====================================================
// PATCH /api/memberships/:id/update-dates
// Изменить дату активации (startDate) абонемента
// =====================================================
router.patch('/:id/update-dates', authenticate, requireAdmin, async (req, res) => {
    try {
        const { startDate, endDate, freezesAvailable, emergencyFreezesAvailable } = req.body;
        const membership = await prisma.membership.findUnique({ where: { id: req.params.id } });
        if (!membership) return res.status(404).json({ success: false, error: 'Абонемент не найден' });

        const edit = buildMembershipEdit(membership, {
            ...(startDate ? { startDate } : {}),
            ...(endDate ? { endDate } : {}),
            ...(freezesAvailable !== undefined && freezesAvailable !== null && freezesAvailable !== '' ? { freezesAvailable } : {}),
            ...(emergencyFreezesAvailable !== undefined && emergencyFreezesAvailable !== null && emergencyFreezesAvailable !== '' ? { emergencyFreezesAvailable } : {}),
        });

        if (!edit.changed) {
            return res.json({ success: true, membership: { ...membership, _id: membership.id }, changed: false });
        }

        const updated = await prisma.$transaction(async (tx) => {
            const result = await tx.membership.update({
                where: { id: membership.id },
                data: edit.updateData,
            });
            await tx.membershipTransaction.create({
                data: {
                    membershipId: membership.id,
                    type: 'manual_adjust',
                    amount: 0,
                    reason: `Изменены параметры абонемента: ${edit.changes.join('; ')}`,
                    addedById: req.user.id,
                },
            });
            return result;
        });

        res.json({ success: true, membership: { ...updated, _id: updated.id }, changed: true });
    } catch (error) {
        console.error('Update dates error:', error);
        const isValidationError = error.code?.startsWith('INVALID_')
            || error.code === 'UNSUPPORTED_MEMBERSHIP_FIELD';
        res.status(isValidationError ? 400 : 500).json({
            success: false,
            error: isValidationError ? error.message : 'Ошибка обновления даты',
        });
    }
});

// =====================================================
// PATCH /api/memberships/:id/price
// Изменить итоговую цену абонемента вручную. Деньги не привязаны к абонементу:
// баланс ученика пополняется только отдельным платежом.
// =====================================================
router.patch('/:id/price', authenticate, requireAdmin, (req, res) => {
    res.status(400).json({ success: false, error: 'Стоимость программы фиксирована и не редактируется вручную' });
});

// =====================================================
// PATCH /api/memberships/:id
// Безопасно изменить параметры существующего абонемента одним действием.
// Обновляются только переданные и действительно изменённые поля.
// =====================================================
router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const membership = await prisma.membership.findUnique({ where: { id: req.params.id } });
        if (!membership) {
            return res.status(404).json({ success: false, error: 'Абонемент не найден' });
        }

        if (req.body?.totalPrice !== undefined) {
            return res.status(400).json({ success: false, error: 'Стоимость программы фиксирована и не редактируется вручную' });
        }
        const edit = buildMembershipEdit(membership, req.body || {});
        if (!edit.changed) {
            return res.json({
                success: true,
                changed: false,
                membership: { ...membership, _id: membership.id },
            });
        }

        const updated = await prisma.$transaction(async (tx) => {
            const result = await tx.membership.update({
                where: { id: membership.id },
                data: edit.updateData,
            });

            await tx.membershipTransaction.create({
                data: {
                    membershipId: membership.id,
                    type: 'manual_adjust',
                    amount: edit.updateData.totalPrice === undefined
                        ? 0
                        : Number(edit.updateData.totalPrice) - Number(membership.totalPrice || 0),
                    reason: `Изменены параметры абонемента: ${edit.changes.join('; ')}`,
                    addedById: req.user.id,
                },
            });

            return result;
        });

        res.json({
            success: true,
            changed: true,
            changedFields: Object.keys(edit.updateData),
            membership: { ...updated, _id: updated.id },
        });
    } catch (error) {
        console.error('Edit membership error:', error);
        if (error.code === 'MEMBERSHIP_NOT_FOUND') {
            return res.status(404).json({ success: false, error: error.message });
        }
        const isValidationError = error.code?.startsWith('INVALID_')
            || error.code === 'UNSUPPORTED_MEMBERSHIP_FIELD';
        res.status(isValidationError ? 400 : 500).json({
            success: false,
            error: isValidationError ? error.message : 'Ошибка обновления абонемента',
        });
    }
});

module.exports = router;
