const express = require('express');
const multer = require('multer');
const { prisma } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const service = require('../services/documentScans');
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: service.MAX_FILE_SIZE, files: 1, fields: 1, fieldSize: 50, parts: 3 } }).single('file');
let uploadsInFlight = 0;
router.use(authenticate, requireAdmin, (req, res, next) => { res.set('Cache-Control', 'private, no-store, max-age=0'); next(); });
function respondError(res, err) {
    const uploadError = err instanceof multer.MulterError;
    const status = uploadError ? (err.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : err.statusCode || 500;
    res.status(status).json({ success: false, error: uploadError ? 'Загрузите один PDF, JPEG или PNG размером до 8 МБ.' : err.statusCode ? err.message : 'Не удалось сохранить скан. Обновите список перед повтором.' });
}
const run = fn => async (req, res) => { try { await fn(req, res); } catch (err) { respondError(res, err); } };
router.get('/:scope/:documentId', run(async (req, res) => res.json({ success: true, ...await service.list(req.params.scope, req.params.documentId) })));
router.post('/:scope/:documentId', run(async (req, res) => {
    // Authenticate/authorize and validate target before buffering any file.
    const context = await service.target(prisma, req.params.scope, req.params.documentId);
    if (!context.canUpload) return res.status(409).json({ success: false, error: 'Расчёт отменён; новые сканы не принимаются.' });
    if (uploadsInFlight >= 4) return res.status(429).json({ success: false, error: 'Сейчас загружаются другие файлы. Повторите через несколько секунд.' });
    uploadsInFlight++;
    let released = false;
    const release = () => { if (!released) { released = true; uploadsInFlight--; } };
    res.once('finish', release); res.once('close', release);
    upload(req, res, async err => {
        try {
            if (err) throw err;
            const result = await service.upload(req.params.scope, req.params.documentId, req.body.kind, req.file, req.user.id);
            res.status(result.repeated ? 200 : 201).json({ success: true, ...result });
        } catch (error) { respondError(res, error); }
        finally { release(); }
    });
}));
router.get('/:scope/:documentId/:scanId/file', run(async (req, res) => {
    const scan = await service.download(req.params.scope, req.params.documentId, req.params.scanId, req.query.review === '1');
    res.set({ 'Content-Type': scan.mimeType, 'Content-Length': String(scan.size), 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'", 'Content-Disposition': `attachment; filename="scan.${scan.mimeType === 'application/pdf' ? 'pdf' : scan.mimeType === 'image/png' ? 'png' : 'jpg'}"; filename*=UTF-8''${encodeURIComponent(scan.fileName).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}` });
    res.send(Buffer.from(scan.fileData));
}));
router.post('/:scope/:documentId/:scanId/review', run(async (req, res) => res.json({ success: true, ...await service.review(req.params.scope, req.params.documentId, req.params.scanId, req.body, req.user.id) })));
module.exports = router;
