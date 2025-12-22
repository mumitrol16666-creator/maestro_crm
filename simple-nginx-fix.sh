#!/bin/bash
# Простое исправление - отключаем кэш для всех JS файлов

NGINX_CONFIG="/etc/nginx/sites-enabled/lgardens-ip"

# Удаляем бэкапы из sites-enabled (они вызывают ошибку duplicate server)
rm -f /etc/nginx/sites-enabled/*.backup.*

# Убираем js из блока статических файлов
sed -i 's|location ~\* \\.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$|location ~\* \\.(jpg|jpeg|png|gif|ico|css|svg|woff|woff2|ttf|eot)$|' "$NGINX_CONFIG"

# Добавляем отдельный блок для JS БЕЗ кэширования перед блоком статических файлов
sed -i '/# Статические файлы с кешированием/i\
    # JS файлы - НЕ кэшируем (для обновлений)\
    location ~* \\.js$ {\
        add_header Cache-Control "no-cache, no-store, must-revalidate";\
        add_header Pragma "no-cache";\
        add_header Expires "0";\
        expires -1;\
        access_log off;\
    }\
' "$NGINX_CONFIG"

nginx -t && systemctl reload nginx && echo "✅ Готово! JS файлы больше не кэшируются" || echo "❌ Ошибка"
