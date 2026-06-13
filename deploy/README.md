# Деплой Maestro CRM

| Параметр | Значение |
|----------|----------|
| **Домен** | `https://app-maestro-school.duckdns.org` |
| **Путь на сервере** | `/var/www/maestro_crm` |
| **Backend порт** | `5000` (только localhost) |
| **Learning Platform** | `maestro-school.duckdns.org` — **не трогать** |

## Быстрая проверка после деплоя

```bash
curl -fsS http://127.0.0.1:5000/api/health
curl -fsS -o /dev/null https://app-maestro-school.duckdns.org/login.html
pm2 list | grep maestro-crm
```

## Nginx

Конфиг: [nginx-app-maestro-school.conf](./nginx-app-maestro-school.conf)

```bash
cp /var/www/maestro_crm/deploy/nginx-app-maestro-school.conf /etc/nginx/sites-available/maestro-crm
ln -sf /etc/nginx/sites-available/maestro-crm /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d app-maestro-school.duckdns.org
```

## PM2

```bash
cd /var/www/maestro_crm/backend
pm2 start ecosystem.config.js
pm2 save
```

## Подробный чеклист

См. [SERVER_AGENT_HANDOFF.md](../../docs/roadmap/SERVER_AGENT_HANDOFF.md) в корне `Maestro/docs/roadmap/`.
