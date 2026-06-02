import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Gift as GiftIcon, HandHeart, Search } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { Skeleton } from "@/components/ui/skeleton";
import { WishesFeed } from "@/components/WishesFeed";
import { LevelBadge } from "@/components/LevelBadge";
import { getHomeStats } from "@/lib/cozy.functions";

import {
  pickRandom,
  HOME_TAGLINES,
  GIVE_EXAMPLES,
  RECEIVE_EXAMPLES,
} from "@/lib/random-copy";

type Gift = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  image_url: string | null;
  cost: number;
  owner_id: string | null;
  created_at?: string;
  owner_name?: string;
  owner_level?: number;
};

interface Props {
  userName: string;
  onGive: () => void;
  onReceive: () => void;
  onPickGift: (giftId: string) => void;
  onCreateWish?: () => void;
  onOpenWish?: (wishId: string) => void;
  initialFeedTab?: "gifts" | "wishes";
}

type Stats = { active_gifts: number; gifted_total: number; wishes_fulfilled: number };

export function HomeTab({ userName, onGive, onReceive, onPickGift: _onPickGift, onCreateWish, onOpenWish, initialFeedTab = "gifts" }: Props) {
  const [gifted, setGifted] = useState<Gift[] | null>(null);
  const [feedTab, setFeedTab] = useState<"gifts" | "wishes">(initialFeedTab);
  const [stats, setStats] = useState<Stats | null>(null);
  const [query, setQuery] = useState("");
  const statsFn = useServerFn(getHomeStats);

  const tagline = useMemo(() => pickRandom(HOME_TAGLINES), []);
  const giveSub = useMemo(() => pickRandom(GIVE_SUBTITLES), []);
  const receiveSub = useMemo(() => pickRandom(RECEIVE_SUBTITLES), []);

  // Лента уже подаренных подарков
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("gifts")
        .select("id,title,description,category,image_url,cost,owner_id,created_at")
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
        for (const p of ((profs ?? []) as Array<{ user_id: string; display_name: string; level: number }>)) {
          nameMap.set(p.user_id, p.display_name || "Гость");
          levelMap.set(p.user_id, p.level ?? 1);
        }
      }
      setGifted(
        rows.map((g) => ({
          ...g,
          owner_name: g.owner_id ? nameMap.get(g.owner_id) ?? "Гость" : "Гость",
          owner_level: g.owner_id ? levelMap.get(g.owner_id) ?? 1 : 1,
        })),
      );
    })();
  }, []);

  useEffect(() => {
    statsFn().then((s) => setStats(s as Stats)).catch(() => setStats(null));
  }, [statsFn]);

  const q = query.trim().toLowerCase();
  const filteredGifted = useMemo(() => {
    if (!gifted || !q) return gifted;
    return gifted.filter(
      (g) =>
        g.title.toLowerCase().includes(q) ||
        (g.description && g.description.toLowerCase().includes(q)) ||
        (g.owner_name && g.owner_name.toLowerCase().includes(q)),
    );
  }, [gifted, q]);

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
      </header>

      {/* Action duo — сразу под приветствием */}
      <div className="mb-5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => { haptic("medium"); onGive(); }}
          className="group relative flex flex-col items-start justify-between overflow-hidden rounded-2xl bg-lavender p-3 text-left text-lavender-foreground shadow-sm transition-all duration-300 active:scale-[0.97]"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-background/60 backdrop-blur">
            <HandHeart className="h-4 w-4" />
          </div>
          <div className="mt-3">
            <div className="text-sm font-semibold leading-tight">Подарить</div>
            <div className="text-[11px] opacity-75">{giveSub}</div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => { haptic("medium"); onReceive(); }}
          className="group relative flex flex-col items-start justify-between overflow-hidden rounded-2xl bg-mint p-3 text-left text-mint-foreground shadow-sm transition-all duration-300 active:scale-[0.97]"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-background/60 backdrop-blur">
            <GiftIcon className="h-4 w-4" />
          </div>
          <div className="mt-3">
            <div className="text-sm font-semibold leading-tight">Получить</div>
            <div className="text-[11px] opacity-75">{receiveSub}</div>
          </div>
        </button>
      </div>

      {/* Search */}
      <div className="mb-4 flex items-center gap-2 rounded-2xl border bg-card px-3 py-2.5 shadow-sm">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по ленте…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
        />
      </div>

      {/* Жизнь сервиса — компактная панель статистики */}
      {stats && (
        <section className="mb-5 rounded-2xl border bg-card/60 p-3 shadow-sm">
          <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Жизнь сервиса
          </h2>
          <div className="flex flex-wrap items-center justify-between gap-1 text-[12px] text-muted-foreground">
            <span><b className="text-foreground tabular-nums">{stats.active_gifts}</b> 🎁 активных</span>
            <span className="opacity-40">·</span>
            <span><b className="text-foreground tabular-nums">{stats.gifted_total}</b> 💝 подарено</span>
            <span className="opacity-40">·</span>
            <span><b className="text-foreground tabular-nums">{stats.wishes_fulfilled}</b> ⭐ желаний</span>
          </div>
        </section>
      )}

      {/* Feed tabs: Подарили / Загадали */}
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl border bg-muted/60 p-1">
        {([
          ["gifts", "💝 Подарили"],
          ["wishes", "✨ Загадали"],
        ] as const).map(([k, label]) => {
          const active = feedTab === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => {
                if (!active) {
                  haptic("select");
                  setFeedTab(k);
                }
              }}
              className={`rounded-xl px-2 py-1.5 text-[12.5px] font-medium transition-all duration-300 ${
                active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {feedTab === "gifts" ? (
        <section>
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
      ) : (
        <section>
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Ждут исполнения</h2>
          </div>
          <WishesFeed
            searchQuery={query}
            onCreate={() => onCreateWish?.()}
            onOpen={(id) => onOpenWish?.(id)}
          />
        </section>
      )}
    </div>
  );
}

function GiftedCard({ gift }: { gift: Gift }) {
  // Карточка целиком ведёт на страницу дарителя (его активные подарки + загаданные желания)
  if (!gift.owner_id) return null;
  return (
    <li>
      <Link
        to="/user/$userId"
        params={{ userId: gift.owner_id }}
        onClick={() => haptic("light")}
        className="relative flex gap-3 rounded-2xl border bg-card p-3 shadow-sm transition active:scale-[0.98]"
      >
        {gift.image_url ? (
          <img
            src={gift.image_url}
            alt={gift.title}
            className="h-20 w-20 shrink-0 rounded-xl object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-muted text-3xl">
            🎁
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold leading-tight">
            {gift.title}
          </div>
          {gift.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {gift.description}
            </p>
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
        </div>
      </Link>
    </li>
  );
}
