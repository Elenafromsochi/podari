import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  Sparkles,
  Gift as GiftIcon,
  HandHeart,
  Search,
  Compass,
  Send,
  Pencil,
  Trash2,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { haptic } from "@/lib/haptics";
import { shareGift } from "@/lib/share";
import { restartTour } from "@/lib/tour";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Stars } from "@/components/ui/stars";
import { WishesFeed } from "@/components/WishesFeed";
import { LevelBadge } from "@/components/LevelBadge";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { getHomeStats, deleteGift } from "@/lib/cozy.functions";

import { pickRandom, HOME_TAGLINES, GIVE_EXAMPLES, RECEIVE_EXAMPLES } from "@/lib/random-copy";
import { useTourState } from "@/lib/tour";

type Gift = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  image_url: string | null;
  image_urls?: string[] | null;
  cost: number;
  condition?: number | null;
  quantity?: number | null;
  quantity_remaining?: number | null;
  owner_id: string | null;
  created_at?: string;
  owner_name?: string;
  owner_level?: number;
};

type FeedTab = "active" | "wishes" | "gifted";

interface Props {
  userName: string;
  onGive: () => void;
  onReceive: (query?: string) => void;
  onPickGift: (giftId: string) => void;
  onCreateWish?: () => void;
  onOpenWish?: (wishId: string) => void;
  onOpenProfile?: () => void;
  initialFeedTab?: FeedTab;
}

type Stats = { active_gifts: number; gifted_total: number; wishes_open: number };

