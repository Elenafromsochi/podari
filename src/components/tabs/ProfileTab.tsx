import { useEffect, useState } from "react";
import { ChevronDown, LogOut, Pencil, Trash2, BarChart3, Send, History } from "lucide-react";
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
  getMyChats,
  updateGift,
  deleteGift,
  setGiftHidden,
  markInvited,
  updateMyProfile,
  getBalanceHistory,
} from "@/lib/cozy.functions";
import { readSeenChats, writeSeenChats, isChatUnread } from "@/lib/chat-unread";
import { uploadImage } from "@/lib/upload-image";
import { COST_TIERS } from "@/lib/gift-kinds";
import { getMyWishes, setWishHidden } from "@/lib/wishes.functions";
import { INVITE_VARIANTS } from "@/lib/random-copy";
import { shareLink, thirdVariant, shareGift, shareWish } from "@/lib/share";
import { Journey } from "@/components/Journey";
import { ItemCard } from "@/components/ItemCard";
import { CertificateBuilder } from "@/components/CertificateBuilder";
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
// Признаки чата по сделке — приходят из getMyChats(), нужны, чтобы подсветить
// брони/подаренное/полученное с новыми сообщениями (см. lib/chat-unread.ts).
type ChatMeta = {
  last_message_at: string | null;
  last_incoming: boolean;
  needs_review: boolean;
};
type TxRow = { id: string; status: string; gift: Gift | null } & Partial<ChatMeta>;
type BookedItem = {
  transaction_id: string;
  gift_id: string;
  gift_title: string;
  gift_image: string | null;
  other_name: string;
} & ChatMeta;
// Входящая бронь: кто-то выбрал МОЙ подарок, ждём передачи.
type IncomingItem = {
  transaction_id: string;
  gift_id: string;
  gift_title: string;
  gift_image: string | null;
  receiver_name: string;
} & ChatMeta;
type ActivityKey = "wishes" | "posted" | "gifted" | "received" | "booked";

type BalanceEvent = {
  id: string;
  delta: number;
  reason: string;
  created_at: string;
  title: string | null;
};

// Подпись и эмодзи для каждой причины изменения баланса — единое место для текста.
const BALANCE_REASONS: Record<string, { label: (title: string | null) => string; emoji: string }> =
  {
    welcome_bonus: { label: () => "Приветственный балл", emoji: "🎉" },
    gift_published: { label: (t) => `Опубликовал(а) подарок «${t ?? "подарок"}»`, emoji: "🎁" },
    gift_claimed: { label: (t) => `Забрал(а) подарок «${t ?? "подарок"}»`, emoji: "🛍" },
    gift_handed_over: { label: (t) => `Вручил(а) подарок «${t ?? "подарок"}»`, emoji: "💚" },
    gift_claim_cancelled: {
      label: (t) => `Отменена бронь «${t ?? "подарок"}» — баллы вернулись`,
      emoji: "↩️",
    },
    wish_paid: { label: (t) => `Исполнили желание «${t ?? "желание"}»`, emoji: "✨" },
    wish_fulfilled: { label: (t) => `Исполнил(а) желание «${t ?? "желание"}»`, emoji: "🌟" },
  };

function formatBalanceEvent(e: BalanceEvent): { text: string; emoji: string } {
  const known = BALANCE_REASONS[e.reason];
  if (known) return { text: known.label(e.title), emoji: known.emoji };
  return { text: e.title ? `«${e.title}»` : "Изменение баланса", emoji: "🎁" };
}

// Правила XP/уровней теперь живут в поповере на верхней плашке (AppHeader).

