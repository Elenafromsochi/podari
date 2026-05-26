import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Mic, MicOff, Search, Sparkles, Gift as GiftIcon, HandHeart } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { Skeleton } from "@/components/ui/skeleton";
import { WishesFeed } from "@/components/WishesFeed";
import {
  pickRandom,
  HOME_TAGLINES,
  GIVE_SUBTITLES,
  RECEIVE_SUBTITLES,
  FEED_TITLES,
  WISH_FEED_TITLES,
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

type SR = {
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
};

interface Props {
  userName: string;
  onGive: () => void;
  onReceive: () => void;
  onPickGift: (giftId: string) => void;
  onCreateWish?: () => void;
  onOpenWish?: (wishId: string) => void;
}

export function HomeTab({ userName, onGive, onReceive, onPickGift, onCreateWish, onOpenWish }: Props) {
  const [gifts, setGifts] = useState<Gift[] | null>(null);
  const [query, setQuery] = useState("");
  const [listening, setListening] = useState(false);
  const [feedTab, setFeedTab] = useState<"gifts" | "wishes">("gifts");
  const recRef = useRef<SR | null>(null);

  const tagline = useMemo(() => pickRandom(HOME_TAGLINES), []);
  const giveSub = useMemo(() => pickRandom(GIVE_SUBTITLES), []);
  const receiveSub = useMemo(() => pickRandom(RECEIVE_SUBTITLES), []);
  const feedTitle = useMemo(() => pickRandom(FEED_TITLES), []);
  const wishesTitle = useMemo(() => pickRandom(WISH_FEED_TITLES), []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      let q = supabase
        .from("gifts")
        .select("id,title,description,category,image_url,cost,owner_id,created_at")
        .eq("status", "gifted")
        .not("owner_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(40);
      if (user?.id) q = q.neq("owner_id", user.id);
      const { data } = await q;
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
      setGifts(
        rows.map((g) => ({
          ...g,
          owner_name: g.owner_id ? nameMap.get(g.owner_id) ?? "Гость" : "Гость",
          owner_level: g.owner_id ? levelMap.get(g.owner_id) ?? 1 : 1,
        })),
      );

    })();
  }, []);

  const toggleMic = () => {
    const W = window as unknown as {
      SpeechRecognition?: new () => SR;
      webkitSpeechRecognition?: new () => SR;
    };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) return;
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const r = new Ctor();
    r.lang = "ru-RU";
    r.continuous = false;
    r.interimResults = true;
    r.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      setQuery(t);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recRef.current = r;
    haptic("light");
    r.start();
    setListening(true);
  };

  const q = query.trim().toLowerCase();
  const filtered = !gifts
    ? []
    : q
      ? gifts.filter(
          (g) =>
            g.title.toLowerCase().includes(q) ||
            g.category.toLowerCase().includes(q) ||
            (g.description ?? "").toLowerCase().includes(q),
        )
      : gifts;

  return (
    <div className="mx-auto w-full max-w-md px-5 pb-6 pt-7">
      {/* Greeting */}
      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Привет
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{userName} ✨</h1>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">{tagline}</p>
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-peach shadow-sm">
          <Sparkles className="h-5 w-5 text-peach-foreground" />
        </div>
      </header>

      {/* Action duo */}
      <div className="mb-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => {
            haptic("medium");
            onGive();
          }}
          className="group relative flex flex-col items-start justify-between overflow-hidden rounded-3xl bg-lavender p-4 text-left text-lavender-foreground shadow-sm transition-all duration-300 active:scale-[0.97]"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-background/60 backdrop-blur">
            <HandHeart className="h-5 w-5" />
          </div>
          <div className="mt-6">
            <div className="text-[15px] font-semibold leading-tight">✨ Подарить</div>
            <div className="text-xs opacity-75">{giveSub}</div>
          </div>
          <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-background/20 blur-2xl transition group-hover:scale-125" />
        </button>
        <button
          type="button"
          onClick={() => {
            haptic("medium");
            onReceive();
          }}
          className="group relative flex flex-col items-start justify-between overflow-hidden rounded-3xl bg-mint p-4 text-left text-mint-foreground shadow-sm transition-all duration-300 active:scale-[0.97]"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-background/60 backdrop-blur">
            <GiftIcon className="h-5 w-5" />
          </div>
          <div className="mt-6">
            <div className="text-[15px] font-semibold leading-tight">🎁 Забрать</div>
            <div className="text-xs opacity-75">{receiveSub}</div>
          </div>
          <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-background/20 blur-2xl transition group-hover:scale-125" />
        </button>
      </div>

      {/* Search */}
      <div className="mb-5 flex items-center gap-2 rounded-2xl border bg-card px-3 py-2.5 shadow-sm">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найди подарок или опиши голосом…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
        />
        <button
          type="button"
          onClick={toggleMic}
          aria-label="Голос"
          className={`flex h-8 w-8 items-center justify-center rounded-xl transition ${
            listening
              ? "bg-destructive text-destructive-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
      </div>

      {/* Feed tabs */}
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl border bg-muted/60 p-1">
        {([
          ["gifts", "🎁 Подарки"],
          ["wishes", "✨ Желания"],
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
            <h2 className="text-lg font-semibold tracking-tight">Подаренные подарки</h2>
            <span className="text-xs text-muted-foreground">
              {gifts ? `${filtered.length}` : ""}
            </span>
          </div>

          {!gifts ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
              Пока никто ничего не подарил 🌱
            </div>
          ) : (
            <ul className="space-y-3">
              {filtered.map((g) => (
                <GiftedCard key={g.id} gift={g} />
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section>
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-lg font-semibold tracking-tight">{wishesTitle}</h2>
          </div>
          <WishesFeed
            onCreate={() => onCreateWish?.()}
            onOpen={(id) => onOpenWish?.(id)}
          />
        </section>
      )}
    </div>
  );
}

function GiftedCard({ gift }: { gift: Gift }) {
  return (
    <li>
      <article className="relative flex gap-3 rounded-2xl border bg-card p-3 shadow-sm">
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
            {gift.owner_id ? (
              <Link
                to="/user/$userId"
                params={{ userId: gift.owner_id }}
                onClick={() => haptic("light")}
                className="text-[15px] font-semibold leading-tight text-lavender-foreground bg-lavender/70 hover:bg-lavender rounded-lg px-2 py-0.5 transition"
              >
                {gift.owner_name}
              </Link>
            ) : (
              <span className="text-[15px] font-semibold leading-tight">{gift.owner_name}</span>
            )}
            <span className="inline-flex items-center rounded-full bg-peach/60 px-1.5 py-0.5 text-[10px] font-semibold text-peach-foreground">
              ур. {gift.owner_level ?? 1}
            </span>
          </div>
        </div>
      </article>
    </li>
  );
}


