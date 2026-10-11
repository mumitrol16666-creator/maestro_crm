const { runAdminCommand, reportCommandError } = require('./src/services/adminAccountMaintenance');

runAdminCommand('reset')
    .then(user => console.log('Администратор обновлён. ID: ' + user.id + '. Пароль не выводится.'))
    .catch(reportCommandError);
