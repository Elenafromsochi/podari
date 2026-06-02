import { Link } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import type { UserProfile } from "@/lib/auth-state";
import { LevelBadge } from "@/components/LevelBadge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface Props {
  user: UserProfile | null;
  unreadChats?: number;
  onMessagesClick?: () => void;
}

const LEVEL_THRESHOLDS = [0, 200, 500, 1000, 1700, 2500];

function levelProgress(xp: number, level: number) {
  const lo = LEVEL_THRESHOLDS[Math.max(0, level - 1)] ?? 0;
  const hi = LEVEL_THRESHOLDS[Math.min(LEVEL_THRESHOLDS.length - 1, level)] ?? lo + 500;
  const pct = Math.max(0, Math.min(100, ((xp - lo) / Math.max(1, hi - lo)) * 100));
  return { pct, toNext: Math.max(0, hi - xp) };
}

const LEVEL_RULES = `Опыт (XP) копится за каждое действие и поднимает уровень. Чем выше уровень — тем больше категорий подарков открыто.

Начисление опыта:
+20 за публикацию подарка
+10 за бронирование
+80 за вручённый подарок
+5 или +20 за отзыв
+50 за приглашённого друга

Подарочные баллы — валюта для получения подарков:
+0.2 за публикацию
+0.8 когда твой подарок принят
+1 другу за регистрацию по приглашению

Уровни:
1 уровень · 0–199 XP — вещи
2 уровень · 200–499 XP — + услуги/время
3 уровень · 500–999 XP — + кофе/обед, события, желания
4 уровень · 1000–1699 XP — премиальные подарки
5 уровень · 1700–2499 XP — амбассадор сообщества`;

export function AppHeader({ user, unreadChats = 0, onMessagesClick }: Props) {
  if (!user) return null;
  const initial = (user.display_name || "?").trim().charAt(0).toUpperCase();
  const { pct, toNext } = levelProgress(user.xp, user.level);

  return (
    <header
      className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-xl"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-2.5">
        <Link
          to="/cabinet"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-peach text-base font-semibold text-peach-foreground shadow-sm"
          aria-label="Личный кабинет"
        >
          {initial}
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold leading-tight">
              {user.display_name}
            </span>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="shrink-0 rounded-full transition active:scale-95"
                  aria-label="Правила уровней и опыта"
                >
                  <LevelBadge level={user.level} />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="bottom"
                align="start"
                className="w-72 whitespace-pre-line text-[11.5px] leading-relaxed"
              >
                <p className="mb-2 text-xs font-semibold text-foreground">
                  ⭐ {user.level} уровень · до следующего {toNext} XP
                </p>
                {LEVEL_RULES}
              </PopoverContent>
            </Popover>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="shrink-0 text-[10.5px] font-medium text-muted-foreground">
              {user.xp} XP
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 rounded-xl bg-mint/50 px-2 py-1 text-mint-foreground">
          <span className="text-sm">🎁</span>
          <span className="text-[13px] font-semibold tabular-nums">
            {Number(user.balance).toFixed(1)}
          </span>
        </div>

        <button
          type="button"
          onClick={onMessagesClick}
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground transition hover:bg-accent"
          aria-label="Чаты"
        >
          <MessageCircle className="h-5 w-5" />
          {unreadChats > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground ring-2 ring-background">
              {unreadChats > 9 ? "9+" : unreadChats}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
