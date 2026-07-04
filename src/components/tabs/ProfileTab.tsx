import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  LogOut,
  Pencil,
  Trash2,
  Trophy,
  BarChart3,
  Send,
  Sparkles,
  Share2,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { useNavigate, Link } from "@tanstack/react-router";
import type { UserProfile } from "@/lib/auth-state";
import { signOut } from "@/lib/auth-state";
import { getMyRoles } from "@/lib/roles.functions";
import { APP_BASE_URL } from "@/lib/app-url";

import { Achievements, useAchievements } from "@/components/Achievements";
import {
  getMyPostedGifts,
  getMyReceivedGifts,
  getMyGiftedGifts,
  getMyIncomingBookings,
  getMyChats,
  updateGift,
  deleteGift,
  markInvited,
} from "@/lib/cozy.functions";
import { COST_TIERS } from "@/lib/gift-kinds";
import { getMyWishes, setWishHidden } from "@/lib/wishes.functions";
import { INVITE_VARIANTS, giftShareVariants, wishShareVariants } from "@/lib/random-copy";
import { shareLink, thirdVariant, shareGift } from "@/lib/share";
import { Journey } from "@/components/Journey";
import { CityBadge } from "@/components/CityBadge";
import { ReviewsAboutMe } from "@/components/ReviewsAboutMe";
// Премиум пока не настроен — плашка «Подари Global» временно скрыта.
// import { GlobalPremiumCard } from "@/components/GlobalPremiumCard";
import { APP_VERSION } from "@/lib/version";
import { haptic } from "@/lib/haptics";
import { Skeleton } from "@/components/ui/skeleton";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  cost?: number | null;
  city?: string | null;
  is_online?: boolean | null;
  quantity?: number | null;
  quantity_remaining?: number | null;
};
type TxRow = { id: string; status: string; gift: Gift | null };
type BookedItem = {
  transaction_id: string;
  gift_id: string;
  gift_title: string;
  gift_image: string | null;
  other_name: string;
};
// Входящая бронь: кто-то выбрал МОЙ подарок, ждём передачи.
type IncomingItem = {
  transaction_id: string;
  gift_id: string;
  gift_title: string;
  gift_image: string | null;
  receiver_name: string;
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
  city?: string | null;
  is_online?: boolean | null;
};

