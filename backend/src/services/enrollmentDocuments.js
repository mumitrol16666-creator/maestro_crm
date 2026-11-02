// Печатный комплект оформления: шарт / договор, қосымша / приложение, келісім / согласие.
// Каждый документ — одна таблица: казахский текст слева, русский справа, пункт против пункта.
// Поля, которые заполняет администратор, идут одной строкой на всю ширину с подписью на двух
// языках, чтобы данные стояли один раз. Текст пунктов — из шаблонов templates/enrollment/*.json
// (комплект от 09.10.2026), он здесь не редактируется.
const { createHash } = require('node:crypto');
const templates = Object.fromEntries(['contract', 'appendix', 'consent'].flatMap(kind => ['ru', 'kk'].map(lang => {
    const key = `${kind}-${lang}`;
    return [key, require(`../templates/enrollment/${key}.json`)];
})));
const TEMPLATE_VERSION = `2026-10-09-bilingual1-${createHash('sha256').update(JSON.stringify(templates)).digest('hex').slice(0, 12)}`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
const fio = person => [person.lastName, person.name || person.firstName, person.middleName].filter(Boolean).join(' ');
const day = value => String(value).slice(0, 10).split('-').reverse().join('.');
const dash = value => (value === undefined || value === null || value === '' ? '—' : value);

const SCHOOL = {
    executorLines: [
        'СИДОРОВ ЖК / ИП СИДОРОВ',
        'Сидоров Владислав Максимович',
        'ЖСН / ИИН: 990324351358',
        'Мектептің және өтініштерге арналған мекенжайы / Адрес школы и для обращений:',
        'Ақтөбе қ., Марат Оспанов көш., 52/2 / г. Актобе, ул. Марата Оспанова, 52/2',
        'Банк: «Kaspi Bank» АҚ / АО «Kaspi Bank»',
        'ЖСК / ИИК: KZ65722S000039869067',
        'БСК / БИК: CASPKZKA      БеК / КБе: 19',
        'Телефон: 8 (777) 505-57-88',
        '',
        'Қолы / Подпись __________ / Сидоров В. М.',
    ],
    executorLine: 'Орындаушы / Исполнитель: СИДОРОВ ЖК / ИП СИДОРОВ — Сидоров Владислав Максимович. ЖСН / ИИН 990324351358.',
    addressLine: 'Мектептің мекенжайы / Адрес школы: Ақтөбе қ., Марат Оспанов көш., 52/2 / г. Актобе, ул. Марата Оспанова, 52/2. Телефон: 8 (777) 505-57-88.',
    bankLine: 'Банк: «Kaspi Bank» АҚ / АО «Kaspi Bank». ЖСК / ИИК: KZ65722S000039869067. БСК / БИК: CASPKZKA. БеК / КБе: 19.',
    placeLine: 'Сабақ өткізілетін орын / Место проведения занятий: Ақтөбе қ., Марат Оспанов көш., 52/2 / г. Актобе, ул. Марата Оспанова, 52/2.',
};
const RATE_ROWS = [['individual', 'Жеке сабақ / Индивидуальный'], ['duo', 'Дуо'], ['trio', 'Трио'], ['quartet', 'Квартет'], ['theory', 'Теория']];
const RENEWAL_KIND = { ordinary: 'әдеттегі / обычный', half_year: 'жарты жылдық / полугодовой', year: 'жылдық / годовой' };

// ---- строки документа ---------------------------------------------------------
function paragraphs(key) {
    return Object.fromEntries(templates[key].blocks.filter(b => b.type === 'p').map(b => [b.index, b]));
}
function cellTag(block) {
    return block.index === 0 ? 'h1' : block.style.startsWith('Heading') ? 'h2' : 'p';
}
// Пункт на двух языках: левая ячейка казахская, правая русская. `patch` подменяет текст блока по языку.
function pair(kind, index, patch) {
    const kk = paragraphs(`${kind}-kk`)[index], ru = paragraphs(`${kind}-ru`)[index];
    const tag = cellTag(kk);
    const text = (block, lang) => patch ? patch(lang, block.text) : block.text;
    return `<tr class="${tag}"><td lang="kk"><${tag}>${escape(text(kk, 'kk'))}</${tag}></td><td lang="ru"><${tag}>${escape(text(ru, 'ru'))}</${tag}></td></tr>`;
}
// Строка на всю ширину: заполненное поле с подписью на двух языках.
function line(text, cls = 'field') {
    return `<tr class="${cls}"><td colspan="2">${escape(text)}</td></tr>`;
}
function multiline(text) {
    return escape(text).replaceAll('\n', '<br>');
}
function grid(rows) {
    return `<table class="doc">${rows.join('')}</table>`;
}

