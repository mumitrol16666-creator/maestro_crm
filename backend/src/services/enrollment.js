const { randomUUID } = require('node:crypto');
const { prisma } = require('../config/db');
const { normalizeRates, rateCardMembershipData, getLessonBillingType } = require('./rateCards');
const { recordReceivedPayment } = require('./receivedPayment');
const { parsePositiveMoney } = require('./paymentPolicy');
const { normalizePaymentMethod } = require('./paymentMethods');
const { normalizePhoneDigits } = require('../utils/phone');
const { TEMPLATE_VERSION, buildEnrollmentDocuments, fio } = require('./enrollmentDocuments');
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const text = (v, max = 250) => typeof v === 'string' ? v.trim().slice(0, max) : '';
function sameDocumentStudent(a, b) {
    return ['name', 'lastName', 'middleName', 'dateOfBirth'].every(key => String(a?.[key] || '').slice(0, key === 'dateOfBirth' ? 10 : Infinity) === String(b?.[key] instanceof Date ? b[key].toISOString() : b?.[key] || '').slice(0, key === 'dateOfBirth' ? 10 : Infinity));
}
const STUDENT_SELECT = { id: true, name: true, lastName: true, middleName: true, dateOfBirth: true, phone: true,
    customerName: true, customerType: true, status: true, learningDirections: true, appUserId: true, externalLinkStatus: true };
