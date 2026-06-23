import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getReviewsAbout } from "@/lib/cozy.functions";
import { Stars } from "@/components/ui/stars";

type ReviewItem = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  author_name: string;
};

function fmtDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

/** Отзывы о пользователе — список с оценками и текстами. */
export function ReviewsAboutMe({
  userId,
  title = "Отзывы обо мне",
}: {
  userId: string;
  title?: string;
}) {
  const fn = useServerFn(getReviewsAbout);
  const [data, setData] = useState<{ count: number; avg: number; items: ReviewItem[] } | null>(
    null,
  );
  // По умолчанию список свёрнут — виден только заголовок с оценкой.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fn({ data: { user_id: userId } })
      .then((r) => {
        if (alive) setData(r as { count: number; avg: number; items: ReviewItem[] });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [fn, userId]);

  if (!data || data.count === 0) return null;

  return (
    <section className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mb-2 flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-1.5">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
        <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
          ⭐ {data.avg.toFixed(1)} · {data.count}
        </span>
      </button>
      {open && (
        <ul className="space-y-2">
          {data.items.map((r) => (
            <li key={r.id} className="rounded-2xl border bg-card p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{r.author_name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {fmtDate(r.created_at)}
                </span>
              </div>
              <div className="mt-0.5 text-sm leading-none">
                <Stars value={r.rating} />
              </div>
              {r.comment && <p className="mt-1 text-sm text-muted-foreground">{r.comment}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
