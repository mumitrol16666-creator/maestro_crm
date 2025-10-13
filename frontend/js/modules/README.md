# Модульная структура админ-панели

## 📁 Структура модулей

### Core модули (`core/`)
Базовые функции, используемые во всей админ-панели:

- **`api.js`** (110 строк) - API функции, токены, роли
  - `API_URL` - URL API
  - `getAuthToken()`, `getUserRole()`, `getUserId()`, `getUserName()`
  - `isSuperAdmin()`, `isAdmin()`
  - `apiGet()`, `apiPost()`, `apiPatch()`, `apiDelete()`

- **`utils.js`** (208 строк) - Утилиты и форматирование
  - `copyToClipboard()` - копирование в буфер
  - `customConfirm()` - кастомные confirm диалоги
  - `getDeclension()` - склонение существительных
  - `formatSchedule()`, `formatDate()`, `formatDateTime()`
  - `getStatusText()`, `getRoleText()`, `getRoleNameShort()`
  - `getMembershipClass()` - класс для badge абонемента

- **`theme.js`** (44 строки) - Управление темой
  - `initTheme()` - инициализация светлой/темной темы
  - Обработчик переключения темы

- **`data.js`** (74 строки) - Загрузка данных с сервера
  - `fetchBookings()`, `fetchStudents()`, `fetchGroups()`, `fetchDirections()`

- **`sidebar.js`** (134 строки) - Управление видимостью sidebar
  - `applySidebarVisibility()` - применение прав видимости
  - `initUserManagement()` - инициализация
  - `displayCurrentUser()` - отображение пользователя

- **`sections.js`** (82 строки) - Управление загрузкой разделов
  - `loadSectionData()` - ленивая загрузка разделов
  - `refreshCurrentSection()` - обновление текущего раздела
  - `invalidateCache()` - сброс кэша

### Feature модули (`*/`)
Логика отдельных разделов админ-панели:

- **`dashboard/dashboard.js`** (158 строк) - Дашборд
  - `fetchStats()`, `renderDashboard()`
  - `updateNewBookingsBadge()`, `updatePendingAttendanceBadge()`

- **`directions/directions.js`** (195 строк) - Направления
  - `renderDirections()`, `editDirection()`, `deleteDirection()`
  - Обработчик формы направления

- **`permissions/permissions.js`** (256 строк) - Права ролей
  - `loadRolesData()`, `togglePermission()`, `resetPermissionsToDefault()`
  - `renderPermissionsTable()`, `renderVisibilityTable()`

## 📊 Статистика

- **Модулей создано**: 9
- **Строк в модулях**: 1261
- **admin.js**: 4064 строки (было 5170, -21.4%)
- **Размер**: 173KB (было 214KB, -19.2%)

## 🔄 Порядок загрузки

Модули загружаются в HTML в следующем порядке:

1. `config.js` - конфигурация
2. `script.js` - общие функции
3. FullCalendar библиотека
4. **Core модули** (api → utils → theme → data → sidebar → sections)
5. **Feature модули** (dashboard → directions → permissions)
6. `admin.js` - главный файл

## ✅ Преимущества модульной структуры

- **Производительность**: Браузер кэширует модули отдельно
- **Поддержка**: Легче найти и изменить нужный код
- **Читаемость**: Каждый модуль отвечает за свою функциональность
- **Масштабируемость**: Легко добавлять новые модули