export function HomeTab({
  userName,
  onGive,
  onReceive,
  onPickGift,
  onCreateWish,
  onOpenWish,
  onOpenProfile,
  initialFeedTab = "active",
}: Props) {
  const [gifted, setGifted] = useState<Gift[] | null>(null);
  const [activeGifts, setActiveGifts] = useState<Gift[] | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [feedTab, setFeedTab] = useState<FeedTab>(initialFeedTab);
  const [stats, setStats] = useState<Stats | null>(null);
  const [query, setQuery] = useState("");
  const statsFn = useServerFn(getHomeStats);

  const tagline = useMemo(() => pickRandom(HOME_TAGLINES), []);
  const [giveIdx, setGiveIdx] = useState(() => Math.floor(Math.random() * GIVE_EXAMPLES.length));
  const [receiveIdx, setReceiveIdx] = useState(() =>
    Math.floor(Math.random() * RECEIVE_EXAMPLES.length),
  );

  useEffect(() => {
    const t = setInterval(() => {
      setGiveIdx((i) => (i + 1) % GIVE_EXAMPLES.length);
      setReceiveIdx((i) => (i + 1) % RECEIVE_EXAMPLES.length);
    }, 30000);
    return () => clearInterval(t);
  }, []);

  // Гид по сервису: для шага home-wishes автоматически переключаем фид на «Загадали»,
  // а для home-gifted — на «Подарили», чтобы было что подсветить.
  const tour = useTourState();
  useEffect(() => {
    if (tour.step === "home-wishes") setFeedTab("wishes");
    else if (tour.step === "home-gifted") setFeedTab("gifted");
  }, [tour.step]);

  // Лента уже подаренных подарков
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("gifts")
        .select(
          "id,title,description,category,image_url,image_urls,cost,condition,owner_id,created_at",
        )
        .eq("status", "gifted")
        .not("owner_id", "is", null)
        .order("updated_at", { ascending: false })
        .limit(60);
      const rows = (data as Gift[]) ?? [];
      const ids = Array.from(new Set(rows.map((g) => g.owner_id).filter((v): v is string => !!v)));
      const nameMap = new Map<string, string>();
      const levelMap = new Map<string, number>();
      if (ids.length) {
        const { data: profs } = await supabase.rpc("get_public_profiles", { _user_ids: ids });
        for (const p of (profs ?? []) as Array<{
          user_id: string;
          display_name: string;
          level: number;
        }>) {
          nameMap.set(p.user_id, p.display_name || "Гость");
          levelMap.set(p.user_id, p.level ?? 1);
        }
      }
      setGifted(
        rows.map((g) => ({
          ...g,
          owner_name: g.owner_id ? (nameMap.get(g.owner_id) ?? "Гость") : "Гость",
          owner_level: g.owner_id ? (levelMap.get(g.owner_id) ?? 1) : 1,
        })),
      );
    })();
  }, []);

  // Лента активных (доступных) подарков — свежие сверху.
  useEffect(() => {
    (async () => {
      // Сначала пробуем с полями тиража; если миграция ещё не накатана — без них.
      const giftQ = (cols: string) =>
        supabase
          .from("gifts")
          .select(cols)
          .eq("status", "available")
          .not("owner_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(60);
      let res = await giftQ(
        "id,title,description,category,image_url,image_urls,cost,condition,owner_id,created_at,quantity,quantity_remaining",
      );
      if (res.error)
        res = await giftQ(
          "id,title,description,category,image_url,image_urls,cost,condition,owner_id,created_at",
        );
      const rows = (res.data as unknown as Gift[]) ?? [];
      const ids = Array.from(new Set(rows.map((g) => g.owner_id).filter((v): v is string => !!v)));
      const nameMap = new Map<string, string>();
      const levelMap = new Map<string, number>();
      if (ids.length) {
        const { data: profs } = await supabase.rpc("get_public_profiles", { _user_ids: ids });
        for (const p of (profs ?? []) as Array<{
          user_id: string;
          display_name: string;
          level: number;
        }>) {
          nameMap.set(p.user_id, p.display_name || "Гость");
          levelMap.set(p.user_id, p.level ?? 1);
        }
      }
      setActiveGifts(
        rows.map((g) => ({
          ...g,
          owner_name: g.owner_id ? (nameMap.get(g.owner_id) ?? "Гость") : "Гость",
          owner_level: g.owner_id ? (levelMap.get(g.owner_id) ?? 1) : 1,
        })),
      );
    })();
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setMeId(data.session?.user?.id ?? null));
  }, []);

  useEffect(() => {
    statsFn()
      .then((s) => setStats(s as Stats))
      .catch(() => setStats(null));
  }, [statsFn]);

  const q = query.trim().toLowerCase();
  const matchGift = (g: Gift) =>
    g.title.toLowerCase().includes(q) ||
    (g.description && g.description.toLowerCase().includes(q)) ||
    (g.owner_name && g.owner_name.toLowerCase().includes(q));
  const filteredGifted = useMemo(() => {
    if (!gifted || !q) return gifted;
    return gifted.filter(matchGift);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gifted, q]);
  const filteredActive = useMemo(() => {
    if (!activeGifts || !q) return activeGifts;
    return activeGifts.filter(matchGift);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGifts, q]);

  return (
    <div className="mx-auto w-full max-w-md px-5 pb-6 pt-5">
      {/* Greeting */}
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Привет
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{userName}</h1>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">{tagline}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            haptic("medium");
            restartTour();
          }}
          className="flex shrink-0 flex-col items-center gap-0.5 rounded-2xl bg-primary/10 px-3 py-2 text-primary shadow-sm transition hover:bg-primary/20 active:scale-95"
          aria-label="Открыть гид по сервису"
        >
          <Compass className="h-5 w-5" strokeWidth={2.25} />
          <span className="text-[11px] font-semibold leading-none">Гид</span>
        </button>
      </header>

      {/* Action duo — сразу под приветствием */}
      <div className="mb-5 grid grid-cols-2 gap-2">
        <button
          type="button"
          data-tour="give-btn"
          onClick={() => {
            haptic("medium");
            onGive();
          }}
          className="group relative flex flex-col overflow-hidden rounded-2xl bg-lavender p-3 text-left text-lavender-foreground shadow-sm transition-all duration-300 active:scale-[0.97]"
        >
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-background/60 backdrop-blur">
              <HandHeart className="h-4 w-4" />
            </div>
            <div className="text-sm font-semibold leading-tight">Подарить</div>
          </div>
          <div className="mt-2 h-[30px] text-[11px] leading-[15px] opacity-75 transition-opacity duration-300 line-clamp-2 break-words">
            {GIVE_EXAMPLES[giveIdx]}
          </div>
        </button>
        <button
          type="button"
          data-tour="receive-btn"
          onClick={() => {
            haptic("medium");
            onReceive();
          }}
          className="group relative flex flex-col overflow-hidden rounded-2xl bg-mint p-3 text-left text-mint-foreground shadow-sm transition-all duration-300 active:scale-[0.97]"
        >
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-background/60 backdrop-blur">
              <GiftIcon className="h-4 w-4" />
            </div>
            <div className="text-sm font-semibold leading-tight">Получить</div>
          </div>
          <div className="mt-2 h-[30px] text-[11px] leading-[15px] opacity-75 transition-opacity duration-300 line-clamp-2 break-words">
            {RECEIVE_EXAMPLES[receiveIdx]}
          </div>
        </button>
      </div>

      {/* Search */}
      <div
        data-tour="home-search"
        className="mb-4 flex items-center gap-2 rounded-2xl border bg-card px-3 py-2.5 shadow-sm"
      >
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim()) {
              (e.target as HTMLInputElement).blur();
              onReceive(query.trim());
            }
          }}
          placeholder="Найти подарок…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
        />
        <button
          type="button"
          onClick={() => {
            if (!query.trim()) return;
            haptic("select");
            (document.activeElement as HTMLElement | null)?.blur?.();
            onReceive(query.trim());
          }}
          disabled={!query.trim()}
          aria-label="Искать подарок"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition active:scale-95 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>

      {/* Вкладки ленты со встроенным счётчиком: цифры «жизни сервиса» теперь
          прямо на кнопках — число в «календарной» плитке под названием. */}
      <div
        data-tour="home-stats"
        className="mb-4 grid grid-cols-3 gap-1 rounded-2xl border bg-muted/60 p-1"
      >
        {(
          [
            ["active", "🎁", "Активные", stats?.active_gifts],
            ["wishes", "✨", "Желания", stats?.wishes_open],
            ["gifted", "💝", "Подаренные", stats?.gifted_total],
          ] as const
        ).map(([k, emoji, label, count]) => {
          const active = feedTab === k;
          return (
            <button
              key={k}
              type="button"
              data-tour={`feed-tab-${k}`}
              onClick={() => {
                if (!active) {
                  haptic("select");
                  setFeedTab(k);
                }
              }}
              className={`flex flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-[12.5px] font-medium transition-all duration-300 ${
                active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              <span className="flex items-center gap-1 leading-none">
                <span>{emoji}</span>
                <span>{label}</span>
              </span>
              <span
                className={`inline-flex h-7 min-w-8 items-center justify-center rounded-lg px-1 text-base font-bold tabular-nums tracking-tight transition-colors ${
                  active ? "bg-mint/70 text-mint-foreground" : "bg-background/70 text-foreground/60"
                }`}
              >
                {typeof count === "number" ? count : "·"}
              </span>
            </button>
          );
        })}
      </div>

      {feedTab === "active" ? (
        <section data-tour="feed-active">
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Свежие подарки</h2>
            <span className="text-xs text-muted-foreground">
              {filteredActive ? `${filteredActive.length}` : ""}
            </span>
          </div>

          {!activeGifts ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
            </div>
          ) : filteredActive && filteredActive.length === 0 ? (
            <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
              {q
                ? "Ничего не нашлось 🌿"
                : "Пока нет активных подарков — будь первым, подари что-нибудь 🎁"}
            </div>
          ) : (
            <ul className="space-y-3">
              {filteredActive?.map((g) => (
                <ActiveGiftCard
                  key={g.id}
                  gift={g}
                  onClaim={onPickGift}
                  isMine={g.owner_id === meId}
                  onOpenProfile={onOpenProfile}
                  onDeleted={() =>
                    setActiveGifts((prev) => (prev ?? []).filter((x) => x.id !== g.id))
                  }
                />
              ))}
            </ul>
          )}
        </section>
      ) : feedTab === "wishes" ? (
        <section data-tour="feed-wishes">
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Ждут исполнения</h2>
          </div>
          <WishesFeed
            searchQuery={query}
            onCreate={() => onCreateWish?.()}
            onOpen={(id) => onOpenWish?.(id)}
          />
        </section>
      ) : (
        <section data-tour="feed-gifts">
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Уже нашли хозяев</h2>
            <span className="text-xs text-muted-foreground">
              {filteredGifted ? `${filteredGifted.length}` : ""}
            </span>
          </div>

          {!gifted ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
            </div>
          ) : filteredGifted && filteredGifted.length === 0 ? (
            <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
              {q ? "Ничего не нашлось 🌿" : "Пока никто ничего не подарил 🌱"}
            </div>
          ) : (
            <ul className="space-y-3">
              {filteredGifted?.map((g) => (
                <GiftedCard key={g.id} gift={g} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function giftPhotos(gift: Gift): string[] {
  if (gift.image_urls && gift.image_urls.length > 0) return gift.image_urls.filter(Boolean);
  return gift.image_url ? [gift.image_url] : [];
}

function GiftThumb({ gift, onOpen }: { gift: Gift; onOpen: () => void }) {
  const photos = giftPhotos(gift);
  if (!photos.length) {
    return (
      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-muted text-3xl">
        🎁
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        haptic("light");
        onOpen();
      }}
      aria-label="Посмотреть фото"
      className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl"
    >
      <img src={photos[0]} alt="" className="h-full w-full object-cover" loading="lazy" />
      {photos.length > 1 && (
        <span className="absolute bottom-1 right-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          📷 {photos.length}
        </span>
      )}
    </button>
  );
}

function ActiveGiftCard({
  gift,
  onClaim,
  isMine,
  onOpenProfile,
  onDeleted,
}: {
  gift: Gift;
  onClaim: (giftId: string) => void;
  isMine: boolean;
  onOpenProfile?: () => void;
  onDeleted: () => void;
}) {
  const [lightbox, setLightbox] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const navigate = useNavigate();
  const deleteFn = useServerFn(deleteGift);
  if (!gift.owner_id) return null;

  // Раньше тут был window.confirm(), но в Telegram-вебвью он заблокирован и
  // молча возвращает false — кнопка выглядела «мёртвой». Теперь — AlertDialog.
  const doDelete = async () => {
    try {
      await deleteFn({ data: { id: gift.id } });
      haptic("success");
      setConfirmDelete(false);
      onDeleted();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(
        msg.includes("GIFT_IN_DEAL")
          ? "Нельзя удалить: подарок уже в сделке"
          : "Не удалось удалить",
      );
    }
  };
  const word = gift.cost === 1 ? "балл" : gift.cost < 5 ? "балла" : "баллов";
  const photos = giftPhotos(gift);
  const cardBody = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="truncate text-[15px] font-semibold leading-tight">{gift.title}</div>
        <span className="shrink-0 rounded-lg bg-mint/70 px-2 py-0.5 text-[12px] font-semibold leading-tight text-mint-foreground">
          {gift.cost} {word}
        </span>
      </div>
      {gift.description && (
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{gift.description}</p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="inline-block rounded-lg bg-lavender/70 px-2 py-0.5 text-[12px] font-semibold leading-tight text-lavender-foreground">
          {gift.owner_name}
        </span>
        <LevelBadge level={gift.owner_level ?? 1} />
        {(gift.quantity ?? 1) > 1 ? (
          <span className="inline-block rounded-lg bg-amber-100 px-2 py-0.5 text-[12px] font-semibold leading-tight text-amber-700">
            {/* Число остатка — только в профиле; в ленте всем нейтральный значок. */}
            🔁 можно несколько раз
          </span>
        ) : null}
      </div>
    </>
  );
  return (
    <li className="rounded-2xl border bg-card p-3 shadow-sm">
      <div className="flex gap-3">
        {/* Фото — открывает полноэкранную карусель */}
        <GiftThumb gift={gift} onOpen={() => setLightbox(true)} />
        {/* Свой подарок ведёт в мой профиль (вкладка «Профиль»), чужой — на
            страницу дарителя. */}
        {isMine ? (
          <button
            type="button"
            onClick={() => {
              haptic("light");
              onOpenProfile?.();
            }}
            className="min-w-0 flex-1 text-left transition active:scale-[0.99]"
          >
            {cardBody}
          </button>
        ) : (
          <Link
            to="/user/$userId"
            params={{ userId: gift.owner_id }}
            onClick={() => haptic("light")}
            className="min-w-0 flex-1 transition active:scale-[0.99]"
          >
            {cardBody}
          </Link>
        )}
      </div>

      {/* Прямая бронь: списываем балл и открываем чат с дарителем.
          У своих подарков — управление (ред./удалить), у чужих — кнопка брони.
          «Поделиться» доступно всем. */}
      {isMine ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => navigate({ to: "/gift/$giftId/edit", params: { giftId: gift.id } })}
            className="flex items-center justify-center gap-1.5 rounded-xl border bg-background px-2 py-2 text-xs font-medium transition hover:bg-accent active:scale-[0.98]"
          >
            <Pencil className="h-3.5 w-3.5" /> Изменить
          </button>
          <button
            type="button"
            onClick={() => shareGift(gift.id, gift.title)}
            className="flex items-center justify-center gap-1.5 rounded-xl border bg-background px-2 py-2 text-xs font-medium transition hover:bg-accent active:scale-[0.98]"
          >
            <Share2 className="h-3.5 w-3.5" /> Поделиться
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-destructive/30 bg-background px-2 py-2 text-xs font-medium text-destructive transition hover:bg-destructive/10 active:scale-[0.98]"
          >
            <Trash2 className="h-3.5 w-3.5" /> Удалить
          </button>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => {
              haptic("medium");
              try {
                localStorage.setItem("cozygift_last_claim_cost", String(gift.cost ?? 1));
              } catch {
                /* noop */
              }
              onClaim(gift.id);
            }}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-mint px-4 py-2.5 text-sm font-semibold text-mint-foreground transition active:scale-[0.98] hover:bg-mint/90"
          >
            🎁 Получить за {gift.cost} {word}
          </button>
          <button
            type="button"
            onClick={() => shareGift(gift.id, gift.title)}
            aria-label="Поделиться подарком"
            className="flex h-auto shrink-0 items-center justify-center rounded-xl border bg-background px-3 text-muted-foreground transition hover:bg-accent active:scale-[0.98]"
          >
            <Share2 className="h-4 w-4" />
          </button>
        </div>
      )}

      {lightbox && <PhotoLightbox photos={photos} onClose={() => setLightbox(false)} />}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить подарок?</AlertDialogTitle>
            <AlertDialogDescription>
              Подарок «{gift.title}» исчезнет из ленты. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete}>Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function GiftedCard({ gift }: { gift: Gift }) {
  const [lightbox, setLightbox] = useState(false);
  if (!gift.owner_id) return null;
  const photos = giftPhotos(gift);
  return (
    <li className="relative flex gap-3 rounded-2xl border bg-card p-3 shadow-sm">
      {/* Фото — открывает карусель */}
      <GiftThumb gift={gift} onOpen={() => setLightbox(true)} />
      {/* Контент ведёт на профиль дарителя */}
      <Link
        to="/user/$userId"
        params={{ userId: gift.owner_id }}
        onClick={() => haptic("light")}
        className="min-w-0 flex-1 transition active:scale-[0.99]"
      >
        <div className="truncate text-[15px] font-semibold leading-tight">{gift.title}</div>
        {gift.condition ? (
          <div
            className="mt-0.5 text-sm leading-none"
            aria-label={`Состояние ${gift.condition} из 5`}
            title={`Состояние: ${gift.condition} из 5`}
          >
            <Stars value={gift.condition} />
          </div>
        ) : null}
        {gift.description && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{gift.description}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="rounded-lg bg-lavender/70 px-2 py-0.5 text-[12px] font-semibold leading-tight text-lavender-foreground">
            {gift.owner_name}
          </span>
          <LevelBadge level={gift.owner_level ?? 1} />

          <span className="ml-auto inline-flex items-center rounded-full bg-mint/60 px-2 py-0.5 text-[10px] font-semibold text-mint-foreground">
            💝 подарено
          </span>
        </div>
      </Link>

      {lightbox && <PhotoLightbox photos={photos} onClose={() => setLightbox(false)} />}
    </li>
  );
}
