const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../frontend/js/admin.js');
let content = fs.readFileSync(filePath, 'utf8');

// Счетчики
let alertCount = 0;
let confirmCount = 0;

// Замена простых alert на showNotification с иконками
const alertReplacements = [
    // Errors
    { regex: /alert\('Ошибка: ' \+ \(([^)]+)\)\);/g, replacement: "showNotification(notificationWithIcon('error', `Ошибка: ${$1}`));" },
    { regex: /alert\('Ошибка подключения к серверу'\);/g, replacement: "showNotification(notificationWithIcon('error', 'Ошибка подключения к серверу'));" },
    { regex: /alert\('Ошибка при (.+?)'\);/g, replacement: "showNotification(notificationWithIcon('error', 'Ошибка при $1'));" },
    { regex: /alert\('Ошибка ([^']+)'\);/g, replacement: "showNotification(notificationWithIcon('error', 'Ошибка $1'));" },
    { regex: /alert\(([^)]+error[^)]+)\);/gi, replacement: "showNotification(notificationWithIcon('error', $1));" },
    
    // Success with emoji
    { regex: /alert\(`✅ (.+?)`\);/g, replacement: "showNotification(notificationWithIcon('success', `$1`));" },
    { regex: /alert\('✅ (.+?)'\);/g, replacement: "showNotification(notificationWithIcon('success', '$1'));" },
    
    // Success messages
    { regex: /alert\('([^']*успешно[^']*)'\);/gi, replacement: "showNotification(notificationWithIcon('success', '$1'));" },
    { regex: /alert\(`([^`]*успешно[^`]*)`\);/gi, replacement: "showNotification(notificationWithIcon('success', `$1`));" },
    
    // User/student creation
    { regex: /alert\(`✅ Ученик создан!(.+?)`\);/s, replacement: "showNotification(notificationWithIcon('user', `Ученик создан!$1`));" },
    
    // Warnings
    { regex: /alert\('⚠️ (.+?)'\);/g, replacement: "showNotification(notificationWithIcon('warning', '$1'));" },
    { regex: /alert\(`⚠️ (.+?)`\);/g, replacement: "showNotification(notificationWithIcon('warning', `$1`));" },
    
    // Access denied
    { regex: /alert\('Доступ запрещен\. (.+?)'\);/g, replacement: "showNotification(notificationWithIcon('warning', 'Доступ запрещен. $1'));" },
    
    // Other alert without special markers
    { regex: /alert\(`([^`]+)`\);/g, replacement: "showNotification(notificationWithIcon('warning', `$1`));" },
    { regex: /alert\('([^']+)'\);/g, replacement: "showNotification(notificationWithIcon('warning', '$1'));" },
    { regex: /alert\(([^);]+)\);/g, replacement: "showNotification(notificationWithIcon('warning', $1));" },
];

// Замена confirm на customConfirm с await
const confirmReplacements = [
    // Удаление группы/ученика
    { regex: /if \(!confirm\(`Удалить (.+?)`\)\) \{[\s\S]+?return;[\s\S]+?\}/g, replacement: "if (!await customConfirm(`Удалить $1`, {icon: 'warning'})) { return; }" },
    { regex: /if \(confirm\(`(.+?)`\)\) \{/g, replacement: "if (await customConfirm(`$1`)) {" },
    { regex: /if \(confirm\('(.+?)'\)\) \{/g, replacement: "if (await customConfirm('$1')) {" },
    { regex: /if \(!confirm\('(.+?)'\)\) \{/g, replacement: "if (!await customConfirm('$1', {icon: 'warning'})) {" },
    { regex: /const confirmMsg = (.+?);[\s\S]+?if \(!confirm\(confirmMsg\)\) \{/g, replacement: "const confirmMsg = $1; if (!await customConfirm(confirmMsg)) {" },
];

// Применяем замены
console.log('🔄 Заменяем alert...');
alertReplacements.forEach((replacement, index) => {
    const before = content;
    content = content.replace(replacement.regex, replacement.replacement);
    const matches = (before.match(replacement.regex) || []).length;
    if (matches > 0) {
        alertCount += matches;
        console.log(`  ✓ Замена ${index + 1}: ${matches} совпадений`);
    }
});

console.log('\n🔄 Заменяем confirm...');
confirmReplacements.forEach((replacement, index) => {
    const before = content;
    content = content.replace(replacement.regex, replacement.replacement);
    const matches = (before.match(replacement.regex) || []).length;
    if (matches > 0) {
        confirmCount += matches;
        console.log(`  ✓ Замена ${index + 1}: ${matches} совпадений`);
    }
});

// Добавляем async к функциям, которые теперь используют await customConfirm
const functionsWithConfirm = [
    'deleteGroup',
    'removeStudentFromGroup',
    'deleteClass',
    'cancelClass'
];

functionsWithConfirm.forEach(funcName => {
    const regex = new RegExp(`(function ${funcName}\\([^)]*\\)|async function ${funcName}\\([^)]*\\)|${funcName}\\([^)]*\\) =>)`, 'g');
    content = content.replace(regex, (match) => {
        if (!match.includes('async')) {
            return match.replace('function', 'async function').replace('=>', 'async =>');
        }
        return match;
    });
});

// Сохраняем файл
fs.writeFileSync(filePath, content, 'utf8');

console.log(`\n✅ Готово!`);
console.log(`   Alert заменено: ${alertCount}`);
console.log(`   Confirm заменено: ${confirmCount}`);
console.log(`   Всего: ${alertCount + confirmCount}`);
console.log(`\n📝 Файл сохранен: ${filePath}`);

