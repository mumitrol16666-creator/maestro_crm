const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { computeMembershipPrice } = require('../utils/pricing');
const { autoRecoverStudent } = require('../utils/recovery');
const { generateClassesForGroupInRange } = require('../services/scheduleGenerator');
const { resolveMembershipPlanId } = require('../services/membershipPlanSync');
const { createFreezeForMembership } = require('../services/freezeService');

const SKIP_AUTO_SCHEDULE_TYPES = ['trial', 'single_class', 'individual_single', 'individual_package', 'single_lesson'];
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
                teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                plan: { select: { id: true, name: true, direction: { select: { id: true, name: true } } } },
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

// =====================================================
// GET /api/memberships/price-preview
// Превью цены тарифа для UI. Старая логика скидок/категорий отключена:
// цена берётся из тарифа или из ручной цены администратора.
// =====================================================
router.get('/price-preview', authenticate, async (req, res) => {
    try {
        const { studentId, type, basePriceOverride, groupId, directionPlanId, manualDiscountPercent } = req.query;
        if (!type) {
            return res.status(400).json({ success: false, error: 'Не указан type' });
        }
        const opts = {
            skipAllDiscounts: true,
            groupId: groupId || null,
            directionPlanId: directionPlanId || null,
            manualDiscountPercent,
        };
        if (basePriceOverride !== undefined && basePriceOverride !== '') {
            const n = Number(basePriceOverride);
            if (Number.isFinite(n) && n > 0) opts.basePriceOverride = n;
        }
        console.log('[price-preview] query:', { studentId, type, groupId, basePriceOverride });
        const breakdown = await computeMembershipPrice(studentId || null, type, opts);
        console.log('[price-preview] result:', { basePrice: breakdown.basePrice, totalPrice: breakdown.totalPrice, reasons: breakdown.reasons });
        res.json({ success: true, ...breakdown });
    } catch (error) {
        console.error('Price preview error:', error);
        res.status(500).json({ success: false, error: error.message || 'Ошибка расчёта цены' });
    }
});

