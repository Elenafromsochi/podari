import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CityBadge } from "@/components/CityBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { claimGift } from "@/lib/cozy.functions";
import { haptic } from "@/lib/haptics";
import { LevelBadge } from "@/components/LevelBadge";
import { GlobalChrome } from "@/components/GlobalChrome";
import { Stars } from "@/components/ui/stars";


export const Route = createFileRoute("/user/$userId")({
  component: UserProfilePage,
  errorComponent: ({ error, reset }) => (
    <div className="p-4">
      <p className="text-sm text-destructive">Ошибка: {error.message}</p>
      <Button onClick={reset} className="mt-3">Повторить</Button>
    </div>
  ),
  notFoundComponent: () => <div className="p-4">Профиль не найден</div>,
});

type Gift = {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  cost: number;
  condition: number | null;
  status: string;
  quantity?: number | null;
  quantity_remaining?: number | null;
  city?: string | null;
  is_online?: boolean | null;
};

type Wish = {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  category: string;
  city?: string | null;
  is_online?: boolean | null;
};

const ACTIVE_CHAT_KEY = "cozygift_active_chat_gift";
const ACTIVE_TX_KEY = "cozygift_active_tx";

function UserProfilePage() {
  const { userId } = Route.useParams();
  const navigate = useNavigate();
  const claim = useServerFn(claimGift);
  const [name, setName] = useState<string>("Гость");
  const [level, setLevel] = useState<number>(1);
  const [rating, setRating] = useState<{ avg: number; count: number } | null>(null);
  const [active, setActive] = useState<Gift[] | null>(null);
  const [given, setGiven] = useState<Gift[] | null>(null);
  const [wishes, setWishes] = useState<Wish[] | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});


  useEffect(() => {
    (async () => {
      const { data: profs } = await supabase.rpc("get_public_profiles", { _user_ids: [userId] });
      const p = (profs ?? [])[0] as { display_name?: string; level?: number } | undefined;
      if (p) {
        setName(p.display_name || "Гость");
        setLevel(p.level ?? 1);
      }
      const giftQ = (cols: string) =>
        supabase
          .from("gifts")
          .select(cols)
          .eq("owner_id", userId)
          .in("status", ["available", "gifted"])
          .order("created_at", { ascending: false });
      let gRes = await giftQ("id,title,description,image_url,cost,condition,status,city,is_online,quantity,quantity_remaining");
      if (gRes.error) gRes = await giftQ("id,title,description,image_url,cost,condition,status");
      const rows = (gRes.data as unknown as Gift[]) ?? [];
      setActive(rows.filter((g) => g.status === "available"));
      setGiven(rows.filter((g) => g.status === "gifted"));

      const wishQ = (cols: string) =>
        supabase
          .from("wishes")
          .select(cols)
          .eq("owner_id", userId)
          .eq("status", "open")
          .order("created_at", { ascending: false });
      let wRes = await wishQ("id,title,description,image_url,category,city,is_online");
      if (wRes.error) wRes = await wishQ("id,title,description,image_url,category");
      setWishes((wRes.data as unknown as Wish[]) ?? []);

      // Рейтинг человека из отзывов о нём
      const { data: revs } = await supabase
        .from("reviews")
        .select("rating")
        .eq("target_id", userId);
      const list = (revs as { rating: number }[] | null) ?? [];
      if (list.length > 0) {
        const avg = list.reduce((s, r) => s + (r.rating ?? 0), 0) / list.length;
        setRating({ avg, count: list.length });
      } else {
        setRating({ avg: 0, count: 0 });
      }
    })();
  }, [userId]);

  const handleClaim = async (giftId: string) => {
    setClaiming(giftId);
    try {
      const res = await claim({ data: { gift_id: giftId } });
      localStorage.setItem(ACTIVE_CHAT_KEY, giftId);
      localStorage.setItem(ACTIVE_TX_KEY, res.transaction_id);
      haptic("success");
      toast.success("−1 балл заморожен • Безопасная сделка 🔒", {
        description: "Открываем чат с дарителем",
      });
      navigate({ to: "/" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("ALREADY_TAKEN"))
        toast.error("Подарок уже забрали", { description: "Выбери другой 💚" });
      else if (msg.includes("OWN_GIFT"))
        toast.error("Это твой подарок", { description: "Своё забрать нельзя 🙂" });
      else if (msg.includes("INSUFFICIENT_BALANCE"))
        toast.error("Недостаточно баллов", { description: "Подари что-нибудь, чтобы заработать" });
      else toast.error("Не получилось забрать подарок", { description: msg });
    } finally {
      setClaiming(null);
    }
  };

  return (
    <GlobalChrome>
    <div className="mx-auto w-full max-w-md space-y-4 px-5 pb-8 pt-5">
      <button
        onClick={() => navigate({ to: "/" })}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Назад
      </button>
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-peach text-2xl">
          🎁
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{name}</h1>
          <div className="mt-1"><LevelBadge level={level} size="md" /></div>
          {rating &&
            (rating.count > 0 ? (
              <div className="mt-1 text-sm font-medium text-amber-600 dark:text-amber-400">
                ⭐ {rating.avg.toFixed(1)} ·{" "}
                <span className="text-muted-foreground">
                  {rating.count}{" "}
                  {rating.count % 10 === 1 && rating.count % 100 !== 11
                    ? "отзыв"
                    : [2, 3, 4].includes(rating.count % 10) &&
                        ![12, 13, 14].includes(rating.count % 100)
                      ? "отзыва"
                      : "отзывов"}
                </span>
              </div>
            ) : (
              <div className="mt-1 text-sm text-muted-foreground">
                🐣 Новичок — отзывов пока нет
              </div>
            ))}
        </div>

      </div>

      <section className="space-y-3">
        <h2 className="pt-2 text-lg font-semibold tracking-tight">Активные подарки</h2>
        {active === null ? (
          <Skeleton className="h-24 w-full rounded-2xl" />
        ) : active.length === 0 ? (
          <p className="text-sm text-muted-foreground">Пока нет активных подарков.</p>
        ) : (
          <ul className="space-y-3">
            {active.map((g) => {
              const isOpen = !!expanded[g.id];
              return (
                <li key={g.id}>
                  <article className="rounded-2xl border bg-card p-3 shadow-sm">
                    <button
                      type="button"
                      onClick={() => setExpanded((s) => ({ ...s, [g.id]: !s[g.id] }))}
                      className="flex w-full items-start gap-3 text-left"
                      aria-expanded={isOpen}
                    >
                      {g.image_url ? (
                        <img
                          src={g.image_url}
                          alt={g.title}
                          className="h-20 w-20 shrink-0 rounded-xl object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-muted text-3xl">
                          🎁
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-1">
                          <div className={`flex-1 text-[15px] font-semibold leading-tight ${isOpen ? "" : "truncate"}`}>
                            {g.title}
                          </div>
                          <ChevronDown
                            className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                          />
                        </div>
                        {g.condition ? (
                          <div
                            className="mt-0.5 text-sm leading-none"
                            aria-label={`Состояние ${g.condition} из 5`}
                            title={`Состояние: ${g.condition} из 5`}
                          >
                            <Stars value={g.condition} />
                          </div>
                        ) : null}
                        {(g.quantity ?? 1) > 1 &&
                        g.status === "available" &&
                        typeof g.quantity_remaining === "number" ? (
                          <span className="mt-0.5 inline-block rounded-lg bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                            🔁 осталось {g.quantity_remaining} из {g.quantity}
                          </span>
                        ) : null}
                        {g.description && (
                          <p className={`mt-0.5 text-xs text-muted-foreground whitespace-pre-wrap ${isOpen ? "" : "line-clamp-2"}`}>
                            {g.description}
                          </p>
                        )}
                        {(g.city || g.is_online) && (
                          <div className="mt-1">
                            <CityBadge city={g.city} isOnline={g.is_online} />
                          </div>
                        )}
                      </div>
                    </button>
                    <div className="mt-2 pl-[92px]">
                      <Button
                        size="sm"
                        className="h-8 rounded-xl bg-mint text-mint-foreground hover:bg-mint/90"
                        disabled={claiming === g.id}
                        onClick={() => handleClaim(g.id)}
                      >
                        {claiming === g.id ? "Получаем…" : "Получить подарок"}
                      </Button>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="pt-2 text-lg font-semibold tracking-tight">Уже подарено</h2>
        {given === null ? (
          <Skeleton className="h-24 w-full rounded-2xl" />
        ) : given.length === 0 ? (
          <p className="text-sm text-muted-foreground">Пока не подарил ни одного подарка.</p>
        ) : (
          <ul className="space-y-3">
            {given.map((g) => (
              <li key={g.id}>
                <article className="flex gap-3 rounded-2xl border bg-card p-3 shadow-sm opacity-90">
                  {g.image_url ? (
                    <img
                      src={g.image_url}
                      alt={g.title}
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
                      {g.title}
                    </div>
                    {g.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {g.description}
                      </p>
                    )}
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className="inline-flex items-center rounded-full bg-mint/60 px-1.5 py-0.5 text-[10px] font-medium text-mint-foreground">
                        подарено
                      </span>
                      <CityBadge city={g.city} isOnline={g.is_online} />
                    </div>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="pt-2 text-lg font-semibold tracking-tight">Загаданные желания</h2>
        {wishes === null ? (
          <Skeleton className="h-24 w-full rounded-2xl" />
        ) : wishes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Пока ничего не загадал.</p>
        ) : (
          <ul className="space-y-3">
            {wishes.map((w) => (
              <li key={w.id}>
                <article className="flex gap-3 rounded-2xl border bg-card p-3 shadow-sm">
                  {w.image_url ? (
                    <img
                      src={w.image_url}
                      alt={w.title}
                      className="h-20 w-20 shrink-0 rounded-xl object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-peach/40 text-3xl">
                      ✨
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold leading-tight">
                      {w.title}
                    </div>
                    {w.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {w.description}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        {w.category}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-peach/60 px-1.5 py-0.5 text-[10px] font-semibold text-peach-foreground">
                        загадано
                      </span>
                      <CityBadge city={w.city} isOnline={w.is_online} />
                    </div>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
    </GlobalChrome>
  );
}
