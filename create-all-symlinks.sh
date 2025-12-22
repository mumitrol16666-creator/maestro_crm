#!/bin/bash
# Создание символических ссылок для всех необходимых файлов

BASE_DIR="/var/www/lgardens.ru"
ADMIN_DIR="$BASE_DIR/admin"

echo "=== Создание символических ссылок ==="

# Создаем директории если их нет
mkdir -p "$BASE_DIR/js"
mkdir -p "$BASE_DIR/css"

# Создаем ссылки для JS файлов
if [ -f "$ADMIN_DIR/js/admin.js" ]; then
    ln -sf "$ADMIN_DIR/js/admin.js" "$BASE_DIR/js/admin.js"
    echo "✅ admin.js"
fi

# Создаем ссылки для CSS файлов
for css_file in "$ADMIN_DIR/css"/*.css; do
    if [ -f "$css_file" ]; then
        filename=$(basename "$css_file")
        ln -sf "$css_file" "$BASE_DIR/css/$filename"
        echo "✅ $filename"
    fi
done

# Проверяем доступность
echo "=== Проверка доступности ==="
curl -s -o /dev/null -w "admin.js: %{http_code}\n" http://localhost/js/admin.js
curl -s -o /dev/null -w "admin-styles.css: %{http_code}\n" http://localhost/css/admin-styles.css 2>/dev/null || echo "admin-styles.css: не найден"

echo "✅ Готово!"
