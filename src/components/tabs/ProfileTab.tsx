import { useEffect, useMemo, useState } from "react";
import { ChevronDown, LogOut, Pencil, Trash2, Trophy, BarChart3, Send, Sparkles, Share2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { useNavigate, Link } from "@tanstack/react-router";
import type { UserProfile } from "@/lib/auth-state";
import { signOut } from "@/lib/auth-state";
import { getMyRoles } from "@/lib/roles.functions";

import { Achievements, useAchievements } from "@/components/Achievements";
import {
  getMyPostedGifts,
  getMyReceivedGifts,
  getMyGiftedGifts,
  getMyChats,
  updateGift,
  deleteGift,
} from "@/lib/cozy.functions";
import { getMyWishes } from "@/lib/wishes.functions";
import { INVITE_VARIANTS, giftShareVariants } from "@/lib/random-copy";
import { InviteShareSheet } from "@/components/InviteShareSheet";
import { FirstSteps } from "@/components/FirstSteps";
import { APP_VERSION } from "@/lib/version";
import { haptic } from "@/lib/haptics";
import { Skeleton } from "@/components/ui/skeleton";

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
type BookedItem = {
  transaction_id: string;
  gift_id: string;
  gift_title: string;
  gift_image: string | null;
  other_name: string;
};
type ActivityKey = "posted" | "gifted" | "received" | "booked";

// Правила XP/уровней теперь живут в поповере на верхней плашке (AppHeader).


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
  const [booked, setBooked] = useState<BookedItem[] | null>(null);
  const [myWishes, setMyWishes] = useState<MyWish[] | null>(null);

  const postedFn = useServerFn(getMyPostedGifts);
  const giftedFn = useServerFn(getMyGiftedGifts);
  const receivedFn = useServerFn(getMyReceivedGifts);
  const chatsFn = useServerFn(getMyChats);
  const myWishesFn = useServerFn(getMyWishes);
  const rolesFn = useServerFn(getMyRoles);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => { rolesFn({}).then((r: any) => setIsAdmin(!!r?.isAdmin)).catch(() => {}); }, [rolesFn]);

  const { items: achievements } = useAchievements();
  // «Новые» = открытые, которые пользователь ещё не видел
  const seenKey = "cozy_seen_achievements";
  const [seenVersion, setSeenVersion] = useState(0);
  const unreadAch = useMemo(() => {
    if (typeof window === "undefined") return 0;
    const seen = new Set<string>(JSON.parse(localStorage.getItem(seenKey) || "[]"));
    return achievements.filter((a) => a.unlocked && !seen.has(a.code)).length;
    // seenVersion в зависимостях — чтобы счётчик пересчитался после «просмотрено»
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [achievements, seenVersion]);

  useEffect(() => {
    onUnreadAchievements?.(unreadAch);
  }, [unreadAch, onUnreadAchievements]);

  useEffect(() => {
    (async () => {
      const [p, g, r, w, c] = await Promise.all([
        postedFn(), giftedFn(), receivedFn(), myWishesFn(), chatsFn(),
      ]);
      setPosted((p as Gift[]) ?? []);
      setGifted((g as TxRow[]) ?? []);
      setReceived((r as TxRow[]) ?? []);
      setMyWishes((w as MyWish[]) ?? []);
      // Забронированные = активные сделки, где я получатель (чаты с дарителями)
      setBooked((((c as { with_givers?: BookedItem[] })?.with_givers) ?? []) as BookedItem[]);
    })();
  }, [postedFn, giftedFn, receivedFn, myWishesFn, chatsFn]);

  const toggleAch = () => {
    haptic("select");
    setAchOpen((v) => {
      const next = !v;
      if (next && typeof window !== "undefined") {
        const codes = achievements.filter((a) => a.unlocked).map((a) => a.code);
        localStorage.setItem(seenKey, JSON.stringify(codes));
        setSeenVersion((x) => x + 1);
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




  const giftsFor = (k: ActivityKey): Gift[] => {
    if (k === "posted") return (posted ?? []).filter((g) => g.status !== "gifted");
    if (k === "gifted") return (gifted ?? []).map((t) => t.gift).filter((g): g is Gift => !!g);
    return (received ?? []).map((t) => t.gift).filter((g): g is Gift => !!g);
  };
  const loaded = posted && gifted && received && booked;
  const list = giftsFor(activity);

  return (
    <div className="mx-auto w-full max-w-md px-5 pb-6 pt-5">
      {/* Трекер «Первые шаги» — 8 достижений новичка (скрывается, когда все пройдены) */}
      <FirstSteps />

      {/* Пригласить друга + быстрые действия */}
      <InviteRow
        userId={user.user_id}
        level={user.level}
        onGive={onGive}
        onReceive={onReceive}
        onCreateWish={onCreateWish}
      />

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


      <div data-tour="profile-zone">
      {/* Мои желания */}
      <section className="mb-5">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Мои желания</h2>
        {!myWishes ? (
          <Skeleton className="h-16 w-full rounded-2xl" />
        ) : myWishes.length === 0 ? (
          <p className="rounded-2xl border bg-card p-4 text-center text-sm text-muted-foreground">
            Пока нет желаний — загадай через кнопку «Загадать желание» выше ✨
          </p>
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
        <div
          data-tour="profile-statustabs"
          className="mb-3 grid grid-cols-4 gap-1 rounded-2xl border bg-muted/60 p-1"
        >
          {([
            ["posted", "Активные"],
            ["booked", "Брони"],
            ["gifted", "Подаренные"],
            ["received", "Полученные"],
          ] as const).map(([k, label]) => {
            const active = activity === k;
            const count = k === "booked" ? (booked?.length ?? 0) : 0;
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
                className={`flex items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] font-medium leading-tight transition-all duration-300 ${
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
                {count > 0 && (
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold leading-none text-primary-foreground">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {!loaded ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
          </div>
        ) : activity === "booked" ? (
          (booked ?? []).length === 0 ? (
            <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
              Нет забронированных подарков. Выбери подарок в ленте — и он появится здесь, пока вы договариваетесь 💚
            </div>
          ) : (
            <ul key="booked" className="achievements-list space-y-2">
              {(booked ?? []).map((b) => (
                <li key={b.transaction_id}>
                  <Link
                    to="/chat/$giftId"
                    params={{ giftId: b.gift_id }}
                    onClick={() => haptic("select")}
                    className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-3 shadow-sm transition active:scale-[0.98]"
                  >
                    {b.gift_image ? (
                      <img src={b.gift_image} alt={b.gift_title} className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                    ) : (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-xl">🎁</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{b.gift_title}</p>
                      <p className="truncate text-xs text-muted-foreground">от {b.other_name}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white">
                      Открыть чат
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )
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
                  ownerId={user.user_id}
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
      </div>




      <div className="mt-8 space-y-3">
        {isAdmin && (
          <Link
            to="/insights"
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-indigo-400/40 bg-indigo-500/5 py-3 text-sm font-medium text-indigo-600 transition active:scale-[0.98]"
          >
            <BarChart3 className="h-4 w-4" /> Insights (админ)
          </Link>
        )}
        <Link
          to="/set-password"
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-primary/40 bg-primary/5 py-3 text-sm font-medium text-primary transition active:scale-[0.98]"
        >
          🔑 Задать пароль — входить без Telegram
        </Link>
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

        <p className="pt-1 text-center text-[11px] text-muted-foreground/70">
          Подари · {APP_VERSION}
        </p>
      </div>
    </div>
  );
}

// Правила опыта/уровней теперь живут в поповере на верхней плашке (AppHeader),
// поэтому HelpPopover из профиля убран — не дублируем правила в двух местах.


function EditableActiveItem({
  gift,
  ownerId,
  onUpdated,
  onDeleted,
}: {
  gift: Gift;
  ownerId: string;
  onUpdated: (patch: Partial<Gift>) => void;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const shareOrigin =
    typeof window !== "undefined" ? window.location.origin : "https://podari.visokihelenasochi.workers.dev";
  // Ссылка на свой подарок: реферал — на меня, переход — на мою же страницу.
  const shareLink = `${shareOrigin}/?ref=${ownerId}&u=${ownerId}`;
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
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          aria-label="Поделиться подарком"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <Share2 className="h-4 w-4" />
        </button>
        {canModify && (
          <>
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
          </>
        )}
      </div>

      <InviteShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        link={shareLink}
        variants={giftShareVariants(gift.title)}
        title="Поделиться подарком"
        onShared={() => toast.success("Ссылка на подарок готова — зови друзей 💚")}
      />

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

function InviteRow({
  userId,
  level,
  onGive,
  onReceive,
  onCreateWish,
}: {
  userId: string;
  level: number;
  onGive?: () => void;
  onReceive?: () => void;
  onCreateWish?: () => void;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://podari.visokihelenasochi.workers.dev";
  const inviteLink = `${origin}/?ref=${userId}`;

  // Засчитываем приглашение ТОЛЬКО после фактической отправки (из окна выбора).
  const onInviteShared = () => {
    let firstInvite = false;
    try {
      firstInvite = localStorage.getItem("cozygift_invited") !== "1";
      localStorage.setItem("cozygift_invited", "1");
      const raw = localStorage.getItem("cozygift_steps_celebrated");
      if (raw) {
        const set = JSON.parse(raw) as string[];
        if (!set.includes("invited")) {
          localStorage.setItem("cozygift_steps_celebrated", JSON.stringify([...set, "invited"]));
        }
      }
    } catch {
      /* noop */
    }
    if (firstInvite) {
      confetti({ particleCount: 130, spread: 85, origin: { y: 0.4 }, scalar: 1.1 });
      haptic("success");
      toast.success("🎉 👯 Пригласить друга — выполнено!", {
        description: "Спасибо, что зовёшь друзей в «Подари» 💚",
      });
    }
    window.dispatchEvent(
      new CustomEvent("cozy:tour-event", { detail: "invite-shared" }),
    );
  };

  const wishLocked = level < 3;

  const Tile = ({
    label,
    emoji,
    onClick,
    locked = false,
    lockHint,
    accent = "bg-muted",
  }: {
    label: string;
    emoji: string;
    onClick?: () => void;
    locked?: boolean;
    lockHint?: string;
    accent?: string;
  }) => (
    <button
      type="button"
      onClick={() => {
        if (locked) {
          toast(`🔒 ${label}`, {
            description: lockHint ?? "Откроется чуть позже",
          });
          return;
        }
        haptic("medium");
        onClick?.();
      }}
      className={`flex flex-col items-center gap-1.5 rounded-3xl border bg-card px-2 py-3 text-center shadow-sm transition active:scale-[0.96] ${
        locked ? "opacity-60" : "hover:bg-accent"
      }`}
    >
      <span className={`flex h-12 w-12 items-center justify-center rounded-full text-2xl ${accent}`}>
        {emoji}
      </span>
      <span className="text-[11px] font-medium leading-tight">{label}</span>
      {locked && (
        <span className="text-[9px] text-muted-foreground">🔒 ⭐ 3</span>
      )}
    </button>
  );

  return (
    <>
      {/* Три действия — отдельный блок, выделены круглой формой и цветом */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Tile label="Подарить" emoji="✨" onClick={onGive} accent="bg-lavender/60" />
        <Tile label="Получить" emoji="🎁" onClick={() => onReceive?.()} accent="bg-mint/60" />
        <Tile
          label="Загадать желание"
          emoji="💫"
          onClick={onCreateWish}
          locked={wishLocked}
          lockHint="Откроется на 3 уровне. Дари и получай — и ты дойдёшь сюда!"
          accent="bg-peach/60"
        />
      </div>

      {/* Пригласить друга — отдельный блок */}
      <section className="mb-5 rounded-3xl border bg-card p-3 shadow-sm">
        <button
          type="button"
          data-tour="invite-btn"
          onClick={() => setShareOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-lavender px-3 py-2.5 text-sm font-semibold text-lavender-foreground shadow-sm transition active:scale-[0.98]"
        >
          <Send className="h-4 w-4" /> Пригласить друга
        </button>
        <p className="mt-2 text-center text-[10.5px] text-muted-foreground">
          Другу +1 балл, тебе +50 XP
        </p>
      </section>

      <InviteShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        link={inviteLink}
        variants={[...INVITE_VARIANTS]}
        title="Пригласить друга"
        onShared={onInviteShared}
      />
    </>
  );
}

const WISH_EXAMPLES = [
  "помощь в быту",
  "новые туфли",
  "путешествие к морю",
  "ящик клубники",
  "знакомство с интересным человеком",
  "переобуть колёса",
  "вылечить зуб",
  "урок игры на гитаре",
  "букет пионов",
  "кофе с любимым десертом",
  "поход в баню",
  "новая книга",
  "уборка квартиры",
  "массаж спины",
  "билет на концерт",
];

function WishCtaButton({ level, onCreateWish }: { level: number; onCreateWish?: () => void }) {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * WISH_EXAMPLES.length));
  useEffect(() => {
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % WISH_EXAMPLES.length);
    }, 2200);
    return () => clearInterval(t);
  }, []);
  const locked = level < 3;
  return (
    <button
      type="button"
      onClick={() => {
        if (locked) {
          toast("🔒 Загадать желание", {
            description: "Откроется на 3 уровне. Дари и получай — и ты дойдёшь сюда!",
          });
          return;
        }
        haptic("medium");
        onCreateWish?.();
      }}
      className={`mb-3 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left shadow-sm transition active:scale-[0.98] ${
        locked
          ? "border bg-card opacity-70"
          : "bg-mint text-mint-foreground hover:bg-mint/90"
      }`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-background/60 text-mint-foreground">
        <Sparkles className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Загадать желание</span>
        <span className={`block truncate text-xs transition-opacity duration-300 ${locked ? "text-muted-foreground" : "text-mint-foreground/70"}`}>
          например: {WISH_EXAMPLES[idx]}
        </span>
      </span>
      {locked && <span className="text-[10px] text-muted-foreground">🔒 ⭐ 3</span>}
    </button>
  );
}