// =====================================================
// POST /api/memberships
// Создать НОВЫЙ абонемент или ПРОДЛИТЬ существующий
// 
// Бизнес-логика продления:
// 1. Ищем активный абонемент ученика в той же группе
// 2. Если найден → ПРОДЛЕВАЕМ (плюсуем занятия, сдвигаем дату, добавляем платёж)
// 3. Если нет → создаём новый абонемент
// =====================================================
router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const {
            studentId, groupId, type: requestedType, directionPlanId,
            startDate, endDate,
            totalPrice,          // legacy: обрабатывается как basePriceOverride, если не передан отдельно
            basePriceOverride,
            manualFinalPrice,
            manualDiscountPercent,
            lessonFormat,
            freezesAvailable,
            initialFreezeStartDate,
            initialFreezeEndDate,
            initialFreezeReason,
            forceNew
        } = req.body;

        console.log(`📋 POST /api/memberships`, { studentId, groupId, requestedType, directionPlanId, totalPrice, basePriceOverride, manualFinalPrice, manualDiscountPercent });

        if (!studentId || !directionPlanId) {
            return res.status(400).json({ success: false, error: 'Выберите ученика, направление и тариф' });
        }

        const selectedPlan = await prisma.directionPlan.findUnique({
            where: { id: directionPlanId },
            include: { direction: { select: { id: true, name: true, isActive: true } } },
        });
        if (!selectedPlan || !selectedPlan.isActive || !selectedPlan.direction?.isActive) {
            return res.status(400).json({ success: false, error: 'Выбранный тариф не найден или отключён' });
        }
        if (selectedPlan.classes <= 0 || selectedPlan.days <= 0 || selectedPlan.price < 0) {
            return res.status(400).json({ success: false, error: 'В тарифе должны быть указаны занятия, срок действия и цена' });
        }

        const type = selectedPlan.type;
        const expectedFormat = selectedPlan.lessonFormat || (type.startsWith('individual_') ? 'individual' : (type === 'trial' ? 'trial' : 'group'));
        const isMixedType = expectedFormat === 'mixed';
        const isIndividualType = expectedFormat === 'individual';
        if (lessonFormat && !isMixedType && lessonFormat !== expectedFormat) {
            return res.status(400).json({ success: false, error: 'Формат урока не соответствует выбранному тарифу' });
        }
        if (groupId && !isIndividualType) {
            const selectedGroup = await prisma.group.findUnique({
                where: { id: groupId },
                select: { direction: true, isActive: true },
            });
            if (!selectedGroup?.isActive || ![selectedPlan.direction.name, 'Ансамбль'].includes(selectedGroup.direction)) {
                return res.status(400).json({ success: false, error: 'Группа не относится к выбранному направлению' });
            }
        }

        // Phase 2: если ученик был помечен как потерянный — автоматически возвращаем
        // его до создания/продления абонемента и записываем действие как возврат.
        if (studentId && req.user?.id) {
            await autoRecoverStudent(studentId, req.user.id, {
                source: 'new_membership',
                note: `Новый абонемент (${type})`,
            });
        }

        const config = { classes: selectedPlan.classes, days: selectedPlan.days, price: selectedPlan.price };
        
        const newClasses = config.classes;
        const extensionDays = config.days;
        
        const student = await prisma.student.findUnique({ where: { id: studentId } });
        if (!student) {
            return res.status(404).json({ success: false, error: 'Ученик не найден' });
        }
        const effectiveGender = student.gender;
        let calculatedFreezes = 0;
        const noFreezeTypes = ['trial', 'single_class', 'individual_single', 'individual_package', 'single_lesson'];
        if (!noFreezeTypes.includes(type) && expectedFormat !== 'individual') {
            calculatedFreezes = effectiveGender === 'female' ? 2 : 1;
            // Для квартального, возможно, нужно больше заморозок (как было 3)
            // Но пользователь сказал "у мужчин 1 заморозка у женщин 2", поэтому оставляем так.
        }
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

        // Единый расчёт цены со скидками.
        // basePriceOverride имеет приоритет; totalPrice оставлен как legacy fallback.
        const overrideCandidate = Number(basePriceOverride);
        const legacyCandidate = Number(totalPrice);
        const override = Number.isFinite(overrideCandidate) && overrideCandidate > 0
            ? overrideCandidate
            : (Number.isFinite(legacyCandidate) && legacyCandidate > 0 ? legacyCandidate : undefined);

        let pricing = await computeMembershipPrice(studentId, type, {
            basePriceOverride: override,
            skipAllDiscounts: true,
            directionPlanId,
            manualDiscountPercent: manualFinalPrice ? 0 : manualDiscountPercent,
        });
        const manualFinal = Number(manualFinalPrice);
        if (Number.isFinite(manualFinal) && manualFinal >= 0) {
            const base = Number(pricing.basePrice || selectedPlan.price || 0);
            const inferredDiscount = base > 0 && manualFinal < base
                ? Math.max(0, Math.min(100, Math.round(((base - manualFinal) / base) * 100)))
                : 0;
            pricing = {
                ...pricing,
                totalPrice: Math.round(manualFinal),
                discountPercent: inferredDiscount,
                discountManualPercent: inferredDiscount,
                reasons: inferredDiscount > 0 ? [`Дополнительная скидка −${inferredDiscount}%`] : []
            };
        }
        const price = pricing.totalPrice;

        // Денежные зачисления проходят отдельной операцией платежа.
        // Создание/продление абонемента меняет только занятия, срок и стоимость пакета.

        // ========== ИЩЕМ АКТИВНЫЙ АБОНЕМЕНТ В ЭТОЙ ГРУППЕ ==========
        let existingMembership = null;
        
        // Одноразовые абонементы (пробный или разовый) никогда ни с чем не сливаются
        const isOneOffType = ['trial', 'single_class', 'individual_single', 'single_lesson'].includes(type);
        const finalGroupId = isIndividualType ? null : (groupId || null);
        const selectedMembershipPlanId = await resolveMembershipPlanId({
            groupId: finalGroupId,
            type,
            directionPlanId,
        });
        const teacherAttribution = shouldAttributeMembershipTeacher(type)
            ? await resolveMembershipTeacherAttribution({ studentId, student, groupId: finalGroupId })
            : { teacherId: null, source: 'not_eligible', sourceId: null };

        if (!isOneOffType && !forceNew) {
            existingMembership = await prisma.membership.findFirst({
                where: {
                    studentId,
                    groupId: finalGroupId,
                    planId: selectedMembershipPlanId,
                    status: 'active',
                    // Не пытаемся прибавлять месячный абонемент к пробному или разовому!
                    type: { notIn: ['trial', 'single_class', 'individual_single', 'single_lesson'] }
                },
                include: { payments: true }
            });
        }

        let membership;
        let membershipTransaction;
        let isExtension = false;
        let scheduleRangeStart = null;
        let scheduleRangeEnd = null;

        if (existingMembership) {
            // ==========================================
            // ПРОДЛЕНИЕ СУЩЕСТВУЮЩЕГО АБОНЕМЕНТА
            // ==========================================
            isExtension = true;
            console.log(`🔄 ПРОДЛЕНИЕ абонемента ${existingMembership.id}:`,
                `было ${existingMembership.classesRemaining} занятий, +${newClasses}`);

            // Определяем новую дату окончания:
            // Если старый ещё не истёк → продлеваем от endDate
            // Если уже истёк → продлеваем от сегодня
            const now = new Date();
            const currentEnd = new Date(existingMembership.endDate);
            const baseDate = currentEnd > now ? currentEnd : now;
            const newEndDate = endDate ? new Date(endDate) : new Date(baseDate);
            if (!endDate) {
                newEndDate.setDate(newEndDate.getDate() + extensionDays);
            }

            let newType = type || existingMembership.type;

            const newTotalPrice = existingMembership.totalPrice + price;

            const mPlan = selectedMembershipPlanId ? await prisma.membershipPlan.findUnique({
                where: { id: selectedMembershipPlanId }
            }) : null;

            const renewalPayload = {
                type: newType,
                planId: selectedMembershipPlanId,
                teacherId: existingMembership.teacherId || teacherAttribution.teacherId || null,
                lessonFormat: expectedFormat,
                totalClasses: existingMembership.totalClasses + newClasses,
                classesRemaining: existingMembership.classesRemaining + newClasses,
                endDate: newEndDate,
                totalPrice: newTotalPrice,
                paidAmount: 0,
                remainingAmount: 0,
                paymentStatus: DETACHED_MEMBERSHIP_PAYMENT_STATUS,
                freezesAvailable: existingMembership.freezesAvailable + calculatedFreezes,
                source: 'renewal',
                basePrice: pricing.basePrice,
                discountPercent: pricing.discountPercent,
                discountReferralPercent: pricing.discountReferralPercent,
                discountFamilyPercent: pricing.discountFamilyPercent,
                discountConcessionPercent: pricing.discountConcessionPercent,
                discountManualPercent: pricing.discountManualPercent
            };

            if (mPlan && [mPlan.individualClasses, mPlan.groupClasses, mPlan.theoryClasses].some(value => value !== null)) {
                renewalPayload.individualClassesRemaining = (existingMembership.individualClassesRemaining ?? 0) + (mPlan.individualClasses ?? 0);
                renewalPayload.groupClassesRemaining = (existingMembership.groupClassesRemaining ?? 0) + (mPlan.groupClasses ?? 0);
                renewalPayload.theoryClassesRemaining = (existingMembership.theoryClassesRemaining ?? 0) + (mPlan.theoryClasses ?? 0);
                renewalPayload.emergencyFreezesAvailable = (existingMembership.emergencyFreezesAvailable ?? 0) + (mPlan.emergencyFreezes ?? 0);
            }

            // Обновляем абонемент в БД
            membership = await prisma.membership.update({
                where: { id: existingMembership.id },
                data: renewalPayload
            });

            // Создаём транзакцию (лог) продления
            membershipTransaction = await prisma.membershipTransaction.create({
                data: {
                    membershipId: membership.id,
                    type: 'extension',
                    amount: newClasses,
                    reason: `Продление: +${newClasses} занятий, +${extensionDays} дней. ` +
                            `Период до ${newEndDate.toLocaleDateString('ru')}.`,
                    addedById: req.user.id
                }
            });

            console.log(`✅ Абонемент продлён: ${membership.classesRemaining} занятий, до ${newEndDate.toLocaleDateString('ru')}`);

            scheduleRangeStart = currentEnd > now ? currentEnd : now;
            scheduleRangeEnd = newEndDate;

        } else {
            // ==========================================
            // СОЗДАНИЕ НОВОГО АБОНЕМЕНТА
            // ==========================================
            const start = startDate ? new Date(startDate) : new Date();
            const end = endDate ? new Date(endDate) : new Date(start);
            if (!endDate) {
                end.setDate(end.getDate() + extensionDays);
            }

            const paidAmount = 0;

            // Ищем предыдущий non-trial абонемент (любого статуса), чтобы построить цепочку продлений
            const priorMembership = await prisma.membership.findFirst({
                where: {
                    studentId,
                    type: { notIn: ['trial', 'single_class', 'individual_single'] },
                },
                orderBy: { createdAt: 'desc' },
                select: { id: true, endDate: true },
            });
            const isRenewalOfPrior = !!priorMembership && !['trial', 'single_class', 'individual_single'].includes(type || 'monthly');
            const mPlan = selectedMembershipPlanId ? await prisma.membershipPlan.findUnique({
                where: { id: selectedMembershipPlanId }
            }) : null;

            const createPayload = {
                studentId,
                groupId: finalGroupId,
                planId: selectedMembershipPlanId,
                teacherId: teacherAttribution.teacherId || null,
                lessonFormat: expectedFormat,
                type: type || 'monthly',
                totalClasses: newClasses,
                classesRemaining: newClasses,
                classesUsed: 0,
                startDate: start,
                endDate: end,
                activatedAt: new Date(),
                totalPrice: price,
                paidAmount,
                remainingAmount: 0,
                paymentStatus: DETACHED_MEMBERSHIP_PAYMENT_STATUS,
                freezesAvailable: calculatedFreezes,
                freezesUsed: 0,
                status: 'active',
                createdById: req.user.id,
                previousMembershipId: isRenewalOfPrior ? priorMembership.id : null,
                source: isRenewalOfPrior ? 'renewal' : 'manual',
                basePrice: pricing.basePrice,
                discountPercent: pricing.discountPercent,
                discountReferralPercent: pricing.discountReferralPercent,
                discountFamilyPercent: pricing.discountFamilyPercent,
                discountConcessionPercent: pricing.discountConcessionPercent,
                discountManualPercent: pricing.discountManualPercent
            };

            if (mPlan && [mPlan.individualClasses, mPlan.groupClasses, mPlan.theoryClasses].some(value => value !== null)) {
                createPayload.individualClassesRemaining = mPlan.individualClasses ?? 0;
                createPayload.groupClassesRemaining = mPlan.groupClasses ?? 0;
                createPayload.theoryClassesRemaining = mPlan.theoryClasses ?? 0;
                createPayload.emergencyFreezesAvailable = mPlan.emergencyFreezes ?? 0;
                createPayload.emergencyFreezesUsed = 0;
            }

            membership = await prisma.membership.create({
                data: createPayload
            });

            // Создаём начальную транзакцию
            membershipTransaction = await prisma.membershipTransaction.create({
                data: {
                    membershipId: membership.id,
                    type: 'initial',
                    amount: newClasses,
                    balanceAfter: newClasses,
                    reason: `Новый абонемент: ${newClasses} занятий, ${extensionDays} дней`,
                    addedById: req.user.id
                }
            });

            console.log(`✅ Новый абонемент создан: ${membership.id}, ${newClasses} занятий`);

            scheduleRangeStart = start;
            scheduleRangeEnd = end;
        }

        await prisma.student.update({
            where: { id: studentId },
            data: { activeMembershipId: membership.id }
        });

        let scheduleGeneration = null;
        if (
            finalGroupId
            && !SKIP_AUTO_SCHEDULE_TYPES.includes(membership.type)
            && scheduleRangeStart
            && scheduleRangeEnd
        ) {
            try {
                scheduleGeneration = await generateClassesForGroupInRange({
                    groupId: finalGroupId,
                    startDate: scheduleRangeStart,
                    endDate: scheduleRangeEnd,
                    createdById: req.user.id,
                });
                console.log('📅 Автогенерация расписания:', scheduleGeneration);
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
                ? `Абонемент продлён! +${newClasses} занятий`
                : `Новый абонемент создан: ${newClasses} занятий`
        });
    } catch (error) {
        console.error('Create/extend membership error:', error);
        res.status(500).json({ success: false, error: error.message || 'Ошибка создания абонемента' });
    }
});



