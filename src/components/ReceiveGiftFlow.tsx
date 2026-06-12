import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Search, Lock } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { GIFT_KINDS, getKindMeta, type GiftKind } from "@/lib/gift-kinds";
import { getCategoryMeta } from "@/lib/gift-categories";
import { LevelBadge } from "@/components/LevelBadge";
import { emitTour } from "@/lib/tour";


function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} дн назад`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w} нед назад`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} мес назад`;
  return `${Math.floor(d / 365)} г назад`;
}

type Gift = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  image_url: string | null;
  cost: number;
  condition: number | null;
  owner_id: string | null;
  gift_kind: GiftKind;
  created_at?: string;
  owner_name?: string;
  owner_level?: number;
};

type Step = "kinds" | "categories" | "feed" | "search";

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

export function ReceiveGiftFlow({
  onBack,
  onPick,
  onCreateWish,
  userLevel,
}: {
  onBack: () => void;
  onPick: (giftId: string) => void;
  onCreateWish?: () => void;
  userLevel: number;
}) {
  const [step, setStep] = useState<Step>("kinds");

  // Мягкая ветка, когда подходящего подарка нет
  const NothingHere = ({ note }: { note?: string }) => (
    <div className="rounded-2xl border border-mint/40 bg-mint/10 p-4 text-sm">
      <p className="font-medium">{note ?? "Пока нет того, что ты ищешь — и это нормально 🌿"}</p>
      <p className="mt-1 text-muted-foreground">
        Новые подарки появляются каждый день — заглядывай 💚. А лучше — загадай
        желание: дарители увидят, что ты ищешь, и подарят именно тебе.
      </p>
      {onCreateWish && (
        <button
          onClick={onCreateWish}
          className="mt-3 w-full rounded-xl bg-mint py-2.5 text-sm font-semibold text-mint-foreground transition active:scale-[0.98]"
        >
          ✨ Загадать желание
        </button>
      )}
    </div>
  );
  const [gifts, setGifts] = useState<Gift[] | null>(null);
  const [kind, setKind] = useState<GiftKind | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [listening, setListening] = useState(false);
  const recRef = useRef<SR | null>(null);

  useEffect(() => {
    emitTour("receive-opened");
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      let q = supabase
        .from("gifts")
        .select("id,title,description,category,image_url,cost,condition,owner_id,gift_kind,created_at")
        .eq("status", "available")
        .not("owner_id", "is", null)
        .order("created_at", { ascending: false });
      if (user?.id) q = q.neq("owner_id", user.id);
      const { data } = await q;
      const rows = (data as Gift[]) ?? [];
      const ownerIds = Array.from(
        new Set(rows.map((g) => g.owner_id).filter((v): v is string => !!v)),
      );
      let nameMap = new Map<string, string>();
      let levelMap = new Map<string, number>();
      if (ownerIds.length) {
        const { data: profs } = await supabase
          .rpc("get_public_profiles", { _user_ids: ownerIds });
        const list = (profs ?? []) as Array<{ user_id: string; display_name: string; level: number }>;
        nameMap = new Map(list.map((p) => [p.user_id, p.display_name || "Гость"]));
        levelMap = new Map(list.map((p) => [p.user_id, p.level ?? 1]));
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
      setStep("search");
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recRef.current = r;
    r.start();
    setListening(true);
  };

  if (!gifts) {
    return (
      <div className="mx-auto w-full max-w-md space-y-3 px-5 py-10">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const renderCard = (g: Gift) => (
    <Card key={g.id} className="overflow-hidden p-3">
      <div className="flex gap-3">
        {g.image_url ? (
          <img
            src={g.image_url}
            alt={g.title}
            className="h-20 w-20 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-muted text-3xl">
            🎁
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-base font-semibold leading-tight break-words">{g.title}</div>
          {g.condition ? (
            <div
              className="flex items-center gap-0.5 text-sm leading-none"
              aria-label={`Состояние ${g.condition} из 5`}
              title={`Состояние: ${g.condition} из 5`}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <span key={n}>{n <= g.condition! ? "❤️" : "🤍"}</span>
              ))}
            </div>
          ) : null}
          {g.description && (
            <p className="line-clamp-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
              {g.description}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {g.owner_id ? (
              <Link
                to="/user/$userId"
                params={{ userId: g.owner_id }}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                {g.owner_name ?? "Гость"}
              </Link>
            ) : (
              <span className="font-medium text-foreground">{g.owner_name ?? "Гость"}</span>
            )}
            <LevelBadge level={g.owner_level ?? 1} />

            <span>· {timeAgo(g.created_at)}</span>
          </div>
        </div>
      </div>
      <Button
        onClick={() => onPick(g.id)}
        className="mt-3 w-full rounded-xl bg-mint text-mint-foreground hover:bg-mint/90"
        size="sm"
      >
        🎁 Получить за {g.cost ?? 1} балл
      </Button>
    </Card>
  );


  // Search step
  if (step === "search") {
    const q = query.trim().toLowerCase();
    const unlockedKinds = new Set(
      GIFT_KINDS.filter((k) => userLevel >= k.minLevel).map((k) => k.id),
    );
    const pool = gifts.filter((g) => unlockedKinds.has(g.gift_kind));
    const results = q
      ? pool.filter(
          (g) =>
            g.title.toLowerCase().includes(q) ||
            g.category.toLowerCase().includes(q) ||
            (g.description ?? "").toLowerCase().includes(q),
        )
      : pool;
    return (
      <div className="mx-auto w-full max-w-md px-5 py-8">
        <button
          onClick={() => setStep("kinds")}
          className="mb-4 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← К категориям
        </button>
        <h2 className="mb-3 text-2xl font-semibold">Умный поиск</h2>
        <div className="mb-5 flex items-center gap-2 rounded-2xl border bg-card px-3 py-2 shadow-sm">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Что бы тебе хотелось получить?"
            className="flex-1 bg-transparent text-sm outline-none"
          />
          <button
            onClick={toggleMic}
            className={`flex h-8 w-8 items-center justify-center rounded-full border ${
              listening ? "bg-destructive text-destructive-foreground" : "bg-background"
            }`}
            aria-label="Голос"
          >
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
        </div>
        <div className="space-y-3">
          {results.length === 0 ? (
            <NothingHere note="По запросу ничего не нашлось 🌿" />
          ) : (
            results.map(renderCard)
          )}
        </div>
      </div>
    );
  }

  // Top level: kinds (always visible, locked for low levels)
  if (step === "kinds") {
    const countsByKind = new Map<string, number>();
    for (const g of gifts) countsByKind.set(g.gift_kind, (countsByKind.get(g.gift_kind) ?? 0) + 1);

    return (
      <div className="mx-auto w-full max-w-md px-5 py-8">
        <button
          onClick={onBack}
          className="mb-4 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Назад
        </button>

        {GIFT_KINDS.some((k) => userLevel < k.minLevel) && (
          <div className="mb-5 rounded-2xl bg-peach/40 p-4 text-sm">
            🎉 У тебя есть подарочные баллы. Категории открываются по уровню — твой сейчас: <b>{userLevel}</b>.
          </div>
        )}

        <h2 className="mb-1 text-2xl font-semibold">Что бы тебе хотелось?</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Выбери категорию подарка
        </p>

        <div className="grid grid-cols-2 gap-3">
          {GIFT_KINDS.map((k) => {
            const locked = userLevel < k.minLevel;
            const n = countsByKind.get(k.id) ?? 0;
            return (
              <button
                key={k.id}
                onClick={() => {
                  if (locked) {
                    toast(`🔒 ${k.shortLabel}`, {
                      description: `Откроется на ${k.minLevel} уровне. Дари и получай подарки — и ты дойдёшь сюда!`,
                    });
                    return;
                  }
                  setKind(k.id);
                  setCategory(null);
                  setStep("categories");
                  emitTour("kind-picked");
                }}
                aria-disabled={locked}
                className={`relative rounded-2xl border bg-card p-4 text-left shadow-sm transition ${
                  locked ? "cursor-not-allowed opacity-60" : "hover:bg-accent hover:-translate-y-0.5"
                }`}
              >
                <div className="mb-1 text-2xl">{k.emoji}</div>
                <div className="text-sm font-medium">{k.shortLabel}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {locked ? (
                    <span className="inline-flex items-center gap-1">
                      <Lock className="h-3 w-3" /> Откроется на ур. {k.minLevel}
                    </span>
                  ) : (
                    <>{n} {n === 1 ? "подарок" : "подарков"}</>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex items-center gap-2 rounded-2xl border bg-card px-3 py-2 shadow-sm">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => query && setStep("search")}
            placeholder="Опиши, что тебе нужно…"
            className="flex-1 bg-transparent text-sm outline-none"
          />
          <button
            onClick={toggleMic}
            className={`flex h-8 w-8 items-center justify-center rounded-full border ${
              listening ? "bg-destructive text-destructive-foreground" : "bg-background"
            }`}
            aria-label="Голос"
          >
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
        </div>
      </div>
    );
  }

  // Within a kind: show its sub-categories
  if (step === "categories" && kind) {
    const kindMeta = getKindMeta(kind);
    const inKind = gifts.filter((g) => g.gift_kind === kind);
    const counts = new Map<string, number>();
    for (const g of inKind) counts.set(g.category, (counts.get(g.category) ?? 0) + 1);
    const cats = [...counts.entries()].sort((a, b) => b[1] - a[1]);

    return (
      <div className="mx-auto w-full max-w-md px-5 py-8">
        <button
          onClick={() => setStep("kinds")}
          className="mb-4 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← К категориям
        </button>
        <h2 className="mb-1 text-2xl font-semibold">
          {kindMeta?.emoji} {kindMeta?.shortLabel}
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Доступно {inKind.length} {inKind.length === 1 ? "подарок" : "подарков"}
        </p>

        {cats.length === 0 ? (
          <NothingHere note="В этой категории пока пусто 💚" />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {cats.map(([cat, n]) => {
              const meta = getCategoryMeta(cat);
              return (
                <button
                  key={cat}
                  onClick={() => {
                    setCategory(cat);
                    setStep("feed");
                    emitTour("subcat-picked");
                  }}
                  className="rounded-2xl border bg-card p-4 text-left shadow-sm transition hover:bg-accent"
                >
                  <div className="mb-1 text-2xl">{meta.emoji}</div>
                  <div className="text-sm font-medium">{meta.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {n} {n === 1 ? "подарок" : "подарков"}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const filtered = gifts.filter((g) => g.gift_kind === kind && g.category === category);

  return (
    <div className="mx-auto w-full max-w-md px-5 py-8">
      <button
        onClick={() => setStep("categories")}
        className="mb-4 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← К категориям
      </button>
      <h2 className="mb-1 text-2xl font-semibold capitalize">{category}</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        {filtered.length} {filtered.length === 1 ? "подарок" : "подарков"} доступно
      </p>

      <div className="space-y-3">{filtered.map(renderCard)}</div>
    </div>
  );
}
