const { prisma } = require('../config/db');

// =====================================================
// Маппинг первой части URL -> каноничное имя сущности.
// =====================================================
const ENTITY_MAP = {
    bookings: 'Booking',
    students: 'Student',
    users: 'User',
    groups: 'Group',
    payments: 'Payment',
    memberships: 'Membership',
    families: 'Family',
    directions: 'Direction',
    'activity-logs': 'ActivityLog',
    admin: 'Admin',
    auth: 'Auth',
    analytics: 'Analytics',
    attendance: 'Attendance',
    schedule: 'Schedule',
    rentals: 'Rental',
    freezes: 'Freeze',
    rooms: 'Room',
};

// Prisma model, в котором делать findUnique для получения snapshot до мутации.
// users (teachers/admins/sales) — это Student в этой базе.
const PRISMA_MODEL_MAP = {
    Booking: 'booking',
    Student: 'student',
    User: 'student',
    Group: 'group',
    Payment: 'payment',
    Membership: 'membership',
    Family: 'family',
    Direction: 'direction',
    Freeze: 'freeze',
    Room: 'room',
};

// Понятные подписи для действий и под-экшенов
const ACTION_LABELS = {
    create: 'Создание',
    update: 'Изменение',
    delete: 'Удаление',
    freeze: 'Заморозка',
    unfreeze: 'Разморозка',
    status: 'Смена статуса',
    convert: 'Конвертация',
    restore: 'Восстановление',
    price: 'Изменение цены',
    promise: 'Обещанный платёж',
    'promise-date': 'Обещанный платёж',
    payment: 'Добавление платежа',
    payments: 'Добавление платежа',
    renew: 'Продление',
    extend: 'Продление',
    comment: 'Комментарий',
    members: 'Состав',
    attendance: 'Посещаемость',
    'mark-present': 'Отметка присутствия',
    'mark-absent': 'Отметка отсутствия',
    'add-to-group': 'Добавление в группу',
    'remove-from-group': 'Удаление из группы',
    'reset-password': 'Сброс пароля',
    'add-member': 'Добавление в семью',
    'remove-member': 'Удаление из семьи',
};

// Подписи полей по-русски
const FIELD_LABELS = {
    name: 'Имя',
    lastName: 'Фамилия',
    phone: 'Телефон',
    email: 'Email',
    status: 'Статус',
    role: 'Роль',
    title: 'Название',
    direction: 'Направление',
    type: 'Тип',
    groupId: 'Группа',
    teacherId: 'Преподаватель',
    studentId: 'Ученик',
    startDate: 'Начало',
    endDate: 'Окончание',
    amount: 'Сумма',
    paidAmount: 'Оплачено',
    remainingAmount: 'Остаток',
    totalPrice: 'Цена',
    basePrice: 'Базовая цена',
    paymentMethod: 'Способ оплаты',
    paymentType: 'Тип платежа',
    paymentDate: 'Дата платежа',
    promisedPaymentDate: 'Обещанный платёж',
    comment: 'Комментарий',
    note: 'Заметка',
    concessionType: 'Льгота',
    familyId: 'Семья',
    referredByStudentId: 'Реферер',
    birthDate: 'Дата рождения',
    address: 'Адрес',
    freezeStart: 'Заморозка с',
    freezeEnd: 'Заморозка до',
    isFrozen: 'Заморожен',
    password: 'Пароль',
    bookingStatus: 'Статус заявки',
    activeMembershipId: 'Текущий абонемент',
};

function formatValue(v) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'да' : 'нет';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'object') {
        try {
            const s = JSON.stringify(v);
            return s.length > 80 ? s.substring(0, 80) + '…' : s;
        } catch {
            return '[object]';
        }
    }
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
    return s.length > 80 ? s.substring(0, 80) + '…' : s;
}

