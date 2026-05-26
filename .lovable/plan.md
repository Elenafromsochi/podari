Премиум dark-режим админ-панель `/cabinet/insights` для создателя с метриками LETS-экономики, списком пользователей, виджетом спящих и Telegram-рассылкой.

## 1. Роли и доступ (БД)

Migration:
- enum `public.app_role` со значениями `admin`, `user`.
- Таблица `public.user_roles (id, user_id, role, created_at)` с уникальным `(user_id, role)`, RLS включён, политика SELECT для `authenticated` только своих ролей.
- Security-definer функция `public.has_role(_user_id uuid, _role app_role)` (по стандарту проекта — роли НЕ в `profiles`).
- Добавление колонки `profiles.last_seen_at timestamptz` (для метрики спящих).
- Серверная функция `public.touch_last_seen()` — обновляет `last_seen_at = now()` для `auth.uid()`.
- INSERT твоего `user_id` в `user_roles` со значением `admin` (отдельный шаг — попрошу твой telegram_username/email, чтобы найти).

## 2. Серверный слой

`src/integrations/supabase/admin-middleware.ts` — middleware `requireAdmin`, наследует `requireSupabaseAuth` и дополнительно проверяет `has_role(userId, 'admin')`, иначе 403.

`src/lib/admin.functions.ts` — единая точка для админ-данных:
- `getAdminOverview()` — один большой DTO со всеми метриками (ниже).
- `getAdminUsers({ page, search, onlySleeping })` — пагинированный список юзеров.
- `getSleepingUsers()` — список спящих 3+ дней (для экспорта и рассылки).
- `exportSleepingCsv()` — возвращает CSV-строку.
- `sendTelegramBroadcast({ userIds, text, parseMode })` — рассылка через шлюз Telegram.

`src/lib/last-seen.functions.ts` — `touchLastSeen()`, вызывает `public.touch_last_seen()`. Дёргается из `AppShell` при маунте и раз в 5 минут.

Все запросы используют `supabaseAdmin` (после прохождения `requireAdmin`).

## 3. Метрики в `getAdminOverview()`

Экономика:
- **Баллов в резерве (escrow)**: `SUM(amount) FROM transactions WHERE status='pending'`.
- **Эмиссия авансов**: `COUNT(gifts) * 0.2` (по текущей логике триггера `award_publish_xp`).
- **Средняя стоимость дара в ленте**: `AVG(cost) FROM gifts WHERE status='available'`.
- **Подарков в ленте**: `COUNT(*) WHERE status='available'`.
- **Завершённых сделок (всего / 7д / 30д)**.
- **Отменённых сделок (7д)**.
- **Среднее время `claim → confirm_handover`** (минуты/часы).

Активность:
- **DAU / WAU / MAU** на базе `profiles.last_seen_at`.
- **Спящие 3+ дней**: count и список.
- **Новые регистрации за 14 дней** — массив для sparkline.

Воронка:
- Зарегистрировались → опубликовали 1+ подарок → получили 1+ → подарили 1+ (4 числа).

Топы:
- Топ-10 дарителей за 30д (по `transactions` со `status='completed'`).
- Топ-10 получателей за 30д.
- Топ-10 рефереров (по `profiles.referred_by`).

## 4. UI

Новый защищённый роут `src/routes/_authenticated/cabinet.insights.tsx` (имя нейтральное, без «admin»). На странице — собственный dark-контейнер (классы скоупом на корень страницы, не трогая глобальную тему — пастельный лайт остального приложения сохраняется).

Структура страницы (mobile-first, но с desktop-аккуратной таблицей):

1. **Шапка**: «Insights», период (7д / 30д / всё), кнопка обновления.
2. **Сетка KPI-плиток** (адаптив 2 → 3 → 4 кол.): Баллов в резерве, Эмиссия авансов, Средняя цена дара, Подарков в ленте, DAU, WAU, Новые за 7д, Отменено за 7д. Микро-анимации появления (`blur-reveal`).
3. **Виджет «Спящие (3+ дня)»** — крупный, акцентный. Количество + кнопка `📥 Экспорт CSV` + кнопка `📣 Отправить пуш в Telegram`.
4. **Воронка** — 4 этапа с числами и процентами.
5. **График новых регистраций** — простой sparkline (SVG, без библиотек).
6. **Три карточки топов** — дарители / получатели / рефереры.
7. **Таблица пользователей** с колонками: Имя, @username, Уровень, XP, Баланс, Последняя активность. На мобиле — карточки. Подсветка row мягко-красным фоном если `last_seen_at > 3 дней`. Поиск по имени, фильтр «только спящие», пагинация по 50.

Точка входа — скрытая ссылка в `ProfileTab` (видна только если `has_role admin`).

## 5. Telegram-рассылка

Модалка «Отправить пуш в Telegram» открывается из виджета спящих:
- Поле «Аудитория»: радио — все спящие 3+ / выбранные вручную (из таблицы) / все пользователи.
- Textarea с текстом сообщения (поддержка HTML, превью).
- Чекбокс «Добавить кнопку «Открыть приложение»» с deep-link на published URL.
- Кнопка «Отправить» → вызывает `sendTelegramBroadcast`.

Серверная реализация `sendTelegramBroadcast`:
- Загружает `telegram_id` для указанных `user_id` из `profiles` (только те, у кого `telegram_id IS NOT NULL`).
- Для каждого делает POST `${GATEWAY_URL}/sendMessage` через connector gateway (`LOVABLE_API_KEY` + `TELEGRAM_API_KEY` из env).
- Лимит на размер аудитории за раз — 500. Батч по 25/сек, чтобы не словить rate limit Telegram (30 msg/sec для бота).
- Логирует результат: `{ sent, failed, errors[] }`. Возвращает агрегат + примеры ошибок.

## 6. CSV-экспорт

`exportSleepingCsv()` возвращает строку, клиент собирает `Blob`, генерит ссылку и скачивает. Колонки: `telegram_id, telegram_username, display_name, days_inactive, last_seen_at`. Файл — `sleeping_users_YYYY-MM-DD.csv`.

## 7. Что НЕ делаем в этом шаге

- Не меняем существующую экономику (триггеры `award_publish_xp`, `confirm_handover` остаются как есть — 0.2 / 0.8 фиксированные).
- Не добавляем realtime — обновление раз в 60 сек + ручной refresh.
- Не делаем редактирование пользователей из админки (бан/смена баланса) — отдельной задачей.

## Технические детали (для меня)

- Файлы: 1 migration, 2 `.functions.ts`, 1 middleware, 1 route file, ~5 компонентов админки (KpiTile, SleepingWidget, FunnelChart, Sparkline, UsersTable, BroadcastDialog).
- Dark-тема скоупом на роут: обёртка с локальными переменными вроде `--admin-bg`, `--admin-surface`, `--admin-text` поверх существующих токенов, без глобального override.
- `attachSupabaseAuth` в `src/start.ts` уже подключён (проверю), чтобы `requireAdmin` получал bearer.
- Все агрегаты — параллельный `Promise.all` внутри `getAdminOverview` для скорости.

## Уточнение перед запуском

Чтобы добавить тебя в `user_roles` админом, нужен один из идентификаторов — скажи свой **telegram_username** (как в профиле в приложении) или email, под которым ты заходишь. Без этого первый запуск `/cabinet/insights` вернёт 403 даже у тебя.
