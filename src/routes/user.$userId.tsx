import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { shareGift } from "@/lib/share";
import { supabase } from "@/integrations/supabase/client";
import { ItemCard } from "@/components/ItemCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { claimGift } from "@/lib/cozy.functions";
import { haptic } from "@/lib/haptics";
import { LevelBadge } from "@/components/LevelBadge";
import { GlobalChrome } from "@/components/GlobalChrome";
import { ReviewsAboutMe } from "@/components/ReviewsAboutMe";
import { CollapsibleSection } from "@/components/CollapsibleSection";

export const Route = createFileRoute("/user/$userId")({
  component: UserProfilePage,
  errorComponent: ({ error, reset }) => (
    <div className="p-4">
      <p className="text-sm text-destructive">Ошибка: {error.message}</p>
      <Button onClick={reset} className="mt-3">
        Повторить
      </Button>
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
  const router = useRouter();
  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.history.back();
    else navigate({ to: "/" });
  };
  const claim = useServerFn(claimGift);
  const [name, setName] = useState<string>("Гость");
  const [level, setLevel] = useState<number>(1);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [about, setAbout] = useState<string | null>(null);
  // Три раздела свёрнуты по умолчанию — тап по заголовку разворачивает список.
  const [openSection, setOpenSection] = useState<"active" | "given" | "wishes" | null>(null);
  const [rating, setRating] = useState<{ avg: number; count: number } | null>(null);
  const [active, setActive] = useState<Gift[] | null>(null);
  const [given, setGiven] = useState<Gift[] | null>(null);
  const [wishes, setWishes] = useState<Wish[] | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: profs } = await supabase.rpc("get_public_profiles", { _user_ids: [userId] });
      const p = (profs ?? [])[0] as { display_name?: string; level?: number } | undefined;
      if (p) {
        setName(p.display_name || "Гость");
        setLevel(p.level ?? 1);
      }
      // Фото и «о себе» — публично читаемые поля профиля (могут отсутствовать,
      // если миграция avatar_url/about ещё не накатана).
      const { data: extra } = await supabase
        .from("profiles")
        .select("avatar_url, about")
        .eq("user_id", userId)
        .maybeSingle();
      if (extra) {
        setAvatarUrl((extra as { avatar_url?: string | null }).avatar_url ?? null);
        setAbout((extra as { about?: string | null }).about ?? null);
      }
      const giftQ = (cols: string) =>
        supabase
          .from("gifts")
          .select(cols)
          .eq("owner_id", userId)
          .in("status", ["available", "gifted"])
          .order("created_at", { ascending: false });
      let gRes = await giftQ(
        "id,title,description,image_url,cost,condition,status,city,is_online,quantity,quantity_remaining",
      );
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

      // Рейтинг человека из отзывов о нём. Скрытые (ожидающие подтверждения)
      // отзывы не учитываем; если колонки visible ещё нет — читаем без фильтра.
      let revsRes = await supabase
        .from("reviews")
        .select("rating")
        .eq("target_id", userId)
        .eq("visible", true);
      if (revsRes.error)
        revsRes = await supabase.from("reviews").select("rating").eq("target_id", userId);
      const list = (revsRes.data as { rating: number }[] | null) ?? [];
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
          onClick={goBack}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Назад
        </button>
        <div className="flex items-center gap-3">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={name}
              className="h-14 w-14 shrink-0 rounded-full object-cover shadow-sm"
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-peach text-xl font-semibold text-peach-foreground shadow-sm">
              {(name || "?").trim().charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">{name}</h1>
            <div className="mt-1">
              <LevelBadge level={level} size="md" />
            </div>
            {rating && rating.count === 0 && (
              <div className="mt-1 text-sm text-muted-foreground">
                🐣 Новичок — отзывов пока нет
              </div>
            )}
          </div>
        </div>
        {about && <p className="text-sm text-muted-foreground">{about}</p>}

        {/* Отзывы — тот же блок, что и в своём профиле (свёрнутый список с оценкой). */}
        <ReviewsAboutMe userId={userId} title="Отзывы" />

        <CollapsibleSection
          title="Активные подарки"
          count={active?.length ?? null}
          open={openSection === "active"}
          onToggle={() => setOpenSection((s) => (s === "active" ? null : "active"))}
        >
          {active === null ? (
            <Skeleton className="h-24 w-full rounded-2xl" />
          ) : active.length === 0 ? (
            <p className="text-sm text-muted-foreground">Пока нет активных подарков.</p>
          ) : (
            <ul className="space-y-3">
              {active.map((g) => (
                <li key={g.id}>
                  <ItemCard
                    image={g.image_url}
                    title={g.title}
                    description={g.description}
                    cost={g.cost}
                    condition={g.condition}
                    city={g.city}
                    isOnline={g.is_online}
                    onOpen={() => navigate({ to: "/gift/$giftId", params: { giftId: g.id } })}
                    onShare={() => shareGift(g.id, g.title)}
                    footer={
                      <Button
                        size="sm"
                        className="h-8 w-full rounded-xl bg-mint text-mint-foreground hover:bg-mint/90"
                        disabled={claiming === g.id}
                        onClick={() => handleClaim(g.id)}
                      >
                        {claiming === g.id ? "Получаем…" : "Получить подарок"}
                      </Button>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="Уже подарено"
          count={given?.length ?? null}
          open={openSection === "given"}
          onToggle={() => setOpenSection((s) => (s === "given" ? null : "given"))}
        >
          {given === null ? (
            <Skeleton className="h-24 w-full rounded-2xl" />
          ) : given.length === 0 ? (
            <p className="text-sm text-muted-foreground">Пока не подарил ни одного подарка.</p>
          ) : (
            <ul className="space-y-3">
              {given.map((g) => (
                <li key={g.id}>
                  <ItemCard
                    image={g.image_url}
                    title={g.title}
                    description={g.description}
                    city={g.city}
                    isOnline={g.is_online}
                    badge={
                      <span className="inline-flex items-center rounded-full bg-mint/60 px-2 py-0.5 text-[11px] font-semibold text-mint-foreground">
                        🎁 подарено
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="Загаданные желания"
          count={wishes?.length ?? null}
          open={openSection === "wishes"}
          onToggle={() => setOpenSection((s) => (s === "wishes" ? null : "wishes"))}
        >
          {wishes === null ? (
            <Skeleton className="h-24 w-full rounded-2xl" />
          ) : wishes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Пока ничего не загадал.</p>
          ) : (
            <ul className="space-y-3">
              {wishes.map((w) => (
                <li key={w.id}>
                  <ItemCard
                    image={w.image_url}
                    title={w.title}
                    description={w.description}
                    category={w.category}
                    city={w.city}
                    isOnline={w.is_online}
                    emptyEmoji="✨"
                    badge={
                      <span className="inline-flex items-center rounded-full bg-peach/60 px-2 py-0.5 text-[11px] font-semibold text-peach-foreground">
                        ✨ загадано
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>
      </div>
    </GlobalChrome>
  );
}
