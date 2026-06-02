import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getMyChats } from "@/lib/cozy.functions";
import { haptic } from "@/lib/haptics";
import { Skeleton } from "@/components/ui/skeleton";

type ChatItem = {
  transaction_id: string;
  status: string;
  gift_id: string;
  gift_title: string;
  gift_image: string | null;
  other_name: string;
  created_at: string;
};

type Filter = "givers" | "receivers" | "archive";

function timeAgo(iso?: string | null) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "сейчас";
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} дн`;
  return new Date(iso).toLocaleDateString("ru-RU");
}

function StatusTag({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "В резерве", cls: "bg-peach/60 text-peach-foreground" },
    completed: { label: "Завершено", cls: "bg-mint/60 text-mint-foreground" },
    cancelled: { label: "Отменено", cls: "bg-muted text-muted-foreground" },
  };
  const t = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground" };
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${t.cls}`}>
      {t.label}
    </span>
  );
}

export function ChatsTab() {
  const [filter, setFilter] = useState<Filter>("givers");

  const [givers, setGivers] = useState<ChatItem[] | null>(null);
  const [receivers, setReceivers] = useState<ChatItem[] | null>(null);
  const [archiveG, setArchiveG] = useState<ChatItem[]>([]);
  const [archiveR, setArchiveR] = useState<ChatItem[]>([]);
  const chatsFn = useServerFn(getMyChats);

  useEffect(() => {
    (async () => {
      const c = (await chatsFn()) as {
        with_givers: ChatItem[];
        with_receivers: ChatItem[];
        archive_with_givers?: ChatItem[];
        archive_with_receivers?: ChatItem[];
      };
      setGivers(c.with_givers ?? []);
      setReceivers(c.with_receivers ?? []);
      setArchiveG(c.archive_with_givers ?? []);
      setArchiveR(c.archive_with_receivers ?? []);
    })();
  }, [chatsFn]);

  const base: ChatItem[] = useMemo(() => {
    if (filter === "givers") return givers ?? [];
    if (filter === "receivers") return receivers ?? [];
    return [...archiveG, ...archiveR];
  }, [filter, givers, receivers, archiveG, archiveR]);

  const list = base;

  const loading =
    (filter === "givers" && !givers) || (filter === "receivers" && !receivers);

  return (
    <div className="mx-auto w-full max-w-md px-5 pb-6 pt-7">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Чаты</h1>
        <p className="text-sm text-muted-foreground">
          Общение по подаркам и сделкам
        </p>
      </header>

      {/* Search */}
      <div className="mb-4 flex items-center gap-2 rounded-2xl border bg-card px-3 py-2.5 shadow-sm">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            filter === "archive"
              ? "Глубокий поиск по архиву…"
              : "Умный поиск по потребностям…"
          }
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
        />
      </div>


      {/* Segmented control */}
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-2xl border bg-muted/60 p-1">
        {([
          ["givers", "С дарителями"],
          ["receivers", "С получателями"],
          ["archive", "Архив"],
        ] as const).map(([k, label]) => {
          const active = filter === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => {
                if (!active) {
                  haptic("select");
                  setFilter(k);
                }
              }}
              className={`rounded-xl px-2 py-1.5 text-[11.5px] font-medium leading-tight transition-all duration-300 ${
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
          {q
            ? "Ничего не нашлось 🌿"
            : filter === "archive"
              ? "Архив пуст"
              : "Здесь пока нет активных чатов"}
        </div>
      ) : (
        <ul key={filter} className="achievements-list space-y-2">
          {list.map((c) => (
            <li key={c.transaction_id}>
              <Link
                to="/chat/$giftId"
                params={{ giftId: c.gift_id }}
                onClick={() => haptic("select")}
                className="flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm transition active:scale-[0.98]"
              >
                {c.gift_image ? (
                  <img
                    src={c.gift_image}
                    alt={c.gift_title}
                    className="h-12 w-12 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-xl">
                    🎁
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{c.other_name}</p>
                    <span className="shrink-0 text-[10.5px] text-muted-foreground">
                      {timeAgo(c.created_at)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <p className="truncate text-xs text-muted-foreground">
                      🎁 {c.gift_title}
                    </p>
                    <StatusTag status={c.status} />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
