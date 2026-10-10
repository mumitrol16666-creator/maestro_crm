const MAX_MONEY_AMOUNT = 2147483647; // PostgreSQL Int

function parseMoney(value, { fieldName = 'Сумма', min = 0 } = {}) {
    const validType = typeof value === 'number'
        || (typeof value === 'string' && /^-?\d+$/.test(value.trim()));
    const amount = validType ? Number(value) : NaN;
    if (!Number.isSafeInteger(amount) || amount < min || amount > MAX_MONEY_AMOUNT) {
        const error = new Error(`${fieldName}: укажите целое число от ${min} до ${MAX_MONEY_AMOUNT}`);
        error.code = 'INVALID_MONEY_AMOUNT';
        error.statusCode = 400;
        throw error;
    }
    return amount;
}

function parsePositiveMoney(value, fieldName = 'Сумма') {
    return parseMoney(value, { fieldName, min: 1 });
}

function calculatePaymentAdjustment(previousAmount, nextAmount) {
    return parsePositiveMoney(nextAmount) - parsePositiveMoney(previousAmount);
}

function assertPaymentCanBeEdited(payment, nextAmount, refundedAmount = 0) {
    if (!payment) {
        const error = new Error('Платёж не найден');
        error.code = 'PAYMENT_NOT_FOUND';
        throw error;
    }
    if (payment.status !== 'completed' || payment.cancelledAt) {
        const error = new Error('Можно изменять только обычные проведённые платежи');
        error.code = 'PAYMENT_NOT_EDITABLE';
        throw error;
    }
    const normalizedAmount = parsePositiveMoney(nextAmount);
    if (normalizedAmount < refundedAmount) {
        const error = new Error(`Сумма не может быть меньше уже возвращённых ${refundedAmount} ₸`);
        error.code = 'PAYMENT_BELOW_REFUNDS';
        throw error;
    }
    return normalizedAmount;
}

function assertRefundAllowed({
    studentBalance,
    refundAmount,
    originalPaymentAmount = null,
    alreadyRefunded = 0,
}) {
    const amount = parsePositiveMoney(refundAmount, 'Сумма возврата');
    const availableBalance = Math.max(0, Number(studentBalance) || 0);
    if (amount > availableBalance) {
        const error = new Error(`На балансе доступно для возврата только ${availableBalance} ₸`);
        error.code = 'REFUND_EXCEEDS_BALANCE';
        throw error;
    }
    if (
        originalPaymentAmount !== null
        && alreadyRefunded + amount > originalPaymentAmount
    ) {
        const available = Math.max(0, originalPaymentAmount - alreadyRefunded);
        const error = new Error(`По этому платежу можно вернуть не больше ${available} ₸`);
        error.code = 'REFUND_EXCEEDS_PAYMENT';
        throw error;
    }
    return amount;
}

module.exports = {
    MAX_MONEY_AMOUNT,
    parseMoney,
    parsePositiveMoney,
    calculatePaymentAdjustment,
    assertPaymentCanBeEdited,
    assertRefundAllowed,
};
