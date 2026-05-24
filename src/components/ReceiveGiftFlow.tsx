import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

type Gift = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  image_url: string | null;
  cost: number;
  owner_id: string | null;
  owner_name?: string;
};

type Step = "categories" | "feed" | "search";

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
}: {
  onBack: () => void;
  onPick: (giftId: string) => void;
}) {
  const [step, setStep] = useState<Step>("categories");
  const [gifts, setGifts] = useState<Gift[] | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [listening, setListening] = useState(false);
  const recRef = useRef<SR | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      let q = supabase
        .from("gifts")
        .select("id,title,description,category,image_url,cost,owner_id")
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
      if (ownerIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id,display_name")
          .in("user_id", ownerIds);
        nameMap = new Map(
          (profs ?? []).map((p) => [p.user_id as string, (p.display_name as string) || "Гость"]),
        );
      }
      setGifts(
        rows.map((g) => ({
          ...g,
          owner_name: g.owner_id ? nameMap.get(g.owner_id) ?? "Гость" : "Гость",
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
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-muted text-2xl">
            🎁
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{g.title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground capitalize">{g.category}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Даритель: <span className="font-medium text-foreground">{g.owner_name ?? "Гость"}</span>
          </div>
          {g.description && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{g.description}</p>
          )}
        </div>
      </div>
      <Button
        onClick={() => onPick(g.id)}
        className="mt-3 w-full rounded-xl bg-mint text-mint-foreground hover:bg-mint/90"
        size="lg"
      >
        🎁 Забрать за {g.cost ?? 1} балл
      </Button>
    </Card>
  );

  // Search step
  if (step === "search") {
    const q = query.trim().toLowerCase();
    const results = q
      ? gifts.filter(
          (g) =>
            g.title.toLowerCase().includes(q) ||
            g.category.toLowerCase().includes(q) ||
            (g.description ?? "").toLowerCase().includes(q),
        )
      : gifts;
    return (
      <div className="mx-auto w-full max-w-md px-5 py-8">
        <button
          onClick={() => setStep("categories")}
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
            <p className="text-sm text-muted-foreground">Ничего не нашлось 🌿 Попробуй иначе.</p>
          ) : (
            results.map(renderCard)
          )}
        </div>
      </div>
    );
  }

  if (step === "categories") {
    const counts = new Map<string, number>();
    for (const g of gifts) counts.set(g.category, (counts.get(g.category) ?? 0) + 1);
    const cats = [...counts.entries()].sort((a, b) => b[1] - a[1]);

    return (
      <div className="mx-auto w-full max-w-md px-5 py-8">
        <button
          onClick={onBack}
          className="mb-4 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Назад
        </button>

        <div className="mb-5 rounded-2xl bg-peach/40 p-4 text-sm">
          🎉 Добро пожаловать! У тебя есть подарочные баллы — на них можно выбрать подарок (1 балл за любой подарок). Что бы тебе хотелось получить прямо сейчас?
        </div>

        <h2 className="mb-1 text-2xl font-semibold">Выбери категорию</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Доступно {gifts.length} {gifts.length === 1 ? "подарок" : "подарков"}.
        </p>

        <div className="mb-5 flex items-center gap-2 rounded-2xl border bg-card px-3 py-2 shadow-sm">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => query && setStep("search")}
            placeholder="Или опиши голосом, что тебе нужно…"
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

        {cats.length === 0 ? (
          <p className="text-muted-foreground">Пока нет активных подарков 💚</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {cats.map(([cat, n]) => (
              <button
                key={cat}
                onClick={() => {
                  setCategory(cat);
                  setStep("feed");
                }}
                className="rounded-2xl border bg-card p-4 text-left shadow-sm transition hover:bg-accent"
              >
                <div className="text-base font-medium capitalize">{cat}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {n} {n === 1 ? "подарок" : "подарков"}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const filtered = gifts.filter((g) => g.category === category);

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
