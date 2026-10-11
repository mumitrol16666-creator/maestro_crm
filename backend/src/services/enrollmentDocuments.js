const { createHash } = require('node:crypto');
const templates = Object.fromEntries(['contract', 'appendix', 'consent'].flatMap(kind => ['ru', 'kk'].map(lang => {
    const key = `${kind}-${lang}`;
    return [key, require(`../templates/enrollment/${key}.json`)];
})));
const TEMPLATE_VERSION = `2026-10-09-html1-${createHash('sha256').update(JSON.stringify(templates)).digest('hex').slice(0, 12)}`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
const fio = person => [person.lastName, person.name || person.firstName, person.middleName].filter(Boolean).join(' ');
const day = value => String(value).slice(0, 10).split('-').reverse().join('.');

function fillTemplate(key, { student, customer: c, terms: t, documentDate, number, appendixNumber = 1, creditAmount = 0, firstCash, renewalKind }) {
    const kk = key.endsWith('-kk'), self = c.type === 'self';
    const name = self ? fio(student) : c.fullName;
    const date = day(documentDate), dob = day(student.dateOfBirth);
    const patches = key.startsWith('contract') ? {
        1: `№ ${number}     ${kk ? 'Ақтөбе қ.' : 'г. Актобе'}     ${date}`,
        2: templates[key].blocks[2].text.replace(/_+/, name),
        3: kk ? `Тапсырыс беруші шартты ${self ? 'өзі оқу үшін' : 'кәмелетке толмаған Оқушының ата-анасы немесе заңды өкілі ретінде'} жасасады.`
            : `Заказчик заключает договор ${self ? 'для собственного обучения' : 'как родитель или законный представитель несовершеннолетнего Ученика'}.`,
    } : key.startsWith('appendix') ? {
        1: kk ? `${date} № ${number} шартқа № ${appendixNumber} қосымша` : `Приложение № ${appendixNumber} к договору № ${number} от ${date}`,
        // Signature dates are written only at the actual signing, never inferred from printing.
        6: `${kk ? 'Тапсырыс беруші' : 'Заказчик'}: ${name}`,
        7: `${kk ? 'Оқушының Т.А.Ә.' : 'Ученик (ФИО)'}: ${fio(student)}`,
        8: `${kk ? 'Оқушының туған күні' : 'Дата рождения Ученика'}: ${dob}`,
        10: `${kk ? 'Оқу бағыты (бағыттары)' : 'Направление(я) обучения'}: ${t.direction}`,
        13: `Тариф: ${t.name}${renewalKind ? ` (${(kk ? { ordinary: 'әдеттегі', half_year: 'жарты жылдық', year: 'жылдық' } : { ordinary: 'обычный', half_year: 'полугодовой', year: 'годовой' })[renewalKind]})` : ''}`,
        14: kk ? `Пайдалану мерзімі: барлық қосымша күндерді қоса алғанда, ${t.days} күнтізбелік күн.` : `Срок использования: ${t.days} календарных дней, включая все дополнительные дни.`,
        16: `${kk ? 'Бір абонементтің құны теңгемен' : 'Стоимость одного абонемента в тенге'}: ${t.totalPrice}`,
        18: `${kk ? 'Есепке алынатын қалдық' : 'Зачёт остатка'}: ${creditAmount}`,
        19: `${kk ? 'Қалдықты есепке алғанда төленетін сома' : 'К оплате с учётом зачёта'}: ${t.totalPrice - creditAmount}`,
        20: kk ? `Алғашқы төлем: ${firstCash ?? t.firstPayment} теңге. Қосымша төлем: ${t.totalPrice - creditAmount - (firstCash ?? t.firstPayment)} теңге.` : `Первый платёж: ${firstCash ?? t.firstPayment} тенге. Доплата: ${t.totalPrice - creditAmount - (firstCash ?? t.firstPayment)} тенге.`,
        24: `${kk ? 'Кесте (формат, күндер мен уақыт)' : 'Расписание (формат, дни и время)'}: ${t.scheduleText}`,
        25: '—',
        26: `${kk ? 'Бір абонементке арналған шұғыл бас тартулар саны' : 'Количество экстренных отмен на один абонемент'}: ${t.emergencyCancellations}`,
        29: `${kk ? 'Қосымша талаптар' : 'Дополнительные условия'}: ${t.additionalTerms || '—'}`,
        30: '—',
    } : {
        1: kk ? `${date} № ${number} шартқа` : `К договору № ${number} от ${date}`,
        3: `${kk ? 'Мен' : 'Я'}, ${name} (${kk ? 'Т.А.Ә.' : 'ФИО'}),`,
        5: kk ? `Мәртебе: ${self ? 'кәмелетке толған Оқушы' : c.relationship === 'guardian' ? 'өзге заңды өкіл' : 'ата-ана'}.`
            : `Статус: ${self ? 'совершеннолетний Ученик' : c.relationship === 'guardian' ? 'иной законный представитель' : 'родитель'}.`,
        6: `${kk ? 'Баланың Т.А.Ә.' : 'ФИО ребёнка'}: ${self ? '—' : fio(student)}`,
        7: `${kk ? 'Баланың туған күні' : 'Дата рождения ребёнка'}: ${self ? '—' : dob}`,
        8: `${kk ? 'Өкілдік негізі' : 'Основание представительства'}: ${self ? '—' : c.representation}`,
        9: `${kk ? 'Байланыс және жеке кабинет үшін деректер' : 'Контакт для обращений и личного кабинета'}: ${c.phone}`,
    };
    return templates[key].blocks.map(block => {
        if (block.type === 'p') {
            const text = Object.hasOwn(patches, block.index) ? patches[block.index] : block.text;
            const tag = block.index === 0 ? 'h1' : block.style.startsWith('Heading') ? 'h2' : 'p';
            return `<${tag}>${escape(text)}</${tag}>`;
        }
        const rows = block.rows.map(row => [...row]);
        if (key.startsWith('appendix')) {
            ['individual', 'duo', 'trio', 'quartet', 'theory'].forEach((kind, i) => {
                rows[i + 1][1] = t.durations[kind] ?? '—';
                rows[i + 1][2] = t.rates[kind]?.price ?? '—';
            });
        } else if (key.startsWith('contract')) {
            rows[1][1] = `${kk ? 'Т.А.Ә.' : 'ФИО'}: ${name}\n${kk ? 'ЖСН' : 'ИИН'}: ${c.iin}\n${kk ? 'Мекенжай' : 'Адрес'}: ${c.address}\nТелефон: ${c.phone}\n\n${kk ? 'Қолы' : 'Подпись'} __________ / ${name}`;
        }
        return `<table>${rows.map((row, i) => `<tr>${row.map(cell => `<${i ? 'td' : 'th'}>${escape(cell).replaceAll('\n', '<br>')}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</table>`;
    }).join('\n');
}
function buildDocuments(snapshot, keys, title) {
    return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>${escape(title)}</title>` +
        `<style>@page{size:A4;margin:14mm 15mm}*{box-sizing:border-box}body{margin:0;color:#000;background:#fff;font:10.5pt/1.12 "Times New Roman",serif}article{break-before:page}article:first-child{break-before:auto}h1{font-size:14pt;text-align:center;margin:0 0 8pt}h2{font-size:10.5pt;margin:7pt 0 3pt;break-after:avoid}p{margin:0 0 2pt;text-align:justify;orphans:3;widows:3}table{break-inside:avoid;border-collapse:collapse;width:100%;margin:6pt 0}td,th{border:1px solid #bbb;padding:4pt;text-align:left;vertical-align:top}tr{break-inside:avoid}th{background:#eee}thead{display:table-header-group}.appendix{font-size:10pt;line-height:1.1}.appendix td,.appendix th{padding:3pt}.appendix p{margin-bottom:2pt}@media screen{body{max-width:210mm;padding:16mm;margin:auto}article{margin-bottom:20mm}}</style><body>` +
        keys.map(key => `<article class="${key.split('-')[0]}" lang="${key.endsWith('kk') ? 'kk' : 'ru'}">${fillTemplate(key, snapshot)}</article>`).join('') + '</body></html>';
}
function buildEnrollmentDocuments(snapshot) {
    return buildDocuments(snapshot, Object.keys(templates), 'Маэстро — комплект документов');
}
function buildRenewalAppendix(snapshot) {
    return buildDocuments(snapshot, ['appendix-ru', 'appendix-kk'], `Маэстро — приложение № ${snapshot.appendixNumber}`);
}
module.exports = { TEMPLATE_VERSION, buildEnrollmentDocuments, buildRenewalAppendix, fio };
