# Фикс ошибки «This page didn't load»

## Что произошло

После добавления Telegram Login Widget главная страница `/` падает с клиентской ошибкой:

```
Module "crypto" has been externalized for browser compatibility.
Cannot access "crypto.createHash" in client code.
  at src/lib/telegram-widget.functions.ts:3
```

Файл `telegram-widget.functions.ts` импортируется в `AuthFlow.tsx` (через `useServerFn(widgetSignIn)` / `useServerFn(widgetCompleteRegistration)`). Сплиттер TanStack должен был удалить серверные импорты (`crypto`, `client.server`, `@supabase/supabase-js`) из клиентского бандла, но не смог — потому что в файле помимо двух `createServerFn` лежат «толстые» хелперы на модульном уровне (`verifyWidgetSignature`, `signRegistrationTicket`, `verifyRegistrationTicket`, `userEmail`, `userPassword`, `anonClient`, `rememberTrustedDevice`, `issueMagicLink`, `safeEqualHex`). Правило стека: `.functions.ts` должен содержать **только** декларации server-fn и их импорты.

## Исправление

### 1. Создать `src/lib/telegram-widget.server.ts`

Расширение `.server.ts` — жёсткая граница: бандлер откажется тянуть этот файл в клиентский бандл. Туда переезжают все хелперы и серверные импорты:

- `crypto` (`createHash`, `createHmac`, `timingSafeEqual`)
- `@supabase/supabase-js` (`createClient` для `anonClient`)
- `@/integrations/supabase/client.server` (`supabaseAdmin`)
- константы (`TRUSTED_DAYS`, `WIDGET_AUTH_MAX_AGE_SEC`, `REG_TICKET_TTL_MS`)
- функции: `userEmail`, `userPassword`, `anonClient`, `safeEqualHex`, `verifyWidgetSignature`, `signRegistrationTicket`, `verifyRegistrationTicket`, `rememberTrustedDevice`, `issueMagicLink`

### 2. Оставить `src/lib/telegram-widget.functions.ts` тонким

Файл содержит только:

- `import { createServerFn } from "@tanstack/react-start"`
- `import { z } from "zod"`
- `import { ... } from "./telegram-widget.server"` (только то, что нужно внутри `.handler()`)
- `widgetPayloadSchema` (zod-схема — безопасна для клиента)
- две декларации `createServerFn`: `widgetSignIn` и `widgetCompleteRegistration`

Внутри `.handler()` всё то же, только вызовы хелперов теперь импортируются из `.server.ts`.

### 3. Что НЕ трогаем

- `AuthFlow.tsx` — импорты `widgetSignIn`/`widgetCompleteRegistration` остаются как есть.
- `TelegramLoginButton.tsx` — без изменений.
- Поведение виджета, набор полей, текст, шаг `tg_register`, RLS, миграции — всё без изменений.

## Проверка

- Перезагрузить `/` в превью — ошибка про `crypto` должна исчезнуть, страница рендерится.
- Внутри handler-функций логика та же → flow Telegram-виджета и регистрации не меняется.