// =====================================================
// PATCH /api/memberships/:id/add-classes
// Вручную добавить занятия к абонементу
// =====================================================
router.patch('/:id/add-classes', authenticate, requireAdmin, async (req, res) => {
    try {
        const { amount, reason } = req.body;
        const qty = Number.parseInt(amount, 10);
        if (!Number.isInteger(qty) || qty <= 0) {
            return res.status(400).json({ success: false, error: 'Количество занятий должно быть положительным целым числом' });
        }

        const membership = await prisma.membership.findUnique({ where: { id: req.params.id } });
        if (!membership) return res.status(404).json({ success: false, error: 'Абонемент не найден' });

        const updated = await prisma.membership.update({
            where: { id: req.params.id },
            data: {
                totalClasses: membership.totalClasses + qty,
                classesRemaining: membership.classesRemaining + qty
            }
        });

        await prisma.membershipTransaction.create({
            data: {
                membershipId: membership.id,
                type: 'extension',
                amount: qty,
                reason: reason || 'Ручное добавление занятий',
                addedById: req.user.id
            }
        });

        res.json({ success: true, membership: { ...updated, _id: updated.id } });
    } catch (error) {
        console.error('Add classes error:', error);
        res.status(500).json({ success: false, error: 'Ошибка добавления занятий' });
    }
});

