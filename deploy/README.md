# Деплой Maestro — единая схема

Оба проекта на одном VPS (`178.105.59.89`). Общий скрипт:

**`deploy/deploy-maestro-all.sh`** `[all | crm | learning-platform]`

| Проект | Путь на сервере | Домен |
|--------|-----------------|-------|
| CRM | `/var/www/maestro_crm` | `app-maestro-school.duckdns.org` |
| Learning Platform | `/var/www/maestro_school` | `maestro-school.duckdns.org` |

## GitHub Actions

| Репозиторий | Workflow | Push в `main` | Ручной запуск |
|-------------|----------|---------------|---------------|
| `maestro_crm` | `deploy.yml` | CRM | all / crm / learning-platform |
| `maestro_school` | `deploy.yml` | Learning Platform | learning-platform / all |

Оба workflow вызывают **один** скрипт на сервере (лежит в `maestro_crm/deploy/`).
Для Learning Platform скрипт сначала определяет точный SHA ветки `main`,
скачивает immutable tarball этого SHA и передаёт одинаковую версию в API,
frontend и PWA service worker.

### Secret (в обоих репозиториях)

| Secret | Описание |
|--------|----------|
| `SSH_PRIVATE_KEY` | SSH-ключ `root@178.105.59.89:14579` |

Learning Platform: дополнительные secrets (`JWT_SECRET`, `POSTGRES_PASSWORD`, …) **больше не нужны в CI** — `.env` уже на сервере.

## Ручной деплой на VPS

```bash
cd /var/www/maestro_crm
git pull
bash deploy/deploy-maestro-all.sh all        # оба проекта
bash deploy/deploy-maestro-all.sh crm        # только CRM
bash deploy/deploy-maestro-all.sh learning-platform
```

## Через Cursor

Напиши **«деплой»** — commit + push → CI выкатит.

**«деплой всё»** — ручной workflow с target `all` в GitHub Actions.

## Проверка

```bash
curl http://127.0.0.1:5000/api/health   # CRM
curl http://127.0.0.1:4000/health         # Learning Platform
git ls-remote https://github.com/mumitrol16666-creator/maestro_school.git \
  refs/heads/main
curl -fsS https://maestro-school.duckdns.org/login \
  | grep -o 'name="maestro-release" content="[^"]*"'
```

`releaseSha` из Learning Platform health, HTML meta `maestro-release` и SHA
`maestro_school/main` должны совпадать. Deployment завершается с ошибкой при
несовпадении API и frontend.
