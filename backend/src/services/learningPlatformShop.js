const { executeOutboundIntegration } = require('./integrationJournal');

function learningPlatformBaseUrl() {
    return (process.env.LEARNING_PLATFORM_API_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
}

async function shopCoinRequest(operation, path, payload, orderId = null) {
    const response = await executeOutboundIntegration({
        operation: `shop.coins.${operation}`,
        url: `${learningPlatformBaseUrl()}/api/integration/v1/shop/coins/${path}`,
        method: 'POST',
        payload,
        entityType: orderId ? 'ShopOrder' : 'Student',
        entityId: orderId || payload.crmStudentId,
    });
    return response?.data || response;
}

function getStudentCoinBalance(crmStudentId) {
    return shopCoinRequest('balance', 'balance', { crmStudentId });
}

function debitStudentCoins({ crmStudentId, orderId, orderNumber, amount }) {
    return shopCoinRequest('debit', 'debit', {
        crmStudentId,
        orderId,
        orderNumber,
        amount,
    }, orderId);
}

function refundStudentCoins({ crmStudentId, orderId, orderNumber, amount, reason }) {
    return shopCoinRequest('refund', 'refund', {
        crmStudentId,
        orderId,
        orderNumber,
        amount,
        reason: reason || null,
    }, orderId);
}

module.exports = {
    debitStudentCoins,
    getStudentCoinBalance,
    refundStudentCoins,
};
