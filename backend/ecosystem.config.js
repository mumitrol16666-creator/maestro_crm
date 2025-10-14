module.exports = {
  apps: [{
    name: 'sense-of-dance-backend',
    script: './src/server.js',
    cwd: '/root/sense-of-dance/backend',
    instances: 1,
    exec_mode: 'cluster',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    // Настройки автоматического перезапуска
    max_restarts: 10,              // Максимум 10 рестартов подряд
    min_uptime: '10s',             // Минимум 10 сек работы = успешный старт
    restart_delay: 4000,           // 4 сек задержка между рестартами
    exp_backoff_restart_delay: 100, // Экспоненциальная задержка
    // Логирование
    error_file: '/root/.pm2/logs/sense-of-dance-backend-error.log',
    out_file: '/root/.pm2/logs/sense-of-dance-backend-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    // Переменные окружения
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    env_file: '/root/sense-of-dance/backend/.env',
    // Graceful shutdown
    kill_timeout: 5000,
    wait_ready: false,
    listen_timeout: 10000
  }]
};

