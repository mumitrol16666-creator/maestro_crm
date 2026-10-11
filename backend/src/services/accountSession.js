const { prisma } = require('../config/db');

async function getLinkedAccountSession(crmUserId, appUserId) {
    const user = await prisma.student.findUnique({ where: { id: crmUserId }, select: {
        id: true, role: true, status: true, appUserId: true, externalLinkStatus: true, sessionVersion: true,
    } });
    if (!user || user.status !== 'active' || !appUserId || user.appUserId !== appUserId
        || user.externalLinkStatus !== 'linked') return null;
    return { crmUserId: user.id, appUserId: user.appUserId, role: user.role, sessionVersion: user.sessionVersion };
}

module.exports = { getLinkedAccountSession };
