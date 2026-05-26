import { useEffect, useMemo, useState } from "react";
import { ChevronDown, LogOut, Sparkles, Trophy } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import type { UserProfile } from "@/lib/auth-state";
import { signOut } from "@/lib/auth-state";
import { Achievements, useAchievements } from "@/components/Achievements";
import {
  getMyPostedGifts,
  getMyReceivedGifts,
  getMyGiftedGifts,
} from "@/lib/cozy.functions";
import { haptic } from "@/lib/haptics";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Gift = {
  id: string;
  title: string;
  category: string;
  description: string | null;
  image_url: string | null;
  status: string;
};
type TxRow = { id: string; status: string; gift: Gift | null };
type ActivityKey = "posted" | "gifted" | "received";

// Уровневая шкала из ТЗ кабинета
const LEVEL_THRESHOLDS = [0, 200, 500, 1000, 1700, 2500];
function nextLevelProgress(xp: number, level: number) {
  const cur = LEVEL_THRESHOLDS[level - 1] ?? 0;
  const next = LEVEL_THRESHOLDS[level] ?? cur + 1000;
  const pct = Math.min(100, Math.max(0, ((xp - cur) / (next - cur)) * 100));
  return { pct, next };
}

interface Props {
  user: UserProfile;
  onUnreadAchievements?: (n: number) => void;
}