function looksLikeId(s) {
    if (!s || typeof s !== 'string') return false;
    return /^[a-f0-9]{24}$/i.test(s)
        || /^c[a-z0-9]{20,30}$/i.test(s)
        || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// Нормализуем значение для сравнения (даты -> ISO, Decimal/Number -> Number, строки -> trim)
function normalizeForCompare(v) {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object' && v !== null && typeof v.toISOString === 'function') {
        return v.toISOString();
    }
    if (typeof v === 'object' && v !== null && typeof v.toNumber === 'function') {
        return v.toNumber();
    }
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v;
    const s = String(v);
    // Возможная дата-строка
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
        const d = new Date(s);
        return isNaN(d) ? s : d.toISOString();
    }
    return s;
}

function valuesEqual(a, b) {
    const na = normalizeForCompare(a);
    const nb = normalizeForCompare(b);
    if (na === nb) return true;
    // Сравнение чисел с разным типом (число vs строка из цифр)
    if ((typeof na === 'number' || typeof nb === 'number') && !isNaN(Number(na)) && !isNaN(Number(nb))) {
        return Number(na) === Number(nb);
    }
    return false;
}

// Извлечь entityId и sub-action из URL-частей
function extractRoutingInfo(parts) {
    let entityId = null;
    let subAction = null;
    for (let i = 1; i < parts.length; i++) {
        const p = parts[i];
        if (looksLikeId(p) || /^\d{1,12}$/.test(p)) {
            entityId = p;
            if (i + 1 < parts.length) {
                const next = parts[parts.length - 1];
                if (!looksLikeId(next) && !/^\d+$/.test(next)) subAction = next;
            }
            break;
        }
    }
    // Если ID не нашли, но путь вида /users/teachers/:id — try again на любое не-id слово после entity
    if (!entityId && parts.length >= 3) {
        const last = parts[parts.length - 1];
        if (looksLikeId(last) || /^\d{1,12}$/.test(last)) {
            entityId = last;
            const prev = parts[parts.length - 2];
            if (!looksLikeId(prev)) subAction = null; // prev это sub-ресурс, не экшен
        }
    }
    return { entityId, subAction };
}

const IGNORED_SUBSTRINGS = [
    '/batch-light', '/search', '/login', '/logout',
    '/check', '/stats', '/preview', '/price-preview',
    '/whatsapp-reminders/sent',
];

