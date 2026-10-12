const { randomUUID, createHash } = require('node:crypto');
const { prisma } = require('../config/db');
const { fail, today, normalizeTerms, normalizeIntent, isMinor, sameDocumentStudent, STUDENT_SELECT } = require('./enrollment');
const { TEMPLATE_VERSION, buildRenewalAppendix, fio } = require('./enrollmentDocuments');
const { rateCardMembershipData } = require('./rateCards');
const { recordReceivedPayment } = require('./receivedPayment');
const hash = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const clean = (value, max = 1000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const nameSelect = { id: true, name: true, lastName: true, middleName: true, status: true, pausedUntil: true, lostAt: true, accountBalance: true, activeMembershipId: true };
const net = p => p.status === 'completed' ? Math.max(0, p.amount - p.relatedPayments.filter(r => r.status === 'refunded').reduce((n, r) => n + r.amount, 0)) : 0;
const dateAdd = (day, n) => { const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + n); return date; };
async function lockStudent(db, studentId) {
    const rows = await db.$queryRaw`SELECT id FROM "Student" WHERE id = ${studentId} AND role = 'student' FOR UPDATE`;
    if (!rows.length) throw fail('Ученик не найден.', 404);
}
async function loadMembership(db, id) {
    const membership = await db.membership.findUnique({ where: { id } });
    if (!membership || membership.billingModel !== 'rate_card') throw fail('Выберите тариф с расценками.', 404);
    return membership;
}
async function periodState(db, membership, now = new Date()) {
    const [enrollment, renewal, payments, charges] = await Promise.all([
        db.enrollment.findUnique({ where: { membershipId: membership.id }, select: { terms: true, documents: { orderBy: { createdAt: 'desc' }, select: { number: true, appendixSignedAt: true, revision: true } }, revision: true } }),
        db.subscriptionRenewal.findUnique({ where: { membershipId: membership.id }, include: { document: { select: { number: true, snapshot: true } } } }),
        db.payment.findMany({ where: { membershipId: membership.id, relatedPaymentId: null, isCancellation: false }, include: { relatedPayments: { select: { amount: true, status: true } } }, orderBy: { id: 'asc' } }),
        db.classAttendee.findMany({ where: { studentId: membership.studentId, chargedMembershipId: membership.id, chargeAmount: { gt: 0 } }, select: { id: true, classId: true, chargeAmount: true, class: { select: { date: true, endTime: true } } } }),
    ]);
    const terms = renewal?.terms || enrollment?.terms || null;
    const creditAmount = renewal?.creditAmount || 0;
    const receivedAmount = payments.reduce((n, p) => n + net(p), 0);
    const paidAmount = receivedAmount + creditAmount;
    const remainingAmount = terms ? Math.max(0, terms.totalPrice - paidAmount) : null;
    const spentAmount = charges.reduce((n, c) => n + c.chargeAmount, 0);
    const counted = [...new Map(charges.map(c => [c.classId, c.class])).values()].sort((a, b) => a.date - b.date || a.endTime.localeCompare(b.endTime));
    const second = counted[1];
    // Class.date is a school calendar date, times are Asia/Aqtobe (UTC+05).
    const dueAt = second ? new Date(`${second.date.toISOString().slice(0, 10)}T${second.endTime}:00+05:00`) : null;
    const dueDay = dueAt ? today(dueAt) : null;
    const reviewAfter = dueDay ? dateAdd(dueDay, 8).toISOString().slice(0, 10) : null;
    const overdue = remainingAmount > 0 && dueAt && now >= dueAt;
    return { terms, creditAmount, receivedAmount, paidAmount, remainingAmount, spentAmount,
        availableCredit: terms ? Math.max(0, paidAmount - spentAmount) : null,
        countedLessons: counted.length, dueAt, overdue: Boolean(overdue), reviewAfter,
        documentBasis: (renewal?.document ? { mode: 'same', reference: `Приложение № П-${renewal.document.number} к договору ${renewal.document.snapshot.number} от ${renewal.document.snapshot.documentDate}` } : renewal?.documentBasis) || (enrollment ? { mode: 'same', reference: `Приложение к договору М-${enrollment.documents.find(d => d.revision === enrollment.revision)?.number || '—'}` } : null),
        payments: payments.map(p => ({ id: p.id, amount: p.amount, netAmount: net(p), status: p.status, paymentDate: p.paymentDate })),
        charges: charges.map(({ id, classId, chargeAmount }) => ({ id, classId, chargeAmount })).sort((a, b) => a.id.localeCompare(b.id)),
    };
}
async function sourceState(db, membership) {
    const [student, ledger, state] = await Promise.all([
        db.student.findUnique({ where: { id: membership.studentId }, select: nameSelect }),
        db.studentBalanceEntry.findFirst({ where: { studentId: membership.studentId }, orderBy: { position: 'desc' }, select: { position: true } }),
        periodState(db, membership),
    ]);
    const snapshot = { membership, student, ledgerPosition: ledger?.position || 0,
        receivedAmount: state.receivedAmount, credited: state.creditAmount, charges: state.charges, payments: state.payments };
    return { student, state, snapshot: JSON.parse(JSON.stringify(snapshot)), hash: hash(snapshot),
        creditLimit: Math.max(0, Math.min(student.accountBalance, state.availableCredit ?? student.accountBalance)) };
}
function datesFor(payload, days) {
    const day = today(new Date(payload.paymentDate));
    return { validFrom: dateAdd(day, 0), validUntil: dateAdd(day, days) };
}
function sameConditions(a, b) {
    if (!a) return false;
    return ['name', 'direction', 'days', 'totalPrice', 'emergencyCancellations', 'additionalTerms'].every(k => a[k] === b[k])
        && Object.keys(a.rates).length === Object.keys(b.rates).length
        && Object.keys(a.rates).every(k => a.rates[k].price === b.rates[k]?.price && a.durations[k] === b.durations[k]);
}
async function assertRenewable(db, membership) {
    if (!['active', 'archived', 'expired'].includes(membership.status)) throw fail('Тариф не подходит для продления.', 409);
    const next = await db.membership.findFirst({ where: { previousMembershipId: membership.id, status: { not: 'deleted' } } });
    if (next) throw fail('Этот период уже продлён. Откройте последний абонемент.', 409);
    const others = await db.membership.count({ where: { studentId: membership.studentId, status: 'active', id: { not: membership.id } } });
    if (others) throw fail('У ученика другой действующий тариф. Сначала выберите его.', 409);
}
async function prepareRenewal(id, input, actorId) {
    const terms = normalizeTerms(input.terms);
    if (!['ordinary', 'half_year', 'year'].includes(input.terms?.renewalKind)) throw fail('Укажите вид абонемента: обычный, полугодовой или годовой.');
    terms.renewalKind = input.terms.renewalKind;
    const creditAmount = input.creditAmount;
    if (!Number.isSafeInteger(creditAmount) || creditAmount < 0 || creditAmount > terms.totalPrice) throw fail('Проверьте сумму зачёта.');
    const creditReason = clean(input.creditReason);
    if (creditAmount && creditReason.length < 8) throw fail('Укажите основание и расчёт подтверждённого остатка.');
    const rawAmount = input.payment?.amount;
    if (!Number.isSafeInteger(rawAmount) || rawAmount < 0) throw fail('Укажите целую сумму реально полученной оплаты.');
    const paymentPayload = { ...normalizeIntent({ ...input.payment, amount: rawAmount || 1 }), amount: rawAmount };
    if (rawAmount + creditAmount < terms.firstPayment || rawAmount + creditAmount > terms.totalPrice) throw fail('Зачёт и полученная оплата должны покрывать согласованную первую часть (не менее 50%) и не превышать стоимость периода.');
    const basis = { mode: input.documentBasis?.mode, reference: clean(input.documentBasis?.reference, 500), verifiedById: actorId,
        generated: input.documentBasis?.mode === 'new_appendix' && input.documentBasis?.generated === true };
    if (!['same', 'new_appendix'].includes(basis.mode) || !basis.generated && basis.reference.length < 3 || input.confirmed !== true) throw fail('Проверьте условия с заказчиком и укажите основание: действующее приложение, новое бумажное или печать из CRM.');
    if (terms.renewalKind !== 'ordinary' && basis.mode !== 'new_appendix') throw fail('Для полугодового и годового периода требуется новое подписанное приложение.');
    return prisma.$transaction(async db => {
        const source = await loadMembership(db, id); await lockStudent(db, source.studentId);
        const pending = await db.subscriptionRenewal.findFirst({ where: { studentId: source.studentId, confirmedAt: null, cancelledAt: null } });
        if (pending) return pending;
        const current = await loadMembership(db, id); await assertRenewable(db, current);
        const context = await sourceState(db, current);
        if (context.state.remainingAmount > 0) throw fail('Сначала закройте доплату текущего периода. Продление не погашает старый долг.', 409);
        if (creditAmount > context.creditLimit) throw fail(`Зачёт не может превышать подтверждённый доступный остаток ${context.creditLimit} ₸.`, 409);
        const sameHistoricRates = Object.keys(current.lessonRates || {}).length === Object.keys(terms.rates).length
            && Object.keys(terms.rates).every(k => current.lessonRates?.[k]?.price === terms.rates[k].price);
        // A paper appendix predating CRM can be verified by the administrator. Missing
        // digital terms do not, by themselves, require signing the same appendix again.
        const unchanged = context.state.terms ? sameConditions(context.state.terms, terms) : sameHistoricRates;
        if (basis.mode === 'same' && (!unchanged || ['half_year', 'year'].includes(context.state.terms?.renewalKind) || [6, 12].includes(current.programMonths))) throw fail('Условия изменены либо предыдущий абонемент полугодовой/годовой. Укажите новое подписанное приложение.', 409);
        const dates = datesFor(paymentPayload, terms.days);
        if (current.validFrom && dates.validFrom < current.validFrom) throw fail('Дата нового периода раньше начала предыдущего. Проверьте дату оплаты.');
        return db.subscriptionRenewal.create({ data: { id: randomUUID(), studentId: source.studentId, previousMembershipId: id,
            terms, documentBasis: basis, creditAmount, creditReason, paymentPayload,
            sourceSnapshot: context.snapshot, sourceHash: context.hash, createdById: actorId } });
    });
}
async function confirmRenewal(id, actorId) {
    return prisma.$transaction(async db => {
        const draft = await db.subscriptionRenewal.findUnique({ where: { id } });
        if (!draft) throw fail('Расчёт не найден.', 404);
        await lockStudent(db, draft.studentId);
        const r = await db.subscriptionRenewal.findUniqueOrThrow({ where: { id } });
        if (r.confirmedAt) return { membershipId: r.membershipId, paymentId: r.paymentId, repeated: true };
        if (r.cancelledAt) throw fail('Расчёт отменён.', 409);
        const source = await loadMembership(db, r.previousMembershipId); await assertRenewable(db, source);
        const context = await sourceState(db, source);
        if (context.hash !== r.sourceHash) throw fail('После расчёта изменились баланс, уроки или тариф. Отмените черновик и заново проверьте остаток; деньги ещё не зачислены.', 409);
        const doc = await db.renewalDocument.findUnique({ where: { renewalId: id } });
        if (r.documentBasis.generated || doc) {
            if (!doc?.signedAt) throw fail('Распечатайте приложение и отметьте фактическую подпись заказчика до подтверждения продления.', 409);
            const person = await db.student.findUniqueOrThrow({ where: { id: r.studentId }, select: STUDENT_SELECT });
            if (!sameDocumentStudent(doc.snapshot.student, person)) throw fail('Данные ученика изменились после подготовки приложения. Отмените расчёт и подготовьте новый экземпляр.', 409);
        }
        const p = r.paymentPayload;
        const payment = p.amount ? await recordReceivedPayment(db, { studentId: r.studentId, parsedAmount: p.amount,
            normalizedType: 'membership_full', actorId, notes: `Продление ${r.id}. Плательщик: ${p.payer}. ${p.notes}`,
            paymentDate: new Date(p.paymentDate), normalizedPaymentMethod: p.paymentMethod }) : null;
        const paidAmount = p.amount + r.creditAmount;
        const membership = await db.membership.create({ data: { ...rateCardMembershipData({ studentId: r.studentId,
            name: r.terms.name, rates: r.terms.rates, actorId, previousMembershipId: source.id, source: 'renewal',
            emergencyFreezesAvailable: r.terms.emergencyCancellations }), ...datesFor(p, r.terms.days),
            totalPrice: r.terms.totalPrice, paidAmount, remainingAmount: r.terms.totalPrice - paidAmount,
            paymentStatus: paidAmount === r.terms.totalPrice ? 'paid' : 'partial' } });
        if (payment) await db.payment.update({ where: { id: payment.id }, data: { membershipId: membership.id } });
        await db.membership.update({ where: { id: source.id }, data: { status: 'archived' } });
        await db.student.update({ where: { id: r.studentId }, data: { activeMembershipId: membership.id } });
        await db.membershipTransaction.create({ data: { membershipId: membership.id, type: 'initial', amount: 0,
            addedById: actorId, reason: `Продление ${r.id}. Получено ${p.amount} ₸, зачёт ${r.creditAmount} ₸. ${r.creditReason}. ${doc ? `Приложение № П-${doc.number}` : r.documentBasis.reference}` } });
        await db.subscriptionRenewal.update({ where: { id }, data: { confirmedAt: new Date(), confirmedById: actorId, membershipId: membership.id, paymentId: payment?.id || null } });
        return { membershipId: membership.id, paymentId: payment?.id || null, repeated: false };
    }, { timeout: 20000 });
}
async function cancelRenewal(id) {
    return prisma.$transaction(async db => {
        const r = await db.subscriptionRenewal.findUnique({ where: { id } });
        if (!r) throw fail('Расчёт не найден.', 404);
        await lockStudent(db, r.studentId);
        const current = await db.subscriptionRenewal.findUniqueOrThrow({ where: { id } });
        if (current.confirmedAt) throw fail('Продление проведено; отмена черновика недоступна.', 409);
        if (!current.cancelledAt) await db.subscriptionRenewal.update({ where: { id }, data: { cancelledAt: new Date() } });
    });
}
const documentSelect = { id: true, renewalId: true, number: true, createdAt: true, signedAt: true };
async function documentDefaults(db, studentId) {
    const previous = await db.renewalDocument.findFirst({ where: { renewal: { studentId, cancelledAt: null, confirmedAt: { not: null } } }, orderBy: { createdAt: 'desc' }, select: { snapshot: true } });
    const original = previous ? null : await db.enrollmentDocument.findFirst({ where: { enrollment: { studentId }, contractSignedAt: { not: null } }, orderBy: { createdAt: 'desc' }, select: { snapshot: true } });
    const snapshot = previous?.snapshot || original?.snapshot;
    const student = await db.student.findUniqueOrThrow({ where: { id: studentId }, select: STUDENT_SELECT });
    let minor = null;
    try { if (student.dateOfBirth) minor = isMinor(student.dateOfBirth); } catch { /* Invalid DOB is corrected in the student card before printing. */ }
    return { contractNumber: snapshot?.number || '', contractDate: snapshot?.documentDate || '', minor,
        customerName: minor === false ? fio(student) : snapshot?.customer?.type === 'representative' ? snapshot.customer.fullName : student.customerName || '',
        studentName: fio(student), dateOfBirth: student.dateOfBirth };
}
async function prepareAppendix(id, input, actorId) {
    return prisma.$transaction(async db => {
        const initial = await db.subscriptionRenewal.findUnique({ where: { id } });
        if (!initial) throw fail('Расчёт не найден.', 404);
        await lockStudent(db, initial.studentId);
        const r = await db.subscriptionRenewal.findUniqueOrThrow({ where: { id } });
        // Repeating a request always returns the same issued copy, even after activation.
        const existing = await db.renewalDocument.findUnique({ where: { renewalId: id }, select: documentSelect });
        if (existing) return existing;
        if (r.confirmedAt || r.cancelledAt) throw fail('Новый экземпляр можно подготовить только в открытом расчёте продления.', 409);
        const source = await loadMembership(db, r.previousMembershipId);
        if ((await sourceState(db, source)).hash !== r.sourceHash) throw fail('Расчёт устарел. Отмените его и подготовьте продление заново.', 409);
        const student = await db.student.findUniqueOrThrow({ where: { id: r.studentId }, select: STUDENT_SELECT });
        const minor = isMinor(student.dateOfBirth);
        const customer = { type: minor ? 'representative' : 'self', fullName: minor ? clean(input.customerName, 250) : fio(student) };
        const number = clean(input.contractNumber, 100), documentDate = input.contractDate;
        if (!number || !customer.fullName || input.confirmed !== true) throw fail('Сверьте номер и дату договора, ученика и заказчика с подписанным договором.');
        if (typeof documentDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(documentDate) || !Number.isFinite(Date.parse(`${documentDate}T00:00:00Z`)) || new Date(`${documentDate}T00:00:00Z`).toISOString().slice(0, 10) !== documentDate || documentDate > today()) throw fail('Укажите фактическую дату договора, не в будущем.');
        const [{ number: serial }] = await db.$queryRaw`SELECT nextval('"RenewalDocument_number_seq"')::int AS number`;
        const snapshot = JSON.parse(JSON.stringify({ student, customer, terms: r.terms, number, documentDate,
            appendixNumber: `П-${serial}`, renewalKind: r.terms.renewalKind, creditAmount: r.creditAmount,
            firstCash: r.paymentPayload.amount, paymentDate: r.paymentPayload.paymentDate, creditReason: r.creditReason }));
        return db.renewalDocument.create({ data: { renewalId: id, number: serial, snapshot, preparedById: actorId,
            templateVersion: `${TEMPLATE_VERSION}-renewal1`, html: buildRenewalAppendix(snapshot) }, select: documentSelect });
    });
}
async function signAppendix(id, input, actorId) {
    if (input.confirmed !== true) throw fail('Подтвердите фактическую подпись заказчика.');
    const date = new Date(input.date);
    if (typeof input.date !== 'string' || !Number.isFinite(date.getTime()) || date > new Date(Date.now() + 60000)) throw fail('Укажите фактическую дату подписания, не в будущем.');
    return prisma.$transaction(async db => {
        const initial = await db.renewalDocument.findUnique({ where: { id }, include: { renewal: true } });
        if (!initial) throw fail('Приложение не найдено.', 404);
        await lockStudent(db, initial.renewal.studentId);
        const doc = await db.renewalDocument.findUniqueOrThrow({ where: { id }, include: { renewal: true } });
        if (doc.renewal.cancelledAt) throw fail('Этот расчёт отменён. Подпись недоступна.', 409);
        if (doc.signedAt) return;
        if (today(date) < today(doc.createdAt)) throw fail('Дата подписания не может быть раньше подготовки этого экземпляра.');
        const student = await db.student.findUniqueOrThrow({ where: { id: doc.renewal.studentId }, select: STUDENT_SELECT });
        if (!sameDocumentStudent(doc.snapshot.student, student)) throw fail('Данные ученика изменились. Отмените расчёт и подготовьте новый экземпляр.', 409);
        if ((await sourceState(db, await loadMembership(db, doc.renewal.previousMembershipId))).hash !== doc.renewal.sourceHash) throw fail('Расчёт устарел. Отмените его и подготовьте заново.', 409);
        await db.renewalDocument.update({ where: { id }, data: { signedAt: date, signedById: actorId } });
    });
}
async function appendixHtml(id) {
    const doc = await prisma.renewalDocument.findUnique({ where: { id }, select: { html: true, renewal: { select: { cancelledAt: true } } } });
    if (!doc) throw fail('Приложение не найдено.', 404);
    if (doc.renewal.cancelledAt) throw fail('Расчёт отменён. Для печати используйте приложение из действующего продления.', 409);
    return doc.html;
}
async function prepareInstallment(id, input, actorId) {
    const payload = normalizeIntent(input);
    return prisma.$transaction(async db => {
        const m = await loadMembership(db, id); await lockStudent(db, m.studentId);
        const pending = await db.installmentIntent.findFirst({ where: { membershipId: id, paymentId: null, cancelledAt: null } });
        if (pending) return pending;
        const state = await periodState(db, m);
        if (!state.terms) throw fail('У старого тарифа нет подтверждённого расчёта задолженности. Используйте обычное пополнение, без изменения срока.', 409);
        if (!state.remainingAmount || payload.amount > state.remainingAmount) throw fail(`Осталось доплатить за этот период ${state.remainingAmount} ₸. Новую покупку оформляйте через продление.`, 409);
        return db.installmentIntent.create({ data: { id: randomUUID(), membershipId: id, payload, createdById: actorId } });
    });
}
async function confirmInstallment(id, actorId) {
    return prisma.$transaction(async db => {
        const initial = await db.installmentIntent.findUnique({ where: { id }, include: { membership: true } });
        if (!initial) throw fail('Черновик оплаты не найден.', 404);
        await lockStudent(db, initial.membership.studentId);
        const intent = await db.installmentIntent.findUniqueOrThrow({ where: { id }, include: { membership: true } });
        if (intent.paymentId) return { paymentId: intent.paymentId, repeated: true };
        if (intent.cancelledAt) throw fail('Черновик отменён.', 409);
        const state = await periodState(db, intent.membership), p = intent.payload;
        if (!state.terms || p.amount > state.remainingAmount) throw fail('Размер доплаты изменился. Отмените черновик и обновите расчёт.', 409);
        const payment = await recordReceivedPayment(db, { studentId: intent.membership.studentId, parsedAmount: p.amount,
            normalizedType: 'membership_full', actorId, notes: `Доплата периода ${intent.membershipId}. Плательщик: ${p.payer}. ${p.notes}`,
            paymentDate: new Date(p.paymentDate), normalizedPaymentMethod: p.paymentMethod });
        await db.payment.update({ where: { id: payment.id }, data: { membershipId: intent.membershipId } });
        await db.installmentIntent.update({ where: { id }, data: { paymentId: payment.id, confirmedAt: new Date() } });
        const paidAmount = state.paidAmount + p.amount;
        await db.membership.update({ where: { id: intent.membershipId }, data: { paidAmount,
            remainingAmount: Math.max(0, state.terms.totalPrice - paidAmount), paymentStatus: paidAmount >= state.terms.totalPrice ? 'paid' : 'partial' } });
        return { paymentId: payment.id, repeated: false };
    }, { timeout: 20000 });
}
async function cancelInstallment(id) {
    return prisma.$transaction(async db => {
        const initial = await db.installmentIntent.findUnique({ where: { id }, include: { membership: true } });
        if (!initial) throw fail('Черновик не найден.', 404);
        await lockStudent(db, initial.membership.studentId);
        const i = await db.installmentIntent.findUniqueOrThrow({ where: { id } });
        if (i.paymentId) throw fail('Оплата уже проведена.', 409);
        if (!i.cancelledAt) await db.installmentIntent.update({ where: { id }, data: { cancelledAt: new Date() } });
    });
}
async function studentPeriods(studentId, db = prisma) {
    const student = await db.student.findFirst({ where: { id: studentId, role: 'student' }, select: nameSelect });
    if (!student) throw fail('Ученик не найден.', 404);
    const memberships = await db.membership.findMany({ where: { studentId, billingModel: 'rate_card', status: { not: 'deleted' } }, orderBy: { createdAt: 'desc' } });
    const periods = [];
    for (const m of memberships) {
        const c = await sourceState(db, m);
        const pendingInstallment = await db.installmentIntent.findFirst({ where: { membershipId: m.id, paymentId: null, cancelledAt: null } });
        periods.push({ membership: m, ...c.state, creditLimit: c.creditLimit, pendingInstallment });
    }
    const pendingRenewal = await db.subscriptionRenewal.findFirst({ where: { studentId, confirmedAt: null, cancelledAt: null } });
    const documents = await db.renewalDocument.findMany({ where: { renewal: { studentId }, OR: [{ renewal: { cancelledAt: null } }, { scans: { some: {} } }] }, select: { ...documentSelect, renewal: { select: { cancelledAt: true } } }, orderBy: { createdAt: 'desc' } });
    return { student, periods, documents, documentDefaults: await documentDefaults(db, studentId),
        pendingRenewal: pendingRenewal ? { ...pendingRenewal, ...datesFor(pendingRenewal.paymentPayload, pendingRenewal.terms.days) } : null };
}
async function attentionQueue(db = prisma, now = new Date()) {
    const students = await db.student.findMany({ where: { role: 'student', OR: [{ enrollments: { some: {} } }, { memberships: { some: { billingModel: 'rate_card' } } }, { status: 'inactive', pausedUntil: { not: null }, lostAt: null }] }, select: nameSelect, orderBy: [{ lastName: 'asc' }, { name: 'asc' }] });
    const result = [];
    for (const s of students) {
        const ms = await db.membership.findMany({ where: { studentId: s.id, billingModel: 'rate_card', status: { not: 'deleted' } } });
        const messages = [];
        for (const m of ms) {
            const state = await periodState(db, m, now);
            if (state.remainingAmount > 0) messages.push(state.overdue ? `Просрочена доплата ${state.remainingAmount} ₸. ${today(now) >= state.reviewAfter ? 'Проверьте снятие с расписания после недели приостановки.' : 'Проверьте уведомление заказчика и приостановку.'}` : `Доплатить ${state.remainingAmount} ₸ до окончания второго учитываемого урока (учтено ${state.countedLessons}).`);
            if (m.status === 'active' && m.validUntil && m.validUntil.toISOString().slice(0, 10) < today(now)) messages.push('Срок использования истёк. Проверьте продление и остаток.');
        }
        if (s.status === 'inactive' && s.pausedUntil && s.pausedUntil <= now) messages.push('Срок паузы прошёл. Решение о возобновлении или снятии принимает администратор.');
        if (await db.subscriptionRenewal.count({ where: { studentId: s.id, confirmedAt: null, cancelledAt: null } })) messages.push('Продление подготовлено, ожидает подтверждения администратора.');
        if (messages.length) result.push({ student: s, messages });
    }
    return result;
}