export function ProfileTab({
  user,
  onUnreadAchievements,
  onCreateWish,
  onOpenWish,
  onGive,
  onReceive,
}: Props) {
  const navigate = useNavigate();
  const [achOpen, setAchOpen] = useState(false);
  const [activity, setActivity] = useState<ActivityKey>("posted");
  const [posted, setPosted] = useState<Gift[] | null>(null);
  const [gifted, setGifted] = useState<TxRow[] | null>(null);
  const [received, setReceived] = useState<TxRow[] | null>(null);
  const [booked, setBooked] = useState<BookedItem[] | null>(null);
  const [incoming, setIncoming] = useState<IncomingItem[] | null>(null);
  const [myWishes, setMyWishes] = useState<MyWish[] | null>(null);

  const postedFn = useServerFn(getMyPostedGifts);
  const giftedFn = useServerFn(getMyGiftedGifts);
  const receivedFn = useServerFn(getMyReceivedGifts);
  const incomingFn = useServerFn(getMyIncomingBookings);
  const chatsFn = useServerFn(getMyChats);
  const myWishesFn = useServerFn(getMyWishes);
  const rolesFn = useServerFn(getMyRoles);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    rolesFn({})
      .then((r: { isAdmin?: boolean } | null) => setIsAdmin(!!r?.isAdmin))
      .catch(() => {});
  }, [rolesFn]);

  const { items: achievements, stats: journeyStats } = useAchievements();
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
      const [p, g, r, w, c, inc] = await Promise.all([
        postedFn(),
        giftedFn(),
        receivedFn(),
        myWishesFn(),
        chatsFn(),
        incomingFn(),
      ]);
      setPosted((p as unknown as Gift[]) ?? []);
      setGifted((g as TxRow[]) ?? []);
      setReceived((r as TxRow[]) ?? []);
      setMyWishes((w as unknown as MyWish[]) ?? []);
      // «Вы забронировали» = активные сделки, где я получатель (чаты с дарителями)
      setBooked(((c as { with_givers?: BookedItem[] })?.with_givers ?? []) as BookedItem[]);
      // «Забронировали у вас» = ожидающие сделки, где я даритель
      setIncoming((inc as IncomingItem[]) ?? []);
    })();
  }, [postedFn, giftedFn, receivedFn, myWishesFn, chatsFn, incomingFn]);

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
  const loaded = posted && gifted && received && booked && incoming;
  const list = giftsFor(activity);

  return (
    <div className="mx-auto w-full max-w-md px-5 pb-6 pt-5">
      {/* Отзывы обо мне — сразу под плашкой с уровнем, в самом верху */}
      <ReviewsAboutMe userId={user.user_id} />

      {/* Единое окно прогресса: ступени пути (первые шаги → активный даритель → …) */}
      <Journey stats={journeyStats} />

      {/* Пригласить друга + быстрые действия */}
      <InviteRow
        userId={user.user_id}
        level={user.level}
        onGive={onGive}
        onReceive={onReceive}
        onCreateWish={onCreateWish}
      />

      {/* Подписка Global временно скрыта — премиум пока не настроен. */}
      {/* <GlobalPremiumCard /> */}

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
                <MyWishItem
                  key={w.id}
                  w={w}
                  ownerId={user.user_id}
                  onOpen={onOpenWish}
                  onChanged={(id, status) =>
                    setMyWishes((prev) =>
                      prev ? prev.map((x) => (x.id === id ? { ...x, status } : x)) : prev,
                    )
                  }
                />
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
            {(
              [
                ["posted", "Активные"],
                ["booked", "Брони"],
                ["gifted", "Подаренные"],
                ["received", "Полученные"],
              ] as const
            ).map(([k, label]) => {
              const active = activity === k;
              const count = k === "booked" ? (incoming?.length ?? 0) + (booked?.length ?? 0) : 0;
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
            (incoming ?? []).length === 0 && (booked ?? []).length === 0 ? (
              <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
                Здесь появятся активные брони. Выбери подарок в ленте или дождись, когда кто-то
                выберет твой 💚
              </div>
            ) : (
              <div key="booked" className="space-y-4">
                {/* Входящие: кто-то выбрал мой подарок — нужно договориться о передаче */}
                {(incoming ?? []).length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                      🔖 Забронировали у меня{" "}
                      <span className="text-xs">({(incoming ?? []).length})</span>
                    </h3>
                    <ul className="achievements-list space-y-2">
                      {(incoming ?? []).map((b) => (
                        <li key={b.transaction_id}>
                          <Link
                            to="/chat/$giftId"
                            params={{ giftId: b.gift_id }}
                            onClick={() => haptic("select")}
                            className="flex items-center gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-3 shadow-sm transition active:scale-[0.98]"
                          >
                            {b.gift_image ? (
                              <img
                                src={b.gift_image}
                                alt={b.gift_title}
                                className="h-12 w-12 shrink-0 rounded-xl object-cover"
                              />
                            ) : (
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-xl">
                                🎁
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{b.gift_title}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                забронировал(а) {b.receiver_name}
                              </p>
                            </div>
                            <span className="shrink-0 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white">
                              Открыть чат
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Исходящие: я выбрал чужой подарок */}
                {(booked ?? []).length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                      🎁 Я забронировал(а){" "}
                      <span className="text-xs">({(booked ?? []).length})</span>
                    </h3>
                    <ul className="achievements-list space-y-2">
                      {(booked ?? []).map((b) => (
                        <li key={b.transaction_id}>
                          <Link
                            to="/chat/$giftId"
                            params={{ giftId: b.gift_id }}
                            onClick={() => haptic("select")}
                            className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-3 shadow-sm transition active:scale-[0.98]"
                          >
                            {b.gift_image ? (
                              <img
                                src={b.gift_image}
                                alt={b.gift_title}
                                className="h-12 w-12 shrink-0 rounded-xl object-cover"
                              />
                            ) : (
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-xl">
                                🎁
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{b.gift_title}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                от {b.other_name}
                              </p>
                            </div>
                            <span className="shrink-0 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white">
                              Открыть чат
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
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
                    userLevel={user.level}
                    onUpdated={(patch) =>
                      setPosted((prev) =>
                        (prev ?? []).map((x) => (x.id === g.id ? { ...x, ...patch } : x)),
                      )
                    }
                    onDeleted={() => setPosted((prev) => (prev ?? []).filter((x) => x.id !== g.id))}
                  />
                ) : (
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
                      <p className="line-clamp-2 text-sm font-medium">{g.title}</p>
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
  userLevel,
  onUpdated,
  onDeleted,
}: {
  gift: Gift;
  ownerId: string;
  userLevel: number;
  onUpdated: (patch: Partial<Gift>) => void;
  onDeleted: () => void;
}) {
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const deleteFn = useServerFn(deleteGift);
  const canModify = gift.status === "available";

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
        <img
          src={gift.image_url}
          alt={gift.title}
          className="h-12 w-12 shrink-0 rounded-xl object-cover"
        />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-xl">
          🎁
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium">{gift.title}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-xs text-muted-foreground">{gift.category}</p>
          <CityBadge city={gift.city} isOnline={gift.is_online} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => shareGift(gift.id, gift.title)}
          aria-label="Поделиться подарком"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <Share2 className="h-4 w-4" />
        </button>
        {canModify && (
          <>
            <button
              type="button"
              onClick={() => navigate({ to: "/gift/$giftId/edit", params: { giftId: gift.id } })}
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

function MyWishItem({
  w,
  ownerId,
  onOpen,
  onChanged,
}: {
  w: MyWish;
  ownerId: string;
  onOpen?: (wishId: string) => void;
  onChanged?: (id: string, status: string) => void;
}) {
  const origin = APP_BASE_URL;
  const shareUrl = `${origin}/?ref=${ownerId}`;
  const isHidden = w.status === "hidden";
  // Менять видимость можно, пока никто не взялся исполнять.
  const canToggle = isHidden || w.status === "open";
  const setHiddenFn = useServerFn(setWishHidden);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      const res = await setHiddenFn({ data: { wish_id: w.id, hidden: !isHidden } });
      onChanged?.(w.id, res.status);
      haptic("success");
      toast.success(isHidden ? "Желание открыто для всех ✨" : "Скрыто — во Вселенной 🌌");
    } catch {
      toast.error("Не получилось изменить видимость");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="relative">
      <button
        type="button"
        onClick={() => {
          haptic("select");
          onOpen?.(w.id);
        }}
        className={`flex w-full items-center gap-3 rounded-2xl border p-3 pb-9 text-left shadow-sm transition active:scale-[0.98] ${
          isHidden ? "border-emerald-300 bg-emerald-50" : "bg-card"
        }`}
      >
        {w.image_url ? (
          <img
            src={w.image_url}
            alt={w.title}
            className={`h-12 w-12 shrink-0 rounded-xl object-cover ${isHidden ? "opacity-80" : ""}`}
          />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-peach/40 text-xl">
            ✨
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 pr-7 text-sm font-medium">{w.title}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {isHidden ? (
              <span className="rounded-full bg-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                🌌 Скрыто — во Вселенной
              </span>
            ) : (
              <p className="truncate text-xs text-muted-foreground">
                {w.category} ·{" "}
                {w.status === "open" ? "ждёт" : w.status === "reserved" ? "в работе" : "исполнено"}
              </p>
            )}
            <CityBadge city={w.city} isOnline={w.is_online} />
          </div>
        </div>
      </button>

      {/* Переключатель видимости — внизу карточки */}
      {canToggle && (
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className="absolute bottom-2 right-2 rounded-full border bg-background/90 px-2.5 py-1 text-[11px] font-semibold text-foreground shadow-sm ring-1 ring-border transition hover:bg-accent active:scale-95 disabled:opacity-60"
        >
          {busy ? "…" : isHidden ? "🌍 Открыть для всех" : "🌌 Скрыть"}
        </button>
      )}

      {/* Поделиться — только у открытых желаний (скрытое не транслируем) */}
      {!isHidden && (
        <button
          type="button"
          onClick={() => shareLink(thirdVariant(wishShareVariants(w.title)), shareUrl)}
          aria-label="Поделиться желанием"
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm ring-1 ring-border transition hover:text-foreground active:scale-95"
        >
          <Share2 className="h-3.5 w-3.5" />
        </button>
      )}
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
  const origin = APP_BASE_URL;
  const inviteLink = `${origin}/?ref=${userId}`;
  const markInvitedFn = useServerFn(markInvited);

  // Засчитываем приглашение ТОЛЬКО после фактической отправки (из окна выбора).
  const onInviteShared = () => {
    // Запоминаем факт отправки на сервере — чтобы шаг «Пригласить друга»
    // отмечался на всех устройствах, а не только в этом браузере.
    markInvitedFn({}).catch(() => {
      /* офлайн — останется локальная отметка, синхронизируется позже */
    });
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
    window.dispatchEvent(new CustomEvent("cozy:tour-event", { detail: "invite-shared" }));
  };

  const wishLocked = level < 3;

  // Плитка действия: целиком залита ярким цветом (accent) с читаемым текстом (fg).
  // Три главные кнопки специально ярче и заметнее, чем «Пригласить друга».
  const Tile = ({
    label,
    emoji,
    onClick,
    locked = false,
    lockHint,
    accent = "bg-muted",
    fg = "text-foreground",
  }: {
    label: string;
    emoji: string;
    onClick?: () => void;
    locked?: boolean;
    lockHint?: string;
    accent?: string;
    fg?: string;
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
      className={`flex flex-col items-center gap-1.5 rounded-3xl px-2 py-3.5 text-center shadow-md transition active:scale-[0.96] ${accent} ${fg} ${
        locked ? "opacity-70" : "hover:brightness-[1.05]"
      }`}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/25 text-2xl">
        {emoji}
      </span>
      <span className="text-[12px] font-semibold leading-tight">{label}</span>
      {locked && <span className="text-[9px] opacity-80">🔒 ⭐ 3</span>}
    </button>
  );

  return (
    <>
      {/* Три действия — отдельный блок, выделены круглой формой и цветом */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        {/* Вариант B — одна зелёно-песочная гамма: тёмная олива / светлая олива / песок */}
        <Tile label="Подарить" emoji="✨" onClick={onGive} accent="bg-[#5E6E33]" fg="text-white" />
        <Tile
          label="Получить"
          emoji="🎁"
          onClick={() => onReceive?.()}
          accent="bg-[#94A662]"
          fg="text-[#22270F]"
        />
        <Tile
          label="Загадать желание"
          emoji="💫"
          onClick={onCreateWish}
          locked={wishLocked}
          lockHint="Откроется на 3 уровне. Дари и получай — и ты дойдёшь сюда!"
          accent="bg-[#CDB47A]"
          fg="text-[#3A2E0A]"
        />
      </div>

      {/* Пригласить друга — отдельный блок */}
      <section className="mb-5 rounded-3xl border bg-card p-3 shadow-sm">
        <button
          type="button"
          data-tour="invite-btn"
          onClick={() => {
            shareLink(thirdVariant([...INVITE_VARIANTS]), inviteLink);
            onInviteShared();
          }}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-primary/40 bg-primary/10 px-3 py-2.5 text-sm font-semibold text-primary transition active:scale-[0.98] hover:bg-primary/15"
        >
          <Send className="h-4 w-4" /> Пригласить друга
        </button>
        <p className="mt-2 text-center text-[10.5px] text-muted-foreground">
          Другу — 1 балл на старт, тебе +50 XP за каждого
        </p>
      </section>
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
        locked ? "border bg-card opacity-70" : "bg-mint text-mint-foreground hover:bg-mint/90"
      }`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-background/60 text-mint-foreground">
        <Sparkles className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Загадать желание</span>
        <span
          className={`block truncate text-xs transition-opacity duration-300 ${locked ? "text-muted-foreground" : "text-mint-foreground/70"}`}
        >
          например: {WISH_EXAMPLES[idx]}
        </span>
      </span>
      {locked && <span className="text-[10px] text-muted-foreground">🔒 ⭐ 3</span>}
    </button>
  );
}
