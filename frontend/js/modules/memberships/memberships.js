// =====================================================
// MEMBERSHIPS MODULE - Управление абонементами
// =====================================================

let currentMembershipStudentId = null;
let currentMembershipStudent = null;
let allGroupsData = []; // Кэш групп с ценами направлений
let allMembershipDirections = [];
let allMembershipTeachers = [];
let lastMembershipPricingPreview = null;
let currentMembershipRenewalId = null;
let currentMembershipRenewalEndDate = null;
let membershipPricePreviewRequestId = 0;
let lastMembershipPricingSelection = null;
let activeMembershipEditInitialState = null;

function fmtMoney(n) {
    return new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0));
}

function membershipAdditionalDiscountLimits() {
    const directionId = document.getElementById('membershipDirectionId')?.value;
    const pricing = allMembershipDirections.find(item => item._id === directionId)?.pricing;
    if (!pricing) return null;
    const lessonFormat = document.getElementById('membershipLessonFormat')?.value || 'program';
    if (lessonFormat === 'individual') {
        const months = Number(document.getElementById('membershipProgramMonths')?.value || 1);
        const basePrice = months === 3 ? 90000 : (months === 2 ? 62000 : 32000);
        return { individual: basePrice, total: basePrice };
    }
    const months = document.getElementById('membershipProgramMonths')?.value === '2' ? 2 : 1;
    const individual = (Number(pricing.individual) - (months === 2 ? 500 : 0)) * months * 4;
    const total = individual + Number(pricing.theory) * months * 2 + Number(pricing.group) * months * 4;
    return Number.isFinite(individual) && individual >= 0 && total > 0 ? { individual, total } : null;
}

function readMembershipAdditionalDiscount() {
    const none = { additionalDiscountType: 'none', additionalDiscountValue: 0, additionalDiscountReason: '' };
    if (!['program', 'individual'].includes(document.getElementById('membershipLessonFormat')?.value)) return { values: none };
    const type = document.getElementById('membershipAdditionalDiscountType')?.value || 'none';
    if (type === 'none') return { values: none };
    if (!['percent', 'amount'].includes(type)) return { error: 'Выберите вид дополнительной скидки' };
    const rawValue = document.getElementById('membershipAdditionalDiscountValue')?.value?.trim() || '';
    const value = Number(rawValue);
    const reason = document.getElementById('membershipAdditionalDiscountReason')?.value?.trim() || '';
    const validNumber = type === 'percent' ? /^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(rawValue) : /^\d+$/.test(rawValue);
    if (!validNumber || !Number.isFinite(value) || value < 0 || (type === 'amount' && !Number.isSafeInteger(value))) {
        return { error: type === 'percent' ? 'Укажите процент с точностью не более двух знаков после запятой' : 'Укажите скидку целым числом тенге' };
    }
    if (type === 'percent' && value > 100) return { error: 'Процент скидки должен быть от 0 до 100' };
    const limits = membershipAdditionalDiscountLimits();
    const amount = type === 'percent' && limits ? Math.round(limits.total * value / 100) : value;
    if (limits && amount > limits.individual) return { error: `Скидка не может превышать стоимость индивидуальных уроков — ${fmtMoney(limits.individual)} ₸` };
    if (value > 0 && !reason) return { error: 'Укажите причину дополнительной скидки' };
    if (reason.length > 500) return { error: 'Причина скидки должна быть не длиннее 500 символов' };
    return { values: { additionalDiscountType: type, additionalDiscountValue: value, additionalDiscountReason: reason } };
}

function showMembershipDiscountError(message = '') {
    const error = document.getElementById('membershipAdditionalDiscountError');
    if (!error) return;
    error.textContent = message;
    error.style.display = message ? 'block' : 'none';
}

function resetMembershipAdditionalDiscount() {
    const type = document.getElementById('membershipAdditionalDiscountType');
    const value = document.getElementById('membershipAdditionalDiscountValue');
    const reason = document.getElementById('membershipAdditionalDiscountReason');
    if (type) type.value = 'none';
    if (value) value.value = '0';
    if (reason) reason.value = '';
    showMembershipDiscountError();
    updateMembershipAdditionalDiscountControls();
}

function updateMembershipAdditionalDiscountControls() {
    const isAllowed = ['program', 'individual'].includes(document.getElementById('membershipLessonFormat')?.value);
    const isProgram = isAllowed;
    const type = document.getElementById('membershipAdditionalDiscountType')?.value || 'none';
    const enabled = isProgram && type !== 'none';
    const container = document.getElementById('membershipAdditionalDiscountContainer');
    const fields = document.getElementById('membershipAdditionalDiscountFields');
    const summary = document.getElementById('membershipAdditionalDiscountSummary');
    const value = document.getElementById('membershipAdditionalDiscountValue');
    const reason = document.getElementById('membershipAdditionalDiscountReason');
    const label = document.getElementById('membershipAdditionalDiscountValueLabel');
    const limit = document.getElementById('membershipAdditionalDiscountLimit');
    const limits = membershipAdditionalDiscountLimits();
    if (container) container.style.display = isProgram ? 'block' : 'none';
    if (summary) summary.style.display = isProgram ? 'block' : 'none';
    if (fields) fields.style.display = enabled ? 'block' : 'none';
    if (value) {
        value.disabled = !enabled;
        value.required = enabled;
        value.step = type === 'percent' ? '0.01' : '1';
        value.max = type === 'percent' ? '100' : limits ? String(limits.individual) : '';
    }
    if (reason) {
        reason.disabled = !enabled;
        reason.required = enabled && Number(value?.value) > 0;
    }
    if (label) label.textContent = type === 'percent' ? 'СКИДКА ОТ СТОИМОСТИ ОБУЧЕНИЯ (%)' : 'СКИДКА (₸)';
    if (limit) limit.textContent = limits ? `Максимальная сумма скидки — ${fmtMoney(limits.individual)} ₸.` : '';
}

function membershipPricingSelection(discountValues) {
    return JSON.stringify({
        directionId: document.getElementById('membershipDirectionId')?.value || '',
        lessonFormat: document.getElementById('membershipLessonFormat')?.value || '',
        programMonths: document.getElementById('membershipProgramMonths')?.value || '1',
        ...discountValues,
    });
}

function membershipIndividualAllocationLabel(total, count) {
    if (!Number.isInteger(total) || !Number.isInteger(count) || count <= 0) return '';
    const floor = Math.floor(total / count);
    const remainder = total % count;
    return remainder
        ? `${count - remainder} × ${fmtMoney(floor)} ₸ + ${remainder} × ${fmtMoney(floor + 1)} ₸`
        : `${count} × ${fmtMoney(floor)} ₸`;
}

function buildDiscountSummary(data) {
    if (Number(data?.additionalDiscountAmount) > 0) {
        const percent = data.additionalDiscountType === 'percent' && Number(data.additionalDiscountBasisPoints) > 0
            ? ` (${Number(data.additionalDiscountBasisPoints) / 100}%)` : '';
        return `доп. скидка ${fmtMoney(data.additionalDiscountAmount)} ₸${percent} на индивидуальные уроки`;
    }
    if (!data || !data.discountPercent || data.discountPercent <= 0) return '';
    const parts = [];
    if (data.discountReferralPercent > 0)   parts.push('реферал');
    if (data.discountFamilyPercent > 0)     parts.push('семья');
    if (data.discountConcessionPercent > 0) parts.push('льгота');
    if (data.discountManualPercent > 0)     parts.push('доп. скидка');
    const tail = parts.length ? ` (${parts.join(' + ')})` : '';
    return `скидка ${data.discountPercent}%${tail}`;
}