async function releaseSchedule(studentId, input, actorId) {
    const reason = clean(input.reason);
    if (input.confirmed !== true || reason.length < 5) throw fail('Укажите причину и подтвердите снятие с расписания.');
    return prisma.$transaction(async db => {
        await lockStudent(db, studentId);
        const student = await db.student.findUnique({ where: { id: studentId }, select: nameSelect });
        if (student.status !== 'inactive' || student.lostAt) throw fail('Снять место можно у ученика на паузе. Сначала проверьте его статус.', 409);
        const now = new Date(), day = new Date(`${today(now)}T00:00:00Z`);
        const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Aqtobe', hour: '2-digit', minute: '2-digit' }).format(now);
        const future = { status: { in: ['scheduled', 'not_filled'] }, OR: [{ date: { gt: day } }, { date: day, startTime: { gte: time } }] };
        const groups = await db.studentGroup.findMany({ where: { studentId, status: { in: ['active', 'frozen'] } }, select: { groupId: true } });
        const schedules = await db.studentSchedule.deleteMany({ where: { studentId } });
        await db.studentGroup.updateMany({ where: { studentId, status: { in: ['active', 'frozen'] } }, data: { status: 'left' } });
        // Cancel only untouched future lessons. Submitted reports and charged history survive.
        const classes = await db.class.updateMany({ where: { ...future, individualStudentId: studentId, submittedAt: null, attendees: { none: { chargeAmount: { gt: 0 } } } }, data: { status: 'cancelled' } });
        const attendees = await db.classAttendee.deleteMany({ where: { studentId, chargeAmount: 0, autoDeducted: false, class: { ...future, submittedAt: null, individualStudentId: null } } });
        for (const groupId of new Set(groups.map(g => g.groupId))) {
            const currentStudents = await db.studentGroup.count({ where: { groupId, status: 'active' } });
            await db.group.update({ where: { id: groupId }, data: { currentStudents } });
        }
        await db.student.update({ where: { id: studentId }, data: { pausedUntil: null } });
        const result = { removedSchedules: schedules.count, cancelledClasses: classes.count, removedAttendees: attendees.count, releasedGroups: groups.length };
        // A retry has no remaining slots to remove and creates no duplicate audit event.
        if (Object.values(result).some(Boolean)) await db.activityLog.create({ data: { userId: actorId, action: 'release_student_schedule', entityType: 'Student', entityId: studentId, details: reason, metadata: result } });
        return result;
    });
}

module.exports = { releaseSchedule, periodState, sourceState, datesFor, prepareRenewal, confirmRenewal, cancelRenewal,
    prepareAppendix, signAppendix, appendixHtml, prepareInstallment, confirmInstallment, cancelInstallment, studentPeriods, attentionQueue };
