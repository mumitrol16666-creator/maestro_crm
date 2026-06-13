# Деплой Maestro CRM

| Параметр | Значение |
|----------|----------|
| **Домен** | `https://app-maestro-school.duckdns.org` |
| **Путь на сервере** | `/var/www/maestro_crm` |
| **Backend порт** | `5000` (только localhost) |
| **GitHub** | `mumitrol16666-creator/maestro_crm` |
| **Learning Platform** | `maestro-school.duckdns.org` — **не трогать** |

## Автодеплой (CI)

При `git push` в ветку `main` запускается `.github/workflows/deploy.yml`:

1. **verify** — `prisma validate`, syntax-check backend и `admin.js`
2. **deploy** — SSH на VPS: `git pull` → `deploy/deploy.sh` → PM2 restart

### GitHub Secrets (обязательно)

| Secret | Описание |
|--------|----------|
| `SSH_PRIVATE_KEY` | Приватный SSH-ключ для `root@178.105.59.89:14579` |

**Важно:** secret нужно добавить **в репозиторий `maestro_crm`**, а не только в Learning Platform. Это разные репозитории — секреты не копируются автоматически.

Как добавить:
1. GitHub → `mumitrol16666-creator/maestro_crm` → **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret** → имя `SSH_PRIVATE_KEY`
3. Value — полный приватный ключ (начинается с `-----BEGIN ... PRIVATE KEY-----`)

Если workflow падает за ~2 секунды на шаге deploy — почти всегда этот secret не задан.

Секреты CRM (`backend/.env`) **не в GitHub** — живут только на сервере. CI их не перезаписывает.

### Ручной запуск

GitHub → Actions → **Deploy CRM to VPS** → **Run workflow**

## Скрипт на сервере

`deploy/deploy.sh` выполняет:

```bash
npm ci --omit=dev
npx prisma generate && npx prisma db push
pm2 restart maestro-crm-backend
curl http://127.0.0.1:5000/api/health
```

Перед CI на сервере должны быть:

- git-репозиторий в `/var/www/maestro_crm`
- `backend/.env` с `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`
- PM2 процесс `maestro-crm-backend`
- nginx для `app-maestro-school.duckdns.org`

## Nginx

Конфиг: [nginx-app-maestro-school.conf](./nginx-app-maestro-school.conf)

## Первый деплой (один раз)

См. [SERVER_AGENT_HANDOFF.md](../../docs/roadmap/SERVER_AGENT_HANDOFF.md)

## Локальный деплой через Cursor

```
деплой
```

→ commit → `git push maestro main` → CI сам выкатит (или SSH pull вручную).