function membershipPersonName(person, fallback = '') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function formatLocalISO(date) {
    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - (offset * 60 * 1000));
    return localDate.toISOString().split('T')[0];
}

function parseLocalDate(value) {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function setMembershipSubmitMode(isRenewal) {
    const button = document.getElementById('membershipSubmitButton');
    if (!button) return;
    button.dataset.readyText = isRenewal ? 'ПРОДЛИТЬ АБОНЕМЕНТ' : 'СОЗДАТЬ АБОНЕМЕНТ';
    button.dataset.loadingText = isRenewal ? 'ПРОДЛЕВАЕМ...' : 'СОЗДАЁМ...';
    button.textContent = button.dataset.readyText;
}

function updateMembershipSubmitState() {
    const button = document.getElementById('membershipSubmitButton');
    if (!button || button.dataset.submitting === '1') return;
    const directionId = document.getElementById('membershipDirectionId')?.value || '';
    const startDate = document.getElementById('membershipStartDate')?.value || '';
    const endDate = document.getElementById('membershipEndDate')?.value || '';
    button.disabled = !(directionId && startDate && endDate && lastMembershipPricingPreview);
    button.textContent = button.dataset.readyText || (currentMembershipRenewalId ? 'ПРОДЛИТЬ АБОНЕМЕНТ' : 'СОЗДАТЬ АБОНЕМЕНТ');
}

function setMembershipEndDateDays(daysCount) {
    const startDateInput = document.getElementById("membershipStartDate");
    const endDateInput = document.getElementById("membershipEndDate");
    if (!startDateInput || !endDateInput) return;
    const start = parseLocalDate(startDateInput.value) || new Date();
    const end = new Date(start.getTime());
    end.setDate(end.getDate() + daysCount);
    endDateInput.value = formatLocalISO(end);
    endDateInput.dataset.manual = "1";
    updateMembershipSubmitState();
}

function updateMembershipEndDate(forceRecalculate = false) {
    const startDateInput = document.getElementById('membershipStartDate');
    const endDateInput = document.getElementById('membershipEndDate');
    const validityInput = document.getElementById('membershipValidityDays');
    if (!startDateInput || !endDateInput || !validityInput) return;

    if (!forceRecalculate && endDateInput.dataset.manual === '1' && endDateInput.value) {
        updateMembershipSubmitState();
        return;
    }

    const startDateVal = startDateInput.value;
    const start = parseLocalDate(startDateVal);
    if (!start) {
        endDateInput.value = '';
        updateMembershipSubmitState();
        return;
    }

    const daysCount = parseInt(validityInput.value, 10) || 0;
    if (daysCount <= 0) {
        endDateInput.value = '';
        updateMembershipSubmitState();
        return;
    }

    let calculationBase = start;
    if (currentMembershipRenewalId && currentMembershipRenewalEndDate) {
        const currentEnd = new Date(currentMembershipRenewalEndDate);
        if (!Number.isNaN(currentEnd.getTime()) && currentEnd > calculationBase) {
            calculationBase = currentEnd;
        }
    }
    const end = new Date(calculationBase.getTime());
    end.setDate(end.getDate() + daysCount);
    
    endDateInput.value = formatLocalISO(end);
    delete endDateInput.dataset.manual;
    updateMembershipSubmitState();
}

// Рассчитать стоимость по единой формуле и обновить UI.
async function updateMembershipPricePreview() {
    const requestId = ++membershipPricePreviewRequestId;
    const directionId = document.getElementById('membershipDirectionId')?.value;
    const lessonFormat = document.getElementById('membershipLessonFormat')?.value;
    const programMonths = document.getElementById('membershipProgramMonths')?.value || '1';
    const priceInput = document.getElementById('membershipTotalPrice');
    const hintTextEl = document.getElementById('membershipPriceHintText');

    lastMembershipPricingPreview = null;
    lastMembershipPricingSelection = null;
    if (priceInput) priceInput.value = '';
    if (hintTextEl) hintTextEl.textContent = '';
    for (const id of ['membershipPriceBeforeAdditionalDiscount', 'membershipAdditionalDiscountAmount']) {
        const element = document.getElementById(id);
        if (element) element.textContent = '—';
    }
    updateMembershipAdditionalDiscountControls();
    showMembershipDiscountError();
    updateMembershipSubmitState();
    if (!directionId || !lessonFormat || !priceInput) return;
    const discount = readMembershipAdditionalDiscount();
    if (discount.error) {
        showMembershipDiscountError(discount.error);
        return;
    }
    const selection = membershipPricingSelection(discount.values);

    const params = new URLSearchParams();
    params.set('directionId', directionId);
    params.set('lessonFormat', lessonFormat);
    if (['program', 'individual'].includes(lessonFormat)) params.set('programMonths', programMonths);
    Object.entries(discount.values).forEach(([key, value]) => params.set(key, String(value)));
    if (hintTextEl) hintTextEl.textContent = 'Рассчитываем стоимость…';

    try {
        const resp = await fetch(`${API_URL}/memberships/price-preview?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        const data = await resp.json();
        if (requestId !== membershipPricePreviewRequestId) return;
        if (!resp.ok || !data.success) {
            if (hintTextEl) hintTextEl.textContent = data.error || 'Не удалось рассчитать цену';
            if (discount.values.additionalDiscountType !== 'none') showMembershipDiscountError(data.error || 'Не удалось применить скидку');
            return;
        }
        lastMembershipPricingPreview = data;
        lastMembershipPricingSelection = selection;
        priceInput.value = data.totalPrice;
        updateMembershipSubmitState();
        document.getElementById('membershipLessonCount').value = data.lessonCount;
        document.getElementById('membershipValidityDays').value = data.validityDays;
        const basePrice = document.getElementById('membershipPriceBeforeAdditionalDiscount');
        const discountAmount = document.getElementById('membershipAdditionalDiscountAmount');
        if (basePrice) basePrice.textContent = `${fmtMoney(data.baseProgramPrice ?? data.basePrice)} ₸`;
        if (discountAmount) discountAmount.textContent = `${data.additionalDiscountAmount > 0 ? '−' : ''}${fmtMoney(data.additionalDiscountAmount)} ₸`;
        if (hintTextEl) {
            const individualAllocation = data.individualAllocation;
            const allocationLabel = membershipIndividualAllocationLabel(
                Number(individualAllocation?.totalAmount ?? data.componentTotals?.individual),
                Number(individualAllocation?.lessonCount ?? data.lessonCounts?.individual),
            );
            if (lessonFormat === 'trial') {
                hintTextEl.innerHTML = `<span>Пробный урок = <b>${fmtMoney(data.totalPrice)} ₸</b></span>`;
            } else if (lessonFormat === 'individual') {
                hintTextEl.innerHTML = `<span>Индивидуально (${data.lessonCount} зан.): <b>${fmtMoney(data.totalPrice)} ₸</b>${allocationLabel ? ` (${allocationLabel})` : ''}${data.programSavings > 0 ? `<br>В тариф уже включена скидка ${fmtMoney(data.programSavings)} ₸ за ${programMonths} мес.` : ''}</span>`;
            } else {
                hintTextEl.innerHTML = `<span>Индивидуальные: <b>${fmtMoney(data.componentTotals.individual)} ₸</b>${allocationLabel ? ` (${allocationLabel})` : ''}<br>Теория: ${fmtMoney(data.componentTotals.theory)} ₸ · Квартет: ${fmtMoney(data.componentTotals.group)} ₸${data.programSavings > 0 ? `<br>В стоимость программы уже включена скидка ${fmtMoney(data.programSavings)} ₸ на индивидуальные уроки за 2 месяца.` : ''}</span>`;
            }
        }
    } catch (err) {
        if (requestId !== membershipPricePreviewRequestId) return;
        if (hintTextEl) hintTextEl.textContent = 'Не удалось рассчитать стоимость. Проверьте соединение и повторите.';
        console.error('Price preview error:', err);
    }
}
window.updateMembershipPricePreview = updateMembershipPricePreview;

// Открыть модальное окно создания абонемента
async function openMembershipModal(membershipId = null) {
    if (window.openRateCardModal) return window.openRateCardModal(currentViewingStudentId, membershipId);
    if (!currentViewingStudentId) {
        toast.warning('Ошибка: ученик не выбран');
        return;
    }
    membershipPricePreviewRequestId += 1;
    lastMembershipPricingPreview = null;
    lastMembershipPricingSelection = null;
    resetMembershipAdditionalDiscount();
    updateMembershipSubmitState();
    
    try {
        const token = getAuthToken();
        
        // ⚡ МОМЕНТАЛЬНО открываем модалку с загрузкой
        document.getElementById('membershipStudentInfo').innerHTML = '<p style="text-align: center; padding: 20px; opacity: 0.5;">Загрузка...</p>';
        document.getElementById('membershipModal').classList.add('show');
        
        // ⚡ ПАРАЛЛЕЛЬНО загружаем данные В ФОНЕ
        const [studentData, groupsData, directionsData, membershipsData] = await Promise.all([
            fetch(`${API_URL}/students/${currentViewingStudentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json()),
            fetch(`${API_URL}/groups`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json()),
            fetch(`${API_URL}/directions`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json()),
            fetch(`${API_URL}/memberships/student/${currentViewingStudentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json())
        ]);
        
        const student = studentData.student;
        const allGroups = groupsData.groups || [];
        const renewalMembership = membershipId
            ? (membershipsData.memberships || []).find(item => item._id === membershipId || item.id === membershipId)
            : null;
        if (membershipId && !renewalMembership) throw new Error('Выбранный абонемент не найден');
        currentMembershipRenewalId = renewalMembership?._id || renewalMembership?.id || null;
        currentMembershipRenewalEndDate = renewalMembership?.endDate || null;
        setMembershipSubmitMode(Boolean(renewalMembership));
        const modalTitle = document.getElementById('membershipModalTitle');
        if (modalTitle) modalTitle.textContent = renewalMembership ? 'ПРОДЛИТЬ ВЫБРАННЫЙ АБОНЕМЕНТ' : 'СОЗДАТЬ НОВЫЙ АБОНЕМЕНТ';
        
        // Проверить есть ли у ученика группы
        const activeGroups = student.groups?.filter(g => g.status === 'active') || [];
        
        currentMembershipStudentId = student._id;
        currentMembershipStudent = student;
        
        // Информация об ученике
        const genderText = student.gender === 'male' ? 'Мужчина' : student.gender === 'female' ? 'Женщина' : 'Не указан';
        const groupNames = activeGroups.map(g => g.groupId?.name || 'Группа').join(', ');
        
        document.getElementById('membershipStudentInfo').innerHTML = `
            <div style="font-size: 0.9em;">
                <strong>${membershipPersonName(student, 'Ученик')}</strong><br>
                Телефон: ${student.phone}<br>
                Пол: ${genderText}<br>
                <span style="color: #eb4d77;">Группы: ${groupNames}</span>
                ${renewalMembership ? `
                    <div class="membership-renewal-notice">
                        Продлеваем: <strong>${renewalMembership.lessonFormat === 'trial' ? 'Пробный урок' : (renewalMembership.lessonFormat === 'individual' ? 'Индивидуально' : 'Основная программа')}</strong>.
                        Следующий период начнётся после окончания текущего. Остатки занятий сохраняются по цене их покупки.
                    </div>
                ` : `
                    <div class="membership-create-notice">
                        Создаётся отдельный новый абонемент. Существующие абонементы останутся без изменений.
                    </div>
                `}
            </div>
        `;
        
        // Сохраняем группы глобально для доступа при изменении выбора
        allGroupsData = allGroups;
        allMembershipDirections = (directionsData.directions || []).filter(d => d.isActive !== false);

        const directionSelect = document.getElementById('membershipDirectionId');
        directionSelect.innerHTML = '<option value="">Выберите направление</option>';
        allMembershipDirections.forEach(direction => {
            const option = document.createElement('option');
            option.value = direction._id;
            option.textContent = direction.name;
            directionSelect.appendChild(option);
        });

        const renewalFormat = renewalMembership?.lessonFormat === 'trial'
            ? 'trial'
            : (renewalMembership?.lessonFormat === 'individual' ? 'individual' : 'program');
        document.getElementById('membershipLessonFormat').value = renewalFormat;
        const renewalMonths = Number(renewalMembership?.programMonths) || (renewalMembership?.individualLessonPrice === 3500 || renewalMembership?.type === 'hybrid_2m' ? 2 : 1);
        document.getElementById('membershipProgramMonths').value = String(renewalMonths);
        if (renewalFormat === 'trial') {
            document.getElementById('membershipLessonCount').value = 1;
            document.getElementById('membershipValidityDays').value = 7;
        } else if (renewalFormat === 'individual') {
            document.getElementById('membershipLessonCount').value = renewalMonths === 3 ? 24 : (renewalMonths === 2 ? 16 : 8);
            document.getElementById('membershipValidityDays').value = renewalMonths === 3 ? 180 : (renewalMonths === 2 ? 120 : 60);
        } else {
            document.getElementById('membershipLessonCount').value = renewalMonths * 10;
            document.getElementById('membershipValidityDays').value = renewalMonths * 60;
        }
        delete document.getElementById('membershipFreezesAvailable').dataset.lastFormat;
        const initialFreezeToggle = document.getElementById('membershipInitialFreezeEnabled');
        const initialFreezeFields = document.getElementById('membershipInitialFreezeFields');
        if (initialFreezeToggle) initialFreezeToggle.checked = false;
        if (initialFreezeFields) initialFreezeFields.style.display = 'none';
        ['membershipInitialFreezeStartDate', 'membershipInitialFreezeEndDate', 'membershipInitialFreezeReason']
            .forEach(id => { const field = document.getElementById(id); if (field) field.value = ''; });
        
        document.getElementById('membershipStudentId').value = student._id;
        const renewalGroupId = renewalMembership?.groupId?._id || renewalMembership?.groupId?.id || null;
        const currentGroupId = renewalGroupId || null;
        const currentGroup = allGroups.find(group => group._id === currentGroupId);
        const initialDirection = allMembershipDirections.find(direction =>
            direction._id === renewalMembership?.direction?.id
            || direction._id === renewalMembership?.plan?.direction?.id
            || direction.name === renewalMembership?.plan?.direction?.name
        ) || allMembershipDirections.find(direction => direction.name === currentGroup?.direction)
            || allMembershipDirections[0];
        directionSelect.value = initialDirection?._id || '';
        updateMembershipTypeOptionLabels(currentGroupId);
        ['membershipDirectionId', 'membershipLessonFormat', 'membershipGroupId'].forEach(id => {
            const field = document.getElementById(id);
            if (field) field.disabled = Boolean(renewalMembership);
        });

        const startDateInput = document.getElementById('membershipStartDate');
        const endDateInput = document.getElementById('membershipEndDate');
        if (endDateInput) { endDateInput.readOnly = false; delete endDateInput.dataset.manual; }
        if (startDateInput) {
            const today = new Date();
            const previousEnd = renewalMembership?.endDate ? new Date(renewalMembership.endDate) : today;
            startDateInput.value = formatLocalISO(previousEnd > today ? previousEnd : today);
            startDateInput.readOnly = Boolean(renewalMembership);
        }
        updateMembershipEndDate();

        document.getElementById('membershipModal').classList.add('show');
    } catch (error) {
        toast.error('Ошибка при загрузке данных ученика');
    }
}

// Закрыть модалку абонемента
function closeMembershipModal() {
    document.getElementById('membershipModal').classList.remove('show');
    currentMembershipRenewalId = null;
    currentMembershipRenewalEndDate = null;
    membershipPricePreviewRequestId += 1;
    lastMembershipPricingPreview = null;
    lastMembershipPricingSelection = null;
    resetMembershipAdditionalDiscount();
    setMembershipSubmitMode(false);
    const startDateInput = document.getElementById('membershipStartDate');
    if (startDateInput) startDateInput.readOnly = false;
    ['membershipDirectionId', 'membershipLessonFormat', 'membershipGroupId'].forEach(id => {
        const field = document.getElementById(id);
        if (field) field.disabled = false;
    });
    // Сбрасываем рассчитанную стоимость.
    const priceInputEl = document.getElementById('membershipTotalPrice');
    const hintTextEl = document.getElementById('membershipPriceHintText');
    if (priceInputEl) {
        priceInputEl.readOnly = true;
        priceInputEl.value = '';
    }
    if (hintTextEl) hintTextEl.innerHTML = '';
}

// Открыть модальное окно добавления/списания занятий
function openAddClassesModal(studentId, membershipId, mode = 'add', availableClasses = null) {
    const normalizedMode = mode === 'remove' ? 'remove' : 'add';
    
    document.getElementById('addClassesStudentId').value = studentId;
    document.getElementById('addClassesMembershipId').value = membershipId;
    document.getElementById('addClassesMode').value = normalizedMode;
    document.getElementById('addClassesAvailable').value = Number.isFinite(availableClasses) ? availableClasses : '';
    
    document.getElementById('addClassesAmount').value = '';
    document.getElementById('addClassesReason').value = '';
    
    const amountInput = document.getElementById('addClassesAmount');
    const reasonTextarea = document.getElementById('addClassesReason');
    const modalTitle = document.getElementById('addClassesModalTitle');
    const submitButton = document.getElementById('addClassesSubmit');
    const noticeElement = document.getElementById('addClassesNotice');
    
    const available = Number.isFinite(availableClasses) ? availableClasses : null;
    amountInput.min = 1;
    if (normalizedMode === 'remove' && available !== null) {
        amountInput.max = available > 0 ? available : 1;
        amountInput.setAttribute('max', amountInput.max);
    } else {
        amountInput.max = 50;
        amountInput.setAttribute('max', '50');
    }
    
    if (normalizedMode === 'remove' && available === 0) {
        amountInput.value = 0;
        amountInput.disabled = true;
    } else {
        amountInput.disabled = false;
    }
    
    modalTitle.textContent = normalizedMode === 'remove' ? 'СПИСАТЬ ЗАНЯТИЯ' : 'ДОБАВИТЬ ЗАНЯТИЯ';
    submitButton.textContent = normalizedMode === 'remove' ? 'СПИСАТЬ ЗАНЯТИЯ' : 'ДОБАВИТЬ ЗАНЯТИЯ';
    reasonTextarea.placeholder = normalizedMode === 'remove'
        ? 'Например: Исправление ошибки, списание бонусных занятий'
        : 'Например: Доплата за дополнительные занятия';
    
    if (noticeElement) {
        noticeElement.textContent = normalizedMode === 'remove'
            ? '⚠️ Списанные занятия будут немедленно убраны из абонемента и могут завершить его действие'
            : '⚠️ Добавленные занятия будут учтены в абонементе и продлят его действие';
    }
    
    document.getElementById('addClassesModal').classList.add('show');
}

// Закрыть модальное окно добавления занятий
function closeAddClassesModal() {
    document.getElementById('addClassesModal').classList.remove('show');
}

// Открыть модальное окно заморозки абонемента
function openFreezeModal(studentId, membershipId, gender = '') {
    document.getElementById('freezeStudentId').value = studentId;
    document.getElementById('freezeMembershipId').value = membershipId;
    document.getElementById('freezeStudentGender').value = gender || '';

    const today = new Date();
    const todayISO = today.toISOString().split('T')[0];
    const in7 = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const startInput = document.getElementById('freezeStartDate');
    const endInput = document.getElementById('freezeEndDate');
    const typeSelect = document.getElementById('freezeType');
    const reasonInput = document.getElementById('freezeReason');

    if (startInput) startInput.value = todayISO;
    if (endInput) endInput.value = in7;
    if (reasonInput) reasonInput.value = '';
    if (typeSelect) {
        typeSelect.value = 'regular';
        // Блокируем "Менструация" если не женщина
        Array.from(typeSelect.options).forEach(opt => {
            if (opt.value === 'period') {
                opt.disabled = gender !== 'female';
            }
        });
    }

    document.getElementById('freezeModal').classList.add('show');
}

// Закрыть модальное окно заморозки
function closeFreezeModal() {
    document.getElementById('freezeModal').classList.remove('show');
}

// Отмена заморозки (с подтверждением)
async function cancelFreeze(freezeId) {
    if (!freezeId) return;
    if (!confirm('Отменить эту заморозку? Если она активна, занятия будут списаны обратно.')) return;

    try {
        const response = await fetch(`${API_URL}/freezes/${freezeId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        const data = await response.json();
        if (data.success) {
            toast.success('Заморозка отменена');
            if (currentViewingStudentId) {
                if (typeof viewStudent === 'function') {
                    viewStudent(currentViewingStudentId);
                }
            }
        } else {
            toast.error(`Ошибка: ${data.error || 'Не удалось отменить заморозку'}`);
        }
    } catch (err) {
        console.error('Cancel freeze error:', err);
        toast.error('Ошибка при отмене заморозки');
    }
}

// Загрузить информацию об абонементе ученика
async function loadStudentMembership(studentId, student = null) {
    try {
        const token = getAuthToken();
        
        // Если студент не передан, загружаем
        if (!student) {
            const studentResponse = await fetch(`${API_URL}/students/${studentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const studentData = await studentResponse.json();
            student = studentData.student;
        }
        
        const response = await fetch(`${API_URL}/memberships/student/${studentId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        
        if (data.success && data.memberships && data.memberships.length > 0) {
            const card = data.memberships.find(m => m.billingModel === 'rate_card' && m.status === 'active');
            if (card && window.renderRateCardSummary) {
                document.getElementById('studentMembershipInfo').innerHTML = window.renderRateCardSummary(card);
                return;
            }
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const currentMemberships = data.memberships.filter(m => m.status === 'active'
                && new Date(m.startDate) <= new Date()
                && new Date(m.endDate) >= today);
            const activeMembership = currentMemberships.find(m => m.id === student.activeMembershipId || m._id === student.activeMembershipId)
                || currentMemberships[0];
            
            if (activeMembership) {
                const typeNames = {
                    'program': 'Основная программа',
                    'trial': 'Пробный',
                    'single_class': 'Разовое занятие',
                    'monthly': 'Месячный',
                    'monthly_12': 'Месячный (12 занятий)',
                    'quarterly': 'Квартальный',
                    'individual_single': 'Индивидуальное разовое',
                    'individual_package': 'Индивидуальный абонемент'
                };
                
                const startDate = new Date(activeMembership.startDate || activeMembership.createdAt).toLocaleDateString('ru');
                
                const emergencyRemaining = Number(activeMembership.emergencyFreezesAvailable || 0);
                const emergencyUsed = Number(activeMembership.emergencyFreezesUsed || 0);
                const emergencyFreezesText = `${emergencyRemaining} из ${emergencyRemaining + emergencyUsed}`;
                const discountSummary = buildDiscountSummary(activeMembership);
                
                const userRole = localStorage.getItem('userRole');
                const canAddClasses = userRole === 'super_admin' || userRole === 'admin';
                
                const coverage = student.balanceCoverage || null;
                const estimatedLessonsRemaining = coverage && coverage.stopReason !== 'no_schedule'
                    ? Number(coverage.coveredLessons)
                    : null;
                const coverageHint = !coverage
                    ? 'прогноз недоступен'
                    : coverage.stopReason === 'no_schedule'
                        ? 'будущие занятия не запланированы'
                        : coverage.stopReason === 'all_scheduled_covered'
                            ? 'все занятия в расписании покрыты'
                            : coverage.stopReason === 'membership_unavailable'
                                ? 'дальше нет подходящего абонемента'
                                : coverage.stopReason === 'price_unavailable'
                                    ? 'для следующего урока не задана стоимость'
                                    : 'до первого непокрытого урока';
                const classesRemaining = Number(activeMembership.classesRemaining);
                const classesColor = coverage?.stopReason === 'no_schedule'
                    ? '#9ca3af'
                    : ['membership_unavailable', 'price_unavailable'].includes(coverage?.stopReason)
                        ? '#ef4444'
                        : coverage?.stopReason === 'insufficient_balance' && estimatedLessonsRemaining <= 0
                            ? '#ef4444'
                            : coverage?.stopReason === 'insufficient_balance' && estimatedLessonsRemaining <= 1
                                ? '#f59e0b'
                                : '#10b981';
                
                document.getElementById('studentMembershipInfo').innerHTML = `
                    <div style="display: grid; grid-template-columns: auto 1fr; gap: 15px; align-items: center;">
                        <strong style="color: rgba(255,255,255,0.7);">Тип:</strong>
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <span>
                                ${escapeHtml(activeMembership.plan?.name || typeNames[activeMembership.type] || activeMembership.type)}
                                ${discountSummary ? `<small style="display:inline-flex; margin-left:8px; padding:3px 8px; border-radius:999px; background:rgba(212,169,78,.14); color:#d4a94e; font-weight:800;">${discountSummary}</small>` : ''}
                            </span>
                            ${canAddClasses ? `
                                <button 
                                    onclick="openEditActiveMembershipModal('${activeMembership._id}', '${activeMembership.startDate || ''}', '${activeMembership.endDate || ''}', ${activeMembership.totalPrice || 0}, ${activeMembership.freezesAvailable || 0}, ${activeMembership.emergencyFreezesAvailable || 0})"
                                    class="icon-btn"
                                    title="Редактировать параметры абонемента"
                                    style="margin-left: 10px; background: none; border: none; color: #eb4d77; cursor: pointer; padding: 0; display: inline-flex; align-items: center;"
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: block;">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                    </svg>
                                </button>
                            ` : ''}
                        </div>
                        
                        <strong style="color: rgba(255,255,255,0.7);">По ближайшему расписанию:</strong>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="color: ${classesColor}; font-weight: 700; font-size: 1.3em;">${estimatedLessonsRemaining === null ? '—' : `${estimatedLessonsRemaining} ур.`}</span>
                            <small style="opacity:.65;">${coverageHint}</small>
                            ${canAddClasses ? `
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <button 
                                        onclick="openAddClassesModal('${studentId}', '${activeMembership._id}', 'add', ${classesRemaining})" 
                                        class="icon-btn"
                                        title="Добавить занятия"
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                            <line x1="12" y1="5" x2="12" y2="19"></line>
                                            <line x1="5" y1="12" x2="19" y2="12"></line>
                                        </svg>
                                    </button>
                                    <button 
                                        onclick="openAddClassesModal('${studentId}', '${activeMembership._id}', 'remove', ${classesRemaining})" 
                                        class="icon-btn"
                                        title="Списать занятия"
                                        ${classesRemaining <= 0 ? 'disabled style="opacity: 0.4; cursor: not-allowed;"' : ''}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                            <line x1="5" y1="12" x2="19" y2="12"></line>
                                        </svg>
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                        
                        <strong style="color: rgba(255,255,255,0.7);">Пакетный счётчик:</strong>
                        <span>${classesRemaining} из ${activeMembership.totalClasses} (справочно)</span>
                        
                        <strong style="color: rgba(255,255,255,0.7);">Экстренных отмен осталось:</strong>
                        <span>${emergencyFreezesText}</span>
                        
                        <strong style="color: rgba(255,255,255,0.7);">Активирован:</strong>
                        <span>${startDate}</span>

                        <strong style="color: rgba(255,255,255,0.7);">Истекает:</strong>
                        <span>${activeMembership.endDate ? new Date(activeMembership.endDate).toLocaleDateString('ru') : '—'}</span>

                        <strong style="color: rgba(255,255,255,0.7);">Стоимость:</strong>
                        <span>${fmtMoney(activeMembership.totalPrice)} ₸${discountSummary ? ` · ${discountSummary}` : ''}</span>
                        
                        <strong style="color: rgba(255,255,255,0.7);">Статус:</strong>
                        <span style="color: #10b981;">Активен</span>
                    </div>
                `;
            } else {
                document.getElementById('studentMembershipInfo').innerHTML = `
                    <div style="text-align: center; padding: 20px; opacity: 0.7;">
                        Нет активного абонемента
                    </div>
                `;
            }
        } else {
            document.getElementById('studentMembershipInfo').innerHTML = `
                <div style="text-align: center; padding: 20px; opacity: 0.7;">
                    Нет активного абонемента
                </div>
            `;
        }
    } catch (error) {
        document.getElementById('studentMembershipInfo').innerHTML = `
            <div style="text-align: center; padding: 20px; color: #ef4444;">
                Ошибка загрузки абонемента
            </div>
        `;
    }
}

// Инициализация обработчиков для memberships
function updateMembershipTypeOptionLabels(preferredGroupId = null) {
    const groupSelect = document.getElementById('membershipGroupId');
    const directionSelect = document.getElementById('membershipDirectionId');
    const formatSelect = document.getElementById('membershipLessonFormat');
    const lessonCountInput = document.getElementById('membershipLessonCount');
    const validityInput = document.getElementById('membershipValidityDays');
    const programMonthsSelect = document.getElementById('membershipProgramMonths');
    if (!groupSelect || !directionSelect || !formatSelect || !lessonCountInput || !validityInput || !programMonthsSelect) return;

    const direction = allMembershipDirections.find(item => item._id === directionSelect.value);
    const lessonFormat = formatSelect.value || 'program';
    const isTrial = lessonFormat === 'trial';
    const isIndividual = lessonFormat === 'individual';
    if (isTrial) resetMembershipAdditionalDiscount();
    updateMembershipAdditionalDiscountControls();

    const previousMonths = programMonthsSelect.value;
    if (isIndividual) {
        programMonthsSelect.innerHTML = `
            <option value="1">1 месяц (8 уроков) — 32 000 ₸</option>
            <option value="2">2 месяца (16 уроков) — 62 000 ₸</option>
            <option value="3">3 месяца (24 урока) — 90 000 ₸</option>
        `;
        if (['1', '2', '3'].includes(previousMonths)) {
            programMonthsSelect.value = previousMonths;
        } else {
            programMonthsSelect.value = '1';
        }
    } else {
        programMonthsSelect.innerHTML = `
            <option value="1">1 месяц — 27 000 ₸</option>
            <option value="2">2 месяца — 50 000 ₸</option>
        `;
        if (['1', '2'].includes(previousMonths)) {
            programMonthsSelect.value = previousMonths;
        } else {
            programMonthsSelect.value = '1';
        }
    }

    const programMonths = Number(programMonthsSelect.value) || 1;
    if (isTrial) {
        lessonCountInput.value = 1;
        validityInput.value = 7;
    } else if (isIndividual) {
        lessonCountInput.value = programMonths === 3 ? 24 : (programMonths === 2 ? 16 : 8);
        validityInput.value = programMonths === 3 ? 180 : (programMonths === 2 ? 120 : 60);
    } else {
        lessonCountInput.value = programMonths * 10;
        validityInput.value = programMonths * 60;
    }

    const studentGroupIds = new Set(
        (currentMembershipStudent?.groups || [])
            .filter(item => item.status === 'active' && item.groupId?._id)
            .map(item => item.groupId._id)
    );
    const matchingGroups = allGroupsData.filter(group => group.direction === direction?.name || group.direction === 'Ансамбль');
    groupSelect.innerHTML = '<option value="">Без группы</option>';
    matchingGroups
        .sort((a, b) => Number(studentGroupIds.has(b._id)) - Number(studentGroupIds.has(a._id)))
        .forEach(group => {
            const option = document.createElement('option');
            option.value = group._id;
            const formatted = window.formatGroupWithSchedule ? window.formatGroupWithSchedule(group) : group.name;
            option.textContent = `${formatted}${studentGroupIds.has(group._id) ? ' (текущая)' : ''}`;
            if (group._id === preferredGroupId) option.selected = true;
            groupSelect.appendChild(option);
        });

    const groupContainer = document.getElementById('membershipGroupContainer');
    groupContainer.style.display = lessonFormat === 'program' ? 'block' : 'none';
    if (lessonFormat !== 'program') groupSelect.value = '';

    const composition = document.getElementById('membershipProgramComposition');
    const showMonths = ['program', 'individual'].includes(lessonFormat);
    if (composition) composition.style.display = showMonths ? 'block' : 'none';
    const programMonthsContainer = document.getElementById('membershipProgramMonthsContainer');
    if (programMonthsContainer) programMonthsContainer.style.display = showMonths ? 'block' : 'none';
    const compositionTitle = document.getElementById('membershipProgramCompositionTitle');
    const compositionText = document.getElementById('membershipProgramCompositionText');
    if (compositionTitle) compositionTitle.textContent = `Состав на ${validityInput.value} дней:`;
    if (compositionText) {
        if (isIndividual) {
            compositionText.textContent = `${lessonCountInput.value} индивидуальных занятий`;
        } else {
            compositionText.textContent = `Индивидуальные: ${programMonths * 4} · теория: ${programMonths * 2} · квартет: ${programMonths * 4}`;
        }
    }

    const freezeInput = document.getElementById('membershipFreezesAvailable');
    if (freezeInput && freezeInput.dataset.lastFormat !== lessonFormat) {
        freezeInput.value = 0;
        freezeInput.dataset.lastFormat = lessonFormat;
    }

    const formatNames = { trial: 'Пробный урок', program: 'Основная программа', individual: 'Индивидуально' };
    const lessonCount = parseInt(lessonCountInput.value, 10) || 0;
    const days = parseInt(validityInput.value, 10) || 0;
    document.getElementById('membershipPreview').textContent = direction
        ? `${direction.name} · ${formatNames[lessonFormat]} · ${lessonCount} зан. · ${days} дн.`
        : 'Выберите направление';
    updateMembershipEndDate(false);
    updateMembershipPricePreview();
}
window.updateMembershipTypeOptionLabels = updateMembershipTypeOptionLabels;

function initMembershipHandlers() {
    document.getElementById('membershipDirectionId')?.addEventListener('change', () => updateMembershipTypeOptionLabels());
    document.getElementById('membershipLessonFormat')?.addEventListener('change', () => updateMembershipTypeOptionLabels());
    document.getElementById('membershipProgramMonths')?.addEventListener('change', () => {
        updateMembershipTypeOptionLabels(document.getElementById('membershipGroupId')?.value || null);
    });
    document.getElementById('membershipAdditionalDiscountType')?.addEventListener('change', () => {
        document.getElementById('membershipAdditionalDiscountValue').value = '0';
        if (document.getElementById('membershipAdditionalDiscountType').value === 'none') resetMembershipAdditionalDiscount();
        updateMembershipPricePreview();
    });
    ['membershipAdditionalDiscountValue', 'membershipAdditionalDiscountReason'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', updateMembershipPricePreview);
    });
    document.getElementById('membershipClearAdditionalDiscount')?.addEventListener('click', () => {
        resetMembershipAdditionalDiscount();
        updateMembershipPricePreview();
    });
    document.getElementById('membershipLessonCount')?.addEventListener('input', () => updateMembershipTypeOptionLabels());
    document.getElementById('membershipValidityDays')?.addEventListener('input', () => updateMembershipTypeOptionLabels());
    document.getElementById('membershipStartDate')?.addEventListener('change', () => updateMembershipEndDate(false));
    document.getElementById('membershipEndDate')?.addEventListener('input', () => {
        const endInput = document.getElementById('membershipEndDate');
        if (endInput) endInput.dataset.manual = '1';
        updateMembershipSubmitState();
    });
    document.getElementById('membershipEndDate')?.addEventListener('change', () => {
        const endInput = document.getElementById('membershipEndDate');
        if (endInput) endInput.dataset.manual = '1';
        updateMembershipSubmitState();
    });

    document.querySelectorAll('#membershipEndDatePresets [data-days]')?.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const days = parseInt(btn.dataset.days, 10);
            if (days > 0) setMembershipEndDateDays(days);
        });
    });
    document.getElementById('membershipResetEndDate')?.addEventListener('click', (e) => {
        e.preventDefault();
        const endInput = document.getElementById('membershipEndDate');
        if (endInput) delete endInput.dataset.manual;
        updateMembershipEndDate(true);
    });
    document.getElementById('membershipGroupId')?.addEventListener('change', () => updateMembershipTypeOptionLabels(document.getElementById('membershipGroupId').value));
    document.getElementById('membershipFreezesAvailable')?.addEventListener('input', () => updateMembershipTypeOptionLabels(document.getElementById('membershipGroupId').value));

    const initialFreezeToggle = document.getElementById('membershipInitialFreezeEnabled');
    const initialFreezeFields = document.getElementById('membershipInitialFreezeFields');
    const initialFreezeStartInput = document.getElementById('membershipInitialFreezeStartDate');
    const initialFreezeEndInput = document.getElementById('membershipInitialFreezeEndDate');
    if (initialFreezeToggle) {
        initialFreezeToggle.addEventListener('change', () => {
            const enabled = initialFreezeToggle.checked;
            if (initialFreezeFields) initialFreezeFields.style.display = enabled ? 'block' : 'none';
            if (!enabled) return;

            const membershipStart = document.getElementById('membershipStartDate')?.value
                || formatLocalISO(new Date());
            if (initialFreezeStartInput && !initialFreezeStartInput.value) {
                initialFreezeStartInput.value = membershipStart;
            }
            if (initialFreezeEndInput && !initialFreezeEndInput.value) {
                const end = new Date(`${initialFreezeStartInput?.value || membershipStart}T00:00:00`);
                end.setDate(end.getDate() + 7);
                initialFreezeEndInput.value = formatLocalISO(end);
            }
        });
    }

    // Создание абонемента
    const membershipForm = document.getElementById('membershipForm');
    if (membershipForm) {
        let membershipSubmitting = false;
        membershipForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (membershipSubmitting) {
                toast.warning('Абонемент уже создаётся. Подождите.');
                return;
            }
            
            const studentId = document.getElementById('membershipStudentId').value;
            const groupId = document.getElementById('membershipGroupId').value;
            const directionId = document.getElementById('membershipDirectionId').value;
            const programMonths = Number(document.getElementById('membershipProgramMonths').value);
            const lessonFormat = document.getElementById('membershipLessonFormat').value;
            const freezesAvailable = parseInt(document.getElementById('membershipFreezesAvailable').value);
            const initialFreezeEnabled = document.getElementById('membershipInitialFreezeEnabled')?.checked === true;
            const initialFreezeStartDate = document.getElementById('membershipInitialFreezeStartDate')?.value || '';
            const initialFreezeEndDate = document.getElementById('membershipInitialFreezeEndDate')?.value || '';
            const initialFreezeReason = document.getElementById('membershipInitialFreezeReason')?.value?.trim() || '';
            const startDate = document.getElementById('membershipStartDate').value;
            const endDate = document.getElementById('membershipEndDate').value;
            const additionalDiscount = readMembershipAdditionalDiscount();
            if (additionalDiscount.error) {
                showMembershipDiscountError(additionalDiscount.error);
                toast.warning(additionalDiscount.error);
                return;
            }
            
            if (!directionId || !lastMembershipPricingPreview) {
                toast.warning('Выберите направление и дождитесь расчёта цены');
                return;
            }
            if (lastMembershipPricingSelection !== membershipPricingSelection(additionalDiscount.values)) {
                updateMembershipPricePreview();
                toast.warning('Условия изменились. Дождитесь нового расчёта и повторите сохранение.');
                return;
            }
            if (!startDate) {
                toast.warning('Укажите дату начала абонемента');
                return;
            }
            if (initialFreezeEnabled && (!initialFreezeStartDate || !initialFreezeEndDate)) {
                toast.warning('Для заморозки укажите дату начала и дату окончания');
                return;
            }
            if (initialFreezeEnabled && (!Number.isInteger(freezesAvailable) || freezesAvailable <= 0)) {
                toast.warning('Для заморозки добавьте хотя бы одну доступную заморозку');
                return;
            }
            if (initialFreezeEnabled && new Date(initialFreezeEndDate) < new Date(initialFreezeStartDate)) {
                toast.warning('Дата окончания заморозки не может быть раньше даты начала');
                return;
            }
            const submitButton = membershipForm.querySelector('button[type="submit"]');
            const submitButtonText = submitButton?.dataset.readyText || submitButton?.textContent || 'СОЗДАТЬ АБОНЕМЕНТ';
            membershipSubmitting = true;
            if (submitButton) {
                submitButton.dataset.submitting = '1';
                submitButton.disabled = true;
                submitButton.textContent = submitButton.dataset.loadingText || 'СОЗДАЁМ...';
            }
            try {
                const token = getAuthToken();
                
                const requestBody = {
                    studentId,
                    groupId,
                    directionId,
                    programMonths,
                    lessonFormat,
                    ...additionalDiscount.values,
                    freezesAvailable,
                    initialFreezeStartDate: initialFreezeEnabled ? initialFreezeStartDate : undefined,
                    initialFreezeEndDate: initialFreezeEnabled ? initialFreezeEndDate : undefined,
                    initialFreezeReason: initialFreezeEnabled ? initialFreezeReason : undefined,
                    startDate,
                    endDate,
                    renewMembershipId: currentMembershipRenewalId || undefined,
                    forceNew: !currentMembershipRenewalId
                };
                
                const response = await fetch(`${API_URL}/memberships`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody)
                });
                
                const data = await response.json();
                
                console.log(`💰 Membership created response:`, data);
                
                if (data.success) {
                    const scheduleMsg = data.scheduleGeneration?.created
                        ? `\nВ расписание добавлено занятий: ${data.scheduleGeneration.created}`
                        : '';
                    const freezeMsg = data.initialFreeze
                        ? `\nЗаморозка добавлена: ${data.initialFreeze.frozenClasses} занятий компенсировано`
                        : '';

                    const selectedProgramName = lessonFormat === 'trial' ? 'Пробный урок' : (lessonFormat === 'individual' ? `Индивидуально · ${programMonths} мес.` : `Основная программа · ${programMonths} мес.`);
                    if (data.initialFreezeError) {
                        toast.warning(`Абонемент создан, но заморозка не добавлена: ${data.initialFreezeError}`);
                    } else {
                        const actionText = data.isExtension ? 'Абонемент продлён!' : 'Абонемент создан!';
                        toast.success(`${actionText}\n\nПрограмма: ${selectedProgramName}\nЗанятий: ${data.membership.classesRemaining}${scheduleMsg}${freezeMsg}\n\nДеньги можно внести отдельным платежом.`);
                    }
                    
                    closeMembershipModal();
                    
                    // ⚡ СНАЧАЛА обновляем профиль, ПОТОМ таблицу студентов
                    if (currentViewingStudentId) {
                        // Обновляем профиль в фоне
                        setTimeout(async () => {
                            await viewStudent(currentViewingStudentId);
                            await renderStudents();
                        }, 100);
                    } else {
                        await renderStudents();
                    }
                } else {
                    toast.error(`Ошибка: ${data.error || 'Не удалось создать абонемент'}`);
                }
            } catch (error) {
                toast.error('Ошибка при создании абонемента');
            } finally {
                membershipSubmitting = false;
                if (submitButton) {
                    delete submitButton.dataset.submitting;
                    submitButton.textContent = submitButtonText;
                    updateMembershipSubmitState();
                }
            }
        });
    }
    
    // Обработка формы добавления занятий
    const addClassesForm = document.getElementById('addClassesForm');
    if (addClassesForm) {
        addClassesForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const membershipId = document.getElementById('addClassesMembershipId').value;
            const amount = parseInt(document.getElementById('addClassesAmount').value);
            const reason = document.getElementById('addClassesReason').value;
            const lessonType = document.getElementById('addClassesLessonType').value;
            const mode = document.getElementById('addClassesMode').value || 'add';
            const availableRaw = document.getElementById('addClassesAvailable').value;
            const available = availableRaw !== '' ? parseInt(availableRaw) : null;
            
            // Adding classes to membership
            
            if (!amount || amount <= 0) {
                const message = mode === 'remove'
                    ? 'Укажите количество занятий для списания'
                    : 'Укажите количество занятий для добавления';
                toast.warning(message);
                return;
            }
            
            if (mode === 'remove' && available !== null && amount > available) {
                toast.warning(`Нельзя списать больше, чем доступно. Осталось ${available}`);
                return;
            }
            
            if (!reason || reason.trim() === '') {
                const message = mode === 'remove'
                    ? 'Укажите причину списания занятий'
                    : 'Укажите причину добавления занятий';
                toast.warning(message);
                return;
            }
            
            try {
                const requestBody = { amount, reason: reason.trim(), lessonType };
                // Sending request to server
                
                const endpoint = mode === 'remove' ? 'remove-classes' : 'add-classes';
                
                const response = await fetch(`${API_URL}/memberships/${membershipId}/${endpoint}`, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${getAuthToken()}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody)
                });
                
                const data = await response.json();
                // Server response received
                
                if (data.success) {
                    const successMessage = mode === 'remove'
                        ? `Списано ${amount} занятий с абонемента`
                        : `Добавлено ${amount} занятий к абонементу!`;
                    toast.success(successMessage);
                    closeAddClassesModal();
                    
                    const studentId = document.getElementById('addClassesStudentId').value;
                    
                    // Обновляем только строку студента в списке СРАЗУ (до обновления профиля)
                    if (typeof window.updateStudentRow === 'function') {
                        window.updateStudentRow(studentId, data.membership.classesRemaining);
                    }
                    
                    // Затем обновляем только абонемент в профиле, если он открыт (БЕЗ полной перезагрузки!)
                    if (currentViewingStudentId === studentId) {
                        // Используем новую функцию из students.js, если доступна
                        if (typeof updateStudentMembershipInProfile === 'function') {
                            await updateStudentMembershipInProfile(studentId);
                        } else if (typeof window.updateStudentMembershipInProfile === 'function') {
                            await window.updateStudentMembershipInProfile(studentId);
                        } else {
                            // Fallback - полная перезагрузка если функция недоступна
                            viewStudent(studentId);
                        }
                    }
                    
                    // Если функция не найдена - перерисовываем весь список
                    if (typeof window.updateStudentRow !== 'function') {
                        renderStudents();
                    }
                } else {
                    console.error('❌ Ошибка от сервера:', data.error);
                    const errorMessage = mode === 'remove'
                        ? `Ошибка: ${data.error || 'Не удалось списать занятия'}`
                        : `Ошибка: ${data.error || 'Не удалось добавить занятия'}`;
                    toast.error(errorMessage);
                }
            } catch (error) {
                console.error('❌ Ошибка запроса:', error);
                const errorMessage = mode === 'remove'
                    ? 'Ошибка при списании занятий'
                    : 'Ошибка при добавлении занятий';
                toast.error(errorMessage);
            }
        });
    }

    // Обработка формы заморозки
    const freezeForm = document.getElementById('freezeForm');
    if (freezeForm) {
        freezeForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const studentId = document.getElementById('freezeStudentId').value;
            const membershipId = document.getElementById('freezeMembershipId').value;
            const type = document.getElementById('freezeType').value;
            const startDate = document.getElementById('freezeStartDate').value;
            const endDate = document.getElementById('freezeEndDate').value;
            const reason = document.getElementById('freezeReason').value.trim();

            if (!membershipId || !type || !startDate || !endDate) {
                toast.warning('Заполните все обязательные поля');
                return;
            }
            if (new Date(endDate) < new Date(startDate)) {
                toast.warning('Дата окончания не может быть раньше даты начала');
                return;
            }

            try {
                const response = await fetch(`${API_URL}/freezes`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${getAuthToken()}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        membershipId,
                        type,
                        startDate,
                        endDate,
                        reason: reason || undefined
                    })
                });

                const data = await response.json();

                if (data.success) {
                    const status = data.freeze && data.freeze.status;
                    if (status === 'pending') {
                        toast.success('Заморозка создана и ожидает одобрения');
                    } else {
                        toast.success('Заморозка активирована');
                    }
                    closeFreezeModal();

                    if (studentId && typeof viewStudent === 'function') {
                        viewStudent(studentId);
                    }
                    if (typeof renderStudents === 'function') {
                        renderStudents();
                    }
                } else {
                    toast.error(`Ошибка: ${data.error || 'Не удалось создать заморозку'}`);
                }
            } catch (err) {
                console.error('❌ Freeze request error:', err);
                toast.error('Ошибка при создании заморозки');
            }
        });
    }

    const editActiveForm = document.getElementById('editActiveMembershipForm');
    if (editActiveForm) {
        editActiveForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const id = document.getElementById('editActiveMembershipId').value;
            const startDate = document.getElementById('editActiveMembershipStartDate').value;
            const endDate = document.getElementById('editActiveMembershipEndDate').value;
            const freezesAvailable = parseInt(document.getElementById('editActiveMembershipFreezesAvailable').value);
            const emergencyFreezesAvailable = parseInt(document.getElementById('editActiveMembershipEmergencyFreezesAvailable').value);
            const submitButton = editActiveForm.querySelector('button[type="submit"]');

            const currentState = {
                startDate,
                endDate,
                freezesAvailable,
                emergencyFreezesAvailable,
            };
            const payload = {};
            Object.entries(currentState).forEach(([key, value]) => {
                if (value !== activeMembershipEditInitialState?.[key]) payload[key] = value;
            });

            if (Object.keys(payload).length === 0) {
                toast.info('Изменений нет');
                return;
            }

            if (new Date(endDate) < new Date(startDate)) {
                toast.error('Дата окончания не может быть раньше даты активации');
                return;
            }
            
            try {
                const token = getAuthToken();
                if (submitButton) {
                    submitButton.disabled = true;
                    submitButton.textContent = 'СОХРАНЯЕМ…';
                }

                const response = await fetch(`${API_URL}/memberships/${id}`, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
                const data = await response.json();
                if (!response.ok || !data.success) {
                    toast.error(data.error || 'Не удалось обновить абонемент');
                    return;
                }
                
                toast.success('Параметры абонемента успешно обновлены');
                window.closeEditActiveMembershipModal();
                
                if (currentViewingStudentId && typeof viewStudent === 'function') {
                    await viewStudent(currentViewingStudentId);
                }
            } catch (err) {
                console.error('Edit active membership error:', err);
                toast.error('Ошибка при обновлении абонемента');
            } finally {
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.textContent = 'СОХРАНИТЬ';
                }
            }
        });
    }
}

window.openEditActiveMembershipModal = function(id, startDate, endDate, totalPrice, freezesAvailable, emergencyFreezesAvailable) {
    document.getElementById('editActiveMembershipId').value = id;
    
    const startInput = document.getElementById('editActiveMembershipStartDate');
    if (startInput) {
        startInput.value = startDate ? new Date(startDate).toISOString().split('T')[0] : '';
    }
    
    const endInput = document.getElementById('editActiveMembershipEndDate');
    if (endInput) {
        endInput.value = endDate ? new Date(endDate).toISOString().split('T')[0] : '';
    }

    const freezesInput = document.getElementById('editActiveMembershipFreezesAvailable');
    if (freezesInput) {
        freezesInput.value = freezesAvailable ?? 0;
    }

    const emergencyInput = document.getElementById('editActiveMembershipEmergencyFreezesAvailable');
    if (emergencyInput) {
        emergencyInput.value = emergencyFreezesAvailable ?? 0;
    }
    
    activeMembershipEditInitialState = {
        startDate: startInput?.value || '',
        endDate: endInput?.value || '',
        freezesAvailable: Number(freezesInput?.value || 0),
        emergencyFreezesAvailable: Number(emergencyInput?.value || 0),
    };
    
    document.getElementById('editActiveMembershipModal').classList.add('show');
};

window.closeEditActiveMembershipModal = function() {
    document.getElementById('editActiveMembershipModal').classList.remove('show');
    activeMembershipEditInitialState = null;
};

// Экспорт для admin.js
window.initMembershipHandlers = initMembershipHandlers;
window.openFreezeModal = openFreezeModal;
window.closeFreezeModal = closeFreezeModal;
window.cancelFreeze = cancelFreeze;
window.openMembershipModal = openMembershipModal;
window.closeMembershipModal = closeMembershipModal;
window.loadStudentMembership = loadStudentMembership;
window.openAddClassesModal = openAddClassesModal;
window.closeAddClassesModal = closeAddClassesModal;
