import { useEffect, useMemo, useState } from "react";
import { ChevronDown, LogOut, Pencil, Trash2, Trophy, BarChart3, Send } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useNavigate, Link } from "@tanstack/react-router";
import type { UserProfile } from "@/lib/auth-state";
import { signOut } from "@/lib/auth-state";
import { getMyRoles } from "@/lib/roles.functions";

import { Achievements, useAchievements } from "@/components/Achievements";
import {
  getMyPostedGifts,
  getMyReceivedGifts,
  getMyGiftedGifts,
  updateGift,
  deleteGift,
} from "@/lib/cozy.functions";
import { getMyWishes } from "@/lib/wishes.functions";
import { haptic } from "@/lib/haptics";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
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
  onCreateWish?: () => void;
  onOpenWish?: (wishId: string) => void;
  onGive?: () => void;
  onReceive?: () => void;
}


type MyWish = {
  id: string;
  title: string;
  category: string;
  image_url: string | null;
  status: string;
};

export function ProfileTab({ user, onUnreadAchievements, onCreateWish, onOpenWish, onGive, onReceive }: Props) {
  const navigate = useNavigate();
  const [achOpen, setAchOpen] = useState(false);
  const [activity, setActivity] = useState<ActivityKey>("posted");
  const [posted, setPosted] = useState<Gift[] | null>(null);
  const [gifted, setGifted] = useState<TxRow[] | null>(null);
  const [received, setReceived] = useState<TxRow[] | null>(null);
  const [myWishes, setMyWishes] = useState<MyWish[] | null>(null);

  const postedFn = useServerFn(getMyPostedGifts);
  const giftedFn = useServerFn(getMyGiftedGifts);
  const receivedFn = useServerFn(getMyReceivedGifts);
  const myWishesFn = useServerFn(getMyWishes);
  const rolesFn = useServerFn(getMyRoles);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => { rolesFn({}).then((r: any) => setIsAdmin(!!r?.isAdmin)).catch(() => {}); }, [rolesFn]);

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
      const [p, g, r, w] = await Promise.all([postedFn(), giftedFn(), receivedFn(), myWishesFn()]);
      setPosted((p as Gift[]) ?? []);
      setGifted((g as TxRow[]) ?? []);
      setReceived((r as TxRow[]) ?? []);
      setMyWishes((w as MyWish[]) ?? []);
    })();
  }, [postedFn, giftedFn, receivedFn, myWishesFn]);

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
              <HelpPopover
                label="Уровень"
                hint={`Уровень растёт по мере накопления Опыта и открывает новые категории подарков.\n\n1 уровень — 0–199 XP\nДоступно: вещи\n\n2 уровень — 200–499 XP\nОткрывается: услуги, время специалистов, гайды и инфопродукты\n\n3 уровень — 500–999 XP\nОткрывается: мероприятия и совместные активности\n\n4 уровень — 1000–1699 XP\nОткрывается: премиальные подарки и эксклюзивные предложения\n\n5 уровень — 1700–2499 XP\nОткрывается: всё доступно, статус амбассадора сообщества`}
              />
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

      <section className="mb-5 grid grid-cols-2 gap-3">
        <div className="relative rounded-3xl border bg-card p-4 shadow-sm">
          <div className="absolute right-2.5 top-2.5">
            <HelpPopover
              label="Опыт"
              hint={`За каждое действие начисляются баллы Опыта:\n+20 за публикацию подарка\n+10 за бронирование\n+80 за вручённый подарок\n+5 или +20 за отзыв\n+50 за приглашённого друга\n\nОпыт нельзя потратить — он копится и поднимает уровень.`}
            />
          </div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Опыт</p>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-semibold tracking-tight">{user.xp}</span>
            <span className="text-xs text-muted-foreground">XP</span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 text-[10.5px] text-muted-foreground">
            до уровня {user.level + 1}: {Math.max(0, next - user.xp)} XP
          </p>
        </div>
        <div className="relative rounded-3xl border bg-card p-4 shadow-sm">
          <div className="absolute right-2.5 top-2.5">
            <HelpPopover
              label="Подарочные баллы"
              hint={`Подарочные баллы — валюта для получения подарков.\n\nНачисляются:\n+0.2 за публикацию подарка\n+0.8 когда твой подарок принят получателем\n+1 новому другу при регистрации по твоему приглашению (тебе за приглашение идёт только опыт)\n\nСписываются (замораживаются), когда забираешь чужой подарок. Если сделка отменена — балл возвращается.`}
            />
          </div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Баланс</p>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-semibold tracking-tight">{user.balance}</span>
            <span className="text-xs text-muted-foreground">баллов</span>
          </div>
          <p className="mt-3 text-[11px] leading-tight text-muted-foreground">🎁 на новые подарки</p>
        </div>
      </section>


      {/* Пригласить друга — компактно */}
      <InviteButtons userId={user.user_id} />

      {/* Загадать желание CTA */}
      {onCreateWish && (
        <button
          type="button"
          onClick={() => {
            haptic("medium");
            onCreateWish();
          }}
          className="mb-4 flex w-full items-center gap-3 rounded-2xl bg-peach px-4 py-3 text-left text-peach-foreground shadow-sm transition active:scale-[0.98]"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-background/60 backdrop-blur">
            <Sparkles className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-[15px] font-semibold leading-tight">✨ Загадать желание</span>
            <span className="block text-xs opacity-75">−0.2 балла • +10 опыта</span>
          </span>
        </button>
      )}

      {/* Мои желания */}
      <section className="mb-5">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Мои желания</h2>
        {!myWishes ? (
          <Skeleton className="h-16 w-full rounded-2xl" />
        ) : myWishes.length === 0 ? (
          <div className="rounded-2xl border bg-card p-4 text-center text-xs text-muted-foreground">
            Пока не загадано ни одного желания
          </div>
        ) : (
          <ul className="space-y-2">
            {myWishes.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => {
                    haptic("select");
                    onOpenWish?.(w.id);
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left shadow-sm transition active:scale-[0.98]"
                >
                  {w.image_url ? (
                    <img src={w.image_url} alt={w.title} className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-peach/40 text-xl">
                      ✨
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{w.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{w.category}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                    {w.status === "open" ? "ждёт" : w.status === "reserved" ? "в работе" : "исполнено"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Мои подарки */}
      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Мои подарки</h2>
        <div className="mb-3 grid grid-cols-3 gap-1 rounded-2xl border bg-muted/60 p-1">
          {([
            ["posted", "Активные"],
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
            {list.map((g) =>
              activity === "posted" ? (
                <EditableActiveItem
                  key={g.id}
                  gift={g}
                  onUpdated={(patch) =>
                    setPosted((prev) => (prev ?? []).map((x) => (x.id === g.id ? { ...x, ...patch } : x)))
                  }
                  onDeleted={() => setPosted((prev) => (prev ?? []).filter((x) => x.id !== g.id))}
                />
              ) : (
                <li
                  key={g.id}
                  className="flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm"
                >
                  {g.image_url ? (
                    <img src={g.image_url} alt={g.title} className="h-12 w-12 shrink-0 rounded-xl object-cover" />
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
              ),
            )}
          </ul>
        )}
      </section>


      <div className="mt-8 space-y-3">
        {isAdmin && (
          <Link
            to="/insights"
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-indigo-400/40 bg-indigo-500/5 py-3 text-sm font-medium text-indigo-600 transition active:scale-[0.98]"
          >
            <BarChart3 className="h-4 w-4" /> Insights (админ)
          </Link>
        )}
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

function HelpPopover({ label, hint }: { label: string; hint: string }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Подробнее: ${label}`}
        className="text-muted-foreground/80 transition hover:text-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent side="bottom" className="w-72 whitespace-pre-line text-xs leading-relaxed">
        {hint}
      </PopoverContent>
    </Popover>
  );
}

function EditableActiveItem({
  gift,
  onUpdated,
  onDeleted,
}: {
  gift: Gift;
  onUpdated: (patch: Partial<Gift>) => void;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [title, setTitle] = useState(gift.title);
  const [category, setCategory] = useState(gift.category);
  const [description, setDescription] = useState(gift.description ?? "");
  const [saving, setSaving] = useState(false);
  const updateFn = useServerFn(updateGift);
  const deleteFn = useServerFn(deleteGift);
  const canModify = gift.status === "available";

  const handleSave = async () => {
    if (!title.trim() || !category.trim()) {
      toast.error("Заполни название и категорию");
      return;
    }
    setSaving(true);
    try {
      await updateFn({
        data: {
          id: gift.id,
          title: title.trim(),
          category: category.trim(),
          description: description.trim() || null,
        },
      });
      onUpdated({
        title: title.trim(),
        category: category.trim(),
        description: description.trim() || null,
      });
      toast.success("Подарок обновлён ✨");
      setOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("GIFT_IN_DEAL")) toast.error("Нельзя изменить: подарок уже в сделке");
      else toast.error("Не удалось сохранить", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteFn({ data: { id: gift.id } });
      onDeleted();
      toast.success("Подарок удалён");
      setConfirmOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("GIFT_IN_DEAL")) toast.error("Нельзя удалить: подарок уже в сделке");
      else toast.error("Не удалось удалить", { description: msg });
    }
  };

  return (
    <li className="flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm">
      {gift.image_url ? (
        <img src={gift.image_url} alt={gift.title} className="h-12 w-12 shrink-0 rounded-xl object-cover" />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-xl">🎁</div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{gift.title}</p>
        <p className="truncate text-xs text-muted-foreground">{gift.category}</p>
      </div>
      {canModify && (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Редактировать подарок"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            aria-label="Удалить подарок"
            className="flex h-8 w-8 items-center justify-center rounded-md text-destructive transition hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Редактировать подарок</DialogTitle>
            <DialogDescription>Изменения видны сразу всем пользователям</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`g-title-${gift.id}`}>Название</Label>
              <Input id={`g-title-${gift.id}`} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`g-cat-${gift.id}`}>Категория</Label>
              <Input id={`g-cat-${gift.id}`} value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`g-desc-${gift.id}`}>Описание</Label>
              <Textarea
                id={`g-desc-${gift.id}`}
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Отмена
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Сохраняем…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить подарок?</AlertDialogTitle>
            <AlertDialogDescription>
              Подарок «{gift.title}» исчезнет из ленты. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function InviteButtons({ userId }: { userId: string }) {
  const [copied, setCopied] = useState(false);
  const link = `https://podari.lovable.app/?ref=${userId}`;

  const copy = async () => {
    haptic("select");
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Ссылка скопирована 💚", { description: "Другу +1 балл, тебе +50 опыта" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  const shareTg = () => {
    haptic("medium");
    const text = "Привет! Дарю тебе приглашение в «Подари» — уютный сервис подарков 💚\n\nПо этой ссылке тебе сразу зачислится 1 балл, на который ты можешь выбрать любой подарок:";
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    if (typeof window !== "undefined") window.open(url, "_blank");
  };

  return (
    <div className="mb-4 grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={shareTg}
        className="flex items-center justify-center gap-1.5 rounded-2xl bg-lavender px-3 py-2.5 text-xs font-semibold text-lavender-foreground shadow-sm transition active:scale-[0.98]"
      >
        <Send className="h-3.5 w-3.5" /> Пригласить в Telegram
      </button>
      <button
        type="button"
        onClick={copy}
        className="flex items-center justify-center gap-1.5 rounded-2xl border bg-card px-3 py-2.5 text-xs font-semibold shadow-sm transition active:scale-[0.98]"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Скопировано" : "Скопировать ссылку"}
      </button>
    </div>
  );
}


