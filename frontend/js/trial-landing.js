(function () {
    const PRIVACY_POLICY_URL = 'https://app-maestro-school.duckdns.org/privacy.html';
    const SCHOOL_WHATSAPP = '+7 777 505 57 88';
    const DIAGNOSTIC_LESSON_PRICE = '2000 ₸';
    const CRM_ORIGIN = window.MAESTRO_TRIAL_CRM_ORIGIN
        || (window.location.hostname === 'maestro-school.duckdns.org' ? 'https://app-maestro-school.duckdns.org' : '');
    const BOOKING_API_URL = `${CRM_ORIGIN}/api/bookings`;
    const marketing = window.MaestroMarketing;

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
    const audienceInputs = Array.from(form.querySelectorAll('[name="audience"]'));
    const identityLegend = document.getElementById('quizIdentityLegend');
    const birthDateField = document.getElementById('quizBirthDateField');
    const birthDateInput = document.getElementById('quizBirthDate');
    const birthDateLabel = document.getElementById('quizBirthDateLabel');
    const contactNameField = document.getElementById('quizContactNameField');
    const contactNameInput = form.querySelector('[name="parentName"]');
    const quizModal = document.getElementById('trialQuiz');
    const quizDialog = quizModal?.querySelector('.trial-quiz-modal__dialog');
    const quizOpenTriggers = Array.from(document.querySelectorAll('[data-open-trial-quiz]'));
    const quizCloseTriggers = Array.from(document.querySelectorAll('[data-close-trial-quiz]'));
    let currentStep = 0;
    let latestSummary = '';
    let submitInProgress = false;
    let lastFocusedElement = null;
    let lastScrollY = 0;

    function openQuiz() {
        if (!quizModal) return;
        lastFocusedElement = document.activeElement;
        lastScrollY = window.scrollY;
        quizModal.hidden = false;
        quizModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('trial-quiz-open');
        quizOpenTriggers.forEach((trigger) => trigger.setAttribute('aria-expanded', 'true'));
        quizModal.scrollTop = 0;
        requestAnimationFrame(() => quizDialog?.focus({ preventScroll: true }));
    }

    function closeQuiz() {
        if (!quizModal) return;
        quizModal.hidden = true;
        quizModal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('trial-quiz-open');
        quizOpenTriggers.forEach((trigger) => trigger.setAttribute('aria-expanded', 'false'));
        if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
            lastFocusedElement.focus({ preventScroll: true });
        }
        window.scrollTo(0, lastScrollY);
    }

    quizOpenTriggers.forEach((trigger) => {
        trigger.setAttribute('aria-expanded', 'false');
        trigger.addEventListener('click', (event) => {
            event.preventDefault();
            openQuiz();
        });
    });

    quizCloseTriggers.forEach((trigger) => trigger.addEventListener('click', closeQuiz));
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && quizModal && !quizModal.hidden) closeQuiz();
    });

    marketing?.track?.('booking_form_view', { form: 'trial-diagnostic' });

    paymentLink.textContent = 'Оплатить урок в WhatsApp';

    function updateAudienceFields() {
        const audience = form.querySelector('[name="audience"]:checked')?.value || 'Ребенку';
        const isAdult = audience === 'Взрослому';

        if (identityLegend) identityLegend.textContent = isAdult ? 'Как вас зовут?' : 'Как зовут ученика?';
        if (birthDateField) birthDateField.hidden = false;
        if (birthDateInput) {
            birthDateInput.required = !isAdult;
        }
        if (birthDateLabel) birthDateLabel.textContent = isAdult ? 'Дата рождения (необязательно)' : 'Дата рождения';
        if (contactNameField) contactNameField.hidden = isAdult;
        if (contactNameInput) {
            contactNameInput.required = false;
            if (isAdult) contactNameInput.value = '';
        }
    }

    audienceInputs.forEach(input => input.addEventListener('change', updateAudienceFields));
    updateAudienceFields();

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
        if (quizModal && !quizModal.hidden) {
            quizModal.scrollTo({ top: 0, behavior: 'smooth' });
        }
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
            studentLastName: formatName(data.get('studentLastName'), ''),
            studentFirstName: formatName(data.get('studentFirstName'), ''),
            dateOfBirth: String(data.get('dateOfBirth') || '').trim(),
            direction: data.get('direction') || 'музыка',
            format: data.get('format') || 'unsure',
            experience: data.get('experience') || 'first',
            goal: data.get('goal') || 'interest',
            time: getCheckedValues('time'),
            contactMethod: data.get('contactMethod') || 'Позвонить',
            parentName: formatName(data.get('parentName'), ''),
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

    function directionLabel(direction) {
        if (direction === 'Не определился') return 'нужно помочь выбрать направление';
        return direction;
    }

    function audienceLabel(audience) {
        if (audience === 'Ребенку') return 'для ребёнка';
        if (audience === 'Подростку') return 'для подростка';
        if (audience === 'Взрослому') return 'для себя';
        return audience;
    }

    function experienceFocus(experience) {
        if (experience === 'confident') return 'диагностика текущего уровня, репертуара и техники';
        if (experience === 'some') return 'мягкая проверка базы, слуха, ритма и привычек практики';
        return 'первое знакомство с инструментом, ритмом и простыми музыкальными задачами';
    }

    function goalFocus(goal) {
        if (goal === 'performance') return 'подберем маленькую сценическую цель и репертуар для уверенности';
        if (goal === 'skill') return 'соберем базу: посадка, звук, ритм и понятное домашнее задание';
        return 'найдем музыку, к которой захочется возвращаться';
    }

    function buildSummary(data) {
        const time = data.time.length ? data.time.join(', ') : 'время обсудим с администратором';
        const studentFullName = [data.studentLastName, data.studentFirstName].filter(Boolean).join(' ');
        const contactName = data.parentName || studentFullName;
        return [
            'Заявка на диагностический урок Maestro',
            `Занятия: ${audienceLabel(data.audience)}`,
            `Фамилия ученика: ${data.studentLastName}`,
            `Имя ученика: ${data.studentFirstName}`,
            data.dateOfBirth ? `Дата рождения: ${formatDateOfBirth(data.dateOfBirth)}` : null,
            `Направление: ${directionLabel(data.direction)}`,
            `Формат: ${formatLabel(data.format)}`,
            `Опыт: ${experienceFocus(data.experience)}`,
            `Цель: ${goalFocus(data.goal)}`,
            `Удобное время: ${time}`,
            `Как связаться: ${data.contactMethod}`,
            `Контактное лицо: ${contactName}`,
            `Телефон: ${data.phone}`,
            data.comment ? `Комментарий: ${data.comment}` : null,
            data.privacyConsent ? `Согласие на обработку персональных данных: да (${PRIVACY_POLICY_URL})` : null,
            `Диагностический урок: ${DIAGNOSTIC_LESSON_PRICE}, 30 минут + анализ педагога и понятный план обучения`,
        ].filter(Boolean).join('\n');
    }

    function buildBookingPayload(data) {
        const notes = [
            buildSummary(data),
            '',
            'Источник: лендинг диагностического урока',
        ].join('\n');
        const marketingContext = marketing?.getContext?.() || {
            landingUrl: window.location.href,
            referrerUrl: document.referrer || null,
        };
        return {
            lastName: data.studentLastName,
            name: data.studentFirstName,
            middleName: '',
            dateOfBirth: data.dateOfBirth || null,
            phone: data.phone,
            direction: data.direction,
            source: 'Сайт',
            notes,
            ...marketingContext,
            attribution: {
                ...(marketingContext.attribution || {}),
                privacyConsent: data.privacyConsent,
                privacyConsentAt: new Date().toISOString(),
                privacyPolicyUrl: PRIVACY_POLICY_URL,
                landing: 'trial-diagnostic',
                trialQuiz: {
                    audience: data.audience,
                    studentLastName: data.studentLastName,
                    studentFirstName: data.studentFirstName,
                    dateOfBirth: data.dateOfBirth || null,
                    direction: data.direction,
                    format: data.format,
                    experience: data.experience,
                    goal: data.goal,
                    time: data.time,
                    contactMethod: data.contactMethod,
                    parentName: data.parentName || null,
                    comment: data.comment || null,
                },
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

    function buildPaymentWhatsappMessage() {
        const data = getFormData();
        const direction = data.direction === 'Не определился'
            ? ' и выбрать направление'
            : (data.direction && data.direction !== 'музыка' ? ` по направлению «${data.direction}»` : '');
        const time = data.time.length ? ` Удобное время: ${data.time.join(', ').toLowerCase()}.` : '';
        const studentFullName = [data.studentLastName, data.studentFirstName].filter(Boolean).join(' ');
        const name = studentFullName
            ? ` Ученик: ${studentFullName}.`
            : '';
        return [
            'Здравствуйте! Я оставил(а) заявку на сайте Maestro.',
            `Хочу подобрать время${direction} и оплатить диагностический урок: 30 минут + анализ педагога и понятный план обучения.${name}${time}`,
        ].join('\n');
    }

    function updatePaymentLink() {
        if (!paymentLink) return;
        paymentLink.href = buildWhatsappUrl(buildPaymentWhatsappMessage());
    }

    paymentLink?.addEventListener('click', () => {
        marketing?.track?.('payment_intent', { form: 'trial-diagnostic' });
    });

    function renderSuccess() {
        const data = getFormData();
        latestSummary = buildSummary(data);
        const whatsappMessage = [
            'Здравствуйте! Оставили заявку на диагностический урок Maestro.',
            '',
            latestSummary,
        ].join('\n');

        const contactFirstName = getFirstName(data.parentName || data.studentFirstName);
        successSubtitle.textContent = contactFirstName
            ? `${contactFirstName}, заявка принята. Мы свяжемся с вами в ближайшее время.`
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
            marketing?.track?.(currentStep === 0 ? 'quiz_start' : 'quiz_step', {
                step: currentStep + 1,
                page: 'trial-diagnostic',
            });
            if (currentStep === steps.length - 2) {
                marketing?.track?.('quiz_contact_step', { step: currentStep + 1 });
            }
            currentStep += 1;
            updateStep();
            scrollToCurrentStep();
            return;
        }

        const data = getFormData();
        try {
            setSubmitting(true);
            latestSummary = buildSummary(data);
            marketing?.track?.('booking_submit_attempt', { form: 'trial-diagnostic' });
            const booking = await submitBookingToCrm(data);
            marketing?.track?.('lead_submit', {
                form: 'trial-diagnostic',
                bookingId: booking?.id || booking?._id,
            });
            renderSuccess();
        } catch (error) {
            marketing?.track?.('lead_submit_error', { form: 'trial-diagnostic' });
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

    form.addEventListener('input', updatePaymentLink);
    form.addEventListener('change', updatePaymentLink);

    updateStep();
    updatePaymentLink();
})();
