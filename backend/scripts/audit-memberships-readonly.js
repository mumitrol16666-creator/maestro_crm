/*
 * Read-only full membership audit. No UPDATE/DELETE/INSERT, including migrations.
 * Run from backend with DATABASE_URL set: node scripts/audit-memberships-readonly.js
 * JSON (default) includes the evidence snapshot; --format markdown emits a table.
 * Re-render a saved JSON report without connecting: --input /absolute/report.json
 * Reports contain student names and IDs: keep them local and do not commit them.
 */
const fs = require('node:fs');

const MONEY_FIELDS = ['totalPrice', 'paidAmount', 'remainingAmount'];
const COUNTER_FIELDS = ['classesRemaining', 'classesUsed', 'individualClassesRemaining', 'groupClassesRemaining', 'theoryClassesRemaining'];
const COMPONENTS = { individual: 'individualClassesRemaining', group: 'groupClassesRemaining', theory: 'theoryClassesRemaining' };
const PRICE_FIELDS = { individual: 'individualLessonPrice', group: 'groupLessonPrice', theory: 'theoryLessonPrice' };
const CLASSIFICATION_LABELS = {
    safe_empty_candidate: 'Пустой лишний: кандидат на удаление после проверки списка',
    archive_keep_history: 'Архивировать/сохранить историю',
    keep_current_legacy: 'Действующий legacy: оставить до окончания',
    keep_current_program: 'Действующая новая программа: оставить',
    manual_review: 'Ручная проверка / решение о замене',
};

const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
const index = (rows, key) => {
    const result = new Map();
    for (const row of rows) {
        if (!result.has(row[key])) result.set(row[key], []);
        result.get(row[key]).push(row);
    }
    return result;
};
const countBy = (rows, key) => Object.fromEntries([...index(rows, key)].map(([value, values]) => [value, values.length]));

function lessonOccurrenceTime(lesson) {
    const date = new Date(lesson.date);
    if (!Number.isFinite(date.getTime())) return null;
    const time = /^\d{2}:\d{2}$/.test(String(lesson.startTime || '')) ? lesson.startTime : '00:00';
    return Date.parse(`${date.toISOString().slice(0, 10)}T${time}:00+05:00`);
}

// Budget allocation, not the rounded per-lesson display price, is authoritative.
// In particular, a fully discounted individual component legitimately costs zero.
function auditProgramAllocation(membership, txs, charges) {
    const issues = [];
    const warnings = [];
    const validMoney = value => value !== null && value !== undefined && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
    if (Object.values(PRICE_FIELDS).some(field => !validMoney(membership[field]))) issues.push('В программе отсутствует неотрицательная целочисленная цена компонента');
    if (['groupLessonPrice', 'theoryLessonPrice'].some(field => validMoney(membership[field]) && Number(membership[field]) === 0)) {
        issues.push('Нулевая цена квартета/теории: дополнительная скидка допустима только на индивидуальные занятия');
    }
    const hasBudget = membership.individualBudgetTotal != null || membership.individualBudgetRemaining != null;
    let budgetLedger = null;
    if (hasBudget) {
        if (!validMoney(membership.individualBudgetTotal) || !validMoney(membership.individualBudgetRemaining)) {
            issues.push('Некорректный снимок бюджета индивидуальных занятий');
        } else {
            const movements = txs.filter(tx => ['deduct', 'manual_deduct', 'add', 'extension'].includes(tx.type));
            const unresolved = movements.filter(tx => !tx.classType && !tx.componentHint ||
                (tx.classType === 'individual' || tx.componentHint === 'individual') && !validMoney(tx.chargeAmount));
            const individual = movements.filter(tx => (tx.classType === 'individual' || tx.componentHint === 'individual') && validMoney(tx.chargeAmount));
            const expectedRemaining = Number(membership.individualBudgetTotal) + individual.reduce((total, tx) =>
                total + (['add', 'extension'].includes(tx.type) ? 1 : -1) * Number(tx.chargeAmount), 0);
            budgetLedger = { initialBudget: membership.individualBudgetTotal, remainingBudget: membership.individualBudgetRemaining,
                expectedRemaining, movementCount: individual.length, unresolvedTransactionIds: unresolved.map(tx => tx.id),
                status: unresolved.length ? 'incomplete_evidence' : expectedRemaining === Number(membership.individualBudgetRemaining) ? 'matched' : 'mismatch' };
            if (unresolved.length) warnings.push('Журнал бюджета неполон: не все движения определены по компоненту/сумме');
            else if (budgetLedger.status === 'mismatch') issues.push('Остаток индивидуального бюджета не сходится с журналом денежных распределений');
        }
    }
    for (const charge of charges.filter(row => row.classStatus === 'completed' && row.chargeSource === 'membership')) {
        if (charge.classType === 'individual' && hasBudget) {
            const ledger = txs.filter(tx => tx.classId === charge.classId && ['deduct', 'manual_deduct', 'add'].includes(tx.type));
            if (!ledger.length || ledger.some(tx => !validMoney(tx.chargeAmount))) {
                warnings.push(`Нет полного денежного журнала индивидуального списания ${charge.id}`);
                continue;
            }
            const netCharge = ledger.reduce((total, tx) => total + (tx.type === 'add' ? -1 : 1) * Number(tx.chargeAmount), 0);
            if (netCharge !== Number(charge.chargeAmount)) issues.push(`Подтверждённое списание ${charge.id} не сходится с денежным журналом`);
        } else if (Number(charge.chargeAmount) !== Number(membership[PRICE_FIELDS[charge.classType]])) {
            issues.push(`Подтверждённое списание ${charge.id} не равно снимку компонента`);
        }
    }
    return { issues, warnings, budgetLedger };
}

