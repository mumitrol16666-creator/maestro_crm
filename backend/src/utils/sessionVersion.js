const jwt = require('jsonwebtoken');

function sessionVersionMatches(claim, current) {
    // Sessions issued before this migration belong to revision zero only.
    const version = claim === undefined ? 0 : claim;
    return Number.isSafeInteger(version) && version >= 0
        && Number.isSafeInteger(current) && version === current;
}

function signSession(user) {
    if (!Number.isSafeInteger(user.sessionVersion) || user.sessionVersion < 0) {
        throw new Error('Invalid account session version');
    }
    return jwt.sign({ userId: user.id, role: user.role, sessionVersion: user.sessionVersion },
        process.env.JWT_SECRET, { expiresIn: '7d' });
}

module.exports = { sessionVersionMatches, signSession };
