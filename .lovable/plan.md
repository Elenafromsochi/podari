
# Telegram Login Widget (A+B) — план

Добавляем кнопку «Войти через Telegram» как ускоритель поверх существующей формы `@username` + пароль. Текущий флоу (пароль + 4-значный код в боте на новых устройствах) полностью сохраняется.

## Что увидит пользователь

**На экране входа `/` (AuthFlow):**
```
┌─────────────────────────────────────┐
│   [ Войти через Telegram (виджет) ] │   ← 1 клик, синяя кнопка от Telegram
│                                     │
│   ─────────── или ───────────       │
│                                     │
│   @username  [_______________]      │   ← текущая форма
│   Пароль     [_______________]      │
│   ☑ Запомнить устройство на 30 дн.  │
│   [        Войти        ]           │
│                                     │
│   Забыл пароль / войти через бота   │
└─────────────────────────────────────┘
```

**На preview-домене** (где виджет не активен):
- Виджет скрыт, показывается мягкая плашка *«Быстрый вход через Telegram доступен на podari.lovable.app»*
- Форма пароля полностью рабочая → 95% флоу тестируется без проблем

**Регистрация через виджет (новый пользователь):**
1. Жмёт кнопку → Telegram спрашивает разрешение → возвращает на сайт
2. Открывается экран-подтверждение:
   - Имя (предзаполнено из Telegram, редактируется)
   - `@username` (из Telegram, неред.)
   - Поле «Придумай пароль» (≥8 символов, для входа без Telegram)
   - Кнопка «Зарегистрироваться»
3. Внутри сервиса. Дальше может заходить и кнопкой, и `@username`+пароль.

**Вход через виджет (существующий пользователь):**
- Telegram → проверка подписи → находим профиль по `telegram_id` → сразу внутрь сервиса, без 2FA-кода, устройство автоматически добавляется в trusted на 30 дней.

## Что нужно от тебя (один раз)

1. Зайти в `@BotFather` → `/mybots` → выбрать `@Podari_podarki_bot`
2. `Bot Settings` → `Domain` → вписать `podari.lovable.app`

Когда позже подключим кастомный домен — придём сюда и заменим.

## Технические детали

### База данных
- Миграция: добавить уникальный индекс `profiles(telegram_id)` (если ещё нет), индекс по `lower(telegram_username)` уже есть.
- Никаких новых таблиц — `trusted_devices` и `profiles` уже всё содержат.

### Server route: проверка подписи виджета
- `src/routes/api/public/telegram/widget-auth.ts` — POST endpoint
- Принимает payload от Telegram Login Widget (`id`, `first_name`, `username`, `photo_url`, `auth_date`, `hash`)
- Проверяет HMAC-SHA256 подпись с использованием sha256(BOT_TOKEN) как ключа — это стандартный механизм Telegram, защищает от подделки
- Проверяет `auth_date` (не старше 24 часов)
- Получает `telegram_id` (raw bot token нужен для верификации подписи)

### Получение bot token
- Сейчас в проекте есть `TELEGRAM_API_KEY` от Lovable-коннектора (используется для отправки сообщений через gateway)
- Для проверки подписи виджета нужен **сырой Bot Token** из BotFather (не Lovable API key)
- Через `add_secret` запрошу у тебя `TELEGRAM_BOT_TOKEN` отдельным секретом
- Этот же токен будет нужен в `<script>` виджета (`data-telegram-login="Podari_podarki_bot"` — публичный username бота, не токен; токен только на сервере)

### Server function: вход/регистрация через виджет
`src/lib/telegram-widget.functions.ts`:
- `widgetSignIn({ payload, device_id, device_label })` — проверяет подпись через `/api/public/telegram/widget-auth`, ищет профиль по `telegram_id`:
  - **Найден** → создаёт сессию через `supabaseAdmin.auth.admin.generateLink` или внутренний механизм, добавляет устройство в trusted, возвращает токены
  - **Не найден** → возвращает `{ status: 'need_registration', telegram_data: {...} }` (имя, username, telegram_id, photo_url) — данные подписаны коротким JWT/HMAC от сервера, чтобы клиент не мог их подделать
- `widgetCompleteRegistration({ signed_telegram_data, display_name, password, device_id, device_label })` — проверяет подпись, создаёт `auth.users` через `supabaseAdmin`, ставит пароль, заполняет `profiles`, добавляет trusted device, возвращает токены

### Frontend компоненты
- `src/components/TelegramLoginButton.tsx` — обёртка над `<script async src="https://telegram.org/js/telegram-widget.js?22">` с `data-telegram-login`, `data-onauth` колбэком. Скрипт грузится один раз, callback вешается на window.
- Проверка домена на клиенте: если `window.location.hostname !== 'podari.lovable.app'` → не рендерим виджет, показываем плашку.
- Обновление `src/components/AuthFlow.tsx`:
  - На шаге `intro` сверху — `<TelegramLoginButton />`, ниже разделитель «или», ниже текущие кнопки
  - Новый шаг `tg_register` — экран «Подтверди данные» с полями имя + пароль
  - Callback виджета → `widgetSignIn` → либо вход, либо `tg_register`

### Безопасность
- Подпись виджета проверяется на сервере перед любыми действиями (HMAC-SHA256 по стандарту Telegram)
- `auth_date` ≤ 86400 секунд (защита от replay старых подписей)
- На шаге регистрации `telegram_data` передаются с серверной HMAC-подписью, чтобы клиент не мог зарегистрировать чужой `telegram_id`
- Пароль валидируется тем же zod-схемой (≥8, ≤128), HIBP уже включён
- Никаких изменений в RLS-политиках

### Что НЕ меняем
- Текущий флоу: пароль + код в боте на новом устройстве — работает как есть
- `/set-password` для миграции старых юзеров — без изменений
- Реферальная логика, баланс, XP — без изменений
- Webhook бота для 4-значных кодов — без изменений
- `trusted_devices`, `device_login_codes` — без изменений

## Файлы

**Создать:**
- `src/components/TelegramLoginButton.tsx`
- `src/lib/telegram-widget.functions.ts`
- `src/routes/api/public/telegram/widget-auth.ts` (либо переиспользовать одну точку в server fn)
- Миграция: уникальный индекс на `profiles.telegram_id` (если ещё нет)

**Изменить:**
- `src/components/AuthFlow.tsx` — добавить виджет на шаге `intro`, новый шаг `tg_register`

**Секрет:**
- `TELEGRAM_BOT_TOKEN` — попрошу через add_secret сразу после старта

## Acceptance

- На `podari.lovable.app`: видна кнопка «Login with Telegram», существующий юзер заходит за 1 клик, новый — через экран «Подтверди данные»
- На preview: виджет скрыт, плашка-объяснение, форма пароля работает
- На любом домене: вход по `@username` + пароль работает как раньше
- Все RLS-политики и `auth.users` неизменны для существующих пользователей
