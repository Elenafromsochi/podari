# Staging проекта «Подари»

## Контуры

| Контур | Сайт | API | Код | Данные |
| --- | --- | --- | --- | --- |
| Production | `https://23podari.ru` | `https://api.23podari.ru` | ветка `main` | `/opt/supabase` |
| Staging | `https://stage.23podari.ru` | `https://api-stage.23podari.ru` | ветка `staging` | `/opt/supabase-staging` |

Staging использует собственные ключи, Postgres, Auth и Storage. Production-секреты
в staging не копируются. Telegram, SMS и фоновые уведомления в staging отключены.

## Обычный процесс

1. Создать рабочую ветку от `staging`.
2. Внести изменение и открыть pull request в `staging`.
3. Дождаться автоматической проверки проекта.
4. После объединения pull request GitHub Actions публикует staging.
5. Проверить результат на `https://stage.23podari.ru`.
6. Для production открыть отдельный pull request из проверенной версии в `main`.
7. Перед production-деплоем выполнить `deploy/backup-production.sh` и получить
   отдельное подтверждение владельца проекта.

## Проверка staging

```bash
systemctl is-active podari-staging
curl -fsSI https://stage.23podari.ru/
curl -fsS https://api-stage.23podari.ru/auth/v1/health
docker ps --filter name=podari-staging
```

## Откат staging

Каждая публикация создаёт отдельный каталог в `/opt/podari-staging/releases`.
Чтобы откатить приложение, переключите симлинк `/opt/podari-staging/current` на
предыдущий каталог и перезапустите `podari-staging`. Production при этом не
изменяется.

## Секреты

Серверные переменные staging находятся в `/etc/podari/staging.env` с правами
`0640`. Ключ публикации хранится в GitHub Actions Secret
`PODARI_STAGING_SSH_KEY`. Значения секретов не добавляются в репозиторий.

