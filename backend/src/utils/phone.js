function normalizePhoneDigits(phone) {
    if (!phone) return '';
    let digits = String(phone).replace(/\D/g, '');
    if (digits.startsWith('8') && digits.length === 11) {
        digits = `7${digits.slice(1)}`;
    }
    return digits;
}

function phonesMatch(a, b) {
    const da = normalizePhoneDigits(a);
    const db = normalizePhoneDigits(b);
    if (!da || !db) return false;
    return da === db || da.endsWith(db) || db.endsWith(da);
}

module.exports = { normalizePhoneDigits, phonesMatch };
