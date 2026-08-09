const QR_TTL_MS = 90_000;
const MAX_QR_BYTES = 512 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const qrByAccount = new Map();

function normalizeAccountKey(value) {
    const accountKey = String(value || '').trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,79}$/.test(accountKey)) {
        throw new Error('Некорректный accountKey');
    }
    return accountKey;
}

function decodePngBase64(value) {
    const imageBase64 = String(value || '').trim();
    if (!imageBase64 || imageBase64.length > Math.ceil(MAX_QR_BYTES * 4 / 3) + 16) {
        throw new Error('Некорректное изображение QR');
    }
    if (!/^[a-zA-Z0-9+/]+={0,2}$/.test(imageBase64)) {
        throw new Error('Некорректное изображение QR');
    }
    const image = Buffer.from(imageBase64, 'base64');
    if (!image.length || image.length > MAX_QR_BYTES || !image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
        throw new Error('QR должен быть PNG-изображением');
    }
    return image;
}

function putWhatsappQr({ accountKey, imageBase64, workerId, now = new Date() }) {
    const key = normalizeAccountKey(accountKey);
    const image = decodePngBase64(imageBase64);
    const capturedAt = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(capturedAt.getTime())) throw new Error('Некорректное время QR');

    const entry = {
        accountKey: key,
        workerId: String(workerId || '').trim() || null,
        image,
        capturedAt,
        expiresAt: new Date(capturedAt.getTime() + QR_TTL_MS),
    };
    qrByAccount.set(key, entry);
    return entry;
}

function getWhatsappQr(accountKey, now = new Date()) {
    const key = normalizeAccountKey(accountKey);
    const entry = qrByAccount.get(key);
    if (!entry) return null;
    const currentTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
    if (!Number.isFinite(currentTime) || entry.expiresAt.getTime() <= currentTime) {
        qrByAccount.delete(key);
        return null;
    }
    return entry;
}

function clearWhatsappQr(accountKey) {
    return qrByAccount.delete(normalizeAccountKey(accountKey));
}

function clearAllWhatsappQr() {
    qrByAccount.clear();
}

module.exports = {
    QR_TTL_MS,
    MAX_QR_BYTES,
    putWhatsappQr,
    getWhatsappQr,
    clearWhatsappQr,
    clearAllWhatsappQr,
};