const activityLogger = async (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    if (IGNORED_SUBSTRINGS.some(p => req.originalUrl.includes(p))) return next();

    // Разбор URL
    const rawParts = req.originalUrl.split('?')[0].split('/').filter(Boolean);
    if (rawParts[0] === 'api') rawParts.shift();
    if (rawParts.length === 0) return next();

    const urlEntity = rawParts[0];
    const entityType = ENTITY_MAP[urlEntity] || urlEntity;
    const { entityId, subAction } = extractRoutingInfo(rawParts);

    // Snapshot "до" для PUT/PATCH/DELETE
    let beforeSnapshot = null;
    if (['PUT', 'PATCH', 'DELETE'].includes(req.method) && entityId) {
        const modelName = PRISMA_MODEL_MAP[entityType];
        if (modelName && prisma[modelName] && typeof prisma[modelName].findUnique === 'function') {
            try {
                beforeSnapshot = await prisma[modelName].findUnique({ where: { id: entityId } });
            } catch (e) {
                // модель не поддерживает findUnique по id или id не uuid/cuid — молча пропускаем
                beforeSnapshot = null;
            }
        }
    }
    res.locals.beforeSnapshot = beforeSnapshot;

    // Перехватываем json-ответ
    const originalJson = res.json;
    res.json = function (body) {
        res.locals.body = body;
        return originalJson.call(this, body);
    };

    res.on('finish', async () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return;
        try {
            const userId = req.user?.id;
            if (!userId) return;

            const methodMap = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' };
            const baseAction = methodMap[req.method];
            const actionName = subAction || baseAction;

            const bodyData = res.locals.body || {};
            const reqBody = req.body || {};
            const before = res.locals.beforeSnapshot || null;

            // Источник «после» — объект из ответа или то, что пришло в запросе
            const afterSource = bodyData.student
                || bodyData.user
                || bodyData.group
                || bodyData.payment
                || bodyData.booking
                || bodyData.membership
                || bodyData.family
                || bodyData.direction
                || bodyData.data
                || reqBody;

            // Metadata для потенциального full-diff'а в будущем
            const metadata = {
                path: req.originalUrl,
                method: req.method,
                query: req.query,
                body: { ...reqBody },
            };
            if (metadata.body && metadata.body.password) metadata.body.password = '***';
            if (before) {
                const beforeCopy = { ...before };
                if (beforeCopy.password) beforeCopy.password = '***';
                metadata.before = beforeCopy;
            }

            // Опознавание объекта (ФИО / телефон / название) — берём из before или after
            const idSource = before || afterSource || {};
            const identityParts = [];
            const fullName = [idSource.lastName, idSource.name].filter(Boolean).join(' ').trim();
            if (fullName) identityParts.push(fullName);
            if (idSource.phone) identityParts.push(idSource.phone);
            if (!fullName && idSource.title) identityParts.push(idSource.title);
            if (!fullName && idSource.direction) identityParts.push(idSource.direction);
            const identity = identityParts.join(' · ');

            const actionLabel = ACTION_LABELS[actionName] || ACTION_LABELS[baseAction] || actionName;

            let readableDetails;

            if (baseAction === 'create') {
                // Для создания — главные поля созданного объекта
                const parts = [];
                if (fullName) parts.push(fullName);
                if (idSource.phone) parts.push(`тел.: ${idSource.phone}`);
                if (idSource.role) parts.push(`роль: ${formatValue(idSource.role)}`);
                if (idSource.type && !fullName) parts.push(`тип: ${formatValue(idSource.type)}`);
                if (idSource.status) parts.push(`статус: ${formatValue(idSource.status)}`);
                if (idSource.amount !== undefined) parts.push(`сумма: ${formatValue(idSource.amount)}`);
                readableDetails = `${actionLabel}${parts.length ? ' — ' + parts.join(', ') : ''}`;
            } else if (baseAction === 'delete') {
                readableDetails = `${actionLabel}${identity ? ' — ' + identity : (entityId ? ' ID: ' + entityId : '')}`;
            } else {
                // update / под-экшен — собираем честный diff
                const changes = [];
                if (reqBody && typeof reqBody === 'object' && !Array.isArray(reqBody)) {
                    for (const [k, newVal] of Object.entries(reqBody)) {
                        if (newVal === undefined) continue;
                        if (k === 'id' || k === '_id') continue;
                        const label = FIELD_LABELS[k] || k;
                        if (k === 'password') {
                            changes.push(`${label}: изменён`);
                            continue;
                        }
                        if (before && Object.prototype.hasOwnProperty.call(before, k)) {
                            const oldVal = before[k];
                            if (valuesEqual(oldVal, newVal)) continue; // не поменялось — пропустим
                            changes.push(`${label}: ${formatValue(oldVal)} → ${formatValue(newVal)}`);
                        } else {
                            // snapshot недоступен — покажем только новое
                            changes.push(`${label}: ${formatValue(newVal)}`);
                        }
                    }
                }

                const head = identity ? `${actionLabel} — ${identity}` : actionLabel;
                if (changes.length) {
                    readableDetails = `${head} · ${changes.slice(0, 10).join('; ')}`;
                } else {
                    readableDetails = `${head}${before ? ' · без изменений' : ''}`;
                }
            }

            await prisma.activityLog.create({
                data: {
                    userId,
                    action: actionName,
                    entityType,
                    entityId,
                    details: readableDetails.substring(0, 1000),
                    metadata,
                },
            });

            const io = req.app.get('io');
            if (io) {
                io.emit('activity_logged', { action: actionName, entityType, entityId, userId });
            }
        } catch (err) {
            console.error('Error logging activity:', err);
        }
    });

    next();
};

module.exports = { activityLogger, ENTITY_MAP };
