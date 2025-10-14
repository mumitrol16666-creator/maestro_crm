module.exports = {
  apps: [{
    name: 'sense-of-dance-backend',
    script: './src/server.js',
    cwd: '/root/sense-of-dance/backend',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    env_file: '/root/sense-of-dance/backend/.env',
    error_file: '/root/.pm2/logs/sense-of-dance-backend-error.log',
    out_file: '/root/.pm2/logs/sense-of-dance-backend-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
};

