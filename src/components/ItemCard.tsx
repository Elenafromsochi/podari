import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Share2 } from "lucide-react";
import { LevelBadge } from "@/components/LevelBadge";
import { Stars } from "@/components/ui/stars";

/**
 * ЕДИНАЯ карточка подарка/желания на всё приложение. Один визуальный стиль
 * везде: лента, профиль, экран публикации, желания. Меняем стиль здесь — он
 * меняется сразу во всех местах.
 *
 * Всё специфичное (кнопка «Получить», «Открыть/Скрыть», «Редактировать/Удалить»
 * и т.п.) передаётся слотом `footer` — карточка выглядит одинаково, а поведение
 * остаётся своим для каждого места. Тап по фото/тексту вызывает `onOpen`.
 */
export function ItemCard({
  image,
  title,
  description,
  cost,
  condition,
  category,
  ownerName,
  ownerId,
  ownerLevel,
  city,
  isOnline,
  meta,
  badge,
  onOpen,
  onShare,
  footer,
  highlight = false,
  emptyEmoji = "🎁",
}: {
  image?: string | null;
  title: string;
  description?: string | null;
  cost?: number | null;
  condition?: number | null;
  category?: string | null;
  ownerName?: string | null;
  ownerId?: string | null;
  ownerLevel?: number | null;
  city?: string | null;
  isOnline?: boolean | null;
  /** Доп. подпись в мета-строке (например, «5 мин назад»). */
  meta?: string | null;
  /** Бейдж-статус (например, «🌌 Скрыто»). */
  badge?: ReactNode;
  /** Тап по фото/заголовку — открыть подробнее. */
  onOpen?: () => void;
  /** Плавающая кнопка «Поделиться» в углу (если задана). */
  onShare?: () => void;
  /** Кнопки действий под карточкой (получить / редактировать / удалить и т.п.). */
  footer?: ReactNode;
  /** Подсветить карточку (например, скрытое желание). */
  highlight?: boolean;
  emptyEmoji?: string;
}) {
  const costWord = (n: number) => (n === 1 ? "балл" : n < 5 ? "балла" : "баллов");

  return (
    <div
      className={`relative rounded-2xl border p-3 shadow-sm ${
        highlight ? "border-primary/40 bg-primary/5" : "bg-card"
      }`}
    >
      <div className="flex gap-3">
        {/* Фото — тап открывает подробнее */}
        <button
          type="button"
          onClick={onOpen}
          disabled={!onOpen}
          aria-label={onOpen ? "Открыть" : undefined}
          className="h-16 w-16 shrink-0 overflow-hidden rounded-xl"
        >
          {image ? (
            <img src={image} alt={title} loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-muted text-2xl">
              {emptyEmoji}
            </span>
          )}
        </button>

        <div className="min-w-0 flex-1">
          {/* Заголовок + цена — тап по заголовку открывает подробнее */}
          <div className="flex items-start justify-between gap-2 pr-7">
            <button
              type="button"
              onClick={onOpen}
              disabled={!onOpen}
              className="min-w-0 flex-1 text-left"
            >
              <span className="line-clamp-2 block text-sm font-medium leading-tight">{title}</span>
            </button>
            {cost != null && (
              <span className="shrink-0 rounded-lg bg-mint/70 px-2 py-0.5 text-[12px] font-semibold leading-tight text-mint-foreground">
                {cost} {costWord(cost)}
              </span>
            )}
          </div>

          {condition ? (
            <div className="mt-0.5 text-sm leading-none">
              <Stars value={condition} />
            </div>
          ) : null}

          {description ? (
            <p className="mt-0.5 line-clamp-1 break-words text-xs text-muted-foreground">
              {description}
            </p>
          ) : null}

          {/* Мета-строка: владелец (ссылка на профиль), уровень, категория, город */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {ownerName ? (
              ownerId ? (
                <Link
                  to="/user/$userId"
                  params={{ userId: ownerId }}
                  className="rounded-lg bg-lavender/70 px-2 py-0.5 text-[12px] font-semibold text-lavender-foreground transition active:scale-95"
                >
                  {ownerName}
                </Link>
              ) : (
                <span className="rounded-lg bg-lavender/70 px-2 py-0.5 text-[12px] font-semibold text-lavender-foreground">
                  {ownerName}
                </span>
              )
            ) : null}
            {ownerLevel != null ? <LevelBadge level={ownerLevel} /> : null}
            {category ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                {category}
              </span>
            ) : null}
            {isOnline ? (
              <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground">
                🌐 Онлайн
              </span>
            ) : city ? (
              <span className="rounded-full bg-peach/40 px-2 py-0.5 text-[10px] font-medium text-foreground">
                📍 {city}
              </span>
            ) : null}
            {meta ? <span>· {meta}</span> : null}
          </div>

          {badge ? <div className="mt-1.5">{badge}</div> : null}
        </div>
      </div>

      {onShare ? (
        <button
          type="button"
          onClick={onShare}
          aria-label="Поделиться"
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm ring-1 ring-border transition hover:text-foreground active:scale-95"
        >
          <Share2 className="h-3.5 w-3.5" />
        </button>
      ) : null}

      {footer ? <div className="mt-3">{footer}</div> : null}
    </div>
  );
}