// =====================================================
// PATCH /api/memberships/:id/remove-classes
// Вручную списать занятия с абонемента
// =====================================================
router.patch('/:id/remove-classes', authenticate, requireAdmin, async (req, res) => {
    try {
        const { amount, reason } = req.body;
        const qty = Number.parseInt(amount, 10);
        if (!Number.isInteger(qty) || qty <= 0) {
            return res.status(400).json({ success: false, error: 'Количество занятий должно быть положительным целым числом' });
        }

        const membership = await prisma.membership.findUnique({ where: { id: req.params.id } });
        if (!membership) return res.status(404).json({ success: false, error: 'Абонемент не найден' });

        const newRemaining = Math.max(0, membership.classesRemaining - qty);
        const newUsed = membership.classesUsed + qty;

        const updated = await prisma.membership.update({
            where: { id: req.params.id },
            data: {
                classesRemaining: newRemaining,
                classesUsed: newUsed,
                // Если занятий не осталось — завершаем абонемент
                status: newRemaining === 0 ? 'expired' : 'active'
            }
        });

        await prisma.membershipTransaction.create({
            data: {
                membershipId: membership.id,
                type: 'manual_deduct',
                amount,
                reason: reason || 'Ручное списание занятий',
                addedById: req.user.id
            }
        });

        res.json({ success: true, membership: { ...updated, _id: updated.id } });
    } catch (error) {
        console.error('Remove classes error:', error);
        res.status(500).json({ success: false, error: 'Ошибка списания занятий' });
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

        const updateData = {};
        if (startDate) updateData.startDate = new Date(startDate);
        if (endDate)   updateData.endDate   = new Date(endDate);
        if (freezesAvailable !== undefined && freezesAvailable !== null && freezesAvailable !== '') {
            updateData.freezesAvailable = parseInt(freezesAvailable, 10);
        }
        if (emergencyFreezesAvailable !== undefined && emergencyFreezesAvailable !== null && emergencyFreezesAvailable !== '') {
            updateData.emergencyFreezesAvailable = parseInt(emergencyFreezesAvailable, 10);
        }

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ success: false, error: 'Нечего обновлять' });
        }

        const updated = await prisma.membership.update({
            where: { id: req.params.id },
            data: updateData
        });

        let adjustReason = `Изменены параметры абонемента:`;
        if (startDate) adjustReason += ` startDate=${startDate}`;
        if (endDate) adjustReason += ` endDate=${endDate}`;
        if (freezesAvailable !== undefined && freezesAvailable !== null && freezesAvailable !== '') {
            adjustReason += ` freezesAvailable=${freezesAvailable}`;
        }
        if (emergencyFreezesAvailable !== undefined && emergencyFreezesAvailable !== null && emergencyFreezesAvailable !== '') {
            adjustReason += ` emergencyFreezesAvailable=${emergencyFreezesAvailable}`;
        }

        await prisma.membershipTransaction.create({
            data: {
                membershipId: membership.id,
                type: 'manual_adjust',
                amount: 0,
                reason: adjustReason,
                addedById: req.user.id
            }
        });

        res.json({ success: true, membership: { ...updated, _id: updated.id } });
    } catch (error) {
        console.error('Update dates error:', error);
        res.status(500).json({ success: false, error: 'Ошибка обновления даты' });
    }
});

