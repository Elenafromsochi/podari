import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mic, MicOff, Search, Lock, Send, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { GIFT_KINDS, getKindMeta, type GiftKind } from "@/lib/gift-kinds";
import { CityChips } from "@/components/CityChips";
import { applyCityFilter } from "@/lib/city-filter";
import { getCategoryMeta } from "@/lib/gift-categories";
import { APP_BASE_URL } from "@/lib/app-url";
import { LevelBadge } from "@/components/LevelBadge";
import { ItemCard } from "@/components/ItemCard";
import { giftShareVariants, INVITE_VARIANTS, pickRandom } from "@/lib/random-copy";
import { shareLink, thirdVariant } from "@/lib/share";
import { giftRequiredLevel } from "@/lib/levels";
import { LevelGateModal } from "@/components/LevelGateModal";
import { markInvited } from "@/lib/cozy.functions";
import { GiftDetailModal } from "@/components/GiftDetailModal";
import { Stars } from "@/components/ui/stars";
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

/** Карточка подарка в ленте: со стрелкой для раскрытия полного описания
 *  и кликабельным дарителем (ведёт на его профиль). */
function GiftCard({
  g,
  onPick,
  meId,
  userLevel,
  onLocked,
  onOpenDetail,
}: {
  g: Gift;
  onPick: (id: string) => void;
  meId: string | null;
  userLevel: number;
  onLocked: (g: Gift, requiredLevel: number) => void;
  onOpenDetail: (g: Gift) => void;
}) {
  // Подарок «по карману уровню»? И стоимость, и категория задают порог.
  const reqLevel = giftRequiredLevel(getKindMeta(g.gift_kind)?.minLevel, g.cost);
  const lockedByLevel = userLevel < reqLevel;
  // Ссылка ведёт на страницу самого подарка (и засчитывает реферал).
  const shareUrl = `${APP_BASE_URL}/gift/${g.id}${meId ? `?ref=${meId}` : ""}`;
  const image =
    (g.image_urls && g.image_urls.length > 0 ? g.image_urls[0] : g.image_url) ?? null;

  const footer = lockedByLevel ? (
    <Button
      onClick={() => onLocked(g, reqLevel)}
      variant="outline"
      className="w-full rounded-xl border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
      size="sm"
    >
      🔒 Откроется на {reqLevel} уровне
    </Button>
  ) : (
    <Button
      onClick={() => {
        try {
          localStorage.setItem("cozygift_last_claim_cost", String(g.cost ?? 1));
        } catch {
          /* noop */
        }
        onPick(g.id);
      }}
      className="w-full rounded-xl bg-mint text-mint-foreground hover:bg-mint/90"
      size="sm"
    >
      🎁 Получить за {g.cost ?? 1} балл
    </Button>
  );

  return (
    <ItemCard
      image={image}
      title={g.title}
      description={g.description}
      cost={g.cost}
      condition={g.condition}
      ownerName={g.owner_name ?? "Гость"}
      ownerId={g.owner_id}
      ownerLevel={g.owner_level ?? 1}
      city={g.city}
      isOnline={g.is_online}
      meta={timeAgo(g.created_at)}
      onOpen={() => onOpenDetail(g)}
      onShare={() => {
        shareLink(thirdVariant(giftShareVariants(g.title)), shareUrl);
        toast.success("Спасибо, что зовёшь друзей 💚");
      }}
      footer={footer}
    />
  );
}

type Gift = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  image_url: string | null;
  image_urls?: string[] | null;
  cost: number;
  condition: number | null;
  owner_id: string | null;
  gift_kind: GiftKind;
  created_at?: string;
  owner_name?: string;
  owner_level?: number;
  city?: string | null;
  is_online?: boolean | null;
};

