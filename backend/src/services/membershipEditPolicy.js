const EDITABLE_MEMBERSHIP_FIELDS = new Set([
    'startDate',
    'endDate',
    'freezesAvailable',
    'emergencyFreezesAvailable',
    'totalPrice',
]);

function sameCalendarDate(left, right) {
    if (!left || !right) return false;
    return new Date(left).toISOString().slice(0, 10) === new Date(right).toISOString().slice(0, 10);
}

function parseDate(value, label) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw Object.assign(new Error(`${label} указана некорректно`), { code: 'INVALID_MEMBERSHIP_DATE' });
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        throw Object.assign(new Error(`${label} указана некорректно`), { code: 'INVALID_MEMBERSHIP_DATE' });
    }
    return parsed;
}

function parseInteger(value, label, { max = null } = {}) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || (max !== null && parsed > max)) {
        const range = max === null ? 'неотрицательным целым числом' : `целым числом от 0 до ${max}`;
        throw Object.assign(new Error(`${label} должно быть ${range}`), { code: 'INVALID_MEMBERSHIP_VALUE' });
    }
    return parsed;
}

function buildManualPriceSnapshot(membership, totalPrice) {
    let basePrice = Number(membership.basePrice) || Number(membership.totalPrice) || totalPrice;
    if (totalPrice > basePrice) basePrice = totalPrice;

    const discountPercent = basePrice > 0 && totalPrice < basePrice
        ? Math.max(0, Math.min(100, Math.round(((basePrice - totalPrice) / basePrice) * 100)))
        : 0;

    return {
        totalPrice,
        basePrice,
        discountPercent,
        discountReferralPercent: 0,
        discountFamilyPercent: 0,
        discountConcessionPercent: 0,
        discountManualPercent: discountPercent,
    };
}

function buildMembershipEdit(membership, input = {}) {
    if (!membership) {
        throw Object.assign(new Error('Абонемент не найден'), { code: 'MEMBERSHIP_NOT_FOUND' });
    }

    const requestedFields = Object.keys(input).filter(key => input[key] !== undefined);
    const unsupportedField = requestedFields.find(key => !EDITABLE_MEMBERSHIP_FIELDS.has(key));
    if (unsupportedField) {
        throw Object.assign(new Error(`Поле ${unsupportedField} нельзя изменить в этой форме`), {
            code: 'UNSUPPORTED_MEMBERSHIP_FIELD',
        });
    }

    const updateData = {};
    const changes = [];

    if (input.startDate !== undefined) {
        const startDate = parseDate(input.startDate, 'Дата активации');
        if (!sameCalendarDate(startDate, membership.startDate)) {
            updateData.startDate = startDate;
            changes.push(`дата активации ${new Date(membership.startDate).toLocaleDateString('ru-RU')} → ${startDate.toLocaleDateString('ru-RU')}`);
        }
    }

    if (input.endDate !== undefined) {
        const endDate = parseDate(input.endDate, 'Дата окончания');
        if (!sameCalendarDate(endDate, membership.endDate)) {
            updateData.endDate = endDate;
            changes.push(`дата окончания ${new Date(membership.endDate).toLocaleDateString('ru-RU')} → ${endDate.toLocaleDateString('ru-RU')}`);
        }
    }

    const effectiveStartDate = updateData.startDate || membership.startDate;
    const effectiveEndDate = updateData.endDate || membership.endDate;
    if (new Date(effectiveEndDate) < new Date(effectiveStartDate)) {
        throw Object.assign(new Error('Дата окончания не может быть раньше даты активации'), {
            code: 'INVALID_MEMBERSHIP_PERIOD',
        });
    }

    if (input.freezesAvailable !== undefined) {
        const freezesAvailable = parseInteger(input.freezesAvailable, 'Количество обычных заморозок', { max: 24 });
        if (freezesAvailable !== Number(membership.freezesAvailable || 0)) {
            updateData.freezesAvailable = freezesAvailable;
            changes.push(`обычные заморозки ${Number(membership.freezesAvailable || 0)} → ${freezesAvailable}`);
        }
    }

    if (input.emergencyFreezesAvailable !== undefined) {
        const emergencyFreezesAvailable = parseInteger(input.emergencyFreezesAvailable, 'Количество экстренных заморозок', { max: 24 });
        if (emergencyFreezesAvailable !== Number(membership.emergencyFreezesAvailable || 0)) {
            updateData.emergencyFreezesAvailable = emergencyFreezesAvailable;
            changes.push(`экстренные заморозки ${Number(membership.emergencyFreezesAvailable || 0)} → ${emergencyFreezesAvailable}`);
        }
    }

    if (input.totalPrice !== undefined) {
        const totalPrice = parseInteger(input.totalPrice, 'Стоимость абонемента');
        if (totalPrice !== Number(membership.totalPrice || 0)) {
            Object.assign(updateData, buildManualPriceSnapshot(membership, totalPrice));
            changes.push(`стоимость ${Number(membership.totalPrice || 0)} → ${totalPrice}`);
        }
    }

    return {
        updateData,
        changes,
        changed: changes.length > 0,
    };
}

module.exports = {
    buildMembershipEdit,
    buildManualPriceSnapshot,
};