interface Props {
  user: UserProfile;
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

export function ProfileTab({ user, onCreateWish, onOpenWish, onGive, onReceive }: Props) {
  const navigate = useNavigate();
  const [activity, setActivity] = useState<ActivityKey>("posted");
  const [posted, setPosted] = useState<Gift[] | null>(null);
  const [gifted, setGifted] = useState<TxRow[] | null>(null);
  const [received, setReceived] = useState<TxRow[] | null>(null);
  const [booked, setBooked] = useState<BookedItem[] | null>(null);
  const [incoming, setIncoming] = useState<IncomingItem[] | null>(null);
  const [myWishes, setMyWishes] = useState<MyWish[] | null>(null);
  // Тот же журнал «прочитано», что и на вкладке «Чаты» — см. lib/chat-unread.ts.
  const [seenChats, setSeenChats] = useState<Record<string, string>>(() => readSeenChats());
  const markChatSeen = (item: { transaction_id: string; last_message_at: string | null }) => {
    if (!item.last_message_at) return;
    setSeenChats((prev) => {
      if ((prev[item.transaction_id] ?? "") >= item.last_message_at!) return prev;
      const next = { ...prev, [item.transaction_id]: item.last_message_at! };
      writeSeenChats(next);
      return next;
    });
  };

  // Редактирование профиля: фото и «о себе».
  const [editOpen, setEditOpen] = useState(false);
  const [avatarDraft, setAvatarDraft] = useState<string | null>(user.avatar_url ?? null);
  const [aboutDraft, setAboutDraft] = useState(user.about ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const updateProfileFn = useServerFn(updateMyProfile);

  // История баллов: подгружаем лениво, при первом раскрытии секции.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<BalanceEvent[] | null>(null);
  const historyFn = useServerFn(getBalanceHistory);
  const toggleHistory = () => {
    haptic("select");
    setHistoryOpen((v) => {
      const next = !v;
      if (next && history === null) {
        historyFn({})
          .then((h) => setHistory(h as BalanceEvent[]))
          .catch(() => setHistory([]));
      }
      return next;
    });
  };

  const postedFn = useServerFn(getMyPostedGifts);
  const giftedFn = useServerFn(getMyGiftedGifts);
  const receivedFn = useServerFn(getMyReceivedGifts);
  const chatsFn = useServerFn(getMyChats);
  const myWishesFn = useServerFn(getMyWishes);
  const rolesFn = useServerFn(getMyRoles);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    rolesFn({})
      .then((r: { isAdmin?: boolean } | null) => setIsAdmin(!!r?.isAdmin))
      .catch(() => {});
  }, [rolesFn]);

  const { stats: journeyStats } = useAchievements();

  useEffect(() => {
    (async () => {
      const [p, g, r, w, c] = await Promise.all([
        postedFn(),
        giftedFn(),
        receivedFn(),
        myWishesFn(),
        chatsFn(),
      ]);
      // Форма элемента ровно как её строит getMyChats() на сервере.
      type RawDeal = {
        transaction_id: string;
        gift_id: string;
        gift_title: string;
        gift_image: string | null;
        other_name: string;
      } & ChatMeta;
      const chats = c as {
        with_givers?: RawDeal[];
        with_receivers?: RawDeal[];
        archive_with_givers?: RawDeal[];
        archive_with_receivers?: RawDeal[];
      };
      // Признаки чата (новое сообщение / ждёт отзыва) по всем сделкам сразу —
      // чтобы подсветить подаренное/полученное там, где что-то новое.
      const metaByTx = new Map<string, ChatMeta>();
      [
        ...(chats.with_givers ?? []),
        ...(chats.with_receivers ?? []),
        ...(chats.archive_with_givers ?? []),
        ...(chats.archive_with_receivers ?? []),
      ].forEach((item) => {
        metaByTx.set(item.transaction_id, {
          last_message_at: item.last_message_at ?? null,
          last_incoming: !!item.last_incoming,
          needs_review: !!item.needs_review,
        });
      });

      setPosted((p as unknown as Gift[]) ?? []);
      setGifted(((g as TxRow[]) ?? []).map((t) => ({ ...t, ...metaByTx.get(t.id) })));
      setReceived(((r as TxRow[]) ?? []).map((t) => ({ ...t, ...metaByTx.get(t.id) })));
      setMyWishes((w as unknown as MyWish[]) ?? []);
      // «Вы забронировали» = активные сделки, где я получатель (чаты с дарителями)
      setBooked(chats.with_givers ?? []);
      // «Забронировали у вас» = ожидающие сделки, где я даритель — та же
      // getMyChats(), а не отдельный запрос: заодно достаём данные о сообщениях.
      setIncoming(
        (chats.with_receivers ?? []).map((it) => ({
          transaction_id: it.transaction_id,
          gift_id: it.gift_id,
          gift_title: it.gift_title,
          gift_image: it.gift_image,
          receiver_name: it.other_name,
          last_message_at: it.last_message_at,
          last_incoming: it.last_incoming,
          needs_review: it.needs_review,
        })),
      );
    })();
  }, [postedFn, giftedFn, receivedFn, myWishesFn, chatsFn]);

