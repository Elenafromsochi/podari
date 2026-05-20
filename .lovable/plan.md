# Перевод CozyGift на реальный бэкенд

Цель: убрать localStorage из бизнес-логики, чтобы два пользователя могли тестировать сервис одновременно из разных браузеров. Все подарки, баллы, опыт и сделки — в базе.

## 1. Авторизация по телефону

Lovable Cloud поддерживает phone-auth, но для отправки реальных SMS нужен Twilio (платно). Поэтому делаем в два этапа:

- **Этап A (сейчас, без денег).** Оставляем экран ввода телефона и 4-значного кода. На бэкенде создаём пользователя через email-обвязку: `<phone>@phone.cozygift.local` + сгенерированный пароль, который шифруется и хранится у пользователя локально (как «pin»). Код подтверждения генерится сервером и показывается в тост-уведомлении (как сейчас), но факт регистрации пишется в `auth.users` Lovable Cloud — два разных браузера = два разных аккаунта.
- **Этап B (когда подключите Twilio).** Меняем серверную функцию `sendOtp` на реальный вызов Supabase phone-auth. Фронтенд не трогаем.

При первом входе создаётся запись в `profiles` через триггер `on_auth_user_created`. Поле `display_name` берётся из формы регистрации, баланс = 100.

## 2. Профиль и игровые поля в базе

Уже есть таблица `profiles` с полями `balance`, `xp`, `level`. Добавляем:
- триггер `handle_new_user` — создаёт строку `profiles` при регистрации с балансом 100;
- индекс по `user_id`;
- хелпер `recalc_level(xp)` — уровень = `floor(xp/200)+1` (правило обсудим позже, сейчас используем формулу-заглушку).

Фронтенд читает профиль из `profiles`, а не из localStorage.

## 3. Серверные операции (TanStack server functions)

Все мутации — через `createServerFn` с `requireSupabaseAuth`. Никаких прямых клиентских insert/update в `gifts`/`transactions`/`profiles`.

- `publishGift({ title, description, category, image_url })` — insert в `gifts` с `owner_id = auth.uid()`, `status='available'`, `cost=100`. Начисляет `+20 xp` владельцу.
- `claimGift({ gift_id })` — атомарно (RPC `claim_gift` в Postgres):
  - проверка `profiles.balance >= 100` у получателя, иначе ошибка `INSUFFICIENT_BALANCE`;
  - проверка `gifts.status='available'` и `owner_id != auth.uid()`, иначе `ALREADY_TAKEN`;
  - списать 100 у получателя (заморозка);
  - `UPDATE gifts SET status='reserved'`;
  - `INSERT transactions (sender=owner, receiver=auth.uid, amount=100, status='pending')`;
  - создать `chats` запись между дарителем и получателем;
  - вернуть `{ transaction_id, chat_id }`.
- `confirmHandover({ transaction_id })` — вызывает получатель (RPC `confirm_handover`):
  - `transactions.status='completed'`;
  - `gifts.status='gifted'`;
  - **+100 баллов дарителю** (перевод замороженных, как выбрали);
  - `+80 xp` дарителю, `+20 xp` получателю;
  - пересчёт `level` обеих сторон.
- `submitReview({ transaction_id, rating, comment })` — insert в `reviews`, `+20 xp` автору.

Все RPC — `SECURITY DEFINER` с явной проверкой `auth.uid()` внутри, чтобы атомарно обновлять чужие профили (баланс дарителя).

## 4. Чат

Таблица `messages` уже есть с RLS «участники чата видят сообщения». Realtime-подписка через `supabase.channel('messages').on('postgres_changes',...)`. Включить публикацию `messages` в `supabase_realtime`.

## 5. Личный кабинет — только из базы

`/cabinet` загружает через server functions:
- `myProfile()` → имя, баланс, опыт, уровень;
- `myPostedGifts()` → `gifts where owner_id = me`;
- `myReceivedGifts()` → `transactions where receiver_id = me` join `gifts`;
- `myGiftedGifts()` → `transactions where sender_id = me and status='completed'`.

localStorage-стейт `game-state.ts` остаётся только для UX-онбординга (текущий шаг визарда), без бизнес-данных.

## 6. План работ

1. Миграция: триггер на создание `profiles`, RPC `claim_gift`, `confirm_handover`, включить realtime.
2. `auth-state.ts` → переписать на Lovable Cloud auth (этап A: phone→email-обвязка).
3. `AuthFlow.tsx` оставить как UI, поменять только вызовы.
4. `GiveGiftForm.onDone` → вызов `publishGift`.
5. `ReceiveGiftFlow.onPick` + диалог нехватки баллов → вызов `claimGift`, обработка ошибок.
6. `ChatScreen` → realtime-подписка, кнопка «подтвердить вручение» → `confirmHandover`.
7. `cabinet.tsx` → переписать на server functions.
8. Убрать XP/balance из localStorage; считать с сервера.
9. Проверить два браузера: published-URL открыть в обычном Chrome и в инкогнито, зарегистрировать двух пользователей, провести цикл публикация → получение → подтверждение → отзыв.

## Что я хочу подтвердить перед стартом

- **Phone-auth этап A** (моковый код в тосте, реальные аккаунты в БД) — ок?
- **Display name** при регистрации сейчас не запрашивается; добавить поле «Как тебя зовут?» — ок?
- **Уровень**: пока формула `floor(xp/200)+1`, потом настроим — ок?
