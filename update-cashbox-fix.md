# Инструкция по обновлению кнопки удаления в кассе

## Проблема
Nginx кэширует JS файлы на 1 год, поэтому браузер может отдавать старые версии файлов.

## Решение

### 1. Обновить файлы на сервере
```bash
# На сервере выполнить:
cd /root/sense-of-dance
git pull origin main
```

### 2. Обновить конфигурацию nginx (если нужно)
```bash
# Скопировать обновленную конфигурацию
sudo cp nginx-optimized.conf /etc/nginx/sites-available/default
# Или если используется другой файл:
# sudo cp nginx-config.conf /etc/nginx/sites-available/default

# Проверить конфигурацию
sudo nginx -t

# Перезагрузить nginx
sudo systemctl reload nginx
```

### 3. Очистить кэш браузера
- Нажать `Ctrl+Shift+R` (Windows/Linux) или `Cmd+Shift+R` (Mac)
- Или открыть DevTools (F12) → Network → включить "Disable cache"

### 4. Проверить версию файла
В консоли браузера проверить, что загружается правильная версия:
```javascript
// Должен быть виден файл с ?v=121
// В Network tab браузера должно быть: cashbox.js?v=121
```

## Альтернативное решение (если не помогает)

Если проблема сохраняется, можно временно отключить кэш для JS файлов:

```nginx
location /js/ {
    add_header Cache-Control "no-cache, must-revalidate";
    expires -1;
}
```

Но это снизит производительность, поэтому лучше использовать версионирование файлов (что уже сделано).
