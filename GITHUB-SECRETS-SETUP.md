# GitHub Secrets — Настройка для автодеплоя

## Перейдите в Settings → Secrets and variables → Actions

Добавьте следующие секреты:

### 1. SERVER_HOST
```
Secret: 65.108.61.178
```

### 2. SERVER_USER
```
Secret: root
```

### 3. SSH_PRIVATE_KEY
```
Вставьте содержимое вашего приватного SSH ключа (~/.ssh/id_ed25519 или ~/.ssh/id_rsa)
Начиная с -----BEGIN OPENSSH PRIVATE KEY----- и заканчивая -----END OPENSSH PRIVATE KEY-----
```

## Как проверить

1. Зайдите на GitHub → ваш репозиторий → Settings → Secrets
2. Убедитесь что SERVER_HOST = `65.108.61.178` (НЕ 149.33.0.114!)
3. Убедитесь что SERVER_USER = `root`
4. Убедитесь что SSH_PRIVATE_KEY содержит приватный ключ

## Подготовка сервера (один раз)

```bash
ssh root@65.108.61.178

# Установить Docker (если не установлен)
curl -fsSL https://get.docker.com | sh

# Установить Docker Compose plugin
apt-get install -y docker-compose-plugin

# Склонировать репозиторий
cd /root
git clone git@github.com:poirtyc/sense.git sense-of-dance

# Создать .env файл для бэкенда
cp sense-of-dance/backend/.env.example sense-of-dance/backend/.env
# Отредактировать .env с реальными значениями
nano sense-of-dance/backend/.env
```
