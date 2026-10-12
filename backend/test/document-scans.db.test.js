const test = require('node:test');
const assert = require('node:assert/strict');
if (!process.env.TEST_DATABASE_URL) {
    test('private document scans PostgreSQL/HTTP', { skip: 'TEST_DATABASE_URL required' }, () => {});
} else {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && /test|qa/.test(url.pathname));
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL, JWT_SECRET: 'document-scans-test-only', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' });
    const express = require('express'), jwt = require('jsonwebtoken');
    const { prisma } = require('../src/config/db');
    const service = require('../src/services/documentScans');
    const enrollmentService = require('../src/services/enrollment');
    const { rateCardMembershipData, normalizeRates } = require('../src/services/rateCards');
    const { createIdempotencyMiddleware } = require('../src/middleware/idempotency');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG1sAAAAASUVORK5CYII=', 'base64');
    const pdf = n => Buffer.from(`%PDF-1.4\n% scan fixture ${n}\n%%EOF\n`);
    const file = (buffer = png, originalname = 'Подписанный договор.png') => ({ buffer, originalname });
    const terms = { name: 'Индивидуально', direction: 'Гитара', scheduleText: 'Суббота 14:00', days: 45, totalPrice: 24000, firstPayment: 12000, emergencyCancellations: 1, rates: { individual: 4000 }, durations: { individual: 45 } };
    let server, base, admin, student, doc, renewal, renewalDoc;
    const person = extra => prisma.student.create({ data: { name: 'Проверка', lastName: 'Сканы', role: 'student', dateOfBirth: new Date('1990-01-01'), phone: '77770001122', password: 'test-only', ...extra } });
    const auth = actor => actor ? { Authorization: `Bearer ${jwt.sign({ id: actor.id }, process.env.JWT_SECRET)}` } : {};
    async function request(path, body, actor = admin) {
        const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...auth(actor), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) });
        return { status: r.status, headers: r.headers, data: r.headers.get('content-type')?.includes('application/json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
    }
    function multipart(data = png, name = 'Подписанный договор.png', kind = 'contract', mime = 'image/png') {
        const f = new FormData(); f.append('kind', kind); f.append('file', new Blob([data], { type: mime }), name); return f;
    }
    const endpoint = () => `/enrollment/${doc.id}`;
    test.before(async () => {
        const app = express(); app.use(express.json()); app.use(createIdempotencyMiddleware(prisma)); app.use('/api/document-scans', require('../src/routes/documentScans'));
        await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); base = `http://127.0.0.1:${server.address().port}/api/document-scans`;
    });
    test.beforeEach(async () => {
        const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
        await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"${t.tablename}"`).join(',')} CASCADE`);
        admin = await person({ role: 'super_admin' }); student = await person({});
        const e = await enrollmentService.startEnrollment(student.id, admin.id);
        const saved = await enrollmentService.saveEnrollment(e.id, { revision: e.revision, terms, customer: { type: 'self', iin: '900101000001', address: 'Тестовый адрес', phone: '77770001122' } }, admin.id);
        doc = await prisma.enrollmentDocument.findUniqueOrThrow({ where: { id: await enrollmentService.prepareDocuments(e.id, admin.id, saved.revision) } });
        const source = await prisma.membership.create({ data: rateCardMembershipData({ studentId: student.id, name: terms.name, rates: normalizeRates(terms.rates), actorId: admin.id }) });
        renewal = await prisma.subscriptionRenewal.create({ data: { studentId: student.id, previousMembershipId: source.id, terms, documentBasis: {}, creditAmount: 0, creditReason: '', paymentPayload: {}, sourceSnapshot: {}, sourceHash: 'fixture', createdById: admin.id } });
        renewalDoc = await prisma.renewalDocument.create({ data: { renewalId: renewal.id, templateVersion: 'test', snapshot: { studentId: student.id }, html: '<p>Test appendix</p>', preparedById: admin.id } });
    });
    test.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await prisma.$disconnect(); });
    test('concurrent upload is deduplicated; private download preserves bytes and upload does not sign or change money', async () => {
        const beforeEntries = await prisma.studentBalanceEntry.findMany();
        const results = await Promise.all([request(endpoint(), multipart()), request(endpoint(), multipart())]);
        assert.deepEqual(results.map(r => r.status).sort(), [200, 201], JSON.stringify(results));
        assert.equal(results[0].data.file.id, results[1].data.file.id);
        assert.equal(results[0].data.file.fileName, 'Подписанный договор.png');
        const id = results[0].data.file.id;
        const list = await request(endpoint()); assert.equal(list.data.files.length, 1);
        assert.ok(list.headers.get('cache-control').includes('no-store')); assert.equal(list.data.files[0].fileData, undefined); assert.equal(list.data.files[0].digest, undefined);
        const download = await request(`${endpoint()}/${id}/file`);
        assert.equal(download.status, 200); assert.deepEqual(download.data, png);
        assert.equal(download.headers.get('content-type'), 'image/png'); assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
        assert.match(download.headers.get('content-disposition'), /^attachment;/); assert.match(download.headers.get('content-security-policy'), /sandbox/);
        const after = await prisma.enrollmentDocument.findUniqueOrThrow({ where: { id: doc.id } });
        assert.equal(after.html, doc.html); assert.equal(after.contractSignedAt, null); assert.equal(after.appendixSignedAt, null); assert.equal(after.consentSignedAt, null);
        assert.equal(await prisma.payment.count(), 0); assert.deepEqual(await prisma.studentBalanceEntry.findMany(), beforeEntries); assert.equal((await prisma.student.findUnique({ where: { id: student.id } })).accountBalance, 0);
        assert.equal(await prisma.activityLog.count({ where: { action: 'document_scan_uploaded' } }), 1);
    });
    test('rejects disguised HTML/SVG, incomplete files, extra parts, oversize bodies and unsupported document kinds', async () => {
        for (const data of [Buffer.from('<svg onload="alert(1)"></svg>'), Buffer.from('<html>fake.pdf</html>'), png.subarray(0, -12), Buffer.from('%PDF-1.4\nincomplete')]) {
            assert.equal((await request(endpoint(), multipart(data, 'scan.pdf', 'contract', 'application/pdf'))).status, 400);
        }
        assert.equal((await request(endpoint(), multipart(Buffer.alloc(service.MAX_FILE_SIZE + 1)))).status, 413);
        assert.equal((await request(endpoint(), multipart(png, 'scan.png', 'unknown'))).status, 400);
        const multiple = multipart(); multiple.append('file', new Blob([png]), 'second.png'); assert.equal((await request(endpoint(), multiple)).status, 400);
        assert.equal((await request(endpoint(), { kind: 'contract' })).status, 400);
        assert.equal(await prisma.documentScan.count(), 0);
    });
    test('downloads use detected MIME and safe filenames, with exact target matching', async () => {
        const r = await request(endpoint(), multipart(pdf(1), 'wrong.svg', 'appendix', 'text/html'));
        assert.equal(r.status, 201, JSON.stringify(r)); assert.equal(r.data.file.mimeType, 'application/pdf'); assert.equal(r.data.file.fileName, 'wrong.pdf');
        const id = r.data.file.id;
        assert.equal((await request(`/renewal/${renewalDoc.id}/${id}/file`)).status, 404);
        assert.equal((await request(`/enrollment/${renewalDoc.id}/${id}/file`)).status, 404);
        assert.equal((await request(`/other/${doc.id}`)).status, 404);
        const safe = service.inspectFile(file(png, '../subdir/unsafe\r\nname.svg'));
        assert.equal(safe.fileName, 'unsafename.png');
    });
    test('teacher, student, sales and revoked administrators cannot read or upload private scans', async () => {
        const saved = await service.upload('enrollment', doc.id, 'consent', file(), admin.id);
        for (const role of ['teacher', 'student', 'sales_manager', 'staff']) {
            const actor = await person({ role });
            assert.equal((await request(endpoint(), undefined, actor)).status, 403, role);
            assert.equal((await request(`${endpoint()}/${saved.file.id}/file`, undefined, actor)).status, 403, role);
            assert.equal((await request(endpoint(), multipart(), actor)).status, 403, role);
        }
        assert.equal((await request(endpoint(), undefined, null)).status, 401);
        const actor = await person({ role: 'admin' });
        await prisma.rolePermissions.create({ data: { role: 'admin', permissions: { canManageStudents: false }, visibility: {} } });
        assert.equal((await request(endpoint(), undefined, actor)).status, 403);
        assert.equal((await request(endpoint(), multipart(), actor)).status, 403);
        assert.equal((await request(`${endpoint()}/${saved.file.id}/review`, { action: 'withdraw', confirmed: true, reason: 'Не тот скан', version: 0 }, actor)).status, 403);
    });
    test('manual withdrawal and restoration retain originals, require reasons and reject stale opposite decisions', async () => {
        const saved = await service.upload('enrollment', doc.id, 'contract', file(), admin.id), id = saved.file.id;
        const reviewPath = `${endpoint()}/${id}/review`;
        const withdrawal = { action: 'withdraw', confirmed: true, reason: 'Прикреплён не тот документ', version: 0 };
        assert.equal((await request(reviewPath, { ...withdrawal, confirmed: false })).status, 400);
        assert.equal((await request(reviewPath, { ...withdrawal, reason: '' })).status, 400);
        assert.equal((await request(reviewPath, withdrawal)).status, 200); assert.equal((await request(reviewPath, withdrawal)).status, 200);
        assert.equal((await request(`${endpoint()}/${id}/file`)).status, 409);
        const reviewCopy = await request(`${endpoint()}/${id}/file?review=1`);
        assert.deepEqual(reviewCopy.data, png); assert.match(decodeURIComponent(reviewCopy.headers.get('content-disposition')), /ОШИБОЧНЫЙ-для-проверки-/);
        assert.equal((await request(endpoint(), multipart())).status, 409);
        assert.equal((await request(reviewPath, { ...withdrawal, action: 'restore' })).status, 409);
        assert.equal((await request(reviewPath, { ...withdrawal, action: 'restore', version: 1, reason: 'Проверено с бумажным экземпляром' })).status, 200);
        assert.equal((await request(reviewPath, withdrawal)).status, 409);
        assert.deepEqual((await request(`${endpoint()}/${id}/file`)).data, png);
        const original = await prisma.documentScan.findUniqueOrThrow({ where: { id } });
        assert.deepEqual(Buffer.from(original.fileData), png); assert.equal(original.reviewVersion, 2); assert.equal(original.withdrawnAt, null);
        assert.equal(await prisma.activityLog.count({ where: { entityType: 'DocumentScan', entityId: id } }), 3);
    });
    test('database blocks alteration/deletion of an original; audit failure rolls back the entire upload', async () => {
        const { file: scan } = await service.upload('enrollment', doc.id, 'contract', file(), admin.id);
        await assert.rejects(prisma.documentScan.update({ where: { id: scan.id }, data: { fileData: pdf(1), reviewVersion: 1 } }), /immutable/);
        await assert.rejects(prisma.documentScan.update({ where: { id: scan.id }, data: { kind: 'consent', reviewVersion: 1 } }), /immutable/);
        await assert.rejects(prisma.documentScan.delete({ where: { id: scan.id } }), /immutable/);
        await assert.rejects(service.upload('enrollment', doc.id, 'appendix', file(pdf(2)), 'nonexistent-actor'));
        assert.equal(await prisma.documentScan.count(), 1);
    });
    test('renewal scans accept only appendices and survive cancellation as private history without new uploads', async () => {
        const path = `/renewal/${renewalDoc.id}`;
        assert.equal((await request(path, multipart())).status, 400);
        const r = await request(path, multipart(png, 'Приложение.png', 'appendix')); assert.equal(r.status, 201, JSON.stringify(r));
        assert.equal((await prisma.renewalDocument.findUnique({ where: { id: renewalDoc.id } })).signedAt, null);
        await prisma.subscriptionRenewal.update({ where: { id: renewal.id }, data: { cancelledAt: new Date() } });
        const list = await request(path); assert.equal(list.data.canUpload, false); assert.equal(list.data.files.length, 1);
        assert.equal((await request(path, multipart(pdf(9), 'new.pdf', 'appendix'))).status, 409);
        assert.deepEqual((await request(`${path}/${r.data.file.id}/file`)).data, png);
        const history = await require('../src/services/subscriptionPeriods').studentPeriods(student.id);
        assert.ok(history.documents.some(d => d.id === renewalDoc.id && d.renewal.cancelledAt));
    });
    test('multiple pages stay separate; retries are allowed at the per-document file limit', async () => {
        for (let i = 0; i < 30; i++) await service.upload('enrollment', doc.id, 'contract', file(pdf(i), `Страница ${i}.pdf`), admin.id);
        await assert.rejects(service.upload('enrollment', doc.id, 'contract', file(pdf(31)), admin.id), /лимит/);
        const repeat = await service.upload('enrollment', doc.id, 'contract', file(pdf(0)), admin.id);
        assert.equal(repeat.repeated, true); assert.equal(await prisma.documentScan.count(), 30);
    });
}
