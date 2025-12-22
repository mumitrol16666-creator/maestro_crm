#!/bin/bash
# Скрипт для обновления файлов кассы на сервере

# Проверяем путь из nginx конфигурации
FRONTEND_PATH=$(grep 'root' /etc/nginx/sites-enabled/* 2>/dev/null | grep -v '#' | head -1 | awk '{print $2}' | sed 's|;||')

# Если не найден, ищем в стандартных местах
if [ -z "$FRONTEND_PATH" ] || [ ! -d "$FRONTEND_PATH" ]; then
  FRONTEND_PATH=$(find /root /home /var/www -type d -name 'frontend' 2>/dev/null | head -1)
fi

# Если все еще не найден, используем /var/www/lgardens.ru
if [ -z "$FRONTEND_PATH" ] || [ ! -d "$FRONTEND_PATH" ]; then
  if [ -d "/var/www/lgardens.ru" ]; then
    FRONTEND_PATH="/var/www/lgardens.ru"
  fi
fi

echo "Найденный путь: $FRONTEND_PATH"

if [ -z "$FRONTEND_PATH" ] || [ ! -d "$FRONTEND_PATH" ]; then
  echo "ERROR: Frontend не найден"
  exit 1
fi

echo "Копирование файлов в: $FRONTEND_PATH"

# Проверяем структуру директорий
if [ -d "$FRONTEND_PATH/js/modules/cashbox" ]; then
  # Стандартная структура
  mkdir -p "$FRONTEND_PATH/js/modules/cashbox"
  cp /tmp/cashbox.js "$FRONTEND_PATH/js/modules/cashbox/cashbox.js"
  chmod 644 "$FRONTEND_PATH/js/modules/cashbox/cashbox.js"
  echo "✅ cashbox.js обновлен"
elif [ -d "$FRONTEND_PATH/admin/js/modules/cashbox" ]; then
  # Структура с admin
  mkdir -p "$FRONTEND_PATH/admin/js/modules/cashbox"
  cp /tmp/cashbox.js "$FRONTEND_PATH/admin/js/modules/cashbox/cashbox.js"
  chmod 644 "$FRONTEND_PATH/admin/js/modules/cashbox/cashbox.js"
  echo "✅ cashbox.js обновлен (admin)"
else
  # Создаем структуру
  mkdir -p "$FRONTEND_PATH/js/modules/cashbox"
  cp /tmp/cashbox.js "$FRONTEND_PATH/js/modules/cashbox/cashbox.js"
  chmod 644 "$FRONTEND_PATH/js/modules/cashbox/cashbox.js"
  echo "✅ cashbox.js обновлен (создана структура)"
fi

# Обновляем admin.html - ищем существующий файл
if [ -f "$FRONTEND_PATH/admin/admin.html" ]; then
  cp /tmp/admin.html "$FRONTEND_PATH/admin/admin.html"
  chmod 644 "$FRONTEND_PATH/admin/admin.html"
  echo "✅ admin.html обновлен (admin/admin.html)"
elif [ -f "$FRONTEND_PATH/public/admin.html" ]; then
  cp /tmp/admin.html "$FRONTEND_PATH/public/admin.html"
  chmod 644 "$FRONTEND_PATH/public/admin.html"
  echo "✅ admin.html обновлен (public/admin.html)"
elif [ -d "$FRONTEND_PATH/admin" ]; then
  cp /tmp/admin.html "$FRONTEND_PATH/admin/admin.html"
  chmod 644 "$FRONTEND_PATH/admin/admin.html"
  echo "✅ admin.html обновлен (admin - создан)"
elif [ -d "$FRONTEND_PATH/public" ]; then
  cp /tmp/admin.html "$FRONTEND_PATH/public/admin.html"
  chmod 644 "$FRONTEND_PATH/public/admin.html"
  echo "✅ admin.html обновлен (public - создан)"
else
  mkdir -p "$FRONTEND_PATH/admin"
  cp /tmp/admin.html "$FRONTEND_PATH/admin/admin.html"
  chmod 644 "$FRONTEND_PATH/admin/admin.html"
  echo "✅ admin.html обновлен (создана структура admin)"
fi

echo "✅ Файлы обновлены успешно"
ls -lh "$FRONTEND_PATH/js/modules/cashbox/cashbox.js"

# Проверяем версию в admin.html
if [ -f "$FRONTEND_PATH/admin/admin.html" ]; then
  echo "Версия cashbox.js в admin.html:"
  grep -o 'cashbox.js?v=[0-9]*' "$FRONTEND_PATH/admin/admin.html" | head -1
  ls -lh "$FRONTEND_PATH/admin/admin.html"
  echo "Проверка содержимого cashbox.js (первые строки):"
  head -5 "$FRONTEND_PATH/js/modules/cashbox/cashbox.js" | grep -E "(loadPayments|renderPayments|🔵|🚀)" || echo "Логи не найдены в начале файла"
elif [ -f "$FRONTEND_PATH/public/admin.html" ]; then
  echo "Версия cashbox.js в admin.html:"
  grep -o 'cashbox.js?v=[0-9]*' "$FRONTEND_PATH/public/admin.html" | head -1
  ls -lh "$FRONTEND_PATH/public/admin.html"
  echo "Проверка содержимого cashbox.js (первые строки):"
  head -5 "$FRONTEND_PATH/js/modules/cashbox/cashbox.js" | grep -E "(loadPayments|renderPayments|🔵|🚀)" || echo "Логи не найдены в начале файла"
fi

# Перезагружаем nginx для сброса кэша
echo "Перезагрузка nginx..."
systemctl reload nginx 2>/dev/null || service nginx reload 2>/dev/null || echo "Не удалось перезагрузить nginx"
echo "✅ Nginx перезагружен"

# Очищаем кэш nginx (если есть)
if [ -d "/var/cache/nginx" ]; then
    rm -rf /var/cache/nginx/*
    echo "✅ Кэш nginx очищен"
fi

# Проверяем, что файлы действительно обновлены
echo "=== Проверка файлов ==="
if [ -f "$FRONTEND_PATH/js/modules/cashbox/cashbox.js" ]; then
    echo "Размер cashbox.js: $(wc -c < "$FRONTEND_PATH/js/modules/cashbox/cashbox.js") байт"
    echo "Содержит логи: $(grep -c 'cashbox.js загружен' "$FRONTEND_PATH/js/modules/cashbox/cashbox.js" || echo 'НЕТ')"
fi
