// Retired: the historical demo seed deletes live accounting data and is not
// compatible with the immutable balance ledger. Do not import any DB client.
console.error('Старое заполнение базы отключено. Для отдельной локальной QA-базы используйте npm run db:seed:qa.');
process.exitCode = 1;
