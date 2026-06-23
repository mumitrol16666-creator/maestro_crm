function parsePositiveMoney(value, fieldName = 'Сумма') {
    const amount = Number.parseInt(value, 10);
    if (!Number.isInteger(amount) || amount <= 0) {
        const error = new Error(`${fieldName} должна быть положительным целым числом`);
        error.code = 'INVALID_MONEY_AMOUNT';
        throw error;
    }
    return amount;
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
    if (payment.status !== 'completed') {
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
    parsePositiveMoney,
    calculatePaymentAdjustment,
    assertPaymentCanBeEdited,
    assertRefundAllowed,
};