function customerName(snapshot) {
    return snapshot.customer.type === 'self' ? fio(snapshot.student) : snapshot.customer.fullName;
}

// ---- 1. Шарт / Договор -------------------------------------------------------------
function contractRows(snapshot) {
    const { student, customer: c, documentDate, number } = snapshot;
    const self = c.type === 'self', name = customerName(snapshot);
    const rows = [pair('contract', 0), line(`№ ${number}          Ақтөбе қ. / г. Актобе          ${day(documentDate)}`, 'field strong')];
    rows.push(pair('contract', 2, (lang, text) => text.replace(/_+/, name)));
    rows.push(pair('contract', 3, lang => (lang === 'kk'
        ? `Тапсырыс беруші шартты ${self ? 'өзі оқу үшін' : 'кәмелетке толмаған Оқушының ата-анасы немесе заңды өкілі ретінде'} жасасады.`
        : `Заказчик заключает договор ${self ? 'для собственного обучения' : 'как родитель или законный представитель несовершеннолетнего Ученика'}.`)));
    for (let index = 4; index <= 66; index++) rows.push(pair('contract', index));
    const customerLines = [
        `Т.А.Ә. / ФИО: ${name}`, `ЖСН / ИИН: ${c.iin}`, `Мекенжайы / Адрес: ${c.address}`, `Телефон: ${c.phone}`, '',
        self ? 'Тапсырыс беруші өзі оқиды / Заказчик обучается лично'
            : 'Тапсырыс беруші — ата-ана немесе заңды өкіл / Заказчик — родитель или законный представитель',
        '', `Қолы / Подпись __________ / ${name}`,
    ];
    // Заголовок раздела 11 и подписи — один неразрывный блок, чтобы шапка не осталась на другой странице.
    rows.push(`<tr><td colspan="2" class="nested"><table class="doc">${pair('contract', 67)}`
        + `<tr class="sign-head"><th>Орындаушы / Исполнитель</th><th>Тапсырыс беруші / Заказчик</th></tr>`
        + `<tr class="sign"><td>${SCHOOL.executorLines.map(escape).join('<br>')}</td><td>${multiline(customerLines.join('\n'))}</td></tr></table></td></tr>`);
    return rows;
}