async function readSnapshot(connectionString) {
    const { Client } = require('pg');
    const client = new Client({ connectionString, options: '-c default_transaction_read_only=on', application_name: 'maestro_membership_readonly_audit' });
    await client.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const metadata = (await client.query(`SELECT now() AS "asOf", current_setting('transaction_read_only') AS "readOnly"`)).rows[0];
        if (metadata.readOnly !== 'on') throw new Error('Audit requires a read-only transaction');
        const memberships = (await client.query(`
            SELECT m.id, m."studentId", m."groupId", m."planId", m."directionId", m."teacherId",
                m."lessonFormat", m.type, m.status, m."startDate", m."endDate", m."activatedAt", m."createdAt", m."updatedAt",
                m."totalClasses", m."classesRemaining", m."classesUsed", m."individualClassesRemaining", m."groupClassesRemaining", m."theoryClassesRemaining",
                m."lessonPrice", m."individualLessonPrice", m."groupLessonPrice", m."theoryLessonPrice",
                (to_jsonb(m)->>'programMonths')::integer AS "programMonths",
                to_jsonb(m)->>'additionalDiscountType' AS "additionalDiscountType",
                (to_jsonb(m)->>'additionalDiscountBasisPoints')::integer AS "additionalDiscountBasisPoints",
                (to_jsonb(m)->>'additionalDiscountAmount')::integer AS "additionalDiscountAmount",
                (COALESCE(to_jsonb(m)->>'additionalDiscountReason', '') <> '') AS "hasAdditionalDiscountReason",
                (to_jsonb(m)->>'individualBudgetTotal')::integer AS "individualBudgetTotal",
                (to_jsonb(m)->>'individualBudgetRemaining')::integer AS "individualBudgetRemaining",
                m."totalPrice", m."basePrice", m."paidAmount", m."remainingAmount", m."paymentStatus",
                m."discountPercent", m."discountReferralPercent", m."discountFamilyPercent", m."discountConcessionPercent", m."discountManualPercent",
                m."freezesAvailable", m."freezesUsed", m."emergencyFreezesAvailable", m."emergencyFreezesUsed",
                m."previousMembershipId", m."bookingId", m.source, m."createdById",
                m."followUpStatus", m."followUpAt", m."paymentPromiseDate",
                (COALESCE(m."followUpNote", '') <> '') AS "hasFollowUpNote",
                g.name AS "groupName", g.direction AS "groupDirection", g."isActive" AS "groupActive",
                d.name AS "directionName", p.name AS "planName", p."legacyType" AS "planType", p.price AS "planPrice",
                p."includedUnits" AS "planUnits", p."directionId" AS "planDirectionId",
                CONCAT_WS(' ', t."lastName", t.name, t."middleName") AS "teacherName"
            FROM "Membership" m
            LEFT JOIN "Group" g ON g.id = m."groupId"
            LEFT JOIN "Direction" d ON d.id = m."directionId"
            LEFT JOIN "MembershipPlan" p ON p.id = m."planId"
            LEFT JOIN "Student" t ON t.id = m."teacherId"
            ORDER BY m."studentId", m."createdAt", m.id
        `)).rows;
        const students = (await client.query(`
            SELECT s.id, CONCAT_WS(' ', s."lastName", s.name, s."middleName") AS name,
                s.role, s.status, s."pausedUntil", s."accountBalance", s."activeMembershipId", s."createdAt", s."learningDirections",
                s."assignedTeacherId", CONCAT_WS(' ', t."lastName", t.name, t."middleName") AS "assignedTeacherName"
            FROM "Student" s LEFT JOIN "Student" t ON t.id = s."assignedTeacherId"
            WHERE s.role = 'student' OR s.id IN (SELECT "studentId" FROM "Membership") OR s."activeMembershipId" IS NOT NULL
            ORDER BY s."lastName", s.name, s.id
        `)).rows;
        const payments = (await client.query(`
            SELECT id, "studentId", "membershipId", "relatedPaymentId", "bookingId", "relatedClassId",
                amount, type, status, "paymentDate", "paymentMethod", "basePrice", "discountPercent",
                "discountReferralPercent", "discountFamilyPercent", "discountConcessionPercent"
            FROM "Payment" ORDER BY "paymentDate", id
        `)).rows;
        const transactions = (await client.query(`
            SELECT mt.id, mt."membershipId", mt.type, mt.amount, mt."balanceAfter", mt.date, mt."classId", mt."freezeId", mt."addedById",
                (to_jsonb(mt)->>'chargeAmount')::integer AS "chargeAmount",
                CASE WHEN mt.reason LIKE '%(individual,%' OR mt.reason LIKE '%(individual)%' THEN 'individual'
                     WHEN mt.reason LIKE '%(group,%' OR mt.reason LIKE '%(group)%' THEN 'group'
                     WHEN mt.reason LIKE '%(theory,%' OR mt.reason LIKE '%(theory)%' THEN 'theory' END AS "componentHint",
                c.status AS "classStatus", c.date AS "classDate", c."classType", c.price AS "classPrice"
            FROM "MembershipTransaction" mt LEFT JOIN "Class" c ON c.id = mt."classId" ORDER BY mt.date, mt.id
        `)).rows;
        const classAttendees = (await client.query(`
            SELECT a.id, a."studentId", a."classId", a.attended, a."attendanceStatus", a."autoDeducted",
                a."chargeAmount", a."chargedMembershipId", a."chargeSource", a."markedAt",
                c.status AS "classStatus", c.date AS "classDate", c."classType", c.price AS "classPrice",
                c."groupId", c."teacherId", c."isPractice", c."reviewedAt",
                g.name AS "groupName", g.direction AS "groupDirection",
                CONCAT_WS(' ', t."lastName", t.name, t."middleName") AS "teacherName"
            FROM "ClassAttendee" a JOIN "Class" c ON c.id = a."classId"
            LEFT JOIN "Group" g ON g.id = c."groupId"
            LEFT JOIN "Student" t ON t.id = c."teacherId"
            ORDER BY c.date, a.id
        `)).rows;
        const freezes = (await client.query(`
            SELECT id, "studentId", "membershipId", type, status, "startDate", "endDate", "frozenClasses", "classesUsed"
            FROM "Freeze" ORDER BY "startDate", id
        `)).rows;
        const adjustments = (await client.query(`
            SELECT id, "entityId" AS "studentId", "createdAt", metadata->>'amount' AS amount,
                metadata->>'balanceBefore' AS "balanceBefore", metadata->>'balanceAfter' AS "balanceAfter"
            FROM "ActivityLog" WHERE action = 'balance_adjustment' AND "entityType" = 'Student'
            ORDER BY "createdAt", id
        `)).rows;
        const studentGroups = (await client.query(`
            SELECT sg."studentId", sg."groupId", sg.status, g.name AS "groupName", g.direction, g."isActive"
            FROM "StudentGroup" sg JOIN "Group" g ON g.id = sg."groupId"
            ORDER BY sg."studentId", sg."groupId"
        `)).rows;
        const scheduledClasses = (await client.query(`
            SELECT id, date, "startTime", status, "classType", "groupId", "individualStudentId", "teacherId", "isPractice"
            FROM "Class" WHERE (date >= CURRENT_DATE AND status IN ('scheduled', 'started', 'not_filled')) OR status = 'pending_admin_review'
            ORDER BY date, "startTime", id
        `)).rows;
        return { metadata, memberships, students, payments, transactions, classAttendees, freezes, adjustments, studentGroups, scheduledClasses };
    } finally {
        await client.query('ROLLBACK').catch(() => {});
        await client.end();
    }
}

