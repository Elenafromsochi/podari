import { Link } from "@tanstack/react-router";
import { HelpCircle } from "lucide-react";
import type { UserProfile } from "@/lib/auth-state";
import { LevelBadge } from "@/components/LevelBadge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface Props {
  user: UserProfile | null;
}

const LEVEL_THRESHOLDS = [0, 200, 500, 1000, 1700, 2500];

function levelProgress(xp: number, level: number) {
  const lo = LEVEL_THRESHOLDS[Math.max(0, level - 1)] ?? 0;
  const hi = LEVEL_THRESHOLDS[Math.min(LEVEL_THRESHOLDS.length - 1, level)] ?? lo + 500;
  const pct = Math.max(0, Math.min(100, ((xp - lo) / Math.max(1, hi - lo)) * 100));
  return { pct, toNext: Math.max(0, hi - xp) };
}

const LEVELS_INFO = `Уровни открывают новые категории подарков и желаний.

1 уровень · 0–199 XP — вещи
2 уровень · 200–499 XP — + услуги и время
3 уровень · 500–999 XP — + кофе/обед, события, желания
4 уровень · 1000–1699 XP — премиальные подарки
5 уровень · 1700+ XP — амбассадор сообщества`;

const XP_INFO = `Опыт (XP) копится за активность в сервисе и поднимает уровень.

+20 за публикацию подарка
+10 за бронирование
+80 за вручённый подарок
+5 или +20 за отзыв
+50 за приглашённого друга`;

const BALANCE_INFO = `Подарочные баллы — внутренняя валюта, за которую можно получать подарки.

Баланс увеличивается при пополнении, размещении подарков и их вручении, а также снижается при получении подарков.`;

function InfoDot({ label, content }: { label: string; content: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition hover:text-foreground active:scale-95"
          aria-label={label}
        >
          <HelpCircle className="h-3 w-3" strokeWidth={2.25} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-72 whitespace-pre-line text-[11.5px] leading-relaxed"
      >
        <p className="mb-1.5 text-xs font-semibold text-foreground">{label}</p>
        {content}
      </PopoverContent>
    </Popover>
  );
}

export function AppHeader({ user }: Props) {
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
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold leading-tight">
              {user.display_name}
            </span>
            <LevelBadge level={user.level} />
            <InfoDot label={`Уровни · до следующего ${toNext} XP`} content={LEVELS_INFO} />
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
            <InfoDot label="Опыт (XP)" content={XP_INFO} />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 rounded-xl bg-mint/50 px-2 py-1 text-mint-foreground">
          <span className="text-sm">🎁</span>
          <span className="text-[13px] font-semibold tabular-nums">
            {Number(user.balance).toFixed(1)}
          </span>
          <InfoDot label="Подарочные баллы" content={BALANCE_INFO} />
        </div>
      </div>
    </header>
  );
}