const today = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Aqtobe', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
function isMinor(dateOfBirth, at = new Date()) {
    if (!dateOfBirth) throw fail('Укажите дату рождения ученика в карточке.');
    const dob = new Date(dateOfBirth), day = today(at);
    if (!Number.isFinite(dob.getTime()) || dob.toISOString().slice(0, 10) > day) throw fail('Проверьте дату рождения ученика.');
    const [y, m, d] = day.split('-').map(Number);
    return y - dob.getUTCFullYear() - (m < dob.getUTCMonth() + 1 || m === dob.getUTCMonth() + 1 && d < dob.getUTCDate() ? 1 : 0) < 18;
}
function normalizeCustomer(input, student) {
    const minor = isMinor(student.dateOfBirth);
    if (!input || !['self', 'representative'].includes(input.type) || minor && input.type === 'self') throw fail('Для несовершеннолетнего укажите заказчика — законного представителя.');
    if (!minor && input.type !== 'self') throw fail('В этом оформлении взрослый ученик выступает заказчиком.');
    if (typeof input.iin !== 'string' || !/^\d{12}$/.test(input.iin)) throw fail('ИИН должен содержать ровно 12 цифр.');
    const phone = normalizePhoneDigits(input.phone);
    const result = { type: input.type, fullName: input.type === 'self' ? fio(student) : text(input.fullName),
        iin: text(input.iin, 12), address: text(input.address, 500), phone,
        relationship: input.type === 'self' ? null : input.relationship,
        representation: input.type === 'self' ? '' : text(input.representation) };
    if (!result.fullName || !/^\d{12}$/.test(result.iin) || !result.address || !/^7\d{10}$/.test(phone)) throw fail('Заполните ФИО, ИИН (12 цифр), адрес и телефон заказчика.');
    if (minor && (!['mother', 'father', 'guardian'].includes(result.relationship) || !result.representation)) throw fail('Укажите отношение к ученику и основание представительства.');
    return result;
}
function normalizeTerms(input) {
    if (!input || typeof input !== 'object') throw fail('Заполните условия обучения.');
    const rates = normalizeRates(input.rates);
    const totalPrice = parsePositiveMoney(input.totalPrice), firstPayment = parsePositiveMoney(input.firstPayment);
    if (firstPayment < Math.ceil(totalPrice / 2) || firstPayment > totalPrice) throw fail('Первый платёж — от 50% до полной стоимости.');
    if (!Number.isInteger(input.days) || input.days < 1 || input.days > 730) throw fail('Укажите срок использования от 1 до 730 дней.');
    if (!Number.isInteger(input.emergencyCancellations) || input.emergencyCancellations < 0 || input.emergencyCancellations > 100) throw fail('Укажите количество экстренных отмен от 0 до 100.');
    const durations = {};
    for (const kind of Object.keys(rates)) {
        const value = input.durations?.[kind];
        if (!Number.isInteger(value) || value < 15 || value > 240) throw fail('Для каждого формата укажите длительность от 15 до 240 минут.');
        durations[kind] = value;
    }
    const result = { name: text(input.name, 150), direction: text(input.direction), scheduleText: text(input.scheduleText, 1000),
        totalPrice, firstPayment, days: input.days, rates, durations, emergencyCancellations: input.emergencyCancellations,
        additionalTerms: text(input.additionalTerms, 1000) };
    if (!result.name || !result.direction || !result.scheduleText) throw fail('Укажите название тарифа, направление и согласованное расписание для приложения.');
    return result;
}
async function startEnrollment(studentId, actorId) {
    return prisma.$transaction(async tx => {
        const rows = await tx.$queryRaw`SELECT id FROM "Student" WHERE id = ${studentId} AND role = 'student' FOR UPDATE`;
        if (!rows.length) throw fail('Ученик не найден', 404);
        return tx.enrollment.upsert({ where: { studentId }, create: { studentId, responsibleId: actorId }, update: {} });
    });
}
async function locked(tx, id) {
    const initial = await tx.enrollment.findUnique({ where: { id }, select: { studentId: true } });
    if (!initial) throw fail('Оформление не найдено', 404);
    // All financial paths lock Student first. Do not invert this order in enrollment.
    await tx.$queryRaw`SELECT id FROM "Student" WHERE id = ${initial.studentId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Enrollment" WHERE id = ${id} FOR UPDATE`;
    return tx.enrollment.findUniqueOrThrow({ where: { id }, include: { student: { select: STUDENT_SELECT } } });
}
async function saveEnrollment(id, input, actorId) {
    return prisma.$transaction(async tx => {
        const e = await locked(tx, id);
        if (e.revision !== input.revision) throw fail('Оформление изменил другой администратор. Обновите данные перед сохранением.', 409);
        const customer = input.customer === undefined ? e.customer : normalizeCustomer(input.customer, e.student);
        const terms = input.terms === undefined ? e.terms : normalizeTerms(input.terms);
        const signed = await tx.enrollmentDocument.findFirst({ where: { enrollmentId: id, OR: [{ contractSignedAt: { not: null } }, { appendixSignedAt: { not: null } }, { consentSignedAt: { not: null } }] } });
        if (signed || e.activatedAt) throw fail('Условия уже подписаны или запущен оплаченный период. Изменение требует отдельного приложения.', 409);
        const documentDate = input.documentDate || e.terms?.documentDate || today();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(documentDate) || !Number.isFinite(new Date(`${documentDate}T00:00:00Z`).getTime()) || new Date(`${documentDate}T00:00:00Z`).toISOString().slice(0, 10) !== documentDate) throw fail('Некорректная дата договора.');
        return tx.enrollment.update({ where: { id }, data: { customer, ...(terms ? { terms: { ...terms, documentDate } } : {}), revision: { increment: 1 }, completedAt: null } });
    });
}
async function prepareDocuments(id, actorId, revision) {
    return prisma.$transaction(async tx => {
        const e = await locked(tx, id);
        if (e.revision !== revision) throw fail('Обновите оформление перед подготовкой документов.', 409);
        if (!e.customer || !e.terms) throw fail('Сначала сохраните заказчика и условия обучения.');
        normalizeCustomer(e.customer, e.student); normalizeTerms(e.terms);
        const existing = await tx.enrollmentDocument.findUnique({ where: { enrollmentId_revision: { enrollmentId: id, revision } } });
        if (existing) return existing.id;
        // Reserve the printable contract number before creating its immutable snapshot.
        const [{ number }] = await tx.$queryRaw`SELECT nextval('"EnrollmentDocument_number_seq"')::int AS number`;
        const snapshot = { student: e.student, customer: e.customer, terms: e.terms, documentDate: e.terms.documentDate, number: `М-${number}` };
        const doc = await tx.enrollmentDocument.create({ data: { enrollmentId: id, revision, number, snapshot,
            templateVersion: TEMPLATE_VERSION, html: buildEnrollmentDocuments(snapshot), preparedById: actorId } });
        return doc.id;
    });
}
function normalizeIntent(input) {
    const amount = parsePositiveMoney(input.amount);
    let paymentMethod;
    try { paymentMethod = normalizePaymentMethod(input.paymentMethod); } catch (err) { throw fail(err.message); }
    const payer = text(input.payer), notes = text(input.notes, 1000);
    const date = new Date(input.paymentDate);
    if (!payer || typeof input.paymentDate !== 'string' || !Number.isFinite(date.getTime()) || date > new Date(Date.now() + 60000)) throw fail('Укажите плательщика и дату реально полученной оплаты (не в будущем).');
    return { amount, paymentMethod, payer, notes, paymentDate: date.toISOString() };
}
async function preparePayment(id, input, actorId) {
    const payload = normalizeIntent(input);
    return prisma.$transaction(async tx => {
        const e = await locked(tx, id);
        const pending = await tx.enrollmentPaymentIntent.findFirst({ where: { enrollmentId: id, paymentId: null, cancelledAt: null } });
        if (pending) return pending;
        if (e.completedAt) {
            const paid = await paidFor(tx, id);
            const remainder = Math.max(0, (e.terms?.totalPrice || 0) - paid.amount);
            if (!remainder || payload.amount > remainder) throw fail('Первое оформление завершено. Здесь можно внести только оставшуюся доплату за этот период; новую покупку оформляйте отдельно.', 409);
        }
        return tx.enrollmentPaymentIntent.create({ data: { id: randomUUID(), enrollmentId: id, payload, createdById: actorId } });
    });
}
async function confirmPayment(id, intentId, actorId) {
    return prisma.$transaction(async tx => {
        const e = await locked(tx, id);
        const intent = await tx.enrollmentPaymentIntent.findFirst({ where: { id: intentId, enrollmentId: id } });
        if (!intent || intent.cancelledAt) throw fail('Оплата не найдена или черновик отменён.', 404);
        if (intent.paymentId) return { paymentId: intent.paymentId, repeated: true };
        const p = intent.payload;
        const payment = await recordReceivedPayment(tx, { studentId: e.studentId, parsedAmount: p.amount,
            normalizedType: 'membership_full', actorId, notes: `Оформление ${e.id}. Плательщик: ${p.payer}. ${p.notes}`,
            paymentDate: new Date(p.paymentDate), normalizedPaymentMethod: p.paymentMethod });
        await tx.enrollmentPaymentIntent.update({ where: { id: intent.id }, data: { paymentId: payment.id, confirmedAt: new Date() } });
        if (e.membershipId) {
            await tx.payment.update({ where: { id: payment.id }, data: { membershipId: e.membershipId } });
            const paid = await paidFor(tx, id);
            await tx.membership.update({ where: { id: e.membershipId }, data: { paidAmount: paid.amount, remainingAmount: Math.max(0, e.terms.totalPrice - paid.amount), paymentStatus: paid.amount >= e.terms.totalPrice ? 'paid' : 'partial' } });
        }
        // Completion remains recorded; the queue also tracks an outstanding installment.
        return { paymentId: payment.id, repeated: false };
    }, { timeout: 20000 });
}
async function paidFor(tx, id) {
    const intents = await tx.enrollmentPaymentIntent.findMany({ where: { enrollmentId: id, paymentId: { not: null } } });
    const payments = await tx.payment.findMany({ where: { id: { in: intents.map(i => i.paymentId) } }, include: { relatedPayments: { select: { amount: true, status: true } } } });
    return { intents, payments, amount: payments.reduce((sum, p) => sum + (p.status === 'completed' ? Math.max(0, p.amount - p.relatedPayments.filter(x => x.status === 'refunded').reduce((n, x) => n + x.amount, 0)) : 0), 0) };
}
async function activateEnrollment(id, actorId) {
    return prisma.$transaction(async tx => {
        const e = await locked(tx, id);
        if (e.membershipId) return e;
        if (!e.terms) throw fail('Сначала сохраните условия обучения.');
        const doc = await tx.enrollmentDocument.findUnique({ where: { enrollmentId_revision: { enrollmentId: id, revision: e.revision } } });
        if (doc && !sameDocumentStudent(doc.snapshot.student, e.student)) throw fail('Данные ученика изменились после подготовки документов. Нужна сверка подписанного экземпляра.', 409);
        if (!doc?.contractSignedAt || !doc?.appendixSignedAt) throw fail('Отметьте фактически подписанные договор и приложение.');
        const paid = await paidFor(tx, id);
        if (paid.amount < e.terms.firstPayment) throw fail(`Для запуска периода нужно получить ${e.terms.firstPayment} ₸. Уже получено ${paid.amount} ₸.`);
        const active = await tx.membership.findFirst({ where: { studentId: e.studentId, status: 'active' } });
        if (active) throw fail('У ученика уже есть активный тариф. Первое оформление не заменяет его: продолжите работу с действующим тарифом в карточке.', 409);
        // No blanket carry-forward of historic balances. This action buys the first explicit period.
        const ordered = [...paid.payments].filter(p => p.status === 'completed').sort((a, b) => a.paymentDate - b.paymentDate);
        let cumulative = 0, thresholdDate;
        for (const p of ordered) {
            cumulative += Math.max(0, p.amount - p.relatedPayments.filter(x => x.status === 'refunded').reduce((n, x) => n + x.amount, 0));
            if (cumulative >= e.terms.firstPayment) { thresholdDate = p.paymentDate; break; }
        }
        const validFrom = new Date(`${today(thresholdDate)}T00:00:00.000Z`);
        const validUntil = new Date(validFrom); validUntil.setUTCDate(validUntil.getUTCDate() + e.terms.days);
        const membership = await tx.membership.create({ data: { ...rateCardMembershipData({ studentId: e.studentId, name: e.terms.name,
            rates: e.terms.rates, actorId, emergencyFreezesAvailable: e.terms.emergencyCancellations }),
            validFrom, validUntil, totalPrice: e.terms.totalPrice, paidAmount: paid.amount,
            remainingAmount: Math.max(0, e.terms.totalPrice - paid.amount), paymentStatus: paid.amount >= e.terms.totalPrice ? 'paid' : 'partial' } });
        await tx.student.update({ where: { id: e.studentId }, data: { activeMembershipId: membership.id } });
        await tx.payment.updateMany({ where: { id: { in: paid.payments.map(p => p.id) } }, data: { membershipId: membership.id } });
        await tx.membershipTransaction.create({ data: { membershipId: membership.id, type: 'initial', amount: 0, addedById: actorId, reason: `Первое оформление ${id}; договор М-${doc.number}; срок ${e.terms.days} дней` } });
        return tx.enrollment.update({ where: { id }, data: { membershipId: membership.id, activatedAt: new Date(), completedAt: null } });
    });
}
async function enrollmentView(id, db = prisma) {
    const e = await db.enrollment.findUnique({ where: { id }, include: { student: { select: STUDENT_SELECT },
        documents: { orderBy: { createdAt: 'desc' }, select: { id: true, revision: true, number: true, templateVersion: true,
            snapshot: true, createdAt: true, printedAt: true, contractSignedAt: true, appendixSignedAt: true, consentSignedAt: true } },
        paymentIntents: { orderBy: { createdAt: 'desc' } } } });
    if (!e) throw fail('Оформление не найдено', 404);
    const [paid, membership, nextLesson, charged] = await Promise.all([
        paidFor(db, id), e.membershipId ? db.membership.findUnique({ where: { id: e.membershipId } }) : null,
        db.class.findFirst({ where: { status: 'scheduled', AND: [{ OR: [{ date: { gt: new Date(`${today()}T00:00:00Z`) } }, { date: new Date(`${today()}T00:00:00Z`), startTime: { gte: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Aqtobe', hour: '2-digit', minute: '2-digit' }).format(new Date()) } }] }],
            OR: [{ individualStudentId: e.studentId }, { attendees: { some: { studentId: e.studentId } } }, { group: { students: { some: { studentId: e.studentId, status: 'active' } } } }] },
            orderBy: [{ date: 'asc' }, { startTime: 'asc' }], select: { id: true, title: true, date: true, startTime: true, duration: true, teacherId: true, teacher: { select: { name: true, lastName: true, middleName: true, role: true, status: true } }, classType: true, group: { select: { billingType: true } } } }),
        e.membershipId ? db.classAttendee.findMany({ where: { chargedMembershipId: e.membershipId, studentId: e.studentId, chargeAmount: { gt: 0 } }, select: { classId: true } }) : [],
    ]);
    const doc = e.documents.find(d => d.revision === e.revision);
    let minor = null; try { minor = isMinor(e.student.dateOfBirth); } catch {}
    const nextKind = nextLesson && getLessonBillingType(nextLesson);
    const ratesMatch = Boolean(membership && e.terms && Object.keys(membership.lessonRates || {}).length === Object.keys(e.terms.rates).length
        && Object.entries(e.terms.rates).every(([kind, rate]) => membership.lessonRates?.[kind]?.price === rate.price));
    const scheduleReady = Boolean(ratesMatch && e.student.status === 'active' && nextLesson?.teacher?.role === 'teacher' && nextLesson.teacher.status !== 'inactive' && nextLesson.teacherId && membership?.status === 'active' && membership.lessonRates?.[nextKind]
        && nextLesson.duration === e.terms?.durations?.[nextKind]
        && nextLesson.date >= membership.validFrom && nextLesson.date <= membership.validUntil);
    const steps = [
        { key: 'details', label: 'Ученик и заказчик', ready: Boolean(e.customer && minor !== null) },
        { key: 'terms', label: 'Условия обучения', ready: Boolean(e.terms) },
        { key: 'documents', label: 'Договор, приложение и согласие', ready: Boolean(doc?.contractSignedAt && doc?.appendixSignedAt && doc?.consentSignedAt && sameDocumentStudent(doc.snapshot.student, e.student)) },
        { key: 'payment', label: 'Полученная оплата и запуск периода', ready: Boolean(ratesMatch && membership?.status === 'active' && paid.amount >= e.terms?.firstPayment) },
        { key: 'schedule', label: 'Первый урок в календаре', ready: scheduleReady },
        { key: 'access', label: 'Кабинеты семьи и передача доступа', ready: Boolean(e.student.appUserId && e.student.externalLinkStatus === 'linked' && e.studentHandedAt && (minor === false || e.parentUserId && e.parentHandedAt)) },
    ];
    const paymentStates = new Map(paid.payments.map(p => [p.id, { amount: p.amount, status: p.status }]));
    return { ...e, paymentIntents: e.paymentIntents.map(i => ({ ...i, payment: paymentStates.get(i.paymentId) || null })), minor, paidAmount: paid.amount, remainingAmount: Math.max(0, (e.terms?.totalPrice || 0) - paid.amount),
        countedLessons: new Set(charged.map(c => c.classId).filter(Boolean)).size,
        membership, nextLesson, steps, nextStep: steps.find(s => !s.ready)?.key || null,
        readyForLesson: steps.slice(0, 5).every(s => s.ready), complete: steps.every(s => s.ready) };
}
module.exports = { fail, today, isMinor, normalizeCustomer, normalizeTerms, normalizeIntent, sameDocumentStudent, locked,
    startEnrollment, saveEnrollment, prepareDocuments, preparePayment, confirmPayment, activateEnrollment, enrollmentView, STUDENT_SELECT };