  const handleAvatarPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAvatarDraft(String(reader.result));
    reader.readAsDataURL(file);
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const avatarUrl = avatarDraft?.startsWith("data:")
        ? await uploadImage(avatarDraft)
        : avatarDraft;
      await updateProfileFn({
        data: { avatar_url: avatarUrl, about: aboutDraft.trim() || null },
      });
      toast.success("Профиль обновлён 💚");
      setEditOpen(false);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("cozy:profile-updated"));
      }
    } catch (e) {
      toast.error("Не удалось сохранить", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSavingProfile(false);
    }
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

  const loaded = posted && gifted && received && booked && incoming;
  // «Подаренные»/«Полученные» рендерятся отдельно (нужны transaction_id и
  // признаки чата) — этот список нужен только для «Активные».
  const list = (posted ?? []).filter((g) => g.status !== "gifted");

  return (
    <div className="mx-auto w-full max-w-md px-5 pb-6 pt-5">
      {/* Фото и имя уже видны в шапке выше — тут только «о себе» (целиком,
          без обрезки) и маленькая кнопка входа в редактирование. */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            О себе
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">
            {user.about || "Добавь пару слов о себе"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setAvatarDraft(user.avatar_url ?? null);
            setAboutDraft(user.about ?? "");
            setEditOpen(true);
          }}
          aria-label="Редактировать профиль"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm transition active:scale-[0.95] hover:bg-accent hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Редактировать профиль</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            {avatarDraft ? (
              <img
                src={avatarDraft}
                alt="Фото профиля"
                className="h-24 w-24 rounded-full object-cover shadow-sm"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-peach text-3xl font-semibold text-peach-foreground shadow-sm">
                {(user.display_name || "?").trim().charAt(0).toUpperCase()}
              </div>
            )}
            <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-xl border bg-background px-3 py-1.5 text-xs font-medium transition active:scale-[0.98] hover:bg-accent">
              📷 {avatarDraft ? "Заменить фото" : "Добавить фото"}
              <input type="file" accept="image/*" onChange={handleAvatarPick} className="hidden" />
            </label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="about">О себе</Label>
            <Textarea
              id="about"
              value={aboutDraft}
              onChange={(e) => setAboutDraft(e.target.value.slice(0, 300))}
              placeholder="Пара слов о себе — увидят другие в твоём профиле"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button onClick={saveProfile} disabled={savingProfile} className="w-full">
              {savingProfile ? "Сохраняем…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Отзывы обо мне — сразу под плашкой с уровнем, в самом верху */}
      <ReviewsAboutMe userId={user.user_id} />

      {/* Единое окно прогресса: ступени пути (первые шаги → активный даритель → …)
          и достижения — теперь один раздел, сворачиваются и разворачиваются вместе. */}
      <Journey stats={journeyStats}>
        <div className="achievements-list">
          <Achievements variant="full" />
        </div>
      </Journey>

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

      {/* История баллов: начисления и списания одним списком */}
      <section className="mb-4 overflow-hidden rounded-3xl border bg-card shadow-sm">
        <button
          type="button"
          onClick={toggleHistory}
          className="flex w-full items-center justify-between px-4 py-3.5 text-left transition active:bg-accent/50"
          aria-expanded={historyOpen}
        >
          <span className="flex items-center gap-2 text-[15px] font-semibold">
            <History className="h-4 w-4 text-primary" />
            История баллов
          </span>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform duration-300 ${
              historyOpen ? "rotate-180" : ""
            }`}
          />
        </button>
        {historyOpen && (
          <div className="border-t bg-background/40 p-4">
            {history === null ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full rounded-xl" />
                <Skeleton className="h-10 w-full rounded-xl" />
                <Skeleton className="h-10 w-full rounded-xl" />
              </div>
            ) : history.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Пока пусто — баллы появятся здесь, как только начнёшь дарить и получать 💚
              </p>
            ) : (
              <ul className="space-y-2">
                {history.map((e) => {
                  const { text, emoji } = formatBalanceEvent(e);
                  const positive = e.delta >= 0;
                  return (
                    <li
                      key={e.id}
                      className="flex items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5"
                    >
                      <span className="shrink-0 text-lg leading-none">{emoji}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{text}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(e.created_at).toLocaleDateString("ru-RU", {
                            day: "numeric",
                            month: "short",
                          })}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 text-sm font-semibold tabular-nums ${
                          positive ? "text-mint-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {positive ? "+" : ""}
                        {e.delta.toFixed(1)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </section>

      <div data-tour="profile-zone">
        {/* Мои желания и подарки — единый ряд вкладок, как на главной */}
        <section>
          <div
            data-tour="profile-statustabs"
            className="mb-3 grid grid-cols-5 gap-1 rounded-2xl border bg-muted/60 p-1"
          >
            {(
              [
                ["wishes", "Желания"],
                ["posted", "Активные"],
                ["booked", "Брони"],
                ["gifted", "Подаренные"],
                ["received", "Полученные"],
              ] as const
            ).map(([k, label]) => {
              const active = activity === k;
              // Счётчик — просто «сколько всего» на каждой вкладке. А подсветка
              // (цвет текста и кружка) — отдельно, только если там реально есть
              // новое сообщение, которое стоит увидеть.
              const count =
                k === "wishes"
                  ? (myWishes?.length ?? 0)
                  : k === "posted"
                    ? (posted ?? []).filter((g) => g.status !== "gifted").length
                    : k === "booked"
                      ? (incoming?.length ?? 0) + (booked?.length ?? 0)
                      : k === "gifted"
                        ? (gifted?.length ?? 0)
                        : (received?.length ?? 0);
              const hasUnread =
                k === "booked"
                  ? (incoming ?? []).some((it) => isChatUnread(it, seenChats)) ||
                    (booked ?? []).some((it) => isChatUnread(it, seenChats))
                  : k === "gifted"
                    ? (gifted ?? []).some(
                        (t) =>
                          t.id &&
                          isChatUnread(
                            {
                              transaction_id: t.id,
                              last_message_at: t.last_message_at ?? null,
                              last_incoming: !!t.last_incoming,
                            },
                            seenChats,
                          ),
                      )
                    : k === "received"
                      ? (received ?? []).some(
                          (t) =>
                            t.id &&
                            isChatUnread(
                              {
                                transaction_id: t.id,
                                last_message_at: t.last_message_at ?? null,
                                last_incoming: !!t.last_incoming,
                              },
                              seenChats,
                            ),
                        )
                      : false;
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
                  className={`flex items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] leading-tight transition-all duration-300 ${
                    hasUnread
                      ? "font-bold text-primary"
                      : active
                        ? "font-medium text-foreground"
                        : "font-medium text-muted-foreground hover:text-foreground"
                  } ${active ? "bg-background shadow-sm" : ""}`}
                >
                  {label}
                  {count > 0 && (
                    <span
                      className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none ${
                        hasUnread
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted-foreground/15 text-muted-foreground"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {activity === "wishes" ? (
            !myWishes ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full rounded-2xl" />
                <Skeleton className="h-16 w-full rounded-2xl" />
              </div>
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
                    onOpen={onOpenWish}
                    onChanged={(id, status) =>
                      setMyWishes((prev) =>
                        prev ? prev.map((x) => (x.id === id ? { ...x, status } : x)) : prev,
                      )
                    }
                  />
                ))}
              </ul>
            )
          ) : !loaded ? (
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
                      {(incoming ?? []).map((b) => {
                        const unread = isChatUnread(b, seenChats);
                        return (
                          <li key={b.transaction_id}>
                            <Link
                              to="/chat/$giftId"
                              params={{ giftId: b.gift_id }}
                              onClick={() => {
                                haptic("select");
                                markChatSeen(b);
                              }}
                              className={`flex items-center gap-3 rounded-2xl border p-3 shadow-sm transition active:scale-[0.98] ${
                                unread
                                  ? "border-primary bg-primary/10"
                                  : "border-primary/40 bg-primary/5"
                              }`}
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
                                <p
                                  className={`truncate text-sm ${unread ? "font-bold" : "font-medium"}`}
                                >
                                  {b.gift_title}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {unread ? "● Новое сообщение — " : ""}забронировал(а){" "}
                                  {b.receiver_name}
                                </p>
                              </div>
                              <span className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-white">
                                Открыть чат
                              </span>
                            </Link>
                          </li>
                        );
                      })}
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
                      {(booked ?? []).map((b) => {
                        const unread = isChatUnread(b, seenChats);
                        return (
                          <li key={b.transaction_id}>
                            <Link
                              to="/chat/$giftId"
                              params={{ giftId: b.gift_id }}
                              onClick={() => {
                                haptic("select");
                                markChatSeen(b);
                              }}
                              className={`flex items-center gap-3 rounded-2xl border p-3 shadow-sm transition active:scale-[0.98] ${
                                unread
                                  ? "border-primary bg-primary/10"
                                  : "border-primary/30 bg-primary/5"
                              }`}
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
                                <p
                                  className={`truncate text-sm ${unread ? "font-bold" : "font-medium"}`}
                                >
                                  {b.gift_title}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {unread ? "● Новое сообщение — " : ""}от {b.other_name}
                                </p>
                              </div>
                              <span className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-white">
                                Открыть чат
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )
          ) : activity === "gifted" || activity === "received" ? (
            (() => {
              const txList = (activity === "gifted" ? gifted : received) ?? [];
              if (txList.length === 0) {
                return (
                  <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
                    {activity === "gifted"
                      ? "Пока никому не передали подарок"
                      : "Вы пока ничего не получили"}
                  </div>
                );
              }
              return (
                <ul key={activity} className="achievements-list space-y-2">
                  {txList.map((t) => {
                    const g = t.gift;
                    if (!g) return null;
                    const meta = {
                      transaction_id: t.id,
                      last_message_at: t.last_message_at ?? null,
                      last_incoming: !!t.last_incoming,
                    };
                    const unread = isChatUnread(meta, seenChats);
                    return (
                      <li key={t.id}>
                        <Link
                          to="/chat/$giftId"
                          params={{ giftId: g.id }}
                          onClick={() => {
                            haptic("select");
                            markChatSeen(meta);
                          }}
                          className={`flex items-center gap-3 rounded-2xl border p-3 shadow-sm transition active:scale-[0.98] ${
                            unread ? "border-primary bg-primary/10" : "bg-card"
                          }`}
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
                            <p
                              className={`line-clamp-2 text-sm ${unread ? "font-bold" : "font-medium"}`}
                            >
                              {g.title}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {unread ? "● Новое сообщение" : g.category}
                            </p>
                          </div>
                          {t.needs_review && (
                            <span
                              className="shrink-0 rounded-full bg-amber-400/20 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700 dark:text-amber-300"
                              title="Ждёт отзыва"
                            >
                              ✍️
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              );
            })()
          ) : list.length === 0 ? (
            <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
              Вы пока не публиковали подарков
            </div>
          ) : (
            <ul key={activity} className="achievements-list space-y-2">
              {list.map((g) => (
                <EditableActiveItem
                  key={g.id}
                  gift={g}
                  ownerId={user.user_id}
                  userLevel={user.level}
                  myName={user.display_name}
                  onUpdated={(patch) =>
                    setPosted((prev) =>
                      (prev ?? []).map((x) => (x.id === g.id ? { ...x, ...patch } : x)),
                    )
                  }
                  onDeleted={() => setPosted((prev) => (prev ?? []).filter((x) => x.id !== g.id))}
                />
              ))}
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
  myName,
  onUpdated,
  onDeleted,
}: {
  gift: Gift;
  ownerId: string;
  userLevel: number;
  myName: string;
  onUpdated: (patch: Partial<Gift>) => void;
  onDeleted: () => void;
}) {
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [certOpen, setCertOpen] = useState(false);
  const deleteFn = useServerFn(deleteGift);
  const setHiddenFn = useServerFn(setGiftHidden);
  const [hiding, setHiding] = useState(false);
  const isHidden = gift.status === "hidden";
  const isReserved = gift.status === "reserved";
  // Удалять/менять видимость можно, пока подарок не в сделке (свободный/скрытый).
  const canModify = gift.status === "available" || isHidden;
  // Редактировать можно и у забронированного — но только пока сделка «свежая»
  // (это проверяет сервер: нет сообщений в чате и передачу не отмечали).
  const canEdit = canModify || isReserved;

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

  const toggleHidden = async () => {
    setHiding(true);
    try {
      const res = await setHiddenFn({ data: { gift_id: gift.id, hidden: !isHidden } });
      onUpdated({ status: res.status });
      haptic("success");
      toast.success(
        isHidden ? "Подарок снова в общей ленте 💚" : "Скрыт — теперь только по ссылке 🔒",
      );
    } catch {
      toast.error("Не получилось изменить видимость");
    } finally {
      setHiding(false);
    }
  };

  const badge = isHidden ? (
    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
      🔒 Личный — только по ссылке
    </span>
  ) : isReserved ? (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
      ⏳ В брони
    </span>
  ) : null;

  const editBtn = (
    <button
      type="button"
      onClick={() => navigate({ to: "/gift/$giftId/edit", params: { giftId: gift.id } })}
      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border bg-background px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-accent active:scale-95"
    >
      <Pencil className="h-3.5 w-3.5" /> Редактировать
    </button>
  );

  const footer = canModify ? (
    <div className="space-y-2">
      <button
        type="button"
        onClick={toggleHidden}
        disabled={hiding}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border bg-background px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-accent active:scale-95 disabled:opacity-60"
      >
        {hiding ? "…" : isHidden ? "🌍 Показать всем в ленте" : "🔒 Скрыть — подарить по ссылке"}
      </button>
      <button
        type="button"
        onClick={() => setCertOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition hover:bg-primary/15 active:scale-95"
      >
        🎟 Создать сертификат
      </button>
      <div className="flex gap-2">
        {editBtn}
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-destructive/30 bg-background px-3 py-2 text-xs font-semibold text-destructive transition hover:bg-destructive/10 active:scale-95"
        >
          <Trash2 className="h-3.5 w-3.5" /> Удалить
        </button>
      </div>
    </div>
  ) : canEdit ? (
    // Забронированный подарок: можно только уточнить (пока сделка не началась).
    <div className="flex gap-2">{editBtn}</div>
  ) : null;

  return (
    <li>
      <ItemCard
        image={gift.image_url}
        title={gift.title}
        description={gift.description}
        cost={gift.cost}
        category={gift.category}
        city={gift.city}
        isOnline={gift.is_online}
        highlight={isHidden}
        badge={badge}
        onShare={() => shareGift(gift.id, gift.title)}
        footer={footer}
      />

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

      {certOpen && (
        <CertificateBuilder
          giftId={gift.id}
          giftTitle={gift.title}
          myName={myName}
          onClose={() => setCertOpen(false)}
          onCreated={() => onUpdated({ status: "hidden" })}
        />
      )}
    </li>
  );
}

function MyWishItem({
  w,
  onOpen,
  onChanged,
}: {
  w: MyWish;
  onOpen?: (wishId: string) => void;
  onChanged?: (id: string, status: string) => void;
}) {
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

  const badge = isHidden ? (
    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
      🌌 Скрыто — во Вселенной
    </span>
  ) : w.status === "reserved" ? (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
      ⏳ В работе
    </span>
  ) : w.status !== "open" ? (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
      ✅ Исполнено
    </span>
  ) : null;

  const footer = canToggle ? (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className="flex w-full items-center justify-center gap-1.5 rounded-xl border bg-background px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-accent active:scale-95 disabled:opacity-60"
    >
      {busy ? "…" : isHidden ? "🌍 Открыть для всех" : "🌌 Скрыть — во Вселенной"}
    </button>
  ) : null;

  return (
    <li>
      <ItemCard
        image={w.image_url}
        title={w.title}
        category={w.category}
        city={w.city}
        isOnline={w.is_online}
        emptyEmoji="✨"
        highlight={isHidden}
        badge={badge}
        onOpen={() => {
          haptic("select");
          onOpen?.(w.id);
        }}
        onShare={() => shareWish(w.id, w.title)}
        footer={footer}
      />
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
        <Link
          to="/friends"
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-2xl border px-3 py-2 text-xs font-medium text-muted-foreground transition active:scale-[0.98] hover:bg-accent"
        >
          👯 Мои люди — друзья, кому дарил(а), кто дарил(а) мне
        </Link>
      </section>
    </>
  );
}
