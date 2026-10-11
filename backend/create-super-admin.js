const { runAdminCommand, reportCommandError } = require('./src/services/adminAccountMaintenance');

runAdminCommand('create')
    .then(user => console.log('Администратор создан. ID: ' + user.id + '. Пароль не выводится.'))
    .catch(reportCommandError);
