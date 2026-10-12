const { createHash } = require('node:crypto');
const { prisma } = require('../config/db');
const { fail } = require('./enrollment');
const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_DOCUMENT_SIZE = 64 * 1024 * 1024;
const metadata = { id: true, kind: true, fileName: true, mimeType: true, size: true, createdAt: true,
    uploadedById: true, withdrawnAt: true, reviewVersion: true, reviewedById: true, reviewReason: true };
const kindLabels = { contract: 'Договор', appendix: 'Приложение', consent: 'Согласие на обработку данных' };

function inspectFile(file) {
    const data = file?.buffer;
    if (!Buffer.isBuffer(data) || !data.length) throw fail('Выберите PDF, JPEG или PNG со сканом документа.');
    if (data.length > MAX_FILE_SIZE) throw fail('Размер одного файла — не больше 8 МБ.', 413);
    let mimeType, extension;
    // Determine the served type from bytes, never from the supplied filename/MIME.
    if (/^%PDF-(?:1\.[0-7]|2\.0)[\r\n ]/.test(data.subarray(0, 10).toString('ascii')) && /%%EOF\s*$/.test(data.subarray(-2048).toString('ascii'))) {
        mimeType = 'application/pdf'; extension = 'pdf';
    } else if (data.length >= 33 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        && data.subarray(12, 16).toString('ascii') === 'IHDR' && data.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'))) {
        mimeType = 'image/png'; extension = 'png';
    } else if (data.length >= 4 && data[0] === 255 && data[1] === 216 && data[2] === 255 && data.subarray(-2).equals(Buffer.from('ffd9', 'hex'))) {
        mimeType = 'image/jpeg'; extension = 'jpg';
    } else throw fail('Файл не похож на завершённый PDF, JPEG или PNG. Экспортируйте скан в один из этих форматов.');
    let name = String(file.originalname || 'Скан');
    // Multipart clients commonly encode UTF-8 filenames which Busboy reads as latin1.
    if ([...name].every(c => c.codePointAt(0) <= 255)) {
        const decoded = Buffer.from(name, 'latin1').toString('utf8');
        if (!decoded.includes('\uFFFD')) name = decoded;
    }
    name = name.split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\.[^.]*$/, '').trim() || 'Скан';
    name = [...name].slice(0, 150).join('');
    return { fileData: data, mimeType, fileName: `${name}.${extension}`, size: data.length,
        digest: createHash('sha256').update(data).digest('hex') };
}
function targetWhere(scope, id) {
    if (!['enrollment', 'renewal'].includes(scope) || typeof id !== 'string' || !id) throw fail('Выберите сохранённый экземпляр документа.', 404);
    return scope === 'enrollment' ? { enrollmentDocumentId: id } : { renewalDocumentId: id };
}
async function target(db, scope, id, lock = false) {
    const where = targetWhere(scope, id);
    const load = () => scope === 'enrollment'
        ? db.enrollmentDocument.findUnique({ where: { id }, select: { number: true, enrollment: { select: { studentId: true } } } })
        : db.renewalDocument.findUnique({ where: { id }, select: { number: true, renewal: { select: { studentId: true, cancelledAt: true } } } });
    let doc = await load();
    if (!doc) throw fail('Экземпляр документа не найден.', 404);
    const studentId = doc.enrollment?.studentId || doc.renewal.studentId;
    if (lock) { await db.$queryRaw`SELECT id FROM "Student" WHERE id = ${studentId} FOR UPDATE`; doc = await load(); }
    return { where, studentId, title: scope === 'enrollment' ? `Комплект к договору М-${doc.number}` : `Приложение П-${doc.number}`,
        canUpload: !doc.renewal?.cancelledAt, kinds: scope === 'enrollment' ? kindLabels : { appendix: kindLabels.appendix } };
}
async function list(scope, id) {
    const context = await target(prisma, scope, id);
    const files = await prisma.documentScan.findMany({ where: context.where, select: metadata, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return { title: context.title, canUpload: context.canUpload, kinds: context.kinds, files };
}
async function upload(scope, id, kind, file, actorId) {
    const data = inspectFile(file);
    return prisma.$transaction(async db => {
        const context = await target(db, scope, id, true);
        if (!context.canUpload) throw fail('Расчёт продления отменён. Его сохранённые сканы доступны только для просмотра и проверки.', 409);
        if (!Object.hasOwn(context.kinds, kind)) throw fail('Выберите договор, приложение или согласие.');
        const existing = await db.documentScan.findFirst({ where: { ...context.where, kind, digest: data.digest }, select: metadata });
        if (existing?.withdrawnAt) throw fail('Этот файл уже отмечен ошибочным. Проверьте историю сканов и при необходимости восстановите его отдельным действием.', 409);
        if (existing) return { file: existing, repeated: true };
        const totals = await db.documentScan.aggregate({ where: context.where, _count: { id: true }, _sum: { size: true } });
        if (totals._count.id >= 30 || (totals._sum.size || 0) + data.size > MAX_DOCUMENT_SIZE) throw fail('Для этого экземпляра уже достигнут лимит: 30 файлов или 64 МБ вместе с историей. Объедините страницы в компактный PDF.', 409);
        const saved = await db.documentScan.create({ data: { ...context.where, kind, ...data, uploadedById: actorId }, select: metadata });
        await db.activityLog.create({ data: { userId: actorId, action: 'document_scan_uploaded', entityType: 'DocumentScan', entityId: saved.id,
            details: `${kindLabels[kind]}: ${context.title}`, metadata: { studentId: context.studentId, scope, documentId: id, digest: data.digest, size: data.size } } });
        return { file: saved, repeated: false };
    }, { timeout: 20000 });
}
async function download(scope, id, scanId, forReview = false) {
    const context = await target(prisma, scope, id);
    const scan = await prisma.documentScan.findFirst({ where: { id: scanId, ...context.where }, select: { ...metadata, fileData: true } });
    if (!scan) throw fail('Скан не найден в этом экземпляре документа.', 404);
    if (scan.withdrawnAt && !forReview) throw fail('Скан отмечен ошибочным. Для использования сначала проверьте его и восстановите отдельным действием.', 409);
    return scan.withdrawnAt ? { ...scan, fileName: `ОШИБОЧНЫЙ-для-проверки-${scan.fileName}` } : scan;
}
async function review(scope, id, scanId, input, actorId) {
    input = input || {};
    if (!['withdraw', 'restore'].includes(input.action) || input.confirmed !== true || !Number.isSafeInteger(input.version)) throw fail('Подтвердите действие со сканом.');
    const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 1000) : '';
    if (reason.length < 5) throw fail('Укажите причину (не менее 5 символов).');
    return prisma.$transaction(async db => {
        const context = await target(db, scope, id, true);
        const scan = await db.documentScan.findFirst({ where: { id: scanId, ...context.where }, select: metadata });
        if (!scan) throw fail('Скан не найден в этом экземпляре документа.', 404);
        const withdraw = input.action === 'withdraw';
        if (Boolean(scan.withdrawnAt) === withdraw) return { file: scan, repeated: true };
        if (scan.reviewVersion !== input.version) throw fail('Состояние скана изменил другой администратор. Обновите список и проверьте его заново.', 409);
        const file = await db.documentScan.update({ where: { id: scan.id }, data: { withdrawnAt: withdraw ? new Date() : null,
            reviewVersion: { increment: 1 }, reviewedById: actorId, reviewReason: reason }, select: metadata });
        await db.activityLog.create({ data: { userId: actorId, action: withdraw ? 'document_scan_withdrawn' : 'document_scan_restored', entityType: 'DocumentScan', entityId: scan.id,
            details: reason, metadata: { studentId: context.studentId, scope, documentId: id, reviewVersion: file.reviewVersion } } });
        return { file, repeated: false };
    });
}
module.exports = { MAX_FILE_SIZE, inspectFile, target, list, upload, download, review };
