(function () {
    const PAYMENT_URL = 'https://maestro-school.duckdns.org';
    const SCHOOL_WHATSAPP = '';
    const DIAGNOSTIC_LESSON_PRICE = '2000 ₸';

    const form = document.getElementById('trialQuizForm');
    const steps = Array.from(document.querySelectorAll('.quiz-step'));
    const backBtn = document.getElementById('quizBack');
    const nextBtn = document.getElementById('quizNext');
    const progressText = document.getElementById('quizProgressText');
    const progressBar = document.getElementById('quizProgressBar');
    const result = document.getElementById('trialResult');
    const resultTitle = document.getElementById('resultTitle');
    const resultSubtitle = document.getElementById('resultSubtitle');
    const planRoot = document.getElementById('trialPlan');
    const paymentLink = document.getElementById('paymentLink');
    const sendRequestBtn = document.getElementById('sendRequestBtn');
    let currentStep = 0;
    let latestSummary = '';

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
        nextBtn.textContent = currentStep === steps.length - 1 ? 'Получить план' : 'Дальше';
    }

    function formatName(value, fallback) {
        return String(value || '').trim() || fallback;
    }

    function getFormData() {
        const data = new FormData(form);
        return {
            childName: formatName(data.get('childName'), 'ребенка'),
            childAge: String(data.get('childAge') || '').trim(),
            direction: data.get('direction') || 'музыка',
            format: data.get('format') || 'unsure',
            experience: data.get('experience') || 'first',
            goal: data.get('goal') || 'interest',
            time: getCheckedValues('time'),
            parentName: formatName(data.get('parentName'), 'родитель'),
            phone: String(data.get('phone') || '').trim(),
            comment: String(data.get('comment') || '').trim(),
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
        return 'найдем музыку, от которой ребенку захочется продолжать';
    }

    function buildSummary(data) {
        const time = data.time.length ? data.time.join(', ') : 'время обсудим с администратором';
        return [
            'Заявка на диагностический урок Maestro',
            `Ребенок: ${data.childName}${data.childAge ? `, ${data.childAge} лет` : ''}`,
            `Направление: ${data.direction}`,
            `Формат: ${formatLabel(data.format)}`,
            `Опыт: ${experienceFocus(data.experience)}`,
            `Цель: ${goalFocus(data.goal)}`,
            `Удобное время: ${time}`,
            `Родитель: ${data.parentName}`,
            `Телефон: ${data.phone}`,
            data.comment ? `Комментарий: ${data.comment}` : null,
            `Диагностический урок: ${DIAGNOSTIC_LESSON_PRICE}, урок + анализ по пробному`,
        ].filter(Boolean).join('\n');
    }

    function renderResult() {
        const data = getFormData();
        latestSummary = buildSummary(data);
        const childLine = data.childAge ? `${data.childName}, ${data.childAge} лет` : data.childName;

        resultTitle.textContent = `Для ${childLine}: ${data.direction}`;
        resultSubtitle.textContent = `Рекомендуемый старт: ${formatLabel(data.format)}. После диагностического урока педагог даст анализ и уточнит расписание, группу или индивидуальный план.`;

        planRoot.innerHTML = [
            {
                step: '01',
                title: 'На уроке',
                text: `${experienceFocus(data.experience)}. Педагог посмотрит внимание, моторику, слух, ритм и реакцию на формат занятия.`,
            },
            {
                step: '02',
                title: 'В анализе',
                text: 'После занятия родитель получает понятную рекомендацию: формат, стартовый уровень, сильные стороны и что развивать первым.',
            },
            {
                step: '03',
                title: 'Дальше',
                text: `${goalFocus(data.goal)} Определим постоянный график, подходящую группу или индивидуальный темп.`,
            },
        ].map(item => `
            <article>
                <span>${item.step}</span>
                <h3>${item.title}</h3>
                <p>${item.text}</p>
            </article>
        `).join('');

        result.hidden = false;
        sendRequestBtn.disabled = false;
        result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function normalizePhone(phone) {
        let digits = String(phone || '').replace(/\D/g, '');
        if (digits.startsWith('8')) digits = `7${digits.slice(1)}`;
        if (digits.length === 10) digits = `7${digits}`;
        return digits;
    }

    function sendRequest() {
        if (!latestSummary) {
            renderResult();
        }

        const configuredPhone = normalizePhone(SCHOOL_WHATSAPP || window.MAESTRO_BRAND?.supportPhone);
        if (configuredPhone) {
            window.open(`https://wa.me/${configuredPhone}?text=${encodeURIComponent(latestSummary)}`, '_blank', 'noopener');
            return;
        }

        const subject = encodeURIComponent('Заявка на диагностический урок Maestro');
        const body = encodeURIComponent(latestSummary);
        window.location.href = `mailto:?subject=${subject}&body=${body}`;
    }

    nextBtn.addEventListener('click', () => {
        const step = steps[currentStep];
        if (!stepIsValid(step)) return;

        if (currentStep < steps.length - 1) {
            currentStep += 1;
            updateStep();
            return;
        }

        renderResult();
    });

    backBtn.addEventListener('click', () => {
        if (currentStep === 0) return;
        currentStep -= 1;
        updateStep();
    });

    sendRequestBtn.addEventListener('click', sendRequest);
    updateStep();
})();