export function ProfileTab({ user, onUnreadAchievements }: Props) {
  const navigate = useNavigate();
  const [achOpen, setAchOpen] = useState(false);
  const [activity, setActivity] = useState<ActivityKey>("posted");
  const [posted, setPosted] = useState<Gift[] | null>(null);
  const [gifted, setGifted] = useState<TxRow[] | null>(null);
  const [received, setReceived] = useState<TxRow[] | null>(null);

  const postedFn = useServerFn(getMyPostedGifts);
  const giftedFn = useServerFn(getMyGiftedGifts);
  const receivedFn = useServerFn(getMyReceivedGifts);

  const { items: achievements } = useAchievements();
  // «Новые» = открытые, которые пользователь ещё не видел в этой сессии
  const seenKey = "cozy_seen_achievements";
  const unreadAch = useMemo(() => {
    if (typeof window === "undefined") return 0;
    const seen = new Set<string>(JSON.parse(localStorage.getItem(seenKey) || "[]"));
    return achievements.filter((a) => a.unlocked && !seen.has(a.code)).length;
  }, [achievements]);

  useEffect(() => {
    onUnreadAchievements?.(unreadAch);
  }, [unreadAch, onUnreadAchievements]);

  useEffect(() => {
    (async () => {
      const [p, g, r] = await Promise.all([postedFn(), giftedFn(), receivedFn()]);
      setPosted((p as Gift[]) ?? []);
      setGifted((g as TxRow[]) ?? []);
      setReceived((r as TxRow[]) ?? []);
    })();
  }, [postedFn, giftedFn, receivedFn]);

  const toggleAch = () => {
    haptic("select");
    setAchOpen((v) => {
      const next = !v;
      if (next && typeof window !== "undefined") {
        const codes = achievements.filter((a) => a.unlocked).map((a) => a.code);
        localStorage.setItem(seenKey, JSON.stringify(codes));
        onUnreadAchievements?.(0);
      }
      return next;
    });
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success("Вы вышли из аккаунта");
      navigate({ to: "/" });
      if (typeof window !== "undefined") window.location.reload();
    } catch (e) {
      toast.error("Не удалось выйти", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const { pct, next } = nextLevelProgress(user.xp, user.level);

  const giftsFor = (k: ActivityKey): Gift[] => {
    if (k === "posted") return (posted ?? []).filter((g) => g.status !== "gifted");
    if (k === "gifted") return (gifted ?? []).map((t) => t.gift).filter((g): g is Gift => !!g);
    return (received ?? []).map((t) => t.gift).filter((g): g is Gift => !!g);
  };
  const loaded = posted && gifted && received;
  const list = giftsFor(activity);

  const initial = (user.display_name || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="mx-auto w-full max-w-md px-5 pb-6 pt-7">
      {/* Header */}
      <section className="mb-4 rounded-3xl bg-gradient-to-br from-lavender/60 via-peach/40 to-mint/40 p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-background text-2xl font-semibold shadow-sm">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold">{user.display_name}</p>
            {user.telegram_username && (
              <p className="truncate text-xs text-muted-foreground">@{user.telegram_username}</p>
            )}
            <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-background/70 px-2.5 py-1 text-xs font-semibold shadow-sm backdrop-blur">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Уровень {user.level}
            </div>
          </div>
        </div>
      </section>

      {/* Achievements accordion */}
      <section className="mb-4 overflow-hidden rounded-3xl border bg-card shadow-sm">
        <button
          type="button"
          onClick={toggleAch}
          className="flex w-full items-center justify-between px-4 py-3.5 text-left transition active:bg-accent/50"
          aria-expanded={achOpen}
        >
          <span className="flex items-center gap-2 text-[15px] font-semibold">
            <Trophy className="h-4 w-4 text-primary" />
            Мои достижения
            {unreadAch > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground shadow">
                {unreadAch}
              </span>
            )}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform duration-300 ${
              achOpen ? "rotate-180" : ""
            }`}
          />
        </button>
        {achOpen && (
          <div className="achievements-list border-t bg-background/40 p-4">
            <Achievements variant="full" />
          </div>
        )}
      </section>

      {/* Balance widgets */}
      <section className="mb-5 grid grid-cols-2 gap-3">
        <div className="rounded-3xl border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Опыт
          </p>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-semibold tracking-tight">{user.xp}</span>
            <span className="text-xs text-muted-foreground">XP</span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-[10.5px] text-muted-foreground">
            до уровня {user.level + 1}: {Math.max(0, next - user.xp)} XP
          </p>
        </div>
        <div className="rounded-3xl border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Баланс
          </p>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-semibold tracking-tight">{user.balance}</span>
            <span className="text-xs text-muted-foreground">баллов</span>
          </div>
          <p className="mt-3 text-[11px] leading-tight text-muted-foreground">
            🎁 на новые подарки
          </p>
        </div>
      </section>

      {/* Activity sub-tabs */}
      <section>
        <div className="mb-3 grid grid-cols-3 gap-1 rounded-2xl border bg-muted/60 p-1">
          {([
            ["posted", "Выложенные"],
            ["gifted", "Подаренные"],
            ["received", "Полученные"],
          ] as const).map(([k, label]) => {
            const active = activity === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => {
                  if (!active) {
                    haptic("select");
                    setActivity(k);
                  }
                }}
                className={`rounded-xl px-2 py-1.5 text-xs font-medium transition-all duration-300 ${
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {!loaded ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
          </div>
        ) : list.length === 0 ? (
          <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
            {activity === "posted" && "Вы пока не публиковали подарков"}
            {activity === "gifted" && "Пока никому не передали подарок"}
            {activity === "received" && "Вы пока ничего не получили"}
          </div>
        ) : (
          <ul key={activity} className="achievements-list space-y-2">
            {list.map((g) => (
              <li
                key={g.id}
                className="flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm"
              >
                {g.image_url ? (
                  <img
                    src={g.image_url}
                    alt={g.title}
                    className="h-12 w-12 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-xl">
                    🎁
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{g.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{g.category}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-8">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-destructive/40 bg-background py-3 text-sm font-medium text-destructive transition active:scale-[0.98]"
            >
              <LogOut className="h-4 w-4" /> Выйти из аккаунта
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Выйти из аккаунта?</AlertDialogTitle>
              <AlertDialogDescription>
                Сессия будет сброшена. Чтобы вернуться, потребуется снова войти.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction onClick={handleSignOut}>Выйти</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
