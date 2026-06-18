import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { LevelBadge } from "@/components/LevelBadge";

import { listWishes } from "@/lib/wishes.functions";
import { haptic } from "@/lib/haptics";
import { Sparkles, Share2 } from "lucide-react";
import { WISH_EXAMPLES, wishShareVariants } from "@/lib/random-copy";
import { InviteShareSheet } from "@/components/InviteShareSheet";
import { CityChips } from "@/components/CityChips";
import { applyCityFilter } from "@/lib/city-filter";

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
}

function WishCard({ w, meId, onOpen }: { w: Wish; meId: string | null; onOpen: (id: string) => void }) {
  const [shareOpen, setShareOpen] = useState(false);
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://podari.visokihelenasochi.workers.dev";
  // Ссылка ведёт на главную и засчитывает реферал. Никуда не уводим.
  const shareLink = meId ? `${origin}/?ref=${meId}` : `${origin}/`;
  return (
    <li className="relative">
      <button
        type="button"
        onClick={() => {
          haptic("select");
          onOpen(w.id);
        }}
        className="flex w-full gap-3 rounded-2xl border bg-card p-3 text-left shadow-sm transition active:scale-[0.98]"
      >
        {w.image_url ? (
          <img
            src={w.image_url}
            alt={w.title}
            loading="lazy"
            className="h-20 w-20 shrink-0 rounded-xl object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-peach/40 text-3xl">
            ✨
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate pr-7 text-[15px] font-semibold leading-tight">{w.title}</div>
          {w.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{w.description}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded-lg bg-lavender/70 px-2 py-0.5 text-[12px] font-semibold text-lavender-foreground">
              {w.owner_name}
            </span>
            <LevelBadge level={w.owner_level} />

            <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
              {w.cost} {w.cost === 1 ? "балл" : w.cost < 5 ? "балла" : "баллов"}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              {w.category}
            </span>
            {w.is_online ? (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                🌐 Онлайн
              </span>
            ) : w.city ? (
              <span className="rounded-full bg-peach/40 px-2 py-0.5 text-[10px] font-medium text-foreground">
                📍 {w.city}
              </span>
            ) : null}
          </div>
        </div>
      </button>

      <button
        type="button"
        onClick={() => setShareOpen(true)}
        aria-label="Поделиться желанием"
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm ring-1 ring-border transition hover:text-foreground active:scale-95"
      >
        <Share2 className="h-3.5 w-3.5" />
      </button>

      <InviteShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        link={shareLink}
        variants={wishShareVariants(w.title)}
        title="Поделиться желанием"
      />
    </li>
  );
}

export function WishesFeed({ onOpen, onCreate, searchQuery }: Props) {
  const [wishes, setWishes] = useState<Wish[] | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [wishIdx, setWishIdx] = useState(() => Math.floor(Math.random() * WISH_EXAMPLES.length));
  const [cityFilter, setCityFilter] = useState<string | null>(() =>
    typeof localStorage !== "undefined" ? localStorage.getItem("cozygift_city") || null : null,
  );
  const listFn = useServerFn(listWishes);

  useEffect(() => {
    listFn({ data: {} }).then((data) => setWishes(data as Wish[])).catch(() => setWishes([]));
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
          <span className="block text-[15px] font-semibold leading-tight">✨ Загадать желание</span>
          <span className="block h-[14px] text-[11px] opacity-75 line-clamp-1">{WISH_EXAMPLES[wishIdx]}</span>
        </span>
      </button>

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