// ---- 2. Қосымша / Приложение -------------------------------------------------------
function appendixRows(snapshot) {
    const { student, terms: t, documentDate, number, appendixNumber = 1, creditAmount = 0, firstCash, renewalKind } = snapshot;
    const name = customerName(snapshot), date = day(documentDate);
    const first = firstCash ?? t.firstPayment, toPay = t.totalPrice - creditAmount;
    const strong = text => line(text, 'field strong');
    const rows = [
        pair('appendix', 0),
        strong(`${date} № ${number} шартқа № ${appendixNumber} қосымша / Приложение № ${appendixNumber} к договору № ${number} от ${date}`),
        // Дата подписания пишется от руки при подписании, из печати она не выводится.
        strong('Қосымшаға қол қойылған күн / Дата подписания приложения: «____» ____________ 20____ ж. / г.'),
        strong(SCHOOL.executorLine),
        line(SCHOOL.addressLine),
        line(SCHOOL.bankLine),
        strong(`Тапсырыс беруші / Заказчик: ${name}`),
        strong(`Оқушының Т.А.Ә. / Ученик (ФИО): ${fio(student)}`),
        strong(`Оқушының туған күні / Дата рождения Ученика: ${day(student.dateOfBirth)}`),
        pair('appendix', 9),
        strong(`Оқу бағыты (бағыттары) / Направление(я) обучения: ${t.direction}`),
        strong(SCHOOL.placeLine),
        pair('appendix', 12),
        strong(`Тариф: ${t.name}${renewalKind ? ` (${RENEWAL_KIND[renewalKind]})` : ''}`),
        line(`Пайдалану мерзімі / Срок использования: ${t.days} күнтізбелік күн, барлық қосымша күндерді қоса алғанда / календарных дней, включая все дополнительные дни.`),
        pair('appendix', 15),
        strong(`Бір абонементтің құны теңгемен / Стоимость одного абонемента в тенге: ${t.totalPrice}`),
        line('Осы қосымша бойынша алғашқы абонементтің есебі / Расчёт для первого абонемента по этому приложению', 'field note'),
        line(`Есепке алынатын қалдық / Зачёт остатка: ${creditAmount} теңге / тенге.`),
        line(`Қалдықты есепке алғанда төленетін сома / К оплате с учётом зачёта: ${toPay} теңге / тенге.`),
        line(`Алғашқы төлем / Первый платёж: ${first} теңге / тенге.      Қосымша төлем / Доплата: ${toPay - first} теңге / тенге.`),
        pair('appendix', 21),
        pair('appendix', 22),
    ];
    const rates = RATE_ROWS.map(([kind, label]) => `<tr><td>${escape(label)}</td><td>${escape(dash(t.durations?.[kind]))}</td><td>${escape(dash(t.rates?.[kind]?.price))}</td></tr>`);
    rows.push(`<tr><td colspan="2" class="nested"><table class="rates"><thead><tr><th>Сабақ форматы / Формат занятия</th><th>Ұзақтығы минутпен / Длительность в минутах</th><th>Бір сабақ бағасы теңгемен / Цена за урок в тенге</th></tr></thead><tbody>${rates.join('')}</tbody></table></td></tr>`);
    rows.push(
        pair('appendix', 23),
        strong(`Кесте (формат, күндер мен уақыт) / Расписание (формат, дни и время): ${t.scheduleText}`),
        strong(`Бір абонементке арналған шұғыл бас тартулар саны / Количество экстренных отмен на один абонемент: ${t.emergencyCancellations}`),
        pair('appendix', 27),
        pair('appendix', 28),
        strong(`Қосымша талаптар / Дополнительные условия: ${t.additionalTerms || '—'}`),
        pair('appendix', 31),
        strong('Орындаушы / Исполнитель __________ / Сидоров В. М.          Күні / Дата __________________'),
        strong(`Тапсырыс беруші / Заказчик __________ / ${name}          Күні / Дата __________________`),
    );
    return rows;
}

// ---- 3. Келісім / Согласие -----------------------------------------------------------
function consentRows(snapshot) {
    const { student, customer: c, documentDate, number } = snapshot;
    const self = c.type === 'self', name = customerName(snapshot);
    const rows = [
        pair('consent', 0),
        line(`№ ${number} шартқа / К договору № ${number} от ${day(documentDate)}`),
        pair('consent', 2),
        line(`Мен / Я, ${name} (Т.А.Ә. / ФИО),`),
        pair('consent', 4),
        pair('consent', 5, lang => (lang === 'kk'
            ? `Мәртебе: ${self ? 'кәмелетке толған Оқушы' : c.relationship === 'guardian' ? 'өзге заңды өкіл' : 'ата-ана'}.`
            : `Статус: ${self ? 'совершеннолетний Ученик' : c.relationship === 'guardian' ? 'иной законный представитель' : 'родитель'}.`)),
        line(`Баланың Т.А.Ә. / ФИО ребёнка: ${self ? '—' : fio(student)}`),
        line(`Баланың туған күні / Дата рождения ребёнка: ${self ? '—' : day(student.dateOfBirth)}`),
        line(`Өкілдік негізі / Основание представительства: ${self ? '—' : c.representation}`),
        line(`Байланыс және жеке кабинет үшін деректер / Контакт для обращений и личного кабинета: ${c.phone}`),
    ];
    for (let index = 10; index <= 26; index++) rows.push(pair('consent', index));
    // Варианты по WhatsApp: одна клетка для отметки на бумаге, текст рядом на двух языках.
    const choice = index => ['kk', 'ru'].map(lang => `<td lang="${lang}"><p>${escape(paragraphs(`consent-${lang}`)[index].text.replace(/^\[ \] /, ''))}</p></td>`).join('');
    rows.push(`<tr><td colspan="2" class="nested"><table class="choice">${[27, 28].map(index => `<tr><td class="box">☐</td>${choice(index)}</tr>`).join('')}</table></td></tr>`);
    for (let index = 29; index <= 32; index++) rows.push(pair('consent', index));
    rows.push(line(`Қолы / Подпись __________ / ${name}          Күні / Дата «____» __________ 20____ ж. / г.`, 'field strong'));
    rows.push(pair('consent', 34).replace('<tr class="p">', '<tr class="p small">'));
    return rows;
}

