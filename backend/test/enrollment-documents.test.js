const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEnrollmentDocuments, buildRenewalAppendix, TEMPLATE_VERSION } = require('../src/services/enrollmentDocuments');

const student = { name: 'Айгерим', lastName: 'Тестова', middleName: '', dateOfBirth: '2015-03-07T00:00:00.000Z' };
const terms = {
    name: 'Гитара 8', direction: 'Гитара', days: 45, totalPrice: 32000, firstPayment: 16000, emergencyCancellations: 1,
    rates: { individual: { price: 4000 }, duo: { price: 2500 } }, durations: { individual: 45, duo: 60 },
    scheduleText: 'Индивидуально, вт и чт 17:00', additionalTerms: '',
};
const minor = {
    student, terms, documentDate: '2026-11-02', number: 'М-7',
    customer: { type: 'representative', fullName: 'Тестова Гульнара <Б>', iin: '880101400123', phone: '77010001122', address: 'г. Актобе, ул. Тестовая, 1', relationship: 'mother', representation: 'Родитель' },
};
const adult = { ...minor, student: { ...student, dateOfBirth: '1995-05-05T00:00:00.000Z' }, customer: { type: 'self', iin: '950505400321', phone: '77010003344', address: 'г. Актобе, пр. Абая, 10' } };

const rows = (html, selector) => (html.match(selector) || []).length;

test('the set is three bilingual documents: Kazakh left, Russian right, point against point', () => {
    const html = buildEnrollmentDocuments(minor);
    assert.equal(rows(html, /<article /g), 3);
    assert.equal(rows(html, /<td lang="kk">/g), rows(html, /<td lang="ru">/g));
    assert.ok(rows(html, /<td lang="kk">/g) > 100, 'every contract point has its pair');
    // Казахский пункт в левой ячейке, русский в правой, в одной строке.
    assert.match(html, /<tr class="p"><td lang="kk"><p>1\.1\. Орындаушы[^<]*<\/p><\/td><td lang="ru"><p>1\.1\. Исполнитель[^<]*<\/p><\/td><\/tr>/);
    assert.match(html, /<h1>Музыкалық оқыту қызметтерін көрсету туралы шарт<\/h1><\/td><td lang="ru"><h1>Договор об оказании услуг по музыкальному обучению<\/h1>/);
    assert.match(html, /<h1>Абонемент бойынша оқу талаптары<\/h1>/); assert.match(html, /<h1>Согласие на сбор и обработку персональных данных<\/h1>/);
});

