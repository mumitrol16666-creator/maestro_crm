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
| `maestro_crm` | `deploy.yml` | только проверки | all / crm / learning-platform |
| `maestro_school` | `deploy.yml` | только проверки | learning-platform / all |

Оба workflow вызывают **один** скрипт на сервере (лежит в `maestro_crm/deploy/`).
Workflow передает SHA коммита репозитория, который запустил выкладку. Для второго
репозитория единый скрипт сначала фиксирует текущий полный SHA `main`, скачивает
immutable tarball этого SHA и передает одинаковую версию в API, frontend и PWA.

### Secret (в обоих репозиториях)

| Secret | Описание |
|--------|----------|
| `SSH_PRIVATE_KEY` | SSH-ключ `root@178.105.59.89:14579` |

Learning Platform: дополнительные secrets (`JWT_SECRET`, `POSTGRES_PASSWORD`, …) **больше не нужны в CI** — `.env` уже на сервере.

## Ручной деплой на VPS

Перед ручным запуском зафиксируйте полные 40-символьные SHA обоих проверенных
коммитов. Не используйте `git pull` как команду релиза.

```bash
cd /var/www/maestro_crm
git fetch https://github.com/mumitrol16666-creator/maestro_crm.git main
git reset --hard <crm-commit-sha>
chmod +x deploy/deploy-maestro-all.sh deploy/deploy.sh

CRM_RELEASE_SHA_OVERRIDE=<crm-commit-sha> \
LP_RELEASE_SHA_OVERRIDE=<learning-commit-sha> \
bash deploy/deploy-maestro-all.sh all
```

Для одного проекта используйте ту же схему с целью `crm` или
`learning-platform` и соответствующей переменной SHA.

## Важное поведение push

Push в `main` запускает проверки, но не production-деплой. После успешной
проверки обоих репозиториев вручную запустите workflow CRM с целью `all`.
Так оба заранее проверенных проекта выкладываются одной управляемой операцией.

Полный checklist, backup и rollback: `docs/MAESTRO_FINAL_DEPLOYMENT_2026-08-31.md`.

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