function analyzeSnapshot(snapshot) {
    const { memberships, students, payments, transactions, classAttendees, freezes, adjustments = [], studentGroups = [], scheduledClasses = [] } = snapshot;
    const asOf = new Date(snapshot.metadata.asOf);
    const studentsById = new Map(students.map(student => [student.id, student]));
    const membershipsById = new Map(memberships.map(membership => [membership.id, membership]));
    const membershipsByStudent = index(memberships, 'studentId');
    const paymentsByStudent = index(payments, 'studentId');
    const paymentsByMembership = index(payments, 'membershipId');
    const transactionsByMembership = index(transactions, 'membershipId');
    const attendeesByMembership = index(classAttendees, 'chargedMembershipId');
    const attendeesByStudent = index(classAttendees, 'studentId');
    const freezesByMembership = index(freezes, 'membershipId');
    const adjustmentsByStudent = index(adjustments, 'studentId');
    const activePointers = index(students.filter(student => student.activeMembershipId), 'activeMembershipId');
    const successors = index(memberships.filter(membership => membership.previousMembershipId), 'previousMembershipId');
    const groupsByStudent = index(studentGroups, 'studentId');
    const confirmed = classAttendees.filter(attendee => attendee.classStatus === 'completed');
    const anomalies = [];
    const rows = memberships.map(membership => {
        const student = studentsById.get(membership.studentId);
        const membershipPayments = paymentsByMembership.get(membership.id) || [];
        const studentPayments = paymentsByStudent.get(membership.studentId) || [];
        const txs = transactionsByMembership.get(membership.id) || [];
        const charges = attendeesByMembership.get(membership.id) || [];
        const refs = activePointers.get(membership.id) || [];
        const next = successors.get(membership.id) || [];
        const membershipFreezes = freezesByMembership.get(membership.id) || [];
        const relatedStudentCharges = attendeesByStudent.get(membership.studentId) || [];
        const from = new Date(membership.startDate);
        const until = new Date(membership.endDate);
        const current = membership.status === 'active' && from <= asOf && until >= asOf;
        const future = membership.status === 'active' && from > asOf && until >= from;
        const ended = until < asOf;
        const issues = [];
        let programAllocation = null;
        if (!student) issues.push('Отсутствует связанный ученик');
        if (!Number.isFinite(from.getTime()) || !Number.isFinite(until.getTime()) || until < from) issues.push('Некорректные даты абонемента');
        if (refs.some(ref => ref.id !== membership.studentId)) issues.push('Активная ссылка другого ученика');
        if (charges.some(charge => charge.studentId !== membership.studentId)) issues.push('На абонемент ссылается списание другого ученика');
        if (membershipPayments.some(payment => payment.studentId !== membership.studentId)) issues.push('На абонемент ссылается платёж другого ученика');
        if (membership.lessonFormat === 'program') {
            programAllocation = auditProgramAllocation(membership, txs, charges);
            issues.push(...programAllocation.issues);
            const componentSum = Object.values(COMPONENTS).reduce((total, field) => total + Number(membership[field] || 0), 0);
            if (componentSum !== membership.classesRemaining) issues.push('Остатки компонентов не равны общему остатку');
            if (Number(membership.classesRemaining) + Number(membership.classesUsed) !== membership.totalClasses) issues.push('Остаток + использовано не равны купленному количеству');
            if (COUNTER_FIELDS.some(field => Number(membership[field]) < 0)) issues.push('Отрицательный счётчик программы');
        }
        if (charges.some(charge => charge.chargeAmount > 0 && charge.classStatus !== 'completed')) issues.push('Есть денежное списание у неподтверждённого урока');
        const valuableUnits = COUNTER_FIELDS.filter(field => field !== 'classesUsed').some(field => Number(membership[field]) > 0);
        const monetaryClaims = MONEY_FIELDS.some(field => Number(membership[field]) !== 0);
        const financialHistory = Number(membership.classesUsed || 0) !== 0 || membershipPayments.length || charges.length
            || txs.some(tx => tx.type !== 'initial' || tx.amount !== 0);
        const workflowHistory = membershipFreezes.length || refs.length || next.length || membership.previousMembershipId
            || membership.bookingId || membership.hasFollowUpNote || membership.followUpAt || membership.paymentPromiseDate;
        // A detached payment belongs to the student's wallet, not to a specific purchase.
        // Without allocation evidence it disqualifies automatic "empty" classification.
        const studentFinancialContext = Number(student?.accountBalance || 0) !== 0 || studentPayments.length
            || relatedStudentCharges.some(charge => charge.chargeAmount > 0)
            || (adjustmentsByStudent.get(membership.studentId) || []).length;
        let classification;
        let reason;
        if (issues.length) {
            classification = 'manual_review'; reason = issues.join('; ');
        } else if (!current && !future && !monetaryClaims && !valuableUnits && !financialHistory && !workflowHistory
            && !studentFinancialContext && txs.length === 0 && Number(membership.totalClasses || 0) === 0
            && Number(membership.freezesUsed || 0) === 0 && Number(membership.emergencyFreezesUsed || 0) === 0) {
            classification = 'safe_empty_candidate';
            reason = 'Не действует; нулевая стоимость/денежные требования/остатки/использование; нет платежей, транзакций, списаний, заморозок, цепочки и активной ссылки; кошелёк и финансовая история ученика пусты';
        } else if (current || future) {
            classification = membership.lessonFormat === 'program' ? 'keep_current_program' : 'keep_current_legacy';
            reason = future ? 'Оформлено на будущий период; сохранить условия покупки' : 'Действует по датам; сохранить уже оформленные условия';
            if (membership.lessonFormat !== 'program') reason += '; legacy не является ошибкой, счётчики не ограничивают прежние денежные списания';
        } else if (membership.status === 'deleted') {
            classification = 'archive_keep_history'; reason = 'Уже мягко удалён; связанные финансовые и учебные записи сохранять';
        } else if (ended && membership.lessonFormat === 'program' && Number(membership.classesRemaining) > 0) {
            classification = 'manual_review'; reason = 'Срок программы закончился, остались купленные компоненты: проверить перенос/возврат, не списывать остаток автоматически';
        } else if (membership.status === 'frozen' || (refs.length && !ended)) {
            classification = 'manual_review'; reason = 'Приостановлено либо указано активным при недействующем статусе: проверить даты и продолжение';
        } else {
            classification = 'archive_keep_history';
            reason = ended ? 'Период закончился; сохранить покупки, списания и исторические условия' : 'Неактивный статус; сохранить историю';
            if (membership.status === 'active' && ended) reason += '; статус active устарел';
            if (refs.length) reason += '; сначала выбрать актуальный абонемент вместо активной ссылки';
            if (valuableUnits || Number(membership.paidAmount || 0) > 0) reason += '; есть исторические остатки/оплата: не удалять автоматически, проверить неиспользованные обязательства';
        }
        const chargeTxs = txs.filter(tx => ['deduct', 'manual_deduct'].includes(tx.type));
        const returns = txs.filter(tx => tx.type === 'add' && tx.classId);
        return {
            student: `${student?.name || 'Неизвестный ученик'} (${membership.studentId})`, studentId: membership.studentId,
            membershipId: membership.id, classification, action: CLASSIFICATION_LABELS[classification], reason, issues,
            programAllocation,
            type: membership.type, lessonFormat: membership.lessonFormat, status: membership.status,
            startDate: membership.startDate, endDate: membership.endDate, current, future,
            activeButPastEndDate: membership.status === 'active' && ended,
            unusedUnitsOrPaymentClaim: valuableUnits || Number(membership.remainingAmount || 0) > 0 || Number(student?.accountBalance || 0) > 0,
            direction: membership.directionName || membership.groupDirection || null, teacher: membership.teacherName || null,
            group: membership.groupName || null, totalPrice: membership.totalPrice, classesRemaining: membership.classesRemaining,
            studentStatus: student?.status || null, accountBalance: student?.accountBalance || 0,
            activeReference: refs.length > 0,
            linkedPaymentCount: membershipPayments.length,
            completedLinkedPayments: sum(membershipPayments.filter(payment => payment.status === 'completed'), 'amount'),
            refundedLinkedPayments: sum(membershipPayments.filter(payment => payment.status === 'refunded'), 'amount'),
            detachedStudentPaymentCount: studentPayments.filter(payment => !payment.membershipId).length,
            transactionCount: txs.length, deductionEvents: chargeTxs.length,
            deductedUnits: sum(chargeTxs, 'amount'), returnedUnits: sum(returns, 'amount'),
            netDeductedUnits: sum(chargeTxs, 'amount') - sum(returns, 'amount'),
            attachedAttendeeCount: charges.length,
            confirmedChargeCount: charges.filter(charge => charge.classStatus === 'completed' && charge.chargeAmount > 0).length,
            confirmedCharges: sum(charges.filter(charge => charge.classStatus === 'completed'), 'chargeAmount'),
            freezeCount: membershipFreezes.length, previousMembershipId: membership.previousMembershipId,
            successorIds: next.map(item => item.id),
            confirmedChargeRecordsWithoutDeductionReference: charges.filter(charge => charge.classStatus === 'completed'
                && charge.chargeSource === 'membership'
                && !chargeTxs.some(tx => tx.classId === charge.classId)).map(charge => charge.id),
        };
    });
    for (const charge of classAttendees) {
        if (charge.chargedMembershipId && !membershipsById.has(charge.chargedMembershipId)) {
            anomalies.push({ type: 'dangling_charge_membership', attendeeId: charge.id, classId: charge.classId, membershipId: charge.chargedMembershipId, studentId: charge.studentId, amount: charge.chargeAmount });
        }
        if (charge.chargeAmount > 0 && charge.classStatus !== 'completed') {
            anomalies.push({ type: 'charged_unconfirmed_class', attendeeId: charge.id, classId: charge.classId, membershipId: charge.chargedMembershipId, studentId: charge.studentId, amount: charge.chargeAmount, status: charge.classStatus });
        }
    }
    const studentRows = students.map(student => {
        const studentPayments = paymentsByStudent.get(student.id) || [];
        const studentCharges = attendeesByStudent.get(student.id) || [];
        const completedPayments = sum(studentPayments.filter(payment => payment.status === 'completed'), 'amount');
        const refundedPayments = sum(studentPayments.filter(payment => payment.status === 'refunded'), 'amount');
        const recordedCharges = sum(studentCharges, 'chargeAmount');
        const balanceAdjustments = sum(adjustmentsByStudent.get(student.id) || [], 'amount');
        const membershipsForStudent = rows.filter(row => row.studentId === student.id);
        const currentMemberships = membershipsForStudent.filter(row => row.current);
        const futureMemberships = membershipsForStudent.filter(row => row.future);
        const active = membershipsById.get(student.activeMembershipId);
        const groups = (groupsByStudent.get(student.id) || []).filter(group => ['active', 'Active'].includes(group.status) && group.isActive);
        const groupIds = new Set(groups.map(group => group.groupId));
        const attendeeClassIds = new Set(studentCharges.map(charge => charge.classId));
        const relatedScheduled = scheduledClasses.filter(lesson => lesson.individualStudentId === student.id || groupIds.has(lesson.groupId) || attendeeClassIds.has(lesson.id));
        const upcomingAll = relatedScheduled.filter(lesson => lesson.status !== 'pending_admin_review'
            && (lesson.status === 'started' || lessonOccurrenceTime(lesson) >= asOf.getTime()))
            .sort((a, b) => lessonOccurrenceTime(a) - lessonOccurrenceTime(b));
        const pendingReviewPast = relatedScheduled.filter(lesson => lesson.status === 'pending_admin_review' && lessonOccurrenceTime(lesson) < asOf.getTime());
        const upcoming = upcomingAll.filter(lesson => !lesson.isPractice);
        const involvement = [];
        if (upcoming.length) involvement.push('ближайшие уроки');
        if (upcomingAll.some(lesson => lesson.isPractice)) involvement.push('ближайшая практика');
        if (student.assignedTeacherId) involvement.push('назначен преподаватель');
        if (groups.length) involvement.push('активная группа');
        if (studentPayments.length) involvement.push('есть история платежей');
        if (studentCharges.length) involvement.push('есть история занятий/практики');
        const flags = [];
        if (student.activeMembershipId && !active) flags.push('Активная ссылка ведёт на отсутствующий абонемент');
        if (active && active.studentId !== student.id) flags.push('Активная ссылка ведёт на чужой абонемент');
        if (active && (active.status !== 'active' || new Date(active.endDate) < asOf)) flags.push('Активная ссылка ведёт на завершённый/удалённый абонемент');
        if (upcoming.length && currentMemberships.length === 0 && futureMemberships.length === 0) flags.push('Есть ближайшее расписание, но нет действующего/будущего абонемента: проверить оформление замены');
        const priorityReplacementReview = student.role === 'student' && student.status === 'active' && currentMemberships.length === 0
            && (futureMemberships.length === 0 || (upcoming.length > 0 && futureMemberships.every(row => new Date(row.startDate) > new Date(upcoming[0].date))))
            && involvement.length > 0;
        if (priorityReplacementReview) flags.push(`Приоритет проверки оформления: активный ученик без подходящего текущего абонемента (${involvement.join(', ')})`);
        if (currentMemberships.length > 1) flags.push('Несколько действующих абонементов: могут относиться к разным форматам/направлениям, не удалять как дубликаты автоматически');
        const expectedFromRecorded = completedPayments - refundedPayments + balanceAdjustments - recordedCharges;
        return {
            student: `${student.name} (${student.id})`, studentId: student.id, status: student.status, accountBalance: student.accountBalance,
            activeMembershipId: student.activeMembershipId, assignedTeacher: student.assignedTeacherName || null,
            currentMembershipIds: currentMemberships.map(row => row.membershipId), futureMembershipIds: futureMemberships.map(row => row.membershipId),
            allMembershipIds: (membershipsByStudent.get(student.id) || []).map(item => item.id),
            upcomingClassCount: upcoming.length, upcomingPracticeCount: upcomingAll.filter(lesson => lesson.isPractice).length,
            nextClassDate: upcoming[0]?.date || null,
            nextClassOccurrenceAt: upcoming[0] ? new Date(lessonOccurrenceTime(upcoming[0])).toISOString() : null,
            pastPendingReviewCount: pendingReviewPast.length,
            priorityReplacementReview, involvement,
            completedPayments, refundedPayments, recordedCharges, confirmedCharges: sum(studentCharges.filter(charge => charge.classStatus === 'completed'), 'chargeAmount'),
            explicitBalanceAdjustments: balanceAdjustments,
            unexplainedOpeningOrLegacyBalance: Number(student.accountBalance) - expectedFromRecorded,
            flags,
        };
    });
    return {
        metadata: {
            ...snapshot.metadata,
            policy: 'Только read-only аудит. Кандидаты не являются разрешением на удаление. Legacy не ошибка. Счётчики legacy не сверяются с денежными списаниями как обязательное равенство.',
            ledgerCaveat: 'Остаточная разница кошелька может быть начальным/импортированным балансом либо старой операцией без полного журнала; это не доказательство ошибки. Detached-платежи не распределяются по абонементам автоматически.',
        },
        totals: {
            memberships: memberships.length, students: students.length,
            membershipsByStatus: countBy(memberships, 'status'), membershipsByType: countBy(memberships, 'type'),
            classifications: countBy(rows, 'classification'),
            activeButPastEndDate: rows.filter(row => row.activeButPastEndDate).length,
            confirmedChargesWithoutDeductionReference: rows.reduce((total, row) => total + row.confirmedChargeRecordsWithoutDeductionReference.length, 0),
            paymentCount: payments.length, completedPayments: sum(payments.filter(payment => payment.status === 'completed'), 'amount'),
            refundedPayments: sum(payments.filter(payment => payment.status === 'refunded'), 'amount'),
            detachedPaymentCount: payments.filter(payment => !payment.membershipId).length,
            attendeeRecords: classAttendees.length,
            confirmedPositiveChargeCount: confirmed.filter(charge => charge.chargeAmount > 0).length,
            confirmedCharges: sum(confirmed, 'chargeAmount'), allRecordedCharges: sum(classAttendees, 'chargeAmount'),
            confirmedMembershipCharges: sum(confirmed.filter(charge => charge.chargeSource === 'membership'), 'chargeAmount'),
            confirmedBalanceOnlyCharges: sum(confirmed.filter(charge => charge.chargeSource === 'balance_only'), 'chargeAmount'),
            deductionEvents: transactions.filter(tx => ['deduct', 'manual_deduct'].includes(tx.type)).length,
            positiveDeductedUnits: sum(transactions.filter(tx => ['deduct', 'manual_deduct'].includes(tx.type)), 'amount'),
            returnEvents: transactions.filter(tx => tx.type === 'add' && tx.classId).length,
            returnedUnits: sum(transactions.filter(tx => tx.type === 'add' && tx.classId), 'amount'),
            anomalies: anomalies.length, studentReviewCount: studentRows.filter(row => row.flags.length).length,
            priorityReplacementReviewStudents: studentRows.filter(row => row.priorityReplacementReview).length,
            walletResidualStudents: studentRows.filter(row => row.unexplainedOpeningOrLegacyBalance !== 0).length,
        },
        memberships: rows, students: studentRows, anomalies,
        activeButPastEndDate: rows.filter(row => row.activeButPastEndDate).map(row => ({
            student: row.student, membershipId: row.membershipId, endDate: row.endDate,
            action: row.action, reason: row.reason, valuableClaims: row.unusedUnitsOrPaymentClaim,
            activeReference: row.activeReference,
        })),
        evidence: snapshot,
    };
}

