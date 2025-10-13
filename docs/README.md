# SENSE OF DANCE 🖤💗

> **Креативный одностраничный сайт для танцевальной студии с черно-розовой палитрой**

<p align="center">
  <img src="https://img.shields.io/badge/Status-Ready-ff0080?style=for-the-badge" />
  <img src="https://img.shields.io/badge/HTML5-0a0a0a?style=for-the-badge&logo=html5" />
  <img src="https://img.shields.io/badge/CSS3-0a0a0a?style=for-the-badge&logo=css3" />
  <img src="https://img.shields.io/badge/JavaScript-0a0a0a?style=for-the-badge&logo=javascript" />
</p>

---

## 🎨 О ПРОЕКТЕ

Ультрасовременный сайт для танцевальной студии **[@senseof_dance](https://www.instagram.com/senseof_dance/)** с уникальным креативным дизайном.

### Дизайн-концепция

- **Цветовая палитра**: Черный (#0a0a0a), Белый (#ffffff), Розовый (#ff0080)
- **Типографика**: Space Grotesk + Bebas Neue
- **Стиль**: Минималистичный, дерзкий, современный
- **Вдохновение**: Брутализм + швейцарский дизайн + нью-вейв

---

## ✨ УНИКАЛЬНЫЕ ФИЧИ

### 🎯 Интерактивность
- **Кастомный курсор** с плавным следованием и магнитным эффектом
- **Полноэкранное меню** с крупной типографикой
- **Parallax эффекты** на всех секциях
- **Магнитные кнопки** реагирующие на движение мыши
- **3D tilt эффект** на карточках цен
- **Анимированные счетчики** статистики
- **Прогресс бар прокрутки** вверху страницы

### 🎬 Анимации
- Loader при загрузке страницы
- Последовательное появление элементов при скролле
- Hover эффекты с трансформациями
- Плавные переходы между секциями
- Текст с эффектом "reveal"
- Подсветка текущего дня недели в расписании

### 🎪 Дизайн-решения
- **Крупная типографика** — заголовки до 10rem
- **Контурный текст** — outline эффект на hero
- **Минимализм форм** — только линии и границы
- **Числовая навигация** — 01, 02, 03...
- **Mix-blend-mode** для навигации
- **Нестандартные сетки** — асимметричные раскладки

---

## 📂 СТРУКТУРА

```
sense-of-dance/
│
├── index.html          # Основная структура
├── styles.css          # Все стили
├── script.js           # Интерактивность
├── .gitignore          # Git ignore
└── README.md           # Документация
```

---

## 🎯 СЕКЦИИ САЙТА

### 01 — ГЛАВНАЯ (HERO)
Полноэкранная секция с:
- Крупным контурным заголовком
- Анимированным фоном
- Кнопкой CTA с hover эффектом
- Индикатором прокрутки

### 02 — О СТУДИИ
- Статистика с анимированными счетчиками (8+, 500+, 15+, 6)
- 4 блока преимуществ с иконками
- Крупный текст-описание
- Двухколоночная сетка

### 03 — НАПРАВЛЕНИЯ
- 6 танцевальных стилей
- Крупные заголовки с числами
- Hover эффекты с розовым цветом
- Описание и информация о возрасте/уровне

### 04 — РАСПИСАНИЕ
- 7 дней недели в сетке
- Подсветка текущего дня
- Время и название классов
- Hover эффект со сдвигом

### 05 — КОМАНДА
- 4 преподавателя
- Фото с цветным оверлеем
- Hover эффекты
- Имя, специализация, био

### 06 — АБОНЕМЕНТЫ
- 3 тарифа (Пробное, 8 занятий, Безлимит)
- Центральная карточка выделена
- 3D tilt эффект при наведении
- Крупные цены

### 07 — КОНТАКТЫ
- Форма записи с минималистичным дизайном
- Автоформатирование телефона
- Контактная информация
- Ссылки на соцсети

---

## 🚀 ЗАПУСК

### Простейший способ
```bash
# Откройте файл в браузере
open index.html
```

### С локальным сервером
```bash
# Python
python3 -m http.server 8000

# Node.js
npx http-server -p 8000

# VS Code Live Server
# Установите расширение и запустите
```

Откройте: `http://localhost:8000`

---

## 🎨 КАСТОМИЗАЦИЯ

### Цвета

В `styles.css` измените переменные:
```css
:root {
    --black: #0a0a0a;      /* Основной фон */
    --white: #ffffff;      /* Текст */
    --pink: #ff0080;       /* Акцент */
    --pink-light: #ff66b2; /* Светлый акцент */
    --pink-dark: #cc0066;  /* Темный акцент */
}
```

### Шрифты

Текущие:
- **Space Grotesk** — основной текст
- **Bebas Neue** — заголовки

Смените в `<head>`:
```html
<link href="https://fonts.googleapis.com/css2?family=ВАШ_ШРИФТ&display=swap" rel="stylesheet">
```

И в CSS:
```css
:root {
    --font-main: 'ВАШ_ШРИФТ', sans-serif;
    --font-display: 'ВАШ_ШРИФТ_ЗАГОЛОВОК', sans-serif;
}
```

### Контент

#### Обновить контакты
В секции `#contact` замените:
- Адрес
- Телефон
- Email
- Время работы

#### Изменить расписание
В секции `#schedule` отредактируйте блоки `.schedule-day-block`

#### Добавить фото
Замените `.member-photo` и `.direction-hover-img` на:
```html
<div class="member-photo" style="background-image: url('images/photo.jpg'); background-size: cover;">
```

---

## 📧 ФОРМА ОБРАТНОЙ СВЯЗИ

### Текущее состояние
Форма выводит данные в консоль браузера.

### Интеграция с Formspree
```javascript
// В script.js замените функцию отправки:
contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(contactForm);
    
    try {
        const response = await fetch('https://formspree.io/f/YOUR_ID', {
            method: 'POST',
            body: formData,
            headers: { 'Accept': 'application/json' }
        });
        
        if (response.ok) {
            showNotification('Спасибо! Ваша заявка отправлена.');
            contactForm.reset();
        }
    } catch (error) {
        showNotification('Ошибка отправки.');
    }
});
```

### Интеграция с Telegram
```javascript
const TELEGRAM_BOT_TOKEN = 'YOUR_BOT_TOKEN';
const TELEGRAM_CHAT_ID = 'YOUR_CHAT_ID';

const sendToTelegram = async (data) => {
    const message = `
📩 Новая заявка!
👤 Имя: ${data.name}
📞 Телефон: ${data.phone}
💃 Направление: ${data.direction}
    `;
    
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: message
        })
    });
};
```

---

## 🌐 РАЗВЕРТЫВАНИЕ

### GitHub Pages
```bash
# 1. Создайте репозиторий на GitHub
# 2. Загрузите файлы
git init
git add .
git commit -m "Initial commit"
git remote add origin YOUR_REPO_URL
git push -u origin main

# 3. Settings → Pages → Source: main branch
# Сайт будет доступен: username.github.io/repo-name
```

### Netlify
1. Перейдите на [netlify.com](https://netlify.com)
2. Drag & drop папку проекта
3. Готово! Получите URL

### Vercel
```bash
npm install -g vercel
vercel
```

### Обычный хостинг
1. Загрузите все файлы по FTP
2. Убедитесь что `index.html` в корне
3. Настройте домен

---

## 📊 АНАЛИТИКА

### Google Analytics
В `<head>` добавьте:
```html
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'GA_ID');
</script>
```

### Яндекс.Метрика
```html
<script type="text/javascript">
   (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
   m[i].l=1*new Date();
   for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
   k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
   (window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
   ym(COUNTER_ID, "init", {
        clickmap:true,
        trackLinks:true,
        accurateTrackBounce:true
   });
</script>
```

---

## 🛠️ ТЕХНИЧЕСКИЙ СТЕК

| Технология | Использование |
|------------|---------------|
| **HTML5** | Семантическая разметка |
| **CSS3** | Grid, Flexbox, Custom Properties, Animations, Mix-blend-mode |
| **JavaScript ES6+** | Intersection Observer, Custom Events, Debouncing |
| **Google Fonts** | Space Grotesk, Bebas Neue |

---

## ⚡ ОПТИМИЗАЦИЯ

### Производительность
- ✅ Debounced scroll events
- ✅ Intersection Observer вместо scroll listeners
- ✅ CSS transitions вместо JS анимаций где возможно
- ✅ Минимум библиотек (только vanilla JS)

### SEO
- ✅ Семантический HTML
- ✅ Meta теги
- ✅ Alt теги для изображений
- ✅ Структурированные данные (можно добавить)

### Accessibility
- ✅ Keyboard navigation
- ✅ Focus states
- ✅ ARIA labels
- ✅ Semantic HTML
- ✅ ESC закрывает меню

---

## 📱 АДАПТИВНОСТЬ

Полностью адаптивный дизайн для:
- 📱 Мобильные (320px - 768px)
- 📱 Планшеты (768px - 1024px)
- 💻 Десктоп (1024px+)
- 🖥️ Large displays (1440px+)

Breakpoints:
- `max-width: 1024px` — планшеты
- `max-width: 768px` — мобильные

---

## 🎯 ОСОБЕННОСТИ ДИЗАЙНА

### Что делает этот сайт уникальным?

1. **Кастомный курсор** — невидимый системный курсор заменен на розовую точку с кругом
2. **Mix-blend-mode навигация** — инверсия цвета навигации при наложении
3. **Полноэкранное меню** — не dropdown, а полный экран с крупной типографикой
4. **Контурный текст** — `-webkit-text-stroke` для эффекта outline
5. **Числовая система** — каждая секция имеет номер 01, 02, 03...
6. **Магнитные элементы** — кнопки "притягиваются" к курсору
7. **3D tilt** — карточки наклоняются при движении мыши
8. **Минимализм форм** — только линии, никаких фонов
9. **Статистика с счетчиками** — числа анимированно увеличиваются
10. **Прогресс скролла** — розовая линия вверху страницы

---

## 🎨 ВДОХНОВЕНИЕ

Дизайн вдохновлен:
- Brutalist web design
- Swiss typography
- 80s/90s rave culture
- Awwwards winning sites
- Modern creative agencies

---

## 📋 ЧЕКЛИСТ ЗАПУСКА

Перед публикацией убедитесь:

- [ ] Обновлены все контактные данные
- [ ] Добавлены реальные фотографии
- [ ] Настроена форма обратной связи
- [ ] Добавлена аналитика (GA / Метрика)
- [ ] Проверена адаптивность на всех устройствах
- [ ] Протестированы все ссылки
- [ ] Оптимизированы изображения
- [ ] Настроен SSL (HTTPS)
- [ ] Добавлен favicon
- [ ] Проверен в разных браузерах

---

## 🐛 ИЗВЕСТНЫЕ ОСОБЕННОСТИ

### Кастомный курсор
Работает только на десктопах. На мобильных автоматически скрывается.

### Mix-blend-mode
В некоторых старых браузерах может не работать. Graceful degradation — навигация просто будет обычного цвета.

### Анимации
Учтены `prefers-reduced-motion` для пользователей с настройками accessibility.

---

## 🤝 ПОДДЕРЖКА

Если нужна помощь:
- 📧 Email: support@senseofdance.ru
- 💬 Telegram: [@senseofdance](https://t.me/senseofdance)
- 📱 Instagram: [@senseof_dance](https://www.instagram.com/senseof_dance/)

---

## 📄 ЛИЦЕНЗИЯ

Проект создан специально для студии Sense of Dance.  
Свободно используйте и модифицируйте код для своих нужд.

---

## 🎁 БОНУСЫ

### Дополнительные фишки которые можно добавить:

1. **Карта**
```html
<iframe src="https://yandex.ru/map-widget/..." width="100%" height="400"></iframe>
```

2. **Видео background**
```html
<video autoplay loop muted playsinline class="hero-video">
  <source src="video.mp4" type="video/mp4">
</video>
```

3. **Instagram Feed**
Используйте [Curator.io](https://curator.io) или [Juicer](https://www.juicer.io)

4. **Онлайн-запись**
Интеграция с [Yclients](https://yclients.com) или [Mindbody](https://www.mindbodyonline.com)

---

## 🚀 СЛЕДУЮЩИЕ ШАГИ

1. ✅ Замените градиенты на реальные фото
2. ✅ Настройте отправку формы
3. ✅ Добавьте Google Analytics
4. ✅ Оптимизируйте изображения
5. ✅ Добавьте favicon
6. ✅ Настройте meta теги для соцсетей (Open Graph)
7. ✅ Добавьте карту с адресом
8. ✅ Интегрируйте систему онлайн-записи

---

<p align="center">
  <strong>СОЗДАНО С 🖤 ДЛЯ SENSE OF DANCE</strong><br>
  <em>Почувствуй танец • Feel the Dance</em>
</p>

---

## 💡 FAQ

**Q: Почему курсор не работает на моем устройстве?**  
A: Кастомный курсор работает только на десктопах с мышью. На тачскринах он автоматически скрывается.

**Q: Как изменить розовый цвет на другой?**  
A: Измените `--pink: #ff0080` в начале `styles.css` на любой HEX код.

**Q: Можно ли использовать этот дизайн для другого бизнеса?**  
A: Да! Просто замените контент и логотип.

**Q: Сайт работает в Safari?**  
A: Да, протестирован в Safari, Chrome, Firefox, Edge.

**Q: Как добавить больше языков?**  
A: Создайте `en.html`, `de.html` и т.д. с переведенным контентом.

---

**🎉 Готово! Танцуйте и наслаждайтесь!**
