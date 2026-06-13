const path = require('path');

module.exports = {
  apps: [{
    name: 'maestro-crm-backend',
    script: path.join(__dirname, 'src/server.js'),
    cwd: __dirname,
    instances: 1,
    exec_mode: 'cluster',
    autorestart: true,
    watch: false,
    max_memory_restart: '400M',
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 4000,
    exp_backoff_restart_delay: 100,
    error_file: './logs/maestro-crm-backend-error.log',
    out_file: './logs/maestro-crm-backend-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    kill_timeout: 30000,
    wait_ready: false,
    listen_timeout: 10000
  }]
};