// ---- сборка ----------------------------------------------------------------------------
const STYLE = '@page{size:A4;margin:12mm 12mm}*{box-sizing:border-box}body{margin:0;color:#000;background:#fff;font:9pt/1.1 "Times New Roman",serif}'
    + 'article{break-before:page}article:first-child{break-before:auto}'
    + 'table.doc{width:100%;border-collapse:collapse;table-layout:fixed}table.doc>tbody>tr>td,table.doc>tbody>tr>th{width:50%;vertical-align:top;padding:1pt 5pt 1pt}'
    + 'table.doc>tbody>tr>td[lang]{border-right:1px solid #c8c8c8}table.doc>tbody>tr>td[lang="ru"]{border-right:0}table.doc tr{break-inside:avoid}'
    + 'h1{font-size:12pt;text-align:center;margin:0 0 4pt}h2{font-size:10pt;text-align:center;margin:4pt 0 1pt;break-after:avoid}tr.h1,tr.h2{break-after:avoid}'
    + 'p{margin:0;text-align:justify;orphans:3;widows:3}tr.field td{padding:2pt 5pt;text-align:left}tr.strong td{font-weight:bold}tr.note td{font-style:italic}tr.small td{font-size:8pt}'
    + 'tr.sign-head th{background:#eee;border:1px solid #c8c8c8;text-align:center;font-weight:bold;padding:2pt}tr.sign td{border:1px solid #c8c8c8;padding:3pt 5pt}'
    + 'table.choice{width:100%;border-collapse:collapse;table-layout:fixed}table.choice td{vertical-align:top;padding:1pt 5pt 2pt}table.choice td.box{width:16pt;font-size:12pt;padding:0 2pt;text-align:center}table.choice td[lang="kk"]{border-right:1px solid #c8c8c8}'
    + 'td.nested{padding:2pt 0;break-inside:avoid}table.rates{width:100%;border-collapse:collapse}table.rates th,table.rates td{border:1px solid #c8c8c8;padding:2pt 5pt;text-align:left;vertical-align:top}table.rates th{background:#eee;font-weight:bold}thead{display:table-header-group}'
    + '@media screen{body{max-width:210mm;padding:12mm;margin:auto}article{margin-bottom:16mm}}';

function buildDocuments(parts, title) {
    return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>${escape(title)}</title><style>${STYLE}</style><body>`
        + parts.map(([kind, rows]) => `<article class="${kind}">${grid(rows)}</article>`).join('') + '</body></html>';
}
function buildEnrollmentDocuments(snapshot) {
    return buildDocuments([['contract', contractRows(snapshot)], ['appendix', appendixRows(snapshot)], ['consent', consentRows(snapshot)]], 'Маэстро — комплект документов');
}
function buildRenewalAppendix(snapshot) {
    return buildDocuments([['appendix', appendixRows(snapshot)]], `Маэстро — приложение № ${snapshot.appendixNumber}`);
}
module.exports = { TEMPLATE_VERSION, buildEnrollmentDocuments, buildRenewalAppendix, fio };
