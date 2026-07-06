import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { ItemCard } from "@/components/ItemCard";

import { listWishes } from "@/lib/wishes.functions";
import { haptic } from "@/lib/haptics";
import { Sparkles } from "lucide-react";
import { WISH_EXAMPLES, wishShareVariants } from "@/lib/random-copy";
import { shareLink, thirdVariant } from "@/lib/share";
import { CityChips } from "@/components/CityChips";
import { applyCityFilter } from "@/lib/city-filter";
import { APP_BASE_URL } from "@/lib/app-url";

type Wish = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  image_url: string | null;
  status: string;
  cost: number;
  owner_id: string;
  owner_name: string;
  owner_level: number;
  is_own: boolean;
  city?: string | null;
  is_online?: boolean | null;
};

interface Props {
  onOpen: (wishId: string) => void;
  onCreate: () => void;
  searchQuery?: string;
  /** Скрыть кнопку «Загадать желание» (например, в режиме дарения). */
  hideCreate?: boolean;
}

function WishCard({
  w,
  meId,
  onOpen,
}: {
  w: Wish;
  meId: string | null;
  onOpen: (id: string) => void;
}) {
  const origin = APP_BASE_URL;
  const shareUrl = meId ? `${origin}/?ref=${meId}` : `${origin}/`;
  return (
    <li>
      <ItemCard
        image={w.image_url}
        title={w.title}
        description={w.description}
        cost={w.cost}
        category={w.category}
        ownerName={w.owner_name}
        ownerId={w.owner_id}
        ownerLevel={w.owner_level}
        city={w.city}
        isOnline={w.is_online}
        emptyEmoji="✨"
        onOpen={() => {
          haptic("select");
          onOpen(w.id);
        }}
        onShare={() => shareLink(thirdVariant(wishShareVariants(w.title)), shareUrl)}
      />
    </li>
  );
}

export function WishesFeed({ onOpen, onCreate, searchQuery, hideCreate }: Props) {
  const [wishes, setWishes] = useState<Wish[] | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [wishIdx, setWishIdx] = useState(() => Math.floor(Math.random() * WISH_EXAMPLES.length));
  // По умолчанию показываем все города (иначе желания без города «исчезают»).
  const [cityFilter, setCityFilter] = useState<string | null>(null);
  const listFn = useServerFn(listWishes);

  useEffect(() => {
    listFn({ data: {} })
      .then((data) => setWishes(data as Wish[]))
      .catch(() => setWishes([]));
    supabase.auth.getSession().then(({ data }) => setMeId(data.session?.user?.id ?? null));
  }, [listFn]);

  useEffect(() => {
    const t = setInterval(() => {
      setWishIdx((i) => (i + 1) % WISH_EXAMPLES.length);
    }, 30000);
    return () => clearInterval(t);
  }, []);

  const q = (searchQuery ?? "").trim().toLowerCase();
  const matched =
    wishes && q
      ? wishes.filter(
          (w) =>
            w.title.toLowerCase().includes(q) ||
            (w.description && w.description.toLowerCase().includes(q)) ||
            w.owner_name.toLowerCase().includes(q) ||
            w.category.toLowerCase().includes(q),
        )
      : wishes;
  const { cities, online, validCity, pool: list } = applyCityFilter(matched ?? [], cityFilter);

  return (
    <div>
      {!hideCreate && (
        <button
          type="button"
          onClick={() => {
            haptic("medium");
            onCreate();
          }}
          className="mb-4 flex w-full items-center gap-3 rounded-2xl bg-mint px-4 py-3 text-left text-mint-foreground shadow-sm transition active:scale-[0.98] hover:bg-mint/90"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-background/60 backdrop-blur">
            <Sparkles className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-[15px] font-semibold leading-tight">
              ✨ Загадать желание
            </span>
            <span className="block h-[14px] text-[11px] opacity-75 line-clamp-1">
              {WISH_EXAMPLES[wishIdx]}
            </span>
          </span>
        </button>
      )}

      {wishes && (
        <CityChips cities={cities} online={online} value={validCity} onChange={setCityFilter} />
      )}

      {!wishes ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      ) : list && list.length === 0 ? (
        <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
          {q ? "Ничего не нашлось 🌿" : "Пока никто ничего не пожелал. Будь первым ✨"}
        </div>
      ) : (
        <ul className="space-y-3">
          {list?.map((w) => (
            <WishCard key={w.id} w={w} meId={meId} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </div>
  );
}
