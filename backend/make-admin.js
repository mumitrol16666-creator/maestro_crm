// Role changes belong to the authenticated super-admin workflow. A shared
// phone is not a unique account identifier. Do not import any DB client.
console.error('Изменяйте роль по конкретной карточке в CRM под супер-администратором. Для первого аккаунта используйте create-super-admin.js с явными реквизитами.');
process.exitCode = 1;