function renderMarkdown(report) {
    const escape = value => String(value ?? '').replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
    const lines = [
        '# Аудит абонементов', '', `Снимок: ${report.metadata.asOf}. Транзакция read-only: ${report.metadata.readOnly}.`, '',
        report.metadata.policy, '', report.metadata.ledgerCaveat, '',
        `Абонементов: ${report.totals.memberships}; учеников в выборке: ${report.totals.students}.`,
        `Подтверждённые денежные списания: ${report.totals.confirmedCharges} ₸ (${report.totals.confirmedPositiveChargeCount} записей).`,
        `Записей списания занятий: ${report.totals.deductionEvents}; единиц: ${report.totals.positiveDeductedUnits}; возвратов единиц: ${report.totals.returnedUnits}.`,
        '', '| Категория | Количество |', '|---|---:|',
        ...Object.entries(report.totals.classifications).map(([category, count]) => `| ${CLASSIFICATION_LABELS[category]} | ${count} |`),
        '', '| Ученик (ID) | Абонемент | Тип / статус / окончание | Цена / остаток / списано ₸ | Действие | Причина |', '|---|---|---|---|---|---|',
        ...report.memberships.map(row => `| ${escape(row.student)} | ${row.membershipId} | ${escape(row.type)} / ${row.status} / ${new Date(row.endDate).toISOString().slice(0, 10)} | ${row.totalPrice} / ${row.classesRemaining} / ${row.confirmedCharges} | ${escape(row.action)} | ${escape(row.reason)} |`),
        '', '## Ученики для проверки активного абонемента или замены', '', '| Ученик (ID) | Баланс ₸ | Активный ID | Ближайших уроков | Причина |', '|---|---:|---|---:|---|',
        ...report.students.filter(row => row.flags.length).map(row => `| ${escape(row.student)} | ${row.accountBalance} | ${row.activeMembershipId || '—'} | ${row.upcomingClassCount} | ${escape(row.flags.join('; '))} |`),
        '', `Отдельных аномалий ссылок/неподтверждённых списаний: ${report.anomalies.length}. Детали и полная доказательная выборка — в JSON.`, '',
    ];
    return lines.join('\n');
}

async function main() {
    const args = process.argv.slice(2);
    const inputPath = args.includes('--input') ? args[args.indexOf('--input') + 1] : null;
    const format = args.includes('--format') ? args[args.indexOf('--format') + 1] : 'json';
    if (!['json', 'markdown'].includes(format)) throw new Error('Format must be json or markdown');
    let report;
    if (inputPath) {
        const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
        report = analyzeSnapshot(input.evidence || input);
    } else {
        require('dotenv').config({ quiet: true });
        if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
        report = analyzeSnapshot(await readSnapshot(process.env.DATABASE_URL));
    }
    process.stdout.write(format === 'markdown' ? renderMarkdown(report) : `${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) main().catch(error => {
    // Avoid connection strings, credentials and arbitrary database payloads.
    process.stderr.write(`Read-only membership audit failed (${error.code || error.name || 'Error'}).\n`);
    process.exitCode = 1;
});

module.exports = { readSnapshot, analyzeSnapshot, renderMarkdown, lessonOccurrenceTime };