type Step = "kinds" | "feed" | "search";

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
  onGive,
  userLevel,
  userXp,
  initialQuery,
}: {
  onBack: () => void;
  onPick: (giftId: string) => void;
  onCreateWish?: () => void;
  onGive?: () => void;
  userLevel: number;
  userXp: number;
  initialQuery?: string;
}) {
  // Если пришли из поиска на главной — сразу открываем экран поиска с введённым словом.
  const seeded = typeof initialQuery === "string" ? initialQuery.trim() : "";
  const [step, setStep] = useState<Step>(seeded ? "search" : "kinds");

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
  const [meId, setMeId] = useState<string | null>(null);
  const [kind, setKind] = useState<GiftKind | null>(null);
  const [feedCat, setFeedCat] = useState<string | null>(null);
  // По умолчанию — все города (иначе подарки без города «исчезают» из ленты).
  const [cityFilter, setCityFilter] = useState<string | null>(null);
  const [query, setQuery] = useState(seeded);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SR | null>(null);
  // Подарок, недоступный по уровню, по которому тапнули — показываем подсказку.
  const [gate, setGate] = useState<{ g: Gift; reqLevel: number } | null>(null);
  // Подарок, открытый «поверх ленты» (модалка с фото-каруселью и описанием).
  const [detail, setDetail] = useState<Gift | null>(null);
  const markInvitedFn = useServerFn(markInvited);

  useEffect(() => {
    emitTour("receive-opened");
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setMeId(user?.id ?? null);
      const baseCols = "id,title,description,category,image_url,image_urls,cost,condition,owner_id,gift_kind,created_at";
      const buildQ = (cols: string) => {
        let q = supabase
          .from("gifts")
          .select(cols)
          .eq("status", "available")
          .not("owner_id", "is", null)
          .order("created_at", { ascending: false });
        if (user?.id) q = q.neq("owner_id", user.id);
        return q;
      };
      // Пробуем с городом/онлайн; если колонок ещё нет — без них.
      let res = await buildQ(`${baseCols},city,is_online`);
      if (res.error) res = await buildQ(baseCols);
      const rows = (res.data as unknown as Gift[]) ?? [];
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
        rows
          // Показываем ВСЕ подарки, в т.ч. недоступные по уровню — они видны в
          // ленте, а при попытке получить подсказываем, как поднять уровень.
          .map((g) => ({
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

  const onLocked = (g: Gift, reqLevel: number) => setGate({ g, reqLevel });
  const renderCard = (g: Gift) => (
    <GiftCard
      key={g.id}
      g={g}
      onPick={onPick}
      meId={meId}
      userLevel={userLevel}
      onLocked={onLocked}
      onOpenDetail={(gg) => setDetail(gg)}
    />
  );

  // Модалка подарка поверх ленты. «Получить» изнутри — закрываем и бронируем;
  // недоступный по уровню — закрываем и показываем подсказку про уровень.
  const detailModal = detail ? (
    <GiftDetailModal
      gift={detail}
      meId={meId}
      userLevel={userLevel}
      onPick={(id) => {
        setDetail(null);
        onPick(id);
      }}
      onLocked={(_g, lvl) => {
        if (detail) setGate({ g: detail, reqLevel: lvl });
      }}
      onClose={() => setDetail(null)}
    />
  ) : null;

  // Подсказка про уровень. Кнопка «Пригласить друга» делится ссылкой и
  // засчитывает шаг пути; «Подарить» уводит в дарение (быстрый рост уровня).
  const inviteUrl = `${APP_BASE_URL}/?ref=${meId ?? ""}`;
  const handleInvite = () => {
    shareLink(pickRandom(INVITE_VARIANTS), inviteUrl);
    markInvitedFn({}).catch(() => {
      /* офлайн — отметится позже */
    });
    try {
      localStorage.setItem("cozygift_invited", "1");
    } catch {
      /* noop */
    }
    setGate(null);
  };
  const gateModal = gate ? (
    <LevelGateModal
      giftTitle={gate.g.title}
      requiredLevel={gate.reqLevel}
      userLevel={userLevel}
      userXp={userXp}
      onInvite={handleInvite}
      onGive={() => {
        setGate(null);
        onGive?.();
      }}
      onClose={() => setGate(null)}
    />
  ) : null;


  // Search step
  if (step === "search") {
    const q = query.trim().toLowerCase();
    // Лента полная: показываем подарки всех категорий, даже «закрытых».
    const pool = gifts;
    const matched = q
      ? pool.filter(
          (g) =>
            g.title.toLowerCase().includes(q) ||
            g.category.toLowerCase().includes(q) ||
            (g.description ?? "").toLowerCase().includes(q),
        )
      : pool;
    const { cities: sCities, online: sOnline, validCity: sValid, pool: results } =
      applyCityFilter(matched, cityFilter);
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
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
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
          <button
            type="button"
            onClick={() => (document.activeElement as HTMLElement | null)?.blur?.()}
            disabled={!query.trim()}
            aria-label="Искать"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition active:scale-95 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <CityChips cities={sCities} online={sOnline} value={sValid} onChange={setCityFilter} />
        <div className="space-y-3">
          {results.length === 0 ? (
            <NothingHere note="По запросу ничего не нашлось 🌿" />
          ) : (
            results.map(renderCard)
          )}
        </div>
        {gateModal}
        {detailModal}
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

        <div className="grid grid-cols-2 gap-3" data-tour="tour-spot">
          {GIFT_KINDS.map((k) => {
            const locked = userLevel < k.minLevel;
            const n = countsByKind.get(k.id) ?? 0;
            return (
              <button
                key={k.id}
                onClick={() => {
                  setKind(k.id);
                  setStep("feed");
                  emitTour("kind-picked");
                }}
                className="relative rounded-2xl border bg-card p-4 text-left shadow-sm transition hover:bg-accent hover:-translate-y-0.5"
              >
                <div className="mb-1 text-2xl">{k.emoji}</div>
                <div className="text-sm font-medium">{k.shortLabel}</div>
                <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  {locked && <Lock className="h-3 w-3" />}
                  <span>
                    {n} {n === 1 ? "подарок" : "подарков"}
                    {locked ? ` · с ур. ${k.minLevel}` : ""}
                  </span>
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
            onKeyDown={(e) => { if (e.key === "Enter" && query.trim()) setStep("search"); }}
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
          <button
            type="button"
            onClick={() => query.trim() && setStep("search")}
            disabled={!query.trim()}
            aria-label="Искать"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition active:scale-95 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // Лента подарков выбранного вида. Подкатегории показываем не сразу, а только
  // когда их «много»: категория получает свою вкладку при 3+ подарках, всё
  // остальное собираем во вкладку «Разное». Пока подарков мало — вкладок нет,
  // просто общая лента.
  const kindMeta = kind ? getKindMeta(kind) : null;
  const inKind = gifts.filter((g) => g.gift_kind === kind);

  // Фильтр по местоположению: города + «Онлайн». Онлайн-подарки доступны
  // в любом городе, поэтому показываются и при выбранном городе.
  const { cities: cityList, online: onlineCount, validCity, pool: cityPool } =
    applyCityFilter(inKind, cityFilter);

  const MISC = "разное";
  const catCounts = new Map<string, number>();
  for (const g of cityPool) {
    const c = (g.category || MISC).toLowerCase();
    catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
  }
  // «Крупные» категории (3+ подарка), кроме самой «Разное» — становятся вкладками.
  const bigCats = [...catCounts.entries()]
    .filter(([c, n]) => n >= 3 && c !== MISC)
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);
  const isBig = (g: Gift) => bigCats.includes((g.category || MISC).toLowerCase());
  const miscGifts = cityPool.filter((g) => !isBig(g));
  const tabs = [
    ...bigCats.map((c) => ({ id: c, label: getCategoryMeta(c).label, emoji: getCategoryMeta(c).emoji, n: catCounts.get(c)! })),
    ...(miscGifts.length ? [{ id: MISC, label: "Разное", emoji: "🎁", n: miscGifts.length }] : []),
  ];
  // Вкладки имеют смысл только если есть хотя бы одна крупная категория.
  const showTabs = bigCats.length > 0;
  const activeTab = showTabs
    ? (feedCat && tabs.some((t) => t.id === feedCat) ? feedCat : tabs[0].id)
    : null;
  const shown = !showTabs
    ? cityPool
    : activeTab === MISC
      ? miscGifts
      : cityPool.filter((g) => (g.category || MISC).toLowerCase() === activeTab);

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
        {inKind.length} {inKind.length === 1 ? "подарок" : "подарков"} доступно
      </p>

      <CityChips cities={cityList} online={onlineCount} value={validCity} onChange={setCityFilter} />

      {showTabs && (
        <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
          {tabs.map((t) => {
            const active = t.id === activeTab;
            return (
              <button
                key={t.id}
                onClick={() => setFeedCat(t.id)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? "border-mint bg-mint text-mint-foreground shadow-sm"
                    : "border-input bg-card text-muted-foreground hover:bg-accent"
                }`}
              >
                {t.emoji} {t.label} <span className="opacity-70">{t.n}</span>
              </button>
            );
          })}
        </div>
      )}

      {shown.length === 0 ? (
        <div data-tour="tour-spot">
          <NothingHere note="В этой категории пока пусто 💚" />
        </div>
      ) : (
        <div className="space-y-3" data-tour="tour-spot">{shown.map(renderCard)}</div>
      )}
      {gateModal}
      {detailModal}
    </div>
  );
}