test('administrator data stands once, labelled in both languages; nothing is left as blanks', () => {
    const html = buildEnrollmentDocuments(minor);
    assert.match(html, /№ М-7\s+Ақтөбе қ\. \/ г\. Актобе\s+02\.11\.2026/);
    assert.match(html, /Тестова Гульнара &lt;Б&gt; \(Т\.А\.Ә\.\), бұдан әрі/); assert.match(html, /Тестова Гульнара &lt;Б&gt; \(ФИО\), далее/);
    assert.doesNotMatch(html, /<Б>/);
    assert.match(html, /ата-анасы немесе заңды өкілі ретінде/); assert.match(html, /как родитель или законный представитель/);
    assert.match(html, /ЖСН \/ ИИН: 880101400123<br>Мекенжайы \/ Адрес: г\. Актобе, ул\. Тестовая, 1<br>Телефон: 77010001122/);
    assert.match(html, /Тапсырыс беруші — ата-ана немесе заңды өкіл \/ Заказчик — родитель или законный представитель/);
    assert.match(html, /02\.11\.2026 № М-7 шартқа № 1 қосымша \/ Приложение № 1 к договору № М-7 от 02\.11\.2026/);
    assert.match(html, /Оқушының Т\.А\.Ә\. \/ Ученик \(ФИО\): Тестова Айгерим/); assert.match(html, /Дата рождения Ученика: 07\.03\.2015/);
    assert.match(html, /Тариф: Гитара 8</); assert.match(html, /Срок использования: 45 күнтізбелік күн/);
    assert.match(html, /Стоимость одного абонемента в тенге: 32000/);
    assert.match(html, /Зачёт остатка: 0 теңге/); assert.match(html, /К оплате с учётом зачёта: 32000/);
    assert.match(html, /Первый платёж: 16000 теңге \/ тенге\.\s+Қосымша төлем \/ Доплата: 16000/);
    assert.match(html, /<td>Жеке сабақ \/ Индивидуальный<\/td><td>45<\/td><td>4000<\/td>/); assert.match(html, /<td>Дуо<\/td><td>60<\/td><td>2500<\/td>/);
    assert.match(html, /<td>Трио<\/td><td>—<\/td><td>—<\/td>/);
    assert.match(html, /Расписание \(формат, дни и время\): Индивидуально, вт и чт 17:00/); assert.match(html, /Количество экстренных отмен на один абонемент: 1/);
    assert.match(html, /Дополнительные условия: —/);
    assert.match(html, /Тапсырыс беруші \/ Заказчик __________ \/ Тестова Гульнара &lt;Б&gt;/);
    assert.match(html, /Мен \/ Я, Тестова Гульнара &lt;Б&gt; \(Т\.А\.Ә\. \/ ФИО\),/);
    assert.match(html, /Мәртебе: ата-ана\./); assert.match(html, /Статус: родитель\./);
    assert.match(html, /ФИО ребёнка: Тестова Айгерим/); assert.match(html, /Дата рождения ребёнка: 07\.03\.2015/); assert.match(html, /Основание представительства: Родитель/);
    // Варианты по WhatsApp — одна клетка на строку, текст без «[ ]».
    assert.equal(rows(html, /<td class="box">☐<\/td>/g), 2); assert.doesNotMatch(html, /\[ \]/);
    // Пустых линий для ручного заполнения не остаётся: ни в пунктах, ни в полях, кроме подписей и дат подписания.
    assert.doesNotMatch(html, /<td lang="(kk|ru)"><(p|h1|h2)>[^<]*_{4,}/);
    for (const field of html.match(/<td colspan="2">[^<]*_{4,}[^<]*<\/td>/g)) assert.match(field, /Қолы \/ Подпись|Күні \/ Дата|Дата подписания приложения/, field);
});

test('an adult student is the customer: no child fields, status is the adult student', () => {
    const html = buildEnrollmentDocuments(adult);
    assert.match(html, /Тестова Айгерим \(ФИО\), далее/);
    assert.match(html, /Заказчик заключает договор для собственного обучения\./); assert.match(html, /шартты өзі оқу үшін жасасады/);
    assert.match(html, /Тапсырыс беруші өзі оқиды \/ Заказчик обучается лично/);
    assert.match(html, /Статус: совершеннолетний Ученик\./); assert.match(html, /ФИО ребёнка: —/); assert.match(html, /Дата рождения ребёнка: —/); assert.match(html, /Основание представительства: —/);
    assert.match(html, /Ученик \(ФИО\): Тестова Айгерим/); assert.match(html, /Дата рождения Ученика: 05\.05\.1995/);
});

test('renewal appendix is one bilingual document with credit, kind and its own number', () => {
    const html = buildRenewalAppendix({ ...minor, appendixNumber: 'П-3', renewalKind: 'half_year', creditAmount: 4000, firstCash: 20000 });
    assert.equal(rows(html, /<article /g), 1); assert.doesNotMatch(html, /туралы шарт<\/h1>/);
    assert.match(html, /№ П-3 қосымша \/ Приложение № П-3 к договору № М-7/);
    assert.match(html, /Тариф: Гитара 8 \(жарты жылдық \/ полугодовой\)/);
    assert.match(html, /Зачёт остатка: 4000/); assert.match(html, /К оплате с учётом зачёта: 28000/);
    assert.match(html, /Первый платёж: 20000 теңге \/ тенге\.\s+Қосымша төлем \/ Доплата: 8000/);
    assert.match(TEMPLATE_VERSION, /^2026-10-09-bilingual1-[0-9a-f]{12}$/);
});
