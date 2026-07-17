(function () {
    const PAYMENT_URL = 'https://maestro-school.duckdns.org';
    const PRIVACY_POLICY_URL = 'https://app-maestro-school.duckdns.org/privacy.html';
    const SCHOOL_WHATSAPP = '+7 777 505 57 88';
    const DIAGNOSTIC_LESSON_PRICE = '2000 ₸';
    const CRM_ORIGIN = window.MAESTRO_TRIAL_CRM_ORIGIN
        || (window.location.hostname === 'maestro-school.duckdns.org' ? 'https://app-maestro-school.duckdns.org' : '');
    const BOOKING_API_URL = `${CRM_ORIGIN}/api/bookings`;

    const form = document.getElementById('trialQuizForm');
    const steps = Array.from(document.querySelectorAll('.quiz-step'));
    const backBtn = document.getElementById('quizBack');
    const nextBtn = document.getElementById('quizNext');
    const progressText = document.getElementById('quizProgressText');
    const progressBar = document.getElementById('quizProgressBar');
    const paymentLink = document.getElementById('paymentLink');
    const success = document.getElementById('trialSuccess');
    const successSubtitle = document.getElementById('successSubtitle');
    const successWhatsapp = document.getElementById('successWhatsapp');
    const formError = document.getElementById('trialFormError');
    let currentStep = 0;
    let latestSummary = '';
    let submitInProgress = false;

    paymentLink.href = PAYMENT_URL;

    function getCheckedValues(name) {
        return Array.from(form.querySelectorAll(`[name="${name}"]:checked`)).map(input => input.value);
    }

    function stepIsValid(step) {
        const fields = Array.from(step.querySelectorAll('input, textarea'));
        const grouped = new Set();

        for (const field of fields) {
            if ((field.type === 'radio' || field.type === 'checkbox') && field.required) {
                grouped.add(field.name);
                continue;
            }
            if (!field.checkValidity()) {
                field.reportValidity();
                return false;
            }
        }

        for (const name of grouped) {
            if (!form.querySelector(`[name="${name}"]:checked`)) {
                const first = form.querySelector(`[name="${name}"]`);
                first?.reportValidity();
                return false;
            }
        }

        return true;
    }

    function updateStep() {
        steps.forEach((step, index) => {
            step.classList.toggle('is-active', index === currentStep);
        });
        const progress = ((currentStep + 1) / steps.length) * 100;
        progressText.textContent = `Шаг ${currentStep + 1} из ${steps.length}`;
        progressBar.style.width = `${progress}%`;
        backBtn.disabled = currentStep === 0;
        nextBtn.textContent = currentStep === steps.length - 1 ? 'Отправить заявку' : 'Дальше';
    }

    function scrollToCurrentStep() {
        if (!window.matchMedia('(max-width: 900px)').matches) return;
        const activeStep = steps[currentStep];
        const target = activeStep?.querySelector('legend') || activeStep || form;
        requestAnimationFrame(() => {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    function formatName(value, fallback) {
        return String(value || '').trim() || fallback;
    }

    function splitStudentName(fullName) {
        const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
        return {
            lastName: parts[0] || 'Не указано',
            name: parts[1] || 'Не указано',
            middleName: parts.slice(2).join(' ') || '',
        };
    }

    function formatDateOfBirth(value) {
        if (!value) return '';
        const [year, month, day] = String(value).split('-');
        if (!year || !month || !day) return value;
        return `${day}.${month}.${year}`;
    }

    function getFirstName(value) {
        const raw = String(value || '').trim();
        if (!raw || raw.toLowerCase() === 'родитель') return '';
        const [firstName] = raw.split(/\s+/).filter(Boolean);
        if (!firstName) return '';
        return firstName.charAt(0).toLocaleUpperCase('ru-RU') + firstName.slice(1);
    }

    function getFormData() {
        const data = new FormData(form);
        return {
            audience: data.get('audience') || 'Ребенку',
            studentFullName: formatName(data.get('studentFullName'), 'ученика'),
            dateOfBirth: String(data.get('dateOfBirth') || '').trim(),
            direction: data.get('direction') || 'музыка',
            format: data.get('format') || 'unsure',
            experience: data.get('experience') || 'first',
            goal: data.get('goal') || 'interest',
            time: getCheckedValues('time'),
            contactMethod: data.get('contactMethod') || 'Позвонить',
            parentName: formatName(data.get('parentName'), 'родитель'),
            phone: String(data.get('phone') || '').trim(),
            comment: String(data.get('comment') || '').trim(),
            privacyConsent: data.get('privacyConsent') === 'yes',
        };
    }

    function formatLabel(format) {
        if (format === 'group') return 'групповой формат';
        if (format === 'individual') return 'индивидуальный формат';
        return 'формат подберем на пробном';
    }

    function experienceFocus(experience) {
        if (experience === 'confident') return 'диагностика текущего уровня, репертуара и техники';
        if (experience === 'some') return 'мягкая проверка базы, слуха, ритма и привычек практики';
        return 'первое знакомство с инструментом, ритмом и простыми музыкальными задачами';
    }

    function goalFocus(goal) {
        if (goal === 'performance') return 'подберем маленькую сценическую цель и репертуар для уверенности';
        if (goal === 'skill') return 'соберем базу: посадка, звук, ритм и понятное домашнее задание';
        return 'найдем музыку, от которой ученику захочется продолжать';
    }

    function buildSummary(data) {
        const time = data.time.length ? data.time.join(', ') : 'время обсудим с администратором';
        return [
            'Заявка на диагностический урок Maestro',
            `Для кого: ${data.audience}`,
            `Ученик: ${data.studentFullName}`,
            data.dateOfBirth ? `Дата рождения: ${formatDateOfBirth(data.dateOfBirth)}` : null,
            `Направление: ${data.direction}`,
            `Формат: ${formatLabel(data.format)}`,
            `Опыт: ${experienceFocus(data.experience)}`,
            `Цель: ${goalFocus(data.goal)}`,
            `Удобное время: ${time}`,
            `Как связаться: ${data.contactMethod}`,
            `Родитель: ${data.parentName}`,
            `Телефон: ${data.phone}`,
            data.comment ? `Комментарий: ${data.comment}` : null,
            data.privacyConsent ? `Согласие на обработку персональных данных: да (${PRIVACY_POLICY_URL})` : null,
            `Диагностический урок: ${DIAGNOSTIC_LESSON_PRICE}, урок + анализ по пробному`,
        ].filter(Boolean).join('\n');
    }

    function buildBookingPayload(data) {
        const studentName = splitStudentName(data.studentFullName);
        const notes = [
            buildSummary(data),
            '',
            'Источник: лендинг диагностического урока',
        ].join('\n');
        return {
            ...studentName,
            dateOfBirth: data.dateOfBirth || null,
            phone: data.phone,
            direction: data.direction,
            source: 'Сайт',
            notes,
            landingUrl: window.location.href,
            referrerUrl: document.referrer || null,
            attribution: {
                privacyConsent: data.privacyConsent,
                privacyConsentAt: new Date().toISOString(),
                privacyPolicyUrl: PRIVACY_POLICY_URL,
                landing: 'trial-diagnostic',
            },
        };
    }

    async function submitBookingToCrm(data) {
        const response = await fetch(BOOKING_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Idempotency-Key': `trial-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            },
            body: JSON.stringify(buildBookingPayload(data)),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Не удалось отправить заявку');
        }
        return result.booking || null;
    }

    function setSubmitError(message = '') {
        if (!formError) return;
        formError.textContent = message;
        formError.hidden = !message;
    }

    function setSubmitting(isSubmitting) {
        submitInProgress = isSubmitting;
        nextBtn.disabled = isSubmitting;
        backBtn.disabled = isSubmitting || currentStep === 0;
        nextBtn.textContent = isSubmitting ? 'Отправляем...' : 'Отправить заявку';
    }

    function buildWhatsappUrl(message) {
        const configuredPhone = normalizePhone(SCHOOL_WHATSAPP || window.MAESTRO_BRAND?.supportPhone);
        if (!configuredPhone) return '#';
        return `https://wa.me/${configuredPhone}?text=${encodeURIComponent(message)}`;
    }

    function renderSuccess() {
        const data = getFormData();
        latestSummary = buildSummary(data);
        const whatsappMessage = [
            'Здравствуйте! Оставили заявку на диагностический урок Maestro.',
            '',
            latestSummary,
        ].join('\n');

        const parentFirstName = getFirstName(data.parentName);
        successSubtitle.textContent = parentFirstName
            ? `${parentFirstName}, заявка принята. Мы свяжемся с вами в ближайшее время.`
            : 'Заявка принята. Мы свяжемся с вами в ближайшее время.';
        successWhatsapp.href = buildWhatsappUrl(whatsappMessage);
        form.hidden = true;
        success.hidden = false;
    }

    function normalizePhone(phone) {
        let digits = String(phone || '').replace(/\D/g, '');
        if (digits.startsWith('8')) digits = `7${digits.slice(1)}`;
        if (digits.length === 10) digits = `7${digits}`;
        return digits;
    }

    nextBtn.addEventListener('click', async () => {
        if (submitInProgress) return;
        setSubmitError('');
        const step = steps[currentStep];
        if (!stepIsValid(step)) return;

        if (currentStep < steps.length - 1) {
            currentStep += 1;
            updateStep();
            scrollToCurrentStep();
            return;
        }

        const data = getFormData();
        try {
            setSubmitting(true);
            latestSummary = buildSummary(data);
            await submitBookingToCrm(data);
            renderSuccess();
        } catch (error) {
            setSubmitError(`${error.message}. Попробуйте ещё раз или напишите нам в WhatsApp: ${SCHOOL_WHATSAPP}.`);
        } finally {
            setSubmitting(false);
        }
    });

    backBtn.addEventListener('click', () => {
        if (submitInProgress) return;
        setSubmitError('');
        if (currentStep === 0) return;
        currentStep -= 1;
        updateStep();
        scrollToCurrentStep();
    });

    updateStep();
})();
