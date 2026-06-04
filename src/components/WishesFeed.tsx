import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Skeleton } from "@/components/ui/skeleton";
import { LevelBadge } from "@/components/LevelBadge";

import { listWishes } from "@/lib/wishes.functions";
import { haptic } from "@/lib/haptics";
import { Sparkles } from "lucide-react";
import { WISH_EXAMPLES } from "@/lib/random-copy";

type Wish = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  image_url: string | null;
  status: string;
  owner_id: string;
  owner_name: string;
  owner_level: number;
  is_own: boolean;
};

interface Props {
  onOpen: (wishId: string) => void;
  onCreate: () => void;
  searchQuery?: string;
}

export function WishesFeed({ onOpen, onCreate, searchQuery }: Props) {
  const [wishes, setWishes] = useState<Wish[] | null>(null);
  const listFn = useServerFn(listWishes);

  useEffect(() => {
    listFn({ data: {} }).then((data) => setWishes(data as Wish[])).catch(() => setWishes([]));
  }, [listFn]);

  const q = (searchQuery ?? "").trim().toLowerCase();
  const list =
    wishes && q
      ? wishes.filter(
          (w) =>
            w.title.toLowerCase().includes(q) ||
            (w.description && w.description.toLowerCase().includes(q)) ||
            w.owner_name.toLowerCase().includes(q) ||
            w.category.toLowerCase().includes(q),
        )
      : wishes;

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          haptic("medium");
          onCreate();
        }}
        className="mb-4 flex w-full items-center gap-3 rounded-2xl bg-peach px-4 py-3 text-left text-peach-foreground shadow-sm transition active:scale-[0.98]"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-background/60 backdrop-blur">
          <Sparkles className="h-5 w-5" />
        </span>
        <span>
          <span className="block text-[15px] font-semibold leading-tight">✨ Загадать желание</span>
        </span>
      </button>

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
            <li key={w.id}>
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
                  <div className="truncate text-[15px] font-semibold leading-tight">{w.title}</div>
                  {w.description && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{w.description}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-lg bg-lavender/70 px-2 py-0.5 text-[12px] font-semibold text-lavender-foreground">
                      {w.owner_name}
                    </span>
                    <LevelBadge level={w.owner_level} />

                    <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      {w.category}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