// =====================================================
// PATCH /api/memberships/:id/price
// Изменить итоговую цену абонемента вручную. Деньги не привязаны к абонементу:
// баланс ученика пополняется только отдельным платежом.
// =====================================================
router.patch('/:id/price', authenticate, requireAdmin, async (req, res) => {
    try {
        const newPriceRaw = Number(req.body?.totalPrice);
        if (!Number.isFinite(newPriceRaw) || newPriceRaw < 0) {
            return res.status(400).json({ success: false, error: 'Некорректная цена' });
        }
        const newPrice = Math.round(newPriceRaw);

        const membership = await prisma.membership.findUnique({ where: { id: req.params.id } });
        if (!membership) return res.status(404).json({ success: false, error: 'Абонемент не найден' });

        const updated = await prisma.membership.update({
            where: { id: req.params.id },
            data: {
                totalPrice: newPrice,
                basePrice: newPrice, // ручная правка — сброс скидок
                discountPercent: 0,
                discountReferralPercent: 0,
                discountFamilyPercent: 0,
                discountConcessionPercent: 0,
                paidAmount: 0,
                remainingAmount: 0,
                paymentStatus: DETACHED_MEMBERSHIP_PAYMENT_STATUS
            }
        });

        await prisma.membershipTransaction.create({
            data: {
                membershipId: membership.id,
                type: 'manual_adjust',
                amount: newPrice - Number(membership.totalPrice || 0),
                reason: `Изменена цена: ${membership.totalPrice || 0} → ${newPrice}`,
                addedById: req.user.id
            }
        });

        res.json({ success: true, membership: { ...updated, _id: updated.id } });
    } catch (error) {
        console.error('Update price error:', error);
        res.status(500).json({ success: false, error: 'Ошибка обновления цены' });
    }
});

module.exports = router;
